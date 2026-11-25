// node test.mjs  → "visitor-id test ok"  (no network)
import assert from "node:assert/strict";
import worker, { normalize, toSignals, toCsv, noise, pickCompany, asnCompany, daily } from "./worker.js";

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

// own collector: filters
assert.equal(noise("Mozilla/5.0 Chrome/120", { asn: 3320, asOrganization: "Acme Corp" }, "/pricing"), "");
assert.equal(noise("Googlebot/2.1", {}, "/"), "bot");
assert.equal(noise("Mozilla/5.0", { asn: 16509, asOrganization: "Amazon.com" }, "/"), "hosting");
assert.equal(noise("Mozilla/5.0", { asOrganization: "T-Mobile USA" }, "/"), "mobile");
assert.equal(noise("Mozilla/5.0", { asOrganization: "Acme" }, "/.env"), "probe");

// MoltSets answer → company, same rule as the author's tracker
assert.deepEqual(pickCompany({ status: "ok", results: [{ companies: [{ domain: "https://www.acme.com", percentage: 0.8 }, { domain: "x.com", percentage: 0.1 }] }] }),
  { status: "ok", domain: "acme.com", company: null, conf: 0.8 });
assert.equal(pickCompany({ status: "ok", results: [{ companies: [{ domain: "a.com", percentage: 0.4 }, { domain: "b.com", percentage: 0.3 }] }] }).status, "low");
assert.equal(pickCompany({ status: "ok", results: [{ companies: [{ domain: "namecheap.com", percentage: 0.9 }] }] }).status, "hosting");
assert.equal(pickCompany({ status: "ok", results: [{ companies: [{ domain: "gmail.com", percentage: 0.9 }] }] }).status, "low");
assert.equal(pickCompany({ status: "not_found" }).status, "not_found");
assert.deepEqual(asnCompany("Acme Software GmbH"), { status: "asn", company: "Acme Software GmbH" });
assert.equal(asnCompany("Comcast Cable Communications").status, "not_found");

// /t.js and /t
const js = await (await worker.fetch(new Request("https://vid.example.workers.dev/t.js"), {})).text();
assert.match(js, /https:\/\/vid\.example\.workers\.dev\/t/);
let hits = [];
const hitEnv = { SITE_HOSTS: "you.com", DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => hits.push({ sql, a }) }) }) } };
const beacon = (body, ua = "Mozilla/5.0 Chrome/120", cf = { asn: 3320, asOrganization: "Acme Corp", country: "US" }) => {
  const r = new Request("https://vid/t", { method: "POST", body: JSON.stringify(body), headers: { "User-Agent": ua, "CF-Connecting-IP": "1.2.3.4" } });
  Object.defineProperty(r, "cf", { value: cf });
  return worker.fetch(r, hitEnv);
};
assert.equal((await beacon({ u: "https://www.you.com/pricing?ref=c42", r: "https://linkedin.com", id: "u1" })).status, 204);
assert.equal(hits.length, 1);
assert.match(hits[0].sql, /^INSERT INTO hit/);
assert.equal(hits[0].a[2], "1.2.3.4");
await beacon({ u: "https://other.com/", id: "u1" });
await beacon({ u: "https://you.com/", id: "u1" }, "Googlebot");
await beacon({ u: "https://you.com/", id: "u1" }, undefined, { asn: 16509, asOrganization: "Amazon.com" });
assert.equal(hits.length, 1, "foreign site, bot and hosting are not visits");

// daily: resolve, write company into page views, wipe old IPs
const calls = [];
const dEnv = { DB: { prepare: (sql) => ({ bind: (...a) => ({ all: async () => ({ results: [{ ip: "1.2.3.4", org: "Acme Software GmbH" }, { ip: "5.6.7.8", org: "Comcast Cable" }] }),
  run: async () => calls.push({ sql, a }) }), run: async () => calls.push({ sql, a: [] }) }) } };
assert.equal(await daily(dEnv), 2);
const ins = calls.filter((c) => /INSERT OR REPLACE INTO ip_company/.test(c.sql)).map((c) => c.a.slice(0, 4));
assert.deepEqual(ins, [["1.2.3.4", "asn", null, "Acme Software GmbH"], ["5.6.7.8", "not_found", null, null]]);
assert.ok(calls.some((c) => /SET ip = NULL/.test(c.sql)), "old IPs are wiped");
console.log("visitor-id test ok");
