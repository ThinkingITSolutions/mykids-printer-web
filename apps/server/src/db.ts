import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { env } from './env.js';

export const db = new DatabaseSync(path.join(env.dataDir, 'mykids-printer.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','operator')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS printers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mykids_id TEXT NOT NULL UNIQUE,
  mykids_name TEXT,
  nickname TEXT NOT NULL,
  ticket_type TEXT NOT NULL,
  orientation TEXT NOT NULL DEFAULT 'LANDSCAPE',
  target TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  mykids_id TEXT NOT NULL,
  codigo TEXT,
  status TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL,
  msg TEXT NOT NULL
);
`);

/** Migrações leves (colunas novas em bancos já existentes). */
function addColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn('logs', 'category', "category TEXT NOT NULL DEFAULT 'sistema'");
addColumn('logs', 'actor', 'actor TEXT');
addColumn('jobs', 'printer_name', 'printer_name TEXT');
addColumn('jobs', 'labels', 'labels INTEGER');
addColumn('jobs', 'duration_ms', 'duration_ms INTEGER');
addColumn('jobs', 'source', 'source TEXT');
db.exec('CREATE INDEX IF NOT EXISTS logs_ts ON logs(ts); CREATE INDEX IF NOT EXISTS jobs_ts ON jobs(ts);');

export function getSetting<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setSetting(key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
