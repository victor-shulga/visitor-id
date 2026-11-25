// Visitor ID receiver: RB2B (or any tool with the same fields) posts a visitor here, D1 keeps one row per visit.
// POST /hook/<HOOK_SECRET>  → 200 always fast (RB2B disables the integration on non-200 or >15 s)
// GET  /health              → "ok"
// GET  /view/<VIEW_KEY>?days=7            → page: companies, visits, evidence page, route A/B
// GET  /view/<VIEW_KEY>/visits.csv?days=7 → the same rows as CSV (same columns as export.py)

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

const HOT = ["pricing", "price", "case", "contact", "offer", "services"]; // same list as export.py

function marks(page) {
  let q;
  try { q = new URL(page || "", "https://x").searchParams; } catch { q = new URLSearchParams(); }
  return Object.fromEntries(["utm_source", "utm_campaign", "ref"].map((k) => [k, (q.get(k) || "").trim().toLowerCase()]));
}
const pathOf = (page) => { try { return new URL(page || "", "https://x").pathname.toLowerCase(); } catch { return ""; } };
const joined = (vs, k) => [...new Set(vs.map((v) => marks(v.page)[k]).filter(Boolean))].sort().join(" ");

// One row per company, strongest first. Mirror of export.py to_signals: change both together.
export function toSignals(rows, today = new Date()) {
  const by = new Map();
  for (const r of rows) {
    const ref = marks(r.page).ref;
    const key = r.domain || r.linkedin_url || (ref && "ref:" + ref);
    if (key) by.set(key, [...(by.get(key) || []), r]);
  }
  const out = [];
  for (const vs of by.values()) {
    const hot = vs.filter((v) => HOT.some((h) => pathOf(v.page).includes(h)));
    const refs = joined(vs, "ref");
    const last = vs.reduce((a, b) => (b.seen_at > a.seen_at ? b : a));
    const people = [...new Set(vs.filter((v) => v.linkedin_url)
      .map((v) => `${v.first_name || ""} ${v.last_name || ""} (${v.title || "?"})`.trim()))].sort();
    out.push({
      domain: vs[0].domain || "", company: last.company || "", visits: vs.length,
      signal_date: last.seen_at.slice(0, 10),
      signal_age_days: Math.floor((today - new Date(last.seen_at.slice(0, 10))) / 864e5),
      signal_evidence_url: (hot.at(-1) || last).page || "",
      people: people.join("; "),
      signal_route: hot.length || refs || vs.length >= 3 ? "A" : "B",
      utm_source: joined(vs, "utm_source"), utm_campaign: joined(vs, "utm_campaign"), ref: refs,
      linkedin_urls: [...new Set(vs.map((v) => v.linkedin_url).filter(Boolean))].sort().join(" "),
    });
  }
  return out.sort((a, b) => a.signal_route.localeCompare(b.signal_route) || b.visits - a.visits);
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const csvCell = (v) => /[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? "");

export function toCsv(sig) {
  const cols = sig.length ? Object.keys(sig[0]) : ["domain"];
  return [cols.join(","), ...sig.map((s) => cols.map((c) => csvCell(s[c])).join(","))].join("\n") + "\n";
}

export function page(sig, days, base) {
  const a = sig.filter((s) => s.signal_route === "A").length;
  const rows = sig.map((s) => `<tr class="${s.signal_route}"><td><b>${esc(s.company || s.domain || "невідома компанія")}</b><small>${esc(s.domain)}</small></td>
<td class="n">${s.visits}</td><td>${esc(s.signal_date)}</td><td class="pg">${esc(pathOf(s.signal_evidence_url) || "/")}</td>
<td>${s.people ? esc(s.people) : "<i>лише компанія</i>"}</td><td>${esc([s.utm_source, s.utm_campaign, s.ref && "ref " + s.ref].filter(Boolean).join(" · "))}</td>
<td class="r"><span>${s.signal_route}</span></td></tr>`).join("");
  const tab = (d) => `<a href="${base}?days=${d}"${d === days ? ' class="on"' : ""}>${d} днів</a>`;
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Візити на сайт</title><style>
body{margin:0;background:#EEF2F6;font:15px/1.4 system-ui,sans-serif;color:#161513}
main{max-width:1100px;margin:0 auto;padding:28px 16px}h1{margin:0 0 4px;font-size:26px}
.top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:16px}
.k{color:#55606E}.tabs a,.csv{display:inline-block;padding:6px 12px;border:1px solid #D5DDE6;border-radius:8px;background:#fff;color:#161513;text-decoration:none;margin-right:6px}
.tabs a.on,#onlyA.on{background:#3D3D3A;color:#fff;border-color:#3D3D3A}
#onlyA{font:inherit;padding:6px 12px;border:1px solid #D5DDE6;border-radius:8px;background:#fff;color:#161513;cursor:pointer;margin-bottom:12px}
.card{background:#fff;border:1px solid #D5DDE6;border-radius:12px;overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:760px}th{font-size:12px;text-transform:uppercase;color:#7D8A99;text-align:left;padding:10px 12px;border-bottom:1px solid #D5DDE6}
td{padding:10px 12px;border-bottom:1px solid #E4EAF0;vertical-align:top}td small{display:block;color:#7D8A99}
.n{font-weight:700}.pg{font-family:ui-monospace,monospace;color:#C24235}.r span{display:inline-block;width:24px;text-align:center;border-radius:6px;font-weight:700;background:#E4EAF0}
tr.A .r span{background:#E85A4F;color:#fff}.empty{padding:28px;color:#55606E}
</style></head><body><main>
<div class="top"><div><h1>Візити на сайт</h1><div class="k">${sig.length} компаній за ${days} днів · черга A: ${a}</div></div>
<div><span class="tabs">${[7, 30, 90].map(tab).join("")}</span><a class="csv" href="${base}/visits.csv?days=${days}">CSV</a></div></div>
<button id="onlyA" type="button">лише черга A</button>
<div class="card">${sig.length ? `<table><tr><th>Компанія</th><th>Візити</th><th>Останній</th><th>Сторінка</th><th>Люди</th><th>Мітки</th><th>Черга</th></tr>${rows}</table>`
    : `<div class="empty">За ${days} днів візитів немає. Перевірте, що вебхук джерела дивиться на /hook/…</div>`}</div>
<p class="k">A: ціни, кейси, контакти чи послуги, 3+ візити або повернення за ref. B: решта, чекаємо другого сигналу.</p>
</main><script>onlyA.onclick=()=>{const on=onlyA.classList.toggle("on");document.querySelectorAll("tr.B").forEach(t=>t.hidden=on)}</script></body></html>`;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    const base = `/view/${env.VIEW_KEY}`;
    const csv = url.pathname === `${base}/visits.csv`;
    if (env.VIEW_KEY && req.method === "GET" && (url.pathname === base || csv)) {
      const days = Math.min(Math.max(parseInt(url.searchParams.get("days")) || 7, 1), 365);
      const { results } = await env.DB.prepare("SELECT * FROM visit WHERE seen_at >= datetime('now', ?) ORDER BY seen_at")
        .bind(`-${days} days`).all();
      const sig = toSignals(results || []);
      const h = { "cache-control": "no-store", "x-robots-tag": "noindex" };
      return csv
        ? new Response(toCsv(sig), { headers: { ...h, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="visitor_signals_${days}d.csv"` } })
        : new Response(page(sig, days, base), { headers: { ...h, "content-type": "text/html; charset=utf-8" } });
    }
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
