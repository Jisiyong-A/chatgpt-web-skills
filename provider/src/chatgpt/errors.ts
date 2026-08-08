/**
 * Provider-style error mapping (spec §24).
 * Every failure surfaces as a machine-readable code + HTTP status.
 */

export type AdapterErrorCode =
  | 'AUTH_REQUIRED' // 401 login required
  | 'AUTHORIZATION_ERROR' // 403 account/authorization problem
  | 'RATE_LIMITED' // 429 usage limit reached
  | 'CHATGPT_UNAVAILABLE' // 503 ChatGPT unavailable
  | 'BROWSER_UNAVAILABLE' // 503 browser/CDP unavailable
  | 'UI_UNKNOWN' // 503 UI cannot be identified safely
  | 'HUMAN_REQUIRED' // 503 CAPTCHA / human verification
  | 'GENERATION_TIMEOUT' // 504 generation timed out
  | 'GENERATION_ERROR' // 502 generation failed for another reason
  | 'CONTEXT_DIVERGED' // 409 context/session divergence conflict
  | 'INVALID_REQUEST' // 400 invalid local request
  | 'PROTOCOL_ERROR' // 400 tool protocol violation (Phase 5)
  | 'REQUEST_IN_PROGRESS'; // 409 another request owns the tab

export const ERROR_HTTP: Record<AdapterErrorCode, number> = {
  AUTH_REQUIRED: 401,
  AUTHORIZATION_ERROR: 403,
  RATE_LIMITED: 429,
  CHATGPT_UNAVAILABLE: 503,
  BROWSER_UNAVAILABLE: 503,
  UI_UNKNOWN: 503,
  HUMAN_REQUIRED: 503,
  GENERATION_TIMEOUT: 504,
  GENERATION_ERROR: 502,
  CONTEXT_DIVERGED: 409,
  INVALID_REQUEST: 400,
  PROTOCOL_ERROR: 400,
  REQUEST_IN_PROGRESS: 409,
};

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(code: AdapterErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.httpStatus = ERROR_HTTP[code];
    this.details = details;
  }

  /** OpenAI-compatible error body for /v1 responses. */
  toOpenAIError(): { error: { message: string; type: string; code: string } } {
    return {
      error: {
        message: this.message,
        type: 'adapter_error',
        code: this.code,
      },
    };
  }

  static authRequired(msg = 'ChatGPT requires login'): AdapterError {
    return new AdapterError('AUTH_REQUIRED', msg);
  }
  static rateLimited(msg = 'ChatGPT usage limit reached'): AdapterError {
    return new AdapterError('RATE_LIMITED', msg);
  }
  static humanRequired(msg = 'Human verification required; adapter stopped'): AdapterError {
    return new AdapterError('HUMAN_REQUIRED', msg);
  }
  static uiUnknown(msg = 'ChatGPT UI could not be identified safely'): AdapterError {
    return new AdapterError('UI_UNKNOWN', msg);
  }
  static browserUnavailable(msg = 'Browser/CDP connection unavailable'): AdapterError {
    return new AdapterError('BROWSER_UNAVAILABLE', msg);
  }
  static generationTimeout(msg = 'ChatGPT generation timed out'): AdapterError {
    return new AdapterError('GENERATION_TIMEOUT', msg);
  }
  static invalidRequest(msg: string): AdapterError {
    return new AdapterError('INVALID_REQUEST', msg);
  }
}

export function isAdapterError(e: unknown): e is AdapterError {
  return e instanceof AdapterError;
}
