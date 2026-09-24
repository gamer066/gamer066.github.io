/* Shared helpers for the "Special bot trades" pages (/special/ and /special/bot/).
 *
 * The bots' numbers come from /special/data/bots.json, which the trading session writes and pushes (practice money
 * only, numbers only). Live prices come straight from Binance's public futures feed in the visitor's browser, so the
 * chart moves in real time without the site doing any work. Everything read from the data file is treated as text to
 * be escaped, and symbols/ids are checked before they go into any address.
 */
(function () {
  var FAPI = "https://fapi.binance.com/fapi/v1/";
  var WS = "wss://fstream.binance.com/ws/";
  var FRAMES = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function okSymbol(s) { return typeof s === "string" && /^[A-Z0-9]{2,20}$/.test(s); }
  function okId(s) { return typeof s === "string" && /^[a-z0-9-]{1,40}$/.test(s); }
  function okFrame(f) { return typeof f === "string" && Object.prototype.hasOwnProperty.call(FRAMES, f); }

  /* ---- money and numbers ---- */
  function money(v, signed) {
    if (num(v) === null) return "—";
    var s = "$" + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!signed) return (v < 0 ? "−" : "") + s;
    return (v > 0 ? "+" : v < 0 ? "−" : "") + s;
  }
  function pct(v, signed) {
    if (num(v) === null) return "—";
    var s = Math.abs(v * 100).toFixed(2) + "%";
    return signed ? (v > 0 ? "+" : v < 0 ? "−" : "") + s : s;
  }
  function price(v, dp) {
    if (num(v) === null) return "—";
    dp = Math.max(0, Math.min(8, dp | 0));
    return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function tone(v) { return num(v) === null || v === 0 ? "" : v > 0 ? "up" : "down"; }
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "—";
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + (h === 1 ? " hour ago" : " hours ago");
    return Math.round(h / 24) + " days ago";
  }

  /* ---- the bots' file ---- */
  function load() {
    return fetch("/special/data/bots.json?t=" + Date.now(), { credentials: "same-origin", cache: "no-store" })
      .then(function (r) {
        if (r.status === 404) return { bots: [] };
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      })
      .then(function (d) {
        var bots = (d && Array.isArray(d.bots) ? d.bots : []).filter(function (b) {
          return b && okId(b.id) && okSymbol(b.symbol);
        });
        return { updated: d && d.updated, bots: bots };
      });
  }

  /* ---- what the trades add up to ---- */
  function stats(bot) {
    var trades = (Array.isArray(bot.trades) ? bot.trades : []).filter(function (t) { return t && num(t.result_usd) !== null; })
      .slice().sort(function (a, b) { return (Date.parse(a.closed) || 0) - (Date.parse(b.closed) || 0); });
    var start = num(bot.start_balance);
    var base = start === null ? 0 : start;
    var net = 0, wins = 0, best = null, worst = null, peak = base, dip = 0, dipPct = 0, curve = [];
    trades.forEach(function (t) {
      var r = t.result_usd;
      net += r;
      if (r > 0) wins++;
      if (best === null || r > best) best = r;
      if (worst === null || r < worst) worst = r;
      var bal = base + net;
      if (bal > peak) peak = bal;
      if (peak - bal > dip) { dip = peak - bal; dipPct = peak > 0 && start !== null ? dip / peak : null; }
      var at = Date.parse(t.closed);
      if (!isNaN(at)) curve.push({ at: at, bal: bal });
    });
    var n = trades.length;
    var balance = num(bot.balance) !== null ? bot.balance : start !== null ? start + net : null;
    return {
      trades: trades, n: n, net: n ? net : null, wins: wins, winRate: n ? wins / n : null,
      ret: n && start ? net / start : null, best: best, worst: worst,
      dip: n ? dip : null, dipPct: n ? dipPct : null, balance: balance, start: start, curve: curve
    };
  }

  /* ---- live prices from Binance's public futures feed ---- */
  function klines(symbol, frame, limit) {
    if (!okSymbol(symbol) || !okFrame(frame)) return Promise.reject(new Error("bad symbol or frame"));
    return fetch(FAPI + "klines?symbol=" + symbol + "&interval=" + frame + "&limit=" + (limit || 500))
      .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); });
  }
  function ticker(symbol) {
    if (!okSymbol(symbol)) return Promise.reject(new Error("bad symbol"));
    return fetch(FAPI + "ticker/24hr?symbol=" + symbol)
      .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); });
  }
  /* Streams one candle as it forms. Calls onCandle(kline) many times a second; falls back to asking every
     5 seconds if the stream cannot connect. Returns a stop() function. */
  function stream(symbol, frame, onCandle, onState) {
    var stopped = false, sock = null, poll = null, fails = 0;
    if (!okSymbol(symbol) || !okFrame(frame)) return function () {};
    function usePolling() {
      if (poll || stopped) return;
      onState && onState("delayed");
      poll = setInterval(function () {
        klines(symbol, frame, 2).then(function (rows) {
          rows.forEach(function (k) { onCandle({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }); });
        }).catch(function () {});
      }, 5000);
    }
    function open() {
      if (stopped) return;
      try { sock = new WebSocket(WS + symbol.toLowerCase() + "@kline_" + frame); }
      catch (e) { usePolling(); return; }
      sock.onopen = function () { fails = 0; onState && onState("live"); };
      sock.onmessage = function (ev) {
        if (stopped) return;
        try {
          var k = JSON.parse(ev.data).k;
          if (k) onCandle({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v });
        } catch (e) { /* ignore a garbled message */ }
      };
      sock.onclose = function () {
        if (stopped) return;
        fails++;
        if (fails >= 3) usePolling(); else setTimeout(open, 1500 * fails);
      };
    }
    open();
    return function stop() {
      stopped = true;
      if (sock) { try { sock.close(); } catch (e) {} }
      if (poll) clearInterval(poll);
    };
  }

  var STATUS = {
    "testing": ["Testing", "amber"],
    "live-practice": ["Live · practice", "green"],
    "paused": ["Paused", "grey"]
  };
  function statusPill(s) {
    var p = STATUS[s] || [s ? String(s) : "Unknown", "grey"];
    return '<span class="pill ' + p[1] + '"><i></i>' + esc(p[0]) + "</span>";
  }

  window.SDLSpecial = {
    FRAMES: FRAMES, esc: esc, num: num, okId: okId, okSymbol: okSymbol, okFrame: okFrame, money: money, pct: pct, price: price,
    tone: tone, when: when, ago: ago, load: load, stats: stats, klines: klines, ticker: ticker, stream: stream,
    statusPill: statusPill
  };
})();
