import { request } from 'undici';
import { env } from '../env';
const BASE = env.JOBNIMBUS_BASE_URL;

/** JobNimbus Open API: Bearer API key, GET/POST on /contacts, /jobs, /tasks. Field names follow the public API docs. */
export class JobNimbus {
  constructor(private apiKey: string) {}
  private async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: any): Promise<T> {
    const res = await request(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (res.statusCode >= 400) throw new Error(`jobnimbus ${method} ${path} ${res.statusCode}: ${await res.body.text()}`);
    return res.body.json() as Promise<T>;
  }
  // The API pages with size/from; no reliable server-side date filter, so callers diff by date_updated.
  listContacts(from = 0, size = 500) { return this.call<{ count: number; results: JnContactRaw[] }>('GET', `/contacts?size=${size}&from=${from}`); }
  listJobs(from = 0, size = 500) { return this.call<{ count: number; results: JnJobRaw[] }>('GET', `/jobs?size=${size}&from=${from}`); }
  async *allJobs() { let from = 0; for (;;) { const r = await this.listJobs(from); yield* r.results; from += r.results.length; if (!r.results.length || from >= r.count) break; } }
  async *allContacts() { let from = 0; for (;;) { const r = await this.listContacts(from); yield* r.results; from += r.results.length; if (!r.results.length || from >= r.count) break; } }
  createContact(c: Partial<JnContactRaw>) { return this.call<JnContactRaw>('POST', '/contacts', c); }
  createJob(j: Partial<JnJobRaw> & { related?: { id: string; type: 'contact' }[] }) { return this.call<JnJobRaw>('POST', '/jobs', j); }
  createTask(t: { title: string; date_start: number; date_end: number; record_type_name?: string; related: { id: string; type: 'job' | 'contact' }[]; owners?: { id: string }[] }) {
    return this.call<{ jnid: string }>('POST', '/tasks', t);
  }
  /** Duplicate guard: match by phone, then by normalized address line. */
  async findContact(phone?: string, addressLine1?: string): Promise<JnContactRaw | null> {
    const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for await (const c of this.allContacts()) {
      if (phone && [c.mobile_phone, c.home_phone, c.work_phone].some(p => norm(p) && norm(p) === norm(phone))) return c;
      if (addressLine1 && norm(c.address_line1) === norm(addressLine1)) return c;
    }
    return null;
  }
}
export interface JnContactRaw { jnid: string; display_name?: string; first_name?: string; last_name?: string; mobile_phone?: string; home_phone?: string; work_phone?: string; email?: string;
  address_line1?: string; city?: string; state_text?: string; zip?: string; status?: number; status_name?: string; sales_rep?: string; sales_rep_name?: string; date_updated?: number; record_type_name?: string; }
export interface JnJobRaw { jnid: string; name?: string; record_type?: number; record_type_name?: string; status?: number; status_name?: string; sales_rep?: string; sales_rep_name?: string;
  address_line1?: string; city?: string; state_text?: string; zip?: string; date_created?: number; date_updated?: number; primary?: { id: string; type: string }; [custom: string]: any; }
