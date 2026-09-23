/* "Continue with Google".
 *
 * Google's own sign-in button hands the browser a short-lived note signed by Google, saying which Google account
 * just signed in. This file checks Google's signature on that note against Google's published public keys, checks
 * it was made for THIS website and has not expired, and then signs the person in.
 *
 * There is no secret anywhere in this: the website's Google ID below is public by design (it appears in every page
 * that shows the button). Nothing for Salman to paste, nothing that can leak from this public repository.
 *
 * The site stays invite-only: Google can only sign in an account that already exists here with the same email.
 * It never creates a new account on its own.
 *
 *   GET  /api/google   -> { clientId } so the sign-in page knows which Google ID to show the button for
 *   POST /api/google   -> { credential } from Google's button; answers like /api/login
 */

const CLIENT_ID = "";   // filled in once the Google project's web ID exists (public, safe to commit)
const COOKIE = "sdl_session";
const SESSION_DAYS = 30;
const MAX_TRIES = 20;
const WINDOW_MINUTES = 15;
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";

let keysCache = null;
let keysAt = 0;

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env }) {
  const clientId = (env.GOOGLE_CLIENT_ID || CLIENT_ID || "").trim();

  if (request.method === "GET") return json({ clientId: clientId });
  if (request.method !== "POST") return json({ error: "Something went wrong. Try again." }, 405);

  if (!clientId) return json({ error: "Google sign-in is not switched on yet." }, 503);
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);

  const who = "google|" + (request.headers.get("CF-Connecting-IP") || "unknown");
  const since = new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE who = ? AND at > ?")
    .bind(who, since).first();
  if (recent && recent.n >= MAX_TRIES) {
    return json({ error: "Too many tries. Please wait fifteen minutes and try again." }, 429);
  }

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Something went wrong. Try again." }, 400); }

  const checked = await checkGoogleNote(String(body.credential || ""), clientId);
  if (!checked.ok) {
    await env.DB.prepare("INSERT INTO login_attempts (who) VALUES (?)").bind(who).run();
    return json({ error: "Google could not confirm that sign-in. Please try again." }, 401);
  }

  const email = checked.email.toLowerCase();
  const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    return json({
      error: "No account on this site uses " + email + ". Create one first with the invite code, using that same email."
    }, 403);
  }

  const cookie = await startSession(env, user.id);
  return json({ ok: true, email: user.email, name: user.name }, 200, cookie);
}

/* Checks the note Google's button produced. Returns { ok, email } or { ok: false, why }. */
async function checkGoogleNote(token, clientId) {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, why: "shape" };
  const [h64, p64, s64] = parts;

  let header, claims;
  try {
    header = JSON.parse(b64urlToText(h64));
    claims = JSON.parse(b64urlToText(p64));
  } catch (e) { return { ok: false, why: "undecodable" }; }

  if (header.alg !== "RS256") return { ok: false, why: "alg" };
  if (!ISSUERS.includes(claims.iss)) return { ok: false, why: "issuer" };
  if (claims.aud !== clientId) return { ok: false, why: "audience" };
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) return { ok: false, why: "expired" };
  if (claims.iat && claims.iat > now + 300) return { ok: false, why: "from-the-future" };
  if (!claims.email || !(claims.email_verified === true || claims.email_verified === "true")) {
    return { ok: false, why: "email-not-verified" };
  }

  const jwk = await findKey(header.kid);
  if (!jwk) return { ok: false, why: "no-key" };

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(s64),
    new TextEncoder().encode(h64 + "." + p64));
  return good ? { ok: true, email: String(claims.email) } : { ok: false, why: "signature" };
}

async function findKey(kid) {
  if (!kid) return null;
  let hit = keysCache && (keysCache.keys || []).find((k) => k.kid === kid);
  if (hit && Date.now() - keysAt < 60 * 60 * 1000) return hit;
  const r = await fetch(KEYS_URL, { cf: { cacheTtl: 3600 } });
  if (!r.ok) return null;
  keysCache = await r.json();
  keysAt = Date.now();
  return (keysCache.keys || []).find((k) => k.kid === kid) || null;
}

/* ---- shared bits (kept in each file on purpose, so every route stands on its own) ---- */

async function startSession(env, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, expires).run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

function b64urlToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function b64urlToText(s) { return new TextDecoder().decode(b64urlToBytes(s)); }
function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function json(obj, status, setCookie) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers });
}
