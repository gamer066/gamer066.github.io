/* Hack Lab: "From anywhere" (1 Oct 2026). Owner-only lookups that run on the website itself - no laptop needed.

WHAT: five small tools, picked by `what`:
  subdomains  - public certificate records for a domain (crt.sh). Looks ONLY at public information; never touches
                the target site itself.
  secrets     - checks a handful of common exposed-file paths on a site he names (e.g. /.env, /.git/config).
  username    - checks whether a username has a public profile on ~18 big platforms.
  ports       - tries to open a short list of TCP ports on an address he names.
  vuln        - a very basic check (not a real test) for a reflected-script or a database-error message on a page.

WHO: the site owner only, same rule as /api/control (signed in + isOwner). POST only.
  { "what": "subdomains", "domain": "example.com" }
  { "what": "secrets", "url": "https://example.com", "consent": true }
  { "what": "username", "name": "example" }
  { "what": "ports", "host": "example.com", "ports": "22,80,443" (optional), "consent": true }
  { "what": "vuln", "url": "https://example.com", "consent": true }

secrets / ports / vuln all ACTIVELY probe a site or address he names, not just public records, so each one refuses
without `consent: true` (the page only lets him send it once he has ticked "I own this or have permission to test
it" - a reminder, not real proof, the same way a smoke alarm sticker is a reminder, not a lock). subdomains and
username only ever read public information about the NAME he typed, never touch the thing itself, so they need no
checkbox.

Every outside call has a short timeout and a capped read, each tool is limited to 10 tries per 10 minutes (shared
login_attempts table, who = "recon:<tool>"), and nothing here can change, delete or send anything - read only. */

const OWN_UA = "Mozilla/5.0 (SalmanDLife HackLab; +https://salmandlife.pages.dev/hacklab/)";
const MAX_TRIES = 10;
const WINDOW_MINUTES = 10;
const FETCH_MS = 6000;
const PORT_MS = 2000;
const OVERALL_PORT_MS = 9000;   // the whole scan answers by this point no matter what any one port is doing
const MAX_BODY = 4000;          // characters kept from any single response
const DEFAULT_PORTS = [21, 22, 23, 25, 80, 443, 3306, 3389, 8080];

const SECRET_PATHS = ["/.env", "/.git/config", "/config.json", "/wp-config.php.bak", "/.aws/credentials", "/backup.zip"];

/* Each rule was checked against BOTH a real profile and a made-up, almost-certainly-unused name before shipping
   (1 Oct 2026) - a platform that answered 200 for the made-up name too (a single-page app that serves the same
   shell HTML for any name and decides "found" in the visitor's own browser afterwards) is marked "unreliable" and
   always reported as "could not check", rather than risk a confident wrong answer. Checked and found unreliable
   this way: Instagram, TikTok, Twitch, Facebook, Pinterest, Telegram. */
const PLATFORMS = [
  ["GitHub", "https://github.com/{u}", "ok404"],
  ["GitLab", "https://gitlab.com/{u}", "status"],
  ["npm", "https://www.npmjs.com/~{u}", "status"],
  ["Dev.to", "https://dev.to/{u}", "ok404"],
  ["Medium", "https://medium.com/@{u}", "status"],
  ["Twitter / X", "https://x.com/{u}", "ok404"],
  ["Instagram", "https://instagram.com/{u}", "unreliable"],
  ["Reddit", "https://www.reddit.com/user/{u}/about.json", "status"],
  ["TikTok", "https://www.tiktok.com/@{u}", "unreliable"],
  ["YouTube", "https://www.youtube.com/@{u}", "status"],
  ["Twitch", "https://www.twitch.tv/{u}", "unreliable"],
  ["Facebook", "https://www.facebook.com/{u}", "unreliable"],
  ["Pinterest", "https://www.pinterest.com/{u}/", "unreliable"],
  ["Steam", "https://steamcommunity.com/id/{u}", "text:Steam Community :: Error"],
  ["Telegram", "https://t.me/{u}", "unreliable"],
  ["SoundCloud", "https://soundcloud.com/{u}", "status"],
  ["Keybase", "https://keybase.io/{u}", "status"],
  ["Product Hunt", "https://www.producthunt.com/@{u}", "status"]
];

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env, data }) {
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);
  if (request.method !== "POST") return json({ error: "Something went wrong. Try again." }, 405);
  if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
  if (!(await isOwner(env, data.user))) return json({ error: "Only the owner of this site can use the hack lab." }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "That did not look right. Please try again." }, 400); }
  const what = body && body.what;

  const NEEDS_CONSENT = { secrets: 1, ports: 1, vuln: 1 };
  if (NEEDS_CONSENT[what] && body.consent !== true) {
    return json({ error: "Tick \"I own this or have permission to test it\" first." }, 400);
  }

  const gate = await rateLimit(env, "recon:" + (what || "?"));
  if (!gate.ok) return json({ error: "That tool has been used " + MAX_TRIES + " times in the last " + WINDOW_MINUTES + " minutes. Wait a bit and try again." }, 429);

  if (what === "subdomains") return subdomains(body);
  if (what === "secrets") return secrets(body);
  if (what === "username") return username(body);
  if (what === "ports") return ports(body);
  if (what === "vuln") return vuln(body);
  return json({ error: "I did not understand that." }, 400);
}

/* ---------- 1. subdomain hunter: public certificate records only, never touches the site itself ---------- */
async function subdomains(body) {
  const domain = cleanHost(body.domain);
  if (!domain) return json({ error: "Type a domain, like example.com." }, 400);
  let rows;
  try {
    const r = await withTimeout(fetch("https://crt.sh/?q=%25." + encodeURIComponent(domain) + "&output=json",
      { headers: { "User-Agent": OWN_UA } }), FETCH_MS);
    if (!r.ok) return json({ error: "crt.sh did not answer (status " + r.status + "). Try again in a moment." }, 502);
    rows = await r.json();
  } catch (e) { return json({ error: "Could not reach crt.sh. Try again in a moment." }, 502); }
  if (!Array.isArray(rows)) return json({ error: "crt.sh sent back something unexpected." }, 502);
  const set = {};
  rows.forEach(function (row) {
    String((row && row.name_value) || "").split("\n").forEach(function (n) {
      n = n.trim().toLowerCase().replace(/^\*\./, "");
      if (n && n.indexOf(domain) >= 0 && /^[a-z0-9.*-]+$/.test(n)) set[n] = 1;
    });
  });
  const list = Object.keys(set).sort().slice(0, 300);
  return json({ domain: domain, found: list.length, subdomains: list, source: "crt.sh (public certificate records)" });
}

/* ---------- 2. leaked secrets: a handful of well-known exposed-file paths ---------- */
async function secrets(body) {
  const base = cleanUrl(body.url);
  if (!base) return json({ error: "Type a full web address, like https://example.com." }, 400);
  const results = await Promise.all(SECRET_PATHS.map(function (path) {
    return probeOne(base + path).then(function (r) { return { path: path, status: r.status, exposed: r.status === 200, note: r.note }; });
  }));
  const exposedCount = results.filter(function (r) { return r.exposed; }).length;
  return json({ url: base, checked: results.length, exposed: exposedCount, results: results });
}
async function probeOne(url) {
  try {
    const r = await withTimeout(fetch(url, { method: "GET", redirect: "manual", headers: { "User-Agent": OWN_UA } }), FETCH_MS);
    // a small body is read (and thrown away) only to make sure the connection closes cleanly; never kept past MAX_BODY
    try { await withTimeout(r.text(), 2000); } catch (e) {}
    return { status: r.status, note: r.status === 200 ? "found - this really answered" : r.status >= 300 && r.status < 400 ? "redirected (not exposed from this address)" : "not exposed" };
  } catch (e) { return { status: 0, note: "could not check (no answer)" }; }
}

/* ---------- 3. username tracker: does a public profile page exist on ~18 big platforms ---------- */
async function username(body) {
  const name = String(body.name || "").trim();
  if (!name || !/^[A-Za-z0-9_.-]{1,40}$/.test(name)) return json({ error: "Type a username using letters, numbers, dots, dashes or underscores." }, 400);
  const results = await Promise.all(PLATFORMS.map(function (p) {
    const url = p[1].replace("{u}", encodeURIComponent(name));
    return checkProfile(url, p[2]).then(function (r) { return { site: p[0], url: url, state: r }; });
  }));
  return json({ name: name, results: results, note: "Some big platforms block automatic checks, so a few may say \"could not check\" - that is not the same as \"not found\"." });
}
async function checkProfile(url, rule) {
  // a platform that gives the same answer whether the name is real or made up can never be checked this way,
  // so it is marked up front and never even fetched
  if (rule === "unreliable") return "could not check";
  let r;
  try { r = await withTimeout(fetch(url, { headers: { "User-Agent": OWN_UA, "Accept": "text/html,application/json" } }), FETCH_MS); }
  catch (e) { return "could not check"; }
  if (r.status === 429 || r.status === 403) return "could not check";
  if (rule === "ok404") return r.status === 404 ? "not found" : r.status === 200 ? "found" : "could not check";
  if (rule === "status") return r.status === 200 ? "found" : r.status === 404 ? "not found" : "could not check";
  if (rule.indexOf("text:") === 0) {
    const needle = rule.slice(5);
    let text = "";
    try { text = (await withTimeout(r.text(), 3000)).slice(0, MAX_BODY); } catch (e) { return "could not check"; }
    if (r.status !== 200) return "not found";
    return text.indexOf(needle) >= 0 ? "not found" : "found";
  }
  return "could not check";
}

/* ---------- 4. port scanner (cloud): only runs if this Cloudflare plan supports raw TCP from a Function ---------- */
async function ports(body) {
  const host = cleanHost(body.host);
  if (!host) return json({ error: "Type an address, like example.com or 203.0.113.5." }, 400);
  let list = DEFAULT_PORTS;
  if (body.ports) {
    list = String(body.ports).split(",").map(function (s) { return parseInt(s.trim(), 10); })
      .filter(function (n) { return n > 0 && n < 65536; }).slice(0, 20);
    if (!list.length) return json({ error: "That port list did not make sense." }, 400);
  }
  let connectFn;
  try { connectFn = (await import("cloudflare:sockets")).connect; } catch (e) { connectFn = null; }
  if (!connectFn) {
    return json({ error: "Cloud port scanning is not available on this site's current Cloudflare plan. Use the laptop's \"Scan my own laptop's open ports\" instead, or ask for this to run through the laptop.", unavailable: true }, 503);
  }
  // a closed or filtered port can leave the underlying connection in a slow-to-settle state (seen locally: a
  // single closed port took 30+ seconds even with a 2s per-port timeout, because closing it was itself slow) -
  // a hard overall deadline means the reply is never later than this, whatever any one port is doing
  const results = await withTimeout(Promise.all(list.map(function (p) { return tryPort(connectFn, host, p); })), OVERALL_PORT_MS)
    .catch(function () { return list.map(function (p) { return { port: p, open: null }; }); });
  return json({ host: host, results: results });
}
function tryPort(connectFn, host, port) {
  var sock;
  try { sock = connectFn({ hostname: host, port: port }); } catch (e) { return Promise.resolve({ port: port, open: false }); }
  return withTimeout(sock.opened, PORT_MS)
    .then(function () { closeQuietly(sock); return { port: port, open: true }; })
    .catch(function () { closeQuietly(sock); return { port: port, open: false }; });
}
function closeQuietly(sock) {
  // never awaited: closing a half-open socket can itself be slow, and the answer (open/closed) is already known
  try { sock.close().catch(function () {}); } catch (e) {}
}

/* ---------- 5. vulnerability tester: a very basic, surface-only check - not a real security test ---------- */
async function vuln(body) {
  const base = cleanUrl(body.url);
  if (!base) return json({ error: "Type a full web address, like https://example.com/page?id=1." }, 400);
  const sep = base.indexOf("?") >= 0 ? "&" : "?";
  const checks = [];
  try {
    const xssUrl = base + sep + "sdltest=<script>sdltest123</script>";
    const r1 = await withTimeout(fetch(xssUrl, { headers: { "User-Agent": OWN_UA } }), FETCH_MS);
    const t1 = (await withTimeout(r1.text(), 4000)).slice(0, 200000);
    checks.push({ name: "Reflected script", flagged: t1.indexOf("<script>sdltest123</script>") >= 0,
      note: "Checks whether text typed into the page comes straight back out unescaped." });
  } catch (e) { checks.push({ name: "Reflected script", flagged: false, note: "could not check" }); }
  try {
    const sqlUrl = base + sep + "sdltest=1' ";
    const r2 = await withTimeout(fetch(sqlUrl, { headers: { "User-Agent": OWN_UA } }), FETCH_MS);
    const t2 = (await withTimeout(r2.text(), 4000)).slice(0, 200000).toLowerCase();
    const hit = ["sql syntax", "mysql_fetch", "ora-01756", "sqlstate", "unclosed quotation mark"].some(function (s) { return t2.indexOf(s) >= 0; });
    checks.push({ name: "Database error message", flagged: hit, note: "Checks whether a stray quote mark makes the page show a database error." });
  } catch (e) { checks.push({ name: "Database error message", flagged: false, note: "could not check" }); }
  return json({ url: base, checks: checks, warning: "This is a very basic surface check, not a real security test. A clean result does not mean the site is safe." });
}

/* ---------- small shared helpers ---------- */
function withTimeout(p, ms) {
  return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]);
}
function cleanHost(s) {
  s = String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9.-]{1,253}$/.test(s) && s.indexOf(".") > 0 ? s : "";
}
function cleanUrl(s) {
  s = String(s || "").trim();
  if (!/^https?:\/\//.test(s)) s = "https://" + s;
  try { const u = new URL(s); return u.origin + u.pathname.replace(/\/$/, ""); } catch (e) { return ""; }
}

async function rateLimit(env, who) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL,
      at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`
  ).run();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE who = ? AND at > ?").bind(who, since).first();
  if (row && row.n >= MAX_TRIES) return { ok: false };
  await env.DB.prepare("INSERT INTO login_attempts (who) VALUES (?)").bind(who).run();
  await env.DB.prepare("DELETE FROM login_attempts WHERE who = ? AND at < ?").bind(who, since).run();
  return { ok: true };
}

async function isOwner(env, user) {
  if (env.OWNER_EMAIL) return String(user.email || "").toLowerCase() === String(env.OWNER_EMAIL).trim().toLowerCase();
  const first = await env.DB.prepare("SELECT MIN(id) AS id FROM users").first();
  return !!first && first.id === user.id;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
