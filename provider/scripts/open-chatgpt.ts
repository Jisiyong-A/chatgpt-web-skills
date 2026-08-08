/** Navigate the dedicated Chrome to chatgpt.com and report auth state. */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const pages = browser.contexts().flatMap((c) => c.pages());
let page = pages.find((p) => p.url().includes('chatgpt.com'));
if (!page) {
  page = pages[0] ?? (await browser.contexts()[0]!.newPage());
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 45_000 });
}
await page.waitForLoadState('domcontentloaded').catch(() => undefined);
await page.waitForTimeout(4000); // let React hydrate

const url = page.url();
const body = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 2000) : '')).catch(() => '');
const hasComposer = await page.locator('#prompt-textarea, [contenteditable="true"], textarea').count().catch(() => 0);
const lower = body.toLowerCase();
const hits = ['log in', 'sign up', 'verify you are human', 'captcha', 'usage limit', 'welcome back', 'new chat'].filter((m) => lower.includes(m));

console.log('URL:', url);
console.log('HAS_COMPOSER:', hasComposer > 0);
console.log('MARKER_HITS:', hits.length ? hits.join(', ') : 'none');
console.log('BODY:', body.slice(0, 400).replace(/\n+/g, ' | '));
await browser.close();
