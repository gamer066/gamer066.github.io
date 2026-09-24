/* A quiet log of anything that goes wrong in the browser while Salman is signed in.
 *
 * If a page ever breaks for him, the error (what, where, when) lands here so it can be seen and fixed without him
 * having to describe it. Nothing is shown to him. Only signed-in visits are recorded, the table never grows past
 * 200 rows, and anything else is quietly ignored (the answer is always "204 No Content" so pages never complain).
 *
 *   POST /api/errlog   { msg, where, page }   record one error
 *   GET  /api/errlog                          the newest 50 (signed-in only)
 *
 * To read it from the Cloudflare database console:  SELECT * FROM errlog ORDER BY id DESC LIMIT 20;
 */

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return new Response(null, { status: 204 });
  }
}

async function handle({ request, env, data }) {
  if (!env.DB || !data || !data.user) return new Response(null, { status: 204 });

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS errlog (
       id      INTEGER PRIMARY KEY AUTOINCREMENT,
       at      TEXT NOT NULL,
       user_id INTEGER,
       page    TEXT,
       msg     TEXT,
       place   TEXT,
       agent   TEXT
     )`
  ).run();

  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT at, page, msg, place, agent FROM errlog ORDER BY id DESC LIMIT 50").all();
    return new Response(JSON.stringify({ errors: rows.results || [] }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  if (request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch (e) { return new Response(null, { status: 204 }); }
    const cut = (v, n) => String(v || "").slice(0, n);
    await env.DB.prepare("INSERT INTO errlog (at, user_id, page, msg, place, agent) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(new Date().toISOString(), data.user.id, cut(body.page, 200), cut(body.msg, 500), cut(body.where, 300),
            cut(request.headers.get("User-Agent"), 160)).run();
    await env.DB.prepare("DELETE FROM errlog WHERE id NOT IN (SELECT id FROM errlog ORDER BY id DESC LIMIT 200)").run();
  }
  return new Response(null, { status: 204 });
}
