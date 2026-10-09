# Collector Coins

The rewards program for [poke-collect.com](https://poke-collect.com), replacing Smile.io. Customers earn coins on online orders,
product reviews and birthdays, climb four Poké Ball tiers (which never reset), and redeem coins for order discounts
(250 coins = $1) or free prizes pulled live from Shopify stock.

## How it works

- **Storefront panel** (`extensions/coin-panel`): a theme app embed with a floating coin button and panel. It talks to the app
  through the Shopify app proxy at `/apps/coins/*`, which tells the app which customer is signed in.
  `window.CollectorCoins.open("home" | "rewards" | "codes" | "activity")` opens it, and so do links to `#coins-home`,
  `#coins-rewards`, `#coins-register` and `#coins-sign-in` (plus the old `#smile-…` links).
- **Ledger** (`app/coins/ledger.server.js`, Postgres via Prisma): every coin earned or spent is one `Transaction` row.
  Webhook retries can't pay twice (each event has a unique `idemKey`).
- **Rules** (`app/coins/rules.js`): tiers, earn rates, prize pricing, refunds. Unit tested (`npm test`).
- **Earning**: `orders/paid` (subtotal after discounts, no shipping or tax, online store only via `EARN_SOURCES`),
  `refunds/create` (takes back coins for refunded items, never below zero; tiers stay), Judge.me review webhook,
  hourly birthday check (Ultra 200, Master 500).
- **Tier rewards**: Poke Ball $5 off $20+ on joining; Great $25 gift card; Ultra $50 gift card + 1,000 coins;
  Master $100 gift card + 2,500 coins. If gift cards can't be created, a discount code of the same value is issued.
- **Redeeming**: one-time Shopify discount codes locked to the customer. Prizes are products tagged
  "Collector Coins Prize" with 20+ in stock (not Pre-Order), costing retail × 200 coins rounded to the nearest 100.
- **Klaviyo**: events `Collector Coins Earned`, `Collector Coins Redeemed`, `Collector Coins Tier Reached`,
  `Collector Coins Reward Issued`, with balance and tier on the profile. Build the emails as Klaviyo flows on these.
- **Staff admin** (inside Shopify admin): member search, history, Adjust coins (Google reviews, fixes), birthdays,
  and Import from Smile (CSV; safe to re-run at cutover, sets balances to Smile's numbers and never lowers tiers).

## Testing mode vs live

`PROGRAM_MODE=testing` (default): only customers tagged `coins-tester` (`TESTER_TAG`) earn coins or can use the panel;
everyone else is ignored, so this runs next to Smile safely. Set the panel's **Who sees the panel** to *Testers only* too.
At cutover: import Smile's export, set `PROGRAM_MODE=live`, switch the panel to *Everyone*, turn off Smile.

## Deploying (Railway)

1. Railway project `collector-coins`: a Postgres service plus a web service built from this repo's `Dockerfile`.
   The schema is applied on start (`prisma db push`).
2. Web service variables: `DATABASE_URL` (reference the Postgres service), `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`,
   `SHOPIFY_APP_URL` (the Railway URL), `SCOPES`, `SHOP=poke-collect-al.myshopify.com`, `PROGRAM_MODE`, `TESTER_TAG`,
   `EARN_SOURCES=web`, optional `KLAVIYO_PRIVATE_KEY`, `JUDGEME_WEBHOOK_TOKEN`.
3. `shopify.app.toml` holds the client ID, Railway URL, webhooks and app proxy. The **Deploy Shopify app** GitHub Action
   pushes it and the theme extension on changes to `main`; it needs the `SHOPIFY_APP_AUTOMATION_TOKEN` repo secret.
4. Install the app on the store, then in the theme editor turn on **App embeds → Collector Coins panel**.
5. Judge.me: point a `review/created` webhook at `https://<railway-url>/judgeme?token=<JUDGEME_WEBHOOK_TOKEN>`.
