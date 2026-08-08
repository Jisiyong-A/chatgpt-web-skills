/**
 * Streaming chat completions (spec §30): sentence-buffered SSE.
 * Only COMPLETED sentences are emitted — the webpage may rewrite DOM, so raw
 * token deltas are deliberately NOT streamed.
 *
 * Tool rounds (tools declared): text deltas are buffered/emitted normally
 * until a <HERMES_TOOL_CALL> envelope appears; from that moment text emission
 * is suppressed, and on completion the tool_calls are delivered as an
 * OpenAI-format streaming chunk (finish_reason "tool_calls").
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { AdapterError } from '../chatgpt/errors.js';
import type { ChatGPTClient } from '../chatgpt/client.js';
import { SentenceBuffer, chunkBody } from './streaming.js';
import { validateChatCompletions } from './chat-completions.js';

const ENVELOPE_RE = /<[^>]*hermes_tool_call[^>]*>/i;

export async function handleStreamingChatCompletions(
  req: FastifyRequest<{ Body: unknown }>,
  reply: FastifyReply,
  client: ChatGPTClient,
): Promise<void> {
  const body = validateChatCompletions(req.body);
  const headerSession = req.headers['x-hermes-session-id'];
  const bodyUser = typeof body.user === 'string' && body.user ? body.user : undefined;
  const hermesSessionId = (Array.isArray(headerSession) ? headerSession[0] : headerSession) ?? bodyUser;
  const toolMode = !!body.tools && body.tools.length > 0;

  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const id = `chatgpt-web-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const model = body.model;

  const send = (payload: string) => {
    raw.write(`data: ${payload}\n\n`);
  };

  // Role preamble.
  send(chunkBody({ id, created, model, delta: { role: 'assistant' }, finish_reason: null }));

  const buffer = new SentenceBuffer();
  let suppressText = false;
  let streamError: string | null = null;
  let result: Awaited<ReturnType<ChatGPTClient['chat']>> | null = null;
  try {
    result = await client.chat(body.messages, {
      hermesSessionId,
      tools: body.tools?.map((t) => ({ name: t.function.name, parameters: t.function.parameters })),
      onDelta: (text: string) => {
        if (toolMode && ENVELOPE_RE.test(text)) {
          suppressText = true; // a tool call is coming; stop emitting text
          return;
        }
        if (!suppressText) {
          for (const sentence of buffer.feed(text)) {
            send(chunkBody({ id, created, model, delta: { content: sentence }, finish_reason: null }));
          }
        }
      },
    });
    // Flush any held-back tail now that the response is complete.
    if (!suppressText) {
      for (const sentence of buffer.feed(`${result.content}\n`)) {
        send(chunkBody({ id, created, model, delta: { content: sentence }, finish_reason: null }));
      }
    }
  } catch (err) {
    streamError = err instanceof AdapterError ? err.code : 'STREAM_INTERNAL_ERROR';
  }

  if (streamError) {
    send(chunkBody({ id, created, model, delta: {}, finish_reason: null }));
    send(
      JSON.stringify({
        error: { message: `stream failed: ${streamError}`, type: 'adapter_error', code: streamError },
      }),
    );
  } else if (result?.toolCalls?.length) {
    // OpenAI streaming tool_calls delta (full arguments in one chunk).
    send(
      chunkBody({
        id,
        created,
        model,
        delta: {
          tool_calls: result.toolCalls.map((tc, i) => ({
            index: i,
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        },
        finish_reason: null,
      }),
    );
    send(chunkBody({ id, created, model, delta: {}, finish_reason: 'tool_calls' }));
    send('[DONE]');
  } else {
    send(chunkBody({ id, created, model, delta: {}, finish_reason: 'stop' }));
    send('[DONE]');
  }
  raw.end();
}
