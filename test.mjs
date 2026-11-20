// node test.mjs  → "visitor-id test ok"  (no network)
import assert from "node:assert/strict";
import worker, { normalize } from "./worker.js";

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
console.log("visitor-id test ok");
