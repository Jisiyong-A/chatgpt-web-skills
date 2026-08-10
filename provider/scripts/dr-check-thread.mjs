// 检查深度研究线程是否已有完整报告
import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const body = document.body?.innerText || '';
    const msgs = [...document.querySelectorAll('[data-message-author-role]')].map(m => ({
      role: m.getAttribute('data-message-author-role'),
      len: (m.innerText || '').length,
      head: (m.innerText || '').slice(0, 80),
    }));
    return {
      url: location.href.slice(0, 90),
      msgs: msgs.length,
      roles: msgs.map(m => `${m.role}:${m.len}`).join(' | '),
      lastHead: msgs.length ? msgs[msgs.length - 1].head : '',
      bodyHasReport: /深度研究|研究报告|来源|Torch|涩谷|吉祥物|巴黎/.test(body),
      bodyTail: body.slice(-500),
    };
  }).catch(e => ({ error: e.message }));
  console.log(JSON.stringify(info, null, 1));
} catch (e) { console.log('异常:', e.message); }
await page.close().catch(() => {});
