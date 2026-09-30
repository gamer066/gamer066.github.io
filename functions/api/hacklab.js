/* Hack Lab control (30 Sep 2026). Salman's own tools, run from his own laptop, controlled from his phone.

WHAT IT IS: a small job queue. Salman presses a button on /hacklab/, this saves "please run X". A helper
program on his laptop (inside Kali) checks in every few seconds, runs the job, and sends the answer back.
Nothing here runs on the website itself - the website only passes messages between Salman's phone and his laptop.

  GET  /api/hacklab   -> two kinds of caller:
                          1. Salman (signed in, owner) - sees the job list and their answers.
                          2. His laptop helper, proved with a secret header (HACKLAB_TOKEN) - gets jobs waiting to run.
  POST /api/hacklab    -> two kinds of caller:
                          1. Salman (owner) - adds a new job: { "what": "<preset key>" } or { "what": "custom", "cmd": "<text>" }
                          2. His laptop helper (secret header) - sends back the answer to a job:
                             { "id": "<job id>", "output": "<text>", "ok": true|false }

Only Salman can add jobs. Only the laptop helper (which only he runs, on his own machine) can send answers back.
If the secret header is ever missing, the laptop side just cannot check in - nothing breaks, nothing runs. */

const KEY = "hacklab";
const PRESETS = {
  kali_status: "Show Kali tool versions (nmap, metasploit)",
  self_scan: "Scan my own laptop's open ports",
  wifi_scan: "List wifi networks my laptop can see",
  update_tools: "Update every hacking tool"
};

export async function onRequest(context) {
  try {
    return await handle(context);
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function handle({ request, env, data }) {
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);
  await makeTable(env);

  const isWorker = env.HACKLAB_TOKEN && request.headers.get("X-Worker-Token") === env.HACKLAB_TOKEN;

  if (request.method === "GET") {
    if (isWorker) {
      const q = await load(env);
      return json({ jobs: q.jobs.filter((j) => j.status === "waiting") });
    }
    if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
    if (!(await isOwner(env, data.user))) return json({ error: "Only the owner of this site can use the hack lab." }, 403);
    const q = await load(env);
    return json({ jobs: q.jobs.slice(0, 50), presets: PRESETS });
  }

  if (request.method !== "POST") return json({ error: "Something went wrong. Try again." }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "That did not look right. Please try again." }, 400); }

  if (isWorker) {
    // the laptop helper sending back an answer
    if (!body || !body.id) return json({ error: "Missing job id." }, 400);
    const q = await load(env);
    const j = q.jobs.find((x) => x.id === body.id);
    if (!j) return json({ error: "That job is not on the list any more." }, 404);
    j.status = "done";
    j.ok = body.ok !== false;
    j.output = String(body.output || "").slice(0, 20000);
    j.answered_at = new Date().toISOString();
    await save(env, q);
    return json({ ok: true });
  }

  // the owner adding a new job
  if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
  if (!(await isOwner(env, data.user))) return json({ error: "Only the owner of this site can use the hack lab." }, 403);

  let label, cmdKey;
  if (body && body.what === "custom") {
    const cmd = String(body.cmd || "").trim();
    if (!cmd) return json({ error: "Type something to run first." }, 400);
    if (cmd.length > 500) return json({ error: "That is too long." }, 400);
    label = cmd;
    cmdKey = "custom:" + cmd;
  } else if (body && Object.prototype.hasOwnProperty.call(PRESETS, body.what)) {
    label = PRESETS[body.what];
    cmdKey = body.what;
  } else {
    return json({ error: "I did not understand that button." }, 400);
  }

  const q = await load(env);
  const now = new Date().toISOString();
  const job = { id: now + "-" + Math.random().toString(36).slice(2, 8), label, cmd: cmdKey, status: "waiting", ok: null, output: "", added_at: now, answered_at: null };
  q.jobs.unshift(job);
  q.jobs = q.jobs.slice(0, 50);
  await save(env, q);
  return json({ jobs: q.jobs.slice(0, 50), presets: PRESETS });
}

async function load(env) {
  const row = await env.DB.prepare("SELECT value FROM store WHERE key = ?").bind(KEY).first();
  let q = {};
  try { q = row ? JSON.parse(row.value) : {}; } catch (e) { q = {}; }
  return { jobs: Array.isArray(q.jobs) ? q.jobs : [] };
}

async function save(env, q) {
  await env.DB.prepare(
    `INSERT INTO store (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).bind(KEY, JSON.stringify(q), new Date().toISOString(), "hacklab").run();
}

async function makeTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT)`
  ).run();
}

async function isOwner(env, user) {
  if (env.OWNER_EMAIL) return String(user.email || "").toLowerCase() === String(env.OWNER_EMAIL).trim().toLowerCase();
  const first = await env.DB.prepare("SELECT MIN(id) AS id FROM users").first();
  return !!first && first.id === user.id;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}
