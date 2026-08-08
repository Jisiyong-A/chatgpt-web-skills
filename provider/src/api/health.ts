/**
 * Health endpoint (spec §28). Reports browser/page/auth/UI state without
 * doing anything risky.
 */

import type { ChatGPTClient } from '../chatgpt/client.js';
import type { ChromeManager } from '../browser/chrome.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  browser_connected: boolean;
  chatgpt_page_available: boolean;
  auth_state: 'authenticated' | 'auth_required' | 'unknown' | 'not_checked';
  ui_state: 'compatible' | 'unknown' | 'not_checked';
  active_rule_set: string;
  healing_required: boolean;
  state_machine: string;
}

export async function buildHealth(
  client: ChatGPTClient | null,
  chrome: ChromeManager | null,
): Promise<HealthReport> {
  if (!client || !chrome) {
    return {
      status: 'degraded',
      browser_connected: false,
      chatgpt_page_available: false,
      auth_state: 'not_checked',
      ui_state: 'unknown',
      active_rule_set: 'none',
      healing_required: true,
      state_machine: 'BOOT',
    };
  }

  let browser_connected = false;
  try {
    browser_connected = await chrome.cdpReachable();
  } catch {
    browser_connected = false;
  }

  let auth_state: HealthReport['auth_state'] = 'not_checked';
  let ui_state: HealthReport['ui_state'] = 'not_checked';
  if (browser_connected) {
    try {
      const auth = await client.detectAuthState();
      auth_state = auth.auth;
      ui_state = auth.auth === 'authenticated' ? 'compatible' : 'unknown';
    } catch {
      auth_state = 'unknown';
      ui_state = 'unknown';
    }
  }

  const healthy = browser_connected && auth_state === 'authenticated' && ui_state === 'compatible';
  return {
    status: healthy ? 'ok' : 'degraded',
    browser_connected,
    chatgpt_page_available: browser_connected,
    auth_state,
    ui_state,
    active_rule_set: 'phase1-static-hints',
    healing_required: !healthy,
    state_machine: client.sm.state,
  };
}
