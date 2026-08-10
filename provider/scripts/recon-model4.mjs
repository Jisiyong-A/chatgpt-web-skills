// 模型选择路径测试：点"高级"(显示高级选项) / 点模型名 / 滑块切换
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[MODEL4]', ...a);
const dump = async (label) => {
  const texts = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[role="menu"] *, [role="menuitem"], [role="dialog"] *, [data-testid*="picker" i] *')) {
      const t = (el.innerText || '').trim();
      if (t && t.length > 2 && t.length < 300) out.push(t.slice(0, 200));
    }
    return [...new Set(out)];
  });
  log(`== ${label} ==`);
  texts.forEach((m, i) => log(`  [${i}] ${JSON.stringify(m.slice(0, 120))}`));
  return texts;
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
      if (box) { await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); return true; }
    }
  }
  return false;
};
try {
  await openPicker();
  await page.waitForTimeout(1200);
  await dump('选择器打开');

  // A: 点"高级"(显示高级选项)
  const advBtn = page.locator('[role="menuitem"]', { hasText: /高级/ }).first();
  if (await advBtn.count()) {
    log('点击"高级"项...');
    await advBtn.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await dump('点击高级后');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/67-advanced.png' }).catch(() => {});
  }

  // B: 点模型名（GPT-5.6 Sol）
  const modelName = page.locator('[role="menuitem"]', { hasText: /GPT-5/ }).first();
  if (await modelName.count()) {
    log('点击模型名...');
    await modelName.click({ force: true, timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await dump('点击模型名后');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/68-modelname.png' }).catch(() => {});
  }
} catch (e) { log('异常:', e.message); }
await page.close().catch(() => {});
