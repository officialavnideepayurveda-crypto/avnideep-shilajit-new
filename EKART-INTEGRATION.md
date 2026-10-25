# Ekart Logistics integration

This integration is intentionally disabled by default. Nothing in this repository
books a live shipment until the admin setting is enabled **and** the Worker secret
`EKART_LIVE_BOOKING_APPROVED=1` is present.

## What it does

- Books an Ekart shipment once per website order with an atomic claim and a
  unique idempotency key.
- Books new COD orders immediately after checkout. Prepaid and advance orders
  are booked immediately after the server verifies the Razorpay payment. The
  storefront calls the internal booking endpoint; the 10-minute cron remains a
  retry safety net.
- Rejects unpaid, cancelled, refunded and incomplete orders. Advance orders need
  a verified partial payment.
- Reuses the same AWB after an ambiguous Ekart failure instead of allocating a
  second one.
- Stores tracking events, a local despatch manifest and an audit trail in D1.
- Prints a local Code 128 label when Ekart does not return an official label URL.
- Serves a branded public `/track-order` page. It requires the order ID or AWB
  plus the phone number used at checkout, and never returns the customer's
  address, full name or phone number.
- Polls tracking and retries bookings from the admin Worker cron every 10 minutes.

## Files

Main storefront:

- `migrations/0008_ekart_shipping.sql` — additive schema, disabled settings seed.
- `functions/api/track-order.js` — customer tracking lookup and privacy gate.
- `track-order.html` — branded tracking page.
- `tests/track-order-api.test.js` — privacy and lookup tests.

Admin repository (`Avnideep-Shilajit-Admin`):

- `admin-api-worker/src/_lib/ekart.js` — eligibility, payload, booking, tracking,
  webhook, AWB pool, manifest, label and cron logic.
- `admin-api-worker/src/_lib/code128.js` — local Code 128-B label renderer.
- `admin-api-worker/src/handlers/ekart.js` — admin API route handlers.
- `admin-api-worker/src/index.js` — Ekart admin, internal and webhook routes.
- `admin-api-worker/src/handlers/orders.js` — auto-book hook on status changes.
- `admin-api-worker/wrangler.jsonc` — 10-minute cron trigger.
- `admin-frontend/src/shipping.html` and `js/shipping.js` — Ekart Shipping panel.
- `admin-frontend/src/order-detail.html` — shipment card and actions.
- `admin-api-worker/tests/ekart.test.mjs` — pure integration tests.

## Apply the migration

The migration only creates new tables and inserts `INSERT OR IGNORE` settings.
It does not alter existing tables. Back up the D1 database before applying it in
production.

```powershell
cd "E:\Avnideep Ayurveda landinge page 2026\Avnideep shilajit complete with certificate june 26\Avnideep shilajit\Avnideep-Shilajit"
npx wrangler d1 execute avnideep-orders --remote --file=migrations/0008_ekart_shipping.sql
```

For local development:

```powershell
npx wrangler d1 execute avnideep-orders --local --file=migrations/0008_ekart_shipping.sql
```

The schema includes `ekart_shipments`, `ekart_shipment_events`, `ekart_awb_pool`,
`ekart_manifests`, `ekart_rate_limits`, `ekart_pincode_cache`, an `audit_log`
fallback table and the `settings` table.

## Worker secrets

Set these on the admin Worker, never in HTML or `VITE_*` variables:

```powershell
cd "E:\Avnideep Ayurveda landinge page 2026\Avnideep shilajit complete with certificate june 26\Avnideep shilajit\Avnideep-Shilajit-Admin\admin-api-worker"
npx wrangler secret put EKART_CLIENT_ID
npx wrangler secret put EKART_USERNAME
npx wrangler secret put EKART_PASSWORD
npx wrangler secret put EKART_INTERNAL_KEY
npx wrangler secret put EKART_WEBHOOK_SECRET
```

`EKART_CLIENT_ID`, `EKART_USERNAME` and `EKART_PASSWORD` are the Elite API
onboarding credentials. The Worker exchanges them for a 24-hour Bearer token at
`POST /integrations/v2/auth/token/{client_id}` and caches it. As an alternative,
set `EKART_AUTH_TOKEN` to a pre-issued Bearer token; when it is present the
Worker uses it directly.

`EKART_MERCHANT_CODE` is only needed if you use locally generated AWBs.

Optional secrets:

- `EKART_WEBHOOK_HMAC_SECRET` — shared HMAC secret if Ekart signs webhooks.
- `EKART_WEBHOOK_IPS` — comma-separated allowed Ekart IP addresses.
- `EKART_BASE_URL_SANDBOX` — override the default staging host.
- `EKART_BASE_URL_LIVE` — override the default live host.
- `EKART_TIMEOUT_MS` — Ekart request timeout in milliseconds.
- `EKART_WEBHOOK_SIGNATURE_HEADER` — signature header name.

Live booking block:

```powershell
npx wrangler secret put EKART_LIVE_BOOKING_APPROVED
# enter exactly: 1
```

Do not set this to `1` until sandbox booking, label, tracking and webhook tests
have passed and the business explicitly approves live booking.

The storefront Pages project needs the same internal key only if you want the
public tracking page to force an immediate refresh:

```powershell
cd "E:\Avnideep Ayurveda landinge page 2026\Avnideep shilajit complete with certificate june 26\Avnideep shilajit\Avnideep-Shilajit"
npx wrangler pages secret put EKART_INTERNAL_KEY
```

Optional Pages variable `EKART_INTERNAL_TRACK_URL` overrides the default
`https://avnideep-admin-api.officialavnideepayurveda.workers.dev/api/internal/ekart/track`.
Without it, public tracking still works from cron-refreshed D1 data.

## Deploy

```powershell
cd "E:\Avnideep Ayurveda landinge page 2026\Avnideep shilajit complete with certificate june 26\Avnideep shilajit\Avnideep-Shilajit-Admin\admin-api-worker"
npx wrangler deploy
```

Deploy the storefront through its normal Cloudflare Pages flow. The new
`/track-order` page and `/api/track-order` function are included automatically.

## Admin setup sequence

1. Confirm migration `0008` succeeded.
2. Open **Ekart Shipping → Settings** and fill the pickup and return addresses.
3. Fill **Seller GSTIN**, **Invoice seller address**, the default parcel weight
   and dimensions. The defaults are 0.5 kg, 20 × 15 × 5 cm. Ekart rejects a
   create-shipment request without a GSTIN.
4. Set the test AWB supplied by Ekart and click **Test Connection**.
5. Keep `mode = sandbox`, `enabled = 0`, `auto_book = 0`.
6. Import staging AWBs under **AWB Pool** only if the account uses pre-allocated AWBs.
7. Enable the integration but leave **Automatically book** off.
8. Place one eligible test COD order (or move a test order to `cod_order` /
   `confirmed`) and book it manually from the order detail page.
9. Verify the AWB, label, tracking refresh and webhook delivery.
10. Only then enable auto-booking.
11. Enable **Public tracking page** when the tracking page is ready to go live.
12. Live mode additionally requires `EKART_LIVE_BOOKING_APPROVED=1`.

## Webhook

Endpoint:

```text
https://avnideep-admin-api.officialavnideepayurveda.workers.dev/api/ekart/webhook?token=<EKART_WEBHOOK_SECRET>
```

The same token may be sent as `X-Ekart-Webhook-Token`. If
`webhook_require_hmac` is enabled, the request body must be signed with
`EKART_WEBHOOK_HMAC_SECRET`. The integration accepts common Ekart field aliases
for AWB, order reference, status, timestamp and location, but the exact payload
must be confirmed by Ekart.

## Documented gaps to confirm with Ekart

The B2C API documentation reviewed for this integration does not confirm all of
the following. Do not improvise or scrape the Ekart portal.

- Exact Elite account authentication requirements and whether the token expires.
- Confirmation of the create-shipment schema for this merchant account.
- AWB allocation rules: pre-allocated pool vs merchant-generated AWBs.
- Official label endpoint and label format.
- Manifest / pickup request endpoint, if any.
- Cancellation endpoint and cut-off rules.
- Webhook payload schema, signature algorithm, source IPs and retry policy.
- Tracking API rate limits and whether tracking calls are chargeable.
- Expected-delivery-date field reliability.
- Whether a separate tracking customization service is required. This
  integration does **not** purchase the ₹4 + GST Ekart tracking customization.

Until these are confirmed, label and manifest output are explicitly labelled as
Avnideep documents, not Ekart-issued documents.

## Cancellation behaviour

There is no confirmed Ekart B2C cancellation endpoint in the reviewed docs.
For a shipment already sent to Ekart, the admin action records a cancellation
request and instructs staff to cancel the AWB in the Ekart portal. It never
pretends Ekart has confirmed the cancellation. Local, not-yet-sent bookings can
be cancelled locally.

## Tests

Admin Worker:

```powershell
cd "E:\Avnideep Ayurveda landinge page 2026\Avnideep shilajit complete with certificate june 26\Avnideep shilajit\Avnideep-Shilajit-Admin\admin-api-worker"
npm run test:ekart
npx wrangler deploy --dry-run --outdir "$env:TEMP\ekart-worker-build"
```

Storefront:

```powershell
cd "E:\Avnideep Ayurveda landinge page 2026\Avnideep shilajit complete with certificate june 26\Avnideep shilajit\Avnideep-Shilajit"
npx vitest run tests/track-order-api.test.js
```

## Operational notes

- Booking one order twice returns the existing shipment instead of creating
  another.
- A failed booking with a retryable error is retried by cron at 5, 15, 60, 360
  and 1440 minute intervals, up to `retry_max_attempts`.
- A manual retry force-claims the row and reuses the same AWB.
- A `200 OK` from Ekart with an unrecognised body is recorded as a failure and
  must be checked in the Ekart portal. It is never shown as a successful booking.
- Public tracking is rate-limited per IP and requires the phone number on the
  order.
- The admin API never returns Ekart credentials or the auth token.
