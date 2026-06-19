// POST /api/create-checkout
// Zero-friction card capture: Stripe Checkout in SETUP mode saves the card off_session with NO
// charge today. The only charge that ever lands is the bid, per held meeting, later. Minimal
// friction: the only thing asked before this is the bid; Checkout collects email + card.
// Secret lives only in STRIPE_SECRET_KEY (Vercel env). Returns { url }.

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

    const meta = { bid: String(bid), source: 'ondemand', onboarded: 'no' };

    // SETUP mode: saves the card (off_session) with NO charge. A customer is created automatically.
    const session = await stripe('checkout/sessions', {
      mode: 'setup',
      payment_method_types: { 0: 'card' },
      setup_intent_data: { metadata: { bid: String(bid), kind: 'ondemand_card_on_file' } },
      metadata: meta,
      success_url: base + '/ondemand/onboarding?cs={CHECKOUT_SESSION_ID}',
      cancel_url: base + '/ondemand',
    }, key);

    await notifySlack(':credit_card: *Meetings on Demand* card-capture started: bid *$' + bid + '*/held meeting (no charge today). Session `' + session.id + '`.');
    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: 'checkout_failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}
