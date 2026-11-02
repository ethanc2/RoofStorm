import { q } from './pool';
export const logUsage = (companyId: string, service: string, endpoint: string, units = 1, costCents = 0) =>
  q(`INSERT INTO api_usage (company_id, service, endpoint, units, cost_cents) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (company_id, service, endpoint, day) DO UPDATE SET units = api_usage.units + $4, cost_cents = api_usage.cost_cents + $5`,
    [companyId, service, endpoint, units, costCents]);
