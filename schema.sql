-- Visits sent by a tool (RB2B webhook, a company-by-IP tool): one row per visit.
CREATE TABLE IF NOT EXISTS visit (
  linkedin_url TEXT, first_name TEXT, last_name TEXT, title TEXT,
  company TEXT, domain TEXT, email TEXT, website TEXT, industry TEXT, employees TEXT,
  city TEXT, state TEXT, seen_at TEXT NOT NULL, referrer TEXT, page TEXT, tags TEXT,
  UNIQUE (linkedin_url, domain, seen_at, page)
);
CREATE INDEX IF NOT EXISTS visit_seen ON visit (seen_at);

-- Page views from the site's own script (/t.js), no tool needed.
-- The daily job writes company/domain into the row, then wipes ip after 7 days.
CREATE TABLE IF NOT EXISTS hit (
  seen_at TEXT NOT NULL, uid TEXT, ip TEXT, asn INTEGER, as_org TEXT,
  country TEXT, city TEXT, page TEXT, referrer TEXT, company TEXT, domain TEXT
);
CREATE INDEX IF NOT EXISTS hit_seen ON hit (seen_at);
CREATE INDEX IF NOT EXISTS hit_ip ON hit (ip);

-- IP → company cache, 30 days. status: ok | low | hosting | not_found | asn (free: a corporate network name).
CREATE TABLE IF NOT EXISTS ip_company (
  ip TEXT PRIMARY KEY, status TEXT NOT NULL, domain TEXT, company TEXT, conf REAL, resolved_at TEXT NOT NULL
);

-- What the visits page and export.py read: tool visits + own-script page views.
DROP VIEW IF EXISTS visit_all;
CREATE VIEW visit_all AS
SELECT linkedin_url, first_name, last_name, title, company, domain, email, website, industry, employees,
       city, state, seen_at, referrer, page, tags FROM visit
UNION ALL
SELECT NULL, NULL, NULL, NULL, company, domain, NULL, NULL, NULL, NULL,
       city, country, seen_at, referrer, page, 'script' FROM hit;
