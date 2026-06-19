// POST /api/create-deposit-session
// Creates a Stripe Customer (with the buyer's config) and a Checkout Session for the
// refundable deposit. The card is saved off_session so per-held-meeting draws can run later.
// Secret lives only in STRIPE_SECRET_KEY (Vercel env). Returns { url } to redirect to.

const DEPOSIT_USD = 3000;            // deposit amount, fully applied against meetings (your call)
const BID_FLOOR_USD = 200;           // hard floor per held meeting

// Flatten a nested object into Stripe's bracket form-encoding (metadata[bid], line_items[0][..]).
function toForm(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const key in obj) {
    if (obj[key] === undefined || obj[key] === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    const v = obj[key];
    if (typeof v === 'object') toForm(v, k, out);
    else out.append(k, String(v));
  }
  return out;
}

async function stripe(path, params, key) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
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

function clip(s, n) { return String(s || '').slice(0, n); }

async function notifySlack(text) {
  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) return;
  try { await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(500).json({ error: 'stripe_not_configured' });

  try {
    const b = await readJsonBody(req);

    const email = clip(b.email, 200).trim();
    const bid = parseInt(b.bid, 10);
    if (!email || email.indexOf('@') < 0) return res.status(400).json({ error: 'email_required' });
    if (isNaN(bid) || bid < BID_FLOOR_USD) return res.status(400).json({ error: 'bid_below_floor' });

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'go.intentsignal.ai';
    const base = process.env.SITE_URL || (proto + '://' + host);

    // Config we keep on the customer (Stripe metadata caps values ~500 chars; long lists go to Slack).
    const meta = {
      bid: String(bid),
      cap: b.cap ? String(b.cap) : '',
      min_minutes: clip(b.minMinutes, 8),
      incentive: b.incentive ? 'yes' : 'no',
      domain: clip(b.domain, 200),
      acv: clip(b.acv, 16),
      icp: clip(b.icp, 480),
      blocklists: clip(b.blocklists, 480),
      source: 'ondemand',
    };

    const customer = await stripe('customers', {
      email,
      name: clip(b.company, 200) || email,
      description: 'Meetings on Demand — ' + (clip(b.company, 120) || email),
      metadata: meta,
    }, key);

    const session = await stripe('checkout/sessions', {
      mode: 'payment',
      customer: customer.id,
      client_reference_id: clip(b.company, 200) || email,
      line_items: { 0: {
        price_data: {
          currency: 'usd',
          unit_amount: DEPOSIT_USD * 100,
          product_data: { name: 'Meetings on Demand deposit', description: 'Applied against held meetings at your bid of $' + bid + ' each.' },
        },
        quantity: 1,
      } },
      payment_intent_data: { setup_future_usage: 'off_session', metadata: { bid: String(bid), kind: 'ondemand_deposit' } },
      metadata: meta,
      success_url: base + '/ondemand/success',
      cancel_url: base + '/ondemand',
    }, key);

    await notifySlack(
      ':moneybag: *Meetings on Demand* deposit checkout started\n' +
      '> *' + (clip(b.company, 120) || email) + '* (' + email + ')\n' +
      '> Bid: *$' + bid + '*/held meeting · Cap: ' + (b.cap || 'n/a') + ' · Min: ' + clip(b.minMinutes, 8) + 'm · Incentive: ' + (b.incentive ? 'on' : 'off') + ' · ACV: ' + clip(b.acv, 16) + '\n' +
      '> ICP: ' + (clip(b.icp, 280) || '—') + '\n' +
      '> Blocklists: ' + (clip(b.blocklists, 200) || '—') + '\n' +
      '> Customer: `' + customer.id + '`'
    );

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: 'session_failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}
