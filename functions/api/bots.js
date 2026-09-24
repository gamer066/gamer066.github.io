/* The trading page's numbers, as sent by the bots' own cloud run.
 *
 * WHY: the bots moved from the laptop to GitHub's cloud on 24 Sep 2026, and the trading page was only ever rebuilt on
 * the laptop. After every run the cloud now sends the page's numbers here, and functions/trading/_middleware.js puts
 * them into the page whenever they are newer than the laptop's copy.
 *
 * WHO MAY SEND, with no password anywhere: GitHub signs a short-lived identity token for each run. This file checks
 * that signature against GitHub's published keys, that the token was made for THIS site, and that it came from the
 * main branch of gamer066/trading-bots. Nobody else can make one, and it expires within minutes.
 *
 *   POST /api/bots   -> save the numbers (the bots' cloud run only)
 *   GET  /api/bots   -> read them back (signed-in visitors only)
 *
 * Only numbers are kept: no keys, no order ids, nothing that could place a trade.
 */

const KEY = "bots";
const MAX_BYTES = 300000;
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "salmandlife";
const REPO = "gamer066/trading-bots";
const BRANCH = "refs/heads/main";

let jwksCache = null;
let jwksAt = 0;

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env, data }) {
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);

  if (request.method === "GET") {
    if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
    await makeTable(env);
    const row = await env.DB.prepare("SELECT value, updated_at FROM store WHERE key = ?").bind(KEY).first();
    if (!row) return json({ empty: true });
    return json({ data: JSON.parse(row.value), savedAt: row.updated_at });
  }

  if (request.method !== "POST") return json({ error: "Something went wrong. Try again." }, 405);

  const who = await checkRun(request);
  if (!who.ok) return json({ error: "not allowed", why: who.why }, 403);

  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "too big" }, 413);
  let snap;
  try { snap = JSON.parse(text); } catch (e) { return json({ error: "not JSON" }, 400); }
  const problem = shapeProblem(snap);
  if (problem) return json({ error: problem }, 400);

  await makeTable(env);
  const when = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO store (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
                                    updated_by = excluded.updated_by`
  ).bind(KEY, JSON.stringify(snap), when, "github run " + (who.run || "?")).run();
  return json({ ok: true, savedAt: when, trades: snap.trades.length, open: snap.positions.length });
}

/* Only the shape the bots send is kept, so nothing else can be parked here. */
function shapeProblem(s) {
  if (!s || s.v !== 1) return "unknown version";
  if (typeof s.updated !== "string" || isNaN(Date.parse(s.updated))) return "no time";
  if (typeof s.closed !== "number" || !isFinite(s.closed)) return "no settled total";
  if (!Array.isArray(s.trades) || !Array.isArray(s.bots) || !Array.isArray(s.positions)) return "missing lists";
  for (const b of s.bots) {
    if (!b || typeof b.name !== "string" || typeof b.closed !== "number" || typeof b.openPnl !== "number" ||
        typeof b.done !== "number" || typeof b.open !== "number") return "bad bot line";
  }
  for (const p of s.positions) {
    if (!p || typeof p.sym !== "string" || !/^[A-Z0-9]{2,20}$/.test(p.sym) || typeof p.qty !== "number" ||
        typeof p.cost !== "number" || typeof p.val !== "number") return "bad open trade";
  }
  for (const t of s.trades) {
    if (!t || typeof t.r !== "number" || !isFinite(t.r)) return "bad trade";
  }
  return "";
}

async function makeTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS store (
       key        TEXT PRIMARY KEY,
       value      TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       updated_by TEXT
     )`
  ).run();
}

/* Is this GitHub's own signed token for a run of the bots on their main branch, made for this site? */
async function checkRun(request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, why: "no token" };
  const [h64, p64, s64] = parts;
  let header, claims;
  try {
    header = JSON.parse(b64urlToText(h64));
    claims = JSON.parse(b64urlToText(p64));
  } catch (e) { return { ok: false, why: "undecodable" }; }
  if (header.alg !== "RS256") return { ok: false, why: "alg" };
  if (claims.iss !== ISSUER) return { ok: false, why: "issuer" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(AUDIENCE)) return { ok: false, why: "audience" };
  if (claims.repository !== REPO) return { ok: false, why: "repository" };
  if (claims.ref !== BRANCH) return { ok: false, why: "branch" };
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) return { ok: false, why: "expired" };
  if (claims.nbf && claims.nbf > now + 60) return { ok: false, why: "not yet valid" };

  const jwk = await findKey(header.kid);
  if (!jwk) return { ok: false, why: "unknown key" };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s64),
    new TextEncoder().encode(h64 + "." + p64));
  return good ? { ok: true, run: claims.run_id } : { ok: false, why: "signature" };
}

async function findKey(kid) {
  if (!kid) return null;
  let hit = jwksCache && (jwksCache.keys || []).find((k) => k.kid === kid);
  if (hit && Date.now() - jwksAt < 60 * 60 * 1000) return hit;
  const r = await fetch(ISSUER + "/.well-known/jwks");
  if (!r.ok) return null;
  jwksCache = await r.json();
  jwksAt = Date.now();
  return (jwksCache.keys || []).find((k) => k.kid === kid) || null;
}

/* ---- shared bits (kept in each file on purpose, so every route stands on its own) ---- */

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function b64urlToText(s) { return new TextDecoder().decode(b64urlToBytes(s)); }

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
