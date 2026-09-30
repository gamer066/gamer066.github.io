/* Keeps everything about Salman's studies.
 *
 * WHY IT IS HERE AND NOT IN A FILE: this repository is public. His registration number, his deadlines
 * and the names of his coursework files must never sit in it. So they live in the site's own private
 * database instead, and only a signed-in person can read them back.
 *
 * GET   returns what is stored.
 * POST  replaces it with what his laptop just produced.
 * Both refuse anyone who is not signed in, and anyone who is not the site owner (OWNER-1).
 */

const KEY = "study";
const MAX_BYTES = 900000;   // roughly 900 KB; the real file is about 30 KB

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env, data }) {
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);
  if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
  if (!(await isOwner(env, data.user))) return json({ error: "This part of the site is only for its owner." }, 403);

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS store (
       key        TEXT PRIMARY KEY,
       value      TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       updated_by TEXT
     )`
  ).run();

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT value, updated_at, updated_by FROM store WHERE key = ?")
      .bind(KEY).first();
    if (!row) return json({ empty: true });
    let parsed = null;
    try { parsed = JSON.parse(row.value); } catch (e) { return json({ error: "The saved data could not be read." }, 500); }
    return json({ data: parsed, savedAt: row.updated_at, savedBy: row.updated_by });
  }

  if (request.method === "POST") {
    const text = await request.text();
    if (!text) return json({ error: "Nothing arrived. Pick the file again." }, 400);
    if (text.length > MAX_BYTES) return json({ error: "That file is too big for the site to hold." }, 413);

    let parsed;
    try { parsed = JSON.parse(text); } catch (e) { return json({ error: "That file is not the one the laptop makes." }, 400); }
    if (!parsed || !Array.isArray(parsed.units)) {
      return json({ error: "That file is missing the units, so it is not the right one." }, 400);
    }

    const when = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO store (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
                                      updated_by = excluded.updated_by`
    ).bind(KEY, JSON.stringify(parsed), when, data.user.email).run();

    return json({ ok: true, savedAt: when, units: parsed.units.length,
                  documents: Array.isArray(parsed.documents) ? parsed.documents.length : 0 });
  }

  return json({ error: "Something went wrong. Try again." }, 405);
}


/* OWNER-1 (24 Sep 2026): this is Salman's own data. Anyone he gives the invite code to can make an account and
   sign in, so "signed in" is not enough: only the site owner may read or change it. The owner is the first
   account ever made (the same rule /api/reset uses), or OWNER_EMAIL if that is set in Cloudflare's settings.
   If the owner cannot be worked out, the answer is no. */
async function isOwner(env, user) {
  if (env.OWNER_EMAIL) return String(user.email || "").toLowerCase() === String(env.OWNER_EMAIL).trim().toLowerCase();
  if (!env.DB) return false;
  const first = await env.DB.prepare("SELECT MIN(id) AS id FROM users").first();
  return !!first && first.id === user.id;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
