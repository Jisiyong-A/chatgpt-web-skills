/**
 * Composer interaction (spec §7, §10, §13).
 * Insertion with verification — never send blindly. A nonce probe is used
 * during candidate validation; normal typing verifies the text round-trip.
 */

import type { Locator, Page } from 'playwright';

export interface ComposerInputResult {
  ok: boolean;
  verification: 'text-match' | 'length-match' | 'failed';
  typedLength: number;
  observedLength: number;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export async function composerText(locator: Locator): Promise<string> {
  return locator
    .evaluate((el) => {
      const n = el as HTMLElement;
      return n.isContentEditable ? (n.innerText ?? '') : ((n as HTMLTextAreaElement).value ?? '');
    })
    .catch(() => '');
}

export async function typeIntoComposer(
  page: Page,
  locator: Locator,
  text: string,
): Promise<ComposerInputResult> {
  await locator.click().catch(() => undefined);
  await locator.focus().catch(() => undefined);

  // Primary: insertText (contenteditable-safe). Fallback: sequential keys.
  await page.keyboard.insertText(text).catch(() => undefined);
  let observed = await composerText(locator);
  let verification: ComposerInputResult['verification'] = 'failed';

  if (normalize(observed).includes(normalize(text))) {
    verification = 'text-match';
  } else if (normalize(observed).length >= normalize(text).length * 0.9) {
    verification = 'length-match';
  } else {
    // Fallback path: press sequentially (handles DOM quirks).
    await locator.pressSequentially(text, { delay: 4 }).catch(() => undefined);
    observed = await composerText(locator);
    if (normalize(observed).includes(normalize(text))) {
      verification = 'text-match';
    } else if (normalize(observed).length >= normalize(text).length * 0.9) {
      verification = 'length-match';
    }
  }

  return {
    ok: verification !== 'failed',
    verification,
    typedLength: normalize(text).length,
    observedLength: normalize(observed).length,
  };
}

export async function clearComposer(locator: Locator): Promise<void> {
  await locator.evaluate((el) => {
    const n = el as HTMLElement;
    if (n.isContentEditable) {
      n.innerText = '';
    } else {
      (n as HTMLTextAreaElement).value = '';
    }
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }).catch(() => undefined);
}

/** Nonce probe used for candidate validation (§13). Never submits the nonce. */
export async function validateComposerCandidate(
  page: Page,
  locator: Locator,
): Promise<{ valid: boolean; reason: string }> {
  const nonce = `__adapter_probe_${Date.now()}_${Math.floor(Math.random() * 1e6)}__`;
  const typed = await typeIntoComposer(page, locator, nonce);
  if (!typed.ok) return { valid: false, reason: `insertion failed (${typed.verification})` };
  const observed = await composerText(locator);
  if (!observed.includes(nonce)) return { valid: false, reason: 'nonce not present in composer' };
  await clearComposer(locator);
  const after = await composerText(locator);
  if (after.length !== 0) return { valid: false, reason: 'composer not empty after clearing' };
  return { valid: true, reason: 'nonce round-trip ok' };
}
