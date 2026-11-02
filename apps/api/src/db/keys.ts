import { q } from './pool';
import { decrypt } from './crypto';
export async function companyKeys(companyId: string) {
  const [c] = await q(`SELECT jobnimbus_api_key_enc, swath_api_key_enc, regrid_token_enc, settings FROM companies WHERE id=$1`, [companyId]);
  if (!c) throw new Error('company not found');
  return {
    jobnimbus: c.jobnimbus_api_key_enc ? decrypt(c.jobnimbus_api_key_enc) : null,
    swath: c.swath_api_key_enc ? decrypt(c.swath_api_key_enc) : null,
    regrid: c.regrid_token_enc ? decrypt(c.regrid_token_enc) : null,
    settings: c.settings as { statusColors?: Record<string, string>; inspectionStatusId?: number; inspectionRecordType?: string },
  };
}
