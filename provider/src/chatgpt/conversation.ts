/**
 * Conversation snapshot & message pairing (spec §16).
 * Before submission we record counts + last-message hash. After submission
 * the response is the assistant message that appears after our user message —
 * never just "the last assistant element on the page".
 *
 * Message roles are classified semantically: data-message-author-role
 * attribute, OR a nested element carrying it, OR class-name hints. This keeps
 * pairing working across DOM variants without hard-coded single selectors.
 */

import type { Locator, Page } from 'playwright';
import { createHash } from 'node:crypto';

export interface MessageInfo {
  role: 'user' | 'assistant' | null;
}

export interface ConversationSnapshot {
  userCount: number;
  assistantCount: number;
  lastMessageHash: string;
  messageSelector: string;
}

export const MESSAGE_SELECTORS = [
  '[data-message-author-role]',
  '[data-testid="conversation-turn"]',
  'article[data-testid]',
  '.message.user, .message.assistant',
  '[class$="-user"], [class$="-assistant"]', // e.g. "convo-user" (suffix-safe)
];

function hashText(t: string): string {
  return createHash('sha256').update(t).digest('hex').slice(0, 16);
}

async function collectMessages(page: Page): Promise<MessageInfo[]> {
  const loc = page.locator(MESSAGE_SELECTORS.join(', '));
  const roles = (await loc
    .evaluateAll((els) =>
      els.map((el) => {
        const e = el as HTMLElement;
        const direct = e.getAttribute('data-message-author-role');
        if (direct === 'user' || direct === 'assistant') return direct;
        const inner = e.querySelector('[data-message-author-role]');
        if (inner) {
          const r = inner.getAttribute('data-message-author-role');
          if (r === 'user' || r === 'assistant') return r;
        }
        const cls = typeof e.className === 'string' ? e.className : '';
        if (/\buser\b/i.test(cls)) return 'user';
        if (/\bassistant\b/i.test(cls)) return 'assistant';
        return null;
      }),
    )
    .catch(() => [])) as Array<'user' | 'assistant' | null>;
  return roles.map((role) => ({ role }));
}

export async function snapshotConversation(page: Page): Promise<ConversationSnapshot> {
  const messages = await collectMessages(page);
  const userCount = messages.filter((m) => m.role === 'user').length;
  const assistantCount = messages.filter((m) => m.role === 'assistant').length;
  let lastMessageHash = '';
  if (messages.length > 0) {
    const last = page.locator(MESSAGE_SELECTORS.join(', ')).nth(messages.length - 1);
    const text = await last
      .evaluate((el) => (el as HTMLElement).innerText ?? '')
      .catch(() => '');
    if (text) lastMessageHash = hashText(text);
  }
  return { userCount, assistantCount, lastMessageHash, messageSelector: MESSAGE_SELECTORS.join(', ') };
}

/** Wait until a new user message exists beyond the snapshot. */
export async function waitForNewUserMessage(
  page: Page,
  before: ConversationSnapshot,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await collectMessages(page);
    if (messages.filter((m) => m.role === 'user').length > before.userCount) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** The assistant response paired to our submission: the newest assistant message. */
export async function responseElement(
  page: Page,
  before: ConversationSnapshot,
): Promise<Locator | null> {
  const messages = await collectMessages(page);
  const assistantIdx: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'assistant') assistantIdx.push(i);
  });
  if (assistantIdx.length <= before.assistantCount) return null;
  const idx = assistantIdx[before.assistantCount]!;
  return page.locator(MESSAGE_SELECTORS.join(', ')).nth(idx);
}

export function hashOf(t: string): string {
  return hashText(t);
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Find the DOM index (in MESSAGE_SELECTORS order) of the user message whose
 * text matches `promptText`. Searches newest-first. Used for restart resume
 * and hash-based pairing (spec §16).
 */
export async function findUserMessageIndex(page: Page, promptText: string): Promise<number | null> {
  const messages = await collectMessages(page);
  if (messages.length === 0) return null;
  const loc = page.locator(MESSAGE_SELECTORS.join(', '));
  const wanted = normalizeText(promptText);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role !== 'user') continue;
    const text = await loc
      .nth(i)
      .evaluate((el) => (el as HTMLElement).innerText ?? '')
      .catch(() => '');
    if (wanted && normalizeText(text).includes(wanted.slice(0, 200))) return i;
  }
  return null;
}

/** Snapshot of the thread state BEFORE the message at msgIndex (for resume). */
export async function snapshotUpTo(page: Page, msgIndex: number): Promise<ConversationSnapshot> {
  const messages = await collectMessages(page);
  const before = messages.slice(0, msgIndex);
  const userCount = before.filter((m) => m.role === 'user').length;
  const assistantCount = before.filter((m) => m.role === 'assistant').length;
  let lastMessageHash = '';
  if (msgIndex > 0) {
    const loc = page.locator(MESSAGE_SELECTORS.join(', ')).nth(msgIndex - 1);
    const text = await loc
      .evaluate((el) => (el as HTMLElement).innerText ?? '')
      .catch(() => '');
    if (text) lastMessageHash = hashText(text);
  }
  return { userCount, assistantCount, lastMessageHash, messageSelector: MESSAGE_SELECTORS.join(', ') };
}
