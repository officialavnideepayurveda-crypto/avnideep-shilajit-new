#!/usr/bin/env node
// Writes the Digital Asset Links fingerprints for the Android (TWA) app.
//
// Usage (from the site root):
//   node scripts/set-assetlinks.mjs "AA:BB:CC:...:FF"
//   node scripts/set-assetlinks.mjs "AA:..:FF" "11:..:00"   # Play key + upload key
//
// Fingerprints come from:
//   Play Console -> Test and release -> Setup -> App signing
//   (App signing key certificate + Upload key certificate, SHA-256 each)
// or from the keystore PWABuilder gave you:
//   keytool -list -v -keystore signing.keystore -alias <alias>
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyFingerprints,
  isValidFingerprint,
  PACKAGE_NAME,
} from "../functions/_lib/assetlinks.js";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../functions/_lib/assetlinks.js");

const args = process.argv.slice(2).filter(Boolean);
if (!args.length) {
  console.error("Usage: node scripts/set-assetlinks.mjs <SHA-256 fingerprint> [more...]");
  console.error("Example: node scripts/set-assetlinks.mjs \"1A:2B:...:9F\"");
  process.exit(1);
}

const bad = args.filter((a) => !isValidFingerprint(a));
if (bad.length) {
  console.error("Invalid SHA-256 fingerprint(s):");
  for (const b of bad) console.error(`  ${b}  (expected 32 colon-separated hex pairs)`);
  process.exit(1);
}

const source = readFileSync(target, "utf8");
const updated = applyFingerprints(source, args);
writeFileSync(target, updated, "utf8");

console.log(`Package name: ${PACKAGE_NAME}`);
console.log(`Wrote ${args.length} fingerprint(s):`);
for (const a of args) console.log(`  ${a.trim().toUpperCase()}`);
console.log("\nNext: commit + deploy, then verify:");
console.log("  curl -s https://avnideepayurveda.in/.well-known/assetlinks.json");
