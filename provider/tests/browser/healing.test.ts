/**
 * Phase 3 browser tests: rule learning/promotion, historical signal,
 * UI fingerprinting, major-redesign recovery (spec §12–§14, §37).
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
import { RuleRegistry } from '../../src/healing/registry.js';
import { computeUiFingerprint, saveFingerprint, fingerprintChangeSinceLast } from '../../src/healing/fingerprint.js';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'healing-test-'));
  return path.join(dir, 'bridge.db');
}

test('successful interactions learn rules: PROBATION → STABLE (3 successes)', async () => {
  const dbPath = tempDb();
  const page = await openFixture(browser, base, 'fixture-v1.html');
  const persistence = new Persistence({ dbPath });
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const client = new ChatGPTClient(page, engine, {
    timeoutMs: 10_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
    persistence,
  });

  for (let i = 1; i <= 3; i++) {
    const r = await client.chat([{ role: 'user', content: `learn round ${i}` }], { hermesSessionId: `learn-${i}` });
    expect(r.content).toContain('fixture-v1 response');
  }

  const rows = persistence.db
    .prepare("SELECT capability, status, success_count, failure_count FROM ui_rules ORDER BY capability")
    .all() as Array<{ capability: string; status: string; success_count: number; failure_count: number }>;
  const composer = rows.find((r) => r.capability === 'composer');
  const submit = rows.find((r) => r.capability === 'submit_control');
  expect(composer).toBeTruthy();
  expect(submit).toBeTruthy();
  expect(composer!.status).toBe('stable'); // 3 successes promoted it
  expect(composer!.success_count).toBe(3);
  expect(submit!.status).toBe('stable');
  persistence.close();
  await page.context().close();
});

test('persisted rules give the historical-success signal', async () => {
  const dbPath = tempDb();
  const page = await openFixture(browser, base, 'fixture-v1.html');
  const persistence = new Persistence({ dbPath });

  // Seed a stable rule matching fixture-v1's composer (same signature).
  const registry = new RuleRegistry(persistence);
  const rec = registry.discover(
    'composer',
    {
      version: 1,
      selectors: ['#prompt-textarea'],
      profile: { tag: 'div', contenteditable: true, placeholder: 'Message ChatGPT' },
    },
    '',
    0.9,
  );
  registry.promoteToProbation(rec.rule_id);
  for (let i = 0; i < 3; i++) registry.recordSuccess(rec.rule_id);

  const engine = new LocatorEngine({ hints: loadConfig().uiHints, registry });
  const result = await engine.findComposer(page);
  expect(result).not.toBeNull();
  expect(result!.ruleId).toBe(rec.rule_id);
  expect(result!.matched).toContain('historical');
  expect(result!.score).toBeGreaterThanOrEqual(0.9);

  persistence.close();
  await page.context().close();
});

test('failing probation rules roll back to failed (never stable)', async () => {
  const dbPath = tempDb();
  const persistence = new Persistence({ dbPath });
  const registry = new RuleRegistry(persistence);
  const rec = registry.discover(
    'composer',
    { version: 1, selectors: [], profile: { tag: 'div', contenteditable: true } },
    '',
    0.8,
  );
  registry.promoteToProbation(rec.rule_id);
  registry.recordFailure(rec.rule_id);
  const after = registry.recordFailure(rec.rule_id)!;
  expect(after.status).toBe('failed');
  expect(registry.listActive('composer')).toHaveLength(0); // rolled back
  persistence.close();
});

test('UI fingerprint: stable on same page, differs across redesigns, persisted', async () => {
  const dbPath = tempDb();
  const persistence = new Persistence({ dbPath });
  const pageV1 = await openFixture(browser, base, 'fixture-v1.html');
  const pageV6 = await openFixture(browser, base, 'fixture-v6-redesigned.html');

  const fp1a = await computeUiFingerprint(pageV1);
  const fp1b = await computeUiFingerprint(pageV1);
  const fp6 = await computeUiFingerprint(pageV6);

  expect(fp1a.hash).toBe(fp1b.hash); // stable across reads
  expect(fp1a.hash).not.toBe(fp6.hash); // redesign changes the fingerprint
  expect(fp1a.features.composer?.editable).toBe(true);
  expect(fp6.features.composer?.tag).toBe('textarea');

  expect(fingerprintChangeSinceLast(persistence, fp1a)).toBe(true);
  saveFingerprint(persistence, fp1a);
  expect(fingerprintChangeSinceLast(persistence, fp1a)).toBe(false);
  expect(fingerprintChangeSinceLast(persistence, fp6)).toBe(true);

  persistence.close();
  await pageV1.context().close();
  await pageV6.context().close();
});
