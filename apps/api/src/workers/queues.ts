import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../env';
export const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const inspectionQueue = new Queue('inspections', { connection });
export const syncQueue = new Queue('jobnimbus-sync', { connection });
export const stormQueue = new Queue('storm-refresh', { connection });
