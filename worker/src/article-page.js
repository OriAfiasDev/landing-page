/**
 * Renders one published article into a complete static page for
 * https://afias.dev/blog/<slug>/ — the same brand tokens, fonts and tracking
 * as the rest of the site, so an article reads as part of it rather than as a
 * bolted-on blog.
 *
 * Trust model: `content_html` and `json_ld` are injected verbatim. That is what
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

export function renderArticlePage(a) {
  const title = escapeHtml(a.title);
  const description = escapeHtml(a.meta_description);
  const slug = escapeHtml(a.slug);
  const url = `${SITE}/blog/${slug}/`;
  const image = a.featured_image_url ? escapeHtml(a.featured_image_url) : `${SITE}/og-image.png`;
  const author = escapeHtml(a.author || 'אורי אפיאס');
  const publishedIso = a.published_at || new Date().toISOString();
  const tags = Array.isArray(a.tags) ? a.tags.filter((t) => typeof t === 'string') : [];

  const tagsHtml = tags.length
    ? `<div class="tags">${tags.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="he">
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

${safeJsonLd(a.json_ld)}

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
:root{--paper:#FAF8F3;--ink:#1C1E24;--brass:#B8862B;--brass-light:#D7A53F;--line:#e5ddc9;--muted:rgba(28,30,36,.65);--muted-soft:rgba(28,30,36,.55)}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--paper)}
body{font-family:'Rubik',system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
a{color:var(--brass);text-decoration:none}a:hover{color:var(--brass-light)}
.wrap{max-width:760px;margin:0 auto;padding:0 24px}
.site-header{padding:28px 0 0}
.wordmark{font-family:'Frank Ruhl Libre',serif;font-weight:700;font-size:26px;direction:ltr;display:inline-flex;align-items:baseline;gap:2px;color:var(--ink)}
.wordmark span{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:17px;color:var(--brass)}
article{padding:56px 0 80px}
.meta{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--muted-soft);letter-spacing:.02em;display:flex;flex-wrap:wrap;gap:14px;margin:0 0 18px}
.meta .back{color:var(--brass)}.meta .back::before{content:"→ "}
h1{font-weight:500;font-size:clamp(32px,5vw,52px);line-height:1.16;letter-spacing:-.02em;margin:0 0 22px;text-wrap:balance}
.lede{font-size:clamp(18px,2.1vw,21px);line-height:1.62;color:var(--muted);margin:0 0 34px;text-wrap:pretty}
.hero-image{width:100%;height:auto;border-radius:24px;border:1px solid var(--line);margin:0 0 40px;display:block}
.body{font-size:18px;line-height:1.75}
.body h2{font-weight:900;font-size:clamp(24px,3.2vw,32px);letter-spacing:-.02em;line-height:1.18;margin:48px 0 14px}
.body h3{font-weight:700;font-size:clamp(20px,2.4vw,24px);letter-spacing:-.01em;margin:36px 0 10px}
.body p{margin:0 0 22px}
.body ul,.body ol{padding-inline-start:26px;margin:0 0 22px}
.body li{margin:0 0 8px}
.body img{max-width:100%;height:auto;border-radius:16px;border:1px solid var(--line)}
.body blockquote{margin:28px 0;padding:18px 24px;border-inline-start:3px solid var(--brass);background:#fff;border-radius:0 16px 16px 0;color:var(--muted)}
.body table{width:100%;border-collapse:collapse;margin:0 0 22px;display:block;overflow-x:auto}
.body th,.body td{border:1px solid var(--line);padding:10px 14px;text-align:start}
.body th{background:#fff;font-weight:700}
.body code{font-family:'JetBrains Mono',monospace;font-size:.92em;background:#fff;border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.body pre{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px;overflow-x:auto;direction:ltr;text-align:left}
.body pre code{border:0;padding:0;background:none}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:44px 0 0}
.tags span{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--brass);border:1px solid rgba(184,134,43,.45);border-radius:999px;padding:6px 12px}
.cta{margin:64px 0 0;padding:32px;background:#fff;border:1px solid var(--line);border-radius:24px;text-align:center}
.cta h2{font-weight:900;font-size:clamp(22px,3vw,28px);letter-spacing:-.02em;margin:0 0 10px}
.cta p{color:var(--muted);font-size:17px;line-height:1.6;margin:0 0 22px}
.btn{display:inline-block;font-weight:700;font-size:16px;color:#3A2C0F;background:var(--brass);padding:15px 30px;border-radius:999px;box-shadow:0 8px 24px rgba(184,134,43,.22);transition:transform .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s}
.btn:hover{transform:translateY(-3px);box-shadow:0 16px 32px rgba(184,134,43,.35);color:#3A2C0F}
footer{border-top:1px solid var(--line);padding:30px 0 44px;display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:center;font-size:14px;color:var(--muted-soft)}
@media (max-width:640px){article{padding:40px 0 60px}.body{font-size:17px}}
</style>
</head>
<body>
<div dir="rtl">
  <header class="site-header"><div class="wrap"><a href="/" class="wordmark" style="color:inherit;">afias<span>.dev</span></a></div></header>

  <main class="wrap">
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
${a.content_html || ''}
      </div>
      ${tagsHtml}

      <aside class="cta">
        <h2>רוצים לראות איך זה נראה אצלכם?</h2>
        <p>נבנה לכם דמו אמיתי של האתר, בחינם ובלי התחייבות. קישור תוך יום-יומיים.</p>
        <a class="btn" href="/demo/">קבלו דמו בחינם</a>
      </aside>
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
