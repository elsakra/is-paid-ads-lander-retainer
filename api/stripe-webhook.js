// POST /api/stripe-webhook
// On deposit payment: credit the customer's Stripe balance by the deposit amount (so per-meeting
// draws can be applied against it) and set the saved card as the invoice default payment method.
// Verifies the Stripe signature with STRIPE_WEBHOOK_SECRET. Raw body required (do not pre-parse).

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
  return map.v1.some((sig) => {
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch (_) { return false; }
  });
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

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).end(); }
  const key = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !whSecret) return res.status(500).json({ error: 'stripe_not_configured' });

  const raw = await readRaw(req);
  if (!verify(raw, req.headers['stripe-signature'], whSecret)) {
    return res.status(400).json({ error: 'bad_signature' });
  }

  let event;
  try { event = JSON.parse(raw); } catch (_) { return res.status(400).json({ error: 'bad_payload' }); }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'payment' && session.customer && session.amount_total) {
        const customer = await stripe('customers/' + session.customer, null, key);
        const newBalance = (customer.balance || 0) - session.amount_total; // negative balance = credit
        const update = { balance: newBalance };

        // Make the card saved at checkout the default for future per-meeting invoices.
        if (session.payment_intent) {
          const pi = await stripe('payment_intents/' + session.payment_intent, null, key);
          if (pi.payment_method) update['invoice_settings[default_payment_method]'] = pi.payment_method;
        }
        await stripe('customers/' + session.customer, update, key);

        await notifySlack(
          ':white_check_mark: *Meetings on Demand* deposit captured: $' + (session.amount_total / 100).toFixed(0) +
          ' from `' + session.customer + '`. Credit balance now $' + (Math.abs(newBalance) / 100).toFixed(0) +
          '. Bid $' + (session.metadata && session.metadata.bid || '?') + '/meeting.'
        );
      }
    }
    return res.status(200).json({ received: true });
  } catch (err) {
    // 200 so Stripe does not hammer retries on our own downstream errors; we logged via Slack intent.
    await notifySlack(':warning: Meetings on Demand webhook error: ' + String(err && err.message || err).slice(0, 200));
    return res.status(200).json({ received: true, handled: false });
  }
}
