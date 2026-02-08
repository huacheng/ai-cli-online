import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const DB_PATH = join(DATA_DIR, 'ai-cli-online.db');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    session_name TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    token_hash TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (token_hash, key)
  )
`);

// --- Drafts statements ---
const stmtGet = db.prepare('SELECT content FROM drafts WHERE session_name = ?');
const stmtUpsert = db.prepare(`
  INSERT INTO drafts (session_name, content, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(session_name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
`);
const stmtDelete = db.prepare('DELETE FROM drafts WHERE session_name = ?');
const stmtCleanup = db.prepare('DELETE FROM drafts WHERE updated_at < ?');

// --- Settings statements ---
const stmtSettingGet = db.prepare('SELECT value FROM settings WHERE token_hash = ? AND key = ?');
const stmtSettingUpsert = db.prepare(`
  INSERT INTO settings (token_hash, key, value, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(token_hash, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);

export function getSetting(tokenHash: string, key: string): string | null {
  const row = stmtSettingGet.get(tokenHash, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function saveSetting(tokenHash: string, key: string, value: string): void {
  stmtSettingUpsert.run(tokenHash, key, value, Date.now());
}

// --- Draft functions ---

export function getDraft(sessionName: string): string {
  const row = stmtGet.get(sessionName) as { content: string } | undefined;
  return row?.content ?? '';
}

export function saveDraft(sessionName: string, content: string): void {
  if (!content) {
    stmtDelete.run(sessionName);
  } else {
    stmtUpsert.run(sessionName, content, Date.now());
  }
}

export function deleteDraft(sessionName: string): void {
  stmtDelete.run(sessionName);
}

export function cleanupOldDrafts(maxAgeDays = 7): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = stmtCleanup.run(cutoff);
  return result.changes;
}

export function closeDb(): void {
  db.close();
}
