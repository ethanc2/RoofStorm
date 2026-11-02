import { env, isProd } from './env'; // validates env first; exits with a readable message when misconfigured
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { parcelRoutes } from './routes/parcels';
import { stormRoutes } from './routes/storms';
import { jobRoutes } from './routes/jobs';
import { knockRoutes } from './routes/knocks';
import { inspectionRoutes } from './routes/inspections';
import { routeRoutes } from './routes/routes';
import { mailRoutes } from './routes/mail';
import { webhookRoutes } from './routes/webhooks';
import { adminRoutes } from './routes/admin';
import { placeRoutes } from './routes/places';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(jwt, { secret: env.JWT_SECRET });
await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: (req) => req.url.startsWith('/v1/webhooks/') });

// Validation errors → 400 with issues; everything else keeps its statusCode (or 500) and hides internals in production.
app.setErrorHandler((err: any, req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) req.log.error({ err }, 'unhandled');
  return reply.code(status).send({ error: status >= 500 && isProd ? 'internal error' : err.message });
});

app.get('/health', async () => ({ ok: true }));
await app.register(parcelRoutes, { prefix: '/v1/parcels' });
await app.register(stormRoutes, { prefix: '/v1/storms' });
await app.register(jobRoutes, { prefix: '/v1/jobs' });
await app.register(knockRoutes, { prefix: '/v1/knocks' });
await app.register(inspectionRoutes, { prefix: '/v1/inspections' });
await app.register(routeRoutes, { prefix: '/v1/routes' });
await app.register(mailRoutes, { prefix: '/v1/mail-campaigns' });
await app.register(webhookRoutes, { prefix: '/v1/webhooks' });
await app.register(adminRoutes, { prefix: '/v1/admin' });
await app.register(placeRoutes, { prefix: '/v1/places' });

await app.listen({ port: env.PORT, host: '0.0.0.0' });

