// POST /api/create-checkout
// One step: charge a small refundable SETUP FEE and save the card off_session (for per-held-meeting
// charges later). Minimal friction: the only thing asked before payment is the bid; Stripe Checkout
// collects email + card. Secret lives only in STRIPE_SECRET_KEY (Vercel env). Returns { url }.

const SETUP_FEE_USD = 500;   // sized to cost-to-serve (infra build/warm). Refundable if we don't deliver.
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
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: toForm(params).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json && json.error ? (json.error.message || json.error.type) : 'stripe_error');
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

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(500).json({ error: 'stripe_not_configured' });

  try {
    const b = await readJsonBody(req);
    const bid = parseInt(b.bid, 10);
    if (isNaN(bid) || bid < BID_FLOOR_USD) return res.status(400).json({ error: 'bid_below_floor' });

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'go.intentsignal.ai';
    const base = process.env.SITE_URL || (proto + '://' + host);

    const meta = { bid: String(bid), setup_fee: String(SETUP_FEE_USD), source: 'ondemand', onboarded: 'no' };

    const session = await stripe('checkout/sessions', {
      mode: 'payment',
      customer_creation: 'always',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: true },
      line_items: { 0: {
        price_data: {
          currency: 'usd',
          unit_amount: SETUP_FEE_USD * 100,
          product_data: { name: 'Meetings on Demand setup', description: 'One-time, refundable. Then $' + bid + ' per qualified meeting held.' },
        },
        quantity: 1,
      } },
      payment_intent_data: { setup_future_usage: 'off_session', metadata: { bid: String(bid), kind: 'ondemand_setup' } },
      metadata: meta,
      success_url: base + '/ondemand/onboarding?cs={CHECKOUT_SESSION_ID}',
      cancel_url: base + '/ondemand',
    }, key);

    await notifySlack(':moneybag: *Meetings on Demand* checkout started — bid *$' + bid + '*/held meeting, $' + SETUP_FEE_USD + ' setup. Session `' + session.id + '`.');
    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: 'checkout_failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}
