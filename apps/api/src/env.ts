import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load .env from the package dir or the repo root (first match wins per key; existing process env is never overridden).
for (const f of ['.env', '../../.env']) {
  const p = resolve(process.cwd(), f);
  if (existsSync(p)) { try { process.loadEnvFile(p); } catch { /* ignore malformed lines */ } }
}

const b64Bytes = (s: string) => { try { return Buffer.from(s, 'base64').length; } catch { return 0; } };

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars (openssl rand -base64 32)'),
  KEY_ENCRYPTION_KEY: z.string().refine(s => b64Bytes(s) === 32, 'KEY_ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32)'),
  SWATH_API_URL: z.string().url().default('https://swathapi.com'),
  JOBNIMBUS_BASE_URL: z.string().url().default('https://app.jobnimbus.com/api1'),
  // Google Maps Platform — one IP-restricted server key for Geocoding, Routes, Solar, Street View Static, Places (New)
  GOOGLE_MAPS_SERVER_KEY: z.string().min(20, 'GOOGLE_MAPS_SERVER_KEY is required'),
  // Optional: Route Optimization API (>25 stops). Needs a service account + project; API keys are not accepted by that API.
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  // Optional: Street View Static URL-signing secret (Cloud Console → Maps Platform → Credentials → URL signing secret)
  GOOGLE_STREETVIEW_SIGNING_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment:\n${lines}\n\nCopy .env.example to .env and fill in the values.`);
  process.exit(1);
}
export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
