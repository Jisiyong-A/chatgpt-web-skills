// 深度研究诊断：手动驱动 + 观察 DOM 生命周期（5 分钟上限）
// 安全：新标签页，不 browser.close()（避免影响 adapter），只关自己的页面
import { chromium } from 'playwright';

const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[DR-DIAG]', ...a);

const clickMenuByText = async (role, text) => {
  const re = new RegExp(`^${text}$`);
  const loc = page.locator(`[role="${role}"]`).filter({ hasText: re }).first();
  for (let i = 0; i < 40; i++) {
    if (await loc.count()) { await loc.click({ force: true, timeout: 4000 }).catch(() => {}); return true; }
    await page.waitForTimeout(200);
  }
  return false;
};

const state = async (label) => {
  const s = await page.evaluate(() => {
    const footer = document.querySelector('[data-testid="composer-footer-actions"]');
    const stop = document.querySelector('[data-testid="stop-button"], button[aria-label*="stop" i], button[aria-label*="停止" i]');
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    const lastMsg = msgs[msgs.length - 1];
    const body = document.body?.innerText || '';
    // 深度研究进度特征
    const drMarkers = [];
    if (/深度研究/.test(body)) drMarkers.push('深度研究文本');
    if (/正在搜索|搜索来源|source/i.test(body)) drMarkers.push('搜索中');
    if (/已完成|研究完成|报告/.test(body)) drMarkers.push('完成标记');
    return {
      url: location.href.slice(0, 60),
      footer: footer?.innerText?.slice(0, 60) || null,
      stopVisible: !!stop,
      msgCount: msgs.length,
      lastMsgLen: lastMsg ? (lastMsg.innerText || '').length : 0,
      lastMsgHead: lastMsg ? (lastMsg.innerText || '').slice(0, 80) : '',
      drMarkers,
    };
  }).catch((e) => ({ error: e.message }));
  log(`[${label}]`, JSON.stringify(s));
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

  // 激活深度研究模式
  log('激活深度研究模式...');
  const plus = page.locator('[data-testid="composer-plus-btn"]').first();
  await plus.click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const moreOk = await clickMenuByText('menuitem', '更多');
  log('点更多:', moreOk);
  await page.waitForTimeout(1000);
  const drOk = await clickMenuByText('menuitemradio', '深度研究');
  log('点深度研究:', drOk);
  await page.waitForTimeout(2000);
  await state('激活后');

  // 输入 + 发送
  const composer = page.locator('#prompt-textarea, [contenteditable="true"]').first();
  await composer.click().catch(() => {});
  await page.keyboard.insertText('2024年巴黎奥运会吉祥物的名字是什么？只回答名字');
  await page.waitForTimeout(500);
  const send = page.locator('[data-testid="send-button"]').first();
  const sendCount = await send.count().catch(() => 0);
  log('发送按钮:', sendCount);
  if (sendCount) await send.click({ force: true, timeout: 5000 }).catch(() => {});
  log('已发送，开始观察...');

  // 观察 5 分钟
  const deadline = Date.now() + 300_000;
  let n = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(10_000);
    n += 1;
    const s = await state(`t+${n * 10}s`);
    // 完成判断：新 assistant 消息且非空
    if (s.lastMsgLen > 50 && !s.stopVisible) {
      log('=== 疑似完成 ===');
      await state('完成态');
      await page.screenshot({ path: 'docs/ui-recon-screenshots/50-dr-complete.png' }).catch(() => {});
      break;
    }
    if (n >= 30) break;
  }
  log('诊断结束');
} catch (e) {
  log('异常:', e.message);
  await page.screenshot({ path: 'docs/ui-recon-screenshots/99-error6.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  // 只关自己的页面，绝不 browser.close()（会杀 adapter 的页面）
  await page.close().catch(() => {});
}
