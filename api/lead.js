// POST /api/lead
// Captures a hand-raise for nurture: free-report opt-ins and disqualified gate visitors.
// Forwards to Slack (ESP/SMS wiring comes with the nurture pass). No PII in logs beyond Slack.

async function readJsonBody(req) {
  if (req.body) { try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch (_) { return {}; } }
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function clip(s, n) { return String(s || '').slice(0, n); }

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method_not_allowed' }); }

  try {
    const b = await readJsonBody(req);
    const email = clip(b.email, 200).trim();
    if (!email || email.indexOf('@') < 0) return res.status(400).json({ error: 'email_required' });

    const hook = process.env.SLACK_WEBHOOK_URL;
    if (hook) {
      const reason = clip(b.reason, 40) || 'lead';
      const text = ':seedling: *Meetings on Demand* ' + reason + ' capture: *' + email + '*' +
        (b.company ? ' (' + clip(b.company, 120) + ')' : '') +
        ' · ACV ' + clip(b.acv, 16) + ' · B2B ' + clip(b.b2b, 8) + ' · rep ' + clip(b.rep, 8) +
        (b.sells ? ' · sells: ' + clip(b.sells, 120) : '');
      try { await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }); } catch (_) {}
    }
    return res.status(204).end();
  } catch (_) {
    return res.status(500).json({ error: 'lead_failed' });
  }
}
