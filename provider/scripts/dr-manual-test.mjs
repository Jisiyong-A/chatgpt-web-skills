// 手动深度研究测试：全新标签页，激活→发送→观察 90s
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[DR-MANUAL]', ...a);
const clickMenuByText = async (role, text) => {
  const loc = page.locator(`[role="${role}"]`).filter({ hasText: new RegExp(`^${text}$`) }).first();
  for (let i = 0; i < 40; i++) {
    if (await loc.count()) { await loc.click({ force: true, timeout: 4000 }).catch(() => {}); return true; }
    await page.waitForTimeout(200);
  }
  return false;
};
try {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#prompt-textarea, [contenteditable="true"]').count()) break;
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(2000);
  // 激活深度研究
  await page.locator('[data-testid="composer-plus-btn"]').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(1000);
  await clickMenuByText('menuitem', '更多');
  await page.waitForTimeout(1000);
  await clickMenuByText('menuitemradio', '深度研究');
  await page.waitForTimeout(3000); // 等模式完全稳定
  const footer = await page.locator('[data-testid="composer-footer-actions"]').first().innerText().catch(() => '');
  log('激活后 footer:', JSON.stringify(footer));
  // 发送
  const composer = page.locator('#prompt-textarea, [contenteditable="true"]').first();
  await composer.click().catch(() => {});
  await page.keyboard.insertText('简述2025年东京都市更新的主要方向');
  await page.waitForTimeout(800);
  const send = page.locator('[data-testid="send-button"]').first();
  const sendBtn = await send.count();
  log('发送按钮存在:', sendBtn);
  if (sendBtn) await send.click({ force: true }).catch(() => {});
  // 观察 90s
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(10_000);
    const s = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      return {
        url: location.href.slice(0, 70),
        stop: !!document.querySelector('[data-testid="stop-button"]'),
        roleMsgs: document.querySelectorAll('[data-message-author-role]').length,
        bodyLen: body.length,
        tail: body.slice(-250),
        hasProgress: /正在|搜索|研究|计划|分析/.test(body.slice(-500)),
      };
    }).catch(e => ({ error: e.message }));
    log(`t+${(i + 1) * 10}s`, JSON.stringify(s));
    if (s.stop || (s.roleMsgs && s.roleMsgs > 1)) break;
  }
} catch (e) { log('异常:', e.message); }
await page.close().catch(() => {});
