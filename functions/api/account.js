/* Changes to your own account: your display name, your password, and signing other devices out.
 * You must already be signed in. Changing the password needs the old one first, the way real sites do it. */

const COOKIE = "sdl_session";
const ROUNDS = 12000;

export async function onRequestPost(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env, data }) {
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);
  const user = data && data.user;
  if (!user) return json({ error: "You are not signed in any more. Please sign in again." }, 401);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Something went wrong. Try again." }, 400); }
  const what = String(body.what || "");

  if (what === "name") {
    const name = String(body.name || "").trim().slice(0, 60);
    await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, user.id).run();
    return json({ ok: true, name: name });
  }

  if (what === "password") {
    const current = String(body.current || "");
    const next = String(body.password || "");
    if (next.length < 10) return json({ error: "Please pick a password of at least 10 characters." }, 400);
    if (next.length > 200) return json({ error: "That password is too long." }, 400);

    const row = await env.DB.prepare("SELECT password_hash, password_salt, iterations FROM users WHERE id = ?")
      .bind(user.id).first();
    if (!row) return json({ error: "Your account could not be found." }, 404);

    // Someone holding a stolen session must not be able to sit here guessing the real password.
    const who = "pwchange|" + user.id;
    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE who = ? AND at > ?")
      .bind(who, since).first();
    if (recent && recent.n >= 10) return json({ error: "Too many tries. Please wait fifteen minutes and try again." }, 429);

    const tried = await scramble(current, unb64(row.password_salt), row.iterations || ROUNDS);
    if (!same(tried, row.password_hash)) {
      await env.DB.prepare("INSERT INTO login_attempts (who) VALUES (?)").bind(who).run();
      return json({ error: "Your current password is not right." }, 403);
    }
    await env.DB.prepare("DELETE FROM login_attempts WHERE who = ?").bind(who).run();

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await scramble(next, salt, ROUNDS);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, iterations = ? WHERE id = ?")
      .bind(hash, b64(salt), ROUNDS, user.id).run();

    // Everything else that was signed in is kicked out; this browser stays.
    const token = readCookie(request, COOKIE);
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
      .bind(user.id, token ? await sha256Hex(token) : "").run();
    return json({ ok: true });
  }

  if (what === "signout-others") {
    const token = readCookie(request, COOKIE);
    const res = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
      .bind(user.id, token ? await sha256Hex(token) : "").run();
    const n = (res.meta && res.meta.changes) || 0;
    return json({ ok: true, removed: n });
  }

  if (what === "devices") {
    await addDeviceColumns(env);
    const token = readCookie(request, COOKIE);
    const mine = token ? await sha256Hex(token) : "";
    const rows = await env.DB.prepare(
      "SELECT token_hash, label, created_at, last_seen, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? " +
      "ORDER BY COALESCE(last_seen, created_at) DESC"
    ).bind(user.id, new Date().toISOString()).all();
    const list = (rows.results || []).map((r) => ({
      id: r.token_hash.slice(0, 12),            // a short tag only; never the whole key
      label: r.label || "A device",
      since: r.created_at,
      seen: r.last_seen || r.created_at,
      current: r.token_hash === mine
    }));
    return json({ ok: true, devices: list });
  }

  if (what === "signout-device") {
    const id = String(body.id || "").replace(/[^0-9a-f]/g, "").slice(0, 12);
    if (id.length !== 12) return json({ error: "Which device?" }, 400);
    const token = readCookie(request, COOKIE);
    const mine = token ? await sha256Hex(token) : "";
    if (mine.slice(0, 12) === id) return json({ error: "That is this device. Use Sign out instead." }, 400);
    const res = await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 12) = ?")
      .bind(user.id, id).run();
    return json({ ok: true, removed: (res.meta && res.meta.changes) || 0 });
  }

  return json({ error: "Something went wrong. Try again." }, 400);
}

/* Older copies of the database have no device columns yet; add them the first time they are needed. */
async function addDeviceColumns(env) {
  for (const col of ["label TEXT", "last_seen TEXT"]) {
    try { await env.DB.prepare("ALTER TABLE sessions ADD COLUMN " + col).run(); } catch (e) { /* already there */ }
  }
}

/* ---- shared bits (kept in each file on purpose, so every route stands on its own) ---- */

async function scramble(password, salt, rounds) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: rounds }, key, 256);
  return b64(new Uint8Array(bits));
}

function same(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const bits = part.trim().split("=");
    if (bits.shift() === name) return decodeURIComponent(bits.join("="));
  }
  return null;
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
