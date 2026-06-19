// POST /api/onboard
// Post-payment onboarding (commitment before work). Verifies the Stripe Checkout Session is PAID,
// then stores the buyer's config (booking link, ICP, min minutes, company, site) on od_accounts and
// uploads the do-not-contact CSV to Supabase Storage. Body:
//   { cs: "<checkout_session_id>", company, website, bookingLink, icp, minMinutes, blocklistCsv }
// No admin secret needed (paid session id is the capability), but onboarding is gated on payment_status=paid.

function clip(s, n) { return String(s || '').slice(0, n); }
async function readJsonBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
async function stripeGet(path, key) {
  const res = await fetch('https://api.stripe.com/v1/' + path, { headers: { 'Authorization': 'Bearer ' + key } });
  const json = await res.json();
  if (!res.ok) throw new Error(json && json.error ? json.error.message : 'stripe_error');
  return json;
}
async function notifySlack(text) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  try { await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const key = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.SUPABASE_URL, sbSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ error: 'stripe_not_configured' });
  if (!sbUrl || !sbSrv) return res.status(500).json({ error: 'supabase_not_configured' });

  try {
    const b = await readJsonBody(req);
    const cs = clip(b.cs, 200);
    if (!cs.startsWith('cs_')) return res.status(400).json({ error: 'session_required' });

    // Gate: the session must exist and be paid.
    const session = await stripeGet('checkout/sessions/' + cs, key);
    if (session.payment_status !== 'paid') return res.status(402).json({ error: 'not_paid' });
    const customerId = session.customer;
    if (!customerId) return res.status(400).json({ error: 'no_customer' });

    const bookingLink = clip(b.bookingLink, 400);
    const company = clip(b.company, 200);
    const website = clip(b.website, 200);
    const icp = clip(b.icp, 4000);
    const minMinutes = parseInt(b.minMinutes, 10) || 15;

    // Upload do-not-contact CSV (text) to private storage, if provided.
    let blocklistPath = null;
    const csv = typeof b.blocklistCsv === 'string' ? b.blocklistCsv.slice(0, 2000000) : '';
    if (csv) {
      blocklistPath = customerId + '/do-not-contact.csv';
      const up = await fetch(sbUrl + '/storage/v1/object/od-blocklists/' + blocklistPath, {
        method: 'POST',
        headers: { 'apikey': sbSrv, 'Authorization': 'Bearer ' + sbSrv, 'Content-Type': 'text/csv', 'x-upsert': 'true' },
        body: csv,
      });
      if (!up.ok) blocklistPath = null;
    }

    // Update the account row.
    const patch = {
      company: company || null, website: website || null, booking_link: bookingLink || null,
      icp: icp || null, min_minutes: minMinutes, status: 'onboarded', updated_at: new Date().toISOString(),
    };
    if (blocklistPath) patch.blocklist_path = blocklistPath;
    const r = await fetch(sbUrl + '/rest/v1/od_accounts?stripe_customer_id=eq.' + encodeURIComponent(customerId), {
      method: 'PATCH',
      headers: { 'apikey': sbSrv, 'Authorization': 'Bearer ' + sbSrv, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) return res.status(500).json({ error: 'save_failed' });

    // Stamp onboarded on the Stripe customer too (handy in the dashboard).
    try {
      await fetch('https://api.stripe.com/v1/customers/' + customerId, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ 'metadata[onboarded]': 'yes', 'metadata[booking_link]': bookingLink || '' }).toString(),
      });
    } catch (_) {}

    await notifySlack(':rocket: *Meetings on Demand* ONBOARDED: ' + (company || customerId) +
      '\n> Booking: ' + (bookingLink || '—') + ' · Min: ' + minMinutes + 'm · Blocklist: ' + (blocklistPath ? 'uploaded' : 'none') +
      '\n> ICP: ' + (clip(icp, 280) || '—') + '\n> Ready to build. Run the post-pay fit check, then spin up infra. `' + customerId + '`');

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'onboard_failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}
