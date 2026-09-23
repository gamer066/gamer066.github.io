/* The sun / moon switch in the top bar.
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
