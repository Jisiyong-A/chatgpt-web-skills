// 深度研究长观察：发送后 5 分钟，每 15s 记录页面变化
// 安全：新标签页，不 browser.close()
import { chromium } from 'playwright';

const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[DR-LONG]', ...a);

const clickMenuByText = async (role, text) => {
  const loc = page.locator(`[role="${role}"]`).filter({ hasText: new RegExp(`^${text}$`) }).first();
  for (let i = 0; i < 40; i++) {
    if (await loc.count()) { await loc.click({ force: true, timeout: 4000 }).catch(() => {}); return true; }
    await page.waitForTimeout(200);
  }
  return false;
};

const snap = async (label) => {
  const s = await page.evaluate(() => {
    const body = document.body?.innerText || '';
    const msgs = [...document.querySelectorAll('[data-message-author-role]')].map(m => ({
      role: m.getAttribute('data-message-author-role'),
      len: (m.innerText || '').length,
      head: (m.innerText || '').slice(0, 60),
    }));
    const limitHits = /limit|限额|次数已用完|达到上限|try again later|稍后再试/i.test(body) ? body.match(/(.{40}(?:limit|限额|达到上限|稍后再试).{40})/i)?.[0] : null;
    const drHits = /深度研究|正在搜索|搜索来源|研究计划|report/i.test(body) ? body.slice(0, 300) : null;
    return {
      url: location.href.slice(0, 70),
      footer: document.querySelector('[data-testid="composer-footer-actions"]')?.innerText?.slice(0, 40) || null,
      stop: !!document.querySelector('[data-testid="stop-button"]'),
      msgs: msgs.length,
      lastMsg: msgs[msgs.length - 1] || null,
      limitHit: limitHits,
      drContext: drHits ? drHits.slice(0, 200) : null,
      bodyTail: body.slice(-200),
    };
  }).catch(e => ({ error: e.message }));
  log(`[${label}] ${JSON.stringify(s)}`);
  return s;
};

try {
  log('打开 chatgpt.com ...');
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ok = false;
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#prompt-textarea, [contenteditable="true"]').count()) { ok = true; break; }
    await page.waitForTimeout(1500);
  }
  if (!ok) { log('composer 未就绪'); process.exit(1); }
  await page.waitForTimeout(1500);

  const plus = page.locator('[data-testid="composer-plus-btn"]').first();
  await plus.click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await clickMenuByText('menuitem', '更多');
  await page.waitForTimeout(1000);
  const drOk = await clickMenuByText('menuitemradio', '深度研究');
  log('深度研究激活:', drOk);
  await page.waitForTimeout(2000);
  await snap('激活后');

  const composer = page.locator('#prompt-textarea, [contenteditable="true"]').first();
  await composer.click().catch(() => {});
  await page.keyboard.insertText('2025年东京都市更新的主要方向是什么？简述');
  await page.waitForTimeout(500);
  const send = page.locator('[data-testid="send-button"]').first();
  await send.click({ force: true, timeout: 5000 }).catch(() => {});
  log('已发送');

  const deadline = Date.now() + 300_000;
  let n = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(15_000);
    n += 1;
    const s = await snap(`t+${n * 15}s`);
    // 完成或出现回复即停止
    if (s.msgs > 1 || s.lastMsg?.role === 'assistant') { log('=== 出现回复 ==='); break; }
    if (s.limitHit) { log('=== 命中限额提示 ==='); break; }
  }
  log('观察结束');
} catch (e) {
  log('异常:', e.message);
} finally {
  await page.close().catch(() => {});
}
