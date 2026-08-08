import { describe, expect, it } from 'vitest';
import { SentenceBuffer, chunkBody } from '../../src/api/streaming.js';

describe('SentenceBuffer (spec §30)', () => {
  it('emits only completed sentences', () => {
    const buf = new SentenceBuffer();
    expect(buf.feed('Hello')).toEqual([]); // incomplete
    expect(buf.feed('Hello world.')).toEqual(['Hello world.']);
    expect(buf.feed('Hello world.Next')).toEqual([]); // new incomplete
    expect(buf.feed('Hello world.Next part!')).toEqual(['Next part!']);
  });

  it('handles multiple sentences in one feed', () => {
    const buf = new SentenceBuffer();
    expect(buf.feed('One. Two! Three?')).toEqual(['One. ', 'Two! ', 'Three?']);
  });

  it('buffers the tail until the sentence completes', () => {
    const buf = new SentenceBuffer();
    buf.feed('Par');
    buf.feed('Partial sent');
    const out = buf.feed('Partial sentence ends.');
    expect(out).toEqual(['Partial sentence ends.']);
  });

  it('force-splits very long sentences at the cap; tail flushes on completion', () => {
    const buf = new SentenceBuffer({ maxChunkLen: 20 });
    const long = 'a'.repeat(50);
    const out = buf.feed(long);
    expect(out.join('').length).toBe(40); // two capped chunks; 10 chars buffered
    const final = buf.feed(`${long}.`);
    expect(final.join('')).toBe('a'.repeat(10) + '.'); // buffered tail + boundary
    expect(final.join('')).toHaveLength(11);
  });

  it('text shrink (DOM rewrite) resets the tail without emitting garbage', () => {
    const buf = new SentenceBuffer();
    buf.feed('This is a long sentence that will be rewritten');
    const out = buf.feed('Shorter');
    expect(out).toEqual([]); // nothing irreversible emitted
  });

  it('newline is a complete-chunk boundary (short replies flush)', () => {
    const buf = new SentenceBuffer();
    expect(buf.feed('联通')).toEqual([]);
    expect(buf.feed('联通\n')).toEqual(['联通\n']);
  });

  it('prefix rewrite emits nothing irreversible (conservative)', () => {
    const buf = new SentenceBuffer();
    buf.feed('A. B');
    const out = buf.feed('X. B');
    expect(out).toEqual([]); // rewritten stream → silent re-buffer
  });
});

describe('chunkBody', () => {
  it('produces OpenAI SSE chunk JSON', () => {
    const s = chunkBody({ id: 'i1', created: 1, model: 'm', delta: { content: 'hi' }, finish_reason: null });
    const o = JSON.parse(s);
    expect(o.object).toBe('chat.completion.chunk');
    expect(o.choices[0].delta).toEqual({ content: 'hi' });
    expect(o.choices[0].finish_reason).toBeNull();
  });
});
