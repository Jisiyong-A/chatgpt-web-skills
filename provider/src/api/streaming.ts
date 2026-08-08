/**
 * Sentence-buffered streaming (spec §30).
 *
 * The ChatGPT webpage may rewrite DOM, replace partial text, switch
 * thinking/final components, inject citations, rerender message blocks —
 * raw token streaming would emit irreversible chunks for text that later
 * changes. Strategy: track an emission cursor over the full text; emit only
 * COMPLETED sentences (boundary = sentence-ending punctuation + trailing
 * whitespace, or a hard cap for very long sentences). Shrink or prefix
 * rewrites reset the cursor and emit nothing irreversible.
 */

export class SentenceBuffer {
  private emitted = 0; // chars of the stream already emitted
  private lastFull = ''; // last full text seen (for prefix-rewrite detection)
  private readonly maxChunkLen: number;

  constructor(opts: { maxChunkLen?: number } = {}) {
    this.maxChunkLen = opts.maxChunkLen ?? 240;
  }

  /** Characters still buffered but not yet emitted (for tail flushing). */
  get pendingLen(): number {
    return Math.max(0, this.lastFull.length - this.emitted);
  }

  /**
   * Feed the full current text; returns sentences that completed since the
   * last feed (as slices of the full text).
   */
  feed(fullText: string): string[] {
    // Shrink or prefix rewrite → the stream was re-rendered; emit nothing
    // irreversible and re-buffer from the current position.
    if (
      fullText.length < this.emitted ||
      !fullText.startsWith(this.lastFull.slice(0, this.emitted))
    ) {
      this.emitted = 0;
      this.lastFull = fullText;
      return [];
    }
    this.lastFull = fullText;

    const out: string[] = [];
    let cursor = this.emitted;
    // Boundaries: sentence punctuation + trailing whitespace, OR a newline
    // (newlines are also complete-chunk boundaries — without them short
    // replies like "联通\n" would never flush).
    const re = /(?:[.!?。！？；;]+\s*|\n)/g;
    re.lastIndex = cursor;
    let m: RegExpExecArray | null;
    while (cursor < fullText.length) {
      m = re.exec(fullText);
      if (!m) {
        // No completed sentence yet. Hard cap for very long sentences.
        if (fullText.length - cursor > this.maxChunkLen) {
          out.push(fullText.slice(cursor, cursor + this.maxChunkLen));
          cursor += this.maxChunkLen;
          continue;
        }
        break;
      }
      const end = re.lastIndex; // through trailing whitespace
      const chunkLen = end - cursor;
      if (chunkLen > this.maxChunkLen) {
        // A single gigantic sentence: force-split, keep remainder buffered.
        out.push(fullText.slice(cursor, cursor + this.maxChunkLen));
        cursor += this.maxChunkLen;
        re.lastIndex = cursor;
        continue;
      }
      out.push(fullText.slice(cursor, end));
      cursor = end;
    }
    this.emitted = cursor;
    return out;
  }
}

/** OpenAI-compatible SSE chunk bodies. */
export function chunkBody(args: {
  id: string;
  created: number;
  model: string;
  delta: {
    role?: 'assistant';
    content?: string;
    tool_calls?: Array<{ index: number; id: string; type: 'function'; function: { name: string; arguments: string } }>;
  };
  finish_reason: 'stop' | 'tool_calls' | null;
}): string {
  return JSON.stringify({
    id: args.id,
    object: 'chat.completion.chunk',
    created: args.created,
    model: args.model,
    choices: [
      {
        index: 0,
        delta: args.delta,
        finish_reason: args.finish_reason,
      },
    ],
  });
}
