// Visitor ID receiver: RB2B (or any tool with the same fields) posts a visitor here, D1 keeps one row per visit.
// POST /hook/<HOOK_SECRET>  → 200 always fast (RB2B disables the integration on non-200 or >15 s)
// GET  /health              → "ok"
// Export for the radar: python3 export.py (reads D1 through wrangler, no public read endpoint here).

const FIELDS = {
  linkedin_url: ["LinkedIn URL", "linkedin_url"],
  first_name: ["First Name", "first_name"],
  last_name: ["Last Name", "last_name"],
  title: ["Title", "title"],
  company: ["Company Name", "company_name", "Company"],
  email: ["Business Email", "business_email"],
  website: ["Website", "website"],
  industry: ["Industry", "industry"],
  employees: ["Employee Count", "employee_count"],
  city: ["City", "city"],
  state: ["State", "state"],
  seen_at: ["Seen At", "seen_at"],
  referrer: ["Referrer", "referrer"],
  page: ["Captured URL", "captured_url"],
  tags: ["Tags", "tags"],
};

export function normalize(body) {
  const row = {};
  for (const [k, names] of Object.entries(FIELDS)) {
    const v = names.map((n) => body[n]).find((x) => x !== undefined && x !== null && x !== "");
    row[k] = Array.isArray(v) ? v.join(", ") : v == null ? null : String(v).slice(0, 500);
  }
  row.seen_at = row.seen_at || new Date().toISOString();
  row.domain = (row.website || (row.email || "").split("@")[1] || "")
    .toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  return row;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (req.method !== "POST" || url.pathname !== `/hook/${env.HOOK_SECRET}` || !env.HOOK_SECRET)
      return new Response("not found", { status: 404 });
    let body;
    try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
    const r = normalize(body);
    if (!r.linkedin_url && !r.domain && !/[?&]ref=/.test(r.page || "")) return new Response("skipped: no person, no company, no ref");
    const cols = Object.keys(r);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO visit (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`
    ).bind(...cols.map((c) => r[c])).run();
    return new Response("ok");
  },
};
