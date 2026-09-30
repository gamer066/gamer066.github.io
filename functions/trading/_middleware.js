/* Keeps the trading page current now that the bots run in the cloud.
 *
 * The page itself is built on the laptop, with every number baked in. Since 24 Sep 2026 the bots run on GitHub's
 * cloud and send their numbers to /api/bots after every run. When those are newer than the laptop's copy of the page
 * (the time in /assets/status.js), this fills them into the page on its way out: the headline numbers, the chart,
 * each bot's line, the open trades, the checklist counts and the "last sent up" line. Everything else on the page,
 * words and layout, stays exactly as the laptop wrote it. If anything here fails, the laptop's page goes out as it is.
 *
 * The sign-in gate (functions/_middleware.js) has already run before this, so only a signed-in visitor gets here.
 */

export async function onRequest(context) {
  const { request, env, next } = context;
  const res = await next();
  try {
    if (request.method !== "GET" || res.status !== 200) return res;
    if (!(res.headers.get("Content-Type") || "").includes("text/html") || !env.DB) return res;
    const snap = await latest(env);
    if (!snap) return res;
    const baked = await bakedAt(env, request);
    if (baked && Date.parse(snap.updated) <= baked) return res;
    return fill(res, snap);
  } catch (e) {
    return res;
  }
}

async function latest(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM store WHERE key = 'bots'").first();
    return row ? JSON.parse(row.value) : null;
  } catch (e) {
    return null;                                           // no store table yet: nothing has been sent
  }
}

/* When the laptop last published the page, from the small status file it writes at the same moment. */
async function bakedAt(env, request) {
  try {
    const r = await env.ASSETS.fetch(new URL("/assets/status.js", request.url));
    const m = /"updated"\s*:\s*"([^"]+)"/.exec(await r.text());
    return m ? Date.parse(m[1]) || 0 : 0;
  } catch (e) {
    return 0;
  }
}

function fill(res, s) {
  const bots = s.bots || [];
  const open = bots.reduce((a, b) => a + b.openPnl, 0);
  const net = s.closed + open;
  const done = (s.trades || []).filter((t) => !t.adj).length;
  const nOpen = (s.positions || []).length;
  const gated = bots.filter((b) => b.target);
  let g = 0;

  const out = new HTMLRewriter()
    .on("#netpill", {
      element(e) {
        e.setAttribute("class", "pill " + (net >= 0 ? "u" : "d"));
        e.setInnerContent(net >= 0 ? "Up right now" : "Down right now");
      }
    })
    .on("#net", {
      element(e) {
        e.setAttribute("class", "big num " + tone(net));
        e.setInnerContent(money(net), { html: true });
      }
    })
    .on("#netpct", { element(e) { e.setInnerContent(pct(net / 100), { html: true }); } })
    .on(".split .tile:nth-child(1)", {
      element(e) {
        e.setInnerContent(
          `<span class="pill ${s.closed >= 0 ? "u" : "d"}">${s.closed >= 0 ? "Won" : "Lost"}</span>` +
          `<div class="k">Trades we finished</div>` +
          `<div class="v num ${tone(s.closed)}">${money(s.closed)}</div>` +
          `<div class="n">${done} ${done === 1 ? "trade" : "trades"} sold and done. This number is settled.</div>`,
          { html: true });
      }
    })
    .on(".split .tile:nth-child(2)", {
      element(e) {
        e.setInnerContent(
          `<span class="pill u">Running</span><div class="k">Trades still open</div>` +
          `<div class="v num ${tone(open)}" id="opentotal">${money(open)}</div>` +
          `<div class="n">${nOpen} ${nOpen === 1 ? "trade" : "trades"} still open. This one moves.</div>`,
          { html: true });
      }
    })
    .on(".chart svg", { element(e) { e.replace(chart(s.trades || [], open, done), { html: true }); } })
    .on(".rows", { element(e) { e.setInnerContent(bots.map(botRow).join(""), { html: true }); } })
    .on("#tbody", { element(e) { e.setInnerContent((s.positions || []).map(tradeRow).join(""), { html: true }); } })
    .on("script#positions", {
      element(e) {
        const data = { closed: s.closed, positions: s.positions || [] };
        e.setInnerContent(JSON.stringify(data).replace(/</g, "\\u003c"), { html: true });
      }
    })
    // The laptop's re-pricing script treats every trade as a buy. Its replacement also prices the short bot's
    // bets the right way round; otherwise it is the same script.
    .on("body script:not([src]):not([id]):not([type])", {
      element(e) { e.replace('<script src="/assets/trading-live.js?v=1"></script>', { html: true }); }
    })
    .on(".gate .g", {
      element(e) {
        const b = gated[g++];
        if (!b) return;
        const w = Math.min(100, Math.round((100 * b.done) / b.target));
        const nm = b.key === "ten" ? `<b>${esc(b.name)}</b>` : esc(b.name);
        e.setInnerContent(`<span>${nm} &mdash; finished practice trades</span><span class="c">${b.done} / ${b.target}</span>` +
          `<div class="bar"><i style="width:${w}%"></i></div>`, { html: true });
      }
    })
    .on("footer div:nth-child(2)", {
      element(e) {
        e.setInnerContent(`Bot records last sent up ${esc(dubai(s.updated))} Dubai by the cloud run. ` +
          "Open trades re-priced in your browser from Binance's public feed.", { html: true });
      }
    })
    .transform(res);
  return out;
}

function botRow(b) {
  const idle = !b.done && !b.open && b.key === "ten" ? ' <span class="pill n">Not started</span>' : "";
  return `<div class="row"><div class="nm">${esc(b.name)}${idle}</div>` +
    `<div class="a num ${tone(b.closed)}">${money(b.closed)}<span class="lbl">finished</span></div>` +
    `<div class="b num ${tone(b.openPnl)}">${money(b.openPnl)}<span class="lbl">open</span></div>` +
    `<div class="ds">${esc(b.desc || "")} &middot; ${b.open} open, ${b.done} finished</div></div>`;
}

function tradeRow(p) {
  const pnl = p.side === "short" ? p.cost - p.val : p.val - p.cost;
  const pc = p.cost ? (100 * pnl) / p.cost : 0;
  const who = p.side === "short" ? esc(p.bot) + " &middot; short" : esc(p.bot);
  return `<tr><td><span class="coin">${esc(p.coin)}</span> <span class="who">${who}</span></td>` +
    `<td class="num">$${p.cost.toFixed(2)}</td><td class="num">$${p.val.toFixed(2)}</td>` +
    `<td class="num ${pnl >= 0 ? "up" : "down"}">${money(pnl)}&nbsp;&nbsp;${pc >= 0 ? "+" : "-"}${Math.abs(pc).toFixed(1)}%</td>` +
    `<td class="num">${stop(p.stop)}</td></tr>`;
}

/* One bar per finished trade, oldest first, then a gap and one bar for everything still open. */
function chart(trades, open, done) {
  const W = 720, TOP = 14, H = 170;
  const vals = trades.map((t) => t.r).concat([open]);
  const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const scale = hi - lo > 0 ? H / (hi - lo) : 0;
  const zero = TOP + hi * scale;
  const step = W / (trades.length + 2), bw = step * 0.62, pad = (step - bw) / 2;
  const bar = (i, v, fill) => {
    const h = Math.max(1.5, Math.abs(v) * scale);
    const y = v >= 0 ? zero - h : zero;
    return `<rect x="${(i * step + pad).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" ` +
      `rx="2" fill="${fill}"><title>${v >= 0 ? "+" : ""}${v.toFixed(2)} USDT</title></rect>`;
  };
  let svg = `<svg viewBox="0 0 ${W} 210" role="img" aria-label="Every finished trade as a bar, then open trades">` +
    `<line x1="0" y1="${zero.toFixed(1)}" x2="${W}" y2="${zero.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  trades.forEach((t, i) => { svg += bar(i, t.r, t.r >= 0 ? "var(--up)" : "var(--down)"); });
  svg += bar(trades.length + 1, open, open >= 0 ? "var(--up)" : "var(--down)");
  svg += `<text x="0" y="202" fill="var(--ink-3)" font-size="11" font-family="Archivo,sans-serif">${done} finished</text>` +
    `<text x="${W}" y="202" fill="var(--ink-3)" font-size="11" text-anchor="end" font-family="Archivo,sans-serif">open now</text>` +
    `<text x="0" y="${(zero - 6).toFixed(1)}" fill="var(--ink-3)" font-size="10" font-family="IBM Plex Mono,monospace">0</text></svg>`;
  return svg;
}

function money(v) {
  const s = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(v) < 0.005) return "$0.00";
  return (v < 0 ? "&minus;" : "+") + s;
}
function pct(v) { return (v < 0 ? "&minus;" : "+") + Math.abs(v).toFixed(2) + "%"; }
function tone(v) { return Math.abs(v) < 0.005 ? "" : v > 0 ? "up" : "down"; }
function stop(v) {
  if (v === null || v === undefined) return "&mdash;";
  const n = Number(v);
  return n >= 100 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n >= 1 ? n.toFixed(4) : n.toFixed(5);
}
/* "24 Sep 2026, 05:40", the way the laptop writes it (some date libraries say "Sept"). */
function dubai(iso) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "numeric",
    year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso))) parts[p.type] = p.value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${parts.day} ${months[Number(parts.month) - 1]} ${parts.year}, ${parts.hour}:${parts.minute}`;
}
function esc(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
