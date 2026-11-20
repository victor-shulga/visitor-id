"""python3 test_export.py → "export test ok" (no network)."""
from datetime import date
from export import to_signals

rows = [
    {"domain": "acme.com", "company": "Acme", "seen_at": "2026-11-18T09:00:00", "page": "https://you.com/blog/x", "linkedin_url": "https://linkedin.com/in/a", "first_name": "Ann", "last_name": "Lee", "title": "CTO"},
    {"domain": "acme.com", "company": "Acme", "seen_at": "2026-11-19T09:00:00", "page": "https://you.com/pricing", "linkedin_url": None},
    {"domain": "beta.io", "company": "Beta", "seen_at": "2026-11-10T09:00:00", "page": "https://you.com/", "linkedin_url": None},
    {"domain": None, "linkedin_url": None, "seen_at": "2026-11-10T09:00:00"},
]
s = to_signals(rows, today=date(2026, 11, 20))
assert [x["domain"] for x in s] == ["acme.com", "beta.io"]
assert s[0]["signal_route"] == "A" and s[0]["visits"] == 2 and s[0]["signal_evidence_url"].endswith("/pricing")
assert s[0]["signal_age_days"] == 1 and "Ann Lee (CTO)" in s[0]["signal_summary"]
assert s[1]["signal_route"] == "B"
assert to_signals(rows, min_visits=2, today=date(2026, 11, 20))[0]["domain"] == "acme.com"
assert len(to_signals(rows, min_visits=2, today=date(2026, 11, 20))) == 1
print("export test ok")
