// 扫描所有打开的 ChatGPT 页面：是否有深度研究报告 + prompt 匹配性
import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9233');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
for (const page of pages) {
  try {
    const info = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const prompt = '2025年东京都市更新的三个主要项目方向是什么？简述';
      const idx = body.lastIndexOf(prompt);
      const tail = idx >= 0 ? body.slice(idx + prompt.length) : '';
      const hasReport = /东京Torch|涩谷|麻布台|都市更新|中城/i.test(body);
      return {
        url: location.href.slice(0, 80),
        bodyLen: body.length,
        promptFound: idx >= 0,
        tailLen: tail.length,
        tailHead: tail.slice(0, 150),
        hasReportText: hasReport,
      };
    }).catch(() => null);
    console.log(JSON.stringify(info));
  } catch { /* ignore */ }
}
