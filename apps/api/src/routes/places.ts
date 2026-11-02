import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { GoogleMaps } from '../integrations/google';
/** Address search (Places API New) for the map search box. Clients pass a sessionToken (uuid) across autocomplete → details so Google bills one session. */
export async function placeRoutes(app: FastifyInstance) {
  app.get('/autocomplete', { preHandler: requireAuth }, async (req) => {
    const p = z.object({ q: z.string().min(2).max(200), lng: z.coerce.number().optional(), lat: z.coerce.number().optional(), session: z.string().max(64).optional() }).parse(req.query);
    const bias = p.lng != null && p.lat != null ? { center: [p.lng, p.lat] as [number, number], radiusM: 30000 } : undefined;
    return new GoogleMaps(req.user.companyId).autocomplete(p.q, bias, p.session);
  });
  app.get('/:placeId', { preHandler: requireAuth }, async (req) => {
    const { session } = z.object({ session: z.string().max(64).optional() }).parse(req.query);
    return new GoogleMaps(req.user.companyId).placeDetails((req.params as any).placeId, session);
  });
}
