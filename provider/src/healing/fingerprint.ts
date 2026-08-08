/**
 * UI fingerprinting (spec §14).
 * Combines STABLE structural signals — never a raw DOM hash, which changes on
 * every minor render. When the fingerprint changes significantly the adapter
 * enters passive inspection: existing rules are re-validated instead of
 * blindly trusted.
 */

import type { Page } from 'playwright';
import { sha256 } from '../hermes/request-hash.js';
import type { Persistence } from '../persistence/sqlite.js';

export interface UiFingerprint {
  hash: string;
  features: FingerprintFeatures;
}

export interface FingerprintFeatures {
  mainLandmark: boolean;
  composer: {
    editable: boolean;
    tag: string | null;
    hasPlaceholder: boolean;
    lowerViewport: boolean;
  } | null;
  submit: { testid: string | null; ariaLabel: string | null } | null;
  messageRoles: { user: boolean; assistant: boolean };
  stopControl: boolean;
  newChatControl: boolean;
  buttonCountBucket: '0-20' | '20-60' | '60-150' | '150+';
}

export async function computeUiFingerprint(page: Page): Promise<UiFingerprint> {
  const features = (await page
    .evaluate(() => {
      const main = !!document.querySelector('main, [role="main"]');
      const composer = document.querySelector('#prompt-textarea, [contenteditable="true"], textarea');
      const cr = composer ? (composer as HTMLElement).getBoundingClientRect() : null;
      const submit = document.querySelector(
        '[data-testid="send-button"], [class*="composer-submit"], button[aria-label*="发送"], button[aria-label*="send" i]',
      );
      const buttons = document.querySelectorAll('button').length;
      const bucket = buttons <= 20 ? '0-20' : buttons <= 60 ? '20-60' : buttons <= 150 ? '60-150' : '150+';
      return {
        mainLandmark: main,
        composer: composer
          ? {
              editable: (composer as HTMLElement).isContentEditable || composer.tagName.toLowerCase() === 'textarea',
              tag: composer.tagName.toLowerCase(),
              hasPlaceholder: !!(composer.getAttribute('placeholder') ?? composer.getAttribute('data-placeholder')),
              lowerViewport: cr ? cr.top > window.innerHeight * 0.45 : false,
            }
          : null,
        submit: submit
          ? { testid: submit.getAttribute('data-testid'), ariaLabel: submit.getAttribute('aria-label') }
          : null,
        messageRoles: {
          user: !!document.querySelector('[data-message-author-role="user"], .message.user'),
          assistant: !!document.querySelector('[data-message-author-role="assistant"], .message.assistant'),
        },
        stopControl: !!document.querySelector('[data-testid="stop-button"]'),
        newChatControl: !!document.querySelector(
          '[data-testid="create-new-chat-button"], [data-testid="new-chat-button"], button[aria-label*="new chat" i]',
        ),
        buttonCountBucket: bucket,
      };
    })
    .catch(() => null)) as FingerprintFeatures | null;

  const normalized: FingerprintFeatures = features ?? {
    mainLandmark: false,
    composer: null,
    submit: null,
    messageRoles: { user: false, assistant: false },
    stopControl: false,
    newChatControl: false,
    buttonCountBucket: '0-20',
  };
  return { features: normalized, hash: sha256(JSON.stringify(normalized)) };
}

export function fingerprintChanged(prev: UiFingerprint, cur: UiFingerprint): boolean {
  return prev.hash !== cur.hash;
}

/** Persist a fingerprint (history is kept; the latest row is the baseline). */
export function saveFingerprint(persistence: Persistence, fp: UiFingerprint): void {
  persistence.db
    .prepare('INSERT INTO ui_fingerprints (fingerprint_id, fingerprint_json, created_at) VALUES (?, ?, ?)')
    .run(`${fp.hash}-${Date.now()}`, JSON.stringify(fp), Date.now());
}

/** True when the given fingerprint differs from the last persisted one. */
export function fingerprintChangeSinceLast(persistence: Persistence, fp: UiFingerprint): boolean {
  const row = persistence.db
    .prepare('SELECT fingerprint_json FROM ui_fingerprints ORDER BY created_at DESC LIMIT 1')
    .get() as { fingerprint_json: string } | undefined;
  if (!row) return true;
  try {
    const prev = JSON.parse(row.fingerprint_json) as UiFingerprint;
    return prev.hash !== fp.hash;
  } catch {
    return true;
  }
}
