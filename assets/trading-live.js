/* Re-prices the open trades on the trading page from Binance's public price feed, every 15 seconds.
 *
 * The same job as the small script the laptop bakes into the page. functions/trading/_middleware.js swaps this one in
 * when it fills the page with the cloud's newer numbers, because it also prices the short bot's bets the right way
 * round (a short gains when the price falls). Nothing here is authenticated and nothing can place an order: it is a
 * read of public prices.
 */
(function () {
  var POS = [], CLOSED = 0;
  try {
    var d = JSON.parse(document.getElementById("positions").textContent);
    POS = d.positions || []; CLOSED = d.closed || 0;
  } catch (e) { return; }

  var dot = document.getElementById("dot"), livetext = document.getElementById("livetext");
  if (!POS.length) {
    if (dot) { dot.className = "dot stale"; }
    if (livetext) { livetext.textContent = "No trades are open right now."; }
    return;
  }

  function fmt(v) {
    var s = "$" + Math.abs(v).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    return (v < 0 ? "−" : "+") + s;
  }
  function stopFmt(v) {
    if (v === null || v === undefined) { return "—"; }
    var n = Number(v);
    return n >= 100 ? n.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
         : n >= 1 ? n.toFixed(4) : n.toFixed(5);
  }
  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
    });
  }
  function set(id, text, cls) {
    var el = document.getElementById(id);
    if (!el) { return; }
    if (el.textContent !== text) {
      el.textContent = text;
      el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    }
    if (cls) { el.classList.remove("up", "down"); el.classList.add(cls); }
  }

  function paint(prices) {
    var open = 0, rows = [];
    POS.forEach(function (p) {
      var px = prices[p.sym];
      var val = px ? p.qty * px : p.val;        // fall back to the value sent up if a symbol is missing
      var pnl = p.side === "short" ? p.cost - val : val - p.cost;
      open += pnl;
      rows.push({p: p, val: val, pnl: pnl, pct: p.cost ? 100 * pnl / p.cost : 0});
    });
    rows.sort(function (a, b) { return b.pnl - a.pnl; });
    document.getElementById("tbody").innerHTML = rows.map(function (r) {
      var c = r.pnl >= 0 ? "up" : "down";
      var who = esc(r.p.bot) + (r.p.side === "short" ? " &middot; short" : "");
      return '<tr><td><span class="coin">' + esc(r.p.coin) + '</span> <span class="who">' + who + '</span></td>'
           + '<td class="num">$' + r.p.cost.toFixed(2) + '</td>'
           + '<td class="num">$' + r.val.toFixed(2) + '</td>'
           + '<td class="num ' + c + '">' + fmt(r.pnl) + '&nbsp;&nbsp;'
           + (r.pct >= 0 ? "+" : "−") + Math.abs(r.pct).toFixed(1) + '%</td>'
           + '<td class="num">' + stopFmt(r.p.stop) + '</td></tr>';
    }).join("");

    var net = CLOSED + open;
    set("opentotal", fmt(open), open >= 0 ? "up" : "down");
    set("net", fmt(net), net >= 0 ? "up" : "down");
    set("netpct", (net >= 0 ? "+" : "−") + Math.abs(100 * net / 10000).toFixed(2) + "%");
    var pill = document.getElementById("netpill");
    if (pill) {
      pill.textContent = net >= 0 ? "Up right now" : "Down right now";
      pill.className = "pill " + (net >= 0 ? "u" : "d");
    }
    var live = document.getElementById("openbar");
    if (live) { live.setAttribute("data-open", open.toFixed(2)); }
  }

  function tick() {
    fetch("https://data-api.binance.vision/api/v3/ticker/price")
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var prices = {};
        list.forEach(function (x) { prices[x.symbol] = parseFloat(x.price); });
        paint(prices);
        dot.className = "dot";
        livetext.textContent = "Prices are live, updating every 15 seconds.";
      })
      .catch(function () {
        dot.className = "dot stale";
        livetext.textContent = "Cannot reach Binance right now — showing the last known prices.";
      });
  }
  tick();
  setInterval(tick, 15000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { tick(); } });
})();
