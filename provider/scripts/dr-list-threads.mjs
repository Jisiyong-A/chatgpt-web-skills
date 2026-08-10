import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
try {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const links = await page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/c/"]')) {
      const t = (a.innerText || '').trim();
      const href = a.getAttribute('href') || '';
      if (t && href) out.push({ t: t.slice(0, 40), href: href.slice(0, 70) });
    }
    // 去重
    const seen = new Set(); const uniq = [];
    for (const o of out) { if (!seen.has(o.href)) { seen.add(o.href); uniq.push(o); } }
    return uniq;
  });
  console.log(JSON.stringify(links, null, 1));
} catch (e) { console.log('异常:', e.message); }
await page.close().catch(() => {});
