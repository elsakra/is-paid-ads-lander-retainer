// POST /api/admin-accounts   (admin only; x-draw-secret: ADMIN_DRAW_SECRET)
// Returns all Meetings on Demand accounts + their meetings for the internal ops dashboard.
// Service-role read; never expose this key client-side (the dashboard sends only the admin secret).

async function sb(path) {
  const url = process.env.SUPABASE_URL, srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(url + '/rest/v1/' + path, { headers: { 'apikey': srv, 'Authorization': 'Bearer ' + srv } });
  if (!res.ok) throw new Error('supabase_' + res.status);
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'supabase_not_configured' });
  if (!process.env.ADMIN_DRAW_SECRET) return res.status(500).json({ error: 'admin_not_configured' });
  if (req.headers['x-draw-secret'] !== process.env.ADMIN_DRAW_SECRET) return res.status(401).json({ error: 'unauthorized' });

  try {
    const accounts = await sb('od_accounts?select=*&order=created_at.desc');
    const meetings = await sb('od_meetings?select=*&order=created_at.desc&limit=500');
    return res.status(200).json({ accounts, meetings });
  } catch (err) {
    return res.status(500).json({ error: 'load_failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}
