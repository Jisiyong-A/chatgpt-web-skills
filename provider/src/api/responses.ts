/**
 * OpenAI Responses API compatibility layer (Codex CLI 2026 uses wire_api
 * "responses" ONLY — /v1/chat/completions is no longer callable by Codex).
 *
 * Translates Responses-format requests into the adapter's internal chat
 * pipeline and emits Responses-format JSON or SSE stream. Text outputs only
 * (tool protocol envelopes map to function_call items).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AdapterError } from '../chatgpt/errors.js';
import type { ChatGPTClient, ChatMessage } from '../chatgpt/client.js';
import type { OpenAIToolCall } from '../hermes/tools.js';
import { SentenceBuffer } from './streaming.js';

// ---------------------------------------------------------------------------
// Input parsing (Responses → internal ChatMessage[])
// ---------------------------------------------------------------------------

const contentPartSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
});

const inputItemSchema = z.union([
  z.object({
    role: z.enum(['user', 'assistant', 'system', 'developer']),
    content: z.union([z.string(), z.array(contentPartSchema)]),
  }),
  z.object({
    type: z.literal('function_call_output'),
    call_id: z.string().optional(),
    output: z.string(),
  }),
]);

export const responsesSchema = z.object({
  model: z.string().optional().default('chatgpt-web'),
  input: z.union([z.string(), z.array(inputItemSchema)]),
  stream: z.boolean().optional().default(false),
  instructions: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  temperature: z.number().optional(),
  max_output_tokens: z.number().optional(),
  user: z.string().optional(),
  store: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  reasoning: z.unknown().optional(),
});

export type ResponsesRequest = z.infer<typeof responsesSchema>;

function contentToText(content: string | Array<{ text?: string }>): string {
  if (typeof content === 'string') return content;
  return content
    .map((p) => p.text ?? '')
    .join('\n');
}

export function responsesInputToMessages(input: ResponsesRequest['input']): ChatMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  const messages: ChatMessage[] = [];
  for (const item of input) {
    if ('type' in item && item.type === 'function_call_output') {
      // Tool results: wrap in the adapter's tool envelope so the web model
      // sees the result (phase 5 protocol).
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id ?? 'tool',
        content: item.output,
      });
    } else {
      const msgItem = item as { role: 'assistant' | 'developer' | 'system' | 'user'; content: string | Array<{ text?: string }> };
      const role = msgItem.role === 'developer' ? 'system' : msgItem.role;
      messages.push({ role, content: contentToText(msgItem.content) });
    }
  }
  // Codex sends instructions as a separate field → treat as system.
  return messages;
}

// ---------------------------------------------------------------------------
// Output formatting (internal ChatResult → Responses items)
// ---------------------------------------------------------------------------

function outputTextItem(id: string, text: string) {
  return {
    id,
    type: 'message' as const,
    status: 'completed' as const,
    role: 'assistant' as const,
    content: [{ type: 'output_text' as const, text, annotations: [] as unknown[] }],
  };
}

function functionCallItem(id: string, tc: OpenAIToolCall) {
  return {
    id,
    type: 'function_call' as const,
    status: 'completed' as const,
    call_id: tc.id,
    name: tc.function.name,
    arguments: tc.function.arguments,
  };
}

function buildResponse(
  id: string,
  model: string,
  text: string,
  toolCalls: OpenAIToolCall[] | undefined,
  status: 'completed' | 'in_progress',
  createdAt: number,
) {
  const output: unknown[] = [];
  if (toolCalls?.length) {
    for (const tc of toolCalls) output.push(functionCallItem(`fc_${tc.id}`, tc));
  }
  if (text) output.push(outputTextItem(`msg_${id}`, text));
  return {
    id,
    object: 'response',
    created_at: createdAt,
    status,
    model,
    output,
    parallel_tool_calls: true,
    tool_choice: 'auto',
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    _request_id: id,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleResponses(
  req: FastifyRequest<{ Body: unknown }>,
  reply: FastifyReply,
  client: ChatGPTClient,
): Promise<void> {
  const parsed = responsesSchema.safeParse(req.body);
  if (!parsed.success) {
    throw AdapterError.invalidRequest(`invalid responses request: ${parsed.error.issues[0]?.message ?? 'schema error'}`);
  }
  const body = parsed.data;
  const headerSession = req.headers['x-hermes-session-id'];
  const bodyUser = typeof body.user === 'string' && body.user ? body.user : undefined;
  const hermesSessionId = (Array.isArray(headerSession) ? headerSession[0] : headerSession) ?? bodyUser;

  const messages = responsesInputToMessages(body.input);
  // Prepend instructions as a system message (Codex sends system guidance here).
  if (body.instructions) {
    messages.unshift({ role: 'system', content: body.instructions });
  }

  const tools = body.tools
    ? (body.tools as Array<{ type?: string; function?: { name: string; parameters?: Record<string, unknown> } }>)
        .filter((t) => t.function?.name)
        .map((t) => ({ name: t.function!.name, parameters: t.function!.parameters }))
    : undefined;

  const id = `resp_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const createdAt = Math.floor(Date.now() / 1000);

  if (body.stream) {
    await streamResponses(reply, client, messages, tools, hermesSessionId, id, createdAt, body.model);
    return;
  }

  const result = await client.chat(messages, { hermesSessionId, tools });
  // client.chat already parsed the tool envelopes (and threw PROTOCOL_ERROR
  // on violations); its toolCalls are authoritative.
  const toolCalls = result.toolCalls;
  const text = result.content;

  return reply.send(buildResponse(id, body.model, text, toolCalls, 'completed', createdAt));
}

async function streamResponses(
  reply: FastifyReply,
  client: ChatGPTClient,
  messages: ChatMessage[],
  tools: Array<{ name: string; parameters?: Record<string, unknown> }> | undefined,
  hermesSessionId: string | undefined,
  id: string,
  createdAt: number,
  model: string,
): Promise<void> {
  const raw = reply.raw;
  raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event: string, data: unknown) => {
    raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const responseShape = (status: 'in_progress' | 'completed', output: unknown[]) =>
    buildResponse(id, model, '', undefined, status, createdAt) as Record<string, unknown>;
  const base = responseShape('in_progress', []);

  // Codex expects these lifecycle events in order.
  send('response.created', { type: 'response.created', response: { ...base, output: [] } });

  const buffer = new SentenceBuffer();
  const itemId = `msg_${id}`;
  let fullText = '';
  let itemAdded = false;
  let streamError: string | null = null;

  try {
    const result = await client.chat(messages, {
      hermesSessionId,
      tools,
      onDelta: (text: string) => {
        if (!itemAdded) {
          itemAdded = true;
          send('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: 0,
            item: { id: itemId, type: 'message', role: 'assistant', content: [] },
          });
          send('response.content_part.added', {
            type: 'response.content_part.added',
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
          });
        }
        for (const sentence of buffer.feed(text)) {
          send('response.output_text.delta', {
            type: 'response.output_text.delta',
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            delta: sentence,
          });
        }
      },
    });
    fullText = result.content;
    // Flush pending tail WITHOUT emitting a spurious trailing newline: feed
    // the exact text first; only if something is still buffered, force it out.
    buffer.feed(fullText);
    if (buffer.pendingLen > 0) {
      for (const sentence of buffer.feed(`${fullText}\n`)) {
        send('response.output_text.delta', {
          type: 'response.output_text.delta',
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          delta: sentence,
        });
      }
    }
  } catch (err) {
    streamError = err instanceof AdapterError ? err.code : 'STREAM_INTERNAL_ERROR';
  }

  if (!itemAdded && !streamError) {
    // Empty reply still needs the message item for Codex.
    itemAdded = true;
    send('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: itemId, type: 'message', role: 'assistant', content: [] },
    });
    send('response.content_part.added', {
      type: 'response.content_part.added',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    });
  }

  if (itemAdded) {
    send('response.output_text.done', {
      type: 'response.output_text.done',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      text: fullText,
    });
    send('response.content_part.done', {
      type: 'response.content_part.done',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: fullText, annotations: [] },
    });
    send('response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 0,
      item: outputTextItem(itemId, fullText),
    });
  }

  const finalOutput = [outputTextItem(itemId, fullText)];
  if (streamError) {
    send('response.failed', {
      type: 'response.failed',
      response: { ...base, status: 'failed', error: { code: streamError, message: `stream failed: ${streamError}` } },
    });
    send('response.done', {
      type: 'response.done',
      response: { ...base, status: 'failed', error: { code: streamError, message: `stream failed: ${streamError}` } },
    });
  } else {
    send('response.completed', {
      type: 'response.completed',
      response: { ...base, status: 'completed', output: finalOutput },
    });
    send('response.done', {
      type: 'response.done',
      response: { ...base, status: 'completed', output: finalOutput },
    });
  }
  raw.end();
}
