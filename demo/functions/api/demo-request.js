/**
 * POST /api/demo-request  —  the "free demo" funnel at https://demo.afias.dev
 *
 * A Cloudflare Pages Function, so it is served from the same origin as the
 * static page in ../../public. Same origin means the browser never sends a
 * cross-origin request and never preflights; the origin check below is
 * anti-abuse only.
 *
 * Submissions become one Linear issue. There is no database.
 *
 *   step 1  ->  issueCreate   ("בקשת דמו - <business>"), dueDate = today + 3 days,
 *               labelled "בקשת דמו" (the label is created on first use).
 *               Responds with { ok: true, issueId } so the browser can hold onto it.
 *   step 2  ->  commentCreate on that same issue with the contact details.
 *
 * Secrets (Pages project -> Settings -> Variables and Secrets):
 *   LINEAR_API_KEY, LINEAR_TEAM_ID, LINEAR_PROJECT_ID
 */

const LINEAR_API = 'https://api.linear.app/graphql';
const LABEL_NAME = 'בקשת דמו';
const DUE_DAYS = 3;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The page is served by this same Worker, so a legitimate submission is always
 * same-origin. Deriving that from the request beats hardcoding a hostname:
 * it works on workers.dev, on demo.afias.dev and under `wrangler dev` without
 * anyone remembering to update a list.
 *
 * A missing Origin is allowed — same-origin form posts and curl both omit it.
 * An Origin that is present and different is a cross-site caller.
 */
function isAllowedOrigin(origin, request) {
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function corsHeaders(origin, allowed) {
  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body, status, origin, allowed) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
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

export async function onRequest(context) {
  const { request, env } = context;

  const origin = request.headers.get('Origin') || '';
  const allowed = isAllowedOrigin(origin, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
  }
  if (!allowed) {
    return json({ ok: false, error: 'origin not allowed' }, 403, origin, allowed);
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405, origin, allowed);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, 400, origin, allowed);
  }

  // Honeypot: a real person never fills a field they cannot see. Answer 200 so
  // the bot believes it succeeded and doesn't come back to retry.
  if (clean(data.company_url, 200)) {
    return json({ ok: true, issueId: null }, 200, origin, allowed);
  }

  try {
    const { status, body } =
      data.step === 2 ? await handleStep2(env, data) : await handleStep1(env, data);
    return json(body, status, origin, allowed);
  } catch (err) {
    console.error('demo form failed:', err.message);
    return json({ ok: false, error: 'internal error' }, 500, origin, allowed);
  }
}
