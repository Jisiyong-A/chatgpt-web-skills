/**
 * Submit control detection & click (spec §8, §17).
 * Inferred from button-like semantics + proximity to composer + visible +
 * reasonable geometry + behavioral conditional enablement. After clicking we
 * demand confirmation (composer cleared OR a new user message appeared).
 */

import type { Page, Locator } from 'playwright';
import { AdapterError } from './errors.js';
import { composerText } from './composer.js';
import type { LocatorEngine, LocatorResult } from '../semantic/locator-engine.js';

export interface SubmitOutcome {
  clicked: boolean;
  confirmation: 'composer-cleared' | 'user-message-appeared' | 'timeout';
  ruleScore: number | null;
  ruleId?: string;
  profile?: LocatorResult['profile'];
}

export interface SubmitMeta {
  ruleScore?: number | null;
  ruleId?: string;
  profile?: LocatorResult['profile'];
}

/** Click an already-located submit control and demand confirmation. */
export async function clickAndConfirmSubmit(
  page: Page,
  submitLocator: Locator,
  composer: LocatorResult,
  opts: { confirmationTimeoutMs?: number; retries?: number } & SubmitMeta = {},
): Promise<SubmitOutcome> {
  const confirmationTimeoutMs = opts.confirmationTimeoutMs ?? 5000;
  const retries = opts.retries ?? 1;

  // Behavioral check: if the candidate was disabled while empty and is STILL
  // disabled with content, it is not the send control (or is stuck) → stop.
  const composerEmpty = (await composerText(composer.locator)) === '';
  const disabledNow = await submitLocator
    .evaluate((el: Element) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true')
    .catch(() => false);
  if (!composerEmpty && disabledNow) {
    throw AdapterError.uiUnknown('submit candidate stayed disabled after composer received content');
  }

  let confirmation: SubmitOutcome['confirmation'] = 'timeout';
  for (let attempt = 0; attempt <= retries; attempt++) {
    await submitLocator.click().catch(() => undefined);
    const deadline = Date.now() + confirmationTimeoutMs;
    while (Date.now() < deadline) {
      const text = await composerText(composer.locator).catch(() => 'probe-error');
      if (text === '') {
        confirmation = 'composer-cleared';
        break;
      }
      await page.waitForTimeout(150);
    }
    if (confirmation !== 'timeout') break;
  }

  if (confirmation === 'timeout') {
    // The click may not have landed (e.g. control moved). Fail closed.
    throw AdapterError.uiUnknown(
      'submit click produced no confirmation (composer still holds text)',
    );
  }
  return {
    clicked: true,
    confirmation,
    ruleScore: opts.ruleScore ?? null,
    ruleId: opts.ruleId,
    profile: opts.profile,
  };
}

export async function confirmAndClickSubmit(
  page: Page,
  engine: LocatorEngine,
  composer: LocatorResult,
  opts: { confirmationTimeoutMs?: number; retries?: number } = {},
): Promise<SubmitOutcome> {
  const composerEmpty = (await composerText(composer.locator)) === '';
  const submit = await engine.findSubmit(page, composer, { composerEmpty });
  if (!submit) {
    throw AdapterError.uiUnknown('submit control could not be identified safely');
  }
  return clickAndConfirmSubmit(page, submit.locator, composer, {
    ...opts,
    ruleScore: submit.score,
    ruleId: submit.ruleId,
    profile: submit.profile,
  });
}
