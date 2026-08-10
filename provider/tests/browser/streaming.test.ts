/**
 * Phase 6 streaming tests: sentence-buffered deltas via client.onDelta and
 * the SSE handler format (fastify inject with a stubbed client).
 */

import { test, expect } from '@playwright/test';
import { pino } from 'pino';
import type { Browser } from 'playwright';
import { launchBrowser, openFixture, startFixtureServer } from './helpers.js';
import { LocatorEngine } from '../../src/semantic/locator-engine.js';
import { ChatGPTClient } from '../../src/chatgpt/client.js';
import { loadConfig } from '../../src/config.js';
import { buildServer } from '../../src/api/server.js';
import { buildToolProtocolInstructions } from '../../src/hermes/tools.js';

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

test('streaming: onDelta receives monotonically growing text', async () => {
  const page = await openFixture(browser, base, 'fixture-v9-streaming.html');
  const engine = new LocatorEngine({ hints: loadConfig().uiHints });
  const client = new ChatGPTClient(page, engine, {
    timeoutMs: 15_000,
    responseStableMs: 500,
    allowNonChatGPT: true,
    logger: quiet,
  });

  const samples: string[] = [];
  const result = await client.chat([{ role: 'user', content: 'stream it' }], {
    onDelta: (t) => samples.push(t),
  });

  expect(result.content).toContain('first sentence');
  expect(result.content).toContain('third sentence');
  // Samples must grow monotonically (sentence-by-sentence fixture).
  expect(samples.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]!.length).toBeGreaterThanOrEqual(samples[i - 1]!.length);
  }
  expect(samples[samples.length - 1]).toBe(result.content);
  await page.context().close();
});

test('SSE handler: tool round streams tool_calls delta + finish tool_calls', async () => {
  const stubClient = {
    sm: { state: 'READY' },
    detectAuthState: async () => ({ auth: 'authenticated', reason: 'stub' }),
    chat: async (_messages: unknown, opts: { onDelta?: (t: string) => void } = {}) => {
      opts.onDelta?.('Let me look that up.\n<HERMES_TOOL_CALL>{"name":"web_search","arguments":{"query":"x"}}</HERMES_TOOL_CALL>');
      await new Promise((r) => setTimeout(r, 10));
      return {
        content: '',
        id: 'stub-2',
        created: 1,
        model: 'chatgpt-web',
        latencyMs: 1,
        states: [],
        composerRuleScore: null,
        submitRuleScore: null,
        signals: [],
        toolCalls: [
          { id: 'call_x', type: 'function' as const, function: { name: 'web_search', arguments: '{"query":"x"}' } },
        ],
      };
    },
  } as unknown as ChatGPTClient;

  const app = await buildServer({
    config: loadConfig(),
    logger: quiet,
    client: () => stubClient,
    chrome: null,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: {
      model: 'chatgpt-web',
      messages: [{ role: 'user', content: 'search' }],
      stream: true,
      tools: [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object' } } }],
    },
  });
  await app.close();

  expect(res.statusCode).toBe(200);
  const lines = res.body.split('\n').filter((l) => l.startsWith('data: '));
  const parsed = lines
    .filter((l) => !l.includes('[DONE]'))
    .map((l) => JSON.parse(l.slice(6).trim()) as {
    choices: Array<{ delta: { content?: string; tool_calls?: Array<{ index: number; function: { name: string } }> }; finish_reason: string | null }>;
  });
  // Text emission stopped at the envelope; no content deltas with prose+envelope.
  const textChunks = parsed.flatMap((p) => p.choices[0]!.delta.content ?? []);
  expect(textChunks.some((c) => c.includes('HERMES_TOOL_CALL'))).toBeFalsy();
  const toolChunks = parsed.flatMap((p) => p.choices[0]!.delta.tool_calls ?? []);
  expect(toolChunks.some((t) => t.function.name === 'web_search')).toBeTruthy();
  expect(parsed[parsed.length - 1]!.choices[0]!.finish_reason).toBe('tool_calls');
  expect(lines.some((l) => l.includes('[DONE]'))).toBeTruthy();
});

test('SSE handler emits OpenAI chunk format + [DONE] (stubbed client)', async () => {
  // Stub client: emits two deltas through onDelta, returns final content.
  const stubClient = {
    sm: { state: 'READY' },
    detectAuthState: async () => ({ auth: 'authenticated', reason: 'stub' }),
    chat: async (
      _messages: unknown,
      opts: { onDelta?: (t: string) => void } = {},
    ) => {
      opts.onDelta?.('Hello world.');
      opts.onDelta?.('Hello world.Second sentence!');
      await new Promise((r) => setTimeout(r, 10));
      return {
        content: 'Hello world.Second sentence!',
        id: 'stub-1',
        created: 1,
        model: 'chatgpt-web',
        latencyMs: 1,
        states: [],
        composerRuleScore: null,
        submitRuleScore: null,
        signals: [],
      };
    },
  } as unknown as ChatGPTClient;

  const app = await buildServer({
    config: loadConfig(),
    logger: quiet,
    client: () => stubClient,
    chrome: null,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    payload: { model: 'chatgpt-web', messages: [{ role: 'user', content: 'hi' }], stream: true },
  });
  await app.close();

  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/event-stream');
  const lines = res.body.split('\n').filter((l) => l.startsWith('data: '));
  const chunks = lines.map((l) => l.slice(6).trim()).filter((c) => c !== '[DONE]');
  const parsed = chunks.map((c) => JSON.parse(c) as { choices: Array<{ delta: { content?: string }; finish_reason: string | null }>; object: string });
  expect(parsed[0]!.object).toBe('chat.completion.chunk');
  // Deltas: role preamble, then sentence chunks, then finish.
  const contents = parsed.map((p) => p.choices[0]!.delta.content ?? '').filter(Boolean);
  expect(contents.join('')).toContain('Hello world.');
  expect(contents.join('')).toContain('Second sentence!');
  const last = parsed[parsed.length - 1]!;
  expect(last.choices[0]!.finish_reason).toBe('stop');
});
