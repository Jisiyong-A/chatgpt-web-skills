import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9233');
const pages = b.contexts().flatMap(c => c.pages());
console.log('pages:', pages.map(p => p.url().slice(0, 50)).join(' | '));
for (const p of pages) {
  if (p.url().includes('chatgpt.com')) {
    const s = await p.evaluate(() => ({
      title: document.title.slice(0, 40),
      hasLogin: !!document.querySelector('button[data-testid="login-button"], a[href*="auth/login"]'),
      hasComposer: !!document.querySelector('#prompt-textarea, [contenteditable="true"], textarea'),
      msgCount: document.querySelectorAll('[data-message-author-role]').length,
    })).catch(e => ({ err: String(e).slice(0, 80) }));
    console.log('chatgpt page:', JSON.stringify(s));
  }
}
await b.close();
