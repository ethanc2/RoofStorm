import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../env';
const key = Buffer.from(env.KEY_ENCRYPTION_KEY, 'base64'); // validated to be exactly 32 bytes in env.ts
export function encrypt(plain: string): Buffer {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
export function decrypt(buf: Buffer): string {
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
