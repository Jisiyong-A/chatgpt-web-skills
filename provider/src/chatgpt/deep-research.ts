/**
 * Deep Research flow (mode=deep-research, 2026-08 extension).
 *
 * ⚠️ EXPERIMENTAL (2026-08-11): the Chat-view deep-research entry does NOT
 * currently start research on chatgpt.com — messages submit (thread created,
 * user message visible, mode chip stays active) but ChatGPT never responds
 * (no progress UI, no stop button). Verified 6× (adapter + manual), only 1
 * historical success (after a Chrome restart). Code is kept for when the
 * web UI recovers or for a Work-view adaptation.
 *
 * Activates the web UI's deep-research mode, submits the prompt, then waits
 * for the research report with a dual-channel completion detector (standard
 * message + body-text tail). Long timeout by design (25 min default).
 */

import type { Page } from 'playwright';
import { AdapterError } from './errors.js';
import { activateMode } from './composer-mode.js';
import { typeAndSubmit } from './flow-common.js';
import { snapshotConversation } from './conversation.js';
import { responseText } from './response.js';

export interface DeepResearchOptions {
  timeoutMs?: number; // total budget, default 1_500_000 (25 min — deep research is slow)
  stableMs?: number;  // text-stability threshold, default 20_000
  pollMs?: number;    // poll interval, default 5000
}

export interface DeepResearchResult {
  text: string;
  latencyMs: number;
  signals: string[];
}

/**
 * Deep research completion detection — dual channel:
 * 1. standard assistant message (responseElement path)
 * 2. body full-text tail after the user prompt (reports may render in
 *    non-standard containers; verified 2026-08-11 that the report exists in
 *    body text while data-message-author-role is empty)
 */
async function pollForReport(
  page: Page,
  prompt: string,
  opts: Required<Pick<DeepResearchOptions, 'timeoutMs' | 'stableMs' | 'pollMs'>>,
): Promise<DeepResearchResult> {
  const started = Date.now();
  const deadline = started + opts.timeoutMs;
  const before = await snapshotConversation(page);

  let lastTail = '';
  let stableSince = 0;
  const signals: string[] = [];

  while (Date.now() < deadline) {
    // Channel 1: standard assistant message.
    const std = await responseText(page, before).catch(() => null);
    if (std && std.trim().length > 100) {
      return { text: std.trim(), latencyMs: Date.now() - started, signals: [...signals, 'standard_message'] };
    }
    // Channel 2: body text tail after the user prompt (deep-research reports
    // may render outside standard message containers).
    const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const idx = body.lastIndexOf(prompt);
    const tail = idx >= 0 ? body.slice(idx + prompt.length) : '';
    if (tail.trim().length > 200) {
      if (tail === lastTail) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= opts.stableMs) {
          signals.push(`body_tail_stable_${Date.now() - stableSince}ms`);
          return { text: tail.trim(), latencyMs: Date.now() - started, signals };
        }
      } else {
        stableSince = 0;
      }
      lastTail = tail;
    } else {
      stableSince = 0;
    }
    await page.waitForTimeout(opts.pollMs);
  }

  const tailLen = lastTail.trim().length;
  throw AdapterError.generationTimeout(
    `deep research did not complete within ${opts.timeoutMs}ms (report_tail=${tailLen} chars)`,
  );
}

export async function runDeepResearch(
  page: Page,
  prompt: string,
  opts: DeepResearchOptions = {},
): Promise<DeepResearchResult> {
  await activateMode(page, 'deep-research');
  await typeAndSubmit(page, prompt);
  const result = await pollForReport(page, prompt, {
    timeoutMs: opts.timeoutMs ?? 1_500_000,
    stableMs: opts.stableMs ?? 20_000,
    pollMs: opts.pollMs ?? 5000,
  });
  if (result.text.trim().length === 0) {
    throw AdapterError.generationTimeout('deep research completed with empty report');
  }
  return result;
}
