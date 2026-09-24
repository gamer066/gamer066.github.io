/* The top bar's extras: the sun / moon switch, the phone menu button, and the Ctrl+K quick jump.
 *
 * Dark is the site's own look and stays the default. Tapping the button swaps to daylight and
 * remembers the choice on that device only. Nothing is sent anywhere.
 *
 * The very first lines run in the page <head> (see setTheme below, called inline) so the right
 * colours are painted straight away and the screen never flashes white.
 */
(function () {
  var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';

  function now() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function apply(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", mode === "light" ? "#F6F7FE" : "#05060B");
    try { localStorage.setItem("sdl-theme", mode); } catch (e) { /* private browsing */ }
  }

  function build() {
    var nav = document.querySelector(".topbar .navlinks");
    if (!nav || nav.querySelector(".themeBtn")) return;

    var b = document.createElement("button");
    b.type = "button";
    b.className = "themeBtn";
    function dress() {
      var light = now() === "light";
      b.innerHTML = light ? MOON : SUN;
      b.setAttribute("aria-label", light ? "Switch to the dark look" : "Switch to the daylight look");
      b.title = b.getAttribute("aria-label");
    }
    dress();
    b.addEventListener("click", function () {
      apply(now() === "light" ? "dark" : "light");
      dress();
    });
    b.addEventListener("refresh", dress);
    nav.insertBefore(b, nav.firstChild);
  }

  /* ---- the phone menu ----
     On a narrow screen the section links fold away behind a menu button (the CSS decides when).
     They are copied into a panel under the bar, so each page keeps writing its links in one place. */
  var MENU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function buildMenu() {
    var bar = document.querySelector(".topbar");
    var inner = bar && bar.querySelector(".inner");
    var nav = inner && inner.querySelector(".navlinks");
    if (!nav || inner.querySelector(".menuBtn")) return;

    var links = Array.prototype.filter.call(nav.children, function (el) {
      return el.tagName === "A" && el.id !== "account";
    });
    if (!links.length) return;

    var panel = document.createElement("nav");
    panel.className = "mobileNav";
    panel.setAttribute("aria-label", "Site sections");
    links.forEach(function (a) {
      var copy = a.cloneNode(true);
      copy.removeAttribute("id");
      panel.appendChild(copy);
    });
    bar.appendChild(panel);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menuBtn";
    function dress(open) {
      btn.innerHTML = open ? CLOSE : MENU;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Close the menu" : "Open the menu");
    }
    dress(false);
    btn.addEventListener("click", function () {
      var open = !bar.classList.contains("open");
      bar.classList.toggle("open", open);
      dress(open);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && bar.classList.contains("open")) { bar.classList.remove("open"); dress(false); }
    });
    inner.appendChild(btn);
  }


  /* ---- quick jump: Ctrl+K (or the search button) opens a box that jumps to any page, unit, document or account ----
     Everything it lists is read from the site's own menu and from what the current page is already showing,
     so it never needs its own copy of anything private. */
  var SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  function gather() {
    var items = [], seen = {};
    function add(label, hint, go) {
      var key = label + "|" + hint;
      if (!label || seen[key]) return;
      seen[key] = 1;
      items.push({ label: label, hint: hint, go: go });
    }
    [["Home", "/"], ["Studies", "/study/"], ["Accounts", "/accounts/"], ["Trading", "/trading/"],
     ["Your profile", "/profile/"], ["Sign in", "/login/"]].forEach(function (p) {
      add(p[0], "Page", function () { location.href = p[1]; });
    });
    add(now() === "light" ? "Switch to the dark look" : "Switch to the daylight look", "Action", function () {
      apply(now() === "light" ? "dark" : "light");
      var b = document.querySelector(".themeBtn"); if (b) b.dispatchEvent(new Event("refresh"));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".unit"), function (u) {
      var h = u.querySelector("h3"), a = u.querySelector(".go a");
      if (h) add(h.textContent.trim(), "Unit", function () {
        u.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      if (h && a) add(h.textContent.trim() + " on Canvas", "Link", function () { window.open(a.href, "_blank", "noopener"); });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".doc"), function (d) {
      var nm = d.querySelector(".nm"), open = d.querySelector(".acts a");
      if (!nm) return;
      var name = nm.lastChild ? nm.lastChild.textContent.trim() : nm.textContent.trim();
      add(name, open ? "Document - opens" : "Document", function () {
        if (open) window.open(open.href, "_blank", "noopener");
        else d.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".acc"), function (c) {
      var h = c.querySelector("h4"), a = c.querySelector(".open2 a");
      if (h) add(h.textContent.trim(), "Account", function () {
        if (a) window.open(a.href, "_blank", "noopener"); else c.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    return items;
  }

  function buildPalette() {
    if (document.querySelector(".palette")) return;
    var box = document.createElement("div");
    box.className = "palette";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Quick jump");
    box.innerHTML = '<div class="pal">' +
      '<div class="palHead">' + SEARCH + '<input type="text" placeholder="Jump to a page, unit, document or account\u2026" ' +
      'aria-label="Search" aria-controls="palList" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>' +
      '<div class="palList" id="palList" role="listbox"></div>' +
      '<div class="palFoot"><span><kbd>\u2191</kbd><kbd>\u2193</kbd> move</span><span><kbd>Enter</kbd> open</span>' +
      '<span><kbd>Ctrl</kbd><kbd>K</kbd> anywhere</span><span><kbd>?</kbd> all shortcuts</span></div></div>';
    document.body.appendChild(box);

    var input = box.querySelector("input"), list = box.querySelector(".palList");
    var all = [], shown = [], pick = 0, lastFocus = null;

    function draw() {
      var words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      shown = all.filter(function (it) {
        var hay = (it.label + " " + it.hint).toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      }).slice(0, 40);
      if (pick >= shown.length) pick = Math.max(0, shown.length - 1);
      list.innerHTML = shown.length ? shown.map(function (it, i) {
        return '<div class="palItem' + (i === pick ? " on" : "") + '" role="option" aria-selected="' + (i === pick) +
          '" data-i="' + i + '"><span class="pl"></span><span class="ph"></span></div>';
      }).join("") : '<div class="palNone">Nothing matches that.</div>';
      Array.prototype.forEach.call(list.querySelectorAll(".palItem"), function (row) {
        var it = shown[+row.getAttribute("data-i")];
        row.querySelector(".pl").textContent = it.label;
        row.querySelector(".ph").textContent = it.hint;
      });
      var on = list.querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
    }
    function open() {
      lastFocus = document.activeElement;
      all = gather(); pick = 0; input.value = "";
      box.hidden = false; document.documentElement.classList.add("palOpen");
      draw(); input.focus();
    }
    function close() {
      box.hidden = true; document.documentElement.classList.remove("palOpen");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function run(i) { var it = shown[i]; if (!it) return; close(); it.go(); }

    input.addEventListener("input", function () { pick = 0; draw(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { pick = Math.min(shown.length - 1, pick + 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { pick = Math.max(0, pick - 1); draw(); e.preventDefault(); }
      else if (e.key === "Enter") { run(pick); e.preventDefault(); }
      else if (e.key === "Escape") { close(); e.preventDefault(); }
    });
    list.addEventListener("click", function (e) {
      var row = e.target.closest(".palItem"); if (row) run(+row.getAttribute("data-i"));
    });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") || (e.target && e.target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); box.hidden ? open() : close(); }
      else if (e.key === "/" && !typing && box.hidden) { e.preventDefault(); open(); }
    });

    // the search button in the top bar
    var nav = document.querySelector(".topbar .navlinks");
    if (nav && !nav.querySelector(".searchBtn")) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "themeBtn searchBtn"; b.innerHTML = SEARCH;
      b.setAttribute("aria-label", "Quick jump (Ctrl+K)"); b.title = "Quick jump (Ctrl+K)";
      b.addEventListener("click", open);
      nav.insertBefore(b, nav.firstChild);
    }
  }

  /* ---- "?" lists the keyboard shortcuts; "T" switches between dark and daylight ---- */
  function buildKeys() {
    if (document.querySelector(".keysBox")) return;
    var rows = [["Ctrl", "K", "Quick jump to any page, unit, document or account"], ["/", "", "Quick jump, too"],
                ["T", "", "Switch between dark and daylight"], ["?", "", "Show this list"], ["Esc", "", "Close any open box"]];
    var box = document.createElement("div");
    box.className = "palette keysBox";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Keyboard shortcuts");
    box.innerHTML = '<div class="pal"><div class="palHead"><span class="keysTitle">Keyboard shortcuts</span><kbd>Esc</kbd></div>' +
      '<div class="palList">' + rows.map(function (r) {
        return '<div class="palItem"><span class="pl">' + r[2] + '</span><span class="ph"><kbd>' + r[0] + '</kbd>' +
          (r[1] ? ' <kbd>' + r[1] + '</kbd>' : '') + '</span></div>';
      }).join("") + '</div></div>';
    document.body.appendChild(box);
    var before = null;
    box.setAttribute("tabindex", "-1");
    function close() {
      box.hidden = true; document.documentElement.classList.remove("palOpen");
      if (before && before.focus) before.focus();
    }
    box.addEventListener("click", function (e) { if (e.target === box) close(); });
    document.addEventListener("keydown", function (e) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") || (e.target && e.target.isContentEditable);
      var anyOpen = Array.prototype.some.call(document.querySelectorAll(".palette"), function (p) { return !p.hidden; });
      if (e.key === "Escape" && !box.hidden) { close(); return; }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?" && !anyOpen) {
        e.preventDefault(); before = document.activeElement;
        box.hidden = false; document.documentElement.classList.add("palOpen"); box.focus();
      }
      else if ((e.key === "t" || e.key === "T") && !anyOpen) {
        var btn = document.querySelector(".themeBtn:not(.searchBtn)");
        if (btn) btn.click(); else apply(now() === "light" ? "dark" : "light");
      }
    });
  }

  /* Keeps Tab inside an open box, the way proper dialogs behave, so keyboard users never get lost behind it. */
  function trapFocus(box) {
    box.addEventListener("keydown", function (e) {
      if (e.key !== "Tab" || box.hidden) return;
      var stops = Array.prototype.filter.call(
        box.querySelectorAll('input,button,a[href],[tabindex]:not([tabindex="-1"])'),
        function (el) { return !el.disabled && el.offsetParent !== null; });
      if (!stops.length) { e.preventDefault(); return; }
      var first = stops[0], last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function start() {
    build(); buildMenu(); buildPalette(); buildKeys();
    Array.prototype.forEach.call(document.querySelectorAll(".palette"), trapFocus);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
