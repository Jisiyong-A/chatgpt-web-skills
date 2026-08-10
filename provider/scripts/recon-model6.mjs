// 点击能力选项测试：打开选择器 → 点"更快" → 观察模型名/状态变化
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const log = (...a) => console.log('[MODEL6]', ...a);
const readState = async (label) => {
  const s = await page.evaluate(() => {
    const picker = document.querySelector('[data-testid="composer-intelligence-picker-content"]');
    const modelEl = [...document.querySelectorAll('[role="menuitem"]')].find(el => (el.innerText || '').includes('GPT'));
    const footer = document.querySelector('[data-testid="composer-footer-actions"]');
    return {
      picker: picker ? (picker.innerText || '').slice(0, 120) : null,
      model: modelEl ? (modelEl.innerText || '').slice(0, 50) : null,
      footer: footer ? (footer.innerText || '').slice(0, 40) : null,
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
  // 确保聊天视图
  await page.evaluate(() => {
    const radios = [...document.querySelectorAll('[role="radio"]')];
    const work = radios.find(r => /^工作$/.test((r.innerText || '').trim()) && r.getAttribute('aria-checked') === 'true');
    const chat = radios.find(r => /^聊天$/.test((r.innerText || '').trim()));
    if (work && chat) chat.click();
  }).catch(() => {});
  await page.waitForTimeout(1500);
  // 打开选择器
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
  await readState('初始(高级/第3项)');

  // 点"更快"（第1档）
  const faster = page.locator('span, div, button', { hasText: /^更快$/ }).last();
  if (await faster.count()) {
    log('点击"更快"...');
    await faster.click({ force: true, timeout: 4000 }).catch((e) => log('点击失败:', e.message));
    await page.waitForTimeout(1500);
    await readState('点更快后');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/71-faster.png' }).catch(() => {});
  } else {
    log('未找到"更快"文本');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/71-nofaster.png' }).catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
  await readState('Escape后');
} catch (e) { log('异常:', e.message); }
await page.close().catch(() => {});
