/**
 * Chrome lifecycle manager (spec §4, §31).
 * - Connects over CDP to a dedicated profile (localhost only).
 * - If nothing is listening and launch-at-startup is enabled, launches Chrome
 *   itself with the dedicated profile and waits for CDP.
 * - Never extracts cookies or tokens; the profile keeps the user's login.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { AdapterError } from '../chatgpt/errors.js';
import type { Logger } from 'pino';

export interface ChromeManagerOptions {
  chromePath: string;
  cdpHost: string;
  cdpPort: number;
  profileDir: string;
  launchAtStartup: boolean;
  remoteAllowOrigins: string;
  launchTimeoutMs?: number;
  chatgptBaseUrl?: string;
  logger: Logger;
}

export class ChromeManager {
  private browser: Browser | null = null;
  private child: ChildProcess | null = null;
  private readonly opts: ChromeManagerOptions;

  constructor(opts: ChromeManagerOptions) {
    this.opts = opts;
  }

  get cdpUrl(): string {
    return `http://${this.opts.cdpHost}:${this.opts.cdpPort}`;
  }

  async cdpReachable(timeoutMs = 1500): Promise<boolean> {
    try {
      const res = await fetch(`${this.cdpUrl}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async waitForCdp(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.cdpReachable(1000)) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  private async launchChrome(): Promise<void> {
    const args = [
      `--remote-debugging-address=${this.opts.cdpHost}`,
      `--remote-debugging-port=${this.opts.cdpPort}`,
      `--user-data-dir=${this.opts.profileDir}`,
      `--remote-allow-origins=${this.opts.remoteAllowOrigins}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      'about:blank',
    ];
    this.opts.logger.info({ args }, 'launching dedicated Chrome');
    const child = spawn(this.opts.chromePath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    this.child = child;
    child.on('error', (err) => {
      this.opts.logger.error({ err }, 'chrome spawn failed');
    });
    child.unref();
  }

  async connect(): Promise<Browser> {
    if (this.browser) return this.browser;

    let reachable = await this.cdpReachable();
    if (!reachable && this.opts.launchAtStartup) {
      await this.launchChrome();
      reachable = await this.waitForCdp(this.opts.launchTimeoutMs ?? 30_000);
    }
    if (!reachable) {
      throw AdapterError.browserUnavailable(
        `No Chrome listening on ${this.cdpUrl} (${this.opts.chromePath})`,
      );
    }
    try {
      this.browser = await chromium.connectOverCDP(this.cdpUrl);
      this.opts.logger.info('connected to Chrome over CDP');
      return this.browser;
    } catch (err) {
      throw AdapterError.browserUnavailable(`CDP connect failed: ${String(err)}`);
    }
  }

  /** Find an existing ChatGPT tab, otherwise open one. */
  async chatgptPage(): Promise<Page> {
    const browser = await this.connect();
    const base = this.opts.chatgptBaseUrl ?? 'https://chatgpt.com';
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().includes('chatgpt.com')) return page;
      }
    }
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((err) => {
      this.opts.logger.warn({ err: String(err) }, 'goto chatgpt.com failed; page may show offline UI');
    });
    return page;
  }

  /** Kill the wedged Chrome holding the CDP port, then relaunch it (spec §31). */
  async restart(): Promise<void> {
    try {
      await this.close();
    } catch {
      // ignore
    }
    try {
      const { execSync } = await import('node:child_process');
      const out = execSync(
        `netstat -ano | findstr :${this.opts.cdpPort} | findstr LISTENING`,
        { encoding: 'utf8', windowsHide: true },
      ).toString();
      const pids = [
        ...new Set(
          out
            .split(/\r?\n/)
            .map((l) => l.trim().split(/\s+/).pop())
            .filter((p) => p && /^\d+$/.test(p)),
        ),
      ];
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { windowsHide: true });
        } catch {
          // process may already be gone
        }
      }
    } catch {
      // nothing listening — fine, launch below
    }
    this.launchChrome();
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close();
    } catch {
      // ignore; CDP may already be gone
    }
    this.browser = null;
    // Intentionally do NOT kill the Chrome child: the user's login lives in
    // the profile; leaving Chrome running preserves state and lets the next
    // adapter start reconnect to the same authenticated instance.
    this.child = null;
  }
}
