# Blog (Health Guides)

Blog site ka alag, self-contained section hai: `blog/index.html` (hub) + `blog/<slug>/index.html` (posts).
Blog pages sirf `renee-theme.css`, `blog/blog.css`, `cart.js` aur `auth.js` load karte hain — **checkout, cart,
product pages ya `app*.js` ko chhua nahi jata**, isliye blog ki wajah se main site break nahi hoti.

## Naya post 2 minute me

```bash
node scripts/new-blog-post.mjs \
  --slug=kamar-dard-ka-ayurvedic-ilaj \
  --title="Kamar Dard Ka Ayurvedic Ilaj: Kya Kaam Karta Hai" \
  --desc="140–160 characters ka meta description jo keyword ke saath reader ko click karne ki wajah de." \
  --cta=/pain-oil/ --image=/pain-oil/oil-1.png
```

Script ye 3 kaam karta hai:

1. `blog/<slug>/index.html` bana deta hai (template se, head/schema/OG pehle se sahi)
2. `blog/index.html` me card jod deta hai (`<!-- POSTS -->` marker ke neeche)
3. `sitemap.xml` me URL jod deta hai

Script chalane ke baad post file me sirf content bharna hota hai:

- `<h1>` ke baad `art-lead`, phir `#section-1`, `#section-2` ka content
- `.art-cta` block me product ka naam/price/offer
- `<details>` FAQ items + head me `FAQPage` schema (agar FAQ add karein)
- `Aage padhein` section me 2–3 related posts ke link

Naya post check karne ke liye:

```bash
npx wrangler pages dev . --port 8788   # http://127.0.0.1:8788/blog/
```

## Publishing checklist (ranking ke liye)

- [ ] Ek post = ek keyword. Title 50–60 chars, description 140–160 chars.
- [ ] Pehle 100 shabdon me keyword aur seedha jawab.
- [ ] Kam se kam 800–1,200 words, apne experience se likha hua (thin copy-paste nahi).
- [ ] 2–3 internal links: product page + 1–2 related blog posts.
- [ ] `blog/index.html` me card add (script khud karta hai).
- [ ] `sitemap.xml` entry (script khud karta hai).
- [ ] Medical claims nahi — "supplement, bimari ki dawa nahi" disclaimer har post me.
- [ ] Image ka `alt` text descriptive rakhein.

## Risk / impact (short)

| Cheez | Asar |
|---|---|
| Shared JS/CSS | Touch nahi hota — checkout/cart par zero risk |
| Page weight | Blog pages product pages se halke (koi app JS nahi) |
| SEO | Har post ka apna canonical, OG, Article + Breadcrumb schema, sitemap entry |
| Site speed | `/blog/blog.css` sirf blog pages par load hoti hai |
| Content risk | Thin/duplicate ya galat medical claims ranking gira sakte hain — isliye checklist follow karein |

## Files

- `blog/index.html` — hub (Guides) page
- `blog/blog.css` — blog-only styles
- `blog/_template.html` — scaffold template (script isi se post banata hai)
- `scripts/new-blog-post.mjs` — publish script
- `sitemap.xml` — blog URLs yahan register hote hain
