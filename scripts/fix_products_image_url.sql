-- One-off data fix: repoint existing product image URLs at the CDN.
--
-- Apply against production D1 (run from the shop project root):
--   npx wrangler d1 execute avnideep-orders --remote --file scripts/fix_products_image_url.sql
--
-- Legacy hosts in data: shop.avnideepayurveda.in, shop.avnideep.in
-- Canonical image host:  cdn.avnideepayurveda.in (Cloudflare R2 bucket `avnideep-images`)
--
-- NOTE: this file is intentionally kept OUT of migrations/ so it never gets
-- pulled into the `wrangler d1 migrations apply` chain (products is created at
-- runtime by the admin worker, not by a numbered shop migration).

UPDATE products
SET image_url =
  REPLACE(
    REPLACE(
      REPLACE(image_url,
        'https://shop.avnideepayurveda.in', 'https://cdn.avnideepayurveda.in'),
      'https://shop.avnideep.in', 'https://cdn.avnideepayurveda.in'),
    'https://www.avnideep.in', 'https://cdn.avnideepayurveda.in')
WHERE image_url LIKE 'https://shop.avnideepayurveda.in/%'
   OR image_url LIKE 'https://shop.avnideep.in/%'
   OR image_url LIKE 'https://www.avnideep.in/%';

-- Optional: the `images` JSON column (added at runtime by the admin worker).
-- Uncomment only if that column exists and holds legacy hosts.
-- UPDATE products
-- SET images =
--   REPLACE(
--     REPLACE(
--       REPLACE(images,
--         'shop.avnideepayurveda.in', 'cdn.avnideepayurveda.in'),
--       'shop.avnideep.in', 'cdn.avnideepayurveda.in'),
--     'www.avnideep.in', 'cdn.avnideepayurveda.in')
-- WHERE images LIKE '%shop.avnideepayurveda.in%'
--    OR images LIKE '%shop.avnideep.in%'
--    OR images LIKE '%www.avnideep.in%';
