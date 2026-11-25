// node test.mjs  → "visitor-id test ok"  (no network)
import assert from "node:assert/strict";
import worker, { normalize, toSignals, toCsv } from "./worker.js";

const r = normalize({ "LinkedIn URL": "https://linkedin.com/in/a", "Company Name": "Acme", "Website": "https://www.Acme.com/about",
  "Captured URL": "https://you.com/pricing", "Tags": ["Hot Pages", "ICP"], "Seen At": "2026-11-20T10:00:00Z" });
assert.equal(r.domain, "acme.com");
assert.equal(r.tags, "Hot Pages, ICP");
assert.equal(normalize({ "Business Email": "jo@beta.io" }).domain, "beta.io");

let bound = null;
const env = { HOOK_SECRET: "s3", DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { bound = { sql, a }; } }) }) } };
const post = (path, body) => worker.fetch(new Request("https://x" + path, { method: "POST", body: JSON.stringify(body) }), env);

assert.equal((await post("/hook/wrong", {})).status, 404);
assert.equal(await (await post("/hook/s3", { "Title": "CTO" })).text(), "skipped: no person, no company, no ref");
assert.equal(bound, null);
assert.equal((await post("/hook/s3", { "LinkedIn URL": "https://linkedin.com/in/a", "Website": "acme.com" })).status, 200);
assert.match(bound.sql, /^INSERT OR IGNORE INTO visit/);
bound = null;
assert.equal((await post("/hook/s3", { "Captured URL": "https://you.com/cases?ref=c42" })).status, 200);
assert.ok(bound, "a visit with only ref= is kept");
assert.equal((await worker.fetch(new Request("https://x/health"), env)).status, 200);

// visits page + CSV
const rows = [
  { domain: "acme.com", company: "Acme", seen_at: "2026-11-20T10:00:00Z", page: "https://you.com/blog/x" },
  { domain: "acme.com", company: "Acme", seen_at: "2026-11-21T10:00:00Z", page: "https://you.com/pricing?utm_source=email&utm_campaign=long-hiring",
    linkedin_url: "https://linkedin.com/in/a", first_name: "Ann", last_name: "Lee", title: "CTO" },
  { domain: "beta.io", company: "Beta, Inc", seen_at: "2026-11-22T10:00:00Z", page: "https://you.com/blog/y" },
  { seen_at: "2026-11-22T11:00:00Z", page: "https://you.com/cases?ref=c42" },
];
const sig = toSignals(rows, new Date("2026-11-25"));
assert.deepEqual(sig.map((s) => [s.domain || s.ref, s.signal_route, s.visits]), [["acme.com", "A", 2], ["c42", "A", 1], ["beta.io", "B", 1]]);
assert.equal(sig[0].signal_evidence_url, "https://you.com/pricing?utm_source=email&utm_campaign=long-hiring");
assert.equal(sig[0].utm_campaign, "long-hiring");
assert.equal(sig[0].signal_age_days, 4);
assert.match(toCsv(sig), /"Beta, Inc"/);

const viewEnv = { VIEW_KEY: "v9", DB: { prepare: () => ({ bind: (d) => ({ all: async () => { viewEnv.days = d; return { results: rows }; } }) }) } };
const get = (path) => worker.fetch(new Request("https://x" + path), viewEnv);
assert.equal((await get("/view/wrong")).status, 404);
assert.equal((await worker.fetch(new Request("https://x/view/"), { DB: viewEnv.DB })).status, 404, "no VIEW_KEY = no page");
const html = await (await get("/view/v9?days=30")).text();
assert.equal(viewEnv.days, "-30 days");
assert.match(html, /3 компаній за 30 днів · черга A: 2/);
assert.match(html, /Ann Lee \(CTO\)/);
const evil = toSignals([{ domain: "x.com", company: "<script>", seen_at: "2026-11-22T10:00:00Z", page: "/" }]);
assert.doesNotMatch((await import("./worker.js")).page(evil, 7, "/view/k"), /<script>alert|<b><script>/);
const csvRes = await get("/view/v9/visits.csv?days=7");
assert.match(csvRes.headers.get("content-type"), /text\/csv/);
assert.match(await csvRes.text(), /^domain,company,visits/);
console.log("visitor-id test ok");
