CREATE TABLE IF NOT EXISTS visit (
  linkedin_url TEXT, first_name TEXT, last_name TEXT, title TEXT,
  company TEXT, domain TEXT, email TEXT, website TEXT, industry TEXT, employees TEXT,
  city TEXT, state TEXT, seen_at TEXT NOT NULL, referrer TEXT, page TEXT, tags TEXT,
  UNIQUE (linkedin_url, domain, seen_at, page)
);
CREATE INDEX IF NOT EXISTS visit_seen ON visit (seen_at);
