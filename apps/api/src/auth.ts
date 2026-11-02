import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Role } from '@stormroute/shared';
import { q } from './db/pool';
export interface AuthUser { id: string; companyId: string; role: Role; }
declare module '@fastify/jwt' { interface FastifyJWT { user: AuthUser } }
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => { await req.jwtVerify(); if (!roles.includes(req.user.role)) throw Object.assign(new Error('forbidden'), { statusCode: 403 }); };
}
export const requireAuth = async (req: FastifyRequest) => { await req.jwtVerify(); };
export function registerAuth(app: FastifyInstance) { app.decorate('requireAuth', requireAuth); }
/** Tenant guard: 404 unless the parcel belongs to the caller's company (prevents cross-company writes by guessed ids). */
export async function assertParcelInCompany(parcelId: string, companyId: string) {
  const [p] = await q(`SELECT 1 FROM parcels WHERE id=$1 AND company_id=$2`, [parcelId, companyId]);
  if (!p) throw Object.assign(new Error('parcel not found'), { statusCode: 404 });
}

