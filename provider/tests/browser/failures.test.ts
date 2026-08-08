/**
 * Browser fixture tests — failure paths (spec §36).
 * Expected behavior: no unsafe click, correct error state.
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

async function expectFailure(fixture: string, expectedCode: string) {
  const page = await openFixture(browser, base, fixture);
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const client = new ChatGPTClient(page, engine, {
    timeoutMs: 6000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
  });
  try {
    await client.chat([{ role: 'user', content: 'hello' }]);
    // eslint-disable-next-line playwright/no-standalone-expect
    expect.unreachable('expected chat() to reject');
  } catch (err) {
    const code = (err as { code?: string }).code;
    expect(code).toBe(expectedCode);
  } finally {
    await page.context().close();
  }
}

test('login page → AUTH_REQUIRED (401), no interaction', async () => {
  await expectFailure('fixture-login.html', 'AUTH_REQUIRED');
});

test('rate-limit banner → RATE_LIMITED (429)', async () => {
  await expectFailure('fixture-rate-limit.html', 'RATE_LIMITED');
});

test('captcha / human verification → HUMAN_REQUIRED (503)', async () => {
  await expectFailure('fixture-captcha.html', 'HUMAN_REQUIRED');
});

test('no composer → UI_UNKNOWN (503)', async () => {
  await expectFailure('fixture-no-composer.html', 'UI_UNKNOWN');
});

test('two ambiguous composers → UI_UNKNOWN (503), never guesses', async () => {
  const page = await openFixture(browser, base, 'fixture-two-composers.html');
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const composer = await engine.findComposer(page);
  expect(composer).toBeNull(); // ambiguous → refuse
  await page.context().close();
});

test('server error during generation → CHATGPT_UNAVAILABLE (503)', async () => {
  await expectFailure('fixture-server-error.html', 'CHATGPT_UNAVAILABLE');
});

test('generation never completes → GENERATION_TIMEOUT (504)', async () => {
  await expectFailure('fixture-generation-timeout.html', 'GENERATION_TIMEOUT');
});
