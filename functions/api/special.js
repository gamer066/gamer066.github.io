/* The Special bots' numbers, as sent by the bots' own cloud run (30 Sep 2026).

WHY: the Special bots page read special/data/bots.json, which only the laptop could publish, so with the laptop off it
went stale. The cloud run now sends the same file here after every run; assets/special.js shows whichever copy is newer.

WHO MAY SEND: only a GitHub run from the main branch of gamer066/trading-bots, proved with GitHub's signed identity
token made for this site (the same check as /api/bots). No password anywhere.

  POST /api/special   -> save the file (the bots' cloud run only)
  GET  /api/special   -> read it back (signed-in visitors only)

Only numbers and plain text are kept: no keys, no order ids.
*/

const KEY = "special";
const MAX_BYTES = 400000;
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
  await makeTable(env);

  if (request.method === "GET") {
    if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
    const row = await env.DB.prepare("SELECT value FROM store WHERE key = ?").bind(KEY).first();
    return new Response(row ? row.value : JSON.stringify({ bots: [] }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }
  if (request.method !== "POST") return json({ error: "Something went wrong. Try again." }, 405);

  const who = await checkRun(request);
  if (!who.ok) return json({ error: "not allowed", why: who.why }, 403);
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "too big" }, 413);
  let d;
  try { d = JSON.parse(text); } catch (e) { return json({ error: "not JSON" }, 400); }
  if (!d || typeof d.updated !== "string" || isNaN(Date.parse(d.updated)) || !Array.isArray(d.bots)) return json({ error: "bad shape" }, 400);
  for (const b of d.bots) {
    if (!b || !/^[a-z0-9-]{1,40}$/.test(b.id || "") || !/^[A-Z0-9]{2,20}$/.test(b.symbol || "") || !Array.isArray(b.trades || [])) {
      return json({ error: "bad bot" }, 400);
    }
  }
  const when = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO store (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(KEY, JSON.stringify(d), when, "github run " + (who.run || "?")).run();
  return json({ ok: true, savedAt: when, bots: d.bots.length });
}

async function makeTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)`
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
