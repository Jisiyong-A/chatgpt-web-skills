/** Check the live ChatGPT tab's auth state over CDP. */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const contexts = browser.contexts();
let found = false;
for (const ctx of contexts) {
  for (const page of ctx.pages()) {
    const url = page.url();
    if (!url.includes('chatgpt.com')) continue;
    found = true;
    const body = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 1500) : '')).catch(() => '');
    const hasComposer = await page
      .locator('#prompt-textarea, [contenteditable="true"], textarea')
      .count()
      .catch(() => 0);
    console.log('URL:', url);
    console.log('HAS_COMPOSER:', hasComposer > 0);
    const markers = ['log in', 'sign up', 'verify you are human', 'captcha', 'usage limit', 'welcome back'];
    const lower = body.toLowerCase();
    const hits = markers.filter((m) => lower.includes(m));
    console.log('MARKER_HITS:', hits.length ? hits.join(', ') : 'none');
    console.log('BODY_SNIPPET:', body.slice(0, 300).replace(/\n+/g, ' | '));
  }
}
if (!found) console.log('NO_CHATGPT_TAB_FOUND');
await browser.close();
