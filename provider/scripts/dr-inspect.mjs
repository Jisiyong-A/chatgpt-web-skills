// 检查深度研究线程页面的 DOM 全貌
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
try {
  await page.goto('https://chatgpt.com/c/6a7a1358-8280-83ec-86a9-d378067ea867', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const body = document.body?.innerText || '';
    const msgs = document.querySelectorAll('[data-message-author-role]');
    const turns = document.querySelectorAll('[data-testid="conversation-turn"]');
    const buttons = [...document.querySelectorAll('button')].map(b => (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 30)).filter(Boolean).slice(0, 30);
    return {
      url: location.href.slice(0, 80),
      bodyHead: body.slice(0, 600),
      roleMsgs: msgs.length,
      turns: turns.length,
      buttons,
      hasStop: !!document.querySelector('[data-testid="stop-button"]'),
    };
  }).catch(e => ({ error: e.message }));
  console.log(JSON.stringify(info, null, 1));
} catch (e) { console.log('异常:', e.message); }
await page.close().catch(() => {});
