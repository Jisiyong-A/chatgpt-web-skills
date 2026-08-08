/**
 * Response completion detection (spec §15, §16).
 * Quorum logic: text stable for >= stableMs AND at least one additional
 * generation-complete signal (stop control gone / response exists). No
 * blind sleeps; all timeouts configurable.
 */

import type { Page } from 'playwright';
import TurndownService from 'turndown';
import { AdapterError } from './errors.js';
import {
  responseElement,
  type ConversationSnapshot,
} from './conversation.js';

const turndown = new TurndownService({ codeBlockStyle: 'fenced' });

export interface ResponseOutcome {
  text: string;
  stabilityMs: number;
  signals: string[];
  latencyMs: number;
}

/** Strip thinking / tool / chrome noise before extraction. */
function cleanHtml(html: string): string {
  return html
    .replace(/<div[^>]*class="[^"]*thinking[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*data-state="draft"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*class="[^"]*generating[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<button[\s\S]*?<\/button>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '');
}

/**
 * Extract a response message: tool-protocol envelopes (JSON payloads) bypass
 * markdown conversion entirely — turndown would escape underscores etc. and
 * corrupt the JSON. Body text goes through markdown as usual.
 */
async function extractResponseParts(
  page: Page,
  el: import('playwright').Locator,
): Promise<{ bodyMarkdown: string; envelopes: Array<{ tag: string; raw: string }> } | null> {
  const parts = await el
    .evaluate((node) => {
      const clone = (node as HTMLElement).cloneNode(true) as HTMLElement;
      const envEls = Array.from(clone.querySelectorAll('hermes_tool_call, hermes_tool_result'));
      const envelopes: Array<{ tag: string; raw: string }> = [];
      for (const e of envEls) {
        const tag = e.tagName.toLowerCase();
        const raw = (e.textContent ?? '').trim();
        if (raw) envelopes.push({ tag, raw });
        e.remove();
      }
      return { body: clone.innerHTML, envelopes };
    })
    .catch(() => null);
  if (!parts) return null;
  const bodyMarkdown = turndown.turndown(cleanHtml(parts.body)).trim();
  return { bodyMarkdown, envelopes: parts.envelopes };
}

function assembleResponse(parts: { bodyMarkdown: string; envelopes: Array<{ tag: string; raw: string }> }): string {
  const envText = parts.envelopes
    .map((e) => `<${e.tag.toUpperCase()}>\n${e.raw}\n</${e.tag.toUpperCase()}>`)
    .join('\n');
  return [parts.bodyMarkdown, envText].filter(Boolean).join('\n');
}

export async function responseText(page: Page, before: ConversationSnapshot): Promise<string | null> {
  const el = await responseElement(page, before);
  if (!el) return null;
  const html = await el.evaluate((node) => (node as HTMLElement).innerHTML ?? '').catch(() => '');
  if (!html) return null;
  if (/hermes_tool_call|hermes_tool_result/i.test(html)) {
    const parts = await extractResponseParts(page, el);
    if (!parts) return null;
    return assembleResponse(parts);
  }
  const markdown = turndown.turndown(cleanHtml(html)).trim();
  return markdown || null;
}

/**
 * Submit candidates must never include the STOP control: during generation
 * ChatGPT replaces the send button with a stop button; clicking it would
 * cancel the response. Filtered at collection time (spec §8).
 */
export const STOP_BUTTON_SELECTOR =
  '[data-testid="stop-button"], button[aria-label*="stop" i], button[aria-label*="停止" i], button[aria-label*="Stop" i]';

export async function stopControlVisible(page: Page): Promise<boolean> {
  const sel = '[data-testid="stop-button"], button[aria-label*="stop" i]';
  const n = await page.locator(sel).count().catch(() => 0);
  return n > 0;
}

export interface WaitForResponseOptions {
  timeoutMs: number;
  stableMs: number;
  pollMs?: number;
  /** If a response times out and one of these markers is on the page, report CHATGPT_UNAVAILABLE. */
  serverErrorMarkers?: string[];
  /** Called with the current full text on every poll (used by streaming). */
  onSample?: (text: string) => void;
}

const DEFAULT_SERVER_ERROR_MARKERS = [
  'something went wrong',
  'server error',
  'unexpected error',
  'please try again',
];

/**
 * Wait for generation completion.
 * COMPLETED when: response text stable >= stableMs AND (stop control has
 * disappeared, or it was never present). Timeout → GENERATION_TIMEOUT.
 */
export async function waitForResponse(
  page: Page,
  before: ConversationSnapshot,
  opts: WaitForResponseOptions,
): Promise<ResponseOutcome> {
  const { timeoutMs, stableMs, pollMs = 300 } = opts;
  const started = Date.now();
  const deadline = started + timeoutMs;

  let lastText: string | null = null;
  let stableSince = 0;
  let stopSeen = false;
  let sawResponse = false;
  const signals: string[] = [];

  while (Date.now() < deadline) {
    const text = await responseText(page, before).catch(() => null);
    if (text === null) {
      if (await stopControlVisible(page)) stopSeen = true;
      await page.waitForTimeout(pollMs);
      continue;
    }
    sawResponse = true;
    if (await stopControlVisible(page)) stopSeen = true;
    opts.onSample?.(text);

    if (text === lastText) {
      if (stableSince === 0) stableSince = Date.now();
      const elapsedStable = Date.now() - stableSince;
      const stopGone = !(await stopControlVisible(page));
      const additionalSignal = stopSeen ? stopGone : true; // never saw stop → nothing to wait for
      if (elapsedStable >= stableMs && additionalSignal && sawResponse) {
        signals.push(`stable_${elapsedStable}ms`);
        if (stopSeen) signals.push('stop_control_gone');
        return { text, stabilityMs: elapsedStable, signals, latencyMs: Date.now() - started };
      }
    } else {
      lastText = text;
      stableSince = 0;
    }
    await page.waitForTimeout(pollMs);
  }

  const markers = opts.serverErrorMarkers ?? DEFAULT_SERVER_ERROR_MARKERS;
  const body = await page
    .evaluate(() => (document.body ? document.body.innerText.toLowerCase() : ''))
    .catch(() => '');
  const hit = markers.find((m) => body.includes(m.toLowerCase()));
  if (hit) {
    throw new AdapterError(
      'CHATGPT_UNAVAILABLE',
      `ChatGPT reported a server-side error while generating ("${hit}")`,
    );
  }
  throw AdapterError.generationTimeout(
    `response did not complete within ${timeoutMs}ms (saw_response=${sawResponse}, stop_seen=${stopSeen})`,
  );
}
