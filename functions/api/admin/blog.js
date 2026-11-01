/**
 * /api/admin/blog — blog posts ka CRUD (admin panel isi ko call karta hai).
 *
 * Auth: header `x-blog-key` ko env.BLOG_ADMIN_KEY (ya fallback env.ADMIN_TOKEN)
 * se match kiya jata hai. Key set nahi hai to API 503 deta hai — isliye galti se
 * khula hua admin kabhi expose nahi hota.
 *
 *   GET    /api/admin/blog            -> saare posts (draft + published)
 *   POST   /api/admin/blog            -> naya post { slug, title, description, hero_image, body, status }
 *   PUT    /api/admin/blog?slug=xyz   -> update (same fields)
 *   DELETE /api/admin/blog?slug=xyz   -> delete
 */

const STATIC_POST_SLUGS = new Set([
  'shilajit-capsules-ke-fayde',
  'joint-pain-oil-ke-fayde',
  'shilajit-vs-ashwagandha'
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function configuredKey(env) {
  return env.BLOG_ADMIN_KEY || env.ADMIN_TOKEN || '';
}

/* Admin trusted hai, phir bhi HTML ko clean karte hain taaki ek galat paste
   script/iframe ke through live page na tod de. */
function sanitize(html) {
  return String(html || '')
    .replace(/<\s*(script|iframe|object|embed|style|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|style|form)[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function cleanSlug(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function validate(payload) {
  const slug = cleanSlug(payload.slug || payload.title);
  const title = String(payload.title || '').trim();
  const description = String(payload.description || '').trim();
  const body = sanitize(payload.body || payload.body_html || '');
  const hero = String(payload.hero_image || '/home/assets/shilajit-1-400.webp').trim();
  const heroAlt = String(payload.hero_alt || title).trim();
  const status = payload.status === 'published' ? 'published' : 'draft';

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return { error: 'Slug sirf a-z, 0-9 aur hyphen ho sakta hai.' };
  if (STATIC_POST_SLUGS.has(slug)) return { error: 'Ye slug pehle se ek static post ka hai. Doosra slug chunein.' };
  if (title.length < 10 || title.length > 120) return { error: 'Title 10–120 characters ka rakhein.' };
  if (description.length < 40 || description.length > 300) return { error: 'Meta description 40–300 characters ki rakhein.' };
  if (body.replace(/<[^>]*>/g, '').trim().length < 300) return { error: 'Content kam se kam ~300 characters ka likhein.' };
  if (body.length > 220000) return { error: 'Content bahut bada hai (max ~220 KB).' };
  if (!/^(https?:\/\/|\/)/.test(hero)) return { error: 'Hero image ke liye https URL ya site path dein.' };

  return { data: { slug, title, description, body, hero, heroAlt, status } };
}

async function ensureTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blog_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    hero_image TEXT,
    hero_alt TEXT,
    body_html TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run().catch(() => {});
}

async function authorize(context) {
  const key = configuredKey(context.env);
  if (!key) return 'not-configured';
  const given = context.request.headers.get('x-blog-key') || '';
  return safeEqual(given, key) ? 'ok' : 'denied';
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { Allow: 'GET, POST, PUT, DELETE, OPTIONS', 'Cache-Control': 'no-store' }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const auth = await authorize(context);
  if (auth === 'not-configured') {
    return json({ error: 'Blog admin key set nahi hai. Cloudflare me BLOG_ADMIN_KEY secret add karein.' }, 503);
  }
  if (auth !== 'ok') return json({ error: 'Galat admin key.' }, 401);
  if (!env.DB) return json({ error: 'Database binding (DB) missing.' }, 500);

  await ensureTable(env);
  const url = new URL(request.url);

  try {
    if (request.method === 'GET') {
      const { results } = await env.DB
        .prepare('SELECT id, slug, title, description, hero_image, hero_alt, body_html, status, published_at, updated_at FROM blog_posts ORDER BY updated_at DESC')
        .all();
      return json({ ok: true, posts: results || [] });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const payload = await request.json().catch(() => ({}));
      const checked = validate(payload);
      if (checked.error) return json({ error: checked.error }, 400);
      const d = checked.data;
      const now = new Date().toISOString();
      const publishedAt = d.status === 'published' ? (payload.published_at || now) : null;

      if (request.method === 'POST') {
        const existing = await env.DB.prepare('SELECT id FROM blog_posts WHERE slug = ?').bind(d.slug).first();
        if (existing) return json({ error: 'Is slug ka post pehle se hai. Slug badlein ya us post ko edit karein.' }, 409);
        await env.DB.prepare(
          'INSERT INTO blog_posts (slug, title, description, hero_image, hero_alt, body_html, status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(d.slug, d.title, d.description, d.hero, d.heroAlt, d.body, d.status, publishedAt, now, now).run();
        return json({ ok: true, slug: d.slug, status: d.status }, 201);
      }

      const slug = cleanSlug(url.searchParams.get('slug') || payload.slug);
      if (!slug) return json({ error: 'slug chahiye.' }, 400);
      const row = await env.DB.prepare('SELECT id, published_at FROM blog_posts WHERE slug = ?').bind(slug).first();
      if (!row) return json({ error: 'Post nahi mila.' }, 404);
      const keepPublished = d.status === 'published' ? (row.published_at || publishedAt) : null;
      await env.DB.prepare(
        'UPDATE blog_posts SET title = ?, description = ?, hero_image = ?, hero_alt = ?, body_html = ?, status = ?, published_at = ?, updated_at = ? WHERE slug = ?'
      ).bind(d.title, d.description, d.hero, d.heroAlt, d.body, d.status, keepPublished, now, slug).run();
      return json({ ok: true, slug, status: d.status });
    }

    if (request.method === 'DELETE') {
      const slug = cleanSlug(url.searchParams.get('slug'));
      if (!slug) return json({ error: 'slug chahiye.' }, 400);
      await env.DB.prepare('DELETE FROM blog_posts WHERE slug = ?').bind(slug).run();
      return json({ ok: true, slug });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err).slice(0, 200) }, 500);
  }
}
