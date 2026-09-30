/* Sets a new password for someone who has forgotten theirs.
 *
 * There is no email on this site, so a reset link cannot be sent. Instead the invite code is the proof:
 * whoever knows it is allowed to set a new password. That is the same key that lets a person make an
 * account in the first place, so it gives nothing extra away.
 *
 * Setting a new password signs out every device that was signed in before.
 *
 * THE OWNER IS PROTECTED. Everyone Salman invites knows the invite code, so the invite code alone must not
 * be able to reset HIS account (found 23 Sep 2026: it could). The owner is the first account ever made on the
 * site. His account can only be reset with RESET_CODE, a second code only he knows, set in Cloudflare's
 * settings like the invite code. Until he sets one, his way back in is Continue with Google, or starting his
 * account again with the invite code after Claude clears it from the Cloudflare database console.
 */

const COOKIE = "sdl_session";
const ROUNDS = 12000;
const SESSION_DAYS = 30;
const MAX_TRIES = 10;
const WINDOW_MINUTES = 15;

export async function onRequestPost(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env }) {
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);
  if (!env.INVITE_CODE) return json({ error: "Resets are closed until the invite code is set." }, 503);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Something went wrong. Try again." }, 400); }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const invite = String(body.invite || "");
  const who = "reset|" + (request.headers.get("CF-Connecting-IP") || "unknown");

  const since = new Date(Date.now() - WINDOW_MINUTES * 60000).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE who = ? AND at > ?")
    .bind(who, since).first();
  if (recent && recent.n >= MAX_TRIES) {
    return json({ error: "Too many tries. Please wait fifteen minutes and try again." }, 429);
  }

  const isInvite = same(invite, env.INVITE_CODE);
  const isOwnerCode = !!env.RESET_CODE && same(invite, env.RESET_CODE);
  if (!isInvite && !isOwnerCode) {
    await env.DB.prepare("INSERT INTO login_attempts (who) VALUES (?)").bind(who).run();
    return json({ error: "That invite code is not right." }, 403);
  }
  if (password.length < 10) return json({ error: "Please pick a password of at least 10 characters." }, 400);
  if (password.length > 200) return json({ error: "That password is too long." }, 400);

  const user = await env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    await env.DB.prepare("INSERT INTO login_attempts (who) VALUES (?)").bind(who).run();
    return json({ error: "There is no account with that email." }, 404);
  }

  // The owner: OWNER_EMAIL if it is set in Cloudflare's settings, otherwise the first account ever made (OWNER-1).
  const owner = env.OWNER_EMAIL
    ? { id: user.email === String(env.OWNER_EMAIL).trim().toLowerCase() ? user.id : -1 }
    : await env.DB.prepare("SELECT MIN(id) AS id FROM users").first();
  if (owner && owner.id === user.id && !isOwnerCode) {
    await env.DB.prepare("INSERT INTO login_attempts (who) VALUES (?)").bind(who).run();
    return json({ error: "This account cannot be reset with the invite code. Use Continue with Google instead." }, 403);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await scramble(password, salt, ROUNDS);

  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, iterations = ? WHERE id = ?")
    .bind(hash, b64(salt), ROUNDS, user.id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  await env.DB.prepare("DELETE FROM login_attempts WHERE who = ?").bind(who).run();

  const cookie = await startSession(env, user.id, true);
  return json({ ok: true, email: user.email, name: user.name }, 200, cookie);
}

/* ---- shared bits (kept in each file on purpose, so every route stands on its own) ---- */

async function scramble(password, salt, rounds) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: rounds }, key, 256);
  return b64(new Uint8Array(bits));
}

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
function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256Hex(text) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function json(obj, status, setCookie) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers });
}
