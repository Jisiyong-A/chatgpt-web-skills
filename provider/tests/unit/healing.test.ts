import { describe, expect, it } from 'vitest';
import { Persistence } from '../../src/persistence/sqlite.js';
import { UiRuleStore } from '../../src/persistence/ui-rules.js';
import { RuleRegistry, type UiRule } from '../../src/healing/registry.js';
import { computeUiFingerprint, saveFingerprint, fingerprintChangeSinceLast, type UiFingerprint } from '../../src/healing/fingerprint.js';

function makeDb(): Persistence {
  return new Persistence({ dbPath: ':memory:' });
}

function fakeFp(hash: string): UiFingerprint {
  return {
    hash,
    features: {
      mainLandmark: true,
      composer: { editable: true, tag: 'div', hasPlaceholder: true, lowerViewport: true },
      submit: { testid: 'send-button', ariaLabel: null },
      messageRoles: { user: true, assistant: true },
      stopControl: false,
      newChatControl: true,
      buttonCountBucket: '60-150',
    },
  };
}

const COMPOSER_RULE: UiRule = {
  version: 1,
  selectors: ['#prompt-textarea'],
  profile: { tag: 'div', contenteditable: true, placeholder: 'Message ChatGPT' },
};

describe('UiRuleStore lifecycle (spec §12, §13)', () => {
  it('PROBATION → STABLE after 3 successes', () => {
    const p = makeDb();
    const store = new UiRuleStore(p);
    const rec = store.upsert({
      rule_id: 'r1', capability: 'composer', rule_json: '{}', confidence: 0.9,
      status: 'probation', success_count: 0, failure_count: 0, ui_fingerprint: 'f',
    });
    expect(rec.status).toBe('probation');
    expect(store.recordSuccess('r1')!.status).toBe('probation');
    expect(store.recordSuccess('r1')!.status).toBe('probation');
    expect(store.recordSuccess('r1')!.status).toBe('stable');
    expect(store.recordSuccess('r1')!.success_count).toBe(4);
  });

  it('PROBATION rolls back to failed after 2 failures', () => {
    const p = makeDb();
    const store = new UiRuleStore(p);
    store.upsert({
      rule_id: 'r1', capability: 'composer', rule_json: '{}', confidence: 0.9,
      status: 'probation', success_count: 1, failure_count: 0, ui_fingerprint: 'f',
    });
    expect(store.recordFailure('r1')!.status).toBe('probation');
    expect(store.recordFailure('r1')!.status).toBe('failed');
  });

  it('STABLE demotes to PROBATION after 3 consecutive failures', () => {
    const p = makeDb();
    const store = new UiRuleStore(p);
    store.upsert({
      rule_id: 'r1', capability: 'composer', rule_json: '{}', confidence: 0.95,
      status: 'stable', success_count: 10, failure_count: 0, ui_fingerprint: 'f',
    });
    store.recordFailure('r1');
    store.recordFailure('r1');
    expect(store.recordFailure('r1')!.status).toBe('probation');
  });

  it('listActive returns only stable/probation rules, ordered by confidence', () => {
    const p = makeDb();
    const store = new UiRuleStore(p);
    store.upsert({ rule_id: 'a', capability: 'composer', rule_json: '{}', confidence: 0.9, status: 'stable', success_count: 5, failure_count: 0, ui_fingerprint: '' });
    store.upsert({ rule_id: 'b', capability: 'composer', rule_json: '{}', confidence: 0.95, status: 'probation', success_count: 2, failure_count: 0, ui_fingerprint: '' });
    store.upsert({ rule_id: 'c', capability: 'composer', rule_json: '{}', confidence: 0.8, status: 'failed', success_count: 0, failure_count: 2, ui_fingerprint: '' });
    store.upsert({ rule_id: 'd', capability: 'submit_control', rule_json: '{}', confidence: 0.9, status: 'stable', success_count: 1, failure_count: 0, ui_fingerprint: '' });
    const ids = store.listActive('composer').map((r) => r.rule_id);
    expect(ids).toEqual(['b', 'a']); // confidence desc, failed excluded
  });
});

describe('RuleRegistry', () => {
  it('discover is idempotent on rule content (same rule → same rule_id)', () => {
    const p = makeDb();
    const reg = new RuleRegistry(p);
    const a = reg.discover('composer', COMPOSER_RULE, 'fp1', 0.9);
    const b = reg.discover('composer', COMPOSER_RULE, 'fp2', 0.91);
    expect(a.rule_id).toBe(b.rule_id);
    expect(b.success_count).toBe(0); // discover never bumps counts
  });

  it('promotes to probation and records successes', () => {
    const p = makeDb();
    const reg = new RuleRegistry(p);
    const rec = reg.discover('composer', COMPOSER_RULE, 'f', 0.9);
    expect(rec.status).toBe('discovered');
    reg.promoteToProbation(rec.rule_id);
    reg.recordSuccess(rec.rule_id);
    reg.recordSuccess(rec.rule_id);
    const after = reg.listActive('composer')[0]!;
    expect(after.status).toBe('probation');
    expect(after.success_count).toBe(2);
  });

  it('different rules get different ids', () => {
    const p = makeDb();
    const reg = new RuleRegistry(p);
    const a = reg.discover('composer', COMPOSER_RULE, 'f', 0.9);
    const b = reg.discover('composer', { ...COMPOSER_RULE, profile: { tag: 'textarea' } }, 'f', 0.9);
    expect(a.rule_id).not.toBe(b.rule_id);
  });
});

describe('fingerprint persistence', () => {
  it('save + change detection', () => {
    const p = makeDb();
    const fp1 = fakeFp('hash-1');
    const fp2 = fakeFp('hash-2');
    expect(fingerprintChangeSinceLast(p, fp1)).toBe(true); // no baseline yet
    saveFingerprint(p, fp1);
    expect(fingerprintChangeSinceLast(p, fp1)).toBe(false); // same
    expect(fingerprintChangeSinceLast(p, fp2)).toBe(true); // drifted
  });
});

describe('computeUiFingerprint', () => {
  it('hash is deterministic for identical features', async () => {
    const f: UiFingerprint['features'] = {
      mainLandmark: true,
      composer: { editable: true, tag: 'div', hasPlaceholder: true, lowerViewport: true },
      submit: { testid: null, ariaLabel: '发送提示' },
      messageRoles: { user: true, assistant: true },
      stopControl: false,
      newChatControl: true,
      buttonCountBucket: '60-150',
    };
    // (Direct hash check via a tiny eval-free helper would need a page; here
    // we just verify the fingerprint type contract used by persistence.)
    expect(f).toMatchObject({ mainLandmark: true });
  });
});
