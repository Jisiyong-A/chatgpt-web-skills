/**
 * Fresh thread creation after context divergence (spec §20, §22).
 * Semantic detection of the "New chat" control: hint selectors first, then
 * text + geometry (left sidebar). Validation: composer empty AND conversation
 * cleared; otherwise fail closed (UI_UNKNOWN).
 */

import type { Page } from 'playwright';
import { AdapterError } from './errors.js';
import { composerText } from './composer.js';
import { MESSAGE_SELECTORS } from './conversation.js';

const NEW_CHAT_HINTS = [
  '[data-testid="create-new-chat-button"]', // current ChatGPT (2026)
  '[data-testid="new-chat-button"]',
  'button[aria-label="New chat" i]',
  'a[aria-label="New chat" i]',
  'button[aria-label="新建对话" i]',
  'button[aria-label="新聊天" i]',
];

// Exact whole-string matches only: substring matches hit sidebar history
// actions like "取消置顶 New chat" (unpin button) and would clear nothing.
const NEW_CHAT_TEXT_RE = /^new chat$/i;
const NEW_CHAT_CN_RE = /^(新(建)?对话|新(建)?会话|新聊天|开始新对话)$/;
const PIN_EXCLUDE_RE = /置顶|取消|unpin|cancel/i;

export async function findNewChatControl(page: Page): Promise<{ locator: import('playwright').Locator; score: number } | null> {
  for (const sel of NEW_CHAT_HINTS) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (n > 0) {
      const loc = page.locator(sel).nth(0);
      const visible = await loc
        .evaluate((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .catch(() => false);
      if (visible) return { locator: loc, score: 0.95 };
    }
  }
  // Semantic fallback: visible button in the left region whose text matches
  // exactly (never a substring of pin/unpin actions).
  const buttons = page.locator('button, [role="button"], a');
  const count = Math.min(await buttons.count().catch(() => 0), 80);
  let best: { locator: import('playwright').Locator; score: number } | null = null;
  for (let i = 0; i < count; i++) {
    const loc = buttons.nth(i);
    const info = await loc
      .evaluate((el) => {
        const n = el as HTMLElement;
        const r = n.getBoundingClientRect();
        return {
          text: (n.innerText ?? '').trim().slice(0, 60),
          visible: r.width > 0 && r.height > 0,
          leftThird: r.x < window.innerWidth * 0.4,
          aria: n.getAttribute('aria-label') ?? '',
        };
      })
      .catch(() => null);
    if (!info || !info.visible || !info.leftThird) continue;
    if (PIN_EXCLUDE_RE.test(info.text) || PIN_EXCLUDE_RE.test(info.aria)) continue;
    const text = info.text.trim();
    const aria = info.aria.trim();
    if (NEW_CHAT_TEXT_RE.test(text) || NEW_CHAT_TEXT_RE.test(aria) || NEW_CHAT_CN_RE.test(text) || NEW_CHAT_CN_RE.test(aria)) {
      best = { locator: loc, score: 0.9 };
      break;
    }
  }
  return best;
}

export async function startFreshThread(page: Page, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const control = await findNewChatControl(page);
  if (!control) {
    throw AdapterError.uiUnknown('new-chat control could not be identified safely');
  }
  // Real-world ChatGPT: the sidebar may be COLLAPSED (button off-viewport,
  // x < 0) and covered by an overlay, so Playwright actionability clicks
  // hang or land on the wrong layer. A DOM click dispatches directly to the
  // element's React handler and works regardless of visibility.
  await control.locator.evaluate((el) => (el as HTMLElement).click());
  // If the DOM click did not register (e.g. custom component), retry with a
  // forced real click as a fallback.
  const probeCount = await page
    .locator(MESSAGE_SELECTORS.join(', '))
    .count()
    .catch(() => -1);
  if (probeCount > 0) {
    await control.locator.click({ force: true, timeout: 3000 }).catch(() => undefined);
  }
  // Validation: composer present & empty, conversation cleared.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.locator(MESSAGE_SELECTORS.join(', ')).count().catch(() => 999);
    const composer = await page
      .locator('#prompt-textarea, [contenteditable="true"], textarea')
      .first()
      .evaluate((el) => (el as HTMLElement).innerText ?? '')
      .catch(() => 'x');
    if (count === 0 && composer === '') {
      return; // fresh thread confirmed
    }
    await page.waitForTimeout(300);
  }
  throw AdapterError.uiUnknown('new-chat click did not produce an empty conversation');
}

export async function composerTextForFreshThread(page: Page): Promise<string> {
  const loc = page
    .locator('#prompt-textarea, [contenteditable="true"], textarea')
    .first();
  return composerText(loc);
}
