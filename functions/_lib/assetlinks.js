// Digital Asset Links for the Android app (Trusted Web Activity).
//
// Google's verifier fetches https://avnideepayurveda.in/.well-known/assetlinks.json
// and only removes the Chrome URL bar if this file lists the SHA-256 fingerprint of
// the certificate the app was SIGNED with. Play re-signs every upload, so BOTH
// fingerprints are needed once Play App Signing is enabled:
//   1. Play App Signing key  (Play Console -> Release -> Setup -> App signing)
//   2. Upload key            (the key PWABuilder generated / the one you upload with)
//
// Fastest way to fill this in (writes this file for you):
//   node scripts/set-assetlinks.mjs "AA:BB:...:FF" "11:22:...:00"
//
// Fingerprints are public data (they are served to anyone), never a secret.

export const PACKAGE_NAME = "com.avnideepayurveda.store";

/** @type {string[]} SHA-256 certificate fingerprints, colon separated hex. */
export const SHA256_CERT_FINGERPRINTS = [
  // e.g. "1A:2B:3C:...:9F"  <- Play App Signing key
  // e.g. "4D:5E:6F:...:0A"  <- Upload key
];

const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function isValidFingerprint(value) {
  return typeof value === "string" && FINGERPRINT_RE.test(value.trim().toUpperCase());
}

export function normalizeFingerprint(value) {
  return String(value || "").trim().toUpperCase();
}

/** Builds the statement list Google expects, exactly one target entry. */
export function buildAssetLinks({
  packageName = PACKAGE_NAME,
  fingerprints = SHA256_CERT_FINGERPRINTS,
} = {}) {
  const clean = fingerprints.map(normalizeFingerprint).filter(isValidFingerprint);
  if (!clean.length) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: clean,
      },
    },
  ];
}

/** Rewrites the fingerprint array inside the module source (used by the CLI script). */
export function applyFingerprints(source, fingerprints) {
  const clean = fingerprints.map(normalizeFingerprint).filter(isValidFingerprint);
  const body = clean.map((f) => `  "${f}",`).join("\n");
  const replacement = `export const SHA256_CERT_FINGERPRINTS = [\n${body}\n];`;
  const re = /export const SHA256_CERT_FINGERPRINTS = \[[\s\S]*?\];/;
  if (!re.test(source)) {
    throw new Error("Could not find SHA256_CERT_FINGERPRINTS array to replace");
  }
  return source.replace(re, replacement);
}
