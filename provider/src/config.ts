import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AdapterConfig {
  host: string;
  port: number;
  apiKey: string | null;
  requireApiKey: boolean;
  remoteAllowOrigins: string;
  chromePath: string;
  cdpHost: string;
  cdpPort: number;
  profileDir: string;
  launchChromeAtStartup: boolean;
  timeoutMs: number;
  responseStableMs: number;
  logLevel: string;
  dbPath: string | null;
  uiHints: Record<string, string[]>;
  authMarkers: string[];
  humanMarkers: string[];
  rateLimitMarkers: string[];
  chatgptBaseUrl: string;
}

const DEFAULT_HINTS: Record<string, string[]> = {
  composer: ['#prompt-textarea'],
  submit: ['[data-testid="send-button"]', 'button[aria-label*="send" i]', 'button[aria-label*="发送" i]'],
  userMessage: ['[data-message-author-role="user"]'],
  assistantMessage: ['[data-message-author-role="assistant"]'],
  stopControl: ['[data-testid="stop-button"]', 'button[aria-label*="stop" i]'],
  modelIndicator: ['[data-testid="model-selector-button"]', '[data-testid="chatgpt-model-selector-button"]'],
};

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AdapterConfig {
  const host = env.ADAPTER_HOST ?? '127.0.0.1';
  const apiKey = env.ADAPTER_API_KEY || null;
  const requireApiKey = (env.ADAPTER_REQUIRE_API_KEY ?? 'true') !== 'false';

  if (requireApiKey && !apiKey) {
    throw new Error(
      'ADAPTER_API_KEY is required when ADAPTER_REQUIRE_API_KEY=true. ' +
      'Set ADAPTER_API_KEY before starting (e.g. setx ADAPTER_API_KEY <secret>).'
    );
  }
  if (!isLoopback(host) && !apiKey) {
    throw new Error('Non-loopback ADAPTER_HOST requires ADAPTER_API_KEY');
  }

  return {
    host,
    port: Number(env.ADAPTER_PORT ?? 8765),
    apiKey,
    requireApiKey,
    remoteAllowOrigins: env.CHROME_REMOTE_ALLOW_ORIGINS ?? '*',
    chromePath:
      env.CHROME_PATH ??
      (process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/google-chrome'),
    cdpHost: env.CHROME_CDP_HOST ?? '127.0.0.1',
    cdpPort: Number(env.CHROME_CDP_PORT ?? 9233),
    profileDir: env.CHROME_PROFILE_DIR ?? 'C:\\Hermes\\chatgpt-web-profile',
    launchChromeAtStartup: (env.CHROME_LAUNCH_AT_STARTUP ?? 'true') !== 'false',
    timeoutMs: Number(env.ADAPTER_TIMEOUT_MS ?? 180_000),
    responseStableMs: Number(env.RESPONSE_STABLE_MS ?? 2000),
    logLevel: env.LOG_LEVEL ?? 'info',
    dbPath:
      env.ADAPTER_DB === 'off' ? null : (env.ADAPTER_DB_PATH ?? path.resolve(__dirname, '../../data/bridge.db')),
    uiHints: DEFAULT_HINTS,
    authMarkers: [
      'log in', 'sign up', 'welcome back', 'auth/login', 'continue with google',
      '登录', '注册', '继续使用 google',
    ],
    humanMarkers: [
      'verify you are human',
      'security check',
      'unusual activity',
      'captcha',
      'cloudflare',
      'one more step',
      '验证你是人类',
      '安全验证',
      '异常活动',
    ],
    rateLimitMarkers: [
      'usage limit',
      'reached the limit',
      'temporarily limited',
      'rate limit',
      'you\u2019ve reached your',
      'you have reached your',
      '已达到使用上限',
      '使用次数已达上限',
      '暂时受限',
    ],
    chatgptBaseUrl: 'https://chatgpt.com',
  };
}
