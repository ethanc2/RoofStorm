import pg from 'pg';
import { env } from '../env';
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
export const q = <T extends pg.QueryResultRow = any>(text: string, params: any[] = []) => pool.query<T>(text, params).then(r => r.rows);

