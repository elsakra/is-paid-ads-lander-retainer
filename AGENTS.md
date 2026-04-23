# IntentSignal — Paid Ads Lander (Retainer)

Static site in **this folder only** (this is the **git repo root** for [is-paid-ads-lander-retainer](https://github.com/elsakra/is-paid-ads-lander-retainer)).

- **Entry**: `index.html` (drafts: `index v1.html`, `index v2.html`).
- **Stack**: HTML + Tailwind CDN, `assets/`. Deploy: push **`main`** → Vercel. Do not commit **`.vercel/`** (gitignored) or anything under **`uploads/`** (gitignored; scratch assets only).
- **Qualifier** (`index.html`): **ACV** (4 bands including `$100k–$500k` and `$500k+`), then **TAM**; routing to yes/maybe/no; **$500k+** can land on “yes” without TAM gating; **Kyle** on “yes” for **$100k+ and $500k+** bands. Low ACV → “no” with optional David link.
- **Calendly**: David for most global CTAs; see `applyQualifierCalLinksForStep` in `index.html`.
- **Slack notifications**: every Calendly click calls `notifyCalRedirect(rep, location)` in `index.html`, which `sendBeacon`s `/api/slack-notify`. That endpoint is a Vercel serverless function in `api/slack-notify.js` that forwards to the Slack Incoming Webhook stored in the `SLACK_WEBHOOK_URL` env var (set in Vercel → Project → Settings → Environment Variables for Production + Preview). The URL is NEVER placed in HTML/JS.
- **Logo walls** (`index.html`): Primary strip label **Trusted By** (title case, not all-caps). **Meetings booked at** is secondary (smaller marks, subtle top border, slow **marquee**; `prefers-reduced-motion` drops animation and hides the duplicate set). All marks use the same **monochrome** treatment with per-mark **optical scale** (`opt-sm` … `opt-xxl`). **Alignops** uses `mark-on-light` (invert). **McDonald’s** / **Disney** use text wordmarks in `assets/logos/recent-2026/mcdonalds-wordmark.svg` and `disney-wordmark.svg`. Case study header Route wordmark: **`client-logo--case`** (slightly shorter than other `.client-logo` marks). Assets under `assets/logos/`, `assets/logos/recent-2026/`, `assets/logos/clients/`.

If you use the **Cursor workspace** that contains this folder as a subpath, the fuller multi-lander note lives at the workspace `AGENTS.md` one level above (optional).
