# afias-demo

The free-demo funnel at **https://demo.afias.dev** (AFI-24).

One Cloudflare Worker serves both halves from a single origin:

- the **landing page** — the static files in `../demo`, via the `[assets]` binding;
- the **form endpoint** — `POST /api/demo-request`, handled by `src/index.js`.

Sharing an origin means the page's `fetch` is same-origin: no CORS, no preflight,
and nothing to keep in sync when the domain changes. The origin allowlist in
`src/index.js` is anti-abuse only.

Form submissions become one Linear issue. There is no database.

| step | what happens |
| --- | --- |
| 1 | `issueCreate` — title `בקשת דמו - <business>`, due date today + 3 days, label `בקשת דמו`, in team `Afias` / project `לידים ומכירות`. Returns the new issue id to the browser. |
| 2 | `commentCreate` — posts full name / email / phone as a comment on that same issue. |

If step 2 arrives without an issue id (tab reopened, step 1 response lost), the
contact details are filed as their own issue rather than dropped.

## Prerequisite: afias.dev must be on Cloudflare DNS

**A Workers custom domain only works for a zone that is active on Cloudflare.**
`afias.dev` currently uses Google Cloud DNS (`ns-cloud-b*.googledomains.com`), so
the zone has to move before `demo.afias.dev` can point at this Worker.

Moving it does **not** disturb the main site — `afias.dev` keeps its existing
GitHub Pages records, just served from Cloudflare's nameservers.

### The complete zone as it stands today

Everything below must exist in Cloudflare, verbatim, **before** the nameservers
change. This is the whole zone — if something here is missing afterwards, it is
broken.

| type | name | value | TTL |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | Auto |
| A | `@` | `185.199.109.153` | Auto |
| A | `@` | `185.199.110.153` | Auto |
| A | `@` | `185.199.111.153` | Auto |
| CNAME | `www` | `oriafiasdev.github.io` | Auto |
| MX | `@` | `aspmx.l.google.com` | priority 1 |
| MX | `@` | `alt1.aspmx.l.google.com` | priority 5 |
| MX | `@` | `alt2.aspmx.l.google.com` | priority 5 |
| MX | `@` | `alt3.aspmx.l.google.com` | priority 10 |
| MX | `@` | `alt4.aspmx.l.google.com` | priority 10 |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | Auto |
| TXT | `google._domainkey` | the DKIM key — see the warning below | Auto |

All five A/CNAME records must be **DNS only** (grey cloud), not proxied.

Do **not** add `demo` by hand. Cloudflare creates that record itself when the
Worker custom domain is attached.

**The DKIM record is the one that breaks.** Its value is far longer than the
255-character limit for a single DNS string, so it is published as three quoted
chunks. Copy it from Google Cloud DNS as a single unbroken value into
Cloudflare's TXT field and let Cloudflare do the chunking — do not paste the
quotes or the spaces between chunks. A mangled DKIM record does not bounce mail;
it silently fails authentication and pushes your mail toward spam folders, which
is far harder to notice than an outage.

There is no DMARC record and no CAA record today. Absent CAA is fine — it means
no restriction on who may issue certificates, so Cloudflare can issue for
`demo.afias.dev` without one.

### The move

1. Cloudflare dashboard → **Add a site** → `afias.dev` → Free plan.
2. Let it import the existing records, then **check them against Google Cloud DNS
   one by one before continuing.** The import is best-effort and quietly misses
   records; anything absent here goes dark when the nameservers switch. In
   particular confirm the four apex `A` records (`185.199.108–111.153`), the
   `www` CNAME to `oriafiasdev.github.io`, and every MX/TXT record — losing an
   MX record means losing mail.
3. Set the GitHub Pages records to **DNS only** (grey cloud), not proxied.
4. At the registrar, replace the nameservers with the two Cloudflare gives you.
5. Wait for Cloudflare to report the zone as Active (usually minutes, but the TTL
   on the old delegation can stretch it out).
6. **Leave the Google Cloud DNS zone in place for about a week.** Nameserver
   changes propagate for up to 48 hours, and during that window some resolvers
   still ask Google. If the old zone is deleted while it is still being consulted,
   those resolvers get nothing. Delete it only once `dig NS afias.dev` returns
   Cloudflare from several networks.

Only then will step 4 of the deploy below succeed.

## Deploy

Get a Linear API key from **Linear → Settings → Security & access → Personal API
keys**. It needs **both `read` and `write` scopes** — `write` alone deploys
happily and then fails at runtime with ``Invalid scope: `read` required``, which
costs the label on every issue and drops step 2 entirely.

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

Then deploy, and attach the domain:

```bash
npx wrangler deploy
```

In the dashboard: **Workers & Pages → afias-demo → Settings → Domains & Routes →
Add → Custom domain → `demo.afias.dev`**. Cloudflare creates the DNS record and
issues the certificate itself.

## Local testing

```bash
cd worker && npx wrangler dev
```

That serves the page *and* the endpoint together on `http://localhost:8787`,
which is already in the origin allowlist — so local behaviour matches production
instead of only approximating it.

## Notes

- **Everything under `../demo` is public.** The assets binding serves the whole
  directory, so don't park anything there you would not publish.
- **`demo/` is excluded from the GitHub Pages build** (see
  `.github/workflows/deploy.yml`). The page is served here and only here; leaving
  it in both places would publish the same content at two URLs.
- **`demo.afias.dev` is a separate host to search engines**, so it carries its own
  `robots.txt` and `sitemap.xml` in `../demo`. It cannot be listed in
  `afias.dev/sitemap.xml`. Submit it to Search Console as its own property.
- **The label is created on first use.** If the lookup or creation fails the issue
  is still created, just unlabelled — a Linear hiccup should never cost a lead.
- **Due date is 3 calendar days, not 3 business days.** The spec doc says
  "+ 3 ימים" while AFI-24's body says "3 ימי עסקים". I implemented the literal
  calendar version; a Friday submission therefore lands on Monday. Say the word
  and it's a few lines in `dueDate()` to skip weekends.
- **Spam protection is a honeypot only** (`company_url`, hidden via CSS). It stops
  naive bots and nothing more. This endpoint creates a Linear issue per request,
  so if it ever gets found by a real spammer, add Cloudflare Turnstile or a
  rate limit — the free plan covers both.
