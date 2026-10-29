// ============================================================
// Meta catalog feed (meta-catalog-feed.csv) for Facebook / Instagram
// shops and the WhatsApp catalog.
//
// The CSV is generated from merchant-feed.xml by
// scripts/build-meta-feed.mjs, so these tests fail if the two drift:
// Meta shows the price/link/image from this file and a mismatch means a
// rejected item ("price mismatch") or a dead link in the shop.
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

const SITE = "https://avnideepayurveda.in";
// Meta requires these columns for every item.
const REQUIRED_COLUMNS = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"];
const META_AVAILABILITY = ["in stock", "out of stock", "preorder", "available for order", "discontinued"];
const META_CONDITION = ["new", "refurbished", "used"];

// Minimal RFC4180-style reader: quoted fields may contain commas, and a
// doubled quote inside a quoted field is an escaped quote.
function splitCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') { value += '"'; i += 1; } else { quoted = false; }
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

// No field in the generated CSV contains a line break.
function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    header.forEach((col, i) => { row[col] = values[i] ?? ""; });
    return row;
  });
  return { header, rows };
}

function feedItems() {
  const xml = read("merchant-feed.xml");
  const decode = (s) => String(s).replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const get = (tag) => {
      const found = m[1].match(new RegExp(`<g:${tag}[^>]*>([\\s\\S]*?)</g:${tag}>`));
      return found ? decode(found[1]).replace(/\s+/g, " ").trim() : "";
    };
    return { id: get("id"), price: get("price"), link: get("link"), image: get("image_link"), brand: get("brand") };
  });
}

describe("meta-catalog-feed.csv", () => {
  it("has the columns Meta requires", () => {
    const { header } = parseCsv(read("meta-catalog-feed.csv"));
    for (const column of REQUIRED_COLUMNS) expect(header).toContain(column);
  });

  it("lists the same products as the Merchant Center feed", () => {
    const { rows } = parseCsv(read("meta-catalog-feed.csv"));
    expect(rows.map((r) => r.id).sort()).toEqual(feedItems().map((i) => i.id).sort());
  });

  it("matches the Google feed price, link, image and brand exactly", () => {
    const { rows } = parseCsv(read("meta-catalog-feed.csv"));
    for (const item of feedItems()) {
      const row = rows.find((r) => r.id === item.id);
      expect(row, "missing in Meta feed: " + item.id).toBeTruthy();
      expect(row.price).toBe(item.price);
      expect(row.link).toBe(item.link);
      expect(row.image_link).toBe(item.image);
      expect(row.brand).toBe(item.brand);
    }
  });

  it("uses values Meta accepts and links to this site only", () => {
    const { rows } = parseCsv(read("meta-catalog-feed.csv"));
    for (const row of rows) {
      expect(META_AVAILABILITY).toContain(row.availability);
      expect(META_CONDITION).toContain(row.condition);
      expect(row.price).toMatch(/^\d+\.\d{2} INR$/);
      expect(row.link.startsWith(SITE + "/")).toBe(true);
      expect(row.image_link.startsWith(SITE + "/")).toBe(true);
      expect(Number(row.quantity_to_sell_on_facebook)).toBeGreaterThanOrEqual(0);
      expect(row.description.length).toBeGreaterThan(200);
    }
  });
});
