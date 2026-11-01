-- Blog posts published from the admin panel (/admin/blog).
-- Static posts that ship as HTML files keep working; these rows render
-- through functions/blog/[slug].js using the same public template.
CREATE TABLE IF NOT EXISTS blog_posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  hero_image   TEXT,
  hero_alt     TEXT,
  body_html    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft', -- draft | published
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status
  ON blog_posts (status, published_at DESC);
