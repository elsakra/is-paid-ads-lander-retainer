// POST /api/admin-action   (admin only; x-draw-secret: ADMIN_DRAW_SECRET)
// Human ops controls for the dashboard. Body: { action, customer, ... }
//   action="update"        { patch: { status?, notes?, booking_link?, icp?, min_minutes? } }  -> PATCH od_accounts
//   action="refund"        refunds the setup fee and marks the account declined_refunded
//   action="blocklist_url" returns a short-lived signed URL to the uploaded do-not-contact CSV
// Fulfillment stays manual. This only moves state, takes notes, refunds, and reads the blocklist.

const SB_URL = () => process.env.SUPABASE_URL;
const SB_SRV = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const STATUSES = ['paid_pending_onboarding', 'onboarded', 'fit_check', 'building', 'active', 'paused', 'declined', 'declined_refunded'];

async function readJsonBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
async function sbFetch(path, opts) {
  return fetch(SB_URL() + path, Object.assign({}, opts, {
    headers: Object.assign({ 'apikey': SB_SRV(), 'Authorization': 'Bearer ' + SB_SRV() }, (opts && opts.headers) || {}),
  }));
}
async function stripeForm(path, params, key) {
  const body = new URLSearchParams();
  for (const k in params) body.append(k, String(params[k]));
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json && json.error ? json.error.message : 'stripe_error');
  return json;
}
async function stripeGet(path, key) {
  const res = await fetch('https://api.stripe.com/v1/' + path, { headers: { 'Authorization': 'Bearer ' + key } });
  const json = await res.json();
  if (!res.ok) throw new Error(json && json.error ? json.error.message : 'stripe_error');
  return json;
}
function clip(s, n) { return String(s == null ? '' : s).slice(0, n); }
async function notifySlack(text) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  try { await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  if (!SB_URL() || !SB_SRV()) return res.status(500).json({ error: 'supabase_not_configured' });
  if (!process.env.ADMIN_DRAW_SECRET) return res.status(500).json({ error: 'admin_not_configured' });
  if (req.headers['x-draw-secret'] !== process.env.ADMIN_DRAW_SECRET) return res.status(401).json({ error: 'unauthorized' });

  try {
    const b = await readJsonBody(req);
    const action = String(b.action || '');
    const customer = String(b.customer || '');
    if (!customer.startsWith('cus_')) return res.status(400).json({ error: 'customer_required' });
    const q = '?stripe_customer_id=eq.' + encodeURIComponent(customer);

    if (action === 'update') {
      const patch = {};
      const p = b.patch || {};
      if (p.status !== undefined) { if (!STATUSES.includes(p.status)) return res.status(400).json({ error: 'bad_status' }); patch.status = p.status; }
      if (p.notes !== undefined) patch.notes = clip(p.notes, 4000);
      if (p.booking_link !== undefined) patch.booking_link = clip(p.booking_link, 400);
      if (p.icp !== undefined) patch.icp = clip(p.icp, 4000);
      if (p.min_minutes !== undefined) patch.min_minutes = parseInt(p.min_minutes, 10) || 15;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update' });
      patch.updated_at = new Date().toISOString();
      const r = await sbFetch('/rest/v1/od_accounts' + q, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify(patch) });
      if (!r.ok) return res.status(500).json({ error: 'update_failed' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'blocklist_url') {
      const rows = await (await sbFetch('/rest/v1/od_accounts' + q + '&select=blocklist_path', {})).json();
      const path = rows && rows[0] && rows[0].blocklist_path;
      if (!path) return res.status(404).json({ error: 'no_blocklist' });
      const signed = await (await sbFetch('/storage/v1/object/sign/od-blocklists/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }) })).json();
      if (!signed || !signed.signedURL) return res.status(500).json({ error: 'sign_failed' });
      return res.status(200).json({ ok: true, url: SB_URL() + '/storage/v1' + signed.signedURL });
    }

    if (action === 'decline') {
      // No charge today, so usually nothing to refund. If a setup charge ever exists, refund it too.
      const key = process.env.STRIPE_SECRET_KEY;
      const rows = await (await sbFetch('/rest/v1/od_accounts' + q + '&select=checkout_session_id,company', {})).json();
      const csId = rows && rows[0] && rows[0].checkout_session_id;
      let refundId = null;
      if (key && csId) {
        try {
          const session = await stripeGet('checkout/sessions/' + csId, key);
          if (session.payment_intent) { const r = await stripeForm('refunds', { payment_intent: session.payment_intent, reason: 'requested_by_customer' }, key); refundId = r.id; }
        } catch (_) {}
      }
      await sbFetch('/rest/v1/od_accounts' + q, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ status: 'declined', updated_at: new Date().toISOString() }) });
      await notifySlack(':leftwards_arrow_with_hook: *Meetings on Demand* declined: ' + (clip((rows[0] || {}).company, 120) || customer) + (refundId ? (' (refund `' + refundId + '`)') : ' (no charge to refund)') + '.');
      return res.status(200).json({ ok: true, refund: refundId, status: 'declined' });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    return res.status(500).json({ error: 'action_failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}
