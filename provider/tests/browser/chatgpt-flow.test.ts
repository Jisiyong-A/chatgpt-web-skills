/**
 * Browser fixture tests — happy path (spec §36).
 * Five structurally different fake ChatGPT pages. The adapter must find the
 * composer, the submit control, the user message and the assistant response
 * in every variant without any code change.
 */

import { test, expect } from '@playwright/test';
import { pino } from 'pino';
import type { Browser } from 'playwright';
import { launchBrowser, openFixture, startFixtureServer } from './helpers.js';
import { LocatorEngine } from '../../src/semantic/locator-engine.js';
import { ChatGPTClient } from '../../src/chatgpt/client.js';
import { loadConfig } from '../../src/config.js';

let browser: Browser;
let base: string;
let closeServer: () => Promise<void>;

const quiet = pino({ level: 'silent' });

test.beforeAll(async () => {
  const srv = await startFixtureServer();
  base = srv.url;
  closeServer = srv.close;
  browser = await launchBrowser();
});

test.afterAll(async () => {
  await browser.close();
  await closeServer();
});

const CASES: Array<{ fixture: string; label: string; expectScoreSafe: boolean }> = [
  { fixture: 'fixture-v1.html', label: 'baseline', expectScoreSafe: true },
  { fixture: 'fixture-v2-dom-changed.html', label: 'textarea composer, class-based roles', expectScoreSafe: false },
  { fixture: 'fixture-v3-composer-changed.html', label: 'contenteditable in form, arrow button', expectScoreSafe: true },
  { fixture: 'fixture-v4-button-icon-only.html', label: 'icon-only submit', expectScoreSafe: true },
  { fixture: 'fixture-v5-layout-shifted.html', label: 'sidebar + docked composer', expectScoreSafe: true },
  { fixture: 'fixture-v6-redesigned.html', label: 'major redesign (semantic recovery)', expectScoreSafe: false },
];

for (const c of CASES) {
  test(`full flow works on ${c.label} (${c.fixture})`, async () => {
    const page = await openFixture(browser, base, c.fixture);
    const engine = new LocatorEngine({ hints: loadConfig().uiHints });
    const client = new ChatGPTClient(page, engine, {
      timeoutMs: 10_000,
      responseStableMs: 500,
      allowNonChatGPT: true,
      logger: quiet,
    });

    const result = await client.chat([{ role: 'user', content: 'What is the capital of France?' }]);

    expect(result.content).toContain('fixture-v');
    expect(result.content).toContain('France');
    expect(result.signals.some((s) => s.startsWith('stable_'))).toBe(true);
    expect(client.sm.state).toBe('READY');
    expect(result.composerRuleScore).toBeGreaterThanOrEqual(0.75);
    expect(result.submitRuleScore).toBeGreaterThanOrEqual(0.75);
    if (c.expectScoreSafe) {
      expect(result.composerRuleScore!).toBeGreaterThanOrEqual(0.9);
      expect(result.submitRuleScore!).toBeGreaterThanOrEqual(0.9);
    }
    await page.context().close();
  });
}

test('consecutive requests on the same page are paired correctly', async () => {
  const page = await openFixture(browser, base, 'fixture-v1.html');
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const client = new ChatGPTClient(page, engine, {
    timeoutMs: 10_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
  });

  const r1 = await client.chat([{ role: 'user', content: 'first question' }]);
  const r2 = await client.chat([{ role: 'user', content: 'second question' }]);
  const r3 = await client.chat([{ role: 'user', content: 'third question' }]);

  expect(r1.content).toContain('first question');
  expect(r2.content).toContain('second question');
  expect(r3.content).toContain('third question');
  await page.context().close();
});

test('concurrent requests are rejected (exactly-one-request-per-tab)', async () => {
  const page = await openFixture(browser, base, 'fixture-v1.html');
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const client = new ChatGPTClient(page, engine, {
    timeoutMs: 10_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
  });

  const p1 = client.chat([{ role: 'user', content: 'alpha' }]);
  await new Promise((r) => setTimeout(r, 300));
  await expect(client.chat([{ role: 'user', content: 'beta' }])).rejects.toMatchObject({
    code: 'REQUEST_IN_PROGRESS',
  });
  const r1 = await p1;
  expect(r1.content).toContain('alpha');
  await page.context().close();
});
