/* Signs someone in.
 *
 * It scrambles the password that was typed and compares it with the scrambled copy saved when the
 * account was made. The real password is never stored and never leaves this check.
 *
 * Too many wrong tries from the same place are blocked for fifteen minutes, so nobody can sit there
 * guessing passwords.
 */

const COOKIE = "sdl_session";
const SESSION_DAYS = 30;
const MAX_TRIES = 10;
const WINDOW_MINUTES = 15;

export async function onRequestPost(context) {
  // Never show a visitor a raw error page. If anything at all goes wrong, say so in plain words.
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env }) {
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Something went wrong. Try again." }, 400); }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const who = (request.headers.get("CF-Connecting-IP") || "unknown") + "|" + email;

  const since = new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE who = ? AND at > ?")
    .bind(who, since).first();
  if (recent && recent.n >= MAX_TRIES) {
    return json({ error: "Too many tries. Please wait fifteen minutes and try again." }, 429);
  }

  const user = await env.DB.prepare(
    "SELECT id, email, name, password_hash, password_salt, iterations FROM users WHERE email = ?"
  ).bind(email).first();

  let good = false;
  if (user && password) {
    const tried = await scramble(password, unb64(user.password_salt), user.iterations || 12000);
    good = same(tried, user.password_hash);
  } else {
    // The same scrambling work when the email is unknown, so how long the answer takes gives nothing away either.
    await scramble(password || "-", new Uint8Array(16), 12000);
  }

  if (!good) {
    await env.DB.prepare("INSERT INTO login_attempts (who) VALUES (?)").bind(who).run();
    // The same message either way, so nobody can find out which emails have accounts.
    return json({ error: "That email and password do not match." }, 401);
  }

  await env.DB.prepare("DELETE FROM login_attempts WHERE who = ? OR at < ?")
    .bind(who, new Date(Date.now() - 86400000).toISOString()).run();

  const cookie = await startSession(env, user.id, body.remember !== false);
  return json({ ok: true, email: user.email, name: user.name }, 200, cookie);
}

/* ---- shared bits (kept in each file on purpose, so every route stands on its own) ---- */

async function scramble(password, salt, rounds) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: rounds }, key, 256);
  return b64(new Uint8Array(bits));
}

/* "Keep me signed in" ticked: the cookie lasts 30 days. Unticked: it disappears when the browser closes,
   which is what you want on a borrowed or shared computer. */
async function startSession(env, userId, remember) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const days = remember ? SESSION_DAYS : 1;
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, expires).run();
  const age = remember ? `; Max-Age=${SESSION_DAYS * 86400}` : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${age}`;
}

function same(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function b64(bytes) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(text) {
  const s = atob(text); const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}
function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function json(obj, status, setCookie) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers });
}
