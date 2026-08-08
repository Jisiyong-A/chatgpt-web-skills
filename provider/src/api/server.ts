/**
 * Fastify server (spec §5, §24, §42).
 * Localhost only. Optional bearer secret. AdapterError → mapped HTTP codes.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { AdapterError, isAdapterError } from '../chatgpt/errors.js';
import type { ChatGPTClient } from '../chatgpt/client.js';
import type { ChromeManager } from '../browser/chrome.js';
import type { AdapterConfig } from '../config.js';
import type { Logger } from 'pino';
import { buildHealth } from './health.js';
import { MODELS } from './models.js';
import { handleChatCompletions, validateChatCompletions } from './chat-completions.js';
import { handleStreamingChatCompletions } from './streaming-handler.js';
import { handleResponses } from './responses.js';

export interface ServerDeps {
  config: AdapterConfig;
  logger: Logger;
  /** Getter so the reconnect loop can swap the client at runtime (§31). */
  client: () => ChatGPTClient | null;
  chrome: ChromeManager | null;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, logger, chrome } = deps;
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
  });

  // Local API secret (spec §42): if configured, require Bearer token.
  if (config.apiKey) {
    app.addHook('preHandler', (req, reply, done) => {
      const auth = req.headers.authorization ?? '';
      if (auth !== `Bearer ${config.apiKey}`) {
        reply.code(401).send({ error: { message: 'invalid adapter API key', type: 'auth_error', code: 'INVALID_REQUEST' } });
        return;
      }
      done();
    });
  }

  app.get('/health', async () => buildHealth(deps.client(), chrome));

  app.get('/v1/models', async () => MODELS);

  // OpenAI Responses API (Codex CLI 2026 uses wire_api="responses" only).
  app.post('/v1/responses', async (req, reply) => {
    const client = deps.client();
    if (!client) {
      throw AdapterError.browserUnavailable('adapter not connected to a browser');
    }
    await handleResponses(req, reply, client);
    return reply; // JSON or SSE already written
  });

  app.post('/v1/chat/completions', async (req, reply) => {
    const client = deps.client();
    // Fail fast on invalid local requests BEFORE touching the browser.
    const body = validateChatCompletions(req.body);
    if (body.stream) {
      if (!client) {
        throw AdapterError.browserUnavailable('adapter not connected to a browser');
      }
      await handleStreamingChatCompletions(req, reply, client);
      return reply; // SSE response already written to reply.raw
    }
    if (!client) {
      throw AdapterError.browserUnavailable('adapter not connected to a browser');
    }
    const started = Date.now();
    const result = await handleChatCompletions(req, client);
    logger.info({ path: '/v1/chat/completions', latency_ms: Date.now() - started, id: result.id }, 'chat_completion');
    return result;
  });

  app.setErrorHandler((err, req, reply) => {
    if (isAdapterError(err)) {
      logger.warn({ code: err.code, message: err.message, path: req.url }, 'adapter_error');
      reply.code(err.httpStatus).send(err.toOpenAIError());
      return;
    }
    // Fail closed: never leak internals.
    logger.error({ err, path: req.url }, 'unhandled_error');
    reply.code(500).send({ error: { message: 'internal adapter error', type: 'internal_error', code: 'INTERNAL_ERROR' } });
  });

  return app;
}
