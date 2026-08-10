// UI 侦察（快跑版）：模型选择器 / Deep Research / 图片生成 入口探测
// 用法: node scripts/recon-fast.mjs
import { chromium } from 'playwright';

const CDP = 'http://127.0.0.1:9233';
const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
// 新标签页侦察，绝不动 adapter 正在用的页面
const page = await ctx.newPage();
page.setDefaultTimeout(15000);

const log = (...a) => console.log('[RECON]', ...a);

try {
  log('导航到 chatgpt.com ...');
  await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 等 composer 出现（登录态正常时会有）
  let composerOk = false;
  for (let i = 0; i < 20; i++) {
    const c = await page.locator('#prompt-textarea, [contenteditable="true"]').count().catch(() => 0);
    if (c > 0) { composerOk = true; break; }
    await page.waitForTimeout(1500);
  }
  log('composer 就绪:', composerOk);
  if (!composerOk) {
    log('可能未登录或被风控，页面URL:', page.url());
    await page.screenshot({ path: 'docs/ui-recon-screenshots/00-landing.png' }).catch(() => {});
    process.exit(1);
  }

  // ── 1. composer 区域所有按钮/可点元素的特征 ──
  log('== composer 区域按钮特征 ==');
  const composerBtns = await page.evaluate(() => {
    const out = [];
    const qs = ['button', '[role="button"]', 'a[role="button"]', '[data-testid]'];
    const seen = new Set();
    for (const q of qs) {
      for (const el of document.querySelectorAll(q)) {
        const r = el.getBoundingClientRect();
        const w = el;
        const t = (w.innerText || w.getAttribute('aria-label') || w.getAttribute('data-testid') || '').trim().slice(0, 60);
        if (r.width > 0 && r.height > 0 && t && !seen.has(t)) {
          seen.add(t);
          out.push({
            tag: el.tagName,
            testid: w.getAttribute('data-testid'),
            aria: w.getAttribute('aria-label'),
            text: w.innerText?.trim().slice(0, 40) || '',
            title: w.getAttribute('title'),
            cls: (w.className || '').toString().slice(0, 60),
          });
        }
      }
    }
    return out.slice(0, 60);
  });
  log('按钮清单(前60):');
  composerBtns.forEach((b, i) => log(`  [${i}] tag=${b.tag} testid=${b.testid ?? '-'} aria=${b.aria ?? '-'} text=${b.text || '-'} title=${b.title ?? '-'}`));

  // ── 2. 模型选择器：找特征按钮（常见: composer-model-selector / 模型名文本） ──
  log('== 模型选择器探测 ==');
  const modelBtnHints = ['[data-testid="composer-model-selector"]', '[data-testid="model-selector"]', 'button[aria-label*="model" i]', 'button[aria-label*="模型"]'];
  let modelBtn = null;
  for (const sel of modelBtnHints) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (n > 0) { modelBtn = page.locator(sel).first(); log('hint 命中:', sel); break; }
  }
  if (!modelBtn) {
    // 语义 fallback：composer 附近文本含模型名（GPT-5 / GPT-4o 等）的按钮
    modelBtn = page.locator('button', { hasText: /GPT/i }).first();
    if (await modelBtn.count()) log('语义命中: button[hasText=GPT]');
    else log('未找到模型按钮 — 需要人工确认');
  }
  if (await modelBtn.count()) {
    await modelBtn.click().catch(() => log('模型按钮点击失败'));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'docs/ui-recon-screenshots/01-model-menu.png' }).catch(() => {});
    // dump 弹出菜单/列表
    const items = await page.evaluate(() => {
      const out = [];
      // 常见菜单容器特征
      for (const el of document.querySelectorAll('[role="menu"] *, [role="listbox"] *, [data-testid*="model" i] *')) {
        const w = el;
        const t = (w.innerText || '').trim();
        const sel = w.getAttribute('aria-selected') ?? w.getAttribute('data-selected') ?? '';
        if (t && t.length < 80 && t.length > 1) out.push({ text: t, selected: sel, cls: (w.className || '').toString().slice(0, 40) });
      }
      return out.slice(0, 40);
    });
    log('模型菜单项:');
    items.forEach((it, i) => log(`  [${i}] ${it.text} selected=${it.selected} cls=${it.cls}`));
    // 收起
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }

  // ── 3. Deep Research / 图片生成入口：composer 工具按钮区 ──
  log('== Deep Research & 图片入口探测 ==');
  const toolHints = ['[data-testid="composer-tools"]', '[data-testid="composer-tool-button"]', 'button[aria-label*="deep" i]', 'button[aria-label*="研究"]', 'button[aria-label*="image" i]', 'button[aria-label*="图片"]', 'button[aria-label*="generate" i]'];
  for (const sel of toolHints) {
    const n = await page.locator(sel).count().catch(() => 0);
    if (n > 0) log('工具入口 hint 命中:', sel, 'x', n);
  }
  // 语义：composer 周边 aria-label 含关键词的按钮
  const toolBtns = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button')) {
      const w = el;
      const aria = w.getAttribute('aria-label') || '';
      const t = (w.innerText || '').trim();
      if (aria && /deep|research|image|图片|研究|生成|imagine|dall/i.test(aria)) out.push({ aria, text: t.slice(0, 40), testid: w.getAttribute('data-testid') });
    }
    return out;
  });
  log('含关键词按钮:');
  toolBtns.forEach((b, i) => log(`  [${i}] aria=${b.aria} text=${b.text || '-'} testid=${b.testid ?? '-'}`));

  await page.screenshot({ path: 'docs/ui-recon-screenshots/02-composer.png' }).catch(() => {});
  log('侦察完成，页面标题:', await page.title());
} catch (e) {
  log('侦察异常:', e.message);
  await page.screenshot({ path: 'docs/ui-recon-screenshots/99-error.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}
