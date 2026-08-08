import { describe, expect, it } from 'vitest';
import { AdapterError, ERROR_HTTP } from '../../src/chatgpt/errors.js';

describe('Error mapping (spec §24)', () => {
  it('maps every code to the documented HTTP status', () => {
    expect(ERROR_HTTP.AUTH_REQUIRED).toBe(401);
    expect(ERROR_HTTP.AUTHORIZATION_ERROR).toBe(403);
    expect(ERROR_HTTP.RATE_LIMITED).toBe(429);
    expect(ERROR_HTTP.CHATGPT_UNAVAILABLE).toBe(503);
    expect(ERROR_HTTP.BROWSER_UNAVAILABLE).toBe(503);
    expect(ERROR_HTTP.UI_UNKNOWN).toBe(503);
    expect(ERROR_HTTP.HUMAN_REQUIRED).toBe(503);
    expect(ERROR_HTTP.GENERATION_TIMEOUT).toBe(504);
    expect(ERROR_HTTP.CONTEXT_DIVERGED).toBe(409);
    expect(ERROR_HTTP.INVALID_REQUEST).toBe(400);
  });

  it('produces OpenAI-compatible error bodies with machine-readable codes', () => {
    const err = AdapterError.humanRequired('captcha shown');
    expect(err.toOpenAIError()).toEqual({
      error: { message: 'captcha shown', type: 'adapter_error', code: 'HUMAN_REQUIRED' },
    });
  });

  it('static factories carry correct codes and statuses', () => {
    expect(AdapterError.authRequired().code).toBe('AUTH_REQUIRED');
    expect(AdapterError.authRequired().httpStatus).toBe(401);
    expect(AdapterError.rateLimited().httpStatus).toBe(429);
    expect(AdapterError.uiUnknown().httpStatus).toBe(503);
    expect(AdapterError.generationTimeout().httpStatus).toBe(504);
    expect(AdapterError.browserUnavailable().httpStatus).toBe(503);
    expect(AdapterError.invalidRequest('x').httpStatus).toBe(400);
  });

  it('REQUEST_IN_PROGRESS maps to 409', () => {
    const err = new AdapterError('REQUEST_IN_PROGRESS', 'busy');
    expect(err.httpStatus).toBe(409);
  });

  it('PROTOCOL_ERROR maps to 400', () => {
    const err = new AdapterError('PROTOCOL_ERROR', 'bad tool call');
    expect(err.httpStatus).toBe(400);
    expect(err.toOpenAIError().error.code).toBe('PROTOCOL_ERROR');
  });
});
