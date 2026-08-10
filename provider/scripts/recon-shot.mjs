import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
try {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#prompt-textarea, [contenteditable="true"]').count()) break;
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'docs/ui-recon-screenshots/70-current.png' });
  // dump 所有可见按钮文本
  const btns = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll('button')) {
      const t = (b.innerText || '').trim();
      const aria = b.getAttribute('aria-label') || '';
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (t || aria)) out.push((t || aria).slice(0, 30));
    }
    return out.slice(0, 40);
  });
  console.log('按钮:', JSON.stringify(btns));
  console.log('URL:', page.url());
  const body = await page.evaluate(() => (document.body?.innerText || '').slice(-300));
  console.log('body尾部:', JSON.stringify(body));
} catch (e) { console.log('异常:', e.message); }
await page.close().catch(() => {});
