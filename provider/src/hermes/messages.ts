/**
 * Context serialization envelope (spec §21).
 * The ChatGPT webpage exposes no system-message API, so Hermes canonical
 * context is serialized into a robust textual envelope when a fresh thread
 * is needed after divergence.
 */

import type { ChatMessage } from '../chatgpt/client.js';

export const ENVELOPE_VERSION = 'v1';

export function buildEnvelope(messages: ChatMessage[]): string {
  // SYSTEM messages are EXCLUDED from the envelope: Hermes is the canonical
  // owner of agent instructions; the web model only needs the conversation
  // turns. Including Hermes' multi-KB system prompt made fresh-thread
  // injection impractically slow and duplicated context (spec §22).
  const convo = messages.filter((m) => m.role !== 'system');
  const lastUser = [...convo].reverse().find((m) => m.role === 'user');

  const parts: string[] = [];
  parts.push(`[HERMES_CONTEXT ${ENVELOPE_VERSION}]`);

  parts.push('CONVERSATION CONTEXT:');
  for (const m of convo) {
    if (m === lastUser) continue; // emitted as CURRENT USER REQUEST below
    parts.push(`${m.role === 'user' ? 'User' : 'Assistant'}:`);
    parts.push(m.content);
    parts.push('');
  }

  parts.push('CURRENT USER REQUEST:');
  if (lastUser) parts.push(lastUser.content);

  return parts.join('\n').trim();
}

/** Prompt used for a fresh thread after divergence = the full envelope. */
export function canonicalPrompt(messages: ChatMessage[]): string {
  return buildEnvelope(messages);
}
