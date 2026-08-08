/**
 * 本地 API 鉴权测试 (v1.1.0-hardening, spec §42)
 * - 配置了 apiKey 时: 无 Bearer → 401, 正确 Bearer → 200
 * - 未配置 apiKey (旧兼容模式): 不要求鉴权
 */
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { AdapterConfig } from '../../src/config.js';

const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, fatal() {} } as any;

function makeConfig(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    host: '127.0.0.1',
    port: 8765,
    apiKey: null,
    requireApiKey: false,
    remoteAllowOrigins: '*',
    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    cdpHost: '127.0.0.1',
    cdpPort: 9233,
    profileDir: 'C:\\Hermes\\chatgpt-web-profile',
    launchChromeAtStartup: false,
    timeoutMs: 180000,
    responseStableMs: 2000,
    logLevel: 'info',
    dbPath: null,
    uiHints: {},
    authMarkers: [],
    humanMarkers: [],
    rateLimitMarkers: [],
    chatgptBaseUrl: 'https://chatgpt.com',
    ...overrides,
  };
}

async function buildTestServer(apiKey: string | null) {
  const app = await buildServer({
    config: makeConfig({ apiKey, requireApiKey: !!apiKey }),
    logger: silentLogger,
    client: () => null,
    chrome: null,
  });
  return app;
}

describe('local adapter auth', () => {
  it('rejects requests without the local bearer key', async () => {
    const app = await buildTestServer('test-secret');
    const response = await app.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('accepts requests with the local bearer key', async () => {
    const app = await buildTestServer('test-secret');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { authorization: 'Bearer test-secret' },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('accepts requests without a key when apiKey is not configured (legacy)', async () => {
    const app = await buildTestServer(null);
    const response = await app.inject({ method: 'GET', url: '/v1/models' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
