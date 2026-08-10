import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
try {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const r = await page.evaluate(async (u) => {
    const resp = await fetch(u, { credentials: 'include' });
    const buf = new Uint8Array(await resp.arrayBuffer());
    return { status: resp.status, contentType: resp.headers.get('content-type'), bytes: buf.length, head: String.fromCharCode(...buf.slice(0, 8)) };
  }, url);
  console.log('图片验证:', JSON.stringify(r));
} catch (e) { console.log('图片验证失败:', e.message); }
await page.close().catch(() => {});
await browser.close().catch(() => {});
