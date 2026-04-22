// POST /api/slack-notify
// Accepts { rep, location } JSON and forwards a Slack message via a private webhook.
// The webhook URL is a shared secret, so it lives only in SLACK_WEBHOOK_URL (Vercel env).

async function readJsonBody(req) {
  if (!req.body) {
    return await new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}); }
        catch (_) { resolve({}); }
      });
      req.on('error', () => resolve({}));
    });
  }
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body || {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const hook = process.env.SLACK_WEBHOOK_URL;
  if (!hook) {
    return res.status(500).json({ error: 'missing_webhook_env' });
  }

  try {
    const body = await readJsonBody(req);
    const rep = String(body.rep || 'unknown').slice(0, 32);
    const location = String(body.location || 'unknown').slice(0, 64);
    const repLabel = rep.charAt(0).toUpperCase() + rep.slice(1);

    const text = `:calendar: *Retainer* landing page: visitor redirected to *${repLabel}* Calendly (source: \`${location}\`).`;

    const slackRes = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!slackRes.ok) {
      return res.status(502).json({ error: 'slack_error', status: slackRes.status });
    }

    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'notify_failed' });
  }
}
