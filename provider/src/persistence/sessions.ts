/**
 * Hermes session ↔ ChatGPT thread mapping (spec §19, §20).
 * Divergence (compression / rewind / branch / manual edit) detaches the old
 * thread and requires a fresh thread with canonical context.
 */

import type { Persistence } from './sqlite.js';

export type SessionStatus = 'active' | 'detached';

export interface SessionRecord {
  hermes_session_id: string;
  web_thread_id: string;
  web_thread_url: string;
  history_hash: string;
  prev_history: string;
  generation: number;
  status: SessionStatus;
  created_at: number;
  updated_at: number;
}

const MAX_PREV_HISTORY = 500_000; // chars; safety cap

export class SessionStore {
  constructor(private readonly persistence: Persistence) {}

  private rowToRecord(r: Record<string, unknown>): SessionRecord {
    return {
      hermes_session_id: String(r.hermes_session_id),
      web_thread_id: String(r.web_thread_id),
      web_thread_url: String(r.web_thread_url),
      history_hash: String(r.history_hash),
      prev_history: String(r.prev_history),
      generation: Number(r.generation),
      status: r.status as SessionStatus,
      created_at: Number(r.created_at),
      updated_at: Number(r.updated_at),
    };
  }

  get(sessionId: string): SessionRecord | null {
    const row = this.persistence.db
      .prepare('SELECT * FROM sessions WHERE hermes_session_id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  /** Upsert. `prev_history` is the canonical history the adapter last saw. */
  upsert(sessionId: string, fields: Partial<Omit<SessionRecord, 'hermes_session_id'>>): SessionRecord {
    const existing = this.get(sessionId);
    const now = Date.now();
    const merged: SessionRecord = {
      hermes_session_id: sessionId,
      web_thread_id: fields.web_thread_id ?? existing?.web_thread_id ?? '',
      web_thread_url: fields.web_thread_url ?? existing?.web_thread_url ?? '',
      history_hash: fields.history_hash ?? existing?.history_hash ?? '',
      prev_history: (fields.prev_history ?? existing?.prev_history ?? '').slice(0, MAX_PREV_HISTORY),
      generation: fields.generation ?? existing?.generation ?? 0,
      status: fields.status ?? existing?.status ?? 'active',
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.persistence.db
      .prepare(
        `INSERT INTO sessions (hermes_session_id, web_thread_id, web_thread_url, history_hash, prev_history, generation, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hermes_session_id) DO UPDATE SET
           web_thread_id = excluded.web_thread_id,
           web_thread_url = excluded.web_thread_url,
           history_hash = excluded.history_hash,
           prev_history = excluded.prev_history,
           generation = excluded.generation,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run(
        sessionId,
        merged.web_thread_id,
        merged.web_thread_url,
        merged.history_hash,
        merged.prev_history,
        merged.generation,
        merged.status,
        merged.created_at,
        merged.updated_at,
      );
    return merged;
  }

  detach(sessionId: string): void {
    this.persistence.db
      .prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE hermes_session_id = ?')
      .run('detached', Date.now(), sessionId);
  }
}
