#!/usr/bin/env node
/**
 * Naya blog post banane ka ek-command tool.
 *
 *   node scripts/new-blog-post.mjs --slug=joint-pain-oil-ke-fayde \
 *     --title="Joint Pain Oil Ke Fayde: Jodon Ke Dard Ka Ayurvedic Oil" \
 *     --desc="140–160 characters ka meta description" \
 *     [--cta=/pain-oil/] [--image=/pain-oil/oil-1.png] [--date=2026-11-01] [--dry-run]
 *
 * Kya karta hai:
 *   1. blog/<slug>/index.html ko blog/_template.html se banata hai
 *   2. blog/index.html ke <!-- POSTS --> marker ke neeche card jodta hai
 *   3. sitemap.xml me entry jodta hai
 *   4. baaki content (headings, CTA, FAQ) aap file me edit karte hain
 *
 * Site ka koi shared JS/CSS nahi chhua jata, isliye main site break nahi hoti.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] === undefined ? "true" : m[2]] : [a, "true"];
  })
);

if (args.help || !args.slug) {
  console.log(`Usage:
  node scripts/new-blog-post.mjs --slug=<url-slug> --title="<title>" --desc="<meta description>"
       [--cta=/pain-oil/] [--image=/pain-oil/oil-1.png] [--date=YYYY-MM-DD] [--dry-run]

Slug sirf chhote letters, digits aur hyphen ho sakta hai (e.g. shilajit-ke-fayde).`);
  process.exit(args.slug ? 1 : 0);
}

const slug = String(args.slug).trim().toLowerCase();
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error(`Invalid slug "${slug}". Sirf a-z, 0-9 aur hyphen use karein.`);
  process.exit(1);
}

const title = String(args.title || "").trim();
const desc = String(args.desc || "").trim();
if (!title || !desc) {
  console.error("--title aur --desc dono chahiye.");
  process.exit(1);
}
if (title.length < 50 || title.length > 60) {
  console.warn(`Warning: title ${title.length} chars hai (target 50–60).`);
}
if (desc.length < 140 || desc.length > 160) {
  console.warn(`Warning: description ${desc.length} chars hai (target 140–160).`);
}

const iso = args.date || new Date().toISOString().slice(0, 10);
const human = new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const cta = String(args.cta || "/#products");
const image = String(args.image || "/home/assets/shilajit-1-400.webp");
const dry = args["dry-run"] === "true";

const templatePath = path.join(ROOT, "blog", "_template.html");
const template = fs.readFileSync(templatePath, "utf8");

const postDir = path.join(ROOT, "blog", slug);
const postPath = path.join(postDir, "index.html");
if (fs.existsSync(postPath)) {
  console.error(`Post already exists: blog/${slug}/index.html`);
  process.exit(1);
}

const faqSchema = `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Sawal yahan","acceptedAnswer":{"@type":"Answer","text":"Jawab yahan."}}]}
</script>`;

const replacements = {
  "{{TITLE}}": title,
  "{{H1}}": title,
  "{{DESC}}": desc,
  "{{SLUG}}": slug,
  "{{DATE}}": human,
  "{{DATE_ISO}}": iso,
  "{{BREADCRUMB}}": title.split(":")[0].split("|")[0].trim(),
  "{{CTA_URL}}": cta,
  "{{OG_IMAGE}}": image,
  "{{HERO_IMAGE}}": image,
  "{{HERO_ALT}}": title,
  "{{LEAD}}": "Yahan 2–3 line ka intro likhein jo reader ko bataye ki is guide me kya milega.",
  "{{PRODUCT_NAME}}": "Avnideep product",
  "{{PRODUCT_LINE}}": "Price, COD aur offer ki ek line.",
  "{{READ_TIME}}": "6",
  "{{FAQ_SCHEMA}}": faqSchema,
};

let html = template;
for (const [key, value] of Object.entries(replacements)) {
  html = html.split(key).join(value);
}

const card = `<article class="blog-item">
<h2><a href="/blog/${slug}/">${title}</a></h2>
<p>${desc}</p>
<a class="more" href="/blog/${slug}/">Guide padhein &rarr;</a>
</article>
<!-- POSTS -->`;

const indexPath = path.join(ROOT, "blog", "index.html");
let indexHtml = fs.readFileSync(indexPath, "utf8");
if (!indexHtml.includes("<!-- POSTS -->")) {
  console.error("blog/index.html me <!-- POSTS --> marker nahi mila.");
  process.exit(1);
}
indexHtml = indexHtml.replace("<!-- POSTS -->", card);

const sitemapPath = path.join(ROOT, "sitemap.xml");
let sitemap = fs.readFileSync(sitemapPath, "utf8");
const entry = `  <url>
    <loc>https://avnideepayurveda.in/blog/${slug}/</loc>
    <lastmod>${iso}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`;
sitemap = sitemap.replace("</urlset>", entry);

if (dry) {
  console.log(`[dry-run] would create blog/${slug}/index.html`);
  console.log(`[dry-run] would add a card to blog/index.html`);
  console.log(`[dry-run] would add https://avnideepayurveda.in/blog/${slug}/ to sitemap.xml`);
  process.exit(0);
}

fs.mkdirSync(postDir, { recursive: true });
fs.writeFileSync(postPath, html, "utf8");
fs.writeFileSync(indexPath, indexHtml, "utf8");
fs.writeFileSync(sitemapPath, sitemap, "utf8");

console.log(`Created blog/${slug}/index.html`);
console.log("Next:");
console.log(`  1. blog/${slug}/index.html me H1, sections, FAQ aur CTA content bharein`);
console.log("  2. blog/index.html ka card text check karein");
console.log("  3. local preview: npx wrangler pages dev . --port 8788");
