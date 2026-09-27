import { describe, expect, test } from 'bun:test';
import {
  answersPathOf, campaignStatePathOf, escalationPathOf, escalationsDirOf, reportDirOf,
  supervisorLedgerPathOf,
} from './paths.ts';

describe('campaign-home path helpers', () => {
  const home = '/Users/x/.tribe/-Users-x-repos-app/campaigns/widget-export';

  test('every artifact resolves to a fixed name under home', () => {
    expect(campaignStatePathOf(home)).toBe(`${home}/campaign-state.json`);
    expect(answersPathOf(home)).toBe(`${home}/answers.md`);
    expect(escalationsDirOf(home)).toBe(`${home}/escalations`);
    expect(escalationPathOf(home, 'C2')).toBe(`${home}/escalations/C2.md`);
    expect(reportDirOf(home)).toBe(home);
  });

  test('no helper ever resolves against a repo root', () => {
    const p = [campaignStatePathOf(home), answersPathOf(home), escalationsDirOf(home)];
    for (const one of p) expect(one.startsWith(home)).toBe(true);
  });

  test('a relative home is normalised, not concatenated blindly', () => {
    expect(campaignStatePathOf('a/b')).toBe('a/b/campaign-state.json');
  });

  test('supervisorLedgerPathOf: the campaign session tree (spec §4.4)', () => {
    expect(supervisorLedgerPathOf('/h')).toBe('/h/supervisor/ledger.jsonl');
  });
});
