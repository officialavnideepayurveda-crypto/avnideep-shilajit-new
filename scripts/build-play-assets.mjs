#!/usr/bin/env node
// Regenerates the Google Play listing assets in play-store/ from the live site
// and from play-store/feature-graphic.html.
//
//   node scripts/build-play-assets.mjs
//
// Requires a local Chrome/Chromium (set CHROME_BIN if it is not found).
// Outputs:
//   play-store/icon-512.png               512x512, no alpha
//   play-store/feature-graphic-1024x500.png
//   play-store/screenshots/phone-N-*.png  1080x1920
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = resolve(root, "play-store");
const shots = resolve(out, "screenshots");

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function findChrome() {
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!hit) throw new Error("Chrome not found. Set CHROME_BIN to your Chrome/Chromium path.");
  return hit;
}

function shoot(chrome, { url, file, width, height, budget = 12000, profile }) {
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      `--user-data-dir=${profile}`,
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      `--virtual-time-budget=${budget}`,
      `--screenshot=${file}`,
      url,
    ],
    { stdio: "ignore" }
  );
  if (!existsSync(file)) throw new Error(`Screenshot failed: ${file}`);
}

// Point BASE_URL at a local `wrangler pages dev` server to capture unreleased copy.
const BASE = process.env.BASE_URL || "https://avnideepayurveda.in";

const PAGES = [
  { name: "home", path: "/" },
  { name: "shilajit", path: "/shilajit/" },
  { name: "pain-oil", path: "/pain-oil/" },
  { name: "hair-oil", path: "/hair-oil/" },
];

async function main() {
  const chrome = findChrome();
  mkdirSync(shots, { recursive: true });

  // 1. Play icon: 512x512, no alpha, <= 1 MB.
  const iconBuf = await sharp(resolve(root, "icons/icon-512.png"))
    .resize(512, 512, { fit: "cover" })
    .flatten({ background: "#0A2C22" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await sharp(iconBuf).toFile(resolve(out, "icon-512.png"));

  // 2. Feature graphic, rendered from HTML so fonts/letterspacing are exact.
  const fgHtml = pathToFileURL(resolve(out, "feature-graphic.html")).href;

  // 3. Phone screenshots from the live site.
  PAGES.forEach((page, i) => {
    const profile = resolve(out, `.chrome-${i}`);
    // feature graphic
    if (i === 0) {
      shoot(chrome, {
        url: fgHtml,
        file: resolve(out, "feature-graphic-1024x500.png"),
        width: 1024,
        height: 500,
        budget: 4000,
        profile,
      });
    }
    shoot(chrome, {
      url: `${BASE}${page.path}`,
      file: resolve(shots, `phone-${i + 1}-${page.name}.png`),
      width: 1080,
      height: 1920,
      profile,
    });
    rmSync(profile, { recursive: true, force: true });
  });

  // 4. Validate what Play will check.
  const checks = [
    ["icon-512.png", 512, 512],
    ["feature-graphic-1024x500.png", 1024, 500],
    ...PAGES.map((p, i) => [`screenshots/phone-${i + 1}-${p.name}.png`, 1080, 1920]),
  ];
  let failed = 0;
  for (const [rel, w, h] of checks) {
    const file = resolve(out, rel);
    const meta = await sharp(file).metadata();
    const ok = meta.width === w && meta.height === h && meta.format === "png" && !meta.hasAlpha;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${rel}  ${meta.width}x${meta.height} ${meta.format} alpha=${meta.hasAlpha}`);
  }
  if (failed) {
    console.error(`\n${failed} asset(s) failed Play's spec.`);
    process.exit(1);
  }
  console.log("\nAll Play listing assets ready in play-store/.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
