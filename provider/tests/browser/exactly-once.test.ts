/**
 * Phase 2 browser tests: durable exactly-once, crash resume, replay,
 * context divergence → fresh thread (spec §17, §19, §20, §21).
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-test-'));
  return path.join(dir, 'bridge.db');
}

const SESSION = 'hermes-session-test-1';

test('crash after submit → restart resumes without duplicate (fault injection)', async () => {
  const dbPath = tempDb();
  const page = await openFixture(browser, base, 'fixture-slow-response.html');
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const prompt = 'What is the capital of France?';

  // "Process A": submits the prompt, then dies (generation timeout, never completes).
  const persistenceA = new Persistence({ dbPath });
  const clientA = new ChatGPTClient(page, engine, {
    timeoutMs: 1500,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
    persistence: persistenceA,
  });
  await expect(
    clientA.chat([{ role: 'user', content: prompt }], { hermesSessionId: SESSION }),
  ).rejects.toMatchObject({ code: 'GENERATION_TIMEOUT' });

  // The prompt IS in the thread and the request is durably SUBMITTED.
  // (New-session isolation opened a fresh thread, so only our prompt exists.)
  const userCountAfterA = await page.locator('[data-message-author-role="user"]').count();
  expect(userCountAfterA).toBe(1);

  // "Process B": same DB, same page (process restart). Must resume, NOT resubmit.
  const persistenceB = new Persistence({ dbPath });
  const clientB = new ChatGPTClient(page, engine, {
    timeoutMs: 15_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
    persistence: persistenceB,
  });
  const result = await clientB.chat([{ role: 'user', content: prompt }], { hermesSessionId: SESSION });

  expect(result.resumed).toBe(true);
  expect(result.content).toContain('fixture-slow response');
  expect(result.content).toContain('France');

  // No duplicate: still exactly ONE user message with the prompt.
  const texts = await page.locator('[data-message-author-role="user"]').allInnerTexts();
  const promptMatches = texts.filter((t) => t.includes(prompt));
  expect(promptMatches).toHaveLength(1);

  // DB: the request is COMPLETED with the stored response.
  const check = new Persistence({ dbPath });
  const row = check.db.prepare('SELECT state, response_text FROM requests WHERE hermes_session_id = ?').get(SESSION) as
    | { state: string; response_text: string }
    | undefined;
  expect(row?.state).toBe('COMPLETED');
  expect(row?.response_text).toContain('fixture-slow response');
  check.close();
  persistenceA.close();
  persistenceB.close();
  await page.context().close();
});

test('completed request replays stored response — no new typing', async () => {
  const dbPath = tempDb();
  const page = await openFixture(browser, base, 'fixture-v1.html');
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const prompt = 'repeat this request';

  const p1 = new Persistence({ dbPath });
  const c1 = new ChatGPTClient(page, engine, {
    timeoutMs: 10_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
    persistence: p1,
  });
  const first = await c1.chat([{ role: 'user', content: prompt }], { hermesSessionId: SESSION });
  expect(first.content).toContain('fixture-v1 response');

  const p2 = new Persistence({ dbPath });
  const c2 = new ChatGPTClient(page, engine, {
    timeoutMs: 10_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
    persistence: p2,
  });
  const second = await c2.chat([{ role: 'user', content: prompt }], { hermesSessionId: SESSION });

  expect(second.replay).toBe(true);
  expect(second.content).toBe(first.content);

  const texts = await page.locator('[data-message-author-role="user"]').allInnerTexts();
  expect(texts.filter((t) => t.includes(prompt))).toHaveLength(1); // no second submission
  p1.close();
  p2.close();
  await page.context().close();
});

test('context divergence creates a fresh thread with the canonical envelope', async () => {
  const dbPath = tempDb();
  const page = await openFixture(browser, base, 'fixture-fresh-thread.html');
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const persistence = new Persistence({ dbPath });
  const client = new ChatGPTClient(page, engine, {
    timeoutMs: 10_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
    persistence,
  });

  // 1. First request (fresh session) — delta baseline.
  const r1 = await client.chat([{ role: 'user', content: 'first question' }], { hermesSessionId: 'sess-div' });
  expect(r1.divergence).toBeFalsy();
  expect(r1.content).toContain('first question');

  // 2. Extension: same history + delta → same thread continues.
  const r2 = await client.chat(
    [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' },
    ],
    { hermesSessionId: 'sess-div' },
  );
  expect(r2.divergence).toBeFalsy();
  let userCount = await page.locator('[data-message-author-role="user"]').count();
  // Fresh-session isolation cleared the fixture's seed messages; the mapped
  // thread now holds first + second (same thread).
  expect(userCount).toBe(2);

  // 3. Divergence: history no longer starts with previous → fresh thread + envelope.
  const r3 = await client.chat(
    [
      { role: 'system', content: 'compressed summary of everything' },
      { role: 'user', content: 'third question' },
    ],
    { hermesSessionId: 'sess-div' },
  );
  expect(r3.divergence).toBe(true);
  expect(r3.content).toContain('fresh-thread response');

  userCount = await page.locator('[data-message-author-role="user"]').count();
  expect(userCount).toBe(1); // fresh conversation: only the envelope message
  const userTexts = await page.locator('[data-message-author-role="user"]').allInnerTexts();
  expect(userTexts[0]).toContain('[HERMES_CONTEXT v1]');
  // SYSTEM instructions are deliberately excluded (Hermes owns agent context);
  // the conversation + current request are what the web model needs.
  expect(userTexts[0]).not.toContain('SYSTEM / DEVELOPER INSTRUCTIONS:');
  expect(userTexts[0]).not.toContain('compressed summary of everything');
  expect(userTexts[0]).toContain('CURRENT USER REQUEST:');
  expect(userTexts[0]).toContain('third question');

  // 4. After divergence, the new thread is the sync base → delta continues there.
  const r4 = await client.chat(
    [
      { role: 'system', content: 'compressed summary of everything' },
      { role: 'user', content: 'third question' },
      { role: 'assistant', content: 'third answer' },
      { role: 'user', content: 'fourth question' },
    ],
    { hermesSessionId: 'sess-div' },
  );
  expect(r4.divergence).toBeFalsy();
  expect(await page.locator('[data-message-author-role="user"]').count()).toBe(2); // envelope + fourth

  // Session row: generation bumped after divergence.
  const row = persistence.db.prepare('SELECT generation, status FROM sessions WHERE hermes_session_id = ?').get('sess-div') as
    | { generation: number; status: string }
    | undefined;
  expect(row?.generation).toBe(1);
  expect(row?.status).toBe('active');

  persistence.close();
  await page.context().close();
});
