/* The gate for Salman.D.Life.
 *
 * Cloudflare runs this file before it serves anything under /trading, /profile or /api.
 * If nobody is signed in, a private page sends the visitor to /login/ instead of showing itself.
 * The home page is not listed here, so it stays open to everyone.
 *
 * Nothing secret is in this file. The database and the invite code are set in Cloudflare's own
 * settings screen and are never written down in this repository.
 *
 * To make a new section private later, add its address to PRIVATE below and to _routes.json.
 */

const COOKIE = "sdl_session";
const PRIVATE = ["/trading", "/profile", "/study", "/accounts"];

export async function onRequest(context) {
  const { request, env, next, data } = context;
  const url = new URL(request.url);

  // Work out who (if anyone) is signed in, and hand that to every page and api route.
  data.user = await signedInUser(request, env);

  // The /api/ routes each decide for themselves who is allowed to call them.
  if (url.pathname.startsWith("/api/")) return next();

  const isPrivate = PRIVATE.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"));
  if (!isPrivate) return next();

  if (!data.user) {
    const to = new URL("/login/", url.origin);
    to.searchParams.set("next", url.pathname + url.search);
    return Response.redirect(to.toString(), 302);
  }

  // A private page must never be kept in a shared cache where someone else could pick it up.
  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, no-store, max-age=0");
  return out;
}

/* Reads the sign-in cookie and looks it up in the database.
   The cookie value itself is never stored - only a scrambled copy of it - so even a copy of the
   database cannot be used to pretend to be someone. */
async function signedInUser(request, env) {
  if (!env || !env.DB) return null;

  const token = readCookie(request, COOKIE);
  if (!token) return null;

  let row = null;
  try {
    row = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.created_at, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    ).bind(await sha256Hex(token)).first();
  } catch (e) {
    return null;
  }

  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return { id: row.id, email: row.email, name: row.name, created_at: row.created_at };
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const bits = part.trim().split("=");
    if (bits.shift() === name) return decodeURIComponent(bits.join("="));
  }
  return null;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
