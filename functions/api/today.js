/* The "Today" summary (TODAY-1, 30 Sep 2026): the few numbers Salman wants at a glance, worked out from what the bots
   already sent to the site (/api/bots, /api/special, /api/bees) and the control switches (/api/control).

  GET /api/today   -> { total, change_today, best, worst, needs_you, ... }   (site owner only)

It is read-only. The same summary feeds the AI helper (functions/api/assistant.js imports summarise() from here), so the
helper and the Home page can never disagree. Money is practice money only.

"Change today" needs a starting point for the day. Each bot feed saves one when the first news of a new day (Dubai time)
arrives: it remembers the last total from the day before (see noteDayOpen() in bots.js, special.js and bees.js).
*/

const CRYPTO = { money: "Money bot", learn: "Learning bot", quick: "Quick bot", ten: "$10 plan bot", m55: "Turtle 55", short: "Short bot", d20: "Daily leg" };

export async function onRequest(context) {
  try {
    const { request, env, data } = context;
    if (request.method !== "GET") return json({ error: "Something went wrong. Try again." }, 405);
    if (!env.DB) return json({ error: "The database is not connected yet." }, 503);
    if (!data || !data.user) return json({ error: "You are not signed in. Please sign in again." }, 401);
    if (!(await isOwner(env, data.user))) return json({ error: "Only the owner of this site can see this." }, 403);
    return json(await summarise(env));
  } catch (e) {
    return json({ error: "Something went wrong on the site. Please try again in a moment." }, 500);
  }
}

async function row(env, key) {
  try {
    const r = await env.DB.prepare("SELECT value, updated_at FROM store WHERE key = ?").bind(key).first();
    if (!r) return null;
    return { v: JSON.parse(r.value), at: r.updated_at };
  } catch (e) {
    return null;                                    // no store table yet, or a damaged row: treat as "nothing sent"
  }
}

const r2 = (n) => Math.round(n * 100) / 100;
const ageMin = (iso) => (iso && !isNaN(Date.parse(iso))) ? (Date.now() - Date.parse(iso)) / 60000 : null;
const words = (m) => m == null ? "a while" : m < 1 ? "just now" : m < 60 ? Math.round(m) + " min" : m < 2880 ? Math.round(m / 60) + " h" : Math.round(m / 1440) + " days";

/* Bees: money now, from the last saved point on the race chart (the page re-prices open trades live, the site cannot). */
function beeEquity(b, last) {
  if (typeof b.equity === "number") return b.equity;
  if (last && typeof last[b.name] === "number") return last[b.name];
  return b.cash;
}

export async function summarise(env) {
  const [botsR, spR, beesR, ctlR, openR] = await Promise.all(
    ["bots", "special", "bees", "control", "day_open"].map((k) => row(env, k)));
  const bots = botsR && botsR.v, sp = spR && spR.v, bees = beesR && beesR.v, ctl = (ctlR && ctlR.v) || {};
  const paused = (ctl.paused && typeof ctl.paused === "object") ? ctl.paused : {};
  const open = (openR && openR.v) || {};
  const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);   // Dubai day

  const parts = { bots: null, gold: null, bees: null };
  const list = [];                                   // every bot with its result so far
  let cryptoLines = [];
  if (bots && Array.isArray(bots.bots)) {
    let net = (typeof bots.closed === "number" ? bots.closed : 0);
    for (const b of bots.bots) net += b.openPnl || 0;
    parts.bots = r2(net);
    for (const b of bots.bots) {
      const n = r2((b.closed || 0) + (b.openPnl || 0));
      list.push({ key: b.key, name: CRYPTO[b.key] || b.name, net: n });
      cryptoLines.push({ name: CRYPTO[b.key] || b.name, net: n, settled: r2(b.closed || 0), open_result: r2(b.openPnl || 0), finished_trades: b.done, open_trades: b.open });
    }
  }
  const goldLines = [];
  if (sp && Array.isArray(sp.bots)) {
    let net = 0;
    for (const b of sp.bots) {
      const n = r2((b.balance || 0) - (b.start_balance || 0));
      net += n;
      list.push({ key: b.id === "sunny-gold-fast" ? "gold_fast" : "sunny_gold", name: b.name, net: n });
      goldLines.push({ name: b.name, net: n, finished_trades: Array.isArray(b.trades) ? b.trades.length : 0,
                       holding: b.open_position ? (b.open_position.side + " gold since " + String(b.open_position.opened || "").slice(0, 16)) : "nothing open",
                       note: Array.isArray(b.context) ? b.context.slice(0, 2).join(" ") : "", last_news_min_ago: Math.round(ageMin(b.updated) || 0) });
    }
    parts.gold = r2(net);
  }
  const beeLines = [];
  let beeNet = null;
  if (bees && Array.isArray(bees.bees)) {
    const last = Array.isArray(bees.curve) && bees.curve.length ? bees.curve[bees.curve.length - 1] : null;
    const start = bees.start_usd || 1000 / 3;
    let sum = 0;
    for (const b of bees.bees) {
      const e = beeEquity(b, last);
      sum += e - start;
      beeLines.push({ name: b.name, money: r2(e), change: r2(e - start), status: b.status || "", trades: b.trades });
    }
    beeNet = r2(sum);
    parts.bees = beeNet;
    list.push({ key: "bees", name: "The Bees (all six)", net: beeNet });
  }

  let total = 0, have = 0, change = 0, changeKnown = false;
  for (const k of Object.keys(parts)) {
    if (parts[k] == null) continue;
    total += parts[k]; have++;
    if (open[k] && open[k].day === today && typeof open[k].net === "number") { change += parts[k] - open[k].net; changeKnown = true; }
  }

  const sorted = list.slice().sort((a, b) => b.net - a.net);
  const best = sorted.length ? sorted[0] : null, worst = sorted.length ? sorted[sorted.length - 1] : null;

  /* "Needs you": only things Salman can act on. */
  const needs = [];
  if (ctl.halt_all) needs.push({ level: "bad", text: "\"Stop all new trades\" is switched ON. No bot is opening trades.", link: "/control/" });
  const pausedNames = Object.keys(paused).filter((k) => paused[k]).map((k) => (CRYPTO[k] || { sunny_gold: "Sunny Gold", gold_fast: "Sunny Gold Fast", bees: "The Bees" }[k] || k));
  if (pausedNames.length) needs.push({ level: "warn", text: "Paused: " + pausedNames.join(", ") + ".", link: "/control/" });
  const hb = bots && /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) UTC/.exec(bots.heartbeat || "");
  const hbMin = hb ? ageMin(hb[1] + "T" + hb[2] + "Z") : ageMin(bots && bots.updated);
  if (!bots) needs.push({ level: "warn", text: "No news from the bots yet.", link: "/control/" });
  else if (hbMin != null && hbMin > 150) needs.push({ level: "bad", text: "The bots have not run for " + words(hbMin) + ".", link: "/control/" });
  if (bots && bots.health && hbMin != null) {
    for (const k of Object.keys(bots.health)) {
      const at = Date.parse(bots.health[k] && bots.health[k].at);
      if (at && (Date.now() - at) / 60000 <= hbMin + 10) needs.push({ level: "bad", text: (CRYPTO[k] || k) + " had an error in its last run.", link: "/control/" });
    }
  }
  const beeMin = bees ? ageMin(bees.last_tick || bees.updated) : null;
  if (bees && beeMin != null && beeMin > 150 && !paused.bees) needs.push({ level: "warn", text: "The Bees have not moved for " + words(beeMin) + ".", link: "/control/" });
  const fast = sp && Array.isArray(sp.bots) && sp.bots.find((b) => b.id === "sunny-gold-fast");
  if (fast && !paused.gold_fast && (ageMin(fast.updated) || 0) > 60) needs.push({ level: "warn", text: "Sunny Gold Fast has been quiet for " + words(ageMin(fast.updated)) + " (the laptop may be off).", link: "/control/" });

  const recentTrades = bots && Array.isArray(bots.trades) ? bots.trades.slice(-6).map((t) => ({ when: t.t, bot: t.bot, coin: t.coin, result: t.r })) : [];
  const beeMoves = bees && Array.isArray(bees.trades) ? bees.trades.slice(-8).map((t) => ({ when: t.time, bee: t.bee, action: t.action, coin: t.coin, result: t.result_usd, why: t.why })) : [];

  return {
    ok: true,
    total: have ? r2(total) : null,
    parts,
    change_today: changeKnown ? r2(change) : null,
    best, worst,
    needs_you: needs,
    control: { halt_all: !!ctl.halt_all, paused: pausedNames },
    ready: bots && bots.ready ? { verdict: !!bots.ready.verdict, checks: (bots.ready.checks || []).map((c) => ({ name: c.name, ok: !!c.ok, detail: c.detail })) } : null,
    cloud: { last_run_min_ago: hbMin == null ? null : Math.round(hbMin), heartbeat: bots ? bots.heartbeat || null : null },
    crypto_bots: cryptoLines, gold_bots: goldLines, bees: beeLines, recent_trades: recentTrades, bee_moves: beeMoves,
    updated: new Date().toISOString()
  };
}

/* The owner: OWNER_EMAIL if that is set in Cloudflare's settings, otherwise the first account ever made. */
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
