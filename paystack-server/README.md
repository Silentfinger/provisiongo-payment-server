# ProvisionGo Payment Server

A tiny server with one job: double-check with Paystack (using your SECRET
key) that a payment actually went through, before the app trusts it.

## Why this exists

The app's checkout screen and the vendor's "renew subscription" button
both talk to Paystack directly in the browser. Paystack tells the
browser "payment successful" — but that message came from someone's own
browser, which could theoretically be faked. This server asks Paystack
directly, server-to-server, using your PAYSTACK_SECRET_KEY (which must
never be visible to anyone using the app), whether a payment reference
is real. Only then does the app mark anything as paid.

## Setup (2 minutes)

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
3. Open `.env` and paste in your real Paystack **Secret Key** (from
   Paystack dashboard → Settings → API Keys & Webhooks — the one
   starting with `sk_test_` or `sk_live_`, NOT the public one).
4. Run it locally to test:
   ```
   npm start
   ```
   Visit `http://localhost:3001` in a browser — you should see
   `{"status":"ok",...}`.

## Deploying for free (so the real app can reach it)

This needs to live somewhere on the internet, not just your own laptop,
so the ProvisionGo app can call it from anywhere.

**Render.com (recommended, free tier):**
1. Push this folder to a GitHub repo (or upload it directly — Render
   supports both)
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo
4. Build command: `npm install`
5. Start command: `npm start`
6. Under "Environment", add a variable: `PAYSTACK_SECRET_KEY` with your
   real secret key as the value (never put it in your code or GitHub repo
   itself — always as an environment variable)
7. Deploy — you'll get a URL like `https://provisiongo-payments.onrender.com`

**Railway.app works the same way, if you'd rather use that instead.**

## Last step: tell the app about it

Once deployed, copy that live URL and paste it into the main
ProvisionGo app code — search for this line near the top of the file:

```js
const PAYMENT_SERVER_URL = "";
```

and change it to:

```js
const PAYMENT_SERVER_URL = "https://provisiongo-payments.onrender.com";
```

(no trailing slash at the end). Once that's set, both buyer checkout and
the vendor subscription payment will automatically start using this
server to double-check every payment, instead of trusting the popup
directly.

## A note on the free tier

Free Render/Railway services "sleep" after inactivity and take a few
seconds to wake up on the next request. For a payment-verification
check, that's usually fine — the app already retries automatically if
the first check doesn't come back right away. If this becomes annoying
once you have real daily traffic, upgrading to a paid tier (a few
dollars a month) keeps it always awake.
