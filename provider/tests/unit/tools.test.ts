import { describe, expect, it } from 'vitest';
import {
  parseToolCalls,
  buildToolResultEnvelope,
  parseToolResults,
  toOpenAIToolCalls,
  stripToolEnvelopes,
  type ToolDefinition,
} from '../../src/hermes/tools.js';

const TOOLS: ToolDefinition[] = [
  { name: 'web_search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
];

describe('parseToolCalls (spec §23)', () => {
  it('parses a valid single call', () => {
    const text = 'Let me check.\n<HERMES_TOOL_CALL>\n{"name":"web_search","arguments":{"query":"hermes agent"}}\n</HERMES_TOOL_CALL>';
    const r = parseToolCalls(text, TOOLS);
    expect(r.errors).toEqual([]);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toEqual({ name: 'web_search', arguments: { query: 'hermes agent' } });
  });

  it('parses multiple calls', () => {
    const text =
      '<HERMES_TOOL_CALL>{"name":"web_search","arguments":{"query":"a"}}</HERMES_TOOL_CALL>\n<HERMES_TOOL_CALL>{"name":"read_file","arguments":{"path":"/tmp/x"}}</HERMES_TOOL_CALL>';
    const r = parseToolCalls(text, TOOLS);
    expect(r.calls).toHaveLength(2);
    expect(r.errors).toEqual([]);
  });

  it('no envelopes → empty result, no errors', () => {
    const r = parseToolCalls('Just a normal answer.', TOOLS);
    expect(r.calls).toEqual([]);
    expect(r.errors).toEqual([]);
  });

  it('invalid JSON inside envelope → hard error, no guessing', () => {
    const text = '<HERMES_TOOL_CALL>{"name": "web_search", "arguments": {"query":</HERMES_TOOL_CALL>';
    const r = parseToolCalls(text, TOOLS);
    expect(r.calls).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toContain('does not parse');
  });

  it('unknown tool name → error', () => {
    const text = '<HERMES_TOOL_CALL>{"name":"rm_rf","arguments":{}}</HERMES_TOOL_CALL>';
    const r = parseToolCalls(text, TOOLS);
    expect(r.calls).toEqual([]);
    expect(r.errors[0]).toContain('not in the declared tools');
  });

  it('arguments violating the declared schema → error (never repaired)', () => {
    const text = '<HERMES_TOOL_CALL>{"name":"web_search","arguments":{"query":123}}</HERMES_TOOL_CALL>';
    const r = parseToolCalls(text, TOOLS);
    expect(r.calls).toEqual([]);
    expect(r.errors[0]).toContain('failed schema validation');
  });

  it('missing required argument → error', () => {
    const text = '<HERMES_TOOL_CALL>{"name":"read_file","arguments":{}}</HERMES_TOOL_CALL>';
    const r = parseToolCalls(text, TOOLS);
    expect(r.calls).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('code-fenced envelope still parses (fences do not break the regex)', () => {
    const text = '```\n<HERMES_TOOL_CALL>\n{"name":"web_search","arguments":{"query":"x"}}\n</HERMES_TOOL_CALL>\n```';
    const r = parseToolCalls(text, TOOLS);
    expect(r.calls).toHaveLength(1);
  });

  it('lowercased tags (browser HTML serialization) still parse', () => {
    const text = '<hermes_tool_call>\n{"name":"web_search","arguments":{"query":"x"}}\n</hermes_tool_call>';
    const r = parseToolCalls(text, TOOLS);
    expect(r.calls).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it('without declared tools, structural validation still applies', () => {
    const text = '<HERMES_TOOL_CALL>{"name":"anything","arguments":{"a":1}}</HERMES_TOOL_CALL>';
    const r = parseToolCalls(text);
    expect(r.calls).toHaveLength(1);
  });
});

describe('tool result envelope (spec §23)', () => {
  it('build + parse round-trip', () => {
    const env = buildToolResultEnvelope([
      { tool_call_id: 'call_1', name: 'web_search', content: '{"results":[]}' },
      { tool_call_id: 'call_2', content: 'file contents' },
    ]);
    const parsed = parseToolResults(env);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ tool_call_id: 'call_1', name: 'web_search' });
    expect(parsed[1]).toMatchObject({ tool_call_id: 'call_2', content: 'file contents' });
  });

  it('malformed result envelopes are skipped', () => {
    const parsed = parseToolResults('<HERMES_TOOL_RESULT>not json</HERMES_TOOL_RESULT>');
    expect(parsed).toEqual([]);
  });
});

describe('toOpenAIToolCalls / stripToolEnvelopes', () => {
  it('converts to OpenAI format with ids', () => {
    const calls = toOpenAIToolCalls([{ name: 'web_search', arguments: { query: 'q' } }]);
    expect(calls[0]).toMatchObject({
      type: 'function',
      function: { name: 'web_search', arguments: '{"query":"q"}' },
    });
    expect(calls[0]!.id).toMatch(/^call_/);
  });

  it('strips envelopes keeping surrounding text', () => {
    const text = 'I will look it up.\n<HERMES_TOOL_CALL>{"name":"x","arguments":{}}</HERMES_TOOL_CALL>';
    expect(stripToolEnvelopes(text)).toBe('I will look it up.');
  });
});
