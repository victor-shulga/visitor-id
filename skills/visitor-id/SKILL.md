---
name: visitor-id
description: Shows which companies visit your website and what they read, for a B2B service company. Sets up a Cloudflare Worker + D1 with its own one-line site script (no third-party tool needed): drops bots, hosting/VPN and mobile networks, resolves office IPs to companies once a day (MoltSets if a key is set, otherwise the corporate network name), optionally takes RB2B (person-level, US only) or any company-by-IP tool by webhook, and shows everything on a private visits page with route A (write this week) or B (wait for a second signal), plus a CSV in the signal format. Use when someone says "хто заходив на сайт", "visitor identification", "visitor ID", "RB2B", "ідентифікація відвідувачів", "відвідувачі сайту в аутріч", "website visitors to leads", "intent from website". NOT web analytics (use Search Console or GA), NOT off-site events (jobs, funding, tenders: that is the signal radar).
---

# Visitor ID

A visit to your site is an intent signal: the person already knows you. This skill collects visits in one place and hands them to outreach in the same columns as any other signal.

The code lives in this repository: `worker.js` (site script, daily IP → company, webhook receiver, visits page), `schema.sql`, `wrangler.toml`, `export.py`. This skill drives it: setup, connecting a source, the weekly export and the routing rules.

## Required tools

| Tool | Used for | Required? | Without it |
|---|---|---|---|
| Claude Code | cloning, running wrangler and `export.py` | Required | in claude.ai the skill can only explain the steps; the user runs every command |
| Node.js (npx) + Python 3 | wrangler, tests, export | Required | nothing deploys |
| Cloudflare account (Workers + D1, free tier is enough) | receiving and storing visits | Required | no place for visits to land |
| The site script `/t.js` (in this repo) | page views from the user's site, company by office IP | Required, unless RB2B is the only source | no visits at all |
| MoltSets API key | IP → company domain (1 token per resolved IP, cap MAX_RESOLVE/day) | Optional | only corporate network names are used, fewer companies |
| RB2B | person-level visitors (name, title, LinkedIn) | Optional | US visitors stay company-level |
| Another company-by-IP tool with webhook or CSV | a second company source | Optional | nothing missing |
| Slack + Slack MCP | only for the free RB2B plan, which posts to Slack instead of a webhook | Optional | use a paid RB2B plan with webhook |

## What is realistic

Say this to the user before setup, so nobody expects names from Europe:
- RB2B gives a person only for US visitors: it matches cookies from US ad networks. Outside the US this cannot be repeated legally or technically.
- For Europe and the rest: only the company (by office IP) and people you already know (your own links with `?ref=<id>`, LinkedIn sign-in on a lead magnet).
- Company by IP works only when the visitor sits in an office network. Home and mobile internet show the provider, and the script drops those.

## 1. Get the code

```bash
git clone https://github.com/victor-shulga/visitor-id.git
cd visitor-id
node test.mjs && python3 test_export.py     # visitor-id test ok, export test ok
```

## 2. Deploy the receiver

```bash
npx wrangler login
npx wrangler d1 create visitor-id            # put database_id into wrangler.toml
npx wrangler d1 execute visitor-id --remote --file=schema.sql
npx wrangler secret put HOOK_SECRET          # any long random string; the user types it, not you
npx wrangler secret put VIEW_KEY             # a different long random string: the key to the visits page
npx wrangler secret put MOLTSETS_KEY         # optional: company by IP; the user types it
npx wrangler deploy
curl https://visitor-id.<account>.workers.dev/health   # ok
```

Never print or store the secrets in chat. The hook URL is `https://visitor-id.<account>.workers.dev/hook/<HOOK_SECRET>`. The visits page is `https://visitor-id.<account>.workers.dev/view/<VIEW_KEY>`: tell the user to bookmark it. Without `VIEW_KEY` the page does not exist.

## 3. Put the script on the site

Set `SITE_HOSTS = "their-domain.com"` under `[vars]` in `wrangler.toml` (other sites posting to the worker are ignored), redeploy, and have the user paste before `</body>` on every page:

```html
<script async src="https://visitor-id.<account>.workers.dev/t.js"></script>
```

Check: the user opens their site, then the visits page; the view appears once the daily job (06:20 UTC, or `npx wrangler dev --test-scheduled` + `/__scheduled`) has resolved its IP, or at once if the link carried `?ref=`. The script drops bots, hosting/VPN networks, mobile carriers and scanner probes; resolves at most `MAX_RESOLVE` (default 50) new IPs a day, caches each 30 days, wipes raw IPs after 7 days.

## 3a. Optional sources

- **RB2B with webhook** (names of US visitors): Integrations → Webhook → the hook URL. RB2B switches the integration off after a non-200 or a reply slower than 15 s; the worker only writes and answers at once, keep it that way.
- **RB2B free plan (Slack only)**: schedule a daily task: read yesterday's messages in the RB2B Slack channel, turn each into JSON with the fields `LinkedIn URL`, `First Name`, `Last Name`, `Title`, `Company Name`, `Website`, `Captured URL`, `Seen At`, POST each to the hook URL.
- **Company-by-IP tools**: webhook to the same URL, or a CSV with `Company Name`, `Website`, `Captured URL`, `Seen At` posted row by row. A visit without a person is accepted.

Send one test visit and check it landed: `npx wrangler d1 execute visitor-id --remote --command "SELECT * FROM visit_all ORDER BY seen_at DESC LIMIT 3"`.

## 3b. Tag every outgoing link

Visits only become attributable when links carry marks. Help the user set them up (README «Мітки» has the full table):
- `utm_source` = channel (`linkedin`, `email`, `post`, `signature`, `leadmagnet`), `utm_medium` = touch type (`outreach`, `organic`, `dm`), `utm_campaign` = the hypothesis or campaign name exactly as in the sending tool. Latin, lowercase, hyphens.
- `ref` = the contact's CRM ID, through a custom field in the sending tool (`{{crm_id}}` in Instantly, `{crm_id}` in HeyReach). Make sure the field is filled when the list is uploaded.
- Never put an email or a name into a URL: only the ID.
- No marks on internal links of the site.

`export.py` reads `utm_source`, `utm_campaign` and `ref` from the visited page URL. A visit with `ref` is a known person coming back: route A, in any country, even when no tool identified the company.

## 4. The visits page

`/view/<VIEW_KEY>` shows the visits without any command: one row per company, number of visits, last visit, the evidence page, the people (RB2B), the marks (`utm_source`, `utm_campaign`, `ref`) and route A or B. Switches for 7, 30 and 90 days, a «лише черга A» filter and a CSV button that downloads the same rows (`/view/<VIEW_KEY>/visits.csv?days=7`). The page is `noindex` and lives only behind the key. Anyone with the link sees the visits, so it is shared like a password.

## 5. Weekly export

The CSV button on the page is enough for most users. From the terminal:

```bash
python3 export.py --days 7            # state/visitor_signals.csv
```

One row per company. Columns match the signal block of a prospect list: `signal_type`, `signal_date`, `signal_age_days`, `signal_evidence_url`, `signal_summary`, `signal_route`, plus `visits`, `linkedin_urls`, `utm_source`, `utm_campaign` and `ref`.

- **Route A**: looked at pricing, cases, contact or services pages, or came 3+ times. Write this week.
- **Route B**: everything else. Wait for a second signal.

## 6. Into outreach

1. Run the same stop filters as any list: ICP fit, size, current clients, competitors, existing open deals. Show the user how many companies dropped and why.
2. For a company without a person: find the decision maker and a champion under the company (2-3 people).
3. Put A companies into the CRM with a signal «website visit», its date and the evidence page. Deduplicate people by LinkedIn URL, companies by domain.
4. The first message uses the topic of the page they read as the reason to write.

**Never write «I saw you on our website».** The visitor does not know they were identified, and that opener burns the contact.

## Done when

- `/health` answers `ok` and a test visit is in D1 and on the visits page
- the first week is exported and the A companies were checked by eye
- A companies from the ICP are in the CRM with the signal and date
