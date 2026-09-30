/* The control switches for the trading bots (CTRL-1, 30 Sep 2026).

WHAT IT IS: a small saved list of on/off switches that Salman flips from the /control/ page on his phone:
"stop all new trades", "pause this bot", "restart the Bee race". Practice money only.

  GET  /api/control   -> the switches. Two kinds of caller are allowed:
                          1. Salman (the site owner), signed in.
                          2. The bots' own GitHub run, proved with GitHub's signed identity token made for this
                             site (the same check as /api/bots and /api/special). Nobody else can make one.
                         The cloud run reads this at the start of every hour and obeys it.
  POST /api/control   -> flip ONE switch (the site owner only, signed in; anyone else gets 403).
                         { "what": "pause" | "resume", "bot": "<bot key>" }
                         { "what": "halt_all", "on": true | false }
                         { "what": "reset_bees" }
                         Every change is added to a short history in plain words.

Signed in is NOT enough to press a button: anyone with the invite code can make an account, so only the owner counts
(same rule as /api/errlog, OWNER-1). A paused bot opens no new trades; it still looks after the trades it already has
(exits and safety stops keep working). Nothing here can place a trade or touch a key.
*/

const KEY = "control";
const ISSUER = "https://token.actions.githubusercontent.com";
const AUDIENCE = "salmandlife";
const REPO = "gamer066/trading-bots";
const BRANCH = "refs/heads/main";

/* The bots, by the short key the cloud code uses, with the plain name shown on the page. */
const BOTS = {
  money: "Money bot", learn: "Learning bot", quick: "Quick bot", ten: "$10 plan bot", m55: "Turtle 55",
  short: "Short bot", d20: "Daily leg", sunny_gold: "Sunny Gold", gold_fast: "Sunny Gold Fast", bees: "The Bees"
};

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
    const hasToken = (request.headers.get("Authorization") || "").startsWith("Bearer ");
    if (hasToken) {
      const who = await checkRun(request);
      if (!who.ok) return json({ error: "not allowed", why: who.why }, 403);
    } else {
      if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
      if (!(await isOwner(env, data.user))) return json({ error: "Only the owner of this site can use the control switches." }, 403);
    }
    const c = await load(env);
    return json({ ...c, bots: BOTS, now: new Date().toISOString() });
  }

  if (request.method !== "POST") return json({ error: "Something went wrong. Try again." }, 405);
  if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
  if (!(await isOwner(env, data.user))) return json({ error: "Only the owner of this site can use the control switches." }, 403);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "That did not look right. Please try again." }, 400); }
  const c = await load(env);
  const now = new Date().toISOString();
  let said = "";

  if (body && (body.what === "pause" || body.what === "resume")) {
    if (!Object.prototype.hasOwnProperty.call(BOTS, body.bot)) return json({ error: "That bot is not on the list." }, 400);
    const on = body.what === "pause";
    if (!!c.paused[body.bot] === on) return json({ ...c, bots: BOTS, unchanged: true });
    c.paused[body.bot] = on;
    said = (on ? "Paused " : "Resumed ") + BOTS[body.bot];
  } else if (body && body.what === "halt_all") {
    const on = body.on === true;
    if (c.halt_all === on) return json({ ...c, bots: BOTS, unchanged: true });
    c.halt_all = on;
    said = on ? "Switched ON: stop all new trades" : "Switched OFF: new trades allowed again";
  } else if (body && body.what === "reset_bees") {
    c.reset_bees_at = now;
    said = "Asked for a fresh Bee race (starts at the next hourly run)";
  } else {
    return json({ error: "I did not understand that button." }, 400);
  }

  c.history.unshift({ when: now, what: said });
  c.history = c.history.slice(0, 50);
  c.updated_at = now;
  await save(env, c, now);
  return json({ ...c, bots: BOTS });
}

/* The saved switches, always in full shape (a missing or damaged row falls back to "everything running"). */
async function load(env) {
  const row = await env.DB.prepare("SELECT value FROM store WHERE key = ?").bind(KEY).first();
  let c = {};
  try { c = row ? JSON.parse(row.value) : {}; } catch (e) { c = {}; }
  const paused = {};
  for (const k of Object.keys(BOTS)) paused[k] = !!(c.paused && c.paused[k]);
  return {
    halt_all: !!c.halt_all,
    paused,
    reset_bees_at: typeof c.reset_bees_at === "string" ? c.reset_bees_at : null,
    history: Array.isArray(c.history) ? c.history.slice(0, 50).filter((h) => h && typeof h.what === "string") : [],
    updated_at: typeof c.updated_at === "string" ? c.updated_at : null
  };
}

async function save(env, c, when) {
  await env.DB.prepare(
    `INSERT INTO store (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(KEY, JSON.stringify(c), when, "owner").run();
}

async function makeTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)`
  ).run();
}

/* The owner: OWNER_EMAIL if that is set in Cloudflare's settings, otherwise the first account ever made
   (the same rule /api/reset and /api/errlog use). If the owner cannot be worked out, the answer is no. */
async function isOwner(env, user) {
  if (env.OWNER_EMAIL) return String(user.email || "").toLowerCase() === String(env.OWNER_EMAIL).trim().toLowerCase();
  const first = await env.DB.prepare("SELECT MIN(id) AS id FROM users").first();
  return !!first && first.id === user.id;
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
