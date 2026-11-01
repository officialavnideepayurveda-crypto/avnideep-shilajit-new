/**
 * /blog/ — static hub ko serve karta hai aur usme D1 ke published posts ke
 * cards jod deta hai (<!-- POSTS --> marker ke neeche).
 *
 * Kuch bhi fail ho to static page jaisa hai waisa hi chala jata hai, isliye
 * blog hub kabhi D1 ki wajah se break nahi hoga.
 */

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export async function onRequestGet(context) {
  const { env, next } = context;
  const response = await next();
  if (!env.DB || !response.ok) return response;
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  let posts = [];
  try {
    const { results } = await env.DB
      .prepare("SELECT slug, title, description FROM blog_posts WHERE status = 'published' ORDER BY COALESCE(published_at, updated_at) DESC LIMIT 30")
      .all();
    posts = results || [];
  } catch (e) {
    return response;
  }
  if (!posts.length) return response;

  const html = await response.text();
  if (!html.includes('<!-- POSTS -->')) return new Response(html, response);

  const cards = posts
    .map(
      (p) => `<article class="blog-item">
<h2><a href="/blog/${esc(p.slug)}/">${esc(p.title)}</a></h2>
<p>${esc(p.description)}</p>
<a class="more" href="/blog/${esc(p.slug)}/">Guide padhein &rarr;</a>
</article>`
    )
    .join('\n');

  const merged = html.replace('<!-- POSTS -->', cards + '\n<!-- POSTS -->');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, must-revalidate');
  return new Response(merged, { status: response.status, headers });
}
