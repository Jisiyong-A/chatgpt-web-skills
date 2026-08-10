import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runImageGen } from '../../src/chatgpt/image-gen.js';

vi.mock('../../src/chatgpt/composer-mode.js', () => ({
  activateMode: vi.fn(async () => undefined),
}));

vi.mock('../../src/chatgpt/flow-common.js', () => ({
  typeAndSubmit: vi.fn(async () => undefined),
}));

import { activateMode } from '../../src/chatgpt/composer-mode.js';
import { typeAndSubmit } from '../../src/chatgpt/flow-common.js';

/** Sequence of image-src sets per collectImages() call; last entry repeats (stable). */
function makePage(srcsSequence: string[][]) {
  let collectCalls = 0;
  const page = {
    waitForTimeout: vi.fn(async () => undefined),
    evaluate: vi.fn(async (fn: (() => unknown) | ((u: string) => unknown), arg?: string) => {
      const src = (fn?.toString?.() ?? '') as string;
      if (arg !== undefined) return 'data:image/png;base64,AAAA'; // toDataUrl
      if (src.includes('img[src]')) {
        // collectImageSrcs
        const idx = Math.min(collectCalls, srcsSequence.length - 1);
        collectCalls += 1;
        return srcsSequence[idx] ?? [];
      }
      return '生成的图片'; // getLastAssistantText
    }),
  };
  return page;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runImageGen', () => {
  it('activates image mode, submits and returns stable images', async () => {
    const page = makePage([[], ['https://files.oaiusercontent.com/a.png'], ['https://files.oaiusercontent.com/a.png']]);
    const r = await runImageGen(page as never, '画一只猫', { pollMs: 10, stableMs: 50, timeoutMs: 5000 });
    expect(activateMode).toHaveBeenCalledWith(page, 'image');
    expect(typeAndSubmit).toHaveBeenCalledWith(page, '画一只猫');
    expect(r.images).toEqual(['https://files.oaiusercontent.com/a.png']);
    expect(r.images).toHaveLength(1);
  });

  it('returns multiple images', async () => {
    const page = makePage([
      ['https://x/a.png', 'https://x/b.png'],
      ['https://x/a.png', 'https://x/b.png'],
    ]);
    const r = await runImageGen(page as never, '四格漫画', { pollMs: 10, stableMs: 30, timeoutMs: 5000 });
    expect(r.images).toHaveLength(2);
  });

  it('converts blob URLs to data URLs', async () => {
    const page = makePage([['blob:http://x/1'], ['blob:http://x/1']]);
    const r = await runImageGen(page as never, 'logo', { pollMs: 10, stableMs: 30, timeoutMs: 5000 });
    expect(r.images[0]).toMatch(/^data:image\/png;base64,/);
  });

  it('throws GENERATION_TIMEOUT when no image appears', async () => {
    const page = makePage([[], [], []]);
    await expect(runImageGen(page as never, '图', { pollMs: 10, timeoutMs: 300 })).rejects.toMatchObject({
      code: 'GENERATION_TIMEOUT',
    });
  });
});
