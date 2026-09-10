# afias-demo

Two routes on one Worker.

| route | what it does |
| --- | --- |
| `POST /api/demo-request` | the free-demo form (AFI-24) -> a Linear issue |
| `POST /track` | mirrors a browser Pixel event to Meta's Conversions API |

They share only CORS and the origin allowlist; neither knows about the other.

## The demo form

Two independent pieces, deliberately:

- **the page** — `demo/index.html`, a plain static file published with the rest
  of the site by GitHub Pages, at `https://afias.dev/demo/`;
- **the endpoint** — this Worker, at
  `https://afias-demo.afias.workers.dev/api/demo-request`.

They are separate origins, so the form's `fetch` is cross-origin and the CORS
allowlist in `src/index.js` is doing real work. That is the price of keeping the
two deployments independent, and it is five lines.

Submissions become one Linear issue. There is no database.

| step | what happens |
| --- | --- |
| 1 | `issueCreate` — title `בקשת דמו - <business>`, due date today + 3 days, label `בקשת דמו`, in team `Afias` / project `לידים ומכירות`. Returns the new issue id to the browser. |
| 2 | `commentCreate` — posts full name / email / phone as a comment on that same issue. |

If step 2 arrives without an issue id (tab reopened, step 1 response lost), the
contact details are filed as their own issue rather than dropped.

## Deploy

The Linear API key needs **both `read` and `write` scopes**. `write` alone
deploys happily and then fails at runtime with ``Invalid scope: `read` required``,
which costs the label on every issue and drops step 2 entirely.

```bash
cd worker
npx wrangler login
```

Set the three secrets. Pass **only the name** — wrangler prompts for the value
with hidden input. Never put the value on the command line, where it lands in
your shell history:

```bash
npx wrangler secret put LINEAR_API_KEY
npx wrangler secret put LINEAR_TEAM_ID      # e4614b83-64d6-4487-815a-331a4643f7c5
npx wrangler secret put LINEAR_PROJECT_ID   # 31c37a9a-8c57-4794-92f0-8a95edc5fdd5
npx wrangler secret put META_PIXEL_ID       # 1990961434890890
npx wrangler secret put META_ACCESS_TOKEN   # Events Manager -> Settings -> Conversions API
```

```bash
npx wrangler deploy
```

The page deploys separately, by pushing to `main` — GitHub Actions publishes the
site. Changing one never requires redeploying the other.

## Conversions API (`POST /track`)

The browser fires every Pixel event twice: once through `fbq()` and once, in
parallel, to this route. Both legs carry the **same `event_id`**, which is the
only thing that stops Meta counting one conversion as two — it deduplicates on
that id and keeps whichever leg arrives first.

The point of the server leg is that it still arrives when the browser one does
not: ad blockers, tracking prevention, a tab closed mid-navigation.

### What it accepts

```json
{
  "event_name": "Lead",
  "event_id": "9f1c…",
  "event_source_url": "https://afias.dev/demo/",
  "user_data": { "email": "…", "phone": "…", "first_name": "…", "last_name": "…",
                 "fbp": "…", "fbc": "…" },
  "custom_data": { }
}
```

`event_name` must be one of `ALLOWED_EVENTS` in `src/index.js`. That allowlist is
not bureaucracy: this endpoint is public, and without it anyone could inject
fabricated conversions and quietly wreck the ad account's optimisation.

### PII

`email`, `phone`, `first_name` and `last_name` are **normalised and then SHA-256
hashed in the Worker**; the raw values never reach Meta. Normalisation has to
happen before hashing or the digests match nobody — `Ori@Afias.dev` and
`ori@afias.dev` hash differently, and only the second matches.

Phone numbers get a country code. Israeli numbers are typed locally (`050-…`),
so a leading `0` is rewritten to `972`. A number sent without a country code is
simply never matched.

`fbp` / `fbc` (the Pixel's own cookies) and the request's IP and user-agent are
sent unhashed — Meta treats them as non-PII, and for anonymous visitors they
carry most of the match quality.

### Testing before going live

`META_TEST_EVENT_CODE` is a secret, not a code change:

```bash
npx wrangler secret put META_TEST_EVENT_CODE   # from Events Manager -> Test Events
npx wrangler deploy
```

Load the site, trigger events, and watch Test Events: each should appear twice —
once from the browser, once from the server — flagged **Deduplicated**. If they
appear as two separate events, the `event_id` is not matching.

Going live is deleting the secret, so production never depends on someone
remembering to strip a constant out of this file:

```bash
npx wrangler secret delete META_TEST_EVENT_CODE
```

### Local development

```bash
cd worker
cat > .dev.vars <<'VARS'
META_PIXEL_ID=1990961434890890
META_ACCESS_TOKEN=…
META_TEST_EVENT_CODE=…
VARS
npx wrangler dev
```

`.dev.vars` is gitignored. Point `ENDPOINT` (top of the inline script in
`index.html` and `demo/index.html`) at `http://localhost:8787/track` while
testing, and put it back before committing.

### Failure behaviour

`/track` answers `{ "ok": false }` and never explains why. Meta's errors quote
the payload back and can echo the access token, so they are logged
(`wrangler tail`) and never returned. Analytics must not be able to break a page,
so the client fires it and ignores the result entirely.

## Local testing

```bash
cd worker && npx wrangler dev          # endpoint on :8787
python3 -m http.server 8000            # from the repo root, site on :8000
```

`http://localhost:8000` is already in the CORS allowlist. Point `ENDPOINT` in
`demo/index.html` at `http://localhost:8787/api/demo-request` while testing.

## Notes

- **The allowlist is the security boundary.** `ALLOWED_ORIGINS` in `src/index.js`
  must list every origin the form is served from. A missing entry is a silent
  403 for real visitors — and curl will not reproduce it, because curl sends no
  `Origin` header. Test origin changes in a browser.
- **If the page ever moves to `demo.afias.dev`:** put it on a Cloudflare Pages
  project, point a CNAME at it, and add the new origin to the allowlist. Do not
  attach a custom domain to this Worker — Workers custom domains require the
  whole `afias.dev` zone to be hosted on Cloudflare, which would mean migrating
  the MX, SPF and DKIM records that carry the mail.
- **The label is created on first use.** If the lookup or creation fails the issue
  is still created, just unlabelled — a Linear hiccup should never cost a lead.
- **Due date is 3 calendar days, not 3 business days.** The spec says "+ 3 ימים"
  while AFI-24's body says "3 ימי עסקים"; the literal calendar version is what is
  implemented, so a Friday submission lands on Monday.
- **`/track` has no rate limit.** The event allowlist blocks the worst abuse
  (fabricated `Purchase` events), but a determined actor could still flood real
  event names. Cloudflare's free rate limiting is the fix if that ever happens.
- **Spam protection is a honeypot only** (`company_url`, hidden via CSS). This
  endpoint creates a Linear issue per request, so if it is ever found by a real
  spammer, add Turnstile or a rate limit.
