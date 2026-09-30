/* The owner's dashboard on Home (DESIGN-2, 30 Sep 2026).
   It asks /api/me who is looking, and only for the owner it asks /api/today and fills the page: the total with its chart,
   four small tiles, one card per bot, and what needs attention. Everyone else (or anyone signed out) keeps the public
   front page. The numbers are practice money only, and nothing is typed in by hand.

   While it loads the page shows soft shimmering boxes. If it cannot load, it says so and offers "Try again". */
(function () {
  var dash = document.getElementById("dash");
  if (!dash) return;
  var IC = (window.SDL && window.SDL.icons) || {};
  var first = true, chartData = null, timer = 0;

  function $(id) { return document.getElementById(id); }
  function usd(v) {
    if (v == null || !isFinite(v)) return "—";
    return (v > 0.004 ? "+" : v < -0.004 ? "−" : "") + "$" + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function tone(v) { return v > 0.004 ? "up" : v < -0.004 ? "down" : ""; }
  function put(el, v, cls) { el.textContent = v; el.className = (el.className.split(" ")[0] || "") + (cls ? " " + cls : ""); }
  function esc(t) { var d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
  function svgEl(name, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function icon(name) { return IC[name] || ""; }
  function setIcon(id, name) { var el = $(id); if (el) el.innerHTML = icon(name); }
  function count(el, v, cls) {
    el.className = el.className.split(" ")[0] + (cls ? " " + cls : "");
    if (first && window.SDL && SDL.countUp && v != null) SDL.countUp(el, v, usd); else el.textContent = usd(v);
  }

  /* ---- greeting ---- */
  function greet(name) {
    var h = new Date().getHours();
    var part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
    $("dHello").innerHTML = esc(part) + ", <em>" + esc(name || "Salman") + "</em>";
    $("dDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  /* ---- the big chart: total over time, drawn in SVG with a soft fill, a live dot and a hover read-out ---- */
  function drawChart(pts) {
    var box = $("mcChart");
    if (!box) return;
    box.textContent = "";
    box.classList.remove("hov");
    if (!pts || pts.length < 2) {
      box.innerHTML = '<div class="mcEmpty">The chart fills in as the bots finish trades.</div>';
      return;
    }
    var W = Math.max(box.clientWidth, 200), H = Math.max(box.clientHeight, 120);
    var padT = 34, padB = 16;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
    if (t1 <= t0) t1 = t0 + 1;
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    lo = Math.min(lo, 0); hi = Math.max(hi, 0);
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    var span = hi - lo; lo -= span * 0.06; hi += span * 0.06;
    function X(t) { return ((t - t0) / (t1 - t0)) * (W - 16); }
    function Y(v) { return padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB); }
    var d = "", i;
    for (i = 0; i < pts.length; i++) d += (i ? "L" : "M") + X(pts[i][0]).toFixed(1) + " " + Y(pts[i][1]).toFixed(1);
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", "aria-hidden": "true" });
    var defs = svgEl("defs", {});
    var g1 = svgEl("linearGradient", { id: "mcA", x1: "0", y1: "0", x2: "0", y2: "1" });
    g1.appendChild(svgEl("stop", { offset: "0", "stop-color": "var(--accent)", "stop-opacity": "0.38" }));
    g1.appendChild(svgEl("stop", { offset: "1", "stop-color": "var(--accent)", "stop-opacity": "0" }));
    var g2 = svgEl("linearGradient", { id: "mcL", gradientUnits: "userSpaceOnUse", x1: "0", y1: "0", x2: String(W), y2: "0" });
    g2.appendChild(svgEl("stop", { offset: "0", "stop-color": "var(--accent)" }));
    g2.appendChild(svgEl("stop", { offset: "1", "stop-color": "var(--accent-2)" }));
    defs.appendChild(g1); defs.appendChild(g2); svg.appendChild(defs);
    var zy = Y(0);
    svg.appendChild(svgEl("line", { "class": "grid", x1: "0", x2: String(W), y1: zy.toFixed(1), y2: zy.toFixed(1) }));
    svg.appendChild(svgEl("path", { "class": "area", d: d + "L" + W + " " + H + "L0 " + H + "Z", fill: "url(#mcA)" }));
    svg.appendChild(svgEl("path", { "class": "line", d: d, stroke: "url(#mcL)" }));
    box.appendChild(svg);
    var last = pts[pts.length - 1];
    var dot = document.createElement("span"); dot.className = "mcDot";
    dot.style.left = X(last[0]) + "px"; dot.style.top = Y(last[1]) + "px";
    var cross = document.createElement("span"); cross.className = "mcCross";
    var tip = document.createElement("div"); tip.className = "mcTip";
    box.appendChild(cross); box.appendChild(dot); box.appendChild(tip);

    function show(clientX) {
      var r = box.getBoundingClientRect(), x = Math.min(Math.max(clientX - r.left, 0), W);
      var t = t0 + (x / W) * (t1 - t0), best = pts[0];
      pts.forEach(function (p) { if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; });
      var bx = X(best[0]);
      cross.style.left = bx + "px";
      tip.style.left = Math.min(Math.max(bx, 60), W - 60) + "px";
      tip.innerHTML = esc(usd(best[1])) + "<small>" + esc(new Date(best[0]).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + "</small>";
      box.classList.add("hov");
    }
    box.onpointermove = function (e) { show(e.clientX); };
    box.onpointerleave = function () { box.classList.remove("hov"); };
    box.onpointerdown = function (e) { show(e.clientX); };
  }

  /* ---- little chart on each bot card ---- */
  function spark(series, net) {
    var W = 96, H = 34;
    var svg = svgEl("svg", { "class": "spark" + (series && series.length > 1 ? "" : " flat"), viewBox: "0 0 " + W + " " + H, "aria-hidden": "true", preserveAspectRatio: "none" });
    var path;
    if (series && series.length > 1) {
      var lo = Math.min.apply(null, series), hi = Math.max.apply(null, series);
      if (hi - lo < 0.01) { hi += 0.5; lo -= 0.5; }
      var d = series.map(function (v, i) {
        return (i ? "L" : "M") + (i / (series.length - 1) * W).toFixed(1) + " " + (3 + (1 - (v - lo) / (hi - lo)) * (H - 6)).toFixed(1);
      }).join("");
      path = svgEl("path", { d: d, stroke: net >= 0 ? "var(--up)" : "var(--down)" });
    } else {
      path = svgEl("path", { d: "M0 " + H / 2 + "L" + W + " " + H / 2 });
    }
    svg.appendChild(path);
    return svg;
  }

  function botCard(c) {
    var a = document.createElement("a");
    a.className = "glass d-bot"; a.href = /^\/[a-z]/.test(c.link || "") ? c.link : "/trading/";
    var word = c.health === "ok" ? "Running well" : c.health === "late" ? "Quiet or paused" : "Needs a look";
    a.setAttribute("aria-label", c.name + ": " + usd(c.net) + ". " + word + ". " + (c.line || ""));
    var ico = c.group === "gold" ? icon("gold") : c.group === "bees" ? icon("bees") : icon("coin");
    a.innerHTML = '<div class="bt"><span class="bi ' + (c.group === "gold" ? "gold" : c.group === "bees" ? "bees" : "") + '">' + ico + '</span>' +
      '<div class="bn">' + esc(c.name) + '<span class="bl">' + esc(c.line || "") + '</span></div>' +
      '<span class="u-lamp ' + (c.health === "ok" ? "ok" : c.health === "late" ? "late" : "bad") + '" title="' + word + '"></span></div>' +
      '<div class="bb"><span class="br ' + tone(c.net) + '">' + esc(usd(c.net)) + '</span></div>';
    a.querySelector(".bb").appendChild(spark(c.spark, c.net));
    return a;
  }

  function fail(msg, retry) {
    dash.setAttribute("aria-busy", "false");
    var box = $("dBots"); box.textContent = "";
    var e = document.createElement("div");
    e.className = "u-empty"; e.style.gridColumn = "1 / -1";
    e.innerHTML = icon("pulse") + "<b>Couldn't load your numbers</b><span></span>";
    e.querySelector("span").textContent = msg;
    if (retry) {
      var b = document.createElement("button"); b.type = "button"; b.className = "u-btn"; b.textContent = "Try again";
      b.onclick = function () { load(); };
      e.appendChild(b);
    }
    box.appendChild(e);
    $("mcChart").textContent = "";
    $("tChip").textContent = "Offline";
  }

  function render(d) {
    dash.setAttribute("aria-busy", "false");
    var total = d.total, ch = d.change_today;
    count($("tTotal"), total, tone(total));
    $("tTotalN").textContent = total == null ? "No news from the bots yet." : "Won or lost, all bots together. Practice money only.";
    var chip = $("tChip");
    if (ch == null) { chip.className = "u-chip"; chip.textContent = "Today starts counting tonight"; }
    else { chip.className = "u-chip " + tone(ch); chip.textContent = usd(ch) + " today"; }
    drawChart(d.history);
    chartData = d.history;

    setIcon("tiChange", (ch || 0) < 0 ? "down" : "up"); setIcon("tiBest", "bolt"); setIcon("tiWorst", "pulse"); setIcon("tiHealth", "shield");
    count($("tChange"), ch, tone(ch));
    $("tChangeN").textContent = ch == null ? "starts counting tonight" : "since midnight (Dubai)";
    var b = d.best, w = d.worst;
    if (b) { count($("tBest"), b.net, tone(b.net)); $("tBestN").textContent = b.name; }
    if (w) { count($("tWorst"), w.net, tone(w.net)); $("tWorstN").textContent = w.name; }
    var cards = Array.isArray(d.cards) ? d.cards : [];
    var okN = cards.filter(function (c) { return c.health === "ok"; }).length;
    var hv = $("tHealth");
    hv.className = "v " + (cards.length && okN === cards.length ? "up" : okN ? "" : "down");
    hv.textContent = cards.length ? okN + " of " + cards.length : "—";
    $("tHealthN").textContent = !cards.length ? "no news yet" : okN === cards.length ? "every bot is on time" : (cards.length - okN) + " quiet or paused";

    var box = $("dBots"); box.textContent = "";
    cards.slice().sort(function (a, c) { return c.net - a.net; }).forEach(function (c) { box.appendChild(botCard(c)); });
    if (!cards.length) {
      var e = document.createElement("div"); e.className = "u-empty"; e.style.gridColumn = "1 / -1";
      e.innerHTML = icon("coin") + "<b>No bots reporting yet</b><span>They send their numbers every hour.</span>";
      box.appendChild(e);
    }
    $("botsCount").textContent = cards.length ? cards.length + " bots" : "";

    var need = $("tNeeds"); need.textContent = "";
    var items = d.needs_you || [];
    if (!items.length) {
      var ok = document.createElement("div"); ok.className = "ok"; ok.textContent = "All good. Nothing needs you right now."; need.appendChild(ok);
    }
    items.forEach(function (n) {
      var a = document.createElement("a"); a.href = /^\/[a-z]/.test(n.link || "") ? n.link : "/control/";
      a.className = n.level === "bad" ? "bad" : "";
      a.textContent = (n.level === "bad" ? "Needs you: " : "Heads up: ") + n.text;
      need.appendChild(a);
    });
    first = false;
  }

  function load() {
    return fetch("/api/today", { credentials: "same-origin", cache: "no-store" }).then(function (r) {
      if (r.status === 401 || r.status === 403) { leave(); return null; }
      if (!r.ok) throw new Error("bad");
      return r.json();
    }).then(function (d) {
      if (!d) return;
      if (!d.ok) throw new Error("bad");
      render(d);
    }).catch(function () {
      if (first) fail("Check your connection, then try again.", true);
    });
  }
  function leave() {
    dash.hidden = true; document.body.classList.remove("isOwner");
    try { localStorage.removeItem("sdl-owner"); } catch (e) {}
  }

  function ask() { var f = document.querySelector(".askFab"); if (f) f.click(); }
  ["dAsk", "dAsk2"].forEach(function (id) {
    var b = $(id); if (!b) return;
    b.insertAdjacentHTML("afterbegin", icon("ask"));
    var s = b.querySelector("svg"); if (s) { s.style.width = "18px"; s.style.height = "18px"; }
    b.addEventListener("click", ask);
  });
  var openBtn = dash.querySelector('.dQuick a'); if (openBtn) openBtn.insertAdjacentHTML("afterbegin", icon("ctl"));
  var ob = openBtn && openBtn.querySelector("svg"); if (ob) { ob.style.width = "18px"; ob.style.height = "18px"; }

  fetch("/api/me", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (me) {
    if (!me || !me.signedIn) { leave(); return; }
    var nm = me.user && me.user.name && me.user.name.trim() ? me.user.name.trim().split(" ")[0] : "";
    greet(nm);
    dash.hidden = false; document.body.classList.add("isOwner");
    return load().then(function () {
      if (!dash.hidden) { try { localStorage.setItem("sdl-owner", "1"); } catch (e) {} }
    });
  }).catch(function () { leave(); });

  greet("");
  addEventListener("resize", function () { clearTimeout(timer); timer = setTimeout(function () { if (chartData) drawChart(chartData); }, 150); });
  setInterval(function () { if (!document.hidden && !dash.hidden) load(); }, 300000);
})();
