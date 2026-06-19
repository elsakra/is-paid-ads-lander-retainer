// POST /api/draw-meeting   (admin only; protect with ADMIN_DRAW_SECRET)
// Draws the buyer's bid for ONE verified-held meeting. Creates an invoice item at the bid amount
// and an invoice billed charge_automatically: Stripe applies the customer's deposit credit balance
// first, then the saved card if the credit runs out. This is the "deposit-and-draw" mechanic.
//
// Body: { customer: "cus_...", meetingRef: "string", amount?: <usd, defaults to customer.metadata.bid> }
// Header: x-draw-secret: <ADMIN_DRAW_SECRET>
//
// NOTE: held-meeting verification (calendar + join data) is not wired here yet (that is the
// full-funnel pass). Today this is the billing primitive, called once a meeting is confirmed held.

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
  const adminSecret = process.env.ADMIN_DRAW_SECRET;
  if (!key || !adminSecret) return res.status(500).json({ error: 'not_configured' });
  if (req.headers['x-draw-secret'] !== adminSecret) return res.status(401).json({ error: 'unauthorized' });

  try {
    const b = await readJsonBody(req);
    const customerId = String(b.customer || '');
    const meetingRef = String(b.meetingRef || '').slice(0, 120) || 'held-meeting';
    if (!customerId.startsWith('cus_')) return res.status(400).json({ error: 'customer_required' });

    const customer = await stripe('customers/' + customerId, null, key);
    const bid = parseInt(b.amount, 10) || parseInt(customer.metadata && customer.metadata.bid, 10);
    if (isNaN(bid) || bid < BID_FLOOR_USD) return res.status(400).json({ error: 'bid_below_floor' });

    // Invoice item at the bid, then an invoice that auto-applies the deposit credit balance.
    await stripe('invoiceitems', {
      customer: customerId,
      amount: bid * 100,
      currency: 'usd',
      description: 'Held meeting: ' + meetingRef,
    }, key);

    let invoice = await stripe('invoices', {
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: 'true',
      metadata: { kind: 'ondemand_draw', meeting_ref: meetingRef },
    }, key);

    invoice = await stripe('invoices/' + invoice.id + '/finalize', {}, key);
    if (invoice.status !== 'paid' && invoice.amount_due > 0) {
      try { invoice = await stripe('invoices/' + invoice.id + '/pay', {}, key); } catch (_) {}
    }

    const after = await stripe('customers/' + customerId, null, key);
    const creditLeft = Math.max(0, -(after.balance || 0)) / 100;

    await notifySlack(
      ':inbox_tray: *Meetings on Demand* drew $' + bid + ' for `' + meetingRef + '` (' + customerId + '). ' +
      'Deposit credit left: $' + creditLeft.toFixed(0) + (creditLeft < bid ? ' — *ask them to top up*.' : '.')
    );

    return res.status(200).json({
      ok: true,
      invoice: invoice.id,
      status: invoice.status,
      drawn_usd: bid,
      charged_to_card_usd: (invoice.amount_paid || 0) / 100,
      deposit_credit_left_usd: creditLeft,
      replenish: creditLeft < bid,
    });
  } catch (err) {
    return res.status(500).json({ error: 'draw_failed', detail: String(err && err.message || err).slice(0, 200) });
  }
}
