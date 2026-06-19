// POST /api/charge-meeting   (admin only; protect with ADMIN_DRAW_SECRET)
// Charges the buyer's bid for ONE verified-held meeting, off_session against the saved card.
// Body: { customer: "cus_...", meetingRef: "string", amount?: <usd, defaults to customer.metadata.bid> }
// Header: x-draw-secret: <ADMIN_DRAW_SECRET>
//
// Held-meeting verification (Calendly + join data) is wired separately; call this once a meeting is
// confirmed held and matches the buyer's criteria.

const BID_FLOOR_USD = 200;

function toForm(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const key in obj) {
    if (obj[key] === undefined || obj[key] === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    const v = obj[key];
    if (typeof v === 'object') toForm(v, k, out); else out.append(k, String(v));
  }
  return out;
}
async function stripe(path, params, key) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: params ? 'POST' : 'GET',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? toForm(params).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) { const e = new Error(json && json.error ? json.error.message : 'stripe_error'); e.stripe = json && json.error; throw e; }
  return json;
}
async function readJsonBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
async function notifySlack(text) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  try { await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); } catch (_) {}
}
async function supabaseInsert(table, row) {
  const url = process.env.SUPABASE_URL, srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) return;
  try {
    await fetch(url + '/rest/v1/' + table, {
      method: 'POST',
      headers: { 'apikey': srv, 'Authorization': 'Bearer ' + srv, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const key = process.env.STRIPE_SECRET_KEY;
  const adminSecret = process.env.ADMIN_DRAW_SECRET;
  if (!key || !adminSecret) return res.status(500).json({ error: 'not_configured' });
  if (req.headers['x-draw-secret'] !== adminSecret) return res.status(401).json({ error: 'unauthorized' });

  try {
    const b = await readJsonBody(req);
    const customerId = String(b.customer || '');
    const meetingRef = (String(b.meetingRef || '').slice(0, 120)) || 'held-meeting';
    if (!customerId.startsWith('cus_')) return res.status(400).json({ error: 'customer_required' });

    const customer = await stripe('customers/' + customerId, null, key);
    const bid = parseInt(b.amount, 10) || parseInt(customer.metadata && customer.metadata.bid, 10);
    if (isNaN(bid) || bid < BID_FLOOR_USD) return res.status(400).json({ error: 'bid_below_floor' });
    let pm = (customer.invoice_settings && customer.invoice_settings.default_payment_method) || (customer.metadata && customer.metadata.pm);
    if (!pm) {
      // Fallback: setup mode attaches the card to the customer even if the webhook never set a default.
      const pms = await stripe('customers/' + customerId + '/payment_methods?type=card', null, key);
      pm = pms && pms.data && pms.data[0] && pms.data[0].id;
    }
    if (!pm) return res.status(400).json({ error: 'no_saved_card' });

    let pi;
    try {
      pi = await stripe('payment_intents', {
        amount: bid * 100,
        currency: 'usd',
        customer: customerId,
        payment_method: pm,
        off_session: 'true',
        confirm: 'true',
        description: 'Held meeting: ' + meetingRef,
        metadata: { kind: 'ondemand_held_meeting', meeting_ref: meetingRef },
      }, key);
    } catch (e) {
      await notifySlack(':x: *Meetings on Demand* charge FAILED for `' + customerId + '` (' + meetingRef + '): ' + String(e.message).slice(0, 140) + '. Card may need updating.');
      await supabaseInsert('od_meetings', { stripe_customer_id: customerId, meeting_ref: meetingRef, amount_usd: bid, charge_status: 'failed', payment_intent_id: (e.stripe && e.stripe.payment_intent && e.stripe.payment_intent.id) || null });
      return res.status(402).json({ error: 'charge_failed', detail: String(e.message).slice(0, 200) });
    }

    await supabaseInsert('od_meetings', { stripe_customer_id: customerId, meeting_ref: meetingRef, amount_usd: bid, charge_status: pi.status, payment_intent_id: pi.id, held_at: new Date().toISOString() });
    await notifySlack(':inbox_tray: *Meetings on Demand* charged $' + bid + ' for held meeting `' + meetingRef + '` (' + (customer.email || customerId) + '). Status: ' + pi.status + '.');

    return res.status(200).json({ ok: true, payment_intent: pi.id, status: pi.status, charged_usd: bid });
  } catch (err) {
    return res.status(500).json({ error: 'charge_failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}
