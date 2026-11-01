/**
 * /blog/<slug>/ — D1 se publish hua post render karta hai.
 *
 * Agar slug D1 me nahi milta to request normal static asset par jaati hai
 * (context.next()), isliye purane static posts bilkul pehle jaise chalte hain.
 * Design blog/_template.html se aata hai — ek hi jagah maintain hota hai.
 */

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function isoDate(value) {
  const d = value ? new Date(value) : new Date();
  return isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

function humanDate(value) {
  const d = value ? new Date(value) : new Date();
  const safe = isNaN(d.getTime()) ? new Date() : d;
  return safe.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function readingTime(html) {
  const words = String(html).replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.round(words / 200));
}

async function fetchTemplate(context) {
  const { env, request } = context;
  if (!env.ASSETS) return null;
  const url = new URL('/blog/_template.html', request.url);
  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  if (!res.ok) return null;
  return res.text();
}

export async function onRequestGet(context) {
  const { params, env, request, next } = context;
  const slug = String(params.slug || '');
  if (!slug || slug.includes('.') || !env.DB) return next();

  let post;
  try {
    post = await env.DB
      .prepare("SELECT slug, title, description, hero_image, hero_alt, body_html, published_at, updated_at FROM blog_posts WHERE slug = ? AND status = 'published'")
      .bind(slug)
      .first();
  } catch (e) {
    return next();
  }
  if (!post) return next();

  const template = await fetchTemplate(context);
  if (!template) return next();

  const published = isoDate(post.published_at);
  const updated = isoDate(post.updated_at || post.published_at);
  const title = post.title;
  const desc = post.description;
  const image = post.hero_image || '/home/assets/shilajit-1-400.webp';
  const crumbs = title.split(':')[0].split('|')[0].trim();

  let html = template
    .split('{{TITLE}}').join(esc(title))
    .split('{{DESC}}').join(esc(desc))
    .split('{{SLUG}}').join(esc(slug))
    .split('{{DATE}}').join(esc(humanDate(post.published_at)))
    .split('{{DATE_ISO}}').join(esc(updated))
    .split('{{BREADCRUMB}}').join(esc(crumbs))
    .split('{{CTA_URL}}').join('/#products')
    .split('{{OG_IMAGE}}').join(esc(image))
    .split('{{HERO_IMAGE}}').join(esc(image))
    .split('{{HERO_ALT}}').join(esc(post.hero_alt || title))
    .split('{{READ_TIME}}').join(String(readingTime(post.body_html)))
    .split('{{PRODUCT_NAME}}').join('Avnideep Ayurvedic products')
    .split('{{PRODUCT_LINE}}').join('Lab tested, COD available, free delivery ₹499+ par.')
    .split('{{FAQ_SCHEMA}}').join('');

  // Template ka placeholder body hata kar asli content lagate hain.
  const mainStart = html.indexOf('<main class="rx-page rx-art">');
  const mainEnd = html.indexOf('</main>');
  if (mainStart === -1 || mainEnd === -1) return next();

  const main = `<main class="rx-page rx-art">
<nav class="art-crumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/blog/">Health Guides</a> &rsaquo; <span>${esc(crumbs)}</span></nav>
<h1>${esc(title)}</h1>
<p class="meta">Avnideep Ayurveda Team &middot; Updated: ${esc(humanDate(post.updated_at || post.published_at))} &middot; ${readingTime(post.body_html)} min read</p>
<figure class="art-hero"><img src="${esc(image)}" alt="${esc(post.hero_alt || title)}" width="400" height="400" fetchpriority="high" decoding="async"></figure>
<div class="art-body">
${post.body_html}
</div>
<div class="art-cta">
<div><b>Lab-tested Ayurvedic products</b><p>6Pro Shilajit capsules, pain relief oil, hair oil aur herbal balm — COD available.</p></div>
<a class="rx-btn" href="/#products">Products dekhein</a>
</div>
<p class="art-note">Yeh article sirf general information ke liye hai aur kisi doctor ki salah ka substitute nahi hai. Avnideep products Ayurvedic supplements hain, bimari ki dawa nahi. Koi bhi supplement shuru karne se pehle apne qualified healthcare professional se salah lein. Individual results alag-alag ho sakte hain.</p>
<h2>Aage padhein</h2>
<div class="art-related">
<a href="/blog/">Saare health guides</a>
<a href="/shilajit/">6Pro Shilajit capsules</a>
<a href="/pain-oil/">Pain Relief Oil</a>
</div>
</main>`;

  html = html.slice(0, mainStart) + main + html.slice(mainEnd + '</main>'.length);

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=120, must-revalidate',
      'X-Blog-Source': 'd1'
    }
  });
}
