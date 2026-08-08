import { describe, expect, it } from 'vitest';
import { responsesInputToMessages } from '../../src/api/responses.js';

describe('responsesInputToMessages (Responses → internal ChatMessage)', () => {
  it('string input → single user message', () => {
    expect(responsesInputToMessages('hello')).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('array of role items with string content', () => {
    const out = responsesInputToMessages([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  it('content parts array → joined text', () => {
    const out = responsesInputToMessages([
      { role: 'user', content: [{ type: 'input_text', text: 'part1' }, { type: 'input_text', text: 'part2' }] },
    ]);
    expect(out[0]!.content).toBe('part1\npart2');
  });

  it('developer role → system', () => {
    const out = responsesInputToMessages([{ role: 'developer', content: 'be careful' }]);
    expect(out[0]!.role).toBe('system');
  });

  it('function_call_output → tool envelope message', () => {
    const out = responsesInputToMessages([
      { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
    ]);
    expect(out[0]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' });
  });
});
