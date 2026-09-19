#!/usr/bin/env python3
"""
Build blog/index.html from whatever articles are in blog/*/index.html.

Runs at deploy time, before minification. Articles arrive in the repo via the
Hoox webhook (see worker/README.md), so the listing is derived from the files
rather than maintained by hand — nothing to keep in sync, and the Worker never
has to know the index exists.

Each article page carries its own metadata in <meta> tags (og:title,
description, og:image, article:published_time, article:tag); this reads those
rather than parsing the article body.

Usage: blog-index.py <site-root>      (the directory that contains blog/)
"""

import html
import sys
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


class MetaReader(HTMLParser):
    """Collect <meta> tags from <head>; stop at <body> so article HTML is never scanned."""

    def __init__(self):
        super().__init__()
        self.meta = {}
        self.tags = []
        self.done = False

    def handle_starttag(self, tag, attrs):
        if self.done:
            return
        if tag == "body":
            self.done = True
            return
        if tag != "meta":
            return
        a = dict(attrs)
        key = a.get("property") or a.get("name")
        content = a.get("content")
        if not key or content is None:
            return
        if key == "article:tag":
            self.tags.append(content)
        else:
            self.meta.setdefault(key, content)


def read_article(index_html: Path):
    p = MetaReader()
    p.feed(index_html.read_text(encoding="utf-8"))
    m = p.meta
    title = m.get("og:title") or ""
    if not title:
        return None  # not one of ours
    published = m.get("article:published_time") or ""
    try:
        when = datetime.fromisoformat(published.replace("Z", "+00:00"))
    except ValueError:
        when = datetime.fromtimestamp(index_html.stat().st_mtime, tz=timezone.utc)
    return {
        "slug": index_html.parent.name,
        "title": title,
        "description": m.get("description") or "",
        "image": m.get("og:image") or "",
        "when": when,
        "tags": p.tags,
    }


def hebrew_date(d: datetime) -> str:
    months = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
              "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
    return f"{d.day} ב{months[d.month - 1]} {d.year}"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def render_card(a) -> str:
    tags = "".join(f"<span>{esc(t)}</span>" for t in a["tags"][:3])
    image = (
        f'<img src="{esc(a["image"])}" alt="" loading="lazy">'
        if a["image"] and not a["image"].endswith("/og-image.png")
        else ""
    )
    return f"""
      <a class="card{' has-image' if image else ''}" href="/blog/{esc(a['slug'])}/">
        {image}
        <div class="card-body">
          <time datetime="{esc(a['when'].isoformat())}">{hebrew_date(a['when'])}</time>
          <h2>{esc(a['title'])}</h2>
          {f'<p>{esc(a["description"])}</p>' if a['description'] else ''}
          {f'<div class="tags">{tags}</div>' if tags else ''}
        </div>
      </a>"""


def render_index(articles) -> str:
    cards = "".join(render_card(a) for a in articles)
    count = len(articles)
    return f"""<!doctype html>
<html lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@700&family=Rubik:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="canonical" href="https://afias.dev/blog/">
<title>מאמרים | afias.dev</title>
<meta name="description" content="מדריכים ומאמרים על בניית אתרים לעסקים קטנים: מחירים, תהליך, ומה באמת משנה.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="afias.dev">
<meta property="og:locale" content="he_IL">
<meta property="og:url" content="https://afias.dev/blog/">
<meta property="og:title" content="מאמרים | afias.dev">
<meta property="og:description" content="מדריכים ומאמרים על בניית אתרים לעסקים קטנים.">
<meta property="og:image" content="https://afias.dev/og-image.png">
<meta name="twitter:card" content="summary_large_image">

<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-HZJD8EPHXJ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', 'G-HZJD8EPHXJ');
</script>
<!-- Microsoft Clarity -->
<script>
(function(c,l,a,r,i,t,y){{
  c[a]=c[a]||function(){{(c[a].q=c[a].q||[]).push(arguments)}};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
}})(window, document, "clarity", "script", "ycejr76xq8");
</script>

<style>
:root{{--paper:#FAF8F3;--ink:#1C1E24;--brass:#B8862B;--brass-light:#D7A53F;--line:#e5ddc9;--muted:rgba(28,30,36,.65);--muted-soft:rgba(28,30,36,.55)}}
*{{box-sizing:border-box}}
html,body{{margin:0;padding:0;background:var(--paper)}}
body{{font-family:'Rubik',system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}}
a{{color:inherit;text-decoration:none}}
.wrap{{max-width:900px;margin:0 auto;padding:0 24px}}
.site-header{{padding:28px 0 0}}
.wordmark{{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:26px;direction:ltr;display:inline-flex;align-items:baseline;gap:2px;color:var(--ink)}}
.wordmark span{{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:17px;color:var(--brass)}}
.hero{{padding:56px 0 8px}}
h1{{font-weight:500;font-size:clamp(34px,5.4vw,56px);line-height:1.14;letter-spacing:-.02em;margin:0}}
.sub{{font-size:clamp(17px,2vw,20px);line-height:1.6;color:var(--muted);margin:16px 0 0;max-width:52ch}}
.count{{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--brass);letter-spacing:.04em;margin:0 0 12px;display:block}}
.list{{display:grid;gap:18px;padding:44px 0 80px}}
.card{{display:grid;grid-template-columns:1fr;background:#fff;border:1px solid var(--line);border-radius:24px;overflow:hidden;transition:transform .35s cubic-bezier(.2,.8,.2,1),box-shadow .35s,border-color .35s}}
.card:hover{{transform:translateY(-6px);border-color:rgba(184,134,43,.55);box-shadow:0 24px 60px rgba(184,134,43,.16)}}
.card.has-image{{grid-template-columns:minmax(0,1fr) 220px}}
.card img{{width:100%;height:100%;object-fit:cover;display:block;grid-column:2;grid-row:1;border-inline-start:1px solid var(--line)}}
.card-body{{padding:26px 28px;grid-column:1;grid-row:1;min-width:0}}
.card time{{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--muted-soft);display:block;margin:0 0 10px}}
.card h2{{font-weight:700;font-size:clamp(20px,2.6vw,25px);line-height:1.25;letter-spacing:-.01em;margin:0 0 10px;text-wrap:balance}}
.card p{{margin:0;color:var(--muted);font-size:16px;line-height:1.62;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}}
.tags{{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0}}
.tags span{{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--brass);border:1px solid rgba(184,134,43,.45);border-radius:999px;padding:5px 11px}}
footer{{border-top:1px solid var(--line);padding:30px 0 44px;display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:center;font-size:14px;color:var(--muted-soft)}}
@media (max-width:640px){{
  .hero{{padding:40px 0 0}}
  .card.has-image{{grid-template-columns:1fr}}
  .card img{{grid-column:1;grid-row:1;height:180px;border-inline-start:0;border-bottom:1px solid var(--line)}}
  .card.has-image .card-body{{grid-row:2}}
}}
@media (prefers-reduced-motion:reduce){{*{{transition-duration:.001ms!important}}}}
</style>
</head>
<body>
<div dir="rtl">
  <header class="site-header"><div class="wrap"><a href="/" class="wordmark">afias<span>.dev</span></a></div></header>

  <main class="wrap">
    <section class="hero">
      <span class="count">{count} {'מאמר' if count == 1 else 'מאמרים'}</span>
      <h1>מאמרים</h1>
      <p class="sub">על בניית אתרים לעסקים קטנים: מה זה עולה, איך זה עובד, ומה באמת משנה. בלי הגזמות.</p>
    </section>

    <div class="list">{cards}
    </div>
  </main>

  <footer class="wrap">
    <a href="/" class="wordmark">afias<span>.dev</span></a>
    <span>© {datetime.now().year} אורי אפיאס</span>
  </footer>
</div>
</body>
</html>
"""


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: blog-index.py <site-root>")
    root = Path(sys.argv[1])
    blog = root / "blog"
    if not blog.is_dir():
        print("no blog/ directory, no index to build")
        return

    articles = []
    for page in sorted(blog.glob("*/index.html")):
        a = read_article(page)
        if a:
            articles.append(a)
        else:
            print(f"  skipped {page.parent.name}/ (no og:title — not an article page)")

    if not articles:
        print("blog/ exists but holds no articles, no index to build")
        return

    # Newest first. Ties broken by slug so the order is stable between builds.
    articles.sort(key=lambda a: (a["when"], a["slug"]), reverse=True)

    out = blog / "index.html"
    out.write_text(render_index(articles), encoding="utf-8")
    print(f"built blog/index.html with {len(articles)} article(s):")
    for a in articles:
        print(f"  {a['when'].date()}  {a['slug']}")


if __name__ == "__main__":
    main()
