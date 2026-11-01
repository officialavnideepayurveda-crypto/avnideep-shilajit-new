/**
 * /sitemap.xml — static sitemap + D1 me publish hue blog posts ke URLs.
 * D1 fail ho to static sitemap hi chala jata hai (search engines ke liye safe).
 */
export async function onRequestGet(context) {
  const { env, next } = context;
  const response = await next();
  if (!env.DB || !response.ok) return response;

  let posts = [];
  try {
    const { results } = await env.DB
      .prepare("SELECT slug, COALESCE(published_at, updated_at) AS lastmod FROM blog_posts WHERE status = 'published' ORDER BY lastmod DESC LIMIT 100")
      .all();
    posts = results || [];
  } catch (e) {
    return response;
  }
  if (!posts.length) return response;

  const xml = await response.text();
  if (!xml.includes('</urlset>')) return new Response(xml, response);

  const entries = posts
    .map(
      (p) => `  <url>
    <loc>https://avnideepayurveda.in/blog/${p.slug}/</loc>
    <lastmod>${String(p.lastmod || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`
    )
    .join('\n');

  const merged = xml.replace('</urlset>', entries + '\n</urlset>');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('Content-Type', 'application/xml; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, must-revalidate');
  return new Response(merged, { status: response.status, headers });
}
