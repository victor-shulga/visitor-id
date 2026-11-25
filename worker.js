// Visitor ID receiver: RB2B (or any tool with the same fields) posts a visitor here, D1 keeps one row per visit.
// POST /hook/<HOOK_SECRET>  → 200 always fast (RB2B disables the integration on non-200 or >15 s)
// GET  /t.js                → collector for your site: <script async src="https://<worker>/t.js"></script>
// POST /t                   → one page view from that script (bots, hosting/VPN, mobile carriers and probes dropped)
// cron (daily)              → IP → company (MoltSets if MOLTSETS_KEY is set, else corporate network name), ip wiped after 7 days
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


// ---- Own collector: page views without RB2B or any other tool ------------------------------------
// Same filters as the author's own site tracker: a bot, a hosting/VPN network, a mobile carrier (CGNAT never maps to
// a company) or a scanner probe is not a visit.
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|python-requests|python-urllib|curl\/|wget|go-http-client|httpx|axios|node-fetch|okhttp|java\/|libwww|lighthouse|pagespeed|pingdom|uptime|monitor|scrapy|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|anthropic|openai|perplexity|applebot|bingpreview|yandex|duckduck|archive\.org|dataforseo|screaming|feedfetcher|validator|phantomjs|puppeteer|playwright|selenium/i;
const DC_ASN = new Set([13335, 15169, 396982, 16509, 14618, 8075, 14061, 16276, 24940, 63949, 20473, 31898, 9009, 212238,
  45102, 37963, 132203, 20940, 54113, 19551, 22612, 36351, 46606, 26496, 47583, 55293, 53667, 12876,
  51167, 197540, 60781, 49981, 62904, 40676, 25820, 396356, 398324, 209, 395403, 136787, 141995, 174]);
const HOSTING = /hosting|cloud|datacenter|data center|server|\bsrv\b|vpn|proxy|colo|digitalocean|hetzner|ovh|linode|vultr|amazon|google llc|microsoft|oracle|alibaba|tencent|m247|datacamp|choopa|leaseweb|contabo|scaleway|psychz|zenlayer|gcore|stackpath|fastly|akamai|cdn77|limelight|incapsula|sucuri|namecheap|godaddy|hostinger|ionos|hostgator|bluehost|dreamhost|siteground|kamatera|upcloud|hivelocity|quadranet|nordvpn|expressvpn|surfshark|mullvad|private internet|windscribe|protonvpn|cyberghost|ipvanish|purevpn/i;
const MOBILE = /kyivstar|lifecell|vodafone|t-mobile|tmobile|telekom.*mobil|orange|\bo2\b|three|\bee\b|verizon wireless|at&t mobility|sprint|cellular|wireless|mobile|\bgsm\b|\blte\b|telenor|telia|\bmts\b|megafon|beeline|tele2|\bplay\b|plus gsm|polkomtel|p4 sp|\btim\b|wind tre|iliad|\bdigi\b|yettel|a1 |cgnat|carrier grade nat/i;
// Consumer ISPs: the network name says nothing about the visitor, so the free fallback never uses it.
const ISP = /telecom|telekom|telco|internet|broadband|\bisp\b|communication|cable|fiber|fibre|\bnet\b|network|provider|online|comcast|charter|spectrum|cox|frontier|centurylink|lumen|verizon|at&t|\bbt\b|\bsky\b|virgin|talktalk|deutsche|sfr|bouygues|kpn|ziggo|upc|netia|ukrtelecom|volia|kyivstar|triolan|lanet|datagroup/i;
const SCAN = /\/\.(env|aws|git|config|ssh|svn|DS_Store|vscode|idea|docker)|xmlrpc\.php|wp-includes|wp-admin|wp-login|wp-json|wlwmanifest|phpinfo|\.php(\?|$)|cgi-bin|\/phpmyadmin|\.sql(\?|$)|\.bak(\?|$)|\/actuator|\/server-status/i;
const HOST_DOMAIN = /^(namecheap|automattic|wordpress|hetzner|ovh|ovhcloud|digitalocean|contabo|cloudflare|godaddy|hostinger|ionos|linode|akamai|vultr|leaseweb|scaleway|amazon|aws|google|microsoft|azure|oracle|m247|gcore|fastly|stackpath|incapsula|sucuri|imperva|zscaler|fortinet|cisco|opendns|nordvpn|expressvpn|surfshark|mullvad|protonvpn)\.|host|cloud|server|vpn|proxy|cdn/i;
const FREE_MAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|proton|protonmail|gmx|mail|yandex|ukr|i\.ua|meta\.ua)\./i;

// Why a request is not a visit, or "" when it is one.
export function noise(ua, cf = {}, page = "") {
  if (!ua || BOT_UA.test(ua) || cf.verifiedBotCategory) return "bot";
  const org = String(cf.asOrganization || "");
  if (DC_ASN.has(Number(cf.asn)) || HOSTING.test(org)) return "hosting";
  if (MOBILE.test(org)) return "mobile";
  if (SCAN.test(page)) return "probe";
  return "";
}

// The collector: one beacon per page view, a first-party id in localStorage so repeat visits of one browser add up.
const SNIPPET = (origin) => `(function(){try{var k="vid_uid",u=localStorage.getItem(k);if(!u){u=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem(k,u)}
var b=JSON.stringify({u:location.href,r:document.referrer,id:u});
if(!(navigator.sendBeacon&&navigator.sendBeacon("${origin}/t",b)))fetch("${origin}/t",{method:"POST",body:b,keepalive:true,mode:"no-cors"})}catch(e){}})();`;

async function collect(req, env) {
  let b;
  try { b = JSON.parse(await req.text()); } catch { return new Response(null, { status: 204 }); }
  const cf = req.cf || {};
  const page = String(b.u || "").slice(0, 500);
  let host = "";
  try { host = new URL(page).hostname.replace(/^www\./, ""); } catch { return new Response(null, { status: 204 }); }
  // SITE_HOSTS = "you.com,blog.you.com": anything else posting here is ignored
  const allowed = String(env.SITE_HOSTS || "").split(",").map((h) => h.trim().replace(/^www\./, "")).filter(Boolean);
  if (allowed.length && !allowed.includes(host)) return new Response(null, { status: 204 });
  if (noise(req.headers.get("User-Agent") || "", cf, new URL(page).pathname)) return new Response(null, { status: 204 });
  await env.DB.prepare("INSERT INTO hit (seen_at, uid, ip, asn, as_org, country, city, page, referrer) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(new Date().toISOString(), String(b.id || "").slice(0, 40) || null, req.headers.get("CF-Connecting-IP"),
      Number(cf.asn) || null, cf.asOrganization || null, cf.country || null, cf.city || null, page, String(b.r || "").slice(0, 500) || null)
    .run();
  return new Response(null, { status: 204 });
}

// MoltSets answers with weighted candidates. Same rule as the author's tracker: the top domain needs >= 50 % and twice
// the runner-up; a free mailbox or a hosting provider behind the IP is not a company.
export function pickCompany(r) {
  const res = r && r.results;
  if (!res || r.status === "not_found") return { status: "not_found" };
  const rec = Array.isArray(res) ? res[0] : res;
  const c = [];
  if (rec && typeof rec === "object") {
    for (const x of rec.companies || []) {
      const d = String(x.domain || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase();
      if (d) c.push([Number(x.percentage) || 0, d, x.name || null]);
    }
    if (!c.length && rec.domain) c.push([1, String(rec.domain).toLowerCase(), rec.name || null]);
  } else if (typeof rec === "string") c.push([1, rec.toLowerCase(), null]);
  if (!c.length) return { status: "not_found" };
  c.sort((a, b) => b[0] - a[0]);
  const [top, second = [0]] = c;
  let status = top[0] >= 0.5 && (!second[0] || top[0] / second[0] >= 2) ? "ok" : "low";
  if (status === "ok" && FREE_MAIL.test(top[1])) status = "low";
  if (status === "ok" && HOST_DOMAIN.test(top[1])) status = "hosting";
  return { status, domain: top[1], company: top[2], conf: top[0] };
}

// Free fallback without a key: a network named after a company (not an ISP) is that company's office.
export function asnCompany(org) {
  const o = String(org || "").trim();
  return o && !ISP.test(o) && !HOSTING.test(o) && !MOBILE.test(o) ? { status: "asn", company: o } : { status: "not_found" };
}

async function resolveIp(ip, org, env) {
  if (!env.MOLTSETS_KEY) return asnCompany(org);
  const r = await fetch("https://api.moltsets.com/api/v1/tools/ip_to_company", {
    method: "POST", headers: { Authorization: `Bearer ${env.MOLTSETS_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ip_address: ip }),
  });
  if (r.status === 429) throw new Error("fair-use");
  return r.ok ? pickCompany(await r.json()) : { status: "not_found" };
}

// Daily: resolve new IPs (cache 30 days, at most MAX_RESOLVE a day, 1 MoltSets token per hit), write the company into
// the page views, wipe IPs older than 7 days.
export async function daily(env, now = new Date()) {
  const cap = parseInt(env.MAX_RESOLVE) || 50;
  const { results: ips } = await env.DB.prepare(
    `SELECT h.ip, MAX(h.as_org) AS org FROM hit h LEFT JOIN ip_company c ON c.ip = h.ip
     WHERE h.ip IS NOT NULL AND h.domain IS NULL AND h.company IS NULL
       AND (c.ip IS NULL OR c.resolved_at < datetime('now', '-30 days'))
     GROUP BY h.ip LIMIT ?`).bind(cap).all();
  let done = 0;
  for (const { ip, org } of ips || []) {
    let r;
    try { r = await resolveIp(ip, org, env); } catch { break; }   // fair-use window full: try again tomorrow
    await env.DB.prepare("INSERT OR REPLACE INTO ip_company (ip, status, domain, company, conf, resolved_at) VALUES (?,?,?,?,?,?)")
      .bind(ip, r.status, r.domain || null, r.company || null, r.conf ?? null, now.toISOString()).run();
    done++;
  }
  await env.DB.prepare(
    `UPDATE hit SET domain = (SELECT domain FROM ip_company c WHERE c.ip = hit.ip AND c.status IN ('ok','asn')),
                    company = (SELECT COALESCE(company, domain) FROM ip_company c WHERE c.ip = hit.ip AND c.status IN ('ok','asn'))
     WHERE ip IS NOT NULL AND domain IS NULL AND company IS NULL`).run();
  await env.DB.prepare("UPDATE hit SET ip = NULL WHERE ip IS NOT NULL AND seen_at < datetime('now', '-7 days')").run();
  return done;
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
    if (url.pathname === "/t.js") return new Response(SNIPPET(url.origin), {
      headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=3600" } });
    if (url.pathname === "/t" && req.method === "POST") return collect(req, env);
    const base = `/view/${env.VIEW_KEY}`;
    const csv = url.pathname === `${base}/visits.csv`;
    if (env.VIEW_KEY && req.method === "GET" && (url.pathname === base || csv)) {
      const days = Math.min(Math.max(parseInt(url.searchParams.get("days")) || 7, 1), 365);
      const { results } = await env.DB.prepare("SELECT * FROM visit_all WHERE seen_at >= datetime('now', ?) ORDER BY seen_at")
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
  async scheduled(event, env, ctx) {
    ctx.waitUntil(daily(env));
  },
};
