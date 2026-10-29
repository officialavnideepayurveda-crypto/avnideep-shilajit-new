# Google Play release — Avnideep Ayurveda (Trusted Web Activity)

The site is already a valid PWA (`manifest.webmanifest` with 192/512/maskable icons,
`display: standalone`, `start_url: /`, registered service worker, HTTPS + HSTS), so the app is
a **Trusted Web Activity**: a native Android shell that opens avnideepayurveda.in full-screen
in Chrome, with no URL bar once Digital Asset Links are verified.

**Why TWA:** site releases go live instantly (no app update to publish), Play billing is not
required for physical goods, and checkout/UPI/COD keep working exactly as on the web.

---

## What is already done in this repo

| Item | Path | Status |
|---|---|---|
| Asset Links endpoint (dotfile fix) | `functions/.well-known/assetlinks.json.js` | Live once deployed; answers `404 assetlinks_not_configured` until fingerprints are added |
| Fingerprint config | `functions/_lib/assetlinks.js` | Empty — needs the two SHA-256 values from Play Console |
| Fingerprint CLI | `scripts/set-assetlinks.mjs` | Ready |
| Tests | `tests/assetlinks.test.js` | 7 tests, passing |
| Play icon 512×512 (no alpha) | `play-store/icon-512.png` | Done |
| Feature graphic 1024×500 | `play-store/feature-graphic-1024x500.png` | Done (source: `feature-graphic.html`) |
| Phone screenshots 1080×1920 ×4 | `play-store/screenshots/` | Done |
| Listing copy + declaration answers | `play-store/listing.md` | Done |
| Asset regenerator | `scripts/build-play-assets.mjs` | `node scripts/build-play-assets.mjs` |

Cloudflare Pages cannot serve `.well-known/` as a static folder (dot-directories are never
uploaded), which is why assetlinks is a Pages Function. Verified locally with
`wrangler pages dev`: `404` unconfigured → `200` with valid JSON after
`node scripts/set-assetlinks.mjs "<fp>"`.

---

## Step 1 — Build the signed AAB with PWABuilder

1. Open <https://www.pwabuilder.com>, enter `https://avnideepayurveda.in`, **Start**.
2. Wait for the PWA score, then **Package for stores → Android**.
3. Use these values:

   | Field | Value |
   |---|---|
   | Package ID | `com.avnideepayurveda.store` — **must match** `PACKAGE_NAME` in `functions/_lib/assetlinks.js` |
   | App name | `Avnideep Ayurveda` |
   | Short name | `Avnideep` |
   | App version | `1.0.0` |
   | App version code | `1` |
   | Display mode | `Standalone` |
   | Fallback behaviour | `Custom Tabs` |
   | Include support for app links | On |
   | Signing key | **Create new** → downloads `signing.keystore` + `signing-key-info.txt` |

4. **Download** the zip. It contains `*.aab`, `assetlinks.json`, `signing.keystore`,
   `signing-key-info.txt` (alias + both passwords).

> If you pick a different Package ID, change `PACKAGE_NAME` before adding fingerprints —
> otherwise Android cannot verify the domain and the app keeps showing the Chrome URL bar.

**Back up `signing.keystore` and `signing-key-info.txt` offline.** Losing the upload key is
recoverable (Play App Signing lets you reset it), losing the keystore file with no backup means
a reset request — annoying but possible. Never commit them to git.

## Step 2 — Upload to Play Console

1. Play Console → **Create app**: name `Avnideep Ayurveda`, language English (India), type
   *App*, *Free*.
2. **Test and release → Setup → App signing**: keep Google-managed **Play App Signing** on.
3. **Testing → Internal testing → Create new release** → upload the `.aab` → roll out.
4. Open **Setup → App signing** and copy **both** SHA-256 values:
   - *App signing key certificate* → SHA-256
   - *Upload key certificate* → SHA-256

## Step 3 — Verify the domain (removes the URL bar)

```bash
# from the repo root
node scripts/set-assetlinks.mjs "AA:BB:..:FF" "11:22:..:00"   # paste both fingerprints
npx vitest run tests/assetlinks.test.js                        # guard test
# commit + deploy, then:
curl -s https://avnideepayurveda.in/.well-known/assetlinks.json
```

Expected: HTTP 200 with both fingerprints. Google's own checker:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://avnideepayurveda.in&relation=delegate_permission/common.handle_all_urls
```

Then install the app from the internal-testing link and open it — the Chrome address bar and
"Powered by Chrome" line disappear. If it does not: re-check the fingerprint (one character off
breaks it), make sure the app was installed from Play (not a sideloaded debug build), and give
the CDN up to 5 minutes (`Cache-Control: max-age=300`).

## Step 4 — Store listing and declarations

Fill from `play-store/listing.md`: name, descriptions, category, contact details, then upload
`icon-512.png`, `feature-graphic-1024x500.png` and the screenshots. Complete **App content**:
privacy policy URL, Data safety, ads = No, app access = unrestricted, content rating, target
audience 18+.

## Step 5 — Test, then production

Internal testing → closed testing → **Production**. Review usually takes 1–7 days; the first
submission of a new app plus a health-adjacent catalogue often takes the longer end.

---

## Things that can bite

| Risk | Detail | Fix |
|---|---|---|
| **Target API 36** | Since 31 Aug 2026 Play requires new apps/updates to target Android 16 (API 36). PWABuilder usually ships `targetSdk 35`. | If Play rejects the bundle, the generated `build.gradle` needs `targetSdkVersion 36`; rebuilding needs JDK 17 + Android SDK (I can install those and rebuild, or PWABuilder's newer template can be re-downloaded). |
| **Personal-account testing rule** | Personal accounts created after 13 Nov 2023 must run closed testing with 12 testers for 14 days before production. | Organization accounts (D-U-N-S) are exempt. Your existing account decides this — check *Setup → Account type*. |
| **Wrapper policy** | Play rejects apps that only wrap a website. A TWA of **your own** storefront with checkout, order tracking and offline support is allowed. | Keep those features; do not reduce the app to a bare iframe of the homepage. |
| **Health claims** | Supplements + “Dard me aaram” screenshots can trigger *Misrepresentation* / health-content review. | Prefer screenshots 1, 2, 4 first (see `listing.md` risk notes). |
| **Return-policy wording** | Fixed: every storefront page now says 10-day returns, matching the refund policy. | Keep any new copy at 10 days. |
| **Payments** | Selling physical goods is exempt from Play billing. | Keep Razorpay; do not add digital goods. |
| **Duplicate package ID** | A published package ID can never be reused or changed. | Decide `com.avnideepayurveda.store` now (or tell me the final one). |

## Regenerating assets

```bash
node scripts/build-play-assets.mjs   # icon + feature graphic + screenshots, validates Play specs

# capture copy that is not deployed yet (e.g. while testing a wording change):
npx wrangler@4 pages dev . --port 8799 &
BASE_URL=http://127.0.0.1:8799 node scripts/build-play-assets.mjs
```
