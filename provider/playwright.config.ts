import { defineConfig } from '@playwright/test';

// v1.1.0: provider 默认要求 ADAPTER_API_KEY; 浏览器 fixture 需要测试 key。
// 这里在 worker 加载 config 时注入, 避免 loadConfig() 抛错。
process.env.ADAPTER_API_KEY = process.env.ADAPTER_API_KEY ?? 'test-key-for-browser-fixtures';
process.env.ADAPTER_REQUIRE_API_KEY = 'true';

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 90_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  expect: { timeout: 10_000 },
});
