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
