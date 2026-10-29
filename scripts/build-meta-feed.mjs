// Builds the Meta (Facebook / Instagram / WhatsApp) catalog feed from the
// Google Merchant Center feed, so both channels always show the same price,
// stock status and landing page.
//
//   node scripts/build-meta-feed.mjs
//
// Input : merchant-feed.xml  (source of truth, one <item> per product)
// Output: meta-catalog-feed.csv (Meta Commerce Manager data feed)
//
// Meta accepts CSV/TSV/XLSX/XML(RSS) for scheduled feeds; CSV is the most
// forgiving on upload, so we emit a fully quoted CSV with Meta's required
// columns: id, title, description, availability, condition, price, link,
// image_link, brand (plus optional image/category/quantity columns).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const XML_PATH = resolve(ROOT, "merchant-feed.xml");
const CSV_PATH = resolve(ROOT, "meta-catalog-feed.csv");

const XML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m) => XML_ENTITIES[m]);
const clean = (s) => decode(s).replace(/\s+/g, " ").trim();

function field(block, tag) {
  const match = block.match(new RegExp(`<g:${tag}[^>]*>([\\s\\S]*?)</g:${tag}>`));
  return match ? clean(match[1]) : "";
}

const xml = readFileSync(XML_PATH, "utf8");
const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
if (!items.length) throw new Error("No <item> blocks found in merchant-feed.xml");

// Meta requires price as "1000.00 INR" — same format the Google feed uses.
const rows = items.map((block) => ({
  id: field(block, "id"),
  title: field(block, "title"),
  description: field(block, "description"),
  availability: field(block, "availability") || "in stock",
  condition: field(block, "condition") || "new",
  price: field(block, "price"),
  link: field(block, "link"),
  image_link: field(block, "image_link"),
  additional_image_link: field(block, "additional_image_link"),
  brand: field(block, "brand"),
  mpn: field(block, "mpn"),
  google_product_category: field(block, "google_product_category"),
  // Update this if stock levels become the real fulfilment limit for FB/IG.
  quantity_to_sell_on_facebook: field(block, "availability") === "out of stock" ? "0" : "100",
}));

const COLUMNS = Object.keys(rows[0]);
const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const csv = [COLUMNS.join(","), ...rows.map((row) => COLUMNS.map((c) => csvEscape(row[c])).join(","))].join("\n") + "\n";

writeFileSync(CSV_PATH, csv, "utf8");
console.log(`meta-catalog-feed.csv written — ${rows.length} products, ${Buffer.byteLength(csv)} bytes`);
for (const row of rows) console.log(`  ${row.id.padEnd(14)} ${row.price.padEnd(12)} ${row.link}`);
