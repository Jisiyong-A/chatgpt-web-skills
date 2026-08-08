/**
 * POST /v1/chat/completions (spec §5, §24, §30).
 * Phase 1: stream=false only. Tool calling is rejected until Phase 5.
 */

import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { AdapterError } from '../chatgpt/errors.js';
import type { ChatGPTClient } from '../chatgpt/client.js';

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

const toolSchema = z.object({
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const chatCompletionsSchema = z
  .object({
    model: z.string().optional().default('chatgpt-web'),
    messages: z.array(messageSchema).min(1),
    stream: z.boolean().optional().default(false),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    user: z.string().optional(), // optional Hermes session id (or X-Hermes-Session-Id header)
    tools: z.array(toolSchema).optional(), // Phase 5: declared tools
    tool_choice: z.unknown().optional(),
  })
  .passthrough();

export type ChatCompletionsBody = z.infer<typeof chatCompletionsSchema>;

/** Validate the request body first (fail fast on invalid local requests). */
export function validateChatCompletions(body: unknown): ChatCompletionsBody {
  const parsed = chatCompletionsSchema.safeParse(body);
  if (!parsed.success) {
    throw AdapterError.invalidRequest(
      `invalid request body: ${parsed.error.issues[0]?.message ?? 'schema error'}`,
    );
  }
  const b = parsed.data;
  return b;
}

export interface ChatCompletionsResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    };
    finish_reason: 'stop' | 'tool_calls';
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function handleChatCompletions(
  req: FastifyRequest<{ Body: unknown }>,
  client: ChatGPTClient,
): Promise<ChatCompletionsResponse> {
  const body = validateChatCompletions(req.body);
  // Hermes session id: explicit header wins, else the OpenAI `user` field.
  const headerSession = req.headers['x-hermes-session-id'];
  const bodyUser = typeof body.user === 'string' && body.user ? body.user : undefined;
  const hermesSessionId = (Array.isArray(headerSession) ? headerSession[0] : headerSession) ?? bodyUser;

  const result = await client.chat(body.messages, {
    hermesSessionId,
    tools: body.tools?.map((t) => ({
      name: t.function.name,
      parameters: t.function.parameters,
    })),
  });

  const toolCalls = result.toolCalls?.length
    ? result.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }))
    : undefined;

  return {
    id: result.id,
    object: 'chat.completion',
    created: result.created,
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: toolCalls ? null : result.content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, // not measurable via web UI
  };
}
