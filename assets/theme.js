/* The sun / moon switch in the top bar, and the phone menu button beside it.
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
    if (meta) meta.setAttribute("content", mode === "light" ? "#FAF7F1" : "#0C0B0A");
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

  function start() { build(); buildMenu(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
