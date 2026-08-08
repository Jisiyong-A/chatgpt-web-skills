/**
 * Stable hashes for exactly-once + context synchronization (spec §17, §20).
 * request_hash identifies a Hermes request; history hashes detect divergence.
 */

import { createHash } from 'node:crypto';
import type { ChatMessage } from '../chatgpt/client.js';

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function shortHash(s: string): string {
  return sha256(s).slice(0, 16);
}

/** Stable identity of a Hermes request (session + generation + prompt). */
export function requestHash(hermesSessionId: string, generation: number, prompt: string): string {
  return sha256(`session=${hermesSessionId}|gen=${generation}|prompt=${prompt}`);
}

export function promptHash(prompt: string): string {
  return shortHash(prompt);
}

/**
 * Normalized serialization of a message list — the canonical history string.
 * SYSTEM messages are EXCLUDED: they are static agent configuration (and huge
 * in Hermes), not conversation turns. Including them would make every request
 * look divergent whenever the system prompt changes across tasks/sessions.
 */
export function normalizeHistory(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role}|${m.content}`)
    .join('\n');
}

/**
 * True when `newHistory` is `previousHistory` + a delta (spec §20).
 * Compression / rewind / branch / manual edit → false (divergence).
 */
export function isDeltaExtension(previousHistory: string, newHistory: string): boolean {
  if (!previousHistory) return true;
  if (newHistory.length < previousHistory.length) return false;
  return newHistory.startsWith(previousHistory);
}
