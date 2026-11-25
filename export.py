#!/usr/bin/env python3
"""Visits from D1 → CSV in the radar's signal format (same columns as radar.py signals).

    python3 export.py                 # last 7 days → state/visitor_signals.csv
    python3 export.py --days 30 --min-visits 2

One row per company (domain), the strongest evidence first: most visits, then pricing/case pages.
utm_source / utm_campaign / ref are read from the visited page url (see «Мітки» in README).
A visit with ref=<contact id> is a known person coming back: always route A.
Needs `npx wrangler login` done once in this folder.
"""
import argparse
import csv
import json
import subprocess
from datetime import date
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HOT = ("pricing", "price", "case", "contact", "offer", "services")  # pages that show buying intent


def query(days):
    sql = (f"SELECT * FROM visit_all WHERE seen_at >= datetime('now', '-{int(days)} days') ORDER BY seen_at")
    out = subprocess.run(["npx", "wrangler", "d1", "execute", "visitor-id", "--remote", "--json", "--command", sql],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)[0]["results"]


def marks(url):
    """utm_source, utm_campaign and ref from a page url ('' when absent)."""
    q = parse_qs(urlparse(url or "").query)
    return {k: (q.get(k) or [""])[0].strip().lower() for k in ("utm_source", "utm_campaign", "ref")}


def joined(vs, key):
    return " ".join(sorted({marks(v.get("page"))[key] for v in vs} - {""}))


def to_signals(rows, min_visits=1, today=None):
    today = today or date.today()
    by = {}
    for r in rows:
        ref = marks(r.get("page"))["ref"]
        key = r.get("domain") or r.get("linkedin_url") or (ref and "ref:" + ref)
        if key:
            by.setdefault(key, []).append(r)
    sig = []
    for key, vs in by.items():
        if len(vs) < min_visits:
            continue
        hot = [v for v in vs if any(h in urlparse(v.get("page") or "").path.lower() for h in HOT)]
        refs = joined(vs, "ref")
        last = max(vs, key=lambda v: v["seen_at"])
        people = sorted({f"{v.get('first_name') or ''} {v.get('last_name') or ''} ({v.get('title') or '?'})".strip()
                         for v in vs if v.get("linkedin_url")})
        sig.append({
            "domain": vs[0].get("domain") or "",
            "company": last.get("company") or "",
            "visits": len(vs),
            "signal_type": "website_visit",
            "signal_date": last["seen_at"][:10],
            "signal_age_days": (today - date.fromisoformat(last["seen_at"][:10])).days,
            "signal_evidence_url": (hot[-1] if hot else last).get("page") or "",
            "signal_summary": f"{len(vs)} візит(и), гарячих сторінок {len(hot)}; люди: {'; '.join(people) or 'лише компанія'}",
            "signal_route": "A" if hot or refs or len(vs) >= 3 else "B",
            "utm_source": joined(vs, "utm_source"),
            "utm_campaign": joined(vs, "utm_campaign"),
            "ref": refs,
            "linkedin_urls": " ".join(sorted({v['linkedin_url'] for v in vs if v.get('linkedin_url')})),
        })
    return sorted(sig, key=lambda s: (s["signal_route"], -s["visits"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--min-visits", type=int, default=1)
    a = ap.parse_args()
    sig = to_signals(query(a.days), a.min_visits)
    out = Path(__file__).parent / "state" / "visitor_signals.csv"
    out.parent.mkdir(exist_ok=True)
    with out.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(sig[0]) if sig else ["domain"])
        w.writeheader()
        w.writerows(sig)
    print(f"{len(sig)} компаній → {out}")


if __name__ == "__main__":
    main()
