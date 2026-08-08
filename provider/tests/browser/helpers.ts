/**
 * Shared browser-test helpers: launch system Chrome via Playwright and serve
 * the local fixture pages. Hermetic — no ChatGPT login or network needed.
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export async function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    const name = (req.url ?? '/').split('?')[0]!.replace(/^\//, '') || 'fixture-v1.html';
    try {
      const content = await readFile(path.join(fixturesDir, name));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({ channel: 'chrome', headless: true });
}

export async function openFixture(
  browser: Browser,
  base: string,
  fixture: string,
): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/${fixture}`, { waitUntil: 'load' });
  return page;
}
