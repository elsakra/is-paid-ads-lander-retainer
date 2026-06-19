# IntentSignal — Paid Ads Lander (Retainer)

Static site in **this folder only** (this is the **git repo root** for [is-paid-ads-lander-retainer](https://github.com/elsakra/is-paid-ads-lander-retainer)).

- **Entry**: `index.html` (drafts: `index v1.html`, `index v2.html`).
- **Stack**: HTML + Tailwind CDN, `assets/`. Deploy: push **`main`** → Vercel. `vercel.json` sets long `Cache-Control` for `/assets/**` (bump filename or query if you need to bust a cached asset). Do not commit **`.vercel/`** (gitignored) or anything under **`uploads/`** (gitignored; scratch assets only).
- **Qualifier** (`index.html`): **ACV** (4 bands including `$100k–$500k` and `$500k+`), then **TAM**; routing to yes/maybe/no; **$500k+** can land on “yes” without TAM gating; **Kyle** on “yes” for **$100k+ and $500k+** bands. Low ACV → “no” with optional David link.
- **Calendly**: David for most global CTAs; see `applyQualifierCalLinksForStep` in `index.html`.
- **Slack notifications**: every Calendly click calls `notifyCalRedirect(rep, location)` in `index.html`, which `sendBeacon`s `/api/slack-notify`. That endpoint is a Vercel serverless function in `api/slack-notify.js` that forwards to the Slack Incoming Webhook stored in the `SLACK_WEBHOOK_URL` env var (set in Vercel → Project → Settings → Environment Variables for Production + Preview). The URL is NEVER placed in HTML/JS.
- **Logo walls** (`index.html`): Primary strip **Trusted By** and the meetings **marquee** use `loading="eager"` and `decoding="async"` (not `lazy`—logos are above the fold). Header lockup has `fetchpriority="high"`; the duplicate marquee copy uses `fetchpriority="low"`. `link rel=preload` for the lockup and first marquee PNG. **Meetings** marquee (~28s loop; `prefers-reduced-motion` disables scroll). `mark-mono` + `mark--from-white` (all-white assets) + `mark-on-light` (Alignops in the hero). **Rocket Lawyer** is not in the meetings strip. **McDonald’s** and **Disney** in the meetings strip use path-based wordmarks: `assets/logos/recent-2026/mcdonalds-wordmark.svg` and `disney-wordmark.svg` (sourced from Wikimedia Commons; trademark remains with the rights holders). **Turo** is not in the strip. Case study Route: `client-logo--case`. Assets: `assets/logos/`, `assets/logos/recent-2026/`, `assets/logos/clients/`.

## Meetings on Demand (`/ondemand`)

Productized, no-call, **pay-per-held-meeting** offer aimed at Meta ad traffic. Separate pages, same repo/brand/deploy, sharing assets and the `main` → Vercel pipeline. **Reference assets with absolute paths** (`/assets/...`) since pages live under `/ondemand/`.

Model (locked): minimal-friction card capture, then onboard, then deliver and charge on held. **No setup fee, no free meeting, no charge today.** The card is saved at $0 via Stripe Checkout `mode=setup`; the only charge ever is the bid per held meeting. Risk reversal = "no charge today, pay only when a meeting is held." Commitment before work: capture card first, onboard second.

- **Pages**: `ondemand/index.html` (proof + risk reversal + VSL + how-it-works + a one-field checkout: bid only; no eyebrows), `ondemand/onboarding/index.html` (post-payment: booking link, ICP, min-minutes, do-not-contact CSV upload), `ondemand/admin/index.html` (internal ops dashboard), `ondemand/success/index.html` (orphaned fallback; success now routes to onboarding).
- **Funnel**: ad → `/ondemand` → set bid → Stripe Checkout (`mode=setup`: saves card off_session, $0 charge) → `success_url` = `/ondemand/onboarding?cs={CHECKOUT_SESSION_ID}` → onboarding gated on the session being completed/paid → ops builds + charges per held meeting.
- **Pricing**: bid-based, **$200 floor** per held meeting (enforced client-side AND in `create-checkout.js`/`charge-meeting.js`). No setup fee and no charge at signup. The only charge ever is the bid, off_session, per held meeting, fired from the admin console.
- **Stripe (no SDK, native `fetch` to `api.stripe.com/v1`)**:
  - `api/create-checkout.js`: Checkout Session `mode=setup` (saves card off_session, $0 charge), collects email/phone. Returns `{ url }`. Validates bid ≥ $200.
  - `api/stripe-webhook.js`: signature-verified (`STRIPE_WEBHOOK_SECRET`, `node:crypto`, raw body). On `checkout.session.completed`: sets saved card as `invoice_settings.default_payment_method`, stamps bid/email on the customer, and upserts `od_accounts` in Supabase. Point a Stripe webhook at `/api/stripe-webhook` for `checkout.session.completed`.
  - `api/charge-meeting.js`: **admin-only** (`x-draw-secret: $ADMIN_DRAW_SECRET`). Off_session PaymentIntent for the bid against the saved card, per verified-held meeting. Logs to `od_meetings`. On card failure → 402 + Slack alert.
  - `api/onboard.js`: verifies the session is paid, then writes config to `od_accounts` and uploads the CSV to Supabase Storage (`od-blocklists` bucket).
  - `api/admin-accounts.js`: admin-only read of `od_accounts` + `od_meetings` for the dashboard.
- **Supabase** (project `intentsignal-tools`, ref `pcnxfjylnibxxdkhkvxz`, URL `https://pcnxfjylnibxxdkhkvxz.supabase.co`): tables `od_accounts`, `od_meetings` (public schema, `od_` prefix, RLS on with no policies — only the service-role key touches them), private storage bucket `od-blocklists`. Migration: `meetings_on_demand_schema`.
- **Env vars** (Vercel → Settings → Environment Variables, Prod + Preview; NEVER in HTML/JS): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_DRAW_SECRET`, `SUPABASE_URL` (`https://pcnxfjylnibxxdkhkvxz.supabase.co`), `SUPABASE_SERVICE_ROLE_KEY`, plus existing `SLACK_WEBHOOK_URL`. Without keys the page still renders and the checkout button shows a graceful "not live yet" message.
- **Built but pending (next passes)**: held-meeting verification (Calendly webhook + conferencing join data) auto-firing `charge-meeting`; the post-pay 5-minute fit check before infra spin-up (refund + decline if unbookable); Meta campaigns. Today `charge-meeting` is the manual primitive driven from the admin dashboard.

If you use the **Cursor workspace** that contains this folder as a subpath, the fuller multi-lander note lives at the workspace `AGENTS.md` one level above (optional).
