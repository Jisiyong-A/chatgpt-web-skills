// UI 触发侦察：深度研究/创建图片触发后 composer 状态 + 模型子菜单
// 安全：只触发模式切换，绝不发送消息
// 用法: node scripts/recon-trigger.mjs
import { chromium } from 'playwright';

const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const log = (...a) => console.log('[RECON]', ...a);

const composerState = async (label) => {
  const s = await page.evaluate(() => {
    const c = document.querySelector('#composer, [data-testid="composer"], form');
    if (!c) return { found: false };
    const out = { found: true, text: (c.innerText || '').slice(0, 300), testids: [] };
    for (const el of c.querySelectorAll('[data-testid]')) {
      const t = el.getAttribute('data-testid');
      if (t && !out.testids.includes(t)) out.testids.push(t);
    }
    return out;
  });
  log(`== ${label} composer状态 ==`);
  log('  text:', JSON.stringify(s.text));
  log('  testids:', s.testids?.join(', '));
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
  await page.waitForTimeout(2000);
  await composerState('初始');

  // ── A. 深度研究触发 ──
  const plusBtn = page.locator('[data-testid="composer-plus-btn"]').first();
  if (await plusBtn.count()) {
    await plusBtn.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    // 点"更多"
    const moreItem = page.locator('[role="menuitem"]', { hasText: /^更多$/ }).first();
    if (await moreItem.count()) {
      await moreItem.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
      // 点"深度研究"
      const drItem = page.locator('[role="menuitemradio"]', { hasText: /^深度研究$/ }).first();
      if (await drItem.count()) {
        log('触发"深度研究"...');
        await drItem.click({ force: true, timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await composerState('深度研究触发后');
        await page.screenshot({ path: 'docs/ui-recon-screenshots/40-deep-research-mode.png' }).catch(() => {});
        // 恢复：Escape + 可能要点关闭
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(800);
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(800);
        await composerState('深度研究恢复后');
      } else {
        log('未找到深度研究项');
      }
    }
  }

  // ── B. 创建图片触发 ──
  if (await plusBtn.count()) {
    await plusBtn.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const imgItem = page.locator('[role="menuitemradio"]', { hasText: /^创建图片$/ }).first();
    if (await imgItem.count()) {
      log('触发"创建图片"...');
      await imgItem.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await composerState('创建图片触发后');
      await page.screenshot({ path: 'docs/ui-recon-screenshots/41-image-mode.png' }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
    } else {
      log('未找到创建图片项');
    }
  }

  // ── C. 模型子菜单 ──
  const reasonBtn = page.locator('button', { hasText: /^(高|中|低)$/ }).first();
  if (await reasonBtn.count()) {
    await reasonBtn.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const modelItem = page.locator('[role="menuitem"]', { hasText: /^模型/ }).first();
    if (await modelItem.count()) {
      log('点击"模型"项...');
      await modelItem.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await composerState('模型子菜单打开');
      await page.screenshot({ path: 'docs/ui-recon-screenshots/42-model-submenu.png' }).catch(() => {});
      // dump 页面里模型相关文本（模型列表可能在抽屉里）
      const modelTexts = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('[data-testid*="model" i], [role="dialog"] *')) {
          const w = el;
          const t = (w.innerText || '').trim();
          if (t && t.length < 200 && /GPT|模型|o3|o4|mini/i.test(t)) out.push(t.slice(0, 150));
        }
        return [...new Set(out)].slice(0, 25);
      });
      log('模型相关文本:');
      modelTexts.forEach((t, i) => log(`  [${i}] ${t}`));
    }
    await page.keyboard.press('Escape').catch(() => {});
  }

  log('触发侦察完成');
} catch (e) {
  log('异常:', e.message);
  await page.screenshot({ path: 'docs/ui-recon-screenshots/99-error5.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
