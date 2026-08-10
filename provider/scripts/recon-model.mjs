// 模型选择器探索：打开智能选择器 → hover "模型" → dump 子菜单模型列表
// 用法: node scripts/recon-model.mjs
import { chromium } from 'playwright';

const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[MODEL]', ...a);

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

  // 1. 点强度按钮（高/中/低）
  const reasonBtn = page.locator('#composer button, [data-testid="composer"] button, form button, button', { hasText: /^(高|中|低)$/ }).first();
  const n = await reasonBtn.count().catch(() => 0);
  log('强度按钮数量:', n);
  if (!n) {
    // 语义扫描：所有按钮文本 高/中/低
    const all = page.locator('button');
    const total = Math.min(await all.count().catch(() => 0), 60);
    for (let i = 0; i < total; i++) {
      const t = (await all.nth(i).innerText().catch(() => '')).trim();
      if (/^(高|中|低)$/.test(t)) { await all.nth(i).click({ force: true, timeout: 4000 }).catch(() => {}); log('语义点击按钮:', t); break; }
    }
  } else {
    await reasonBtn.click({ force: true, timeout: 5000 }).catch(() => {});
    log('点击强度按钮');
  }
  await page.waitForTimeout(1500);

  // 2. dump 菜单
  const menu = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role="menu"] *, [data-testid*="picker" i] *')) {
      const w = el;
      const t = (w.innerText || '').trim();
      const testid = w.getAttribute('data-testid') || '';
      if (t && t.length < 100) out.push({ t: t.slice(0, 60), testid: testid.slice(0, 50), tag: el.tagName });
    }
    return out.slice(0, 30);
  });
  log('菜单元素:');
  menu.forEach((m, i) => log(`  [${i}] ${m.tag} ${m.testid || ''} | ${m.t}`));

  // 3. 找"模型"项，用 mouse.move hover 触发 Radix submenu
  const modelItem = page.locator('[role="menuitem"]', { hasText: /^模型/ }).first();
  if (await modelItem.count()) {
    const box = await modelItem.boundingBox().catch(() => null);
    if (box) {
      log('模型项位置:', JSON.stringify(box));
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(1500);
      log('hover 后菜单:');
      const menu2 = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('[role="menu"] *, [role="menuitem"], [role="menuitemradio"]')) {
          const w = el;
          const t = (w.innerText || '').trim();
          if (t && t.length < 120) out.push(t.slice(0, 100));
        }
        return [...new Set(out)];
      });
      menu2.forEach((m, i) => log(`  [${i}] ${m}`));
      await page.screenshot({ path: 'docs/ui-recon-screenshots/60-model-submenu-open.png' }).catch(() => {});
    } else {
      log('模型项不可见');
    }
  } else {
    log('未找到模型项');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/61-no-model-item.png' }).catch(() => {});
  }

  await page.keyboard.press('Escape').catch(() => {});
  log('探索完成');
} catch (e) {
  log('异常:', e.message);
} finally {
  await page.close().catch(() => {});
}
