/* Stores and hands back Salman's own documents, so any of them opens from his phone.
 *
 * The files sit in Cloudflare's key-value storage (bound to this site as DOCS), never in this public
 * repository. Every request needs a signed-in visitor.
 *
 *   GET  /api/doc?list=1          what has been uploaded (name, unit, size, when)
 *   GET  /api/doc?id=<id>         the file itself, opened in the browser where it can be
 *   POST /api/doc                 upload one file; headers say its name and unit
 *   DELETE /api/doc?id=<id>       remove one file
 *
 * The id is built from the unit, the file name and its size, so the laptop's list and the stored files
 * match up without any extra bookkeeping.
 */

const MAX_BYTES = 24 * 1024 * 1024;   // the storage holds up to 25 MB per file

const TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mp4: "video/mp4",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg"
};

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env, data }) {
  if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
  if (!env.DOCS) return json({ error: "The document store is not connected yet." }, 503);

  const url = new URL(request.url);

  if (request.method === "GET" && url.searchParams.get("list")) {
    const found = [];
    let cursor;
    do {
      const page = await env.DOCS.list({ cursor: cursor, limit: 1000 });
      for (const k of page.keys) {
        if (isAvatar(k.name)) continue;   // profile photos live here too; they are not documents
        found.push(Object.assign({ id: k.name }, k.metadata || {}));
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return json({ files: found });
  }

  if (request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!id) return json({ error: "Which file?" }, 400);
    // Profile photos share this store but belong to /api/avatar, which only hands each person their own.
    if (isAvatar(id)) return json({ error: "That file has not been uploaded yet." }, 404);
    const hit = await env.DOCS.getWithMetadata(id, { type: "stream" });
    if (!hit || !hit.value) return json({ error: "That file has not been uploaded yet." }, 404);
    const meta = hit.metadata || {};
    const name = meta.name || "document";
    const wantsDownload = url.searchParams.get("download") === "1";
    return new Response(hit.value, {
      headers: {
        "Content-Type": typeFor(name),
        "Content-Disposition": (wantsDownload ? "attachment" : "inline") + "; filename*=UTF-8''" + encodeURIComponent(name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  if (request.method === "POST") {
    const name = safeName(decodeURIComponent(request.headers.get("X-Doc-Name") || ""));
    const unit = safeName(decodeURIComponent(request.headers.get("X-Doc-Unit") || "")).slice(0, 20);
    if (!name) return json({ error: "The file has no name." }, 400);

    const body = await request.arrayBuffer();
    if (!body.byteLength) return json({ error: "The file is empty." }, 400);
    if (body.byteLength > MAX_BYTES) return json({ error: name + " is over 24 MB, which is too big to keep here." }, 413);

    const id = makeId(unit, name, body.byteLength);
    const meta = { name: name, unit: unit, bytes: body.byteLength, at: new Date().toISOString(), by: data.user.email };
    await env.DOCS.put(id, body, { metadata: meta });
    return json(Object.assign({ ok: true, id: id }, meta));
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id") || "";
    if (!id) return json({ error: "Which file?" }, 400);
    if (isAvatar(id)) return json({ error: "That file has not been uploaded yet." }, 404);
    await env.DOCS.delete(id);
    return json({ ok: true });
  }

  return json({ error: "Something went wrong. Try again." }, 405);
}

/* The same recipe runs on the Studies page, so both sides agree on a file's id. */
function makeId(unit, name, bytes) {
  return (unit || "doc").toLowerCase() + "/" + bytes + "/" + name.toLowerCase();
}

function isAvatar(id) {
  return id.indexOf("avatar/") === 0;
}

function safeName(s) {
  return String(s || "").replace(/[\\/\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function typeFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return TYPES[ext] || "application/octet-stream";
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
