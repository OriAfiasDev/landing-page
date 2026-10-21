/**
 * Renders one published article into a complete static page for
 * https://afias.dev/blog/<slug>/ — the same brand tokens, fonts and tracking
 * as the rest of the site, so an article reads as part of it rather than as a
 * bolted-on blog.
 *
 * Trust model: `content_html` and `json_ld` are injected verbatim (bar three
 * accessibility fixes: withoutTitleHeading, englishWatermark and
 * focusableTables, and three SEO fixes: withoutHooxCredit,
 * withSiteLinks and normalizeJsonLd). A slug listed in CONSOLIDATED renders
 * as a redirect stub instead (see there), and the webhook skips any slug in
 * LOCKED or CONSOLIDATED altogether (isLocked). That is what
 * the publishing service's contract asks for, and it is safe only because the
 * webhook has already verified the HMAC — the signature is what makes this
 * content trusted. Everything that lands in an attribute is escaped regardless.
 */

const SITE = 'https://afias.dev';
const PIXEL_ID = '1990961434890890';
const GA_ID = 'G-HZJD8EPHXJ';
const CLARITY_ID = 'ycejr76xq8';
const TRACK_ENDPOINT = 'https://afias-demo.afias.workers.dev/track';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO date -> "12 בספטמבר 2026". Falls back to the raw string if unparsable. */
function hebrewDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/**
 * The JSON-LD arrives as a string of <script type="application/ld+json">
 * blocks. It is injected verbatim per the contract; the only thing enforced is
 * that it cannot break out of <head> — a stray </head> or <body> inside it
 * would let the article body start early.
 */
function safeJsonLd(raw) {
  if (typeof raw !== 'string') return '';
  if (/<\/head\s*>|<body[\s>]/i.test(raw)) return '';
  return raw.trim();
}

const GITHUB_PROFILE = 'https://github.com/OriAfiasDev';

/**
 * Hoox writes the site URL as `https://Afias.dev`, puts `#fragment` ids
 * straight after the host and points mainEntityOfPage / the breadcrumb at
 * `/<raw slug>` — a page that doesn't exist, without /blog/ or the trailing
 * slash. Normalise every afias.dev URL to the lowercase host, and every
 * reference to this article to its canonical URL, so the structured data
 * names the same entities and the same page as the rest of the site.
 */
function siteUrl(value, slug, canonical) {
  const m = /^https?:\/\/(?:www\.)?afias\.dev(?=$|[/?#])(.*)$/i.exec(value);
  if (!m) return value;
  let rest = m[1];
  if (rest === '' || rest[0] === '#' || rest[0] === '?') rest = '/' + rest;
  let path = rest.replace(/[?#].*$/, '');
  try { path = decodeURIComponent(path); } catch { /* leave as is */ }
  path = path.normalize('NFC').replace(/\/+$/, '');
  if (path === `/${slug}` || path === `/blog/${slug}`) return canonical;
  return SITE + rest;
}

function normalizeNode(node, slug, canonical) {
  if (Array.isArray(node)) return node.map((n) => normalizeNode(n, slug, canonical));
  if (typeof node === 'string') return siteUrl(node, slug, canonical);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = normalizeNode(v, slug, canonical);

  const types = [].concat(out['@type'] || []);
  if (out.mainEntityOfPage && typeof out.mainEntityOfPage === 'object' && !Array.isArray(out.mainEntityOfPage)) {
    out.mainEntityOfPage = { ...out.mainEntityOfPage, '@id': canonical };
  } else if (typeof out.mainEntityOfPage === 'string') {
    out.mainEntityOfPage = canonical;
  }
  if (types.includes('Person') && out['@id'] === `${SITE}/#author`) {
    if (!out.url || out.url === `${SITE}/`) out.url = `${SITE}/about/`;  // the profile page
    const same = [].concat(out.sameAs || []);
    if (!same.includes(GITHUB_PROFILE)) same.push(GITHUB_PROFILE);
    out.sameAs = same;
  }
  // Home > article skips the listing the article actually sits under.
  if (types.includes('BreadcrumbList') && Array.isArray(out.itemListElement)) {
    const items = out.itemListElement;
    const blog = `${SITE}/blog/`;
    if (items.length && items[items.length - 1].item === canonical && !items.some((i) => i && i.item === blog)) {
      items.splice(items.length - 1, 0, { '@type': 'ListItem', position: 0, name: 'מאמרים', item: blog });
      items.forEach((i, n) => { if (i && typeof i === 'object') i.position = n + 1; });
    }
  }
  return out;
}

/**
 * Applied to each <script type="application/ld+json"> block. A block that
 * doesn't parse is passed through untouched — the contract says verbatim, and
 * a fix must never be the reason structured data disappears.
 */
export function normalizeJsonLd(raw, slug, canonical) {
  return raw.replace(/(<script\b[^>]*type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (all, open, body, close) => {
    let data;
    try { data = JSON.parse(body); } catch { return all; }
    const json = JSON.stringify(normalizeNode(data, slug, canonical), null, 2).replace(/</g, '\\u003c');
    return `${open}\n${json}\n${close}`;
  });
}

/**
 * Hoox opens every article body with the title as its own <h1>, and the page
 * already sets the title as the <h1> above the lede: two h1s, and a screen
 * reader announces the title twice. Drop the body's first <h1> and demote any
 * other, so the page keeps exactly one.
 */
function withoutTitleHeading(html) {
  return String(html || '')
    .replace(/<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, '')
    .replace(/<(\/?)h1\b/gi, '<$1h2');
}

/**
 * Some Hoox articles end with an English attribution line. Mark it as
 * English, so a screen reader set to Hebrew doesn't read it with Hebrew
 * rules. Its inline grey (3.3:1) is overridden in the page CSS.
 */
function englishWatermark(html) {
  return html.replace(/<p data-hoox-watermark="1"/g, '<p data-hoox-watermark="1" lang="en" dir="ltr"');
}

/**
 * Some Hoox articles end with an "Article created with love by hoox" credit
 * linking to tryhoox.com. It is an automated-content signal on our own pages
 * and an outbound link we didn't choose, so it is dropped.
 */
export function withoutHooxCredit(html) {
  return html.replace(/<p\b[^>]*\bdata-hoox-watermark\b[^>]*>[\s\S]*?<\/p>/gi, '');
}

/**
 * Hoox links article text to pages this site doesn't have (/features, /docs)
 * and to pages without their trailing slash (/pricing, /about, /blog, /demo —
 * a redirect or a 404 each). Point them at what does exist. Paths not listed
 * here are left alone.
 */
const SITE_LINKS = {
  '/pricing': '/pricing/',
  '/features': '/pricing/',  // the package cards are where "what you get" is listed
  '/about': '/about/',
  '/docs': '/blog/',         // "guides / technical docs" — the articles are the guides
  '/blog': '/blog/',
  '/demo': '/demo/',
  '/sitemap': '/sitemap.xml',
};

export function withSiteLinks(html) {
  return html.replace(/\bhref=(["'])(https?:\/\/(?:www\.)?afias\.dev(?=[/"'?#])|(?=\/(?!\/)))([^"'?#]*)([^"']*)\1/gi,
    (all, q, host, path, tail) => {
      const target = SITE_LINKS[(path || '/').toLowerCase().replace(/(.)\/+$/, '$1')]
        || consolidatedLink(path);
      if (!target) return all;
      // Keep Hoox's absolute form when it used one; a query/fragment of its own is dropped.
      return `href=${q}${host ? SITE : ''}${target}${q}`;
    });
}

/**
 * Articles merged into another one ("consolidated"): loser slug -> winner slug.
 *
 * Several Hoox articles answered the same search ("כמה עולה אתר") and competed
 * with each other. Each loser's page is replaced by a redirect stub pointing at
 * its winner. Hoox can deliver a loser again at any time (a retry, or a
 * re-publish after an edit), and the webhook overwrites blog/<slug>/index.html
 * with whatever renderArticlePage returns, so the stub has to come from here:
 * for a slug listed below renderArticlePage returns the stub, never the
 * article, and the redirect survives. Links to a loser in any article are
 * pointed straight at the winner (withSiteLinks).
 *
 * Keys and values are slugs as the webhook sees them (NFC, lower-case). A
 * winner must not itself be a key. To undo a merge, delete its line and
 * re-publish the article from Hoox.
 */
export const CONSOLIDATED = {
  // Cluster 3, sales / e-commerce site (2026-10-20). Kept above cluster 1 so
  // it merges cleanly next to cluster 2, which is appended below.
  'בניית-אתר-מסחר-שמוכר-מדריך-מקיף-לעסקים-קטנים-ב-2026': 'בניית-אתר-מכירות-באינטרנט-שהופך-מבקרים-ללקוחות',
  'איך-בונים-אתר-מכירות-לעסק-קטן-במהירות-המדריך-המלא': 'בניית-אתר-מכירות-באינטרנט-שהופך-מבקרים-ללקוחות',
  'בניית-אתר-איקומרס-שמוכר-המדריך-המלא-ל-2026': 'בניית-אתר-מכירות-באינטרנט-שהופך-מבקרים-ללקוחות',
  // Cluster 1, price / cost (2026-10-20)
  'כמה-עולה-לבנות-אתר-לעסק-קטן-ב-2026-מחירון-מלא-אפשרויות': 'כמה-עולה-לבנות-אתר-לעסק-קטן-ב-2026-המדריך-המלא-למחירים',
  'עלויות-הקמת-אתר-אינטרנט-ב-2026-המדריך-המלא-לבעלי-עסקים': 'כמה-עולה-לבנות-אתר-לעסק-קטן-ב-2026-המדריך-המלא-למחירים',
  'בניית-אתרים-מחירון-2026-מה-באמת-עולה-אתר-מקצועי-לעסק-קטן': 'כמה-עולה-לבנות-אתר-לעסק-קטן-ב-2026-המדריך-המלא-למחירים',
  'בניית-אתרי-אינטרנט-מחירים-מדריך-מעשי-ל-2026': 'כמה-עולה-לבנות-אתר-לעסק-קטן-ב-2026-המדריך-המלא-למחירים',
  // Cluster 2, business-card site / אתר תדמית (2026-10-20). The design post
  // (עיצוב-אתר-תדמית-…) stays separate for now, pending Search Console.
  'אתר-תדמית-לעסק-כך-תבנו-נוכחות-דיגיטלית-שמייצרת-לקוחות': 'בניית-אתר-תדמית-לעסקים-קטנים-ב-2026-המדריך-המקצועי',
  'איך-בונים-אתר-תדמית-לעסק-קטן-ב2026-מדריך-מעשי-ללא-התפשרות': 'בניית-אתר-תדמית-לעסקים-קטנים-ב-2026-המדריך-המקצועי',
  // Cluster 4, restaurants / בניית אתר למסעדה (2026-10-20)
  'בניית-אתרים-למסעדות-המדריך-המלא-לאתר-שממיר-מבקרים-ללקוחות': 'בניית-אתר-למסעדה-המדריך-המלא-לבעלי-עסקים-ב-2026',
  // Cluster 5, lawyers / בניית אתר לעורכי דין (2026-10-20)
  'בניית-אתרים-לעורכי-דין-מדריך-מקיף-להקמת-נוכחות-דיגיטלית-מנצחת': 'בניית-אתר-לעורכי-דין-כך-תקבלו-נוכחות-דיגיטלית-שמביאה-לקוחות',
  // Cluster 6, landing pages / בניית דף נחיתה (2026-10-20)
  'בניית-עמודי-נחיתה-המדריך-המלא-לעסקים-קטנים-ב-2026': 'בניית-דף-נחיתה-שממיר-מדריך-2026-לעסקים-קטנים',
  // Cluster 7, AI / בניית אתרים AI (2026-10-20)
  'ai-website-builder-לעסקים-קטנים-המדריך-המלא-ל-2026': 'בניית-אתרים-ai-המדריך-המקצועי-לבעלי-עסקים-קטנים',
  // Cluster 8, business-card vs sales site / תדמית מול מכירות (2026-10-20)
  'מה-ההבדל-בין-אתר-תדמית-לאתר-מכירות-מדריך-מקצועי-לבעלי-עסקים': 'מה-ההבדל-בין-אתר-תדמית-לאתר-מכירות-לעסק-המדריך-המלא',
  // Cluster 9, general posts / כלליים (2026-10-20)
  'איך-בונים-אתר-מקצועי-לעסק-קטן-במהירות-ב-2026': 'בניית-אתרים-לעסקים-קטנים-תוך-24-שעות-בלי-מנויים-ובלי-הפתעות',
};

/** The visible link text on a stub. A winner missing here falls back to its slug. */
const WINNER_TITLES = {
  'בניית-אתר-מכירות-באינטרנט-שהופך-מבקרים-ללקוחות': 'בניית אתר מכירות באינטרנט שהופך מבקרים ללקוחות',
  'כמה-עולה-לבנות-אתר-לעסק-קטן-ב-2026-המדריך-המלא-למחירים': 'בניית אתרים מחירון 2026: כמה עולה אתר לעסק קטן?',
  'בניית-אתר-תדמית-לעסקים-קטנים-ב-2026-המדריך-המקצועי': 'בניית אתר תדמית לעסקים קטנים ב-2026 – המדריך המקצועי',
  'בניית-אתר-למסעדה-המדריך-המלא-לבעלי-עסקים-ב-2026': 'בניית אתרים למסעדות: המדריך להקמת אתר למסעדה ב-2026',
  'בניית-אתר-לעורכי-דין-כך-תקבלו-נוכחות-דיגיטלית-שמביאה-לקוחות': 'בניית אתר לעורכי דין: כך תקבלו נוכחות דיגיטלית שמביאה לקוחות',
  'בניית-דף-נחיתה-שממיר-מדריך-2026-לעסקים-קטנים': 'בניית דף נחיתה שממיר: מדריך 2026 לעסקים קטנים',
  'בניית-אתרים-ai-המדריך-המקצועי-לבעלי-עסקים-קטנים': 'בניית אתרים AI – המדריך המקצועי לבעלי עסקים קטנים',
  'מה-ההבדל-בין-אתר-תדמית-לאתר-מכירות-לעסק-המדריך-המלא': 'מה ההבדל בין אתר תדמית לאתר מכירות לעסק? המדריך המלא',
  'בניית-אתרים-לעסקים-קטנים-תוך-24-שעות-בלי-מנויים-ובלי-הפתעות': 'איך בונים אתר לעסק קטן: דמו תוך יום-יומיים, בלי מנויים ובלי הפתעות',
};

function consolidatedWinner(slug) {
  return CONSOLIDATED[String(slug ?? '').normalize('NFC').toLowerCase()];
}

/**
 * Articles whose committed file in the repo is the source of truth (LOCKED):
 * a Hoox delivery for one of these slugs is acknowledged and never written,
 * so a retry or a re-publish can't overwrite the hand edits made in the repo
 * (merged sections, corrected prices and FAQs, sourced statistics). Every
 * consolidated loser in CONSOLIDATED is locked as well, so its committed stub
 * stays as it is (isLocked covers both). Any slug not listed publishes as before.
 *
 * Same key form as CONSOLIDATED (NFC, lower-case). To let Hoox own an article
 * again, delete its line and re-publish it from Hoox.
 */
export const LOCKED = new Set([
  // Every live (non-stub) post in blog/, all hand-edited in the repo (2026-10-20)
  'איך-בוחרים-חברה-לבניית-אתר-לעסק-קטן-ב-2026',
  'אפיון-אתר-לעסקים-קטנים-המדריך-המלא-ל-2026',
  'בניית-אתר-למסעדה-המדריך-המלא-לבעלי-עסקים-ב-2026',
  'בניית-אתר-לעורכי-דין-כך-תקבלו-נוכחות-דיגיטלית-שמביאה-לקוחות',
  'בניית-אתר-מכירות-באינטרנט-שהופך-מבקרים-ללקוחות',
  'בניית-אתר-רספונסיבי-שמייצר-לידים-בלי-להסתמך-על-מנוי',
  'בניית-אתר-תדמית-לעסקים-קטנים-ב-2026-המדריך-המקצועי',
  'בניית-אתרים-ai-המדריך-המקצועי-לבעלי-עסקים-קטנים',
  'בניית-אתרים-לעסקים-קטנים-תוך-24-שעות-בלי-מנויים-ובלי-הפתעות',
  'בניית-דף-נחיתה-שממיר-מדריך-2026-לעסקים-קטנים',
  'כמה-עולה-לבנות-אתר-לעסק-קטן-ב-2026-המדריך-המלא-למחירים',
  'מה-ההבדל-בין-אתר-תדמית-לאתר-מכירות-לעסק-המדריך-המלא',
  'מה-ההבדל-בין-אתר-תדמית-לדף-נחיתה-לעסק-המדריך-ל-2026',
  'עיצוב-אתר-תדמית-לעסקים-קטנים-ב2026-מדריך-מקצועי',
]);

/** True when the webhook must not write blog/<slug>/index.html (see LOCKED). */
export function isLocked(slug) {
  const key = String(slug ?? '').normalize('NFC').toLowerCase();
  return LOCKED.has(key) || Object.prototype.hasOwnProperty.call(CONSOLIDATED, key);
}


/** '/blog/<loser>/' (raw Hebrew or percent-encoded) -> '/blog/<winner>/'. */
function consolidatedLink(path) {
  const m = /^\/blog\/([^/]+)\/?$/.exec(path || '');
  if (!m) return undefined;
  let slug;
  try { slug = decodeURIComponent(m[1]); } catch { return undefined; }
  const winner = consolidatedWinner(slug);
  return winner ? `/blog/${encodeURIComponent(winner)}/` : undefined;
}

/**
 * The page a consolidated slug gets instead of its article: an immediate
 * meta refresh (which Google treats as a permanent redirect), canonical to the
 * winner and noindex as belt and braces, location.replace for a browser that
 * ignores the refresh, and a plain link for anyone it doesn't reach.
 *
 * Deliberately no og:title: the blog index and the sitemap step in deploy.yml
 * both skip a page without one, so a stub is never listed.
 */
export function renderRedirectStub(a, winnerSlug) {
  const to = `${SITE}/blog/${encodeURIComponent(winnerSlug)}/`;
  const label = escapeHtml(WINNER_TITLES[winnerSlug] || winnerSlug.replace(/-/g, ' '));
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>המאמר עבר: ${label} | afias.dev</title>
<link rel="canonical" href="${to}">
<meta name="robots" content="noindex,follow">
<meta http-equiv="refresh" content="0; url=${to}">
<!-- hoox:id=${escapeHtml(a.id)} -->
<!-- consolidated into ${to} -->
<script>location.replace(${JSON.stringify(to)} + location.hash);</script>
<style>
  body { margin: 0; font-family: Rubik, Arial, sans-serif; background: #faf8f3; color: #1c1e24; line-height: 1.6; }
  main { max-width: 40rem; margin: 0 auto; padding: 4rem 1.25rem; }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  a { color: #1c1e24; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
  a:focus-visible { outline: 3px solid #1c1e24; outline-offset: 3px; }
</style>
</head>
<body>
<main>
<h1>המאמר הזה עבר לכתובת חדשה</h1>
<p>התוכן שלו אוחד עם המדריך המלא. אם לא הועברתם אוטומטית:</p>
<p><a href="${to}">${label}</a></p>
</main>
</body>
</html>
`;
}

/**
 * Article tables scroll sideways when they are wider than the column (most
 * of them on a phone or at 200% zoom). A scroll area has to take focus for
 * the keyboard to scroll it, and Safari won't make it focusable by itself.
 */
function focusableTables(html) {
  return html.replace(/<table\b(?![^>]*\btabindex=)/gi, '<table tabindex="0"');
}

export function renderArticlePage(a) {
  const winner = consolidatedWinner(a.slug);
  if (winner) return renderRedirectStub(a, winner);  // merged: keep the redirect, not the article

  const title = escapeHtml(a.title);
  const description = escapeHtml(a.meta_description);
  // Percent-encoded: the slug may be Hebrew, and the canonical/og URLs
  // should be plain ASCII. Encoding also leaves nothing to HTML-escape.
  const url = `${SITE}/blog/${encodeURIComponent(a.slug)}/`;
  const image = a.featured_image_url ? escapeHtml(a.featured_image_url) : `${SITE}/og-image.png`;
  const author = escapeHtml(a.author || 'אורי אפיאס');
  const publishedIso = a.published_at || new Date().toISOString();
  const tags = Array.isArray(a.tags) ? a.tags.filter((t) => typeof t === 'string') : [];

  const tagsHtml = tags.length
    ? `<div class="tags">${tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@700&family=Rubik:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="canonical" href="${url}">
<title>${title} | afias.dev</title>
<meta name="description" content="${description}">
<!-- hoox:id=${escapeHtml(a.id)} -->

<meta property="og:type" content="article">
<meta property="og:site_name" content="afias.dev">
<meta property="og:locale" content="he_IL">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${image}">
<meta property="article:published_time" content="${escapeHtml(publishedIso)}">
<meta property="article:author" content="${author}">
${tags.map((t) => `<meta property="article:tag" content="${escapeHtml(t)}">`).join('\n')}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">

${normalizeJsonLd(safeJsonLd(a.json_ld), String(a.slug ?? '').normalize('NFC'), url)}

<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${GA_ID}');
</script>

<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');

/* Same Pixel + Conversions API helper as the rest of the site, so blog
   PageViews are deduplicated and measured the same way. */
window.afiasTrack = (function(){
  function newId(){
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function cookie(name){
    var m = document.cookie.match('(^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[2]) : '';
  }
  return function(name, opts){
    opts = opts || {};
    var id = newId();
    if (typeof fbq === 'function') {
      fbq(opts.custom ? 'trackCustom' : 'track', name, opts.custom_data || {}, { eventID: id });
    }
    var user = {};
    var fbp = cookie('_fbp'); if (fbp) user.fbp = fbp;
    var fbc = cookie('_fbc'); if (fbc) user.fbc = fbc;
    try {
      fetch('${TRACK_ENDPOINT}', {
        method: 'POST', mode: 'cors', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_name: name, event_id: id, event_source_url: location.href, user_data: user, custom_data: opts.custom_data || {} })
      })['catch'](function(){});
    } catch (e) {}
    return id;
  };
})();
afiasTrack('PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1"></noscript>

<!-- Microsoft Clarity -->
<script>
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${CLARITY_ID}");
</script>

<style>
:root{--paper:#FAF8F3;--ink:#1C1E24;--brass:#B8862B;--brass-light:#D7A53F;--brass-deep:#8A6420;--line:#e5ddc9;--muted:rgba(28,30,36,.65);--muted-soft:rgba(28,30,36,.65)}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--paper)}
body{font-family:'Rubik',system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
a{color:var(--brass-deep);text-decoration:none}a:hover{color:var(--ink)}
.wrap{max-width:760px;margin:0 auto;padding:0 24px}
.site-header{padding:28px 0 0}
.wordmark{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:26px;direction:ltr;display:inline-flex;align-items:baseline;gap:2px;color:var(--ink)}
.wordmark span{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:17px;color:var(--brass-deep)}
article{padding:56px 0 80px}
.meta{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--muted-soft);letter-spacing:.02em;display:flex;flex-wrap:wrap;gap:14px;margin:0 0 18px}
.meta .back{color:var(--brass-deep)}.meta .back::before{content:"→ "}
h1{font-weight:500;font-size:clamp(32px,5vw,52px);line-height:1.16;letter-spacing:-.02em;margin:0 0 22px;text-wrap:balance}
.lede{font-size:clamp(18px,2.1vw,21px);line-height:1.62;color:var(--muted);margin:0 0 34px;text-wrap:pretty}
.hero-image{width:100%;height:auto;border-radius:24px;border:1px solid var(--line);margin:0 0 40px;display:block}
.body{font-size:18px;line-height:1.75}
.body h2{font-weight:900;font-size:clamp(24px,3.2vw,32px);letter-spacing:-.02em;line-height:1.18;margin:48px 0 14px}
.body h3{font-weight:700;font-size:clamp(20px,2.4vw,24px);letter-spacing:-.01em;margin:36px 0 10px}
.body p{margin:0 0 22px}
.body a{text-decoration:underline;text-decoration-color:rgba(184,134,43,.5);text-underline-offset:3px}
.body [data-hoox-watermark],.body [data-hoox-watermark] a{color:var(--muted-soft) !important}
.body ul,.body ol{padding-inline-start:26px;margin:0 0 22px}
.body li{margin:0 0 8px}
.body img{max-width:100%;height:auto;border-radius:16px;border:1px solid var(--line)}
.body blockquote{margin:28px 0;padding:18px 24px;border-inline-start:3px solid var(--brass);background:#fff;border-radius:0 16px 16px 0;color:var(--muted)}
.body table{width:100%;border-collapse:collapse;margin:0 0 22px;display:block;overflow-x:auto}
.body table:focus-visible{outline:3px solid var(--brass-deep);outline-offset:2px}
.body th,.body td{border:1px solid var(--line);padding:10px 14px;text-align:start}
.body th{background:#fff;font-weight:700}
.body code{font-family:'JetBrains Mono',monospace;font-size:.92em;background:#fff;border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.body pre{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;overflow-x:auto;direction:ltr;text-align:left}
.body pre code{border:0;padding:0;background:none}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:44px 0 0}
.tags span{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--brass-deep);border:1px solid rgba(184,134,43,.45);border-radius:999px;padding:6px 12px}
.cta{margin:64px 0 0;padding:32px;background:#fff;border:1px solid var(--line);border-radius:24px;text-align:center}
.cta h2{font-weight:900;font-size:clamp(22px,3vw,28px);letter-spacing:-.02em;margin:0 0 10px}
.cta p{color:var(--muted);font-size:17px;line-height:1.6;margin:0 0 22px}
.btn{display:inline-block;font-weight:700;font-size:16px;color:var(--ink);background:var(--brass);padding:15px 30px;border-radius:999px;box-shadow:0 8px 24px rgba(184,134,43,.22);transition:transform .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s}
.btn:hover{transform:translateY(-3px);box-shadow:0 16px 32px rgba(184,134,43,.35);color:var(--ink)}
footer{border-top:1px solid var(--line);padding:30px 0 44px;display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:center;font-size:14px;color:var(--muted-soft)}
@media (max-width:640px){article{padding:40px 0 60px}.body{font-size:17px}}
/* Skip link (WCAG 2.4.1): off-screen until it takes keyboard focus. */
.skip-link{position:fixed;top:12px;inset-inline-start:12px;z-index:1000;padding:12px 20px;border-radius:999px;background:#1C1E24;color:#FAF8F3;font-family:'Rubik',system-ui,sans-serif;font-weight:700;font-size:15px;line-height:1.2;text-decoration:none;transform:translateY(-200%)}
.skip-link:focus{transform:none;color:#FAF8F3;outline:3px solid #8A6420;outline-offset:2px}
main:focus{outline:none}
</style>
</head>
<body>
<a class="skip-link" href="#main">דילוג לתוכן הראשי</a>
<div dir="rtl">
  <header class="site-header"><div class="wrap"><a href="/" class="wordmark" style="color:inherit;">afias<span>.dev</span></a></div></header>

  <main id="main" tabindex="-1" class="wrap">
    <article>
      <div class="meta">
        <a href="/blog/" class="back">כל המאמרים</a>
        <time datetime="${escapeHtml(publishedIso)}">${hebrewDate(publishedIso)}</time>
        <span>${author}</span>
      </div>
      <h1>${title}</h1>
      ${a.meta_description ? `<p class="lede">${description}</p>` : ''}
      ${a.featured_image_url ? `<img class="hero-image" src="${image}" alt="${title}" loading="eager" fetchpriority="high">` : ''}
      <div class="body">
${focusableTables(englishWatermark(withSiteLinks(withoutHooxCredit(withoutTitleHeading(a.content_html)))))}
      </div>
      ${tagsHtml}

      <section class="cta">
        <h2>רוצים לראות איך זה נראה אצלכם?</h2>
        <p>נבנה לכם דמו אמיתי של האתר, בחינם ובלי התחייבות. קישור תוך יום-יומיים.</p>
        <a class="btn" href="/demo/">קבלו דמו בחינם</a>
      </section>
    </article>
  </main>

  <footer class="wrap">
    <a href="/" class="wordmark" style="color:inherit;">afias<span>.dev</span></a>
    <span>© ${new Date().getFullYear()} אורי אפיאס</span>
  </footer>
</div>
</body>
</html>
`;
}
