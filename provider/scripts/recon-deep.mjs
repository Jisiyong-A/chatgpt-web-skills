// UI 深挖侦察：模型子菜单 / 工作标签 / + 菜单
// 用法: node scripts/recon-deep.mjs
import { chromium } from 'playwright';

const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const log = (...a) => console.log('[RECON]', ...a);

const dumpMenu = async (label) => {
  // 只 dump 菜单/弹层/选择器相关容器，避免 sidebar 噪音
  const items = await page.evaluate(() => {
    const out = [];
    const sel = '[role="menu"] *, [role="menuitem"], [role="option"], [role="listbox"] *, [role="dialog"] *, [data-testid*="picker" i], [data-testid*="model" i], [data-testid*="menu" i]';
    for (const el of document.querySelectorAll(sel)) {
      const w = el;
      const r = w.getBoundingClientRect();
      const t = (w.innerText || '').trim();
      const aria = w.getAttribute('aria-label') || '';
      const testid = w.getAttribute('data-testid') || '';
      if (r.width > 0 && r.height > 0 && (t || aria) && t.length < 120 && !/跳至内容|打开边栏|关闭边栏/.test(aria)) {
        out.push({ tag: el.tagName, testid, aria: aria.slice(0, 50), text: t.slice(0, 80), role: w.getAttribute('role') ?? '' });
      }
    }
    return out.slice(0, 50);
  });
  log(`== ${label} ==`);
  items.forEach((it, i) => log(`  [${i}] ${it.tag} role=${it.role || '-'} testid=${it.testid || '-'} aria=${it.aria || '-'} text=${it.text || '-'}`));
  return items;
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

  // ── A. 点"高"→ 菜单 → 点"模型" → 子菜单 ──
  const reasonBtn = page.locator('button', { hasText: /^高$|思考/i }).first();
  if (await reasonBtn.count()) {
    await reasonBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
    await dumpMenu('A1. 高按钮菜单');
    // 点"模型"项
    const modelItem = page.locator('[role="menuitem"]', { hasText: /^模型/ }).first();
    if (await modelItem.count()) {
      await modelItem.click().catch((e) => log('模型项点击失败:', e.message));
      await page.waitForTimeout(1500);
      await dumpMenu('A2. 模型子菜单');
      await page.screenshot({ path: 'docs/ui-recon-screenshots/20-model-submenu.png' }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
    // 再开一次，点"思考强度"看选项
    await reasonBtn.click().catch(() => {});
    await page.waitForTimeout(1000);
    const thinkItem = page.locator('[role="menuitem"]', { hasText: /思考强度/ }).first();
    if (await thinkItem.count()) {
      await thinkItem.click().catch(() => {});
      await page.waitForTimeout(1200);
      await dumpMenu('A3. 思考强度子菜单');
      await page.screenshot({ path: 'docs/ui-recon-screenshots/21-thinking-submenu.png' }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
  }

  // ── B. "工作"标签 ──
  const workTab = page.locator('[role="radio"]', { hasText: /^工作$/ }).first();
  if (await workTab.count()) {
    await workTab.click().catch(() => {});
    await page.waitForTimeout(2000);
    await dumpMenu('B1. 工作视图');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/22-work-view.png' }).catch(() => {});
    const chatTab = page.locator('[role="radio"]', { hasText: /^聊天$/ }).first();
    if (await chatTab.count()) await chatTab.click().catch(() => {});
    await page.waitForTimeout(1200);
  }

  // ── C. "+"按钮菜单（长等待） ──
  const plusBtn = page.locator('[data-testid="composer-plus-btn"]').first();
  if (await plusBtn.count()) {
    await plusBtn.click().catch((e) => log('+ 点击失败:', e.message));
    await page.waitForTimeout(2000);
    await dumpMenu('C1. + 附件菜单');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/23-plus-menu.png' }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(600);
  }

  log('深挖侦察完成');
} catch (e) {
  log('异常:', e.message);
  await page.screenshot({ path: 'docs/ui-recon-screenshots/99-error3.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
