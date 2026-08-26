// POST /api/slack-notify
// Accepts { rep, location, attribution } JSON and forwards a Slack message via a
// private webhook. Webhook URLs are shared secrets and live ONLY in Vercel env:
//   SLACK_WEBHOOK_URL           -- CTA clicks (visitor opened Calendly)
//   SLACK_BOOKINGS_WEBHOOK_URL  -- confirmed bookings (Calendly event_scheduled)
// CALENDLY_API_TOKEN (Calendly personal access token) is optional but needed to
// resolve the booker's name/email: the browser postMessage carries only a URI.
// If the bookings webhook is unset, bookings fall back to SLACK_WEBHOOK_URL so a
// missing env var never silently drops a booking notification.

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


// Resolve the booker from Calendly. The invitee URI arrives from the browser, so
// it is untrusted: we only ever fetch api.calendly.com on the exact invitee path,
// which stops this endpoint being used as an open proxy (SSRF).
const INVITEE_PATH = /^\/scheduled_events\/[0-9a-f-]{36}\/invitees\/[0-9a-f-]{36}$/i;

async function fetchInvitee(rawUri) {
  const token = process.env.CALENDLY_API_TOKEN;
  if (!token || !rawUri) return null;

  let url;
  try { url = new URL(String(rawUri)); } catch (_) { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 'api.calendly.com') return null;
  if (!INVITEE_PATH.test(url.pathname)) return null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(url.toString(), {
      headers: { authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const json = await r.json();
    return json && json.resource ? json.resource : null;
  } catch (_) {
    return null;   // never let a lookup failure swallow the booking alert
  }
}

// Compose the booker block. Everything is optional -- a booking notification with
// a missing field is still worth sending.
function describeInvitee(inv) {
  if (!inv) return null;
  const lines = [];
  const name = String(inv.name || '').trim();
  const email = String(inv.email || '').trim();
  if (name || email) lines.push(`*${name || 'Unknown'}* <${email || 'no email'}>`);

  const qa = Array.isArray(inv.questions_and_answers) ? inv.questions_and_answers : [];
  for (const item of qa.slice(0, 6)) {
    const q = String((item && item.question) || '').trim();
    const a = String((item && item.answer) || '').trim();
    if (q && a) lines.push(`\u2022 *${q}:* ${a.slice(0, 300)}`);
  }

  const phone = String(inv.text_reminder_number || '').trim();
  if (phone) lines.push(`\u2022 *Phone:* ${phone}`);
  const tz = String(inv.timezone || '').trim();
  if (tz) lines.push(`\u2022 *Timezone:* ${tz}`);

  const t = inv.tracking || {};
  const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
    .map((k) => (t[k] ? `${k}=${String(t[k]).slice(0, 80)}` : null))
    .filter(Boolean);
  if (utm.length) lines.push(`\u2022 *Calendly tracking:* \`${utm.join(' ')}\``);

  if (inv.reschedule_url) lines.push(`<${inv.reschedule_url}|Reschedule> \u00b7 <${inv.cancel_url}|Cancel>`);
  return lines.length ? lines.join('\n') : null;
}

// Turn captured first-touch attribution into a plain-English source line.
// A Google Ads click id (gclid, or gbraid/wbraid on iOS/app campaigns) is the
// only positive proof of Ads traffic; everything else is reported as what it
// actually was rather than being attributed to Ads by default.
function describeSource(attr) {
  const a = attr && typeof attr === 'object' ? attr : {};
  const clip = (v, n) => String(v || '').slice(0, n);

  if (clip(a.gclid, 128)) {
    const campaign = clip(a.utm_campaign, 64);
    return campaign
      ? `booked from *Google Ads* (campaign: \`${campaign}\`)`
      : 'booked from *Google Ads*';
  }

  const source = clip(a.utm_source, 64);
  if (source) {
    const medium = clip(a.utm_medium, 64);
    return `booked from *${source}*${medium ? ` / ${medium}` : ''} (no Google click id)`;
  }

  const ref = clip(a.referrer, 200);
  if (ref) {
    let host = ref;
    try { host = new URL(ref).hostname; } catch (_) {}
    return `booked from referrer *${host}* (not Google Ads)`;
  }

  return 'booked from *direct / unknown* traffic (not Google Ads)';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const rep = String(body.rep || 'unknown').slice(0, 32);
    const location = String(body.location || 'unknown').slice(0, 64);
    const repLabel = rep.charAt(0).toUpperCase() + rep.slice(1);
    const isBooking = location === 'booked';

    const hook = isBooking
      ? (process.env.SLACK_BOOKINGS_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL)
      : process.env.SLACK_WEBHOOK_URL;
    if (!hook) {
      return res.status(500).json({ error: 'missing_webhook_env' });
    }

    let text;
    if (isBooking) {
      const invitee = await fetchInvitee(body.inviteeUri);
      const who = describeInvitee(invitee);
      text = `:tada: *Meeting booked* on the retainer lander \u2014 ${describeSource(body.attribution)}. Calendly: *${repLabel}*.`;
      if (who) text += `\n${who}`;
      else if (body.inviteeUri) text += `\n_(booker details unavailable \u2014 check CALENDLY_API_TOKEN)_`;
    } else {
      text = `:calendar: *Retainer* landing page: visitor redirected to *${repLabel}* Calendly (source: \`${location}\`).`;
    }

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
