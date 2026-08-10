import { chromium } from 'playwright';
const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const log = (...a) => console.log('[RECON]', ...a);
try {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ok = false;
  for (let i = 0; i < 20; i++) { if (await page.locator('#prompt-textarea, [contenteditable="true"]').count()) { ok = true; break; } await page.waitForTimeout(1500); }
  if (!ok) { log('composer 未就绪'); process.exit(1); }
  await page.waitForTimeout(2000);
  const reasonBtn = page.locator('button', { hasText: /^(高|中|低)$/ }).first();
  await reasonBtn.click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const modelItem = page.locator('[role="menuitem"]', { hasText: /^模型/ }).first();
  if (await modelItem.count()) {
    log('hover 模型项...');
    await modelItem.hover({ timeout: 5000 }).catch((e) => log('hover失败:', e.message));
    await page.waitForTimeout(1500);
    // dump 所有 role=menu 的文本
    const menus = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[role="menu"]')) {
        const t = (el.innerText || '').trim();
        if (t) out.push(t.slice(0, 400));
      }
      return out;
    });
    log('菜单容器文本:');
    menus.forEach((t, i) => log(`  [${i}] ${JSON.stringify(t)}`));
    await page.screenshot({ path: 'docs/ui-recon-screenshots/43-model-hover.png' }).catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
  log('hover 侦察完成');
} catch (e) { log('异常:', e.message); process.exitCode = 1; } finally {
  await page.close().catch(() => {}); await browser.close().catch(() => {});
}
