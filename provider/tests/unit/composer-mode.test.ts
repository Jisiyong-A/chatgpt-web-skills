import { describe, expect, it, vi } from 'vitest';
import {
  activateMode,
  detectActiveMode,
  waitForModeActive,
  restoreDefaultMode,
  ensureChatView,
  COMPOSER_PLUS_BTN,
  COMPOSER_FOOTER_ACTIONS,
} from '../../src/chatgpt/composer-mode.js';

interface FakeLocator {
  count: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  innerText: ReturnType<typeof vi.fn>;
  first: () => FakeLocator;
  filter: (arg: unknown) => FakeLocator;
}

function loc(count: number, text = '', onClick?: () => void): FakeLocator {
  return {
    count: vi.fn(async () => count),
    click: vi.fn(async () => {
      onClick?.();
    }),
    innerText: vi.fn(async () => text),
    first: function () { return this; },
    filter: function () { return this; },
  };
}

interface PageState {
  footer: string;
  plusClicked: boolean;
  gotoCount: number;
}

function makePage(initialFooter = '', activatedFooter = '深度研究\n应用\n站点') {
  const state: PageState = { footer: initialFooter, plusClicked: false, gotoCount: 0 };
  const page = {
    waitForTimeout: vi.fn(async () => undefined),
    locator: vi.fn((sel: string) => {
      if (sel === COMPOSER_PLUS_BTN) {
        return loc(1, '', () => {
          state.plusClicked = true;
          state.footer = activatedFooter; // plus click opens menu; activation sets footer
        });
      }
      if (sel === COMPOSER_FOOTER_ACTIONS) {
        return loc(state.footer ? 1 : 0, state.footer);
      }
      if (sel === '[role="radio"]') {
        return { count: vi.fn(async () => 0) }; // no work radio checked → chat view
      }
      if (sel === '#prompt-textarea, [contenteditable="true"]') {
        return { count: vi.fn(async () => 1) }; // composer present
      }
      return loc(1); // menu items (any role/text)
    }),
    goto: vi.fn(async () => {
      state.gotoCount += 1;
      state.footer = ''; // reload resets composer mode
    }),
    keyboard: { press: vi.fn(async () => undefined) },
    url: () => 'https://chatgpt.com/c/abc',
    state,
  };
  return { page, state };
}

describe('detectActiveMode', () => {
  it('returns default when no footer chip exists', async () => {
    const { page } = makePage();
    expect(await detectActiveMode(page as never)).toBe('default');
  });

  it('detects deep-research from the footer text', async () => {
    const { page } = makePage('深度研究\n应用\n站点');
    expect(await detectActiveMode(page as never)).toBe('deep-research');
  });

  it('detects image from the footer text', async () => {
    const { page } = makePage('图片\n自动');
    expect(await detectActiveMode(page as never)).toBe('image');
  });
});

describe('activateMode', () => {
  it('no-ops when the target mode is already active', async () => {
    const { page, state } = makePage('深度研究\n应用');
    await activateMode(page as never, 'deep-research');
    expect(state.plusClicked).toBe(false);
  });

  it('activates deep-research via + → 更多 → 深度研究', async () => {
    const { page, state } = makePage();
    await activateMode(page as never, 'deep-research');
    expect(state.plusClicked).toBe(true);
    expect(page.locator).toHaveBeenCalledWith(COMPOSER_PLUS_BTN);
  });

  it('activates image via + → 创建图片', async () => {
    const { page, state } = makePage('', '图片\n自动');
    await activateMode(page as never, 'image');
    expect(state.plusClicked).toBe(true);
  });

  it('fails closed (UI_UNKNOWN) when the plus button is missing', async () => {
    const page = {
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn((sel: string) => {
        if (sel === COMPOSER_PLUS_BTN) return loc(0);
        if (sel === COMPOSER_FOOTER_ACTIONS) return loc(0);
        if (sel === '[role="radio"]') return { count: vi.fn(async () => 0) };
        return loc(1);
      }),
    };
    await expect(activateMode(page as never, 'image')).rejects.toMatchObject({
      code: 'UI_UNKNOWN',
    });
  });

  it('fails closed when the mode never activates (timeout)', async () => {
    const page = {
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn((sel: string) => {
        if (sel === COMPOSER_PLUS_BTN) return loc(1);
        if (sel === COMPOSER_FOOTER_ACTIONS) return loc(0); // never activates
        if (sel === '[role="radio"]') return { count: vi.fn(async () => 0) };
        return loc(1);
      }),
    };
    await expect(activateMode(page as never, 'image', { timeoutMs: 1500 })).rejects.toMatchObject({
      code: 'UI_UNKNOWN',
    });
  });
});

describe('waitForModeActive', () => {
  it('resolves when the footer chip appears', async () => {
    const { page } = makePage('深度研究');
    await expect(waitForModeActive(page as never, 'deep-research', 2000)).resolves.toBeUndefined();
  });

  it('throws UI_UNKNOWN on timeout', async () => {
    const page = {
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn((sel: string) => {
        if (sel === COMPOSER_FOOTER_ACTIONS) return loc(0);
        return loc(1);
      }),
    };
    await expect(waitForModeActive(page as never, 'image', 800)).rejects.toMatchObject({
      code: 'UI_UNKNOWN',
    });
  });
});

describe('restoreDefaultMode', () => {
  it('returns immediately when already default', async () => {
    const { page, state } = makePage();
    await restoreDefaultMode(page as never);
    expect(state.gotoCount).toBe(0);
  });

  it('reloads the page when a non-default mode is active', async () => {
    const { page, state } = makePage('图片\n自动');
    await restoreDefaultMode(page as never, 3000);
    expect(state.gotoCount).toBe(1);
  });
});

describe('ensureChatView', () => {
  function radioPage(workChecked: boolean, composerAppears = true) {
    const clicks: string[] = [];
    const page = {
      waitForTimeout: vi.fn(async () => undefined),
      locator: vi.fn((sel: string, options?: { hasText?: RegExp }) => {
        if (options?.hasText) {
          // locator(selector, { hasText }) — the chat radio
          return {
            first: () => ({
              count: vi.fn(async () => 1),
              click: vi.fn(async () => {
                clicks.push('chat');
              }),
            }),
          };
        }
        if (sel === '[role="radio"]') {
          return {
            count: vi.fn(async () => 2),
            nth: (i: number) => ({
              innerText: vi.fn(async () => (i === 0 ? '聊天' : '工作')),
              getAttribute: vi.fn(async () => (i === 1 && workChecked ? 'true' : 'false')),
            }),
          };
        }
        if (sel === '#prompt-textarea, [contenteditable="true"]') {
          return { count: vi.fn(async () => (composerAppears ? 1 : 0)) };
        }
        return { count: vi.fn(async () => 0) };
      }),
    };
    return { page, clicks };
  }

  it('does nothing when chat view is active', async () => {
    const { page, clicks } = radioPage(false);
    await expect(ensureChatView(page as never)).resolves.toBeUndefined();
    expect(clicks).toHaveLength(0);
  });

  it('switches back to chat when the work view is checked', async () => {
    const { page, clicks } = radioPage(true);
    await expect(ensureChatView(page as never)).resolves.toBeUndefined();
    expect(clicks).toEqual(['chat']);
  });

  it('fails closed when the composer does not return', async () => {
    const { page } = radioPage(true, false);
    await expect(ensureChatView(page as never, 800)).rejects.toMatchObject({
      code: 'UI_UNKNOWN',
    });
  });
});
