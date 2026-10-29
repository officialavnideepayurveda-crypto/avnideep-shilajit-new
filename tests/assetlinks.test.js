import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyFingerprints,
  buildAssetLinks,
  isValidFingerprint,
  PACKAGE_NAME,
  SHA256_CERT_FINGERPRINTS,
} from "../functions/_lib/assetlinks.js";

const FP_A = "1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8:09:1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8:09";
const FP_B = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";

describe("assetlinks fingerprints", () => {
  it("accepts a 32-pair SHA-256 fingerprint, case-insensitive", () => {
    expect(isValidFingerprint(FP_A)).toBe(true);
    expect(isValidFingerprint(FP_A.toLowerCase())).toBe(true);
  });

  it("rejects malformed fingerprints", () => {
    expect(isValidFingerprint("")).toBe(false);
    expect(isValidFingerprint("AA:BB:CC")).toBe(false);
    expect(isValidFingerprint(FP_A + ":00")).toBe(false);
    expect(isValidFingerprint(FP_A.replace("1A", "ZZ"))).toBe(false);
  });
});

describe("buildAssetLinks", () => {
  it("returns null until a fingerprint is configured (endpoint answers 404)", () => {
    expect(buildAssetLinks({ fingerprints: [] })).toBeNull();
    expect(buildAssetLinks({ fingerprints: ["not-a-fingerprint"] })).toBeNull();
  });

  it("emits the statement Google's verifier expects", () => {
    const out = buildAssetLinks({ fingerprints: [FP_A.toLowerCase(), FP_B] });
    expect(out).toHaveLength(1);
    expect(out[0].relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(out[0].target.namespace).toBe("android_app");
    expect(out[0].target.package_name).toBe(PACKAGE_NAME);
    expect(out[0].target.sha256_cert_fingerprints).toEqual([FP_A, FP_B]);
  });
});

describe("applyFingerprints", () => {
  it("rewrites the array in the real module source and stays loadable", () => {
    const file = resolve(__dirname, "../functions/_lib/assetlinks.js");
    const source = readFileSync(file, "utf8");
    const updated = applyFingerprints(source, [FP_A, FP_B]);
    expect(updated).toContain(`  "${FP_A}",`);
    expect(updated).toContain(`  "${FP_B}",`);
    // the rest of the module is untouched
    expect(updated).toContain("export function buildAssetLinks");
    expect(updated).not.toContain("not-a-fingerprint");
  });

  it("throws when the marker is missing", () => {
    expect(() => applyFingerprints("no marker here", [FP_A])).toThrow();
  });

  it("does not leave the shipped config in a half-configured state", () => {
    // Guards against committing a placeholder fingerprint by accident.
    for (const fp of SHA256_CERT_FINGERPRINTS) {
      expect(isValidFingerprint(fp)).toBe(true);
    }
  });
});
