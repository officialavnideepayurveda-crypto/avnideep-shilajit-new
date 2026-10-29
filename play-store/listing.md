# Google Play — listing copy (copy-paste ready)

Play Console → **Grow → Store presence → Main store listing**. Field limits are enforced by
Play, so paste as-is.

---

## App name (max 30 characters)

```
Avnideep Ayurveda
```

_(24 characters)_

## Short description (max 80 characters)

```
Lab-tested Ayurvedic shilajit, pain relief oil & hair oil. COD + free delivery.
```

_(78 characters)_

## Full description (max 4000 characters)

```
Avnideep Ayurveda is the official store app for avnideepayurveda.in — lab-tested Ayurvedic wellness products delivered across India, with Cash on Delivery.

WHAT YOU CAN DO IN THE APP
• Browse the full catalogue: Ayurvedic shilajit capsules, pain relief oil, hair oil and herbal balm
• Read ingredient lists, how-to-use guidance, FAQ and lab-test details for every product
• Choose pack size, pay by COD or prepaid (UPI / card / netbanking via Razorpay)
• Place an order in under a minute — no account or password needed
• Track your order from the app, or contact support on WhatsApp
• Works on slow networks and stays available offline for pages you already opened

WHY PEOPLE SHOP WITH US
• Cash on Delivery available on every product
• Free delivery across India, dispatch within 24 hours
• 10-day return policy on delivered orders
• Every batch is tested for purity and heavy metals, and manufactured in an AYUSH-licensed, GMP-certified facility
• Transparent pricing: MRP, prepaid discount and COD charge shown before you pay

OUR RANGE
• 6Pro Shilajit Capsules — Himalayan shilajit with 14 Ayurvedic herbs, 30 capsules
• Pain Relief Oil 60 ml — Nirgundi + Gandhapura, for external use
• Hair Oil 100 ml — Bhringraj, Amla and Neem
• Herbal Balm 25 g — for external application

SUPPORT
Questions about an order, delivery or a return? Email support@avnideepayurveda.in or message us on WhatsApp from the app. We reply within one working day.

IMPORTANT
These are Ayurvedic food/herbal supplements and topical products, not medicines. They are not intended to diagnose, treat, cure or prevent any disease. Results vary from person to person. Consult a qualified healthcare professional before use if you are pregnant, breastfeeding, taking medication or managing a medical condition. Keep out of reach of children.

Prices, offers and availability in the app match the website. Payments for physical goods are processed by our payment gateway; the app does not sell digital content or subscriptions.
```

## Category & contact details

| Field | Value |
|---|---|
| App category | Shopping |
| Tags | Shopping, Health & Fitness |
| Contact email | support@avnideepayurveda.in |
| Website | https://avnideepayurveda.in |
| Privacy policy | https://avnideepayurveda.in/privacy-policy |
| Phone | (optional — leave blank or your support number) |

## Graphics checklist (files in this folder)

| Asset | Spec | File |
|---|---|---|
| App icon | 512 × 512, 32-bit PNG, ≤ 1 MB | `icon-512.png` (512×512, no alpha, 18 KB) |
| Feature graphic | 1024 × 500, PNG/JPEG, no alpha | `feature-graphic-1024x500.png` |
| Phone screenshots | 2–8 images, 9:16, 320–3840 px | `screenshots/phone-1-home.png` … `phone-4-hair-oil.png` (1080×1920) |

To regenerate the feature graphic after a copy change:

```bash
node scripts/build-play-assets.mjs        # re-renders feature graphic + screenshots
```

Suggested screenshot order in the listing (first two are what users see in search):
1. `phone-1-home.png` — storefront
2. `phone-2-shilajit.png` — flagship product page
3. `phone-4-hair-oil.png`
4. `phone-3-pain-oil.png`

## Data safety form (App content → Data safety)

Answer as below — it matches what the site actually loads (GTM, Meta Pixel, Razorpay, Cloudflare).

| Question | Answer |
|---|---|
| Does your app collect or share any required user data types? | **Yes** |
| Data types collected | Name, Phone number, Email (optional at checkout), Address, Purchase history, App interactions (page views), Device or other IDs (analytics/pixel) |
| Is data encrypted in transit? | **Yes** (HTTPS everywhere, HSTS enabled) |
| Can users request data deletion? | **Yes** — email support@avnideepayurveda.in; orders are deleted/anonymised on request |
| Is data shared with third parties? | **Yes** — payment gateway (Razorpay: payment + order data), analytics/ads measurement (Google Tag Manager, Meta), shipping partner (name, phone, address) |
| Is data used for advertising or marketing? | **Yes** (Meta Pixel / GTM conversion measurement) |
| Is data collected for app functionality only? | No — also analytics and marketing |
| Prominent disclosure / consent | Checkout shows the privacy-policy link before payment |

## Other App content declarations

| Section | Answer |
|---|---|
| Ads | **No** — the app shows no third-party ads |
| App access | **All functionality available without restrictions** (no login) |
| Content rating questionnaire | Category: *Utility / Shopping*; no violence, sexual, drug, gambling or profanity content |
| Target audience | **18+** (supplements and topical products) |
| News app | No |
| COVID-19 contact tracing | No |
| Data deletion URL | https://avnideepayurveda.in/privacy-policy |
| Health apps declaration | If Play asks, declare: *shopping app for a store that sells Ayurvedic supplements and topical products; no health data is collected, no medical advice or diagnosis is provided* |
| Financial features | No (payments are for physical goods, not financial products) |
| Government app | No |

## Review-risk notes (read before submitting)

1. **Health claims in screenshots.** The pain-oil page carries the line “Dard me Ayurvedic
   Aaram”. Play’s health-content reviewers sometimes read that as a therapeutic claim. If the
   app gets rejected for *Misrepresentation* or *Health content*, upload `phone-1`, `phone-2`
   and `phone-4` only and retry — or ask for the copy to be softened.
2. **Web-wrapper policy.** A Trusted Web Activity of your **own** site is allowed, but Play
   rejects apps whose only purpose is a bare webview. This app is fine because it is your own
   storefront with checkout, order tracking and offline support — but do not strip those
   features later.
3. **Return-policy wording.** All storefront pages (home, shilajit, pain-oil, hair-oil,
   herbal-balm and the cart drawer) now say **10-day returns**, matching the refund policy.
   Keep it that way — any future “7-day” copy re-introduces a *Misrepresentation* risk for both
   Play and Merchant Center.
4. **“AS FEATURED ON Amazon • Flipkart • Tata 1mg • Meesho”** appears on the homepage and in
   screenshot 1. Only keep it if the products are genuinely listed there.
