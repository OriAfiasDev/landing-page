# demo.afias.dev

The free-demo funnel (AFI-24), deployed as a **Cloudflare Pages** project.

```
demo/
  functions/api/demo-request.js   the form endpoint  (POST /api/demo-request)
  public/                         the site itself    (the build output directory)
```

`functions/` deliberately sits **outside** `public/`. Pages compiles it into a
Worker; if it lived inside the output directory its source would be published as
a downloadable file.

Both halves are served from one origin, so the page's `fetch` is same-origin —
no CORS, no preflight, and nothing to update when the domain changes.

## Why Pages and not a Worker

A Workers custom domain only works for a zone that is **active on Cloudflare**,
which would have meant migrating all of `afias.dev` — including the MX, SPF and
DKIM records that carry the mail — away from Google Cloud DNS.

Pages custom domains work over an ordinary CNAME from an external DNS provider,
for subdomains. So `demo.afias.dev` needs exactly one new record and the rest of
the zone is never touched.

## Form submissions

They become one Linear issue. There is no database.

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
cd demo
npx wrangler pages project create afias-demo --production-branch=main
npx wrangler pages deploy public
```

Then set the three secrets in the dashboard — **Workers & Pages → afias-demo →
Settings → Variables and Secrets** — as *encrypted* values, on Production:

| name | value |
| --- | --- |
| `LINEAR_API_KEY` | the Linear key |
| `LINEAR_TEAM_ID` | `e4614b83-64d6-4487-815a-331a4643f7c5` |
| `LINEAR_PROJECT_ID` | `31c37a9a-8c57-4794-92f0-8a95edc5fdd5` |

Redeploy after adding them; secrets are bound at deploy time.

## The custom domain

1. **Workers & Pages → afias-demo → Custom domains → Set up a custom domain**,
   enter `demo.afias.dev`. Cloudflare will say the domain is not on Cloudflare
   and give you a CNAME target, `afias-demo.pages.dev`.
2. In **Google Cloud DNS**, add exactly one record to the `afias.dev` zone:

   | type | name | value |
   | --- | --- | --- |
   | CNAME | `demo` | `afias-demo.pages.dev.` |

3. Wait for Cloudflare to validate and issue the certificate.

Nothing else in the zone changes. The apex, `www`, the five MX records, SPF and
DKIM are all untouched.

There are no CAA records on `afias.dev`, so nothing blocks certificate issuance.
If CAA records are ever added, they must permit Cloudflare.

## Local testing

```bash
cd demo && npx wrangler pages dev public
```

Serves the page and the endpoint together, which is what production does.

## Notes

- **Everything in `public/` is public**, including `public/media/README.md`.
- **`demo/` is excluded from the GitHub Pages build** (see
  `.github/workflows/deploy.yml`) so the page is not also published at
  `afias.dev/demo/`.
- **`demo.afias.dev` is a separate host to search engines**, so it carries its
  own `robots.txt` and `sitemap.xml`. It cannot be listed in
  `afias.dev/sitemap.xml`. Submit it to Search Console as its own property.
- **Due date is 3 calendar days, not 3 business days.** The spec says "+ 3 ימים"
  while AFI-24's body says "3 ימי עסקים"; the literal calendar version is what is
  implemented, so a Friday submission lands on Monday.
- **Spam protection is a honeypot only** (`company_url`, hidden via CSS). This
  endpoint creates a Linear issue per request, so if it is ever found by a real
  spammer, add Turnstile or a rate limit.
