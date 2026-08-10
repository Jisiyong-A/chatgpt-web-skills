/**
 * Responses API HTTP tests (Codex CLI compatibility): non-streaming JSON and
 * SSE stream shape via fastify inject with a stubbed client.
 */

import { test, expect } from '@playwright/test';
import { pino } from 'pino';
import { buildServer } from '../../src/api/server.js';
import { loadConfig } from '../../src/config.js';
import type { ChatGPTClient } from '../../src/chatgpt/client.js';

const quiet = pino({ level: 'silent' });

function stubClient(replyText: string, opts: { toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> } = {}) {
  return {
    sm: { state: 'READY' },
    detectAuthState: async () => ({ auth: 'authenticated', reason: 'stub' }),
    chat: async (_messages: unknown, callOpts: { onDelta?: (t: string) => void } = {}) => {
      if (callOpts.onDelta) {
        callOpts.onDelta?.(replyText);
      }
      await new Promise((r) => setTimeout(r, 5));
      return {
        content: replyText,
        id: 'stub-r',
        created: 1,
        model: 'chatgpt-web',
        latencyMs: 1,
        states: [],
        composerRuleScore: null,
        submitRuleScore: null,
        signals: [],
        toolCalls: opts.toolCalls,
      };
    },
  } as unknown as ChatGPTClient;
}

test('POST /v1/responses (non-streaming) returns Responses JSON', async () => {
  const app = await buildServer({
    config: loadConfig(),
    logger: quiet,
    client: () => stubClient('你好，我是 GPT。'),
    chrome: null,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/responses',
    payload: {
      model: 'chatgpt-web',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: '你是谁？' }] },
      ],
      instructions: '你是助手。',
    },
  });
  await app.close();

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.object).toBe('response');
  expect(body.status).toBe('completed');
  expect(body.output[0]!.type).toBe('message');
  expect(body.output[0]!.role).toBe('assistant');
  expect(body.output[0]!.content[0]!.type).toBe('output_text');
  expect(body.output[0]!.content[0]!.text).toBe('你好，我是 GPT。');
});

test('POST /v1/responses streams Codex lifecycle events + [done]', async () => {
  const app = await buildServer({
    config: loadConfig(),
    logger: quiet,
    client: () => stubClient('第一句。第二句！'),
    chrome: null,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/responses',
    payload: { model: 'chatgpt-web', input: 'hi', stream: true },
  });
  await app.close();

  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/event-stream');

  const events = res.body
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [, event] = b.match(/^event: (\S+)/)!;
      const [, data] = b.match(/^data: (.+)$/m)!;
      return { event, data: JSON.parse(data) };
    });

  const types = events.map((e) => e.event);
  expect(types).toContain('response.created');
  expect(types).toContain('response.output_item.added');
  expect(types).toContain('response.content_part.added');
  expect(types).toContain('response.output_text.delta');
  expect(types).toContain('response.output_text.done');
  expect(types).toContain('response.content_part.done');
  expect(types).toContain('response.output_item.done');
  expect(types).toContain('response.completed');
  expect(types[types.length - 1]).toBe('response.done');

  const text = events
    .filter((e) => e.event === 'response.output_text.delta')
    .map((e) => e.data.delta)
    .join('');
  expect(text).toBe('第一句。第二句！');

  const completed = events.find((e) => e.event === 'response.completed')!;
  expect(completed.data.response.status).toBe('completed');
  expect(completed.data.response.output[0]!.content[0]!.text).toBe('第一句。第二句！');
});

test('POST /v1/responses with tool output round-trips via envelope', async () => {
  const app = await buildServer({
    config: loadConfig(),
    logger: quiet,
    client: () => stubClient('thanks', {
      toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"x"}' } }],
    }),
    chrome: null,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/responses',
    payload: {
      model: 'chatgpt-web',
      input: [
        { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
        { role: 'user', content: '继续' },
      ],
    },
  });
  await app.close();

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  const fc = body.output.find((o: { type: string }) => o.type === 'function_call');
  expect(fc).toBeTruthy();
  expect(fc!.name).toBe('web_search');
});
