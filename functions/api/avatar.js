/* Your profile photo.
 *
 * Kept in the site's private key-value store (bound as DOCS) under "avatar/<your account number>", never in this
 * public repository. Only a signed-in person can see or change their own photo.
 *
 *   GET    /api/avatar?check=1   -> { has, v }  (so pages only ask for the picture when there is one)
 *   GET    /api/avatar           -> the picture itself
 *   POST   /api/avatar           -> replace it (the page shrinks it to 256x256 first; PNG, JPEG or WebP, 1 MB at most)
 *   DELETE /api/avatar           -> remove it
 *
 * The file's first bytes are checked, not just its name, so nothing but a real picture can be stored.
 */

const MAX_BYTES = 1024 * 1024;

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env, data }) {
  if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
  if (!env.DOCS) return json({ error: "The picture store is not connected yet." }, 503);

  const key = "avatar/" + data.user.id;
  const url = new URL(request.url);

  if (request.method === "GET" && url.searchParams.get("check")) {
    const hit = await env.DOCS.getWithMetadata(key, { type: "stream" });
    if (hit && hit.value) { try { await hit.value.cancel(); } catch (e) {} }
    return json({ has: !!(hit && hit.value), v: (hit && hit.metadata && hit.metadata.at) || "" });
  }

  if (request.method === "GET") {
    const hit = await env.DOCS.getWithMetadata(key, { type: "stream" });
    if (!hit || !hit.value) return json({ error: "No photo yet." }, 404);
    return new Response(hit.value, {
      headers: {
        "Content-Type": (hit.metadata && hit.metadata.type) || "image/webp",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  if (request.method === "POST") {
    const body = await request.arrayBuffer();
    if (!body.byteLength) return json({ error: "The picture is empty." }, 400);
    if (body.byteLength > MAX_BYTES) return json({ error: "That picture is too big. Please pick one under 1 MB." }, 413);
    const type = sniff(new Uint8Array(body.slice(0, 12)));
    if (!type) return json({ error: "That is not a PNG, JPEG or WebP picture." }, 415);
    const at = new Date().toISOString();
    await env.DOCS.put(key, body, { metadata: { type: type, at: at, bytes: body.byteLength } });
    return json({ ok: true, v: at });
  }

  if (request.method === "DELETE") {
    await env.DOCS.delete(key);
    return json({ ok: true });
  }

  return json({ error: "Something went wrong. Try again." }, 405);
}

/* What kind of picture is it, judging by its first bytes? */
function sniff(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
