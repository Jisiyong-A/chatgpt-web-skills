// 把所有 ChatGPT 页面切回聊天视图（点"聊天"radio）
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
for (const page of ctx.pages()) {
  try {
    const url = page.url();
    if (!url.includes('chatgpt.com')) continue;
    const switched = await page.evaluate(() => {
      const radios = [...document.querySelectorAll('[role="radio"]')];
      const work = radios.find(r => /^工作$/.test((r.innerText || '').trim()) && (r.getAttribute('aria-checked') === 'true' || r.getAttribute('aria-checked') === 'checked'));
      const chat = radios.find(r => /^聊天$/.test((r.innerText || '').trim()));
      if (work && chat) { chat.click(); return 'switched'; }
      return work ? 'work-active-no-chat' : 'already-chat-or-unknown';
    });
    console.log(`[${url.slice(0, 50)}] → ${switched}`);
    await page.waitForTimeout(1500);
  } catch (e) { console.log('skip:', e.message.slice(0, 50)); }
}
