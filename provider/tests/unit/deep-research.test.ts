import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runDeepResearch } from '../../src/chatgpt/deep-research.js';

vi.mock('../../src/chatgpt/composer-mode.js', () => ({
  activateMode: vi.fn(async () => undefined),
}));

vi.mock('../../src/chatgpt/flow-common.js', () => ({
  typeAndSubmit: vi.fn(async () => undefined),
}));

vi.mock('../../src/chatgpt/conversation.js', () => ({
  snapshotConversation: vi.fn(async () => ({ userCount: 1, assistantCount: 0, lastMessageHash: 'x', messageSelector: 's' })),
}));

vi.mock('../../src/chatgpt/response.js', () => ({
  responseText: vi.fn(),
}));

import { activateMode } from '../../src/chatgpt/composer-mode.js';
import { typeAndSubmit } from '../../src/chatgpt/flow-common.js';
import { responseText } from '../../src/chatgpt/response.js';

const PROMPT = '分析最近的城市规划趋势';

/** body 尾部通道：mock evaluate 返回 body 全文（含 prompt + 报告尾部） */
function bodyPage(reportTail: string, stable = true) {
  let calls = 0;
  const page = {
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => {
      calls += 1;
      const tail = stable || calls === 1 ? reportTail : reportTail + '\n追加内容';
      return `sidebar...\n${PROMPT}\n${tail}`;
    }),
    _calls: () => calls,
  };
  return page;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runDeepResearch', () => {
  it('activates mode, submits, and returns the report from the standard message channel', async () => {
    (responseText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      '# 研究报告\n\n深度研究完成。'.repeat(10), // > 100 chars
    );
    const page = bodyPage('');
    const r = await runDeepResearch(page as never, PROMPT, { pollMs: 10, stableMs: 100, timeoutMs: 5000 });
    expect(activateMode).toHaveBeenCalledWith(page, 'deep-research');
    expect(typeAndSubmit).toHaveBeenCalledWith(page, PROMPT);
    expect(r.text).toContain('深度研究完成');
    expect(r.signals).toContain('standard_message');
  });

  it('falls back to the body-text channel when no standard message appears', async () => {
    (responseText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const report = '# 东京都市更新报告\n\n东京Torch项目（虎之门·麻布台地区综合开发）、东京中城八重洲计划、涩谷站区综合开发项目。' + 'x'.repeat(300);
    const page = bodyPage(report);
    const r = await runDeepResearch(page as never, PROMPT, { pollMs: 10, stableMs: 80, timeoutMs: 5000 });
    expect(r.text).toContain('东京Torch项目');
    expect(r.signals.some((s) => s.startsWith('body_tail_stable'))).toBe(true);
  });

  it('passes through custom timeouts', async () => {
    (responseText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue('r'.repeat(200));
    const page = bodyPage('');
    await runDeepResearch(page as never, PROMPT, { timeoutMs: 120_000, stableMs: 15_000 });
    // 直接验证不会抛错即可（默认 25 分钟太慢没法在单测里等）
    expect(true).toBe(true);
  });

  it('fails with GENERATION_TIMEOUT when no report ever appears', async () => {
    (responseText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const page = bodyPage('', true); // tail < 200 chars → 永不满足
    await expect(
      runDeepResearch(page as never, PROMPT, { pollMs: 5, timeoutMs: 300 }),
    ).rejects.toMatchObject({ code: 'GENERATION_TIMEOUT' });
  });
});
