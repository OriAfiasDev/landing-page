/**
 * POST https://afias-demo.afias.workers.dev/api/demo-request
 *
 * The endpoint behind the free-demo form (AFI-24). The form itself is a plain
 * static page on GitHub Pages at https://afias.dev/demo/, so this is a genuine
 * cross-origin call and CORS below is load-bearing.
 *
 * Submissions become one Linear issue. There is no database.
 *
 *   step 1  ->  issueCreate   ("בקשת דמו - <business>"), dueDate = today + 3 days,
 *               labelled "בקשת דמו" (the label is created on first use).
 *               Responds with { ok: true, issueId } so the browser can hold onto it.
 *   step 2  ->  commentCreate on that same issue with the contact details.
 *
 * A second, independent route handles Meta Conversions API:
 *
 *   POST /track  ->  mirrors a browser Pixel event server-side, sharing the
 *                    browser's event_id so Meta deduplicates the pair.
 *
 * A third route receives published articles from the Hoox publishing service:
 *
 *   POST /api/hoox-webhook  ->  verifies the HMAC over the raw body, renders the
 *                               article into blog/<slug>/index.html and upserts
 *                               it into the GitHub repo. The push triggers the
 *                               existing Pages deploy — for a static site, the
 *                               repo is the database and the push is the publish.
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   LINEAR_API_KEY, LINEAR_TEAM_ID, LINEAR_PROJECT_ID
 *   META_PIXEL_ID, META_ACCESS_TOKEN
 *   HOOX_WEBHOOK_SECRET   — the signing secret from the Hoox dashboard
 *   GITHUB_TOKEN          — fine-grained PAT, Contents: read+write, this repo only
 *   META_TEST_EVENT_CODE  — optional; set it to send to Test Events, and
 *                           `wrangler secret delete` it to go live. Keeping the
 *                           switch in configuration means shipping to production
 *                           never depends on remembering to edit this file.
 */

import { renderArticlePage } from './article-page.js';

const LINEAR_API = 'https://api.linear.app/graphql';
const LABEL_NAME = 'בקשת דמו';
const DUE_DAYS = 3;

const TRACK_PATH = '/track';
const HOOX_PATH = '/api/hoox-webhook';

const GITHUB_REPO = 'OriAfiasDev/landing-page';
const GITHUB_BRANCH = 'main';
const META_API_VERSION = 'v21.0';

// An open endpoint that forwards to the Pixel is an open door to poisoning ad
// optimisation with fake conversions, so only the events this site actually
// sends are accepted.
const ALLOWED_EVENTS = new Set([
  'PageView',
  'ViewContent',
  'Contact',
  'Schedule',
  'Lead',
  'CompleteRegistration',
  'DemoPageClick',
]);

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

// The page lives on GitHub Pages, so submissions are cross-origin by design.
const ALLOWED_ORIGINS = [
  'https://afias.dev',
  'https://www.afias.dev',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

function corsHeaders(origin) {
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

/** Trim, collapse newlines, and cap length so nobody can paste a novel into Linear. */
function clean(value, max = 2000) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim().slice(0, max);
}

/** YYYY-MM-DD, `days` from now. Calendar days, not business days — see README. */
function dueDate(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function linear(env, query, variables) {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': env.LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || !body || body.errors) {
    const detail = body && body.errors
      ? body.errors.map((e) => e.message).join('; ')
      : `HTTP ${res.status}`;
    throw new Error(`Linear API: ${detail}`);
  }
  return body.data;
}

/**
 * Return the id of the "בקשת דמו" label on this team, creating it if missing.
 * Returns null rather than throwing — a missing label must never cost us a lead.
 */
async function ensureLabel(env) {
  try {
    const found = await linear(
      env,
      `query($teamId: ID!, $name: String!) {
         issueLabels(filter: { team: { id: { eq: $teamId } }, name: { eq: $name } }) {
           nodes { id }
         }
       }`,
      { teamId: env.LINEAR_TEAM_ID, name: LABEL_NAME }
    );

    const existing = found.issueLabels.nodes[0];
    if (existing) return existing.id;

    const created = await linear(
      env,
      `mutation($input: IssueLabelCreateInput!) {
         issueLabelCreate(input: $input) { success issueLabel { id } }
       }`,
      {
        input: {
          name: LABEL_NAME,
          teamId: env.LINEAR_TEAM_ID,
          color: '#B8862B',
        },
      }
    );

    return created.issueLabelCreate.issueLabel.id;
  } catch (err) {
    console.error('label lookup/create failed, continuing without it:', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* step 1 — create the issue                                           */
/* ------------------------------------------------------------------ */

async function handleStep1(env, data) {
  const business = clean(data.business, 200);
  if (!business) {
    return { status: 400, body: { ok: false, error: 'business name is required' } };
  }

  const website = clean(data.website, 300);
  const about = clean(data.about, 2000);

  const description = [
    '**בקשת דמו חדשה**',
    '',
    `**שם העסק:** ${business}`,
    `**אתר קיים:** ${website || '_לא צוין_'}`,
    '',
    '**כמה מילים על העסק:**',
    about || '_לא צוין_',
    '',
    '---',
    '',
    '_אם הלקוח ישלים את שלב 2, פרטי הקשר יגיעו כתגובה על הטיקט. אם לא — לחפש פרטי קשר באתר שסופק._',
  ].join('\n');

  const labelId = await ensureLabel(env);

  const result = await linear(
    env,
    `mutation($input: IssueCreateInput!) {
       issueCreate(input: $input) {
         success
         issue { id identifier url }
       }
     }`,
    {
      input: {
        teamId: env.LINEAR_TEAM_ID,
        projectId: env.LINEAR_PROJECT_ID,
        title: `בקשת דמו - ${business}`,
        description,
        dueDate: dueDate(DUE_DAYS),
        ...(labelId ? { labelIds: [labelId] } : {}),
      },
    }
  );

  const issue = result.issueCreate.issue;
  return { status: 200, body: { ok: true, issueId: issue.id } };
}

/* ------------------------------------------------------------------ */
/* step 2 — append contact details to the same issue                   */
/* ------------------------------------------------------------------ */

async function handleStep2(env, data) {
  const issueId = clean(data.issueId, 100);
  const name = clean(data.name, 200);
  const email = clean(data.email, 200);
  const phone = clean(data.phone, 60);

  if (!name || !email || !phone) {
    return { status: 400, body: { ok: false, error: 'name, email and phone are required' } };
  }

  const contactBlock = [
    '',
    '---',
    '',
    '**פרטי קשר:**',
    `- שם מלא: ${name}`,
    `- אימייל: ${email}`,
    `- טלפון: ${phone}`,
  ].join('\n');

  // If step 1's issue id never made it back to the browser, don't drop the
  // contact details on the floor — file them as their own issue instead.
  if (!issueId) {
    const business = clean(data.business, 200) || 'ללא שם עסק';
    const labelId = await ensureLabel(env);

    await linear(
      env,
      `mutation($input: IssueCreateInput!) {
         issueCreate(input: $input) { success issue { id } }
       }`,
      {
        input: {
          teamId: env.LINEAR_TEAM_ID,
          projectId: env.LINEAR_PROJECT_ID,
          title: `בקשת דמו (פרטי קשר בלבד) - ${business}`,
          description: `_הגיעו פרטי קשר בלי שלב 1 מקושר._\n${contactBlock}`,
          dueDate: dueDate(DUE_DAYS),
          ...(labelId ? { labelIds: [labelId] } : {}),
        },
      }
    );

    return { status: 200, body: { ok: true } };
  }

  // Posted as a comment rather than appended to the description: a
  // read-modify-write on the description would drop anything edited in Linear
  // between the two steps, and a comment is timestamped in the activity feed.
  await linear(
    env,
    `mutation($input: CommentCreateInput!) {
       commentCreate(input: $input) { success }
     }`,
    { input: { issueId, body: contactBlock.replace(/^\n---\n\n/, '') } }
  );

  return { status: 200, body: { ok: true } };
}

/* ------------------------------------------------------------------ */
/* entrypoint                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Meta Conversions API                                                */
/* ------------------------------------------------------------------ */

/** SHA-256 hex, which is the only form Meta accepts for PII. */
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Meta matches on normalised values, so normalisation has to happen before
 * hashing — hashing "Ori@Afias.dev" and "ori@afias.dev" gives two different
 * digests and the second one never matches anybody.
 */
const NORMALISE = {
  em: (v) => v.trim().toLowerCase(),
  fn: (v) => v.trim().toLowerCase(),
  ln: (v) => v.trim().toLowerCase(),
  ph: (v) => {
    const digits = v.replace(/\D/g, '');
    // Meta wants a country code. Israeli numbers are typed locally as 05X…,
    // so a leading 0 is rewritten to 972 rather than being sent unmatched.
    if (/^0\d{8,9}$/.test(digits)) return '972' + digits.slice(1);
    return digits;
  },
};

/** Map the client's field names onto Meta's, normalise, hash. */
async function buildUserData(request, input) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};

  const pii = [
    ['em', source.email],
    ['ph', source.phone],
    ['fn', source.first_name],
    ['ln', source.last_name],
  ];

  for (const [key, raw] of pii) {
    const value = clean(raw, 300);
    if (!value) continue;
    const normalised = NORMALISE[key](value);
    if (normalised) out[key] = [await sha256(normalised)];
  }

  // Not PII in Meta's model, and never hashed: the Pixel's own cookies plus the
  // request's own IP and UA. These carry most of the match quality for anonymous
  // visitors, which is exactly the PageView case.
  const fbp = clean(source.fbp, 200);
  const fbc = clean(source.fbc, 400);
  if (fbp) out.fbp = fbp;
  if (fbc) out.fbc = fbc;

  const ip = request.headers.get('CF-Connecting-IP');
  const ua = request.headers.get('User-Agent');
  if (ip) out.client_ip_address = ip;
  if (ua) out.client_user_agent = ua;

  return out;
}

async function handleTrack(request, env, data, origin) {
  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) {
    console.error('/track called but META_PIXEL_ID / META_ACCESS_TOKEN are not set');
    return json({ ok: false }, 200, origin);
  }

  const eventName = clean(data.event_name, 60);
  if (!ALLOWED_EVENTS.has(eventName)) {
    return json({ ok: false }, 400, origin);
  }

  const eventId = clean(data.event_id, 100);
  if (!eventId) {
    // Without it Meta cannot pair this with the browser event and would count
    // the conversion twice.
    return json({ ok: false }, 400, origin);
  }

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    user_data: await buildUserData(request, data.user_data),
  };

  const sourceUrl = clean(data.event_source_url, 800);
  if (sourceUrl) event.event_source_url = sourceUrl;

  if (data.custom_data && typeof data.custom_data === 'object') {
    event.custom_data = data.custom_data;
  }

  const payload = { data: [event] };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${env.META_PIXEL_ID}/events?access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    // Logged for us, never returned: Meta's errors quote back the payload and
    // can echo the access token, and none of it is the browser's business.
    const detail = await res.text().catch(() => '');
    console.error('Meta CAPI rejected the event:', res.status, detail.slice(0, 500));
    return json({ ok: false }, 200, origin);
  }

  return json({ ok: true }, 200, origin);
}

/* ------------------------------------------------------------------ */
/* Hoox article webhook                                                */
/* ------------------------------------------------------------------ */

function hex(bytes) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify `X-Hoox-Signature: sha256=<hex>` against HMAC-SHA256(secret, rawBody).
 *
 * Two things here are deliberate and easy to get subtly wrong:
 *  - the MAC is computed over the raw request bytes, never over re-serialised
 *    JSON — any whitespace or key-order difference would break it;
 *  - the comparison is constant-time. A plain `===` on hex strings short-circuits
 *    at the first differing character, which leaks how much of a forged
 *    signature is correct, one byte at a time.
 */
async function verifyHooxSignature(secret, rawBody, header) {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const expected = 'sha256=' + hex(await crypto.subtle.sign('HMAC', key, rawBody));

  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(header);
  // timingSafeEqual throws on unequal lengths; a length mismatch is simply a
  // wrong signature and reveals nothing about the secret.
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

function githubHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'afias-demo-worker',
    'Content-Type': 'application/json',
  };
}

/** Base64 of a UTF-8 string, the way the GitHub Contents API wants file bodies. */
function base64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Upsert one file in the repo. The Contents API needs the existing blob's sha
 * to overwrite, so a GET comes first; a 404 there means "create". That makes
 * a retried webhook idempotent: same slug, same path, overwritten in place.
 */
async function upsertRepoFile(env, path, content, message) {
  const base = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;

  let sha;
  const existing = await fetch(`${base}?ref=${GITHUB_BRANCH}`, { headers: githubHeaders(env) });
  if (existing.ok) {
    sha = (await existing.json()).sha;
  } else if (existing.status !== 404) {
    throw new Error(`GitHub GET ${path}: HTTP ${existing.status}`);
  }

  const res = await fetch(base, {
    method: 'PUT',
    headers: githubHeaders(env),
    body: JSON.stringify({
      message,
      branch: GITHUB_BRANCH,
      content: base64Utf8(content),
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub PUT ${path}: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  return sha ? 'updated' : 'created';
}

/** A slug becomes a directory name and a URL segment; it has to be boring. */
function safeSlug(value) {
  const s = clean(value, 120).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) ? s : '';
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

async function handleHooxWebhook(request, env) {
  // Signature first, on the raw bytes, before anything reads the body as JSON.
  const rawBody = await request.arrayBuffer();
  const valid = await verifyHooxSignature(
    env.HOOX_WEBHOOK_SECRET, rawBody, request.headers.get('X-Hoox-Signature')
  );
  if (!valid) return jsonResponse({ error: 'invalid signature' }, 401);

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  // Anything other than a publish is acknowledged and ignored — a 200 here
  // stops the service retrying an event we have no handler for.
  if (payload.event !== 'article.published' || !payload.data) {
    return jsonResponse({ received: true, ignored: true }, 200);
  }

  const a = payload.data;
  const slug = safeSlug(a.slug);
  const id = clean(a.id, 200);
  if (!slug || !id || !clean(a.title, 500) || typeof a.content_html !== 'string') {
    // A 4xx is the right answer to a malformed article: it will not become
    // well-formed on retry.
    return jsonResponse({ error: 'missing or invalid id, slug, title or content_html' }, 422);
  }

  if (!env.GITHUB_TOKEN) {
    console.error('hoox webhook: GITHUB_TOKEN is not set, cannot publish');
    return jsonResponse({ error: 'publishing not configured' }, 500);
  }

  // The commit *is* the persistence, so it happens before the 200: if GitHub
  // is down we answer 5xx and the service retries, instead of acknowledging an
  // article we then silently lost. The slow part — the deploy the push
  // triggers — already runs asynchronously on GitHub's side.
  const html = renderArticlePage({ ...a, slug, id });
  const outcome = await upsertRepoFile(
    env,
    `blog/${slug}/index.html`,
    html,
    `Publish article: ${clean(a.title, 80)}\n\nhoox id ${id}`
  );

  return jsonResponse({ received: true, outcome, url: `https://afias.dev/blog/${slug}/` }, 200);
}

export default {
  async fetch(request, env) {
    // Server-to-server, signed, never browser-originated — so it is dispatched
    // before the browser-origin allowlist and before anything reads the body as
    // JSON. It authenticates with its HMAC, not with CORS.
    if (new URL(request.url).pathname === HOOX_PATH) {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      try {
        return await handleHooxWebhook(request, env);
      } catch (err) {
        console.error('hoox webhook failed:', err.message);
        return jsonResponse({ error: 'internal error' }, 500);
      }
    }

    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method not allowed' }, 405, origin);
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return json({ ok: false, error: 'origin not allowed' }, 403, origin);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: 'invalid JSON' }, 400, origin);
    }

    // The Conversions API mirror. Everything else falls through to the demo
    // form exactly as before.
    if (new URL(request.url).pathname === TRACK_PATH) {
      try {
        return await handleTrack(request, env, data, origin);
      } catch (err) {
        console.error('track failed:', err.message);
        return json({ ok: false }, 200, origin);
      }
    }

    // Honeypot: a real person never fills a field they cannot see. Answer 200 so
    // the bot believes it succeeded and doesn't come back to retry.
    if (clean(data.company_url, 200)) {
      return json({ ok: true, issueId: null }, 200, origin);
    }

    try {
      const { status, body } =
        data.step === 2 ? await handleStep2(env, data) : await handleStep1(env, data);
      return json(body, status, origin);
    } catch (err) {
      console.error('demo form failed:', err.message);
      return json({ ok: false, error: 'internal error' }, 500, origin);
    }
  },
};
