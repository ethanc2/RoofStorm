import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './pool';
const dir = join(process.cwd(), 'migrations');
const client = await pool.connect(); // one connection so BEGIN/COMMIT actually wrap the DDL
try {
  await client.query('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, ran_at timestamptz DEFAULT now())');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const done = await client.query('SELECT 1 FROM _migrations WHERE name=$1', [f]);
    if (done.rowCount) continue;
    console.log('migrating', f);
    await client.query('BEGIN');
    try { await client.query(readFileSync(join(dir, f), 'utf8')); await client.query('INSERT INTO _migrations(name) VALUES ($1)', [f]); await client.query('COMMIT'); }
    catch (e) { await client.query('ROLLBACK'); throw e; }
  }
} finally { client.release(); await pool.end(); }

