import { describe, expect, it } from 'vitest';
import { Persistence } from '../../src/persistence/sqlite.js';
import { RequestStore } from '../../src/persistence/requests.js';
import { SessionStore } from '../../src/persistence/sessions.js';

function makeDb(): Persistence {
  return new Persistence({ dbPath: ':memory:' });
}

describe('RequestStore (spec §17, §43)', () => {
  it('createOrGet is idempotent on request_hash', () => {
    const p = makeDb();
    const store = new RequestStore(p);
    const rec = {
      request_id: 'r1',
      request_hash: 'h1',
      hermes_session_id: 's1',
      web_thread_id: '',
      prompt_hash: 'p1',
      prompt_text: 'hello',
      state: 'PENDING' as const,
      response_hash: '',
      response_text: '',
    };
    const a = store.createOrGet(rec);
    const b = store.createOrGet({ ...rec, request_id: 'r2' });
    expect(b.request_id).toBe('r1'); // existing wins — same request, not a new one
    expect(a.request_id).toBe(b.request_id);
  });

  it('tracks lifecycle PENDING → SUBMITTED → COMPLETED with response', () => {
    const p = makeDb();
    const store = new RequestStore(p);
    const rec = {
      request_id: 'r1',
      request_hash: 'h1',
      hermes_session_id: 's1',
      web_thread_id: '',
      prompt_hash: 'p1',
      prompt_text: 'hi',
      state: 'PENDING' as const,
      response_hash: '',
      response_text: '',
    };
    store.createOrGet(rec);
    store.updateState('r1', 'SUBMITTED', { web_thread_id: 't1' });
    let row = store.getById('r1')!;
    expect(row.state).toBe('SUBMITTED');
    expect(row.web_thread_id).toBe('t1');
    store.completeWithResponse('r1', 'the answer');
    row = store.getById('r1')!;
    expect(row.state).toBe('COMPLETED');
    expect(row.response_text).toBe('the answer');
  });

  it('listUnfinished returns only SUBMITTED/GENERATING', () => {
    const p = makeDb();
    const store = new RequestStore(p);
    const base = {
      hermes_session_id: 's1',
      web_thread_id: '',
      prompt_hash: 'p',
      prompt_text: 'q',
      response_hash: '',
      response_text: '',
    };
    store.createOrGet({ ...base, request_id: 'a', request_hash: 'ha', state: 'PENDING' });
    store.createOrGet({ ...base, request_id: 'b', request_hash: 'hb', state: 'SUBMITTED' });
    store.createOrGet({ ...base, request_id: 'c', request_hash: 'hc', state: 'COMPLETED' });
    store.createOrGet({ ...base, request_id: 'd', request_hash: 'hd', state: 'GENERATING' });
    const ids = store.listUnfinished().map((r) => r.request_id).sort();
    expect(ids).toEqual(['b', 'd']);
  });

  it('resetToPending allows retry after FAILED', () => {
    const p = makeDb();
    const store = new RequestStore(p);
    const rec = {
      request_id: 'r1',
      request_hash: 'h1',
      hermes_session_id: 's1',
      web_thread_id: '',
      prompt_hash: 'p',
      prompt_text: 'q',
      state: 'PENDING' as const,
      response_hash: '',
      response_text: '',
    };
    store.createOrGet(rec);
    store.markFailed('r1', 'boom');
    expect(store.getById('r1')!.state).toBe('FAILED');
    store.resetToPending('r1');
    expect(store.getById('r1')!.state).toBe('PENDING');
  });
});

describe('SessionStore (spec §19)', () => {
  it('upserts and reads a session mapping', () => {
    const p = makeDb();
    const store = new SessionStore(p);
    expect(store.get('s1')).toBeNull();
    store.upsert('s1', { web_thread_id: 't1', web_thread_url: 'https://chatgpt.com/c/t1', prev_history: 'user|a' });
    const row = store.get('s1')!;
    expect(row.web_thread_id).toBe('t1');
    expect(row.web_thread_url).toBe('https://chatgpt.com/c/t1');
    expect(row.prev_history).toBe('user|a');
    expect(row.generation).toBe(0);
    expect(row.status).toBe('active');
  });

  it('detach marks the thread detached without losing mapping', () => {
    const p = makeDb();
    const store = new SessionStore(p);
    store.upsert('s1', { web_thread_id: 't1' });
    store.detach('s1');
    expect(store.get('s1')!.status).toBe('detached');
    expect(store.get('s1')!.web_thread_id).toBe('t1');
  });

  it('preserves created_at across upserts', () => {
    const p = makeDb();
    const store = new SessionStore(p);
    store.upsert('s1', { web_thread_id: 't1' });
    const first = store.get('s1')!.created_at;
    store.upsert('s1', { web_thread_id: 't2' });
    const second = store.get('s1')!;
    expect(second.created_at).toBe(first);
    expect(second.web_thread_id).toBe('t2');
    expect(second.updated_at).toBeGreaterThanOrEqual(first);
  });
});
