// POST /api/stripe-webhook
// On setup-fee payment: save the card as the customer's default payment method (so per-held-meeting
// charges can run off_session later) and stamp the bid/email/onboarding state on the customer.
// Also upserts an account row into Supabase when configured. Verifies the Stripe signature.

import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(raw));
    req.on('error', () => resolve(''));
  });
}
function verify(raw, sigHeader, secret) {
  if (!sigHeader) return false;
  const map = {};
  sigHeader.split(',').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i < 0) return;
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (k === 'v1') (map.v1 = map.v1 || []).push(v);
    else map[k] = v;
  });
  if (!map.t || !map.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(map.t + '.' + raw, 'utf8').digest('hex');
  return map.v1.some((sig) => { try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch (_) { return false; } });
}
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
async function stripe(path, params, key, method) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: method || (params ? 'POST' : 'GET'),
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? toForm(params).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json && json.error ? json.error.message : 'stripe_error');
  return json;
}
async function notifySlack(text) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  try { await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); } catch (_) {}
}
// Best-effort upsert into Supabase (no-op if not configured). Keyed on stripe_customer_id.
async function supabaseUpsert(row) {
  const url = process.env.SUPABASE_URL, srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) return;
  try {
    await fetch(url + '/rest/v1/od_accounts?on_conflict=stripe_customer_id', {
      method: 'POST',
      headers: { 'apikey': srv, 'Authorization': 'Bearer ' + srv, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
  } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  const key = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !whSecret) return res.status(500).json({ error: 'stripe_not_configured' });

  const raw = await readRaw(req);
  if (!verify(raw, req.headers['stripe-signature'], whSecret)) return res.status(400).json({ error: 'bad_signature' });

  let event;
  try { event = JSON.parse(raw); } catch (_) { return res.status(400).json({ error: 'bad_payload' }); }

  try {
    if (event.type === 'checkout.session.completed' && event.data.object && event.data.object.customer) {
      const s = event.data.object;
      const email = (s.customer_details && s.customer_details.email) || '';
      const phone = (s.customer_details && s.customer_details.phone) || '';
      const bid = (s.metadata && s.metadata.bid) || '';

      // Card lives on the SetupIntent (setup mode) or PaymentIntent (legacy payment mode).
      let pm = '';
      if (s.setup_intent) { const si = await stripe('setup_intents/' + s.setup_intent, null, key); pm = si.payment_method || ''; }
      else if (s.payment_intent) { const pi = await stripe('payment_intents/' + s.payment_intent, null, key); pm = pi.payment_method || ''; }

      const update = { metadata: { bid: bid, card_on_file: 'yes', onboarded: 'no', source: 'ondemand', pm: pm } };
      if (email) update.email = email;
      if (phone) update.phone = phone;
      if (pm) update['invoice_settings[default_payment_method]'] = pm;
      await stripe('customers/' + s.customer, update, key);

      await supabaseUpsert({
        stripe_customer_id: s.customer,
        email: email || null,
        phone: phone || null,
        bid_usd: bid ? parseInt(bid, 10) : null,
        setup_fee_usd: 0,
        status: 'paid_pending_onboarding',
        checkout_session_id: s.id,
      });

      await notifySlack(':white_check_mark: *Meetings on Demand* card saved (no charge) for *' + (email || s.customer) +
        '*. Bid $' + bid + '/held meeting. Awaiting onboarding.');
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    await notifySlack(':warning: Meetings on Demand webhook error: ' + String(err && err.message || err).slice(0, 200));
    return res.status(200).json({ received: true, handled: false });
  }
}
