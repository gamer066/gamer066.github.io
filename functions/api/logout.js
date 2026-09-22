/* Signs someone out: forgets the session in the database and wipes the cookie from the browser. */

const COOKIE = "sdl_session";

export async function onRequestPost({ request, env }) {
  const token = readCookie(request, COOKIE);
  if (token && env.DB) {
    try {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
    } catch (e) { /* the cookie is cleared below either way */ }
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    }
  });
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
