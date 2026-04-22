# Agent context: IntentSignal paid ads retainer lander

Use this file to resume work with full project context. **Do not commit secrets** (Vercel/Git tokens belong in your environment or a password manager, not in this file).

## What this repository is

- **Product**: Static marketing lander for IntentSignal (paid ads / retainer positioning).
- **Entry point**: `index.html` (also present: `index v1.html`, `index v2.html` for iteration history).
- **Stack**: Static HTML, Tailwind via CDN, Google Fonts, assets under `assets/` and `uploads/`.

## Repository root (important)

- This repo’s **root** is the folder named `IS - Paid Ads Lander - Retainer/`.
- The parent path `intentsignal-ad-landers/` is a **local workspace** that will hold other landers as **separate** Git repos. Do not add sibling folders to this repository.

**GitHub**: https://github.com/elsakra/is-paid-ads-lander-retainer  
**Default branch**: `main`

## Hosting (Vercel)

- **Vercel project name**: `is-paid-ads-lander-retainer`
- **Vercel team (dashboard)**: `elsakras-projects`
- **Git integration**: GitHub `elsakra/is-paid-ads-lander-retainer`, **production branch** `main` (created via Vercel API; pushes to `main` trigger production deploys).
- **Production URL** (as of initial setup): `https://is-paid-ads-lander-retainer.vercel.app`
- **Project IDs** (for CLI/API, non-secret):
  - `projectId`: `prj_d6p8Tpn2QvBYC6aS6qm8d2w5SzPx`
  - `orgId` / team: `team_2I1nNI2WmY9f2urfwcqsglVT`

## Local dev / deploy

- Open `index.html` in a browser, or from this directory run a static server (e.g. `npx serve .`).
- **CLI deploy** (if linked): from this directory, `npx vercel@latest --prod` with `VERCEL_TOKEN` set (see Vercel docs; token is not stored in repo).
- **Preferred**: push to `main` on GitHub and let Vercel build from Git.
- **`.vercel/`**: created by `vercel link` locally; listed in `.gitignore` and should not be committed.

## Work log (initial setup, 2026-04-22)

1. Added `.gitignore` (e.g. `.DS_Store`, `.vercel`).
2. `git init` in **only** `IS - Paid Ads Lander - Retainer/`, initial commit, branch `main`.
3. Created GitHub repo `elsakra/is-paid-ads-lander-retainer` and pushed `main`.
4. Created Vercel project via REST API with `gitRepository: github` / `elsakra/is-paid-ads-lander-retainer`, `productionBranch: main`.
5. Ran `vercel link` to this project and `vercel --prod` for the first production deployment; confirmed alias on `is-paid-ads-lander-retainer.vercel.app`.
6. Added this `AGENTS.md`.

## Optional follow-ups

- Custom domain in Vercel (e.g. align with `og:url` / marketing domain).
- Replace or remove draft assets in `index v1.html` / `index v2.html` if they should not be public.
- Ensure `favicon.ico` exists if linked from `index.html` (currently references `/favicon.ico`).
