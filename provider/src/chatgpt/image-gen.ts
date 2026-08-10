/**
 * Image generation flow (mode=image, 2026-08 extension).
 *
 * Activates the web UI's image mode ("创建图片"), submits the prompt, then
 * polls for generated <img> elements until the set is stable. https URLs are
 * returned as-is; blob: URLs are converted to base64 data URLs in-page.
 */

import type { Page } from 'playwright';
import { AdapterError } from './errors.js';
import { activateMode } from './composer-mode.js';
import { typeAndSubmit } from './flow-common.js';

export interface ImageGenOptions {
  timeoutMs?: number; // total budget, default 300_000 (5 min)
  pollMs?: number;    // poll interval, default 3000
  stableMs?: number;  // image-set stability threshold, default 8000
  minImages?: number; // required minimum, default 1
}

export interface ImageGenResult {
  text: string;
  images: string[];
  latencyMs: number;
}

/** Collect large visible <img> srcs from the conversation area. */
async function collectImageSrcs(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const img of document.querySelectorAll('img[src]')) {
        const src = img.getAttribute('src') || '';
        const r = img.getBoundingClientRect();
        if (r.width > 50 && r.height > 50 && !seen.has(src)) {
          seen.add(src);
          out.push(src);
        }
      }
      return out;
    })
    .catch(() => []);
}

/** Convert blob: URLs to base64 data URLs (in-page fetch). */
async function toDataUrl(page: Page, blobUrl: string): Promise<string> {
  return page
    .evaluate(async (u) => {
      try {
        const resp = await fetch(u);
        const blob = await resp.blob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 8192) {
          bin += String.fromCharCode(...buf.subarray(i, i + 8192));
        }
        return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
      } catch {
        return '';
      }
    }, blobUrl)
    .catch(() => '');
}

async function resolveImages(page: Page, srcs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of srcs) {
    if (s.startsWith('blob:')) {
      const data = await toDataUrl(page, s);
      if (data) out.push(data);
    } else {
      out.push(s);
    }
  }
  return [...new Set(out)];
}

/** Lightweight last-assistant-message text (no conversation pairing). */
async function getLastAssistantText(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const els = document.querySelectorAll('[data-message-author-role="assistant"]');
      const el = els[els.length - 1];
      return el ? ((el as HTMLElement).innerText ?? '').trim().slice(0, 2000) : '';
    })
    .catch(() => '');
}

export async function runImageGen(
  page: Page,
  prompt: string,
  opts: ImageGenOptions = {},
): Promise<ImageGenResult> {
  await activateMode(page, 'image');
  await typeAndSubmit(page, prompt);

  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const pollMs = opts.pollMs ?? 3000;
  const stableMs = opts.stableMs ?? 8000;
  const minImages = opts.minImages ?? 1;

  let lastResolved: string[] = [];
  let lastText = '';
  let stableSince = 0;

  while (Date.now() - started < timeoutMs) {
    const srcs = await collectImageSrcs(page);
    const resolved = srcs.length >= minImages ? await resolveImages(page, srcs) : [];
    const text = await getLastAssistantText(page);

    if (resolved.length >= minImages) {
      const sameSet = JSON.stringify(resolved) === JSON.stringify(lastResolved);
      const textStable = text !== '' ? text === lastText : true;
      if (sameSet && textStable) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) {
          return {
            text: text ?? '',
            images: resolved,
            latencyMs: Date.now() - started,
          };
        }
      } else {
        stableSince = 0;
      }
      lastResolved = resolved;
      lastText = text ?? '';
    } else {
      stableSince = 0;
      lastResolved = [];
    }
    await page.waitForTimeout(pollMs);
  }

  throw AdapterError.generationTimeout(
    `image generation did not complete within ${timeoutMs}ms (images_found=${lastResolved.length})`,
  );
}
