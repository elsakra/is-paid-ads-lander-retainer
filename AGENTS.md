# IntentSignal — Paid Ads Lander (Retainer)

Static site in **this folder only** (this is the **git repo root** for [is-paid-ads-lander-retainer](https://github.com/elsakra/is-paid-ads-lander-retainer)).

- **Entry**: `index.html` (drafts: `index v1.html`, `index v2.html`).
- **Stack**: HTML + Tailwind CDN, `assets/`. Deploy: push **`main`** → Vercel. Do not commit **`.vercel/`** (gitignored) or anything under **`uploads/`** (gitignored; scratch assets only).
- **Qualifier** (`index.html`): ACV, then **industry / GTM** (`b2b_complex` & `b2b_core` → “yes” path; `b2b_smb` & `not_b2b` → “maybe” path; low ACV → “no” path with optional David link).
- **Calendly**: David for most global CTAs; **Kyle** for high-ACV + strong “yes” path (see `CAL_DAVID` / `CAL_KYLE` in `index.html`).

If you use the **Cursor workspace** that contains this folder as a subpath, the fuller multi-lander note lives at the workspace `AGENTS.md` one level above (optional).
