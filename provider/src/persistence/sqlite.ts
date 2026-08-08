/**
 * SQLite open/migrate (spec §43).
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema.js';

export interface PersistenceOptions {
  dbPath: string;
}

export class Persistence {
  readonly db: DatabaseSync;

  constructor(opts: PersistenceOptions) {
    if (opts.dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(opts.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
    // Dev upgrades for databases created before these columns existed.
    for (const alter of [
      'ALTER TABLE requests ADD COLUMN prompt_text TEXT NOT NULL DEFAULT \'\'',
      'ALTER TABLE requests ADD COLUMN response_text TEXT NOT NULL DEFAULT \'\'',
    ]) {
      try {
        this.db.exec(alter);
      } catch {
        // column already exists
      }
    }
  }

  close(): void {
    this.db.close();
  }
}
