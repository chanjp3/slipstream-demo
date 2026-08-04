# Slipstream — Demo Playground

**This is the interactive demo deployment** of [Slipstream](https://github.com/chanjp3/slipstream): identical code, plus a persona switcher. Open the app and use the DEMO · VIEW AS bar at the bottom to jump between two clients and three operator seats (admin, team member, competitor) — no logins needed. Post a request as Ava, switch to Meridian to quote it, switch back to accept. Personas are seeded by scripts/seed-demo.js (password demopass123 if you want the login flow); real registrations work but cannot be impersonated.

---

A private-jet charter marketplace prototype: travelers post trip requests (with a
map-based airport picker) and compare operator quotes; operators browse the request
marketplace and submit bids.

This repo wraps the design prototype behind real authentication and deploys it to
Cloudflare Workers.

## How it works

- **`public/app.html`** — the design bundle (React, Leaflet map, airport dataset,
  fonts), with its logic rewired to the real API. Don't edit it directly — edit
  `src/app-logic.js` and run `node scripts/pack.js` to inject it into the bundle.
- **`src/app-logic.js`** — the app's React component logic: posting requests,
  bidding, accepting quotes, and chat all call the Worker API and poll every 7 s
  so the two sides see each other's activity.
- **`src/worker.js`** — a Cloudflare Worker that:
  - serves `/login` and `/register`, stores accounts in **D1** (PBKDF2-hashed
    passwords) with a role of **traveler (client)** or **operator**,
  - issues HttpOnly session cookies (7-day TTL, stored in Workers KV),
  - gates `/app` behind a valid session and serves the prototype with the
    signed-in user's role baked in,
  - exposes the marketplace API (see below) with role checks server-side.
- **`db/schema.sql`** — D1 schema: `users`, `requests`, `quotes` (one per
  operator per request), `messages`. **`db/seed.sql`** — demo marketplace
  requests owned by unloginable demo accounts so a new operator sees an active
  bid desk.
- **`wrangler.jsonc`** — Workers config: static assets from `public/`, `DB`
  (D1) and `SLIPSTREAM_KV` bindings, `run_worker_first` so every request passes
  through the auth check.

## Develop

```bash
npm install
npx wrangler dev
```

## Deploy

```bash
npx wrangler deploy
```

## Database

```bash
npx wrangler d1 execute slipstream-db --remote --file db/schema.sql -y
npx wrangler d1 execute slipstream-db --remote --file db/seed.sql -y
```

## API

| Route                            | Method   | Purpose                                             |
| -------------------------------- | -------- | --------------------------------------------------- |
| `/api/register`                  | POST     | `{ name, email, password, role }` → session         |
| `/api/login`                     | POST     | `{ email, password }` → session                     |
| `/api/logout`                    | POST     | Clears the session                                  |
| `/api/me`                        | GET      | Current user `{ id, email, name, role }`            |
| `/api/bootstrap`                 | GET      | Role-appropriate app state (requests / marketplace) |
| `/api/requests`                  | POST     | Traveler posts a trip request                       |
| `/api/requests/:id/quotes`       | POST     | Operator submits a sealed quote (one per request)   |
| `/api/requests/:id/accept`       | POST     | Traveler accepts a quote → request booked           |
| `/api/quotes/:id/messages`       | GET/POST | Chat between the traveler and the quoting operator  |
| `/api/me/profile`                | POST     | Update display name                                 |
| `/api/me/password`               | POST     | Change password (`{ current, next }`)               |
| `/api/me/prefs`                  | POST     | Account preferences (e.g. `showEmptyLegDeals`)      |
| `/api/billing/upgrade`           | POST     | **Demo** upgrade (operator→Pro, client→Plus)        |
| `/api/billing/downgrade`         | POST     | **Demo** downgrade to Free                          |

## Operator teams

Operators are organizations: the **admin** (whoever registers without an invite
code) owns the company profile, fleet, D085, plan, and team; **members** join by
registering with a single-use invite code (created in the profile modal) and
can bid, chat, and attach contracts under the company identity. Quotes are
deduplicated per team, bid limits and the plan are org-wide, and the inbox is
shared across the team. Removing a member takes effect immediately (membership
is resolved per request, not cached in the session).

## Empty-leg board

Operators post repositioning flights from the bid-desk sidebar ("+ Post empty
leg": route, date/time, fleet aircraft, price, note). Travelers get an "Empty
legs" tab showing each deal with the operator's full trust info (photo, safety
rating, real reviews, FAA badge). "Request this flight" turns the deal into a
normal trip request pre-filled with the route and date, so quoting, acceptance,
contracts, and the trip lifecycle all reuse the existing pipeline.

## Demo billing model: refundable deposits + operator anonymity

The platform fee is collected *before* the two parties can identify each other,
so there is nothing to bypass — and the charter payment itself never flows
through the platform:

- **Clients** place a refundable deposit when posting a request ($150/250/500
  by aircraft category, demo — no real payment). It is kept as the platform
  fee only when they accept a quote; refunded in full via the "close & refund"
  button or automatically after 72h with zero quotes. First request is free;
  Plus ($79/mo, demo) waives deposits.
- **Operators are anonymous until acceptance**: quotes show "Operator A/B/C"
  with trust signals intact (safety rating, reviews, response time, FAA badge)
  but tail numbers and photos hidden — tails are publicly searchable
  identities. Contact info in pre-acceptance messages is auto-redacted. Only
  the accepted operator is revealed. Client names are masked for operators
  until acceptance, and the empty-leg board is anonymized the same way.
- **Operator Pro** ($299/mo, demo): a 15-minute head start on new requests
  (free tier sees them delayed). Bid limits are gone — more quotes per request
  is what makes clients accept, which is what earns the deposit.

Swapping in real money later = replace `/api/billing/*` and the deposit hold
with Stripe; all gating and anonymity logic stays as-is.

## Status / next steps

Requests, sealed bids, acceptance, and chat are real and shared: a traveler's
posted request appears on every operator's bid desk, an operator's quote appears
in the traveler's quote list (7 s polling), accepting a quote books the request
and removes it from the marketplace. Operators have a MESSAGES inbox in the
bid-desk sidebar (one conversation per quote sent, WON badge on winning bids)
that opens the shared chat drawer. Known gaps, in rough priority order:

- Operator profiles verify against the **FAA aircraft registry** live: each
  fleet tail number is checked (exists, registration valid, model matches the
  operator's claim via a marketing-name → type-designator alias map), the Part
  135 certificate number is kept on file (holding one distinguishes an operator
  from a broker), and the D085 OpSpec (aircraft listing) is uploaded for the
  record. All checks green + D085 on file → "FAA-checked fleet" badge on the
  operator's quotes; verified fleet becomes the bid form's aircraft dropdown.
  The certificate number itself is format-checked only (no public FAA API for
  live 135 certificate lookup) — pair with manual D085 review before trusting.
- Ratings/reviews/response-time on quotes are still placeholders.
- No email notifications, forgot-password reset flow, or rate limiting
  (password *change* exists in the account menu; *reset* needs email).
- Polling works fine at this scale; WebSockets/Durable Objects would replace it
  for production.
