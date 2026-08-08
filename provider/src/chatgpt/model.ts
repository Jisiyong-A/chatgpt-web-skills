/**
 * Model indicator (spec §29). Phase 1: we advertise `chatgpt-web` only.
 * We attempt to read the visible model name from the UI, but never promise a
 * specific underlying ChatGPT model unless it is reliably detectable.
 */

import type { Page } from 'playwright';

const MODEL_NAME_RE = /(GPT-[\d.]+[^|"]*|o\d+(?:-[a-z]+)?|Claude|Gemini|DeepSeek|Groq|Mistral)/i;

export async function detectModelIndicator(page: Page): Promise<string | null> {
  const sels = [
    '[data-testid="model-selector-button"]',
    '[data-testid="chatgpt-model-selector-button"]',
    'button[data-testid*="model"]',
  ];
  for (const sel of sels) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count === 0) continue;
    const text = await page
      .locator(sel)
      .nth(0)
      .evaluate((el) => (el as HTMLElement).innerText ?? '')
      .catch(() => '');
    const m = MODEL_NAME_RE.exec(text);
    if (m && m[1]) return m[1];
  }
  return null;
}
