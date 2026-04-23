# IntentSignal — Paid Ads Lander (Retainer)

Static site in **this folder only** (this is the **git repo root** for [is-paid-ads-lander-retainer](https://github.com/elsakra/is-paid-ads-lander-retainer)).

- **Entry**: `index.html` (drafts: `index v1.html`, `index v2.html`).
- **Stack**: HTML + Tailwind CDN, `assets/`. Deploy: push **`main`** → Vercel. Do not commit **`.vercel/`** (gitignored) or anything under **`uploads/`** (gitignored; scratch assets only).
- **Qualifier** (`index.html`): **ACV** (4 bands including `$100k–$500k` and `$500k+`), then **TAM**; routing to yes/maybe/no; **$500k+** can land on “yes” without TAM gating; **Kyle** on “yes” for **$100k+ and $500k+** bands. Low ACV → “no” with optional David link.
- **Calendly**: David for most global CTAs; see `applyQualifierCalLinksForStep` in `index.html`.
- **Slack notifications**: every Calendly click calls `notifyCalRedirect(rep, location)` in `index.html`, which `sendBeacon`s `/api/slack-notify`. That endpoint is a Vercel serverless function in `api/slack-notify.js` that forwards to the Slack Incoming Webhook stored in the `SLACK_WEBHOOK_URL` env var (set in Vercel → Project → Settings → Environment Variables for Production + Preview). The URL is NEVER placed in HTML/JS.
- **Logo walls** (`index.html`): Primary strip **Trusted By**. **Meetings Booked in 2026** is a **marquee** (~28s loop; larger `--logo-slot-*` than before; `opt-w-*` up to ~1.35 on thin wordmarks so they read near AARP/Clay; `prefers-reduced-motion` disables scroll). `mark-mono` + `mark--from-white` (Rocket) + `mark-on-light` (Alignops in the hero). **McDonald’s** and **Disney** in the meetings strip use path-based wordmarks: `assets/logos/recent-2026/mcdonalds-wordmark.svg` and `disney-wordmark.svg` (sourced from Wikimedia Commons; trademark remains with the rights holders). **Turo** is not in the strip. Case study Route: `client-logo--case`. Assets: `assets/logos/`, `assets/logos/recent-2026/`, `assets/logos/clients/`.

If you use the **Cursor workspace** that contains this folder as a subpath, the fuller multi-lander note lives at the workspace `AGENTS.md` one level above (optional).
