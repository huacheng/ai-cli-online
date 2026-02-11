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

db.exec(`
  CREATE TABLE IF NOT EXISTS annotations (
    session_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_name, file_path)
  )
`);

// --- Annotations statements ---
const stmtAnnGet = db.prepare('SELECT content, updated_at FROM annotations WHERE session_name = ? AND file_path = ?');
const stmtAnnUpsert = db.prepare(`
  INSERT INTO annotations (session_name, file_path, content, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(session_name, file_path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
`);
const stmtAnnDelete = db.prepare('DELETE FROM annotations WHERE session_name = ? AND file_path = ?');
const stmtAnnCleanup = db.prepare('DELETE FROM annotations WHERE updated_at < ?');

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

// --- Annotation functions ---

export function getAnnotation(sessionName: string, filePath: string): { content: string; updatedAt: number } | null {
  const row = stmtAnnGet.get(sessionName, filePath) as { content: string; updated_at: number } | undefined;
  return row ? { content: row.content, updatedAt: row.updated_at } : null;
}

export function saveAnnotation(sessionName: string, filePath: string, content: string, updatedAt: number): void {
  if (!content || content === '{}' || content === '{"additions":[],"deletions":[]}') {
    stmtAnnDelete.run(sessionName, filePath);
  } else {
    stmtAnnUpsert.run(sessionName, filePath, content, updatedAt);
  }
}

export function cleanupOldAnnotations(maxAgeDays = 7): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const result = stmtAnnCleanup.run(cutoff);
  return result.changes;
}

export function closeDb(): void {
  db.close();
}
