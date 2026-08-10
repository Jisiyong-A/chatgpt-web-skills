// UI 交互侦察：点击"高"(思考级别) / "+"(附件) / "工作"标签，dump 弹出内容
// 用法: node scripts/recon-interact.mjs
import { chromium } from 'playwright';

const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
const log = (...a) => console.log('[RECON]', ...a);

const dumpVisible = async (label) => {
  // dump 所有可见且有文本的元素（菜单/弹层内容）
  const items = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role="menuitem"], [role="option"], [role="tab"], a, [data-testid]')) {
      const w = el;
      const r = w.getBoundingClientRect();
      const t = (w.innerText || w.getAttribute('aria-label') || w.getAttribute('data-testid') || '').trim();
      if (r.width > 0 && r.height > 0 && t && t.length < 100) {
        out.push({ tag: el.tagName, testid: w.getAttribute('data-testid') ?? '', aria: w.getAttribute('aria-label') ?? '', text: w.innerText?.trim().slice(0, 50) || '', role: w.getAttribute('role') ?? '' });
      }
    }
    return out;
  });
  log(`== ${label} ==`);
  items.forEach((it, i) => log(`  [${i}] ${it.tag} role=${it.role || '-'} testid=${it.testid || '-'} aria=${it.aria || '-'} text=${it.text || '-'}`));
  return items;
};

const pressEsc = async () => { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(600); };

try {
  log('打开 chatgpt.com ...');
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let ok = false;
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#prompt-textarea, [contenteditable="true"]').count()) { ok = true; break; }
    await page.waitForTimeout(1500);
  }
  log('composer 就绪:', ok);
  if (!ok) process.exit(1);
  await page.waitForTimeout(1000);

  // ── A. 点"高"(思考级别)按钮 ──
  const reasonBtn = page.locator('button', { hasText: /^高$|思考|reason/i }).first();
  if (await reasonBtn.count()) {
    log('点击思考级别按钮...');
    await reasonBtn.click().catch((e) => log('点击失败:', e.message));
    await page.waitForTimeout(1200);
    await dumpVisible('A. 思考级别菜单');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/10-reasoning-menu.png' }).catch(() => {});
    await pressEsc();
  } else {
    log('未找到思考级别按钮');
  }

  // ── B. 点"+"(composer-plus-btn) ──
  const plusBtn = page.locator('[data-testid="composer-plus-btn"]').first();
  if (await plusBtn.count()) {
    log('点击 + 按钮...');
    await plusBtn.click().catch((e) => log('点击失败:', e.message));
    await page.waitForTimeout(1200);
    await dumpVisible('B. + 附件菜单');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/11-plus-menu.png' }).catch(() => {});
    await pressEsc();
  }

  // ── C. 点顶部"工作"标签 ──
  const workTab = page.locator('[role="tab"], button', { hasText: /^工作$|^Work$/i }).first();
  if (await workTab.count()) {
    log('点击"工作"标签...');
    await workTab.click().catch((e) => log('点击失败:', e.message));
    await page.waitForTimeout(1500);
    await dumpVisible('C. 工作视图');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/12-work-view.png' }).catch(() => {});
    // 切回聊天
    const chatTab = page.locator('[role="tab"], button', { hasText: /^聊天$|^Chat$/i }).first();
    if (await chatTab.count()) await chatTab.click().catch(() => {});
    await page.waitForTimeout(1000);
  }

  // ── D. 对话页里找模型/Deep Research：新建对话后看 composer 上方 ──
  const newChat = page.locator('[data-testid="create-new-chat-button"]').first();
  if (await newChat.count()) {
    log('点击新建对话...');
    await newChat.click().catch(() => {});
    await page.waitForTimeout(1500);
    await dumpVisible('D. 新对话 composer 区');
    await page.screenshot({ path: 'docs/ui-recon-screenshots/13-fresh-composer.png' }).catch(() => {});
  }

  log('交互侦察完成');
} catch (e) {
  log('侦察异常:', e.message);
  await page.screenshot({ path: 'docs/ui-recon-screenshots/99-error2.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
