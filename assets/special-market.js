/* Live market side panels for the Special bots terminal (TradingView-style watchlist, symbol details,
 * order book and time & sales), all from Binance USD-M futures' public feeds - no keys, nothing stored.
 *
 *   SDLMarket.relatedFor(symbol)                       -> [{symbol, label, note}]
 *   SDLMarket.mountWatchlist(el, items, {active, onPick}) -> {stop, setActive, data}
 *   SDLMarket.mountDetails(el, symbol, {dp})          -> {stop, setSymbol}
 *   SDLMarket.mountBook(el, symbol, {dp, rows})       -> {stop, setSymbol}
 *   SDLMarket.mountTape(el, symbol, {dp, max})        -> {stop, setSymbol}
 *   SDLMarket.contextLines(symbol, tickers)           -> ["plain sentence", ...]  (tickers = watchlist data)
 *   SDLMarket.CSS                                     -> the styles for every "mk-" class
 *
 * Every panel pauses its network work while the tab is hidden, reconnects its live stream with a growing wait,
 * falls back to asking every few seconds if the stream will not connect, and never throws into the page.
 * Remote values are only ever parsed as numbers; text goes in with textContent or escaped.
 */
(function () {
  var FAPI = "https://fapi.binance.com/fapi/v1/";
  var WS = "wss://fstream.binance.com/ws/";
  var hasDoc = typeof document !== "undefined";

  /* Related markets that really exist on Binance USD-M futures (checked 24 Sep 2026). */
  var RELATED = {
    XAUUSDT: [
      ["XAUUSDT", "Gold", "The bot's own market"],
      ["XAGUSDT", "Silver", "Gold's closest cousin - they usually move together"],
      ["XPTUSDT", "Platinum", "Another precious metal"],
      ["GDXUSDT", "Gold miners (GDX)", "Mining shares - often lead or exaggerate gold's moves"],
      ["PAXGUSDT", "PAX Gold token", "A crypto token backed by real gold"],
      ["TBTUSDT", "US rates (TBT)", "Rises when long-term US interest rates rise - usually a headwind for gold"],
      ["SPYUSDT", "S&P 500 (SPY)", "US shares - shows the market's risk mood"],
      ["CLUSDT", "Crude oil (WTI)", "Oil - feeds inflation worries"],
      ["BTCUSDT", "Bitcoin", "Sometimes called digital gold"]
    ]
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function okSym(s) { return typeof s === "string" && /^[A-Z0-9]{2,20}$/.test(s); }
  function n(v) { var x = typeof v === "number" ? v : parseFloat(v); return isFinite(x) ? x : null; }
  function fmt(v, dp) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function compact(v) {
    if (v === null || !isFinite(v)) return "—";
    var a = Math.abs(v), units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    for (var i = 0; i < units.length; i++) if (a >= units[i][0]) return (v / units[i][0]).toFixed(2) + units[i][1];
    return v.toFixed(a < 10 ? 3 : 2);
  }
  function pctText(v) {
    if (v === null || !isFinite(v)) return "—";
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2) + "%";
  }
  function dpOf(str) { var s = String(str || ""); var i = s.indexOf("."); return i < 0 ? 0 : s.replace(/0+$/, "").length - i - 1; }
  function get(path) {
    return fetch(FAPI + path).then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); });
  }
  function hhmmss(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x;
  }
  function clock(ms) {
    var d = new Date(ms);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }

  /* ---------- pure parsers (exposed for tests) ---------- */
  function parseTicker(t) {
    if (!t || !okSym(t.symbol)) return null;
    return { symbol: t.symbol, last: n(t.lastPrice), open: n(t.openPrice), chgPct: n(t.priceChangePercent),
      high: n(t.highPrice), low: n(t.lowPrice), vol: n(t.volume), qvol: n(t.quoteVolume), dp: dpOf(t.lastPrice) };
  }
  function parsePremium(p) {
    if (!p) return null;
    return { mark: n(p.markPrice !== undefined ? p.markPrice : p.p), index: n(p.indexPrice !== undefined ? p.indexPrice : p.i),
      funding: n(p.lastFundingRate !== undefined ? p.lastFundingRate : p.r),
      next: n(p.nextFundingTime !== undefined ? p.nextFundingTime : p.T) };
  }
  function parseBook(bids, asks, rows) {
    rows = rows || 10;
    function side(list, desc) {
      var out = [], cum = 0;
      (list || []).map(function (l) { return { p: n(l[0]), q: n(l[1]) }; })
        .filter(function (l) { return l.p !== null && l.q !== null && l.q > 0; })
        .sort(function (a, b) { return desc ? b.p - a.p : a.p - b.p; })
        .slice(0, rows).forEach(function (l) { cum += l.q; out.push({ p: l.p, q: l.q, cum: cum }); });
      return out;
    }
    var b = side(bids, true), a = side(asks, false);
    var max = Math.max(b.length ? b[b.length - 1].cum : 0, a.length ? a[a.length - 1].cum : 0) || 1;
    b.forEach(function (l) { l.pct = l.cum / max * 100; });
    a.forEach(function (l) { l.pct = l.cum / max * 100; });
    var bestBid = b.length ? b[0].p : null, bestAsk = a.length ? a[0].p : null;
    var spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    var mid = spread !== null ? (bestAsk + bestBid) / 2 : null;
    return { bids: b, asks: a, spread: spread, spreadPct: spread !== null && mid ? spread / mid * 100 : null, mid: mid };
  }
  function parseAgg(t) {
    if (!t) return null;
    var p = n(t.p), q = n(t.q), at = n(t.T);
    if (p === null || q === null || at === null) return null;
    // m = true: the buyer was the resting (maker) order, so the SELLER hit the book -> a sell (red)
    return { id: t.a, p: p, q: q, t: at, side: t.m ? "sell" : "buy" };
  }
  function fundingLeft(next, now) { return next ? Math.max(0, next - now) : null; }

  /* ---------- plumbing: visibility-aware timers and self-healing streams ---------- */
  function every(fn, ms) {
    var t = null, stopped = false;
    function run() { if (stopped) return; if (!hasDoc || !document.hidden) { try { fn(); } catch (e) {} } t = setTimeout(run, ms); }
    function vis() { if (!document.hidden && !stopped) { clearTimeout(t); run(); } }
    if (hasDoc) document.addEventListener("visibilitychange", vis);
    run();
    return function () { stopped = true; clearTimeout(t); if (hasDoc) document.removeEventListener("visibilitychange", vis); };
  }
  function stream(name, onMsg, onGiveUp) {
    var sock = null, stopped = false, fails = 0, timer = null, gaveUp = false;
    function open() {
      if (stopped || gaveUp || (hasDoc && document.hidden)) return;
      try { sock = new WebSocket(WS + name); } catch (e) { fail(); return; }
      sock.onopen = function () { fails = 0; };
      sock.onmessage = function (ev) { var d; try { d = JSON.parse(ev.data); } catch (e) { return; } try { onMsg(d); } catch (e) {} };
      sock.onclose = function () { sock = null; if (!stopped) fail(); };
      sock.onerror = function () { try { sock && sock.close(); } catch (e) {} };
    }
    function fail() {
      fails++;
      if (fails >= 4) { gaveUp = true; onGiveUp && onGiveUp(); return; }
      clearTimeout(timer); timer = setTimeout(open, Math.min(30000, 1000 * Math.pow(2, fails)));
    }
    function vis() {
      if (stopped) return;
      if (document.hidden) { if (sock) { var s = sock; sock = null; s.onclose = null; try { s.close(); } catch (e) {} } }
      else if (!sock && !gaveUp) { fails = 0; open(); }
    }
    if (hasDoc) document.addEventListener("visibilitychange", vis);
    open();
    return function () {
      stopped = true; clearTimeout(timer);
      if (hasDoc) document.removeEventListener("visibilitychange", vis);
      if (sock) { sock.onclose = null; try { sock.close(); } catch (e) {} }
    };
  }
  /* at most one paint per `ms`, on an animation frame */
  function throttle(paint, ms) {
    var queued = false, last = 0;
    return function () {
      if (queued) return;
      queued = true;
      var wait = Math.max(0, ms - (Date.now() - last));
      setTimeout(function () { requestAnimationFrame(function () { queued = false; last = Date.now(); try { paint(); } catch (e) {} }); }, wait);
    };
  }

  /* ---------- watchlist ---------- */
  function relatedFor(symbol) {
    var list = RELATED[symbol] || [[symbol, symbol, "The bot's own market"]];
    return list.map(function (r) { return { symbol: r[0], label: r[1], note: r[2] }; });
  }
  function sparkSVG(closes, up) {
    if (!closes || closes.length < 2) return "";
    var lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes), span = hi - lo || 1;
    var pts = closes.map(function (v, i) {
      return (i / (closes.length - 1) * 60).toFixed(1) + "," + (2 + (1 - (v - lo) / span) * 16).toFixed(1);
    }).join(" ");
    return '<svg viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts +
      '" fill="none" stroke="' + (up ? "#22AB94" : "#F7525F") + '" stroke-width="1.3" vector-effect="non-scaling-stroke"/></svg>';
  }
  function mountWatchlist(el, items, opts) {
    opts = opts || {};
    items = (items || []).filter(function (i) { return i && okSym(i.symbol); });
    var data = {}, sparks = {}, active = opts.active;
    el.classList.add("mk-watch");
    el.innerHTML = '<div class="mk-wh"><span>Symbol</span><span>Last</span><span>Chg%</span></div>' + items.map(function (i) {
      return '<button type="button" class="mk-wr" data-sym="' + esc(i.symbol) + '" title="' + esc(i.note || "") + '">' +
        '<span class="mk-wn"><b>' + esc(i.label) + '</b><small>' + esc(i.symbol) + '</small></span>' +
        '<span class="mk-sp"></span><span class="mk-wl">—</span><span class="mk-wc">—</span></button>';
    }).join("");
    function row(sym) { return el.querySelector('.mk-wr[data-sym="' + sym + '"]'); }
    function setActive(sym) {
      active = sym;
      Array.prototype.forEach.call(el.querySelectorAll(".mk-wr"), function (b) {
        var on = b.getAttribute("data-sym") === sym;
        b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
      });
    }
    el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".mk-wr");
      if (b && opts.onPick) opts.onPick(b.getAttribute("data-sym"));
    });
    setActive(active);
    function prices() {
      items.forEach(function (i) {
        get("ticker/24hr?symbol=" + i.symbol).then(function (t) {
          var d = parseTicker(t); if (!d) return;
          data[i.symbol] = d;
          var r = row(i.symbol); if (!r) return;
          r.querySelector(".mk-wl").textContent = fmt(d.last, Math.min(Math.max(d.dp, 2), 6));
          var c = r.querySelector(".mk-wc");
          c.textContent = pctText(d.chgPct); c.className = "mk-wc " + (d.chgPct > 0 ? "up" : d.chgPct < 0 ? "down" : "");
          if (opts.onData) opts.onData(data);
        }).catch(function () {});
      });
    }
    function lines() {
      items.forEach(function (i) {
        get("klines?symbol=" + i.symbol + "&interval=1h&limit=24").then(function (rows) {
          var c = rows.map(function (k) { return n(k[4]); }).filter(function (v) { return v !== null; });
          sparks[i.symbol] = c;
          var r = row(i.symbol); if (r) r.querySelector(".mk-sp").innerHTML = sparkSVG(c, c[c.length - 1] >= c[0]);
        }).catch(function () {});
      });
    }
    var s1 = every(prices, 10000), s2 = every(lines, 300000);
    return { stop: function () { s1(); s2(); }, setActive: setActive, data: data };
  }

  /* ---------- symbol details ---------- */
  function mountDetails(el, symbol, opts) {
    opts = opts || {};
    var sym = symbol, dp = opts.dp || 2, prem = null, tick = null, oi = null, stops = [];
    el.classList.add("mk-det");
    var cells = [["mark", "Mark price"], ["index", "Index price"], ["fund", "Funding / 8h"], ["cd", "Next funding in"],
      ["oi", "Open interest"], ["oiusd", "Open interest $"], ["hi", "24h high"], ["lo", "24h low"],
      ["vol", "24h volume"], ["qvol", "24h turnover $"]];
    el.innerHTML = cells.map(function (c) { return '<div><span>' + c[1] + '</span><b data-k="' + c[0] + '">—</b></div>'; }).join("");
    function set(k, text, tone) { var b = el.querySelector('[data-k="' + k + '"]'); if (b) { b.textContent = text; b.className = tone || ""; } }
    function paint() {
      if (prem) {
        set("mark", fmt(prem.mark, dp)); set("index", fmt(prem.index, dp));
        set("fund", prem.funding === null ? "—" : (prem.funding * 100).toFixed(4) + "%", prem.funding > 0 ? "up" : prem.funding < 0 ? "down" : "");
      }
      if (tick) { set("hi", fmt(tick.high, dp)); set("lo", fmt(tick.low, dp)); set("vol", compact(tick.vol)); set("qvol", compact(tick.qvol)); }
      if (oi !== null) { set("oi", compact(oi)); set("oiusd", prem && prem.mark ? compact(oi * prem.mark) : "—"); }
    }
    function load() {
      get("premiumIndex?symbol=" + sym).then(function (p) { prem = parsePremium(p); paint(); }).catch(function () {});
      get("ticker/24hr?symbol=" + sym).then(function (t) { tick = parseTicker(t); paint(); }).catch(function () {});
      get("openInterest?symbol=" + sym).then(function (o) { oi = n(o && o.openInterest); paint(); }).catch(function () {});
    }
    function start() {
      stops.push(every(load, 20000));
      stops.push(every(function () { if (prem && prem.next) set("cd", hhmmss(fundingLeft(prem.next, Date.now()))); }, 1000));
    }
    function stop() { stops.forEach(function (f) { f(); }); stops = []; }
    start();
    return { stop: stop, setSymbol: function (s, d) { if (!okSym(s)) return; sym = s; dp = d || dp; prem = tick = null; oi = null; stop(); start(); } };
  }

  /* ---------- order book ---------- */
  function mountBook(el, symbol, opts) {
    opts = opts || {};
    var sym = symbol, dp = opts.dp || 2, rows = opts.rows || 10, book = null, stopWs = null, stopPoll = null;
    el.classList.add("mk-book");
    function build() {
      var h = '<div class="mk-bh"><span>Price</span><span>Size</span><span>Total</span></div><div class="mk-asks">';
      for (var i = 0; i < rows; i++) h += '<div class="mk-lvl ask"><span></span><span></span><span></span></div>';
      h += '</div><div class="mk-spread"><b class="mk-mid">—</b><span class="mk-sprd">spread —</span></div><div class="mk-bids">';
      for (var j = 0; j < rows; j++) h += '<div class="mk-lvl bid"><span></span><span></span><span></span></div>';
      el.innerHTML = h + "</div>";
    }
    build();
    var paint = throttle(function () {
      if (!book) return;
      var askEls = el.querySelectorAll(".mk-lvl.ask"), bidEls = el.querySelectorAll(".mk-lvl.bid");
      // asks: best (lowest) price sits at the bottom, next to the spread
      for (var i = 0; i < rows; i++) {
        var a = book.asks[rows - 1 - i], ae = askEls[i];
        fill(ae, a);
        var b = book.bids[i], be = bidEls[i];
        fill(be, b);
      }
      el.querySelector(".mk-mid").textContent = fmt(book.mid, dp);
      el.querySelector(".mk-sprd").textContent = book.spread === null ? "spread —"
        : "spread " + fmt(book.spread, dp) + " (" + book.spreadPct.toFixed(3) + "%)";
    }, 250);
    function fill(row, l) {
      var s = row.children;
      if (!l) { s[0].textContent = s[1].textContent = s[2].textContent = ""; row.style.setProperty("--w", "0%"); return; }
      s[0].textContent = fmt(l.p, dp); s[1].textContent = compact(l.q); s[2].textContent = compact(l.cum);
      row.style.setProperty("--w", l.pct.toFixed(1) + "%");
    }
    function poll() { stopPoll = every(function () { get("depth?symbol=" + sym + "&limit=20").then(function (d) { book = parseBook(d.bids, d.asks, rows); paint(); }).catch(function () {}); }, 3000); }
    function start() {
      get("depth?symbol=" + sym + "&limit=20").then(function (d) { book = parseBook(d.bids, d.asks, rows); paint(); }).catch(function () {});
      stopWs = stream(sym.toLowerCase() + "@depth20@500ms", function (d) { if (d && (d.b || d.bids)) { book = parseBook(d.b || d.bids, d.a || d.asks, rows); paint(); } }, poll);
    }
    function stop() { if (stopWs) stopWs(); if (stopPoll) stopPoll(); stopWs = stopPoll = null; }
    start();
    return { stop: stop, setSymbol: function (s, d) { if (!okSym(s)) return; stop(); sym = s; dp = d || dp; book = null; build(); start(); } };
  }

  /* ---------- time & sales ---------- */
  function mountTape(el, symbol, opts) {
    opts = opts || {};
    var sym = symbol, dp = opts.dp || 2, max = opts.max || 40, list = [], sizes = [], stopWs = null, stopPoll = null, lastId = -1;
    el.classList.add("mk-tape");
    el.innerHTML = '<div class="mk-th"><span>Price</span><span>Size</span><span>Time</span></div><div class="mk-tl"></div>';
    var body = el.querySelector(".mk-tl");
    function add(t) {
      if (!t || t.id <= lastId) return;
      lastId = t.id; list.unshift(t); if (list.length > max) list.length = max;
      sizes.push(t.q); if (sizes.length > 300) sizes.shift();
    }
    function bigCut() {
      if (sizes.length < 20) return Infinity;
      var s = sizes.slice().sort(function (a, b) { return a - b; });
      return s[Math.floor(s.length * 0.95)];
    }
    var paint = throttle(function () {
      var cut = bigCut();
      body.innerHTML = list.map(function (t) {
        return '<div class="mk-tr ' + t.side + (t.q >= cut ? " big" : "") + '"><span>' + fmt(t.p, dp) + "</span><span>" +
          compact(t.q) + "</span><span>" + esc(clock(t.t)) + "</span></div>";
      }).join("");
    }, 250);
    function poll() { stopPoll = every(function () { get("aggTrades?symbol=" + sym + "&limit=" + max).then(function (rows) { rows.map(parseAgg).forEach(add); paint(); }).catch(function () {}); }, 3000); }
    function start() {
      get("aggTrades?symbol=" + sym + "&limit=" + max).then(function (rows) { rows.map(parseAgg).forEach(add); paint(); }).catch(function () {});
      stopWs = stream(sym.toLowerCase() + "@aggTrade", function (d) { add(parseAgg(d)); paint(); }, poll);
    }
    function stop() { if (stopWs) stopWs(); if (stopPoll) stopPoll(); stopWs = stopPoll = null; }
    start();
    return { stop: stop, setSymbol: function (s, d) { if (!okSym(s)) return; stop(); sym = s; dp = d || dp; list = []; sizes = []; lastId = -1; body.innerHTML = ""; start(); } };
  }

  /* ---------- plain-words market context from the watchlist numbers ---------- */
  function contextLines(symbol, t) {
    t = t || {};
    function ch(s) { return t[s] && t[s].chgPct !== null ? t[s].chgPct : null; }
    function word(v) { return v === null ? null : v > 0.15 ? "up" : v < -0.15 ? "down" : "flat"; }
    var out = [];
    if (symbol === "XAUUSDT") {
      var g = ch("XAUUSDT"), s = ch("XAGUSDT"), m = ch("GDXUSDT"), r = ch("TBTUSDT"), eq = ch("SPYUSDT");
      if (g !== null) out.push("Gold is " + word(g) + " " + pctText(g) + " over 24 hours.");
      if (s !== null && g !== null) out.push("Silver is " + word(s) + " " + pctText(s) + (word(s) === word(g) ? ", moving with gold." : ", moving against gold."));
      if (m !== null) out.push("Gold miners are " + word(m) + " " + pctText(m) + (g !== null && Math.abs(m) > Math.abs(g) * 1.5 ? " - a stronger move than gold itself." : "."));
      if (r !== null) out.push(r > 0.15 ? "US interest rates look to be rising (TBT " + pctText(r) + ") - usually a headwind for gold."
        : r < -0.15 ? "US interest rates look to be easing (TBT " + pctText(r) + ") - usually helpful for gold."
        : "US interest rates look steady today (TBT " + pctText(r) + ").");
      if (eq !== null) out.push("US shares are " + word(eq) + " " + pctText(eq) + (eq < -1 ? " - a nervous market can push buyers toward gold." : "."));
    } else {
      var own = ch(symbol);
      if (own !== null) out.push(symbol + " is " + word(own) + " " + pctText(own) + " over 24 hours.");
    }
    return out;
  }

  var CSS = [
    ".mk-watch{display:flex;flex-direction:column}",
    ".mk-wh,.mk-bh,.mk-th{display:grid;padding:6px 10px;font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--tv-mute,#8E919B);font-weight:700;border-bottom:1px solid var(--tv-line,#2A2E39)}",
    ".mk-wh{grid-template-columns:1fr auto auto;gap:10px}",
    ".mk-wr{display:grid;grid-template-columns:minmax(0,1fr) 60px 82px 64px;align-items:center;gap:8px;width:100%;padding:8px 10px;border:0;border-left:2px solid transparent;background:transparent;color:var(--tv-ink,#D1D4DC);text-align:left;cursor:pointer;font:inherit}",
    ".mk-wr:hover{background:rgba(42,46,57,.55)}",
    ".mk-wr.on{background:rgba(91,140,255,.10);border-left-color:var(--tv-blue,#5B8CFF)}",
    ".mk-wr:focus-visible{outline:2px solid var(--tv-blue,#5B8CFF);outline-offset:-2px}",
    ".mk-wn{min-width:0}.mk-wn b{display:block;font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".mk-wn small{display:block;font-family:var(--mono,monospace);font-size:.66rem;color:var(--tv-mute,#8E919B)}",
    ".mk-sp svg{width:60px;height:20px;display:block}",
    ".mk-wl,.mk-wc{font-family:var(--mono,monospace);font-size:.78rem;text-align:right;white-space:nowrap}",
    ".mk-wc{font-weight:600}",
    ".mk-det{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--tv-line,#2A2E39)}",
    ".mk-det div{background:var(--tv-bg,#131722);padding:9px 11px}",
    ".mk-det span{display:block;font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:var(--tv-mute,#8E919B);font-weight:700}",
    ".mk-det b{display:block;font-family:var(--mono,monospace);font-size:.84rem;font-weight:600;color:#fff;margin-top:3px}",
    ".mk-bh,.mk-th{grid-template-columns:1fr 1fr 1fr}",
    ".mk-bh span:not(:first-child),.mk-th span:not(:first-child){text-align:right}",
    ".mk-lvl,.mk-tr{position:relative;display:grid;grid-template-columns:1fr 1fr 1fr;padding:2px 10px;font-family:var(--mono,monospace);font-size:.74rem;line-height:1.55}",
    ".mk-lvl span:not(:first-child),.mk-tr span:not(:first-child){text-align:right;color:var(--tv-ink2,#B2B5BE)}",
    ".mk-lvl span{position:relative;z-index:1}",
    ".mk-lvl::before{content:\"\";position:absolute;right:0;top:0;bottom:0;width:var(--w,0%);transition:width .25s ease}",
    ".mk-lvl.ask span:first-child{color:var(--tv-down,#F7525F)}.mk-lvl.ask::before{background:rgba(242,54,69,.16)}",
    ".mk-lvl.bid span:first-child{color:var(--tv-up,#22AB94)}.mk-lvl.bid::before{background:rgba(8,153,129,.16)}",
    ".mk-spread{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:7px 10px;border-block:1px solid var(--tv-line,#2A2E39)}",
    ".mk-mid{font-family:var(--mono,monospace);font-size:1rem;color:#fff}.mk-sprd{font-family:var(--mono,monospace);font-size:.7rem;color:var(--tv-mute,#8E919B)}",
    ".mk-tl{max-height:420px;overflow:hidden}",
    ".mk-tr.buy span:first-child{color:var(--tv-up,#22AB94)}.mk-tr.sell span:first-child{color:var(--tv-down,#F7525F)}",
    ".mk-tr.big{background:rgba(245,181,68,.10)}.mk-tr.big span{font-weight:700}",
    ".mk-watch .up,.mk-det .up{color:var(--tv-up,#22AB94)}.mk-watch .down,.mk-det .down{color:var(--tv-down,#F7525F)}",
    "@media (prefers-reduced-motion:reduce){.mk-lvl::before{transition:none}}",
    "@media (max-width:420px){.mk-wr{grid-template-columns:minmax(0,1fr) 72px 58px}.mk-sp{display:none}}"
  ].join("\n");

  var api = {
    relatedFor: relatedFor, mountWatchlist: mountWatchlist, mountDetails: mountDetails, mountBook: mountBook,
    mountTape: mountTape, contextLines: contextLines, CSS: CSS,
    _parseTicker: parseTicker, _parsePremium: parsePremium, _parseBook: parseBook, _parseAgg: parseAgg,
    _fundingLeft: fundingLeft, _hhmmss: hhmmss, _compact: compact, _dpOf: dpOf
  };
  if (typeof window !== "undefined") window.SDLMarket = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
