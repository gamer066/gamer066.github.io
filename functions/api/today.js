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

/* Small charts. cum() turns [time, result] steps into a running total (last 24 steps). allSteps() does it for a set of bots. */
function cum(steps) {
  const ok = steps.filter((e) => isFinite(e[0]) && typeof e[1] === "number").sort((a, b) => a[0] - b[0]);
  if (ok.length < 2) return null;
  let run = 0;
  return ok.map((e) => r2(run += e[1])).slice(-24);
}
function allSteps(cs, trades) {
  const names = new Set(); cs.forEach((c) => { names.add(c.key); names.add(c.name); });
  let run = 0;
  const ok = (Array.isArray(trades) ? trades : []).filter((t) => t && typeof t.r === "number" && isFinite(Date.parse(t.t))).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return ok.map((t) => [Date.parse(t.t), r2(run += t.r)]);
}

/* The big chart: the total over time. Each group (crypto, gold, bees) is a step line; at any moment the total is the sum of each group's latest step. */
function totalSeries(events, total) {
  const all = [];
  for (const k of Object.keys(events)) for (const e of events[k]) all.push([e[0], k, e[1]]);
  all.sort((a, b) => a[0] - b[0]);
  const now = { bots: 0, gold: 0, bees: 0 };
  const pts = [];
  for (const e of all) { now[e[1]] = e[2]; pts.push([e[0], r2(now.bots + now.gold + now.bees)]); }
  if (total != null) pts.push([Date.now(), total]);
  if (pts.length < 2) return null;
  if (pts.length <= 60) return pts;
  const step = pts.length / 60, out = [];
  for (let i = 0; i < 60; i++) out.push(pts[Math.floor(i * step)]);
  out[out.length - 1] = pts[pts.length - 1];
  return out;
}

export async function summarise(env) {
  const [botsR, spR, beesR, ctlR, openR] = await Promise.all(
    ["bots", "special", "bees", "control", "day_open"].map((k) => row(env, k)));
  const bots = botsR && botsR.v, sp = spR && spR.v, bees = beesR && beesR.v, ctl = (ctlR && ctlR.v) || {};
  const paused = (ctl.paused && typeof ctl.paused === "object") ? ctl.paused : {};
  const open = (openR && openR.v) || {};
  const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);   // Dubai day
  const hbE = bots && /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) UTC/.exec(bots.heartbeat || "");
  const hbMinEarly = hbE ? ageMin(hbE[1] + "T" + hbE[2] + "Z") : ageMin(bots && bots.updated);

  const parts = { bots: null, gold: null, bees: null };
  const list = [];                                   // every bot with its result so far
  const cards = [];                                  // one card per bot for the Home page (name, one-line status, health, small chart)
  const events = { bots: [], gold: [], bees: [] };   // [time in ms, running result] steps, used for the big chart
  let cryptoLines = [];
  if (bots && Array.isArray(bots.bots)) {
    let net = (typeof bots.closed === "number" ? bots.closed : 0);
    for (const b of bots.bots) net += b.openPnl || 0;
    parts.bots = r2(net);
    for (const b of bots.bots) {
      const n = r2((b.closed || 0) + (b.openPnl || 0));
      list.push({ key: b.key, name: CRYPTO[b.key] || b.name, net: n });
      cryptoLines.push({ name: CRYPTO[b.key] || b.name, net: n, settled: r2(b.closed || 0), open_result: r2(b.openPnl || 0), finished_trades: b.done, open_trades: b.open });
      const mine = (Array.isArray(bots.trades) ? bots.trades : []).filter((t) => t && (t.bot === b.key || t.bot === b.name || t.bot === CRYPTO[b.key]));
      const err = bots.health && bots.health[b.key] && Date.parse(bots.health[b.key].at);
      let health = "ok";
      if (paused[b.key]) health = "late";
      else if (err && (Date.now() - err) / 60000 <= (hbMinEarly == null ? 90 : hbMinEarly + 10)) health = "bad";
      else if (hbMinEarly != null && hbMinEarly > 150) health = "bad";
      else if (hbMinEarly != null && hbMinEarly > 90) health = "late";
      cards.push({ key: b.key, group: "crypto", name: CRYPTO[b.key] || b.name, net: n, health, link: "/trading/",
        line: paused[b.key] ? "Paused by you" : (b.open ? b.open + " open, " : "None open, ") + (b.done || 0) + " finished",
        spark: cum(mine.map((t) => [Date.parse(t.t), t.r])) });
    }
    events.bots = allSteps(cards.filter((c) => c.group === "crypto"), bots.trades);
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
    const goldSteps = [];
    for (const b of sp.bots) {
      const done = (Array.isArray(b.trades) ? b.trades : []).filter((t) => t && typeof t.result_usd === "number");
      const steps = done.map((t) => [Date.parse(t.closed), t.result_usd]);
      for (const st of steps) goldSteps.push(st);
      const m = ageMin(b.updated), fast = b.id === "sunny-gold-fast";
      const key = fast ? "gold_fast" : "sunny_gold";
      const health = paused[key] ? "late" : m == null ? "late" : m > (fast ? 120 : 240) ? "bad" : m > (fast ? 60 : 150) ? "late" : "ok";
      cards.push({ key, group: "gold", name: b.name, net: r2((b.balance || 0) - (b.start_balance || 0)), health, link: "/special/",
        line: paused[key] ? "Paused by you" : b.open_position ? "Holding gold (" + b.open_position.side + ")" : "Waiting, nothing open",
        spark: cum(steps) });
    }
    events.gold = goldSteps.filter((e) => isFinite(e[0])).sort((a, b) => a[0] - b[0]);
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
    const curve = Array.isArray(bees.curve) ? bees.curve : [];
    const names = bees.bees.map((b) => b.name);
    const beeSteps = curve.map((c) => [Date.parse(c.t), r2(names.reduce((a, nm) => a + (typeof c[nm] === "number" ? c[nm] : start), 0) - start * names.length)]).filter((e) => isFinite(e[0]));
    events.bees = beeSteps;
    const trading = bees.bees.filter((b) => b.pos || (Array.isArray(b.basket) && b.basket.length)).length;
    const bm = ageMin(bees.last_tick || bees.updated);
    cards.push({ key: "bees", group: "bees", name: "The Bees", net: beeNet, link: "/special/bees/",
      health: paused.bees ? "late" : bm == null ? "late" : bm > 240 ? "bad" : bm > 150 ? "late" : "ok",
      line: paused.bees ? "Paused by you" : trading ? trading + " of " + names.length + " are in a trade" : "Six bees racing, all waiting",
      spark: beeSteps.length > 1 ? beeSteps.map((e) => e[1]).slice(-24) : null });
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
    cards,
    history: totalSeries(events, have ? r2(total) : null),
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
