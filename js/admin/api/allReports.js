import { SUPABASE_URL } from '../config.js?v=ffed3d84';
import { supabaseHeaders } from '../utils.js?v=86489fcb';

const COLS = 'id,app_id,title,client_id,proton_pulse_user_id,rating,source,is_flagged,is_hidden,created_at';

export async function fetchAllReports(session, { search = '', status = '', limit = 500 } = {}) {
  let url = `${SUPABASE_URL}/rest/v1/user_configs?select=${COLS}&order=created_at.desc&limit=${limit}`;

  if (search) {
    const q = encodeURIComponent(search.trim());
    url += `&or=(app_id.eq.${q},title.ilike.*${q}*)`;
  }

  if (status === 'flagged') url += '&is_flagged=eq.true';
  if (status === 'hidden')  url += '&is_hidden=eq.true';
  if (status === 'clean')   url += '&is_flagged=eq.false&is_hidden=eq.false';

  const res = await fetch(url, { headers: supabaseHeaders(session) });
  if (!res.ok) throw new Error(`Failed to fetch reports: ${res.status}`);
  return res.json();
}

export async function patchReportFlags(session, id, patch) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_configs?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(session, { Prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) throw new Error(`Patch failed: ${res.status}`);
}
