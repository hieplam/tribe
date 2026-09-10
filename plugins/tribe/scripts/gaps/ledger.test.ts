import { describe, expect, test } from 'bun:test';
import {
  foldToLatestStatus,
  mintNextId,
  parseLedger,
  serializeEvent,
  LedgerError,
  type GapEvent,
  type OpenedEvent,
  type RuledEvent,
  type SeenEvent,
} from './ledger.ts';

// Spec §3's JSONL example (docs/superpowers/specs/2026-07-27-tribe-harness-gap-detection-design.md):
//   {"id":"G-001","event":"opened","category":"error-handling","paths":["src/handlers/"],
//    "fingerprint":"grep -rn 'catch {}' src/handlers/","hits_at_detection":9,"first_seen_pr":61}
//   {"id":"G-001","event":"seen","pr":64,"hits_now":10}
//   {"id":"G-001","event":"ruled","disposition":"anti-rule","ref":"rule-no-bare-catch"}
const openedFixture: OpenedEvent = {
  id: 'G-001',
  event: 'opened',
  category: 'error-handling',
  paths: ['src/handlers/'],
  fingerprint: "grep -rn 'catch {}' src/handlers/",
  hits_at_detection: 9,
  first_seen_pr: 61,
};
const seenFixture: SeenEvent = {
  id: 'G-001',
  event: 'seen',
  pr: 64,
  hits_now: 10,
};
const ruledFixture: RuledEvent = {
  id: 'G-001',
  event: 'ruled',
  disposition: 'anti-rule',
  ref: 'rule-no-bare-catch',
};

describe('event schema (discriminated union)', () => {
  test('opened/seen/ruled fixtures satisfy the GapEvent union and round-trip through JSON', () => {
    const events: GapEvent[] = [openedFixture, seenFixture, ruledFixture];
    for (const event of events) {
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    }
  });

  test('disposition is one of the five spec-named values', () => {
    const dispositions: RuledEvent['disposition'][] = [
      'rule',
      'anti-rule',
      'debt',
      'dismissed',
      'dismissed-duplicate',
    ];
    for (const disposition of dispositions) {
      const ruled: RuledEvent = { id: 'G-002', event: 'ruled', disposition, ref: 'x' };
      expect(ruled.disposition).toBe(disposition);
    }
  });
});

describe('parseLedger', () => {
  test('parses the spec §3 JSONL example into three typed events, in line order', () => {
    const text =
      `${JSON.stringify(openedFixture)}\n` +
      `${JSON.stringify(seenFixture)}\n` +
      `${JSON.stringify(ruledFixture)}\n`;

    const events = parseLedger(text);

    expect(events).toEqual([openedFixture, seenFixture, ruledFixture]);
  });

  test('skips blank lines (trailing newline, stray blank lines) without producing empty entries', () => {
    const text = `${JSON.stringify(openedFixture)}\n\n\n`;
    expect(parseLedger(text)).toEqual([openedFixture]);
  });

  test('empty registry text parses to an empty array', () => {
    expect(parseLedger('')).toEqual([]);
  });
});

describe('foldToLatestStatus', () => {
  test('the latest event per id defines its status (spec §3)', () => {
    const status = foldToLatestStatus([openedFixture, seenFixture, ruledFixture]);
    expect(status.size).toBe(1);
    expect(status.get('G-001')).toEqual(ruledFixture);
  });

  test('independent ids fold independently', () => {
    const openedTwo: OpenedEvent = { ...openedFixture, id: 'G-002' };
    const status = foldToLatestStatus([openedFixture, openedTwo, seenFixture]);
    expect(status.get('G-001')).toEqual(seenFixture);
    expect(status.get('G-002')).toEqual(openedTwo);
  });

  test('empty event list folds to an empty map', () => {
    expect(foldToLatestStatus([]).size).toBe(0);
  });
});

describe('mintNextId', () => {
  test('first id minted from no existing ids is G-001', () => {
    expect(mintNextId([])).toBe('G-001');
  });

  test('next id is max existing numeric suffix + 1, zero-padded to 3 digits', () => {
    expect(mintNextId(['G-001', 'G-002'])).toBe('G-003');
    expect(mintNextId(['G-009'])).toBe('G-010');
  });

  test('counts ALL ids including ruled/suppressed ones (plan Task 1 minting rule)', () => {
    // G-001 and G-002 are both ruled (suppressed) — the next id must still skip past them.
    expect(mintNextId(['G-001', 'G-002'])).toBe('G-003');
  });

  test('does not truncate ids >= 1000: next after G-999 is G-1000', () => {
    expect(mintNextId(['G-999'])).toBe('G-1000');
    expect(mintNextId(['G-1000'])).toBe('G-1001');
  });

  test('ignores out-of-order input; only the maximum numeric suffix matters', () => {
    expect(mintNextId(['G-005', 'G-001', 'G-003'])).toBe('G-006');
  });
});

describe('RuledEvent.ratified_by (Task 1, spec §2)', () => {
  test('ratified_by round-trips through parseLedger/serializeEvent when present', () => {
    const ratified: RuledEvent = {
      id: 'G-007',
      event: 'ruled',
      disposition: 'debt',
      ref: 'rule-no-bare-catch',
      ratified_by: 'shaman',
    };

    const line = serializeEvent(ratified);
    const [parsed] = parseLedger(line);

    expect(parsed).toEqual(ratified);
  });

  test('ratified_by accepts both spec-named values (owner|shaman)', () => {
    for (const ratifier of ['owner', 'shaman'] as const) {
      const ruled: RuledEvent = {
        id: 'G-008',
        event: 'ruled',
        disposition: 'dismissed',
        ref: 'not-a-gap',
        ratified_by: ratifier,
      };
      expect(parseLedger(serializeEvent(ruled))).toEqual([ruled]);
    }
  });

  test('CU-2 ruled lines without ratified_by still parse unchanged (backward compat)', () => {
    // ruledFixture (defined above, CU-2 shape) carries no ratified_by field at all.
    const line = serializeEvent(ruledFixture);
    const [parsed] = parseLedger(line);

    expect(parsed).toEqual(ruledFixture);
    expect((parsed as RuledEvent).ratified_by).toBeUndefined();
  });
});

describe('serializeEvent', () => {
  test('produces one compact, newline-terminated JSON line per event', () => {
    const line = serializeEvent(openedFixture);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n').length).toBe(2); // one content line + trailing empty split
    expect(line.includes('\n', 0)).toBe(true);
    expect(line.indexOf('\n')).toBe(line.length - 1); // no embedded newlines (compact, single line)
  });

  test('round-trips through parseLedger for every event kind', () => {
    for (const event of [openedFixture, seenFixture, ruledFixture]) {
      const serialized = serializeEvent(event);
      expect(parseLedger(serialized)).toEqual([event]);
    }
  });

  test('serializing a full ledger and parsing it back preserves fold order', () => {
    const text = [openedFixture, seenFixture, ruledFixture].map(serializeEvent).join('');
    const events = parseLedger(text);
    const status = foldToLatestStatus(events);
    expect(status.get('G-001')).toEqual(ruledFixture);
  });
});

describe('parseLedger typed refusals (card C1)', () => {
  test('a malformed JSON line raises LedgerError naming its 1-based line number', () => {
    const text = `${JSON.stringify(openedFixture)}\n{not json}\n`;
    expect(() => parseLedger(text)).toThrow(LedgerError);
    try {
      parseLedger(text);
    } catch (err) {
      expect((err as LedgerError).line).toBe(2);
      expect((err as LedgerError).message).toContain('ledger line 2');
    }
  });

  test('the reported line number counts blank lines, so it matches the file a human opens', () => {
    const text = `\n\n${JSON.stringify(openedFixture)}\n[]\n`;
    try {
      parseLedger(text);
      throw new Error('expected parseLedger to throw');
    } catch (err) {
      expect((err as LedgerError).line).toBe(4);
    }
  });

  test('a JSON object that is not a gap event is refused, not silently kept', () => {
    expect(() => parseLedger('{"id":"G-001","event":"invented"}\n')).toThrow(LedgerError);
    expect(() => parseLedger('{"event":"opened"}\n')).toThrow(LedgerError);
  });
});
