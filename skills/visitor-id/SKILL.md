---
name: visitor-id
description: Turns website visits into outreach signals for a B2B service company. Sets up a small Cloudflare Worker + D1 that receives visitors from RB2B (person-level, US traffic) or any company-by-IP tool (Snitcher, Leadfeeder, Dealfront, LinkedIn Insight Tag exports), then exports the last N days as a signal CSV - company, date, the page that proves intent, and a route A (write this week) or B (wait for a second signal) - ready for the prospect list and CRM. Use when someone says "хто заходив на сайт", "visitor identification", "visitor ID", "RB2B", "ідентифікація відвідувачів", "відвідувачі сайту в аутріч", "website visitors to leads", "intent from website", or sets up intent signals for outbound. NOT for web analytics or traffic reports (use Search Console or GA), NOT for signals that are events outside your site (jobs, funding, tenders: that is the signal radar).
---

# Visitor ID

A visit to your site is an intent signal: the person already knows you. This skill collects visits in one place and hands them to outreach in the same columns as any other signal.

The code lives in this repository: `worker.js` (receiver), `schema.sql`, `wrangler.toml`, `export.py`. This skill drives it: setup, connecting a source, the weekly export and the routing rules.

## Required tools

| Tool | Used for | Required? | Without it |
|---|---|---|---|
| Claude Code | cloning, running wrangler and `export.py` | Required | in claude.ai the skill can only explain the steps; the user runs every command |
| Node.js (npx) + Python 3 | wrangler, tests, export | Required | nothing deploys |
| Cloudflare account (Workers + D1, free tier is enough) | receiving and storing visits | Required | no place for visits to land |
| RB2B | person-level visitors (name, title, LinkedIn) | One source is required | US visitors stay anonymous |
| A company-by-IP tool with webhook or CSV | company-level visitors in any country | One source is required | non-US visitors stay anonymous |
| Slack + Slack MCP | only for the free RB2B plan, which posts to Slack instead of a webhook | Optional | use a paid RB2B plan with webhook |

## What is realistic

Say this to the user before setup, so nobody expects names from Europe:
- RB2B gives a person only for US visitors: it matches cookies from US ad networks. Outside the US this cannot be repeated legally or technically.
- For Europe and the rest: only the company (by office IP) and people you already know (your own links with `?ref=<id>`, LinkedIn sign-in on a lead magnet).

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
npx wrangler deploy
curl https://visitor-id.<account>.workers.dev/health   # ok
```

Never print or store the secret in chat. The hook URL is `https://visitor-id.<account>.workers.dev/hook/<HOOK_SECRET>`.

## 3. Connect a source

- **RB2B with webhook**: Integrations → Webhook → the hook URL. RB2B switches the integration off after a non-200 or a reply slower than 15 s; the worker only writes and answers at once, keep it that way.
- **RB2B free plan (Slack only)**: schedule a daily task: read yesterday's messages in the RB2B Slack channel, turn each into JSON with the fields `LinkedIn URL`, `First Name`, `Last Name`, `Title`, `Company Name`, `Website`, `Captured URL`, `Seen At`, POST each to the hook URL.
- **Company-by-IP tools**: webhook to the same URL, or a CSV with `Company Name`, `Website`, `Captured URL`, `Seen At` posted row by row. A visit without a person is accepted.

Send one test visit and check it landed: `npx wrangler d1 execute visitor-id --remote --command "SELECT * FROM visit ORDER BY seen_at DESC LIMIT 3"`.

## 4. Weekly export

```bash
python3 export.py --days 7            # state/visitor_signals.csv
```

One row per company. Columns match the signal block of a prospect list: `signal_type`, `signal_date`, `signal_age_days`, `signal_evidence_url`, `signal_summary`, `signal_route`, plus `visits` and `linkedin_urls`.

- **Route A**: looked at pricing, cases, contact or services pages, or came 3+ times. Write this week.
- **Route B**: everything else. Wait for a second signal.

## 5. Into outreach

1. Run the same stop filters as any list: ICP fit, size, current clients, competitors, existing open deals. Show the user how many companies dropped and why.
2. For a company without a person: find the decision maker and a champion under the company (2-3 people).
3. Put A companies into the CRM with a signal «website visit», its date and the evidence page. Deduplicate people by LinkedIn URL, companies by domain.
4. The first message uses the topic of the page they read as the reason to write.

**Never write «I saw you on our website».** The visitor does not know they were identified, and that opener burns the contact.

## Done when

- `/health` answers `ok` and a test visit is in D1
- the first week is exported and the A companies were checked by eye
- A companies from the ICP are in the CRM with the signal and date
