// 模型子菜单触发方法测试
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[MODEL3]', ...a);

const dumpMenus = async (label) => {
  const texts = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role="menu"], [role="menuitem"]')) {
      const t = (el.innerText || '').trim();
      if (t && t.length > 3) out.push(t.slice(0, 250));
    }
    return [...new Set(out)];
  });
  log(`${label} 菜单数: ${texts.length}`);
  texts.forEach((m, i) => log(`  [${i}] ${JSON.stringify(m.slice(0, 100))}`));
  return texts.length;
};

const openPicker = async () => {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#prompt-textarea, [contenteditable="true"]').count()) break;
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(1500);
  const all = page.locator('button');
  const total = Math.min(await all.count().catch(() => 0), 80);
  for (let i = 0; i < total; i++) {
    const t = (await all.nth(i).innerText().catch(() => '')).trim();
    if (/^(高|中|低)$/.test(t)) {
      const box = await all.nth(i).boundingBox().catch(() => null);
      if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); return; }
    }
  }
};

try {
  await openPicker();
  await page.waitForTimeout(1200);
  const modelBox = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="menuitem"]')) {
      if ((el.innerText || '').startsWith('模型')) {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }
    }
    return null;
  });
  log('模型项坐标:', JSON.stringify(modelBox));
  if (!modelBox) { log('未找到'); process.exit(1); }

  // 方法A: 连续小步移动（触发多次 pointermove）
  log('== 方法A: 小步移动 ==');
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(modelBox.x, modelBox.y + (i - 3) * 2);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(1500);
  if ((await dumpMenus('A')) > 4) { await page.screenshot({ path: 'docs/ui-recon-screenshots/63-model-A.png' }).catch(() => {}); process.exit(0); }

  // 方法B: dispatchEvent pointer events
  log('== 方法B: dispatchEvent ==');
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    const item = el.closest('[role="menuitem"]') || el;
    for (const type of ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove']) {
      item.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
  }, modelBox);
  await page.waitForTimeout(1500);
  if ((await dumpMenus('B')) > 4) { await page.screenshot({ path: 'docs/ui-recon-screenshots/64-model-B.png' }).catch(() => {}); process.exit(0); }

  // 方法C: 键盘 ArrowRight（先 focus 模型项）
  log('== 方法C: 键盘 ArrowRight ==');
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="menuitem"]')) {
      if ((el.innerText || '').startsWith('模型')) { el.focus(); return; }
    }
  });
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1500);
  const c = await dumpMenus('C');
  if (c > 4) { await page.screenshot({ path: 'docs/ui-recon-screenshots/65-model-C.png' }).catch(() => {}); process.exit(0); }

  // 方法D: click 模型项
  log('== 方法D: click ==');
  await page.mouse.click(modelBox.x, modelBox.y);
  await page.waitForTimeout(1500);
  await dumpMenus('D');
  await page.screenshot({ path: 'docs/ui-recon-screenshots/66-model-D.png' }).catch(() => {});
} catch (e) { log('异常:', e.message); }
await page.close().catch(() => {});
