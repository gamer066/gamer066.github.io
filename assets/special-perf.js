/* Trading performance for the "Special bot trades" pages: the numbers and panels TradingView's Strategy Tester shows
 * under "Performance Summary" and "List of trades", worked out from a bot's closed trades.
 *
 *   var a = SDLPerf.analyze(bot.trades, bot.start_balance, tzSeconds);   // numbers only, no page access
 *   el.innerHTML = SDLPerf.summaryHTML(a);                                // every renderer returns an HTML string
 *
 * The trades come from /special/data/bots.json (practice money only). Every string read from that file is treated as
 * untrusted and escaped before it goes into HTML, and CSV cells are made safe to open in a spreadsheet.
 * Rates and "Pct" fields are fractions (0.08 means 8%), like SDLSpecial.pct(). Times are milliseconds (UTC).
 * SDLPerf.CSS styles every "pf-" class; SDLPerf.injectCSS() adds it to the page once.
 */
(function () {
  "use strict";

  var MIN = 6e4, HOUR = 36e5, DAY = 864e5, WEEK = 7 * DAY;
  var MINUS = "\u2212", DASH = "\u2014", NDASH = "\u2013", DOT = " \u00b7 ";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
    "November", "December"];
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];   // shown Monday first

  /* The TradingView-dark palette. Text/background pairs are checked for 4.5:1 contrast by the Node test. */
  var PAL = {
    bg: "#131722", panel: "#1E222D", line: "#2A2E39", ink: "#D1D4DC", ink2: "#B2B5BE", mute: "#8E919B",
    up: "#22AB94", down: "#F7525F", amber: "#F5B544", blue: "#5B8CFF", white: "#FFFFFF",
    upRGB: "34,171,148", downRGB: "247,82,95", zeroRGB: "142,145,155", emptyRGB: "42,46,57",
    heat: [0.12, 0.22, 0.34, 0.46, 0.58],   // shade for heat levels 1..5
    heatWhite: 4,                            // from this level up, heat cells use white text
    pillAlpha: 0.12, longInk: "#2DBFA6", shortInk: "#FF6B76"
  };

  var NOTE = "These numbers only count trades that are finished; a trade still open is not included yet. " +
    "\"Biggest drop\" is the largest fall from the bot's best balance. The steadiness scores are rough guides: higher means smoother results.";

  /* ================================================================ helpers ================================ */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function time(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v !== "string" || !v) return null;
    var t = Date.parse(v);
    return isNaN(t) ? null : t;
  }
  function sig(v) { return parseFloat(v.toPrecision(12)); }   // trims float noise such as 0.30000000000000004
  function clampInt(v, lo, hi, dflt) {
    var n = num(v);
    return n === null ? dflt : Math.max(lo, Math.min(hi, Math.round(n)));
  }
  function mean(xs) {
    if (!xs.length) return null;
    var s = 0;
    for (var i = 0; i < xs.length; i++) s += xs[i];
    return s / xs.length;
  }
  function stdev(xs, m) {   // sample standard deviation
    if (xs.length < 2) return null;
    var s = 0;
    for (var i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m);
    return Math.sqrt(s / (xs.length - 1));
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ---- formatting (fixed en-US style so the page looks the same everywhere) ---- */
  function group(s) {
    var p = s.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return p.join(".");
  }
  function fixed(v, dp) { return group(Math.abs(v).toFixed(dp)); }
  function money(v, signed) {
    if (num(v) === null) return DASH;
    var r = Math.round(v * 100) / 100;
    if (r === 0) return "$0.00";
    return (r < 0 ? MINUS : signed ? "+" : "") + "$" + fixed(r, 2);
  }
  function pct(v, signed, dp) {
    if (v === Infinity) return "\u221e";
    if (num(v) === null) return DASH;
    dp = dp == null ? 2 : dp;
    var x = v * 100, f = Math.pow(10, dp);
    if (Math.round(Math.abs(x) * f) === 0) return (0).toFixed(dp) + "%";
    return (x < 0 ? MINUS : signed ? "+" : "") + fixed(x, dp) + "%";
  }
  function ratio(v, dp) {
    if (v === Infinity) return "\u221e";
    if (v === -Infinity) return MINUS + "\u221e";
    if (num(v) === null) return DASH;
    dp = dp == null ? 2 : dp;
    if (Math.round(Math.abs(v) * Math.pow(10, dp)) === 0) return (0).toFixed(dp);
    return (v < 0 ? MINUS : "") + fixed(v, dp);
  }
  function intf(v) { return num(v) === null ? DASH : (v < 0 ? MINUS : "") + group(String(Math.abs(Math.round(v)))); }
  function price(v, dp) {
    if (num(v) === null) return DASH;
    return (v < 0 ? MINUS : "") + fixed(v, dp == null ? 2 : dp);
  }
  function qtyf(v) {
    if (num(v) === null) return DASH;
    var s = Math.abs(v).toFixed(6).replace(/\.?0+$/, "");
    return (v < 0 ? MINUS : "") + group(s);
  }
  function trim0(s) { return s.indexOf(".") < 0 ? s : s.replace(/\.?0+$/, ""); }
  /* short money for axis ticks and small cells: $950, $1.2k, −$35.5 */
  function compact(v, signed) {
    if (num(v) === null) return DASH;
    var a = Math.abs(v), s;
    if (a >= 1e6) s = trim0((a / 1e6).toFixed(a >= 1e7 ? 0 : 1)) + "M";
    else if (a >= 1e3) s = trim0((a / 1e3).toFixed(a >= 1e4 ? 0 : 1)) + "k";
    else if (a >= 100) s = a.toFixed(0);
    else s = trim0(a.toFixed(a >= 10 ? 1 : 2));
    if (s === "0") return "$0";
    return (v < 0 ? MINUS : signed && v > 0 ? "+" : "") + "$" + s;
  }
  function dur(ms) {
    if (num(ms) === null || ms < 0) return DASH;
    if (ms < MIN) return "<1m";
    var m = Math.round(ms / MIN);
    if (m < 60) return m + "m";
    if (ms < DAY) {
      var h = Math.floor(m / 60), mm = m % 60;
      return h + "h" + (mm ? " " + mm + "m" : "");
    }
    var th = Math.round(ms / HOUR), d = Math.floor(th / 24), hh = th % 24;
    return d + "d" + (hh ? " " + hh + "h" : "");
  }
  function parts(ms, tz) {
    var d = new Date(ms + tz * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(),
      wd: d.getUTCDay() };
  }
  function when(ms, tz, withYear) {
    if (num(ms) === null) return DASH;
    var p = parts(ms, tz || 0);
    return p.d + " " + MONTHS[p.m] + (withYear ? " " + p.y : "") + " " + pad2(p.h) + ":" + pad2(p.mi);
  }
  function tzOf(v) {
    var s = num(v);
    if (s === null) { try { s = -new Date().getTimezoneOffset() * 60; } catch (e) { s = 0; } }
    s = Math.round(s / 60) * 60;
    return Math.max(-14 * 3600, Math.min(14 * 3600, s));
  }
  function tzLabel(sec) {
    if (!sec) return "UTC";
    var a = Math.abs(sec), h = Math.floor(a / 3600), m = Math.round((a % 3600) / 60);
    return "UTC" + (sec < 0 ? MINUS : "+") + h + (m ? ":" + pad2(m) : "");
  }
  function tone(v) { return num(v) === null || v === 0 ? "" : v > 0 ? "up" : "down"; }
  function tcls(t) { return t ? " pf-" + t : ""; }

  /* ================================================================ the numbers ============================ */

  function sideOf(s) {
    var k = typeof s === "string" ? s.trim().toLowerCase() : "";
    return k === "long" || k === "buy" ? "long" : k === "short" || k === "sell" ? "short" : "other";
  }

  /* Closed trades in the order they closed, with running totals. Trades without a finite result_usd are skipped. */
  function normalize(trades, start) {
    var list = [];
    (Array.isArray(trades) ? trades : []).forEach(function (t, idx) {
      if (!t || typeof t !== "object" || num(t.result_usd) === null) return;
      var o = time(t.opened), c = time(t.closed);
      list.push({
        idx: idx, side: sideOf(t.side), sideRaw: t.side == null ? "" : String(t.side),
        opened: o, closed: c, entry: num(t.entry), exit: num(t.exit), qty: num(t.qty), r: t.result_usd,
        hold: o !== null && c !== null && c >= o ? c - o : null,
        key: c !== null ? c : o !== null ? o : Infinity
      });
    });
    list.sort(function (a, b) {
      return (a.key - b.key) || ((a.opened || 0) - (b.opened || 0)) || (a.idx - b.idx);
    });
    var base = start !== null ? start : 0, cum = 0;
    list.forEach(function (x, i) {
      x.n = i + 1;
      x.balBefore = base + cum;
      cum += x.r;
      x.cum = sig(cum);
      x.balAfter = sig(base + cum);
      /* % of the position's size (entry x size), like TradingView's "Profit %" */
      var q = x.qty !== null ? Math.abs(x.qty) : null;
      if (x.entry !== null && x.entry > 0 && q) x.posRet = x.r / (x.entry * q);
      else if (x.entry !== null && x.entry > 0 && x.exit !== null && x.side !== "other")
        x.posRet = (x.exit - x.entry) / x.entry * (x.side === "short" ? -1 : 1);
      else x.posRet = null;
      /* % of the account balance just before the trade */
      x.acctRet = start !== null && x.balBefore > 0 ? x.r / x.balBefore : null;
    });
    return list;
  }

  function basic(xs) {
    var n = xs.length, wins = 0, losses = 0, even = 0, gp = 0, gl = 0, lw = null, ll = null;
    var hs = 0, hn = 0, whs = 0, whn = 0, lhs = 0, lhn = 0;
    xs.forEach(function (x) {
      var r = x.r;
      if (r > 0) {
        wins++; gp += r; if (lw === null || r > lw) lw = r;
        if (x.hold !== null) { whs += x.hold; whn++; }
      } else if (r < 0) {
        losses++; gl += r; if (ll === null || r < ll) ll = r;
        if (x.hold !== null) { lhs += x.hold; lhn++; }
      } else even++;
      if (x.hold !== null) { hs += x.hold; hn++; }
    });
    gp = sig(gp); gl = sig(gl);
    var net = sig(gp + gl);
    var avgWin = wins ? gp / wins : null, avgLoss = losses ? gl / losses : null;
    return {
      n: n, wins: wins, losses: losses, breakeven: even, winRate: n ? wins / n : null,
      net: net, grossProfit: gp, grossLoss: gl,
      profitFactor: gl < 0 ? gp / -gl : gp > 0 ? Infinity : null,
      avgTrade: n ? net / n : null, avgWin: avgWin, avgLoss: avgLoss,
      payoffRatio: avgWin !== null && avgLoss !== null ? avgWin / -avgLoss : avgWin !== null ? Infinity : null,
      largestWin: lw, largestLoss: ll,
      avgHoldMs: hn ? hs / hn : null, avgWinHoldMs: whn ? whs / whn : null, avgLossHoldMs: lhn ? lhs / lhn : null
    };
  }

  function niceStep(raw) {
    if (!(raw > 0) || !isFinite(raw)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p, steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (f <= steps[i] * (1 + 1e-9)) return sig(steps[i] * p);
    return sig(10 * p);
  }

  /* About `bins` equal-width bins on round numbers; 0 is always a bin edge when there are both wins and losses. */
  function histogram(vals, bins) {
    bins = bins || 12;
    if (!vals.length) return { edges: [], counts: [], step: 0, lo: null, hi: null };
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < vals.length; i++) { if (vals[i] < min) min = vals[i]; if (vals[i] > max) max = vals[i]; }
    var step, lo, hi;
    if (max - min < 1e-9 * Math.max(1, Math.abs(max))) {
      step = niceStep(Math.max(Math.abs(min), 1) / 4);
      lo = sig(Math.floor(min / step) * step);
      hi = sig(lo + step);
    } else {
      step = niceStep((max - min) / bins);
      lo = sig(Math.floor(min / step + 1e-9) * step);
      hi = sig(Math.ceil(max / step - 1e-9) * step);
      if (hi <= lo) hi = sig(lo + step);
    }
    var k = Math.max(1, Math.round((hi - lo) / step)), edges = [], counts = [];
    for (i = 0; i <= k; i++) edges.push(sig(lo + i * step));
    for (i = 0; i < k; i++) counts.push(0);
    vals.forEach(function (v) {
      var j = Math.floor((v - lo) / step + 1e-9);
      counts[j < 0 ? 0 : j >= k ? k - 1 : j]++;
    });
    return { edges: edges, counts: counts, step: step, lo: lo, hi: hi };
  }

  /**
   * analyze(trades, startBalance, tzOffsetSeconds) -> the full performance breakdown (see the returned object).
   * trades: [{opened, closed, side, entry, exit, qty, result_usd}], ISO times; trades without a finite result_usd are
   * skipped. startBalance: optional (needed for % figures). tzOffsetSeconds: the clock used for months, hours and
   * weekdays (e.g. 14400 for Dubai); defaults to the visitor's own offset.
   */
  function analyze(trades, startBalance, tzOffsetSeconds) {
    var start = num(startBalance);
    if (start !== null && start <= 0) start = null;
    var tz = tzOf(tzOffsetSeconds);
    var list = normalize(trades, start);
    var b = basic(list), n = b.n, base = start !== null ? start : 0;

    /* ---- time span ---- */
    var firstOpen = null, lastClose = null, firstKey = null, lastKey = null;
    list.forEach(function (x) {
      if (x.opened !== null && (firstOpen === null || x.opened < firstOpen)) firstOpen = x.opened;
      if (x.closed !== null && (lastClose === null || x.closed > lastClose)) lastClose = x.closed;
      if (x.key !== Infinity) { if (firstKey === null) firstKey = x.key; lastKey = x.key; }
    });

    /* ---- balance curve and drawdown (closed trades) ---- */
    var equity = [], drawdown = [];
    if (n) {
      var t0 = firstOpen !== null ? firstOpen : firstKey;
      if (t0 !== null && firstKey !== null && firstKey < t0) t0 = firstKey;
      equity.push({ t: t0, bal: base });
      var prevT = t0;
      list.forEach(function (x) {
        var t = x.key !== Infinity ? x.key : prevT;
        prevT = t;
        equity.push({ t: t, bal: x.balAfter });
      });
    }
    var peak = -Infinity, peakT = null, trough = Infinity, maxDD = 0, maxDDPct = 0, runup = 0;
    var under = false, longest = 0, ongoing = false, ddPeakT = null, ddTroughT = null, lastT = null;
    equity.forEach(function (p) {
      if (p.bal >= peak - 1e-9) {
        if (under && p.t !== null && peakT !== null) longest = Math.max(longest, p.t - peakT);
        under = false;
        if (p.bal > peak) peak = p.bal;
        peakT = p.t;
      } else under = true;
      var dd = peak - p.bal;
      if (dd < 1e-9) dd = 0;
      dd = sig(dd);
      var ddPct = start !== null && peak > 0 ? dd / peak : null;
      drawdown.push({ t: p.t, dd: dd, ddPct: ddPct });
      if (dd > maxDD) { maxDD = dd; ddPeakT = peakT; ddTroughT = p.t; }
      if (ddPct !== null && ddPct > maxDDPct) maxDDPct = ddPct;
      if (p.bal < trough) trough = p.bal;
      if (p.bal - trough > runup) runup = sig(p.bal - trough);
      if (p.t !== null) lastT = p.t;
    });
    if (under && lastT !== null && peakT !== null) { longest = Math.max(longest, lastT - peakT); ongoing = true; }

    /* ---- streaks ---- */
    var cw = 0, cl = 0, mw = 0, ml = 0;
    list.forEach(function (x) {
      if (x.r > 0) { cw++; cl = 0; } else if (x.r < 0) { cl++; cw = 0; } else { cw = 0; cl = 0; }
      if (cw > mw) mw = cw;
      if (cl > ml) ml = cl;
    });
    var streak = { kind: null, len: 0 };
    if (n) {
      var kindOf = function (r) { return r > 0 ? "win" : r < 0 ? "loss" : "even"; };
      streak.kind = kindOf(list[n - 1].r);
      for (var i = n - 1; i >= 0 && kindOf(list[i].r) === streak.kind; i--) streak.len++;
    }

    /* ---- risk-adjusted (per trade, not annualised) ---- */
    var basis = start !== null ? "account" : "position";
    var rets = list.map(function (x) { return basis === "account" ? x.acctRet : x.posRet; })
      .filter(function (v) { return v !== null; });
    var rm = mean(rets), rsd = rm === null ? null : stdev(rets, rm);
    var sharpe = rets.length >= 2 && rsd > 0 ? rm / rsd : null;
    var downSq = 0;
    rets.forEach(function (v) { if (v < 0) downSq += v * v; });
    var dsd = rets.length ? Math.sqrt(downSq / rets.length) : null;
    var sortino = rets.length >= 2 ? (dsd > 0 ? rm / dsd : rm > 0 ? Infinity : null) : null;
    var usd = list.map(function (x) { return x.r; });
    var um = mean(usd), usd_sd = um === null ? null : stdev(usd, um);
    var sqn = n >= 2 && usd_sd > 0 ? Math.sqrt(Math.min(n, 100)) * um / usd_sd : null;
    var sorted = usd.slice().sort(function (p, q) { return p - q; });
    var median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : null;

    /* ---- long / short ---- */
    function sideStats(which) {
      var s = basic(list.filter(function (x) { return x.side === which; }));
      return { n: s.n, net: s.net, winRate: s.winRate, wins: s.wins, losses: s.losses, grossProfit: s.grossProfit,
        grossLoss: s.grossLoss, profitFactor: s.profitFactor, avgTrade: s.avgTrade, largestWin: s.largestWin,
        largestLoss: s.largestLoss, avgHoldMs: s.avgHoldMs };
    }
    var otherN = list.filter(function (x) { return x.side === "other"; }).length;

    /* ---- calendar: months and years by close time, hours and weekdays by open time ---- */
    var monthly = [], yearly = [], mIdx = {}, yIdx = {};
    list.forEach(function (x) {
      if (x.closed === null) return;
      var p = parts(x.closed, tz), mk = p.y * 12 + p.m, e = mIdx[mk], y = yIdx[p.y];
      if (!e) { e = mIdx[mk] = { y: p.y, m: p.m + 1, n: 0, wins: 0, net: 0, pct: null, startBal: start !== null ? x.balBefore : null }; monthly.push(e); }
      if (!y) { y = yIdx[p.y] = { y: p.y, n: 0, wins: 0, net: 0, pct: null, startBal: start !== null ? x.balBefore : null }; yearly.push(y); }
      e.n++; y.n++;
      if (x.r > 0) { e.wins++; y.wins++; }
      e.net += x.r; y.net += x.r;
    });
    monthly.concat(yearly).forEach(function (e) {
      e.net = sig(e.net);
      e.pct = e.startBal !== null && e.startBal > 0 ? e.net / e.startBal : null;
    });
    var byHour = [], byWeekday = [], k;
    for (k = 0; k < 24; k++) byHour.push({ n: 0, wins: 0, net: 0 });
    for (k = 0; k < 7; k++) byWeekday.push({ n: 0, wins: 0, net: 0 });
    list.forEach(function (x) {
      var t = x.opened !== null ? x.opened : x.closed;
      if (t === null) return;
      var p = parts(t, tz), h = byHour[p.h], w = byWeekday[p.wd];
      h.n++; w.n++;
      if (x.r > 0) { h.wins++; w.wins++; }
      h.net = sig(h.net + x.r); w.net = sig(w.net + x.r);
    });

    /* ---- time in market: union of open-to-close spans over first entry to last exit ---- */
    var spans = list.filter(function (x) { return x.hold !== null; }).map(function (x) { return [x.opened, x.closed]; })
      .sort(function (p, q) { return p[0] - q[0]; });
    var busy = 0, cs = null, ce = null;
    spans.forEach(function (v) {
      if (cs === null) { cs = v[0]; ce = v[1]; }
      else if (v[0] <= ce) ce = Math.max(ce, v[1]);
      else { busy += ce - cs; cs = v[0]; ce = v[1]; }
    });
    if (cs !== null) busy += ce - cs;
    var span = firstOpen !== null && lastClose !== null ? lastClose - firstOpen : null;

    return {
      n: n, wins: b.wins, losses: b.losses, breakeven: b.breakeven, winRate: b.winRate,
      netProfit: b.net, netPct: start !== null && n ? b.net / start : null,
      start: start, endBalance: start !== null ? sig(start + b.net) : null,
      grossProfit: b.grossProfit, grossLoss: b.grossLoss, profitFactor: b.profitFactor,
      expectancy: b.avgTrade, avgTradePct: rm, median: median,
      avgWin: b.avgWin, avgLoss: b.avgLoss, payoffRatio: b.payoffRatio,
      largestWin: b.largestWin, largestLoss: b.largestLoss,
      largestWinShare: b.largestWin !== null && b.grossProfit > 0 ? b.largestWin / b.grossProfit : null,
      largestLossShare: b.largestLoss !== null && b.grossLoss < 0 ? b.largestLoss / b.grossLoss : null,
      maxConsecWins: mw, maxConsecLosses: ml, streak: streak,
      avgHoldMs: b.avgHoldMs, avgWinHoldMs: b.avgWinHoldMs, avgLossHoldMs: b.avgLossHoldMs,
      long: sideStats("long"), short: sideStats("short"), otherSide: otherN,
      equity: equity, drawdown: drawdown,
      maxDrawdown: maxDD, maxDrawdownPct: start !== null ? maxDDPct : null,
      maxDrawdownPeakAt: ddPeakT, maxDrawdownTroughAt: ddTroughT,
      maxDrawdownDurationMs: n ? longest : null, inDrawdown: ongoing, maxRunup: runup,
      recoveryFactor: maxDD > 0 ? b.net / maxDD : b.net > 0 ? Infinity : null,
      sharpe: sharpe, sortino: sortino, sqn: sqn, returnsBasis: basis,
      monthly: monthly, yearly: yearly, byWeekday: byWeekday, byHour: byHour,
      histogram: histogram(usd, 12),
      exposurePct: span > 0 && spans.length ? Math.min(1, busy / span) : null,
      tradesPerWeek: span !== null && span >= WEEK ? n / (span / WEEK) : null,
      firstTrade: firstOpen !== null ? firstOpen : firstKey, lastTrade: lastClose !== null ? lastClose : lastKey,
      tz: tz, tzLabel: tzLabel(tz),
      note: NOTE,
      trades: list
    };
  }

  /* Balance and drawdown ready for Lightweight Charts: {time (seconds, shifted by tz), value}, times strictly rising. */
  function lwcSeries(a) {
    a = ensure(a);
    var eq = [], dd = [], ddp = [], last = -Infinity;
    (a.equity || []).forEach(function (p, i) {
      if (p.t === null) return;
      var t = Math.floor(p.t / 1000) + (a.tz || 0);
      if (t <= last) t = last + 1;
      last = t;
      var d = a.drawdown[i];
      eq.push({ time: t, value: Math.round(p.bal * 100) / 100 });
      dd.push({ time: t, value: -Math.round(d.dd * 100) / 100 });
      if (d.ddPct !== null) ddp.push({ time: t, value: -Math.round(d.ddPct * 1e6) / 1e4 });
    });
    return { equity: eq, drawdown: dd, drawdownPct: ddp };
  }

  function ensure(a) {
    if (Array.isArray(a)) return analyze(a);
    return a && typeof a === "object" && typeof a.n === "number" ? a : { n: 0 };
  }

  /* ================================================================ HTML renderers ========================= */

  function empty(detail, opts) {
    if (opts && typeof opts.empty === "string") return '<div class="pf-empty" role="status">' + esc(opts.empty) + "</div>";
    return '<div class="pf-empty" role="status"><b>No closed trades yet</b> ' + DASH + " the bot is still testing. " +
      esc(detail) + "</div>";
  }

  function heat(v, max) {
    if (num(v) === null) return "pf-h0";
    if (v === 0 || !(max > 0)) return "pf-hz";
    var lv = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(Math.abs(v) / max) * 5 - 1e-9)));
    return (v > 0 ? "pf-hp" : "pf-hn") + lv;
  }

  function tile(k, v, t, sub, subTone, tip, big) {
    return '<div class="pf-m' + (big ? " pf-big" : "") + '" title="' + esc(tip) + '"><span class="pf-k">' + esc(k) +
      '</span><b class="pf-v' + tcls(t) + '">' + esc(v) + "</b>" +
      (sub ? '<small class="pf-s' + tcls(subTone) + '">' + esc(sub) + "</small>" : "") + "</div>";
  }

  function plural(n, one, many) { return intf(n) + " " + (n === 1 ? one : many); }

  /** summaryHTML(a[, opts]) -> Strategy-Tester-style "Performance Summary": 6 headline figures plus 20 more. */
  function summaryHTML(a, opts) {
    a = ensure(a);
    if (!a.n) return empty("Its results will show here after its first trade closes.", opts);
    var pfT = a.profitFactor === null ? "" : a.profitFactor > 1 ? "up" : a.profitFactor < 1 ? "down" : "";
    var st = a.streak || { kind: null, len: 0 };
    var hero = [
      tile("Total result", money(a.netProfit, true), tone(a.netProfit),
        a.netPct !== null ? pct(a.netPct, true) + " of start" : "practice money", tone(a.netPct),
        "Everything the closed trades made, minus everything they lost. Practice money.", true),
      tile("Closed trades", intf(a.n), "",
        plural(a.wins, "win", "wins") + DOT + plural(a.losses, "loss", "losses") + (a.breakeven ? DOT + a.breakeven + " even" : ""), "",
        "How many trades have been opened and closed. A trade that is still open is not counted.", true),
      tile("Win rate", pct(a.winRate), "", intf(a.wins) + " of " + intf(a.n) + " made money", "",
        "The share of closed trades that made money.", true),
      tile("$ won per $1 lost", ratio(a.profitFactor), pfT,
        a.profitFactor === Infinity ? "no losing trades yet" : a.profitFactor === null ? "no wins or losses yet" :
          money(a.profitFactor, false) + " won per $1 lost", "",
        "Dollars won for every dollar lost. Above 1 means the bot makes more than it loses.", true),
      tile("Biggest drop", a.maxDrawdown > 0 ? money(-a.maxDrawdown) : "$0.00", a.maxDrawdown > 0 ? "down" : "",
        a.maxDrawdownPct !== null ? pct(a.maxDrawdownPct) + " below its high" : "biggest fall from a high", "",
        "The biggest fall in the balance from a high point, measured from one closed trade to the next.", true),
      tile("Average per trade", money(a.expectancy, true), tone(a.expectancy),
        a.avgTradePct !== null ? pct(a.avgTradePct, true, 3) + " per trade" : "expectancy", tone(a.avgTradePct),
        "The average result per trade (expectancy): what one more trade has been worth so far.", true)
    ];
    var grid = [
      tile("All wins added up", money(a.grossProfit), a.grossProfit > 0 ? "up" : "", "from " + plural(a.wins, "win", "wins"), "",
        "All the winning trades added together."),
      tile("All losses added up", money(a.grossLoss), a.grossLoss < 0 ? "down" : "", "from " + plural(a.losses, "loss", "losses"), "",
        "All the losing trades added together."),
      tile("Average win", money(a.avgWin, true), a.avgWin !== null ? "up" : "", "per winning trade", "",
        "The average size of a winning trade."),
      tile("Average loss", money(a.avgLoss, true), a.avgLoss !== null ? "down" : "", "per losing trade", "",
        "The average size of a losing trade."),
      tile("Win size vs loss size", ratio(a.payoffRatio), "", "how big wins are next to losses", "",
        "Average win divided by average loss. Above 1 means the wins are bigger than the losses."),
      tile("Typical trade", money(a.median, true), tone(a.median), "the middle result", "",
        "Half the trades did better than this and half did worse. Less swayed by one big trade than the average."),
      tile("Largest win", money(a.largestWin, true), a.largestWin !== null ? "up" : "",
        a.largestWinShare !== null ? pct(a.largestWinShare, false, 1) + " of gross profit" : "", "",
        "The single best trade, and how much of all the profit came from it."),
      tile("Largest loss", money(a.largestLoss, true), a.largestLoss !== null ? "down" : "",
        a.largestLossShare !== null ? pct(a.largestLossShare, false, 1) + " of gross loss" : "", "",
        "The single worst trade, and how much of all the losses came from it."),
      tile("Wins in a row", intf(a.maxConsecWins), a.maxConsecWins ? "up" : "", "longest winning run", "",
        "The most winning trades one after another."),
      tile("Losses in a row", intf(a.maxConsecLosses), a.maxConsecLosses ? "down" : "", "longest losing run", "",
        "The most losing trades one after another."),
      tile("Current streak", st.len ? plural(st.len, st.kind === "win" ? "win" : st.kind === "loss" ? "loss" : "even",
        st.kind === "win" ? "wins" : st.kind === "loss" ? "losses" : "even") : DASH,
        st.kind === "win" ? "up" : st.kind === "loss" ? "down" : "", "latest trades", "",
        "How the most recent trades have gone, counted back from the latest one."),
      tile("Profit vs biggest drop", ratio(a.recoveryFactor), tone(a.recoveryFactor), "how well it earns back its drops", "",
        "Net profit divided by the biggest drawdown. Higher means the gains outweigh the worst dip."),
      tile("Steadiness score", ratio(a.sharpe), tone(a.sharpe), "higher = smoother results", "",
        "Average % return per trade divided by how much the returns swing. Higher means steadier gains. Worked out per trade, not per year."),
      tile("Steadiness on losses", ratio(a.sortino), tone(a.sortino), "higher = smoother results", "",
        "Like Sharpe, but only the swings of losing trades count as risk. Worked out per trade, not per year."),
      tile("Overall quality score", ratio(a.sqn), tone(a.sqn), a.n < 30 ? "needs 30+ trades to mean much" : "higher = more reliable", "",
        "System Quality Number: average trade divided by its spread, times the square root of the number of trades (up to 100)."),
      tile("Average time in a trade", dur(a.avgHoldMs), "",
        "wins " + dur(a.avgWinHoldMs) + DOT + "losses " + dur(a.avgLossHoldMs), "",
        "How long a trade stays open on average, from entry to exit."),
      tile("Time with a trade open", pct(a.exposurePct, false, 1), "", "share of time with a trade open", "",
        "From the first entry to the last exit, the share of time the bot had at least one trade open."),
      tile("Biggest climb", money(a.maxRunup, true), a.maxRunup > 0 ? "up" : "", "biggest climb from a low", "",
        "The biggest rise in the balance from a low point, trade to trade."),
      tile("Longest time below its best", dur(a.maxDrawdownDurationMs), "", a.inDrawdown ? "still below its high" : "time below a previous high", "",
        "The longest stretch the balance spent below an earlier high before getting back to it."),
      tile("Balance now", money(a.endBalance), a.endBalance !== null ? tone(a.endBalance - a.start) : "",
        a.start !== null ? "started at " + money(a.start) : "no starting balance given", "",
        "The starting balance plus the net result of all closed trades. Practice money.")
    ];
    return '<div class="pf-sum"><div class="pf-hero">' + hero.join("") + '</div><div class="pf-grid">' + grid.join("") +
      '</div><p class="pf-note">Practice money. ' + esc(a.note || NOTE) + "</p></div>";
  }

  /** monthlyHTML(a[, opts]) -> calendar heatmap: a row per year (newest first), Jan..Dec and the year's total. */
  function monthlyHTML(a, opts) {
    a = ensure(a);
    if (!a.n) return empty("Each month's result will fill in this calendar.", opts);
    var months = a.monthly || [], years = a.yearly || [];
    if (!months.length) return '<div class="pf-empty" role="status">These trades have no closing dates, so they cannot be put on a calendar yet.</div>';
    var usePct = months.every(function (m) { return m.pct !== null; });
    function val(e) { return usePct ? e.pct : e.net; }
    function show(e) { return usePct ? pct(e.pct, true, 1) : compact(e.net, true); }
    function tip(label, e) {
      return label + ": " + money(e.net, true) + (e.pct !== null ? " (" + pct(e.pct, true) + ")" : "") + ", " +
        plural(e.n, "trade", "trades") + ", " + intf(e.wins) + " won";
    }
    var mMax = 0, yMax = 0, byKey = {}, byYear = {};
    months.forEach(function (m) { byKey[m.y * 100 + m.m] = m; mMax = Math.max(mMax, Math.abs(val(m))); });
    years.forEach(function (y) { byYear[y.y] = y; yMax = Math.max(yMax, Math.abs(val(y))); });
    var y0 = months[0].y, y1 = months[months.length - 1].y, rows = [];
    for (var y = y1; y >= y0 && rows.length < 50; y--) {
      var cells = "";
      for (var m = 1; m <= 12; m++) {
        var e = byKey[y * 100 + m];
        cells += e ? '<td class="' + heat(val(e), mMax) + '" title="' + esc(tip(MONTHS_LONG[m - 1] + " " + y, e)) + '">' + esc(show(e)) + "</td>"
          : '<td class="pf-h0"></td>';
      }
      var yt = byYear[y];
      cells += yt ? '<td class="pf-yt ' + heat(val(yt), yMax) + '" title="' + esc(tip("All of " + y, yt)) + '">' + esc(show(yt)) + "</td>"
        : '<td class="pf-yt pf-h0"></td>';
      rows.push('<tr><th scope="row">' + y + "</th>" + cells + "</tr>");
    }
    return '<div class="pf-cal-wrap"><div class="pf-scroll"><table class="pf-cal"><caption class="pf-vh">Result by month' +
      (usePct ? " as a % of the balance at the start of each month" : " in dollars") + '</caption><thead><tr><th scope="col">Year</th>' +
      MONTHS.map(function (x) { return '<th scope="col">' + x + "</th>"; }).join("") + '<th scope="col">Total</th></tr></thead><tbody>' +
      rows.join("") + '</tbody></table></div><p class="pf-note">' +
      esc((usePct ? "% change on the balance at the start of each month" : "Dollar result per month") +
        ", by the day each trade closed (" + (a.tzLabel || "UTC") + "). Hover a month for details. Practice money.") + "</p></div>";
  }

  /** histogramSVG(a, width, height) -> an SVG bar chart of trade results (or the empty-state HTML when n = 0).
   *  Pass the container's pixel width so text stays at its real size. */
  function histogramSVG(a, width, height) {
    a = ensure(a);
    if (!a.n || !a.histogram || !a.histogram.counts.length) return empty("The spread of wins and losses will show here.");
    var W = clampInt(width, 240, 2400, 640), H = clampInt(height, 140, 1200, 220), h = a.histogram, k = h.counts.length;
    var padL = 34, padR = 12, padT = 24, padB = 24, pw = W - padL - padR, ph = H - padT - padB;
    var maxC = 0, mode = 0, i;
    for (i = 0; i < k; i++) if (h.counts[i] > maxC) { maxC = h.counts[i]; mode = i; }
    var ys = Math.max(1, Math.round(niceStep(maxC / 4))), top = Math.max(1, Math.ceil(maxC / ys) * ys), span = h.hi - h.lo;
    function X(v) { return padL + (v - h.lo) / span * pw; }
    function Y(c) { return padT + ph - c / top * ph; }
    function f(v) { return (Math.round(v * 10) / 10).toString(); }
    var bw = pw / k, gap = bw > 12 ? 2 : 1;
    var label = "Spread of " + plural(a.n, "trade result", "trade results") + ": " + plural(a.wins, "win", "wins") + ", " +
      plural(a.losses, "loss", "losses") + ". Most trades landed between " + compact(h.edges[mode]) + " and " + compact(h.edges[mode + 1]) + ".";
    var o = ['<svg class="pf-hsvg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W +
      '" height="' + H + '" role="img" aria-label="' + esc(label) + '" font-family="JetBrains Mono, ui-monospace, monospace" font-size="10.5">',
      "<title>" + esc(label) + "</title>"];
    for (var c = 0; c <= top; c += ys) {
      var gy = f(Y(c));
      o.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy + '" stroke="' + PAL.line + '"' +
        (c ? ' stroke-dasharray="2 3"' : "") + "/>");
      o.push('<text class="pf-ax-t" x="' + (padL - 6) + '" y="' + f(Y(c) + 3.5) + '" text-anchor="end" fill="' + PAL.mute + '">' + c + "</text>");
    }
    for (i = 0; i < k; i++) {
      var cnt = h.counts[i];
      if (!cnt) continue;
      var lo = h.edges[i], hi = h.edges[i + 1], x0 = X(lo) + gap / 2, w = Math.max(1, bw - gap), yy = Y(cnt);
      var fill = hi <= 0 ? PAL.down : lo >= 0 ? PAL.up : PAL.mute;
      o.push('<rect x="' + f(x0) + '" y="' + f(yy) + '" width="' + f(w) + '" height="' + f(padT + ph - yy) + '" rx="2" fill="' + fill +
        '" fill-opacity="0.9"><title>' + esc(compact(lo) + " to " + compact(hi) + ": " + plural(cnt, "trade", "trades")) + "</title></rect>");
      if (bw >= 16) o.push('<text x="' + f(x0 + w / 2) + '" y="' + f(yy - 4) + '" text-anchor="middle" fill="' + PAL.ink2 + '">' + cnt + "</text>");
    }
    if (h.lo < 0 && h.hi > 0) {
      var zx = f(X(0));
      o.push('<line x1="' + zx + '" x2="' + zx + '" y1="' + (padT - 6) + '" y2="' + (padT + ph) + '" stroke="' + PAL.ink2 + '" stroke-opacity="0.7"/>');
    }
    if (num(a.expectancy) !== null && a.expectancy >= h.lo && a.expectancy <= h.hi) {
      var mx = X(a.expectancy), right = mx > W - 90;
      o.push('<line x1="' + f(mx) + '" x2="' + f(mx) + '" y1="' + (padT - 6) + '" y2="' + (padT + ph) + '" stroke="' + PAL.amber +
        '" stroke-dasharray="4 3" stroke-width="1.5"/>');
      o.push('<text x="' + f(mx + (right ? -5 : 5)) + '" y="' + (padT + 6) + '" text-anchor="' + (right ? "end" : "start") + '" fill="' + PAL.amber +
        '" stroke="' + PAL.bg + '" stroke-width="3" paint-order="stroke">' + esc("avg " + compact(a.expectancy, true)) + "</text>");
    }
    var every = Math.max(1, Math.ceil(52 / bw)), zi = 0;
    for (i = 0; i < h.edges.length; i++) if (h.edges[i] === 0) zi = i;
    for (i = 0; i < h.edges.length; i++) {
      if ((i - zi) % every !== 0) continue;
      o.push('<text class="pf-ax-t" x="' + f(X(h.edges[i])) + '" y="' + (H - 7) + '" text-anchor="middle" fill="' + PAL.mute + '">' +
        esc(compact(h.edges[i])) + "</text>");
    }
    o.push('<text class="pf-ax-t" x="2" y="11" fill="' + PAL.mute + '">trades</text>');
    o.push('<text class="pf-ax-t" x="' + (W - padR) + '" y="11" text-anchor="end" fill="' + PAL.mute + '">result per trade</text>');
    o.push("</svg>");
    return '<div class="pf-hist">' + o.join("") + "</div>";
  }

  function bar(frac, cls) {
    var w = num(frac) === null ? 0 : Math.max(0, Math.min(1, frac));
    var pc = w > 0 ? Math.max(1.5, Math.round(w * 1000) / 10) : 0;
    return '<i class="pf-bar" aria-hidden="true"><i class="' + cls + '" style="width:' + pc + '%"></i></i>';
  }
  function lsRow(k, v, t, barHtml) {
    return '<div class="pf-row"><span>' + esc(k) + '</span><b class="' + (t ? "pf-" + t : "") + '">' + esc(v) + "</b>" + (barHtml || "") + "</div>";
  }

  /** longShortHTML(a[, opts]) -> long (buy) vs short (sell) side by side, with bars. */
  function longShortHTML(a, opts) {
    a = ensure(a);
    if (!a.n) return empty("Buy (long) and sell (short) trades will be compared here.", opts);
    var L = a.long, S = a.short, maxNet = Math.max(Math.abs(L.net || 0), Math.abs(S.net || 0)), total = L.n + S.n;
    function col(name, word, cls, s) {
      var head = '<div class="pf-lsh"><span class="pf-side pf-' + cls + '">' + name + "</span><b class=\"" +
        (s.n ? "pf-" + (tone(s.net) || "flat") : "pf-flat") + '">' + esc(s.n ? money(s.net, true) : DASH) + "</b></div>";
      if (!s.n) return '<div class="pf-lsc">' + head + '<p class="pf-lsn">No ' + word + " trades yet.</p></div>";
      return '<div class="pf-lsc">' + head +
        lsRow("Trades", intf(s.n) + (total ? " (" + pct(s.n / total, false, 0) + ")" : ""), "", bar(total ? s.n / total : 0, "pf-bb")) +
        lsRow("Win rate", pct(s.winRate, false, 1), "", bar(s.winRate, "pf-bb")) +
        lsRow("Net result", money(s.net, true), tone(s.net), bar(maxNet ? Math.abs(s.net) / maxNet : 0, s.net < 0 ? "pf-bd" : "pf-bu")) +
        lsRow("Avg trade", money(s.avgTrade, true), tone(s.avgTrade)) +
        lsRow("Profit factor", ratio(s.profitFactor), s.profitFactor === null ? "" : s.profitFactor > 1 ? "up" : s.profitFactor < 1 ? "down" : "") +
        lsRow("Largest win", money(s.largestWin, true), s.largestWin !== null ? "up" : "") +
        lsRow("Largest loss", money(s.largestLoss, true), s.largestLoss !== null ? "down" : "") +
        lsRow("Avg time in trade", dur(s.avgHoldMs), "") + "</div>";
    }
    var verdict;
    if (L.n && S.n) {
      verdict = "Buying (long) trades made " + money(L.net, true) + " and selling (short) trades made " + money(S.net, true) + ". " +
        (L.net === S.net ? "Both sides have done the same so far." : (L.net > S.net ? "Longs" : "Shorts") + " have done better so far.");
    } else if (L.n || S.n) verdict = "Only " + (L.n ? "buying (long)" : "selling (short)") + " trades so far.";
    else verdict = "None of the trades say whether they were long or short.";
    if (a.otherSide) verdict += " " + plural(a.otherSide, "trade does", "trades do") + " not say its side, so " +
      (a.otherSide === 1 ? "it is" : "they are") + " left out of both columns.";
    return '<div class="pf-lswrap"><div class="pf-ls">' + col("LONG", "long (buy)", "long", L) + col("SHORT", "short (sell)", "short", S) +
      '</div><p class="pf-verdict">' + esc(verdict) + "</p></div>";
  }

  /** hoursHTML(a[, opts]) -> heat strips: which hours of the day and days of the week make or lose money. */
  function hoursHTML(a, opts) {
    a = ensure(a);
    if (!a.n) return empty("The hours and days that make or lose money will show here.", opts);
    var hours = a.byHour || [], days = a.byWeekday || [];
    if (!hours.some(function (x) { return x.n; })) return '<div class="pf-empty" role="status">These trades have no times, so they cannot be placed by hour yet.</div>';
    function mx(list) { return list.reduce(function (m, x) { return x.n ? Math.max(m, Math.abs(x.net)) : m; }, 0); }
    function cell(x, max) { return x.n ? heat(x.net, max) : "pf-h0"; }
    function info(label, x) {
      return label + ": " + (x.n ? plural(x.n, "trade", "trades") + ", " + intf(x.wins) + " won, " + money(x.net, true) : "no trades");
    }
    var hm = mx(hours), dm = mx(days), strip = "", axis = "", week = "";
    hours.forEach(function (x, h) {
      var lab = pad2(h) + ":00" + NDASH + pad2((h + 1) % 24) + ":00";
      strip += '<span class="pf-hc ' + cell(x, hm) + '" role="img" aria-label="' + esc(info(lab, x)) + '" title="' + esc(info(lab, x)) + '"></span>';
      axis += "<span>" + (h % 3 === 0 ? pad2(h) : "") + "</span>";
    });
    WEEK_ORDER.forEach(function (d) {
      var x = days[d] || { n: 0, wins: 0, net: 0 };
      week += '<span class="pf-hc ' + cell(x, dm) + '" title="' + esc(info(DAYS_LONG[d], x)) + '"><b>' + DAYS[d] + "</b><small>" +
        esc(x.n ? compact(x.net, true) : DASH) + '</small><em class="pf-vh">' + esc(info(DAYS_LONG[d], x)) + "</em></span>";
    });
    function extreme(list, names, best) {
      var pick = -1;
      list.forEach(function (x, i) {
        if (!x.n || (best ? x.net <= 0 : x.net >= 0)) return;
        if (pick < 0 || (best ? x.net > list[pick].net : x.net < list[pick].net)) pick = i;
      });
      return pick < 0 ? null : names(pick) + " " + money(list[pick].net, true);
    }
    var hn = function (i) { return pad2(i) + ":00"; }, dn = function (i) { return DAYS_LONG[i]; };
    var facts = [["Best hour", extreme(hours, hn, true), "up"], ["Worst hour", extreme(hours, hn, false), "down"],
      ["Best day", extreme(days, dn, true), "up"], ["Worst day", extreme(days, dn, false), "down"]]
      .filter(function (f) { return f[1]; })
      .map(function (f) { return "<span>" + esc(f[0]) + ' <b class="pf-' + f[2] + '">' + esc(f[1]) + "</b></span>"; }).join("");
    return '<div class="pf-hours">' +
      '<div class="pf-hh"><span>By hour the trade opened</span><span>' + esc(a.tzLabel || "UTC") + "</span></div>" +
      '<div class="pf-strip pf-s24">' + strip + '</div><div class="pf-ax pf-s24" aria-hidden="true">' + axis + "</div>" +
      '<div class="pf-hh"><span>By day of the week</span></div><div class="pf-strip pf-s7">' + week + "</div>" +
      (facts ? '<div class="pf-facts">' + facts + "</div>" : "") +
      '<div class="pf-key" aria-hidden="true"><span><i class="pf-hp4"></i>Made money</span><span><i class="pf-hn4"></i>Lost money</span>' +
      "<span><i class=\"pf-h0\"></i>No trades</span><span>Darker = bigger</span></div></div>";
  }

  /** tradesTableHTML(trades[, opts]) -> "List of trades" table, newest first, ready for sorting.
   *  opts: dp (price decimals, default 2), tz (seconds, default visitor's clock), now (ms, decides when to show years),
   *  empty (custom empty-state text). */
  function tradesTableHTML(trades, opts) {
    opts = opts || {};
    var list = normalize(trades, null);
    if (!list.length) return empty("Every closed trade will be listed here, newest first.", opts);
    var dp = clampInt(opts.dp, 0, 8, 2), tz = tzOf(opts.tz), now = num(opts.now) !== null ? opts.now : Date.now();
    var thisYear = parts(now, tz).y, years = {};
    list.forEach(function (x) {
      if (x.opened !== null) years[parts(x.opened, tz).y] = 1;
      if (x.closed !== null) years[parts(x.closed, tz).y] = 1;
    });
    var ys = Object.keys(years), withYear = ys.length > 1 || (ys.length === 1 && +ys[0] !== thisYear);
    var cols = [["#", "num", "Trade number, counted from the first trade"], ["Side", "text", "Long = bought first, short = sold first"],
      ["Opened", "num", "When the trade was opened (" + tzLabel(tz) + ")"], ["Closed", "num", "When the trade was closed (" + tzLabel(tz) + ")"],
      ["Hold", "num", "How long the trade was open"], ["Entry", "num", "Price the trade was opened at"],
      ["Exit", "num", "Price the trade was closed at"], ["Size", "num", "How much gold (or coin) the trade held"],
      ["Result $", "num", "Money made or lost on the trade (practice money)"],
      ["Result %", "num", "Result as a share of the trade's size (entry price \u00d7 size)"],
      ["Cum. $", "num", "Running total of all results up to this trade"]];
    var head = cols.map(function (c, i) {
      return '<th scope="col" data-sort="' + c[1] + '" aria-sort="none"' + (c[1] === "num" && i > 1 && i !== 2 && i !== 3 ? ' class="pf-n"' : "") +
        ' title="' + esc(c[2]) + '"><button type="button" class="pf-sort">' + esc(c[0]) + "</button></th>";
    }).join("");
    function td(v, text, cls) {
      return '<td' + (cls ? ' class="' + cls + '"' : "") + ' data-v="' + esc(v === null ? "" : v) + '">' + text + "</td>";
    }
    var rows = list.slice().reverse().map(function (x) {
      var side = x.side === "other" ? '<span class="pf-side pf-other">' + esc(x.sideRaw.slice(0, 16) || "?") + "</span>"
        : '<span class="pf-side pf-' + x.side + '">' + (x.side === "long" ? "LONG" : "SHORT") + "</span>";
      var rt = tone(x.r);
      return '<tr class="' + (x.r > 0 ? "pf-win" : x.r < 0 ? "pf-loss" : "pf-even") + '">' +
        td(x.n, String(x.n), "pf-idx") +
        td(x.side === "other" ? x.sideRaw.slice(0, 16).toLowerCase() : x.side, side, "") +
        td(x.opened, esc(when(x.opened, tz, withYear)), "") +
        td(x.closed, esc(when(x.closed, tz, withYear)), "") +
        td(x.hold, esc(dur(x.hold)), "pf-n") +
        td(x.entry, esc(price(x.entry, dp)), "pf-n") +
        td(x.exit, esc(price(x.exit, dp)), "pf-n") +
        td(x.qty, esc(qtyf(x.qty)), "pf-n") +
        td(x.r, esc(money(x.r, true)), "pf-n" + tcls(rt)) +
        td(x.posRet, esc(pct(x.posRet, true)), "pf-n" + tcls(tone(x.posRet))) +
        td(x.cum, esc(money(x.cum, true)), "pf-n" + tcls(tone(x.cum))) + "</tr>";
    }).join("");
    return '<div class="pf-scroll pf-tscroll"><table class="pf-tt"><caption class="pf-vh">Closed trades, newest first. ' +
      "Practice money.</caption><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  /* ================================================================ CSV ==================================== */

  /* A text cell that a spreadsheet will not run as a formula, quoted when needed (RFC 4180). */
  function csvText(s) {
    s = String(s == null ? "" : s);
    if (/^[\s]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvNum(v, dp) {
    if (num(v) === null) return "";
    return dp == null ? String(sig(v)) : String(sig(+v.toFixed(dp)));
  }
  function iso(ms) { return num(ms) === null ? "" : new Date(ms).toISOString(); }

  /** csv(trades) -> CSV text (header + one row per closed trade, oldest first, times in UTC). */
  function csv(trades) {
    var list = normalize(trades, null);
    var out = [["Trade #", "Side", "Opened (UTC)", "Closed (UTC)", "Hold (minutes)", "Entry", "Exit", "Size",
      "Result (USD, practice)", "Result %", "Cumulative (USD)"].map(csvText).join(",")];
    list.forEach(function (x) {
      out.push([
        String(x.n), csvText(x.side === "other" ? x.sideRaw : x.side), csvText(iso(x.opened)), csvText(iso(x.closed)),
        x.hold === null ? "" : csvNum(x.hold / MIN, 1), csvNum(x.entry), csvNum(x.exit), csvNum(x.qty),
        csvNum(x.r, 8), x.posRet === null ? "" : csvNum(x.posRet * 100, 4), csvNum(x.cum, 8)
      ].join(","));
    });
    return out.join("\r\n") + "\r\n";
  }

  /* ================================================================ small page helpers (browser only) ====== */

  /** injectCSS([doc]) -> adds SDLPerf.CSS to the page once. */
  function injectCSS(doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc || doc.getElementById("sdl-perf-css")) return;
    var s = doc.createElement("style");
    s.id = "sdl-perf-css";
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  /** bindSort(root) -> makes every pf-tt table inside root sortable by clicking its headers. Returns unbind(). */
  function bindSort(root) {
    if (!root || !root.addEventListener) return function () {};
    function onClick(e) {
      var btn = e.target && e.target.closest ? e.target.closest(".pf-sort") : null;
      if (!btn || (root.contains && !root.contains(btn))) return;
      var th = btn.closest("th"), table = th && th.closest("table");
      if (!table || !table.tBodies || !table.tBodies[0]) return;
      var ths = th.parentNode.children, idx = Array.prototype.indexOf.call(ths, th);
      var type = th.getAttribute("data-sort") === "num" ? "num" : "text", cur = th.getAttribute("aria-sort");
      var dir = cur === "descending" ? "ascending" : cur === "ascending" ? "descending" : type === "num" ? "descending" : "ascending";
      Array.prototype.forEach.call(ths, function (h) { if (h.hasAttribute("data-sort")) h.setAttribute("aria-sort", "none"); });
      th.setAttribute("aria-sort", dir);
      var body = table.tBodies[0], m = dir === "ascending" ? 1 : -1;
      Array.prototype.map.call(body.rows, function (r, i) {
        var c = r.cells[idx], raw = c ? c.getAttribute("data-v") : "";
        return { r: r, i: i, v: type === "num" ? (raw === "" || raw == null ? NaN : parseFloat(raw)) : String(raw || "").toLowerCase() };
      }).sort(function (p, q) {
        if (type === "num") {
          var pn = isNaN(p.v), qn = isNaN(q.v);
          if (pn || qn) return pn && qn ? p.i - q.i : pn ? 1 : -1;   // blanks always last
          return p.v !== q.v ? (p.v - q.v) * m : p.i - q.i;
        }
        return p.v < q.v ? -m : p.v > q.v ? m : p.i - q.i;
      }).forEach(function (o) { body.appendChild(o.r); });
    }
    root.addEventListener("click", onClick);
    return function () { root.removeEventListener("click", onClick); };
  }

  /** downloadCSV(trades, filename) -> saves the trades as a .csv file in the visitor's browser. Returns the file name. */
  function downloadCSV(trades, filename) {
    var name = String(filename || "trades").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "trades";
    if (!/\.csv$/i.test(name)) name += ".csv";
    var blob = new Blob([csv(trades)], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; link.rel = "noopener"; link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return name;
  }

  /* ================================================================ styles ================================= */

  var V = {
    bg: "var(--tv-bg," + PAL.bg + ")", panel: "var(--tv-panel," + PAL.panel + ")", line: "var(--tv-line," + PAL.line + ")",
    ink: "var(--tv-ink," + PAL.ink + ")", ink2: "var(--tv-ink2," + PAL.ink2 + ")", mute: "var(--tv-mute," + PAL.mute + ")",
    up: "var(--tv-up," + PAL.up + ")", down: "var(--tv-down," + PAL.down + ")", amber: "var(--tv-amber," + PAL.amber + ")",
    blue: "var(--tv-blue," + PAL.blue + ")",
    mono: "var(--mono,'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace)",
    sans: "var(--sans,Inter,'Segoe UI',system-ui,sans-serif)"
  };
  var LABEL = "font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:" + V.mute + ";font-weight:700";
  var heatCss = PAL.heat.map(function (al, i) {
    var lv = i + 1, ink = lv >= PAL.heatWhite ? PAL.white : V.ink;
    return ".pf-hp" + lv + "{background:rgba(" + PAL.upRGB + "," + al + ");color:" + ink + "}" +
      ".pf-hn" + lv + "{background:rgba(" + PAL.downRGB + "," + al + ");color:" + ink + "}";
  }).join("");

  var CSS = [
    /* shared */
    ".pf-up{color:" + V.up + "}.pf-down{color:" + V.down + "}.pf-flat{color:" + V.ink + "}",
    ".pf-vh{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}",
    ".pf-empty{margin-top:10px;padding:18px;border-radius:10px;border:1px dashed " + V.line + ";color:" + V.ink2 + ";font-size:.88rem;line-height:1.5}",
    ".pf-empty b{color:" + V.amber + "}",
    ".pf-note{margin:10px 0 0;font-size:.74rem;line-height:1.5;color:" + V.mute + "}",
    ".pf-scroll{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}",
    ".pf-scroll:focus-visible{outline:2px solid " + V.blue + ";outline-offset:2px}",
    /* performance summary */
    ".pf-sum{margin-top:10px;min-width:0}",
    ".pf-hero,.pf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}",
    ".pf-grid{margin-top:8px;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}",
    ".pf-m{min-width:0;background:" + V.panel + ";border:1px solid " + V.line + ";border-radius:9px;padding:10px 12px;cursor:help}",
    ".pf-big{padding:12px 14px}",
    ".pf-k{display:block;" + LABEL + "}",
    ".pf-v{display:block;font-family:" + V.mono + ";font-variant-numeric:tabular-nums;font-size:.98rem;font-weight:600;color:#fff;margin-top:4px;line-height:1.25;overflow-wrap:anywhere}",
    ".pf-v.pf-up{color:" + V.up + "}.pf-v.pf-down{color:" + V.down + "}",
    ".pf-big .pf-v{font-size:1.28rem}",
    ".pf-s{display:block;font-size:.72rem;line-height:1.35;color:" + V.mute + ";margin-top:3px}",
    "@media (max-width:420px){.pf-hero,.pf-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}" +
      ".pf-m,.pf-big{padding:9px 10px}.pf-big .pf-v{font-size:1.02rem}.pf-v{font-size:.9rem}}",
    /* monthly calendar */
    "table.pf-cal{width:100%;min-width:660px;border-collapse:separate;border-spacing:3px;font-family:" + V.mono + ";font-variant-numeric:tabular-nums;font-size:.74rem}",
    ".pf-cal th{" + LABEL + ";font-size:.6rem;letter-spacing:.08em;padding:4px 2px;text-align:center;font-family:" + V.sans + "}",
    ".pf-cal th[scope=row]{position:sticky;left:0;z-index:1;background:" + V.bg + ";color:" + V.ink + ";font-family:" + V.mono + ";font-size:.74rem;letter-spacing:0;padding:0 8px 0 2px;text-align:left}",
    ".pf-cal td{height:34px;padding:0 3px;text-align:center;border-radius:5px;white-space:nowrap;color:" + V.ink + "}",
    ".pf-cal td.pf-yt{font-weight:700;border-left:2px solid " + V.bg + "}",
    ".pf-cal td[title]{cursor:help}",
    ".pf-h0{background:rgba(" + PAL.emptyRGB + ",.35);color:" + V.mute + "}",
    ".pf-hz{background:rgba(" + PAL.zeroRGB + ",.18);color:" + V.ink + "}",
    heatCss,
    /* histogram */
    ".pf-hist{margin-top:10px;min-width:0}",
    ".pf-hist svg{display:block;max-width:100%;height:auto;overflow:visible}",
    ".pf-hist .pf-ax-t{fill:" + V.mute + "}",
    /* long vs short */
    ".pf-ls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}",
    "@media (max-width:560px){.pf-ls{grid-template-columns:minmax(0,1fr)}}",
    ".pf-lsc{min-width:0;background:" + V.panel + ";border:1px solid " + V.line + ";border-radius:10px;padding:12px 14px}",
    ".pf-lsh{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:10px;border-bottom:1px solid " + V.line + "}",
    ".pf-lsh b{font-family:" + V.mono + ";font-variant-numeric:tabular-nums;font-size:1.1rem;font-weight:600}",
    ".pf-lsn{margin:12px 0 2px;font-size:.85rem;color:" + V.ink2 + "}",
    ".pf-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:4px 10px;margin-top:9px;font-size:.8rem}",
    ".pf-row span{color:" + V.ink2 + "}",
    ".pf-row b{font-family:" + V.mono + ";font-variant-numeric:tabular-nums;font-weight:600;color:" + V.ink + ";text-align:right;white-space:nowrap}",
    ".pf-row b.pf-up{color:" + V.up + "}.pf-row b.pf-down{color:" + V.down + "}",
    ".pf-bar{grid-column:1/-1;display:block;height:6px;border-radius:3px;background:rgba(" + PAL.emptyRGB + ",.9);overflow:hidden}",
    ".pf-bar i{display:block;height:100%;border-radius:3px;background:" + V.blue + "}",
    ".pf-bar i.pf-bu{background:" + V.up + "}.pf-bar i.pf-bd{background:" + V.down + "}",
    ".pf-verdict{margin:10px 0 0;font-size:.85rem;line-height:1.5;color:" + V.ink2 + "}",
    ".pf-side{display:inline-block;padding:2px 8px;border-radius:5px;font-family:" + V.mono + ";font-size:.72rem;font-weight:700;letter-spacing:.04em;white-space:nowrap}",
    ".pf-side.pf-long{background:rgba(" + PAL.upRGB + "," + PAL.pillAlpha + ");color:" + PAL.longInk + "}",
    ".pf-side.pf-short{background:rgba(" + PAL.downRGB + "," + PAL.pillAlpha + ");color:" + PAL.shortInk + "}",
    ".pf-side.pf-other{background:rgba(" + PAL.zeroRGB + ",.16);color:" + V.ink + "}",
    /* hours and weekdays */
    ".pf-hours{margin-top:10px;min-width:0}",
    ".pf-hh{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:16px;" + LABEL + "}",
    ".pf-hours>.pf-hh:first-child{margin-top:0}",
    ".pf-strip{display:grid;gap:2px;margin-top:7px}",
    ".pf-s24{grid-template-columns:repeat(24,minmax(0,1fr))}",
    ".pf-s7{grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}",
    ".pf-hc{display:block;min-width:0;height:30px;border-radius:3px;cursor:help}",
    ".pf-s7 .pf-hc{height:auto;min-height:50px;padding:7px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:6px;text-align:center}",
    ".pf-s7 .pf-hc b{font-size:.72rem;font-weight:700}",
    ".pf-s7 .pf-hc small{font-family:" + V.mono + ";font-variant-numeric:tabular-nums;font-size:.66rem;white-space:nowrap}",
    ".pf-ax{display:grid;gap:2px;margin-top:4px;font-family:" + V.mono + ";font-size:.6rem;color:" + V.mute + "}",
    ".pf-ax span{white-space:nowrap;overflow:visible}",
    ".pf-facts{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:14px;font-size:.8rem;color:" + V.ink2 + "}",
    ".pf-facts b{font-family:" + V.mono + ";font-weight:600;white-space:nowrap}",
    ".pf-key{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:.72rem;color:" + V.mute + "}",
    ".pf-key i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}",
    "@media (max-width:420px){.pf-s24{gap:1px}.pf-hc{height:26px}.pf-s7{gap:3px}.pf-s7 .pf-hc small{font-size:.58rem}}",
    /* list of trades */
    ".pf-tscroll{margin-top:10px;max-height:560px;overflow:auto}",
    "table.pf-tt{width:100%;min-width:900px;border-collapse:collapse;font-size:.8rem}",
    ".pf-tt caption{caption-side:top}",
    ".pf-tt th{position:sticky;top:0;z-index:1;background:" + V.bg + ";padding:0;border-bottom:1px solid " + V.line + ";text-align:left;white-space:nowrap;" + LABEL + ";font-size:.62rem;letter-spacing:.08em}",
    ".pf-tt th.pf-n{text-align:right}",
    ".pf-sort{display:block;width:100%;padding:9px 10px;border:0;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;text-align:inherit;cursor:pointer}",
    ".pf-sort:hover{color:" + V.ink + "}",
    ".pf-sort:focus-visible{outline:2px solid " + V.blue + ";outline-offset:-2px}",
    ".pf-tt th[aria-sort=ascending] .pf-sort::after{content:\" \\25B2\";color:" + V.amber + "}",
    ".pf-tt th[aria-sort=descending] .pf-sort::after{content:\" \\25BC\";color:" + V.amber + "}",
    ".pf-tt td{padding:9px 10px;border-bottom:1px solid rgba(" + PAL.emptyRGB + ",.6);font-family:" + V.mono + ";font-variant-numeric:tabular-nums;color:" + V.ink + ";white-space:nowrap}",
    ".pf-tt td.pf-n{text-align:right}.pf-tt td.pf-up{color:" + V.up + "}.pf-tt td.pf-down{color:" + V.down + "}",
    ".pf-tt td.pf-idx{color:" + V.mute + "}",
    ".pf-tt tr.pf-win td:first-child{box-shadow:inset 2px 0 0 " + V.up + "}",
    ".pf-tt tr.pf-loss td:first-child{box-shadow:inset 2px 0 0 " + V.down + "}",
    ".pf-tt tbody tr:hover td{background:rgba(" + PAL.emptyRGB + ",.35)}",
    ".pf-tt tbody tr:last-child td{border-bottom:0}",
    /* print */
    "@media print{.pf-m,.pf-lsc{background:#fff!important;border-color:#bbb!important}.pf-v,.pf-lsh b,.pf-tt td{color:#000!important}" +
      ".pf-tscroll{max-height:none;overflow:visible}.pf-tt th{position:static}}"
  ].join("\n");

  var api = {
    version: "1.0.0",
    analyze: analyze, lwcSeries: lwcSeries, histogram: histogram,
    summaryHTML: summaryHTML, monthlyHTML: monthlyHTML, histogramSVG: histogramSVG, longShortHTML: longShortHTML,
    hoursHTML: hoursHTML, tradesTableHTML: tradesTableHTML, csv: csv,
    injectCSS: injectCSS, bindSort: bindSort, downloadCSV: downloadCSV,
    fmt: { esc: esc, money: money, pct: pct, ratio: ratio, int: intf, price: price, qty: qtyf, compact: compact, dur: dur,
      when: when, tzLabel: tzLabel },
    CSS: CSS, PALETTE: PAL, NOTE: NOTE
  };
  if (typeof window !== "undefined") window.SDLPerf = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
