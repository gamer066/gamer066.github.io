/* Hack Lab control (30 Sep 2026). Salman's own tools, run from his own laptop, controlled from his phone.
   Extended (30 Sep 2026, PHONE-1) with two harmless phone actions - see the note below the laptop part.

WHAT IT IS: a small job queue. Salman presses a button on /hacklab/, this saves "please run X". A helper
program on his laptop (inside Kali) checks in every few seconds, runs the job, and sends the answer back.
Nothing here runs on the website itself - the website only passes messages between Salman's phone and his laptop.

  GET  /api/hacklab              -> three kinds of caller:
                                     1. Salman (signed in, owner) - sees the job list and their answers.
                                     2. His laptop helper, proved with a secret header (HACKLAB_TOKEN) -
                                        gets device:"laptop" jobs waiting to run.
                                     3. Salman's own phone, signed in as owner, ?device=phone - gets only its
                                        own waiting jobs (never the laptop's).
  POST /api/hacklab               -> three kinds of caller:
                                     1. Salman (owner) - adds a new job: { "what": "<preset key>", "device"?: "phone" }
                                        or { "what": "custom", "cmd": "<text>" } (laptop only) or
                                        { "what": "phone_message", "device": "phone", "text": "<message>" }.
                                     2. His laptop helper (secret header) - sends back an answer:
                                        { "id": "<job id>", "output": "<text>", "ok": true|false }.
                                     3. Salman's own phone (signed in as owner) - sends back an answer the same
                                        shape, but as { "answer_id": "<job id>", ... } so it can never be mistaken
                                        for "add a new job" by a stray or old request.

Only Salman can add jobs. Only the laptop helper (which only he runs, on his own machine) or Salman's own
signed-in phone can send answers back. If the secret header is ever missing, the laptop side just cannot check
in - nothing breaks, nothing runs.

PHONE-1, on purpose left out: taking a photo through the phone's camera or reading its exact location, saved
here for later, is NOT built - even as a prank, capturing someone's face or whereabouts without them knowing
at that moment isn't something this site does. The phone actions are only things the person holding the phone
sees happen live on their own screen (a message, a sound), and nothing about them is kept afterwards. */

const KEY = "hacklab";
const PRESETS = {
  kali_status: "Show Kali tool versions (nmap, metasploit)",
  self_scan: "Scan my own laptop's open ports",
  wifi_scan: "List wifi networks my laptop can see",
  wifi_control: "Find my router and every device on my wifi",
  malware_scan: "Scan my Downloads folder for malware",
  laptop_exposed: "Check if my laptop is exposed to the internet",
  active_connections: "What's talking to the internet right now",
  laptop_fingerprint: "My laptop's full security report",
  arp_check: "Check if anyone is secretly spying on my wifi",
  steg_demo: "Hide a secret message inside a picture (demo)",
  update_tools: "Update every hacking tool"
};
const PHONE_PRESETS = {
  phone_message: "Show a message",
  phone_sound: "Play a sound"
};
const MAX_TEXT = 300;

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

  const url = new URL(request.url);
  const isWorker = env.HACKLAB_TOKEN && request.headers.get("X-Worker-Token") === env.HACKLAB_TOKEN;

  if (request.method === "GET") {
    if (isWorker) {
      const q = await load(env);
      return json({ jobs: q.jobs.filter((j) => j.status === "waiting" && deviceOf(j) === "laptop") });
    }
    if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
    if (!(await isOwner(env, data.user))) return json({ error: "Only the owner of this site can use the hack lab." }, 403);
    const q = await load(env);
    if (url.searchParams.get("device") === "phone") {
      // the phone page itself, polling for its own waiting jobs only
      return json({ jobs: q.jobs.filter((j) => j.status === "waiting" && deviceOf(j) === "phone") });
    }
    return json({ jobs: q.jobs.slice(0, 50), presets: PRESETS, phonePresets: PHONE_PRESETS });
  }

  if (request.method !== "POST") return json({ error: "Something went wrong. Try again." }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "That did not look right. Please try again." }, 400); }

  if (isWorker) {
    // the laptop helper sending back an answer - never lets it touch a phone job
    return answer(env, body && body.id, body, "laptop");
  }

  // everything else needs Salman signed in as the owner
  if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
  if (!(await isOwner(env, data.user))) return json({ error: "Only the owner of this site can use the hack lab." }, 403);

  if (body && body.answer_id) {
    // Salman's own phone, answering one of ITS OWN jobs (never a laptop job - checked in answer())
    return answer(env, body.answer_id, body, "phone");
  }

  let label, cmdKey, device = "laptop", text;
  if (body && body.what === "custom") {
    const cmd = String(body.cmd || "").trim();
    if (!cmd) return json({ error: "Type something to run first." }, 400);
    if (cmd.length > 500) return json({ error: "That is too long." }, 400);
    label = cmd;
    cmdKey = "custom:" + cmd;
  } else if (body && body.what === "phone_message") {
    text = String(body.text || "").trim();
    if (!text) return json({ error: "Type the message first." }, 400);
    if (text.length > MAX_TEXT) return json({ error: "That message is too long." }, 400);
    label = "Message: " + text;
    cmdKey = "phone_message";
    device = "phone";
  } else if (body && Object.prototype.hasOwnProperty.call(PHONE_PRESETS, body.what)) {
    label = PHONE_PRESETS[body.what];
    cmdKey = body.what;
    device = "phone";
  } else if (body && Object.prototype.hasOwnProperty.call(PRESETS, body.what)) {
    label = PRESETS[body.what];
    cmdKey = body.what;
  } else {
    return json({ error: "I did not understand that button." }, 400);
  }

  const q = await load(env);
  const now = new Date().toISOString();
  const job = {
    id: now + "-" + Math.random().toString(36).slice(2, 8), label, cmd: cmdKey, device,
    text: text || undefined, status: "waiting", ok: null, output: "", added_at: now, answered_at: null
  };
  q.jobs.unshift(job);
  q.jobs = q.jobs.slice(0, 50);
  await save(env, q);
  return json({ jobs: q.jobs.slice(0, 50), presets: PRESETS, phonePresets: PHONE_PRESETS });
}

/* Marks one job done. `wantDevice`, when given, refuses to answer a job that belongs to a different device -
   so the laptop helper's own secret can only ever answer laptop jobs, and vice versa for the phone. */
async function answer(env, id, body, wantDevice) {
  if (!id) return json({ error: "Missing job id." }, 400);
  const q = await load(env);
  const j = q.jobs.find((x) => x.id === id);
  if (!j) return json({ error: "That job is not on the list any more." }, 404);
  if (wantDevice && deviceOf(j) !== wantDevice) return json({ error: "That job is not yours to answer." }, 403);
  j.status = "done";
  j.ok = body.ok !== false;
  j.output = String(body.output || "").slice(0, 20000);
  j.answered_at = new Date().toISOString();
  await save(env, q);
  return json({ ok: true });
}

function deviceOf(j) { return j && j.device === "phone" ? "phone" : "laptop"; }

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
