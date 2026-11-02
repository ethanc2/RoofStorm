import * as SQLite from 'expo-sqlite';
import { call } from './api';
/** Knocks and inspection creates write here first; replay when online. Server dedupes on client_id. */
const db = SQLite.openDatabaseSync('stormroute.db');
db.execSync(`CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER DEFAULT 0, last_error TEXT, dead INTEGER DEFAULT 0)`);
try { db.execSync('ALTER TABLE outbox ADD COLUMN last_error TEXT'); db.execSync('ALTER TABLE outbox ADD COLUMN dead INTEGER DEFAULT 0'); } catch { /* columns already exist */ }
const MAX_ATTEMPTS = 20;
export function enqueue(path: string, body: object) { db.runSync('INSERT INTO outbox (path, body, created_at) VALUES (?,?,?)', path, JSON.stringify(body), Date.now()); void flush(); }
let flushing = false;
/**
 * Replays the queue in order. Network errors / 5xx stop the pass (we're offline or the server is down — retry later).
 * 4xx means this row will never succeed → mark dead and keep going so one bad row can't block the rest.
 */
export async function flush() {
  if (flushing) return; flushing = true;
  try {
    for (const row of db.getAllSync<{ id: number; path: string; body: string; attempts: number }>('SELECT * FROM outbox WHERE dead = 0 ORDER BY id')) {
      try { await call('POST', row.path, JSON.parse(row.body)); db.runSync('DELETE FROM outbox WHERE id=?', row.id); }
      catch (e: any) {
        const status: number | undefined = e?.status; const permanent = (status != null && status >= 400 && status < 500 && status !== 401 && status !== 429) || row.attempts + 1 >= MAX_ATTEMPTS;
        db.runSync('UPDATE outbox SET attempts=attempts+1, last_error=?, dead=? WHERE id=?', String(e?.message ?? e), permanent ? 1 : 0, row.id);
        if (!permanent) break;
      }
    }
  } finally { flushing = false; }
}
export const pending = () => db.getFirstSync<{ n: number }>('SELECT count(*) n FROM outbox WHERE dead = 0')?.n ?? 0;
export const failed = () => db.getAllSync<{ id: number; path: string; body: string; last_error: string }>('SELECT id, path, body, last_error FROM outbox WHERE dead = 1 ORDER BY id');
export const discardFailed = (id: number) => db.runSync('DELETE FROM outbox WHERE id=? AND dead=1', id);

