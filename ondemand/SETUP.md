# Meetings on Demand: go-live checklist

The funnel, onboarding, ops dashboard, and Supabase are built and deployed. To switch it
from "renders but checkout not live" to fully live, do the steps below. None of these can be
done for you (they involve secret keys and account settings).

## 1. Vercel env vars
Project `is-paid-ads-lander-retainer` -> Settings -> Environment Variables (Production + Preview):

| Var | Value |
|---|---|
| `STRIPE_SECRET_KEY` | from your env template. Use `sk_test_...` first to validate, then `sk_live_...`. |
| `STRIPE_WEBHOOK_SECRET` | from step 2 (`whsec_...`). |
| `ADMIN_DRAW_SECRET` | any strong random string. You will paste this into the ops dashboard. |
| `SUPABASE_URL` | `https://pcnxfjylnibxxdkhkvxz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase -> project `intentsignal-tools` -> Settings -> API -> service_role key. Secret, server only. |
| `SLACK_WEBHOOK_URL` | already set (used for funnel notifications). |

Redeploy after adding them (env changes need a new deploy to take effect).

## 2. Stripe webhook
Stripe Dashboard -> Developers -> Webhooks -> Add endpoint:
- URL: `https://go.intentsignal.ai/api/stripe-webhook`
- Event: `checkout.session.completed`
- Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` above.

## 3. Test the money path (test mode)
1. Open `https://go.intentsignal.ai/ondemand`, set a bid, Continue to checkout.
2. Pay with Stripe test card `4242 4242 4242 4242`, any future expiry/CVC.
3. You land on `/ondemand/onboarding` automatically. Fill booking link + ICP, upload a CSV.
4. Check: Slack pings for "checkout started", "setup fee paid", "ONBOARDED"; a row appears in
   Supabase `od_accounts` (status `onboarded`); the CSV is in the `od-blocklists` bucket.

## 4. Deliver + charge (ops)
- `https://go.intentsignal.ai/ondemand/admin` -> paste `ADMIN_DRAW_SECRET` -> see accounts.
- When a meeting is verified held and matches the buyer's criteria, enter a meeting ref and
  click "Charge held meeting". It charges their saved card their bid, off-session, and logs to
  `od_meetings`. Failures alert in Slack.
- Refund guarantee: if you decline an account after the fit check, refund the setup-fee
  PaymentIntent in Stripe.

## Tunable constants
- Setup fee: `SETUP_FEE_USD` in `api/create-checkout.js` (currently 500). Keep the `$500` shown
  on `ondemand/index.html` in sync.
- Bid floor: `BID_FLOOR_USD` (200) in `create-checkout.js` and `charge-meeting.js`.

## Next passes (need your accounts to wire)
- Auto-verify held meetings: Calendly webhook + conferencing join data -> auto-call
  `charge-meeting` instead of the manual dashboard button.
- Post-pay 5-minute fit check before infra spin-up (refund + decline if the market is unbookable).
- Meta campaigns + retargeting pointed at `/ondemand`.
