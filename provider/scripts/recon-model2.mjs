// 模型选择器探索 v2：dump 所有 menuitem，定位模型项，hover 开子菜单
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[MODEL2]', ...a);
try {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ok = false;
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#prompt-textarea, [contenteditable="true"]').count()) { ok = true; break; }
    await page.waitForTimeout(1500);
  }
  if (!ok) { log('composer 未就绪'); process.exit(1); }
  await page.waitForTimeout(2000);

  // 点强度按钮
  const all = page.locator('button');
  const total = Math.min(await all.count().catch(() => 0), 80);
  let clicked = false;
  for (let i = 0; i < total; i++) {
    const t = (await all.nth(i).innerText().catch(() => '')).trim();
    if (/^(高|中|低)$/.test(t)) {
      const box = await all.nth(i).boundingBox().catch(() => null);
      if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); clicked = true; log('点击强度按钮:', t); break; }
    }
  }
  if (!clicked) log('未找到强度按钮');
  await page.waitForTimeout(1500);

  // dump 所有 menuitem + 位置
  const items = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role="menuitem"]')) {
      const w = el;
      const r = w.getBoundingClientRect();
      out.push({
        text: (w.innerText || '').trim().slice(0, 60),
        aria: w.getAttribute('aria-label') || '',
        hasSubmenu: w.hasAttribute('data-has-submenu'),
        x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
        visible: r.width > 0 && r.height > 0,
      });
    }
    return out;
  });
  log('menuitem 清单:');
  items.forEach((it, i) => log(`  [${i}] ${it.visible ? 'V' : 'H'} submenu=${it.hasSubmenu} (${it.x},${it.y}) ${it.aria || ''} | ${it.text}`));

  // 找模型项并 hover
  const modelItem = items.find((it) => it.text.startsWith('模型') && it.visible);
  if (modelItem) {
    log('hover 模型项 at', modelItem.x, modelItem.y);
    await page.mouse.move(modelItem.x, modelItem.y);
    await page.waitForTimeout(2000);
    // dump 所有菜单相关文本（含新出现的子菜单）
    const menuTexts = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[role="menu"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="listbox"]')) {
        const t = (el.innerText || '').trim();
        if (t) out.push(t.slice(0, 200));
      }
      return [...new Set(out)];
    });
    log('hover 后全部菜单文本:');
    menuTexts.forEach((m, i) => log(`  [${i}] ${JSON.stringify(m)}`));
    await page.screenshot({ path: 'docs/ui-recon-screenshots/62-model-submenu.png' }).catch(() => {});
  } else {
    log('未找到模型 menuitem');
  }
  await page.keyboard.press('Escape').catch(() => {});
} catch (e) { log('异常:', e.message); }
await page.close().catch(() => {});
