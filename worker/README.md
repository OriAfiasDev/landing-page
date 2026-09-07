# afias-demo

The endpoint behind the free-demo form (AFI-24).

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
```

```bash
npx wrangler deploy
```

The page deploys separately, by pushing to `main` — GitHub Actions publishes the
site. Changing one never requires redeploying the other.

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
- **Spam protection is a honeypot only** (`company_url`, hidden via CSS). This
  endpoint creates a Linear issue per request, so if it is ever found by a real
  spammer, add Turnstile or a rate limit.
