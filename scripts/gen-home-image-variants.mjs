// ============================================================
// HOME IMAGE VARIANTS
//
// Two jobs, both idempotent (re-run after changing a source image):
//
// 1. 240 w thumbnails for the category strip. The strip renders 120 px tiles
//    but only had 400 w / 500 w / 1000 w files, so a phone pulled 21-35 KB per
//    tile (~113 KB for the strip). The 240 w files are the 2x asset for that
//    slot and bring the strip to ~55 KB.
//
// 2. AVIF siblings for the images the homepage fetches on first load. Same
//    pixels, ~30-40 % fewer bytes than WebP; index.html offers them with a
//    <source type="image/avif"> before the WebP source, so older browsers keep
//    getting the WebP file unchanged.
//
// Usage: node scripts/gen-home-image-variants.mjs
// ============================================================
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => join(ROOT, p);
const kb = (p) => (statSync(out(p)).size / 1024).toFixed(1);

// ---- 1. category strip thumbnails (WebP) --------------------------------
const THUMBS = [
  ['home/assets/shilajit-1-900.webp', 'home/assets/shilajit-1-240.webp', 240],
  ['home/assets/oil-1-900.webp', 'home/assets/oil-1-240.webp', 240],
  ['home/assets/showcase-1-1000.webp', 'home/assets/showcase-1-240.webp', 240],
  ['home/assets/lookbook-1-1000.webp', 'home/assets/lookbook-1-240.webp', 240],
  ['home/assets/doctor.webp', 'home/assets/doctor-240.webp', 240],
  ['home/assets/showcase-2-800.webp', 'home/assets/showcase-2-240.webp', 240],
];

for (const [src, dest, width] of THUMBS) {
  const buf = await sharp(readFileSync(out(src)))
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 72, effort: 6 })
    .toBuffer();
  writeFileSync(out(dest), buf);
  console.log(`${dest}  ${kb(dest)} KiB`);
}

// ---- 2. AVIF siblings ---------------------------------------------------
// [source (largest available), output, width]
const AVIF = [
  // hero banner: encode from the 992 px original, not the already-lossy 720 copy
  ['home/assets/banner-shilajit-mobile.webp', 'home/assets/banner-shilajit-mobile-opt-720.avif', 720, 48],
  // range tiles
  ['home/assets/hero-stamina-wide-opt.webp', 'home/assets/hero-stamina-wide-opt-800.avif', 800, 52],
  ['home/assets/showcase-2-trim-opt.webp', 'home/assets/showcase-2-trim-opt-800.avif', 800, 52],
  // product cards - main photo + hover photo
  ['home/assets/shilajit-1-900.webp', 'home/assets/shilajit-1-400.avif', 400, 52],
  ['home/assets/shilajit-2-900.webp', 'home/assets/shilajit-2-400.avif', 400, 52],
  ['pain-oil/oil-1-900.webp', 'pain-oil/oil-1-400.avif', 400, 52],
  ['home/assets/oil-2-900.webp', 'home/assets/oil-2-400.avif', 400, 52],
  ['hair-oil/gallery/g1-900.webp', 'hair-oil/gallery/g1-400.avif', 400, 52],
  ['hair-oil/gallery/g2-900.webp', 'hair-oil/gallery/g2-400.avif', 400, 52],
  ['herbal-balm/gallery/g1-900.webp', 'herbal-balm/gallery/g1-400.avif', 400, 52],
  ['herbal-balm/gallery/g2-900.webp', 'herbal-balm/gallery/g2-400.avif', 400, 52],
];

for (const [src, dest, width, quality] of AVIF) {
  const buf = await sharp(readFileSync(out(src)))
    .resize({ width, withoutEnlargement: true })
    .avif({ quality, effort: 5 })
    .toBuffer();
  writeFileSync(out(dest), buf);
  console.log(`${dest}  ${kb(dest)} KiB`);
}
