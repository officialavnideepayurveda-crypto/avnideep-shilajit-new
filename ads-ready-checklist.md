# Facebook-ads readiness — Avnideep Ayurveda (avnideepayurveda.in)

Site technically ready to plug into FB/Meta ads now, but a few things must be green before you drip ad budget. This is ordered by "what breaks ads first".

## 🟢 Working now (good to go)

- Site live at `https://avnideepayurveda.in/` with `index.html`
- FB Pixel `1715387275770711` init + PageView on homepage, ViewContent on product pages
- Canonical URL present (`https://avnideepayurveda.in/`)
- og:image, og:title, og:description, twitter:card present
- Structured data (JSON-LD) present: Product, FAQPage, Organization, WebSite
- Product JSON-LD: sku `AVN-6PRO-001`, INR `1250`, InStock, NewCondition, priceValidUntil 2026-12-31
- Favicon and apple-touch-icon loading (currently points to shilajit image — acceptable for now)
- Checkout order popup wired on all 4 product pages (shilajit, pain-oil, hair-oil, herbal-balm) via cart.js + openOrderPopup()
- Server order API: `POST /api/order` saves to D1, sends Telegram + optional email, fires InitiateCheckout CAPI for prepaid
- Thank-you page fires Purchase event (client pixel + server CAPI) ONLY after a real payment (razorpay_payment_id present or COD confirmed)
- There is a server-side CAPI relay at `/api/events` so browser-side events are backed up server-side with hashed phone/email + event_id dedup

## 🟡 Needs a fix before ads spend scales (medium priority)

These are "site works but ads will complain / underperform" items.

1. **og:image hero-banner.png is huge** — current OG image on homepage is `https://avnideepayurveda.in/home/assets/hero-banner.png`. Compress/perceptual-optimize it to <= ~50KB (1200x630, webp/jpg). Large OG images hurt link previews and can look bad in ads. Also make sure og:image matches the ad creative you intend to run.

2. **Performance from earlier PageSpeed scan was poor (mobile ~29 → target 90+)** — if you want ads to be efficient on mobile, fix LCP/CLS before scaling. Exact bottlenecks: hero image weight/lazy strategy, above-the-fold font/CSS, any layout-shift animations. (You already started work on "performance 29 h → 90+" — finish that first, then ads.)

3. **Structured data image should match creative** — product JSON-LD currently uses `https://cdn.avnideepayurveda.in/Avnideep-shilajit/og-image.webp`. Ideally this is the same image you use in ads/og:image for the product page; mismatch looks off.

4. **favicon is shilajit photo, not a logo** — acceptable short-term, but a small branded favicon (logoyes.png or similar) looks more credible in tabs/social shares.

5. **Meta CAPI needs live env vars to actually send server events** — right now the code is wired, but `/api/events` and `/api/order` CAPI path only send if `META_ACCESS_TOKEN` + `META_PIXEL_ID` are configured in Workers secrets. Confirm those are set in your Cloudflare/Sites secrets before relying on server-side tracking.

6. **pixel dedup sanity** — ensure thank-you Purchase does not double-fire for COD (index.html may fire Purchase before redirect; thank-you has a sessionStorage dedup flag). Test a real COD flow end-to-end and confirm exactly one Purchase per order in Meta events manager.

## 🔴 Must-verify with Meta Events Manager before scaling (do this live)

I cannot log in to your Meta Business account from here, so verify these on the live site with your Meta pixel/tests:

- Use "Test Events" in Meta Events Manager against the live domain
- Visit homepage → confirm PageView
- Visit `/shilajit/` → confirm ViewContent + correct value (999 prepaid / 1250 cod context) and content_name/sku
- Complete a real test order (COD) → confirm Purchase fires once, with value, currency INR, content_name, order_id
- Complete a real prepaid/Razorpay order → confirm Purchase fires on thank-you page only after payment, with correct order_id
- Confirm CAPI events show up as "server" events and dedup with browser events (matched events, not duplicates)
- Confirm that redirects/thank-you do not leave the pixel in a broken state

## Recommended order of work

1. Finish performance work first (mobile LCP/CLS) — best ROI for ad cost.
2. Compress og:image + align product JSON-LD image with ad creative.
3. Set Meta CAPI secrets in your hosting/secrets panel if not already set.
4. Run Meta "Test Events" live and confirm the full funnel: PageView → ViewContent → InitiateCheckout → Purchase (once).
5. Then drip small ad budget and watch CPA/ROAS before scaling.

## Quick local checks I ran

- `node --check assets/cart.js` — passed
- JSON-LD blocks in index.html parse as valid JSON (4 blocks)
- product page interop: cart.js + openOrderPopup() present on shilajit/pain-oil/hair-oil/herbal-balm
- order.js: rate limit, amount validation, duplicate detection, phone normalization, CAPI idempotency all present in code
- tests exist: vitest suite with checkout-hooks, capi, order-api, api-hardening, hero-shine, video-carousel

## Verdict

Site is **ads-capable now** for basic traffic, but **not fully ads-optimized** until performance + og:image + CAPI secrets + Meta Events Manager verification are done. If you want, I can start by compressing/aligning og:image and confirming the pixel/CAPI wiring in one pass.
