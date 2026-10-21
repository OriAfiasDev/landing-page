/* afias.dev consent manager (one file for every page).
 *
 * Nothing that isn't strictly necessary loads before the visitor chooses:
 *   statistics -> Google Analytics 4 + Microsoft Clarity
 *   marketing  -> Meta Pixel + the worker's /track (Meta Conversions API)
 * Necessary (always on): storing this choice in localStorage, and the demo
 * form, which posts to the worker -> Linear and never depends on this file.
 *
 * The choice is kept in localStorage under "afias-consent" with a version and
 * a timestamp; it is asked again after 12 months or when VERSION changes.
 * Any <button data-consent-open> (the footer "הגדרות עוגיות" link) reopens it.
 *
 * Per page: <script src="/consent.js?v=1" defer data-stats="off"
 * data-marketing="off"> switches a category off for pages that never had it.
 *
 * Also here: click-to-load YouTube. Article pages ship <a class="yt-facade">
 * links instead of iframes; on click the video is embedded from
 * youtube-nocookie.com, so nothing from YouTube loads until then. */
(function () {
  'use strict';
  var VERSION = 1;
  var KEY = 'afias-consent';
  var MAX_AGE = 365 * 24 * 60 * 60 * 1000;
  var GA_ID = 'G-HZJD8EPHXJ';
  var PIXEL_ID = '1990961434890890';
  var CLARITY_ID = 'ycejr76xq8';
  var TRACK_ENDPOINT = 'https://afias-demo.afias.workers.dev/track';

  var me = document.currentScript || {};
  var ds = me.dataset || {};
  var pageStats = ds.stats !== 'off';
  var pageMarketing = ds.marketing !== 'off';

  /* ---------- stored choice ---------- */
  function read() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && c.v === VERSION && typeof c.ts === 'number' && Date.now() - c.ts < MAX_AGE) return c;
    } catch (e) {}
    return null;
  }
  function write(stats, marketing) {
    var c = { v: VERSION, ts: Date.now(), stats: !!stats, marketing: !!marketing };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    return c;
  }
  var consent = read();

  /* ---------- Google tag: Consent Mode v2, everything denied by default.
     gtag.js itself is only fetched once statistics are accepted. ---------- */
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { dataLayer.push(arguments); };
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied', wait_for_update: 500
  });

  /* ---------- deferred script loading (after load/idle or first input) ---------- */
  var later = [], started = false;
  function inject(src) {
    var t = document.createElement('script'); t.async = true; t.src = src;
    document.head.appendChild(t);
  }
  function startLater() {
    if (started) return; started = true;
    later.forEach(inject); later = null;
  }
  function loadLater(src, now) { if (started || now) inject(src); else later.push(src); }
  (function () {
    function idle() { (window.requestIdleCallback || function (f) { setTimeout(f, 1); })(startLater, { timeout: 2000 }); }
    if (document.readyState === 'complete') idle(); else addEventListener('load', idle);
    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(function (e) {
      addEventListener(e, startLater, { capture: true, passive: true, once: true });
    });
  })();

  var loaded = { stats: false, marketing: false };
  function loadStats(now) {
    if (loaded.stats || !pageStats) return; loaded.stats = true;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('config', GA_ID);
    loadLater('https://www.googletagmanager.com/gtag/js?id=' + GA_ID, now);
    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    loadLater('https://www.clarity.ms/tag/' + CLARITY_ID, now);
  }
  function loadMarketing(now) {
    if (loaded.marketing || !pageMarketing) return; loaded.marketing = true;
    gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
    /* Meta Pixel base code, with the script fetch deferred like the others. */
    !function (f, b, e, v, n) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; loadLater(v, now);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', PIXEL_ID);
  }

  /* ---------- Pixel + Conversions API (same request as before; only sent
     with marketing consent). Both legs carry the same event_id so Meta
     pairs them and counts one conversion. ---------- */
  function newId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function cookie(name) {
    var m = document.cookie.match('(^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[2]) : '';
  }
  function send(name, opts) {
    opts = opts || {};
    var id = newId();
    if (typeof fbq === 'function') {
      fbq(opts.custom ? 'trackCustom' : 'track', name, opts.custom_data || {}, { eventID: id });
    }
    var user = {};
    var given = opts.user_data || {};
    for (var k in given) if (given[k]) user[k] = given[k];
    var fbp = cookie('_fbp'); if (fbp) user.fbp = fbp;
    var fbc = cookie('_fbc'); if (fbc) user.fbc = fbc;
    // Fire and forget: keepalive outlives a navigation, a failure never blocks.
    try {
      fetch(TRACK_ENDPOINT, {
        method: 'POST', mode: 'cors', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: name, event_id: id, event_source_url: location.href,
          user_data: user, custom_data: opts.custom_data || {}
        })
      })['catch'](function () {});
    } catch (e) {}
    return id;
  }
  /* Undecided: hold events (never ones carrying personal data) until the
     visitor chooses; send them on "accept", drop them on "reject". */
  var pending = [];
  function track(name, opts) {
    if (!pageMarketing) return;
    if (consent) { if (consent.marketing) return send(name, opts); return; }
    if (!(opts && opts.user_data)) pending.push([name, opts]);
  }
  var early = window.afiasTrackQ || [];
  window.afiasTrack = track;
  window.afiasTrackQ = { push: function (a) { track(a[0], a[1]); } };

  function apply(now) {
    if (!consent) return;
    if (consent.stats) loadStats(now);
    if (consent.marketing) loadMarketing(now);
    var q = pending; pending = [];
    if (consent.marketing) q.forEach(function (a) { send(a[0], a[1]); });
  }

  /* ---------- withdrawing: clear what the tags left behind, then reload ---------- */
  var TRACKING_COOKIE = /^(_ga|_ga_.+|_gid|_gat.*|_gcl_.+|_fbp|_fbc|_clck|_clsk)$/;
  function clearTracking() {
    var host = location.hostname, parts = host.split('.');
    var domains = ['', host, '.' + host];
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!TRACKING_COOKIE.test(name)) return;
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
    ['lastExternalReferrer', 'lastExternalReferrerTime', '_clck', '_clsk'].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    try { sessionStorage.removeItem('_cltk'); } catch (e) {}
  }

  /* ---------- the banner ---------- */
  var CSS =
    '.afc{position:fixed;z-index:900;bottom:calc(12px + env(safe-area-inset-bottom,0px));inset-inline-start:12px;inset-inline-end:12px;' +
    'max-width:560px;max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;padding:20px 22px;border-radius:18px;' +
    'background:#FAF8F3;color:#1C1E24;border:1px solid #e5ddc9;border-top:3px solid #B8862B;box-shadow:0 18px 50px rgba(28,30,36,.22);' +
    "font-family:'Rubik',system-ui,sans-serif;font-size:15px;line-height:1.55;text-align:start}" +
    '@media (min-width:700px){.afc{inset-inline-end:auto;bottom:20px;inset-inline-start:20px}}' +
    '@media (prefers-reduced-motion:no-preference){.afc{animation:afcIn .35s cubic-bezier(.2,.8,.2,1)}@keyframes afcIn{from{transform:translateY(14px);opacity:0}}}' +
    '.afc[hidden]{display:none}' +
    '.afc-title{margin:0 0 6px;font-size:17px;font-weight:700;line-height:1.3;color:#1C1E24}.afc-title:focus{outline:none}' +
    '.afc-text{margin:0 0 14px;color:#1C1E24}.afc-text a{color:#6F4F14;text-decoration:underline;text-underline-offset:3px}.afc-text a:hover{color:#1C1E24}.afc-text a:focus-visible{outline:3px solid #8A6420;outline-offset:2px;border-radius:3px}' +
    '.afc-prefs{margin:0 0 14px;padding:0;border:0}.afc-prefs[hidden]{display:none}' +
    '.afc-prefs legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}' +
    '.afc-cat{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid #e5ddc9}' +
    '.afc-cat input{flex:none;width:20px;height:20px;margin:2px 0 0;accent-color:#8A6420}' +
    '.afc-cat input:focus-visible{outline:3px solid #8A6420;outline-offset:2px}' +
    '.afc-cat label{cursor:pointer}.afc-cat input:disabled+label{cursor:default}' +
    '.afc-actions{display:flex;flex-wrap:wrap;gap:8px}' +
    '.afc-btn{flex:1 1 auto;min-height:44px;padding:10px 18px;border-radius:999px;border:2px solid #B8862B;background:#B8862B;color:#1C1E24;' +
    "font:inherit;font-weight:700;font-size:15px;line-height:1.2;cursor:pointer}" +
    '.afc-btn:hover{background:#D7A53F;border-color:#D7A53F}' +
    '.afc-btn.afc-ghost{background:transparent;border-color:#8A6420;color:#1C1E24}.afc-btn.afc-ghost:hover{background:#f1e9d6}' +
    '.afc-btn:focus-visible{outline:3px solid #1C1E24;outline-offset:2px}' +
    '.afc-btn[hidden]{display:none}' +
    '.afc-open .wa-float{bottom:calc(var(--afc-h,0px) + 24px)}' +
    /* Keep focused/scrolled-to content and the end of the page clear of the banner. */
    'html.afc-open{scroll-padding-bottom:calc(var(--afc-h,0px) + 24px)}html.afc-open body{padding-bottom:calc(var(--afc-h,0px) + 24px)}' +
    'button.consent-open{background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;' +
    'text-decoration:underline;text-decoration-color:rgba(184,134,43,.5);text-underline-offset:3px}' +
    'button.consent-open:hover{color:#1C1E24}button.consent-open:focus-visible{outline:3px solid #8A6420;outline-offset:2px}';

  var box, prefs, statsBox, mktBox, saveBtn, settingsBtn, returnTo = null;
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  (function () { var st = document.createElement('style'); st.id = 'afc-style'; st.textContent = CSS; document.head.appendChild(st); })();
  function build() {
    if (box) return;
    box = el('section', { id: 'afias-consent', 'class': 'afc', role: 'region', 'aria-labelledby': 'afc-title', dir: 'rtl', lang: 'he', hidden: '' },
      '<h2 class="afc-title" id="afc-title" tabindex="-1">עוגיות ומדידה באתר</h2>' +
      '<p class="afc-text">בלי הסכמה האתר לא טוען כלי מדידה, ושומר בדפדפן רק את הבחירה שלכם. אם תאשרו, אפעיל כלי סטטיסטיקה (Google Analytics, Microsoft Clarity) וכלי שיווק (Meta) כדי להבין איך משתמשים באתר ולמדוד פרסום. אפשר לשנות את הבחירה בכל רגע דרך "הגדרות עוגיות" בתחתית העמוד. פרטים ב<a href="/cookies/">מדיניות העוגיות</a>, ב<a href="/privacy/">מדיניות הפרטיות</a> וב<a href="/accessibility/">הצהרת הנגישות</a>.</p>' +
      '<fieldset class="afc-prefs" id="afc-prefs" hidden><legend>בחירה לפי קטגוריה</legend>' +
      '<div class="afc-cat"><input type="checkbox" id="afc-nec" checked disabled><label for="afc-nec"><b>הכרחיות (תמיד פעילות)</b>: שמירת הבחירה הזו ושליחת טופס הדמו.</label></div>' +
      '<div class="afc-cat"><input type="checkbox" id="afc-stats"><label for="afc-stats"><b>סטטיסטיקה</b>: Google Analytics 4 ו-Microsoft Clarity (כולל הקלטת התנהגות בעמוד), כדי להבין איך משתמשים באתר.</label></div>' +
      '<div class="afc-cat"><input type="checkbox" id="afc-mkt"><label for="afc-mkt"><b>שיווק</b>: Meta Pixel ו-Meta Conversions API, למדידת פרסום. כששולחים את טופס הדמו, נשלחים ל-Meta גם האימייל, הטלפון והשם בצורה מגובבת (hash).</label></div>' +
      '</fieldset>' +
      '<div class="afc-actions">' +
      '<button type="button" class="afc-btn" data-afc="accept">אישור הכל</button>' +
      '<button type="button" class="afc-btn" data-afc="reject">דחייה</button>' +
      '<button type="button" class="afc-btn afc-ghost" data-afc="settings" aria-expanded="false" aria-controls="afc-prefs">הגדרות</button>' +
      '<button type="button" class="afc-btn afc-ghost" data-afc="save" hidden>שמירת הבחירה</button>' +
      '</div>');
    prefs = box.querySelector('#afc-prefs');
    statsBox = box.querySelector('#afc-stats');
    mktBox = box.querySelector('#afc-mkt');
    saveBtn = box.querySelector('[data-afc="save"]');
    settingsBtn = box.querySelector('[data-afc="settings"]');
    // Right after the skip link when it is a direct child of <body>, so the
    // skip link stays the first Tab stop and the banner comes next.
    var skip = document.querySelector('body > .skip-link');
    if (skip) skip.after(box); else document.body.insertBefore(box, document.body.firstChild);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-afc]'); if (!b) return;
      var a = b.getAttribute('data-afc');
      if (a === 'accept') choose(true, true);
      else if (a === 'reject') choose(false, false);
      else if (a === 'save') choose(statsBox.checked, mktBox.checked);
      else if (a === 'settings') showPrefs(prefs.hidden);
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && consent) { e.preventDefault(); hide(); }
    });
    if (window.ResizeObserver) new ResizeObserver(setHeight).observe(box);
  }
  function setHeight() {
    if (box && !box.hidden) document.documentElement.style.setProperty('--afc-h', box.offsetHeight + 'px');
  }
  function showPrefs(on) {
    prefs.hidden = !on; saveBtn.hidden = !on;
    settingsBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) statsBox.focus();
  }
  function show(fromLink) {
    build();
    statsBox.checked = !!(consent && consent.stats);
    mktBox.checked = !!(consent && consent.marketing);
    box.hidden = false;
    document.documentElement.classList.add('afc-open');
    setHeight();
    if (fromLink) { showPrefs(true); box.querySelector('#afc-title').focus({ preventScroll: true }); }
    else showPrefs(false);
  }
  function hide() {
    if (!box) return;
    box.hidden = true;
    document.documentElement.classList.remove('afc-open');
    var to = returnTo; returnTo = null;
    if (to && document.contains(to)) to.focus();
    else { var m = document.getElementById('main'); if (m) m.focus({ preventScroll: true }); }
  }
  function choose(stats, marketing) {
    var before = consent;
    consent = write(stats, marketing);
    var withdrawn = before && ((before.stats && !stats) || (before.marketing && !marketing));
    if (withdrawn) { clearTracking(); location.reload(); return; }
    if (!marketing) pending = [];
    apply(true);
    hide();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-consent-open]');
    if (t) { e.preventDefault(); returnTo = t; show(true); return; }
    var y = e.target.closest && e.target.closest('a.yt-facade[data-yt]');
    if (y && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); playVideo(y); }
  });

  /* ---------- click-to-load YouTube ---------- */
  function playVideo(a) {
    var id = a.getAttribute('data-yt');
    if (!/^[\w-]{6,20}$/.test(id)) return;
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0';
    f.title = a.getAttribute('data-title') || 'סרטון YouTube';
    f.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.setAttribute('width', '100%');
    f.style.aspectRatio = '16 / 9';
    f.style.border = '0';
    a.replaceWith(f);
    f.focus();
  }

  /* ---------- start ---------- */
  early.forEach(function (a) { track(a[0], a[1]); });
  track('PageView');
  if (consent) apply(false);
  else if (document.body) show(false);
  else document.addEventListener('DOMContentLoaded', function () { show(false); });
})();
