import { expect, test } from 'bun:test';
import { accumulate } from './accumulate.ts';

const asst = (id: string, usage: Record<string, number>, sidechain = false) => ({
  type: 'assistant', isSidechain: sidechain,
  message: { id, usage },
});
const user = (text: string) => ({ type: 'user', isSidechain: false, message: { content: text } });
const toolResult = () => ({
  type: 'user', isSidechain: false, message: { content: [{ type: 'tool_result' }] },
});

test('one message id spanning two lines counts as ONE turn with ONE usage', () => {
  const m = { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2, output_tokens: 7 };
  const out = accumulate([user('hi'), asst('msg_1', m), asst('msg_1', m)]);
  expect(out.turns).toBe(1);
  expect(out.tokens).toEqual({ input: 10, cacheRead: 5, cacheWrite: 2, output: 7 });
});

test('a tool_result user row never changes the trigger class', () => {
  const m = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const out = accumulate([
    user('<task-notification><event>COMMIT: x</event></task-notification>'),
    asst('a', m), toolResult(), asst('b', m),
  ]);
  expect(out.perClass['monitor-event'].turns).toBe(2);
  expect(out.perClass.human.turns).toBe(0);
});

test('sidechain turns are excluded from lead totals and reported separately', () => {
  const m = { input_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 };
  const out = accumulate([user('hi'), asst('a', m), asst('b', m, true)]);
  expect(out.turns).toBe(1);
  expect(out.sidechain.turns).toBe(1);
});

test('context is input + cache_read + cache_creation; first, last and max are tracked', () => {
  const mk = (r: number) => ({ input_tokens: 1, cache_read_input_tokens: r, cache_creation_input_tokens: 0, output_tokens: 0 });
  const out = accumulate([user('hi'), asst('a', mk(10)), asst('b', mk(99)), asst('c', mk(40))]);
  expect(out.firstContext).toBe(11);
  expect(out.lastContext).toBe(41);
  expect(out.maxContext).toBe(100);
});

test('babysitting share is monitor tokens over total, and is 0 with no monitor turns', () => {
  const m = { input_tokens: 0, cache_read_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 0 };
  expect(accumulate([user('hi'), asst('a', m)]).babysittingShare).toBe(0);
});

test('a zero-token transcript reports share 0 rather than dividing by zero', () => {
  expect(accumulate([]).babysittingShare).toBe(0);
});

test('Monitor arms are counted from assistant tool_use blocks', () => {
  const out = accumulate([user('hi'), {
    type: 'assistant', isSidechain: false,
    message: { id: 'a', usage: {}, content: [{ type: 'tool_use', name: 'Monitor' }] },
  }]);
  expect(out.monitorArms).toBe(1);
});

test('firstAt/lastAt are filled from the first and last row timestamps, in order (Fix 11)', () => {
  const out = accumulate([
    { type: 'user', isSidechain: false, message: { content: 'hi' }, timestamp: '2026-09-18T10:00:00.000Z' },
    { type: 'assistant', isSidechain: false, message: { id: 'a', usage: {} }, timestamp: '2026-09-18T10:02:00.000Z' },
    { type: 'assistant', isSidechain: false, message: { id: 'b', usage: {} }, timestamp: '2026-09-18T10:05:00.000Z' },
  ]);
  expect(out.firstAt).toBe('2026-09-18T10:00:00.000Z');
  expect(out.lastAt).toBe('2026-09-18T10:05:00.000Z');
});

test('firstAt/lastAt stay "" when no row carries a string timestamp', () => {
  const out = accumulate([user('hi'), asst('a', { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 })]);
  expect(out.firstAt).toBe('');
  expect(out.lastAt).toBe('');
});

test('a sidechain user row never touches the lead trigger class or monitorExpiries, and sidechain Monitor arms never raise monitorArms (Fix 9)', () => {
  const m = { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 };
  const out = accumulate([
    user('<task-notification><event>COMMIT: x</event></task-notification>'), // lead sets monitor-event
    asst('a', m),
    { // sidechain user row — must NOT touch currentClass or monitorExpiries
      type: 'user', isSidechain: true,
      message: { content: '<task-notification>Monitor expired</task-notification>' },
    },
    { // sidechain assistant row carrying a Monitor arm — must NOT raise monitorArms
      type: 'assistant', isSidechain: true,
      message: { id: 'side', usage: {}, content: [{ type: 'tool_use', name: 'Monitor' }] },
    },
    asst('b', m), // still a LEAD turn — should still be bucketed monitor-event
  ]);
  expect(out.perClass['monitor-event'].turns).toBe(2); // 'a' and 'b'
  expect(out.monitorExpiries).toBe(0);
  expect(out.monitorArms).toBe(0);
});

test('a synthetic assistant row (model "<synthetic>", zero/absent usage) is not a turn and never resets lastContext (Fix 7)', () => {
  const out = accumulate([
    user('hi'),
    asst('a', { input_tokens: 1, cache_read_input_tokens: 50, cache_creation_input_tokens: 0, output_tokens: 0 }),
    { type: 'assistant', isSidechain: false, message: { id: 's', model: '<synthetic>', usage: {} } },
  ]);
  expect(out.turns).toBe(1);
  expect(out.lastContext).toBe(51);
});

test('a Monitor arm on a CONTINUATION line of an already-seen message.id is still counted (Fix 2)', () => {
  const out = accumulate([user('hi'), {
    type: 'assistant', isSidechain: false,
    message: { id: 'dup', usage: {} }, // first occurrence: no content at all
  }, {
    type: 'assistant', isSidechain: false,
    message: { id: 'dup', usage: {}, content: [{ type: 'tool_use', name: 'Monitor' }] }, // continuation
  }]);
  expect(out.turns).toBe(1);
  expect(out.monitorArms).toBe(1);
});
