// 方向键调整能力测试：打开选择器 → ArrowLeft/Right → 观察模型名变化
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[MODEL5]', ...a);
const readState = async (label) => {
  const s = await page.evaluate(() => {
    const picker = document.querySelector('[data-testid="composer-intelligence-picker-content"]');
    const modelEl = [...document.querySelectorAll('[role="menuitem"]')].find(el => (el.innerText || '').includes('GPT'));
    return {
      pickerText: picker ? (picker.innerText || '').slice(0, 200) : null,
      modelText: modelEl ? (modelEl.innerText || '').slice(0, 60) : null,
      footer: document.querySelector('[data-testid="composer-footer-actions"]')?.innerText?.slice(0, 40) || null,
    };
  }).catch(e => ({ error: e.message }));
  log(`[${label}]`, JSON.stringify(s));
  return s;
};
try {
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#prompt-textarea, [contenteditable="true"]').count()) break;
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(1500);
  // 点强度按钮
  const all = page.locator('button');
  const total = Math.min(await all.count().catch(() => 0), 80);
  let opened = false;
  for (let i = 0; i < total; i++) {
    const t = (await all.nth(i).innerText().catch(() => '')).trim();
    if (/^(高|中|低)$/.test(t)) {
      const box = await all.nth(i).boundingBox().catch(() => null);
      if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); opened = true; break; }
    }
  }
  if (!opened) { log('未打开选择器'); process.exit(1); }
  await page.waitForTimeout(1200);
  await readState('初始');

  // 按 ArrowLeft 2 次（向"更快"方向）
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(800);
    await readState(`ArrowLeft x${i + 1}`);
  }
  // 按 ArrowRight 3 次（向"高级"方向）
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(800);
    await readState(`ArrowRight x${i + 1}`);
  }
  await page.screenshot({ path: 'docs/ui-recon-screenshots/69-arrows.png' }).catch(() => {});
  // 关闭（Escape）后看 composer 模型指示
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
  await readState('Escape后');
} catch (e) { log('异常:', e.message); }
await page.close().catch(() => {});
