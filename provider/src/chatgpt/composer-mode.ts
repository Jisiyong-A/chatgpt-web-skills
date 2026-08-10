/**
 * Composer mode management: default / deep-research / image (2026-08 extension).
 *
 * New ChatGPT UI: modes are activated through the composer "+" menu (Radix):
 *   - deep-research: "+" → "更多" → "深度研究"
 *   - image:         "+" → "创建图片"
 * After activation the composer footer shows the mode chip
 * (`[data-testid="composer-footer-actions"]`) — sticky until changed.
 *
 * Fail-closed on any ambiguity: unknown/ambiguous state → UI_UNKNOWN.
 */

import type { Page } from 'playwright';
import { AdapterError } from './errors.js';

export type ComposerMode = 'default' | 'deep-research' | 'image';

export const COMPOSER_PLUS_BTN = '[data-testid="composer-plus-btn"]';
export const COMPOSER_FOOTER_ACTIONS = '[data-testid="composer-footer-actions"]';

const MODE_MENU: Record<Exclude<ComposerMode, 'default'>, { main: string; sub?: string }> = {
  'deep-research': { main: '更多', sub: '深度研究' },
  image: { main: '创建图片' },
};

const MODE_FOOTER_RE: Record<Exclude<ComposerMode, 'default'>, RegExp> = {
  'deep-research': /深度研究/,
  image: /图片/,
};

/** Click the first visible element with `role` whose text exactly matches `text`. */
async function clickMenuByText(
  page: Page,
  role: string,
  text: string,
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const re = new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const loc = page.locator(`[role="${role}"]`).filter({ hasText: re }).first();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await loc.count()) {
      await loc
        .click({ force: true, timeout: 4000 })
        .catch(() => undefined);
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/** Detect the currently active composer mode from the footer chip. */
export async function detectActiveMode(page: Page): Promise<ComposerMode> {
  const footer = page.locator(COMPOSER_FOOTER_ACTIONS).first();
  if (!(await footer.count())) return 'default';
  const text = (await footer.innerText().catch(() => '')) || '';
  if (MODE_FOOTER_RE['deep-research'].test(text)) return 'deep-research';
  if (MODE_FOOTER_RE.image.test(text)) return 'image';
  return 'default';
}

/**
 * Ensure the Chat view (not the Work view). All mode flows operate in the
 * chat composer only — never the work/tasks view. If the "工作" radio is
 * checked, click "聊天" and wait for the composer to come back.
 */
export async function ensureChatView(page: Page, timeoutMs = 10_000): Promise<void> {
  const radios = page.locator('[role="radio"]');
  const n = Math.min(await radios.count().catch(() => 0), 10);
  let workChecked = false;
  for (let i = 0; i < n; i++) {
    const r = radios.nth(i);
    const text = (await r.innerText().catch(() => '')).trim();
    const checked = await r.getAttribute('aria-checked').catch(() => null);
    if (/^工作$/.test(text) && (checked === 'true' || checked === 'checked')) {
      workChecked = true;
      break;
    }
  }
  if (!workChecked) return;
  const chat = page.locator('[role="radio"]', { hasText: /^聊天$/ }).first();
  if (await chat.count()) {
    await chat.click({ force: true, timeout: 4000 }).catch(() => undefined);
  }
  // Wait for the composer to return (chat view is active again).
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const c = await page.locator('#prompt-textarea, [contenteditable="true"]').count().catch(() => 0);
    if (c > 0) return;
    await page.waitForTimeout(300);
  }
  throw AdapterError.uiUnknown('could not return to chat view');
}

/** Wait until the footer chip reflects `mode`. */
export async function waitForModeActive(
  page: Page,
  mode: Exclude<ComposerMode, 'default'>,
  timeoutMs = 10_000,
): Promise<void> {
  const re = MODE_FOOTER_RE[mode];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const footer = page.locator(COMPOSER_FOOTER_ACTIONS).first();
    if (await footer.count()) {
      const text = (await footer.innerText().catch(() => '')) || '';
      if (re.test(text)) return;
    }
    await page.waitForTimeout(300);
  }
  throw AdapterError.uiUnknown(`composer mode "${mode}" did not activate within ${timeoutMs}ms`);
}

/**
 * Activate a composer mode. Idempotent: if the mode is already active, no-op.
 * Throws UI_UNKNOWN (fail-closed) if any menu step cannot be identified.
 */
export async function activateMode(
  page: Page,
  mode: ComposerMode,
  opts: { timeoutMs?: number } = {},
): Promise<void> {
  if (mode === 'default') return;
  // All mode flows run in the Chat view only — never the Work view.
  await ensureChatView(page, opts.timeoutMs ?? 10_000);
  if ((await detectActiveMode(page)) === mode) return;

  const spec = MODE_MENU[mode];
  const plus = page.locator(COMPOSER_PLUS_BTN).first();
  if (!(await plus.count())) {
    throw AdapterError.uiUnknown('composer plus button not found');
  }
  await plus.click({ force: true, timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  if (spec.sub) {
    const more = await clickMenuByText(page, 'menuitem', spec.main);
    if (!more) throw AdapterError.uiUnknown('composer "+ 更多" menu item not found');
    await page.waitForTimeout(800);
    const target = await clickMenuByText(page, 'menuitemradio', spec.sub);
    if (!target) throw AdapterError.uiUnknown(`composer mode item "${spec.sub}" not found`);
  } else {
    const target = await clickMenuByText(page, 'menuitemradio', spec.main);
    if (!target) throw AdapterError.uiUnknown(`composer mode item "${spec.main}" not found`);
  }

  await waitForModeActive(page, mode, opts.timeoutMs ?? 10_000);
}

/**
 * Restore the composer to default mode. The footer mode chip is sticky;
 * the reliable reset is a same-URL reload (composer state resets on load).
 * Used before default-mode requests when a non-default mode is active.
 */
export async function restoreDefaultMode(page: Page, timeoutMs = 20_000): Promise<void> {
  const current = await detectActiveMode(page);
  if (current === 'default') return;
  const url = page.url();
  await page
    .goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    .catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const footer = page.locator(COMPOSER_FOOTER_ACTIONS).first();
    if (!(await footer.count())) return;
    await page.waitForTimeout(300);
  }
  throw AdapterError.uiUnknown('composer mode could not be reset to default');
}
