/**
 * Phase 4 browser tests: self-healing recovery pipeline (spec §4, §33, §37).
 * - bare composer (no semantic clues) is discovered + validated + activated
 * - fake composer (input wiped) never activates → UI_UNKNOWN
 */

import { test, expect } from '@playwright/test';
import { pino } from 'pino';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright';
import { launchBrowser, openFixture, startFixtureServer } from './helpers.js';
import { LocatorEngine } from '../../src/semantic/locator-engine.js';
import { ChatGPTClient } from '../../src/chatgpt/client.js';
import { Persistence } from '../../src/persistence/sqlite.js';
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

function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heal4-test-'));
  return path.join(dir, 'bridge.db');
}

test('bare composer is recovered: validated, activated, learned as a rule', async () => {
  const dbPath = tempDb();
  const page = await openFixture(browser, base, 'fixture-v7-bare-composer.html');
  const persistence = new Persistence({ dbPath });
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });

  // Sanity: the normal path MUST fail on this page (score below threshold).
  const direct = await engine.findComposer(page);
  expect(direct).toBeNull();

  const client = new ChatGPTClient(page, engine, {
    timeoutMs: 10_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
    persistence,
  });
  const result = await client.chat([{ role: 'user', content: 'recover me' }], { hermesSessionId: 'heal4' });

  expect(result.content).toContain('fixture-v7 response');
  expect(client.sm.state).toBe('READY');

  // A probation rule was learned + a healing event recorded.
  const rule = persistence.db
    .prepare("SELECT status, success_count FROM ui_rules WHERE capability='composer' ORDER BY created_at DESC LIMIT 1")
    .get() as { status: string; success_count: number } | undefined;
  expect(rule).toBeTruthy();
  expect(rule!.status).toBe('probation');
  expect(rule!.success_count).toBeGreaterThanOrEqual(1);

  const events = persistence.db.prepare("SELECT kind FROM healing_events WHERE kind='composer_recovered'").all();
  expect(events.length).toBeGreaterThanOrEqual(1);

  persistence.close();
  await page.context().close();
});

test('fake composer never activates: recovery fails closed with UI_UNKNOWN', async () => {
  const dbPath = tempDb();
  const page = await openFixture(browser, base, 'fixture-v7b-fake-composer.html');
  const persistence = new Persistence({ dbPath });
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const client = new ChatGPTClient(page, engine, {
    timeoutMs: 8000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
    persistence,
  });

  await expect(
    client.chat([{ role: 'user', content: 'try me' }], { hermesSessionId: 'heal4-bad' }),
  ).rejects.toMatchObject({ code: 'UI_UNKNOWN' });

  // No rule was learned from the fake composer, and a failure event exists.
  const rules = persistence.db.prepare("SELECT COUNT(*) c FROM ui_rules WHERE capability='composer'").get() as { c: number };
  expect(rules.c).toBe(0);
  const events = persistence.db.prepare("SELECT COUNT(*) c FROM healing_events WHERE kind='composer_recovery_failed'").get() as { c: number };
  expect(events.c).toBeGreaterThanOrEqual(1);

  persistence.close();
  await page.context().close();
});
