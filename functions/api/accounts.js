/* Keeps the directory of Salman's accounts.
 *
 * NO PASSWORDS EVER LIVE HERE. This holds names, handles, which inbox an account uses and a link.
 * A public repository plus a hand-built login is the wrong place for passwords, so the site refuses to
 * be one. The rest is private all the same, so it sits in the database and needs a signed-in person.
 *
 * GET   returns what is stored.
 * POST  replaces it with what his laptop just produced.
 * Both refuse anyone who is not signed in.
 */

const KEY = "accounts";
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
    if (!parsed || !Array.isArray(parsed.accounts)) {
      return json({ error: "That file is missing the accounts, so it is not the right one." }, 400);
    }

    const when = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO store (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
                                      updated_by = excluded.updated_by`
    ).bind(KEY, JSON.stringify(parsed), when, data.user.email).run();

    return json({ ok: true, savedAt: when, accounts: parsed.accounts.length });
  }

  return json({ error: "Something went wrong. Try again." }, 405);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
