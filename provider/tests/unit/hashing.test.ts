import { describe, expect, it } from 'vitest';
import {
  requestHash,
  promptHash,
  normalizeHistory,
  isDeltaExtension,
} from '../../src/hermes/request-hash.js';
import { buildEnvelope, canonicalPrompt } from '../../src/hermes/messages.js';
import type { ChatMessage } from '../../src/chatgpt/client.js';

describe('requestHash (spec §17)', () => {
  it('is deterministic', () => {
    const a = requestHash('s1', 0, 'hello');
    const b = requestHash('s1', 0, 'hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when session, generation or prompt changes', () => {
    const base = requestHash('s1', 0, 'hello');
    expect(requestHash('s2', 0, 'hello')).not.toBe(base);
    expect(requestHash('s1', 1, 'hello')).not.toBe(base);
    expect(requestHash('s1', 0, 'hello!')).not.toBe(base);
  });

  it('promptHash is short and stable', () => {
    expect(promptHash('x')).toBe(promptHash('x'));
    expect(promptHash('x')).toHaveLength(16);
  });
});

describe('history hashing & divergence (spec §20)', () => {
  const m1: ChatMessage[] = [{ role: 'user', content: 'a' }];
  const m2: ChatMessage[] = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ];

  it('normalizeHistory is stable', () => {
    expect(normalizeHistory(m1)).toBe('user|a');
    expect(normalizeHistory(m2)).toBe('user|a\nassistant|b\nuser|c');
  });

  it('extension: new history starts with previous', () => {
    expect(isDeltaExtension('', normalizeHistory(m1))).toBe(true);
    expect(isDeltaExtension(normalizeHistory(m1), normalizeHistory(m2))).toBe(true);
  });

  it('compression/rewrite: divergence', () => {
    const compressed: ChatMessage[] = [{ role: 'system', content: 'summary' }, { role: 'user', content: 'new q' }];
    expect(isDeltaExtension(normalizeHistory(m2), normalizeHistory(compressed))).toBe(false);
  });

  it('shorter history is divergence', () => {
    expect(isDeltaExtension(normalizeHistory(m2), normalizeHistory(m1))).toBe(false);
  });

  it('same history is an extension (no change)', () => {
    expect(isDeltaExtension(normalizeHistory(m2), normalizeHistory(m2))).toBe(true);
  });
});

describe('context envelope (spec §21)', () => {
  it('excludes system instructions (Hermes owns agent context), keeps conversation + current request', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'First Q' },
      { role: 'assistant', content: 'First A' },
      { role: 'user', content: 'Current Q' },
    ];
    const env = buildEnvelope(messages);
    expect(env).toContain('[HERMES_CONTEXT v1]');
    expect(env).not.toContain('SYSTEM / DEVELOPER INSTRUCTIONS:');
    expect(env).not.toContain('You are a helpful assistant.');
    expect(env).toContain('CONVERSATION CONTEXT:');
    expect(env).toContain('User:');
    expect(env).toContain('First Q');
    expect(env).toContain('Assistant:');
    expect(env).toContain('First A');
    expect(env).toContain('CURRENT USER REQUEST:');
    expect(env).toContain('Current Q');
  });

  it('canonicalPrompt is the envelope', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'q' }];
    expect(canonicalPrompt(messages)).toBe(buildEnvelope(messages));
  });
});
