// UI 深挖侦察 v2："更多"子菜单 + 模型子菜单(重试) + 工作视图(重试)
// 用法: node scripts/recon-more.mjs
import { chromium } from 'playwright';

const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const log = (...a) => console.log('[RECON]', ...a);

const dumpMenu = async (label) => {
  const items = await page.evaluate(() => {
    const out = [];
    const sel = '[role="menu"] *, [role="menuitem"], [role="menuitemradio"], [role="option"], [role="dialog"] *, [data-radix-menu-content], [data-testid*="picker" i], [data-testid*="model" i], [data-testid*="menu" i], [data-testid*="tool" i]';
    for (const el of document.querySelectorAll(sel)) {
      const w = el;
      const r = w.getBoundingClientRect();
      const t = (w.innerText || '').trim();
      const aria = w.getAttribute('aria-label') || '';
      const testid = w.getAttribute('data-testid') || '';
      if (r.width > 0 && r.height > 0 && (t || aria) && t.length < 150 && !/跳至内容|打开边栏|关闭边栏|history-item/.test(aria + testid)) {
        out.push({ tag: el.tagName, testid: testid.slice(0, 60), aria: aria.slice(0, 50), text: t.slice(0, 100), role: w.getAttribute('role') ?? '' });
      }
    }
    return out.slice(0, 55);
  });
  log(`== ${label} ==`);
  items.forEach((it, i) => log(`  [${i}] ${it.tag} role=${it.role || '-'} testid=${it.testid || '-'} aria=${it.aria || '-'} text=${it.text || '-'}`));
  return items;
};

// DOM click（绕过可见性/遮挡问题，同 new-chat.ts 做法）
const domClick = async (loc) => {
  try { await loc.evaluate((el) => el.click()); return true; } catch { return false; }
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

  // ── A. "+" → "更多" 子菜单 ──
  const plusBtn = page.locator('[data-testid="composer-plus-btn"]').first();
  if (await plusBtn.count()) {
    await plusBtn.click({ force: true, timeout: 5000 }).catch(() => domClick(plusBtn));
    await page.waitForTimeout(1500);
    const moreItem = page.locator('[role="menuitem"]', { hasText: /^更多$/ }).first();
    if (await moreItem.count()) {
      log('点击"更多"...');
      await moreItem.click({ force: true, timeout: 5000 }).catch(() => domClick(moreItem));
      await page.waitForTimeout(1500);
      await dumpMenu('A. 更多子菜单');
      await page.screenshot({ path: 'docs/ui-recon-screenshots/30-more-submenu.png' }).catch(() => {});
    } else {
      log('未找到"更多"项');
      await dumpMenu('A0. +菜单现状');
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  }

  // ── B. "高"按钮 → 菜单 → "模型"子菜单（DOM click 重试） ──
  const reasonBtn = page.locator('#composer button, [data-testid="composer"] button, form button', { hasText: /^(高|中|低)$/ }).first();
  if (!(await reasonBtn.count())) {
    // 语义 fallback：所有可见文本为 高/中/低 的按钮
    const all = page.locator('button');
    const n = Math.min(await all.count(), 60);
    for (let i = 0; i < n; i++) {
      const t = await all.nth(i).innerText().catch(() => '');
      if (/^(高|中|低)$/.test(t.trim())) { reasonBtn = all.nth(i); break; }
    }
  }
  if (await reasonBtn.count()) {
    log('点击思考强度按钮(文本:', (await reasonBtn.innerText().catch(() => '?')).trim(), ')...');
    await reasonBtn.click({ force: true, timeout: 5000 }).catch(() => domClick(reasonBtn));
    await page.waitForTimeout(1200);
    await dumpMenu('B1. 强度菜单');
    const modelItem = page.locator('[role="menuitem"]', { hasText: /^模型/ }).first();
    if (await modelItem.count()) {
      await modelItem.click({ force: true, timeout: 5000 }).catch(() => domClick(modelItem));
      await page.waitForTimeout(1500);
      await dumpMenu('B2. 模型子菜单');
      await page.screenshot({ path: 'docs/ui-recon-screenshots/31-model-submenu.png' }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(800);
  } else {
    log('未找到思考强度按钮');
  }

  // ── C. "工作"标签（role=radio） ──
  const workTab = page.locator('[role="radio"]', { hasText: /^工作$/ }).first();
  if (await workTab.count()) {
    await workTab.click({ force: true, timeout: 5000 }).catch(() => domClick(workTab));
    await page.waitForTimeout(2500);
    await dumpMenu('C. 工作视图');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/32-work-view.png' }).catch(() => {});
    const chatTab = page.locator('[role="radio"]', { hasText: /^聊天$/ }).first();
    if (await chatTab.count()) await chatTab.click({ force: true, timeout: 5000 }).catch(() => domClick(chatTab));
    await page.waitForTimeout(1200);
  }

  log('v2 侦察完成');
} catch (e) {
  log('异常:', e.message);
  await page.screenshot({ path: 'docs/ui-recon-screenshots/99-error4.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
