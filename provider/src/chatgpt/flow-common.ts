/**
 * Shared helpers for the mode flows (deep-research / image).
 * Composer location & submit use hint selectors with fail-closed semantics —
 * these flows are new paths, kept deliberately simpler than the main
 * locator-engine pipeline (which remains the default-mode path).
 */

import type { Page } from 'playwright';
import { AdapterError } from './errors.js';
import { clearComposer, composerText, typeIntoComposer } from './composer.js';
import { snapshotConversation, waitForNewUserMessage } from './conversation.js';

const COMPOSER_HINTS = ['#prompt-textarea', '[contenteditable="true"]', 'textarea'];
const SEND_BTN = '[data-testid="send-button"]';

export async function locateComposer(page: Page): Promise<import('playwright').Locator> {
  for (const hint of COMPOSER_HINTS) {
    const loc = page.locator(hint).first();
    if (await loc.count()) return loc;
  }
  throw AdapterError.uiUnknown('composer not found (mode flow)');
}

/**
 * Type the prompt and submit via the send button, demanding confirmation
 * (composer cleared) + a new user message, mirroring the main pipeline.
 */
export async function typeAndSubmit(
  page: Page,
  prompt: string,
  opts: { confirmationMs?: number; userMsgMs?: number } = {},
): Promise<void> {
  const composer = await locateComposer(page);
  await clearComposer(composer);
  const typed = await typeIntoComposer(page, composer, prompt);
  if (!typed.ok) {
    throw AdapterError.uiUnknown(`composer insertion failed (${typed.verification})`);
  }
  const before = await snapshotConversation(page);

  const send = page.locator(SEND_BTN).first();
  if (!(await send.count())) {
    throw AdapterError.uiUnknown('send button not found (mode flow)');
  }
  await send.click({ force: true, timeout: 5000 }).catch(() => undefined);

  const confirmDeadline = Date.now() + (opts.confirmationMs ?? 8000);
  let confirmed = false;
  while (Date.now() < confirmDeadline) {
    const t = await composerText(composer).catch(() => '');
    if (t === '') { confirmed = true; break; }
    await page.waitForTimeout(200);
  }
  if (!confirmed) {
    throw AdapterError.uiUnknown('submit produced no confirmation (composer still holds text)');
  }
  const userMsgSeen = await waitForNewUserMessage(page, before, opts.userMsgMs ?? 10_000);
  if (!userMsgSeen) {
    throw AdapterError.uiUnknown('user message not confirmed after submit (mode flow)');
  }
}
