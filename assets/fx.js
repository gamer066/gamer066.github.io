/* The futuristic layer, shared by every page of Salman.D.Life.
 *
 *  - a quiet backdrop: faint grid, two slow violet/cyan glows, and a live particle network
 *  - a soft glow that follows the mouse, and cards that tilt in 3D under it (never on touch screens)
 *
 * It adds the backdrop itself if a page does not have one, so pages only need to load this file.
 * Everything stops for anyone whose device asks for less motion, and the particles pause whenever the
 * tab is hidden, so it costs nothing in the background.
 */
(function () {
  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia && matchMedia("(pointer: fine)").matches;

  function start() {
    /* ---- the backdrop ---- */
    var back = document.querySelector(".backdrop");
    if (!back) {
      back = document.createElement("div");
      back.className = "backdrop";
      back.setAttribute("aria-hidden", "true");
      back.innerHTML = '<canvas id="stars"></canvas><div class="grid"></div><div class="glow g1"></div><div class="glow g2"></div>';
      document.body.insertBefore(back, document.body.firstChild);
    }
    // inner pages are for reading, so their network is thinner than the home page's
    var density = document.body.classList.contains("home") || document.querySelector(".hero .console") ? 1 : 0.55;
    particles(document.getElementById("stars"), density);

    /* ---- offline notice: says so plainly when the connection drops (the saved copy keeps the site readable) ---- */
    var pill = document.createElement("div");
    pill.className = "offline";
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    pill.textContent = "You're offline \u2014 showing the saved copy";
    pill.hidden = navigator.onLine !== false;
    document.body.appendChild(pill);
    addEventListener("offline", function () { pill.hidden = false; });
    addEventListener("online", function () { pill.hidden = true; });

    /* ---- pop-up notes: every page already writes its messages into a .msg box; mirror each one as a note that
       slides in at the corner, and tuck the box away (screen readers still hear it, it stays in the page). ---- */
    var shelf = document.createElement("div");
    shelf.className = "toasts";
    shelf.setAttribute("aria-hidden", "true");
    document.body.appendChild(shelf);
    var lastNote = "", lastAt = 0;
    function toastFrom(box) {
      if (!/\bshow\b/.test(box.className)) return;
      var text = (box.textContent || "").trim();
      if (!text || (text === lastNote && Date.now() - lastAt < 1500)) return;
      lastNote = text; lastAt = Date.now();
      box.classList.add("toasted");
      var t = document.createElement("div");
      t.className = "toast " + (/\bgood\b/.test(box.className) ? "good" : "bad");
      t.innerHTML = '<span class="tx"></span><button type="button" aria-label="Close">\u00d7</button>';
      t.querySelector(".tx").textContent = text;
      function gone() { t.classList.add("out"); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260); }
      t.querySelector("button").addEventListener("click", gone);
      shelf.appendChild(t);
      while (shelf.children.length > 3) shelf.removeChild(shelf.firstChild);
      setTimeout(gone, /good/.test(t.className) ? 4200 : 7000);
    }
    Array.prototype.forEach.call(document.querySelectorAll(".msg"), function (box) {
      new MutationObserver(function () { toastFrom(box); })
        .observe(box, { attributes: true, attributeFilter: ["class"], childList: true, characterData: true, subtree: true });
    });

    /* ---- a soft glow that follows the mouse (desktop only) ---- */
    if (finePointer && !still) {
      var glow = document.createElement("div");
      glow.className = "cursorGlow";
      glow.setAttribute("aria-hidden", "true");
      document.body.appendChild(glow);
      var gx = -9999, gy = -9999, queued = false;
      addEventListener("pointermove", function (e) {
        gx = e.clientX; gy = e.clientY;
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          glow.style.transform = "translate3d(" + gx + "px," + gy + "px,0)";
          queued = false;
        });
      }, { passive: true });
      document.documentElement.addEventListener("pointerleave", function () {
        glow.style.transform = "translate3d(-9999px,-9999px,0)";
      });
    }

    /* ---- 3D tilt on cards (mouse only) ---- */
    if (finePointer && !still) {
      Array.prototype.forEach.call(document.querySelectorAll(".cell,.unit,.acc,.mail,.tile"), function (card) {
        card.addEventListener("pointermove", function (e) {
          var b = card.getBoundingClientRect();
          var x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5;
          card.style.setProperty("--mx", (e.clientX - b.left) + "px");
          card.style.setProperty("--my", (e.clientY - b.top) + "px");
          card.style.transform = "perspective(900px) rotateX(" + (-y * 5).toFixed(2) + "deg) rotateY(" +
            (x * 6).toFixed(2) + "deg) translateY(-3px)";
        });
        card.addEventListener("pointerleave", function () { card.style.transform = ""; });
      });
    }
  }

  /* ---- the live particle network ---- */
  function particles(canvas, density) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d"), dots = [], w = 0, h = 0, mouse = { x: -9999, y: -9999 }, colours = [];
    var running = false;

    function readColours() {
      var cs = getComputedStyle(document.documentElement);
      colours = [cs.getPropertyValue("--accent").trim() || "#A78BFA", cs.getPropertyValue("--accent-2").trim() || "#22D3EE"];
    }
    function size() {
      var ratio = Math.min(2, window.devicePixelRatio || 1);
      var hadNoRoom = !w || !h;
      w = canvas.clientWidth; h = canvas.clientHeight;
      // dots made while the page had no size all sit in one corner; spread them out once it has room
      if (hadNoRoom && w && h) dots.forEach(function (d) { d.x = Math.random() * w; d.y = Math.random() * h; });
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      var want = Math.round(Math.max(18, Math.min(72, (w * h) / 22000)) * density);
      while (dots.length < want) dots.push({ x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, r: Math.random() * 1.4 + 0.6,
        c: Math.random() < 0.5 ? 0 : 1 });
      dots.length = want;
    }
    function rgba(hex, a) {
      var s = hex.replace("#", "");
      if (s.length !== 6) return "rgba(167,139,250," + a + ")";
      return "rgba(" + parseInt(s.slice(0, 2), 16) + "," + parseInt(s.slice(2, 4), 16) + "," + parseInt(s.slice(4, 6), 16) + "," + a + ")";
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      var link = 130;
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        if (!still) {
          d.x += d.vx; d.y += d.vy;
          if (d.x < -10) d.x = w + 10; if (d.x > w + 10) d.x = -10;
          if (d.y < -10) d.y = h + 10; if (d.y > h + 10) d.y = -10;
          var mx = d.x - mouse.x, my = d.y - mouse.y;
          if (mx * mx + my * my < 16000) { d.x += mx * 0.006; d.y += my * 0.006; }
        }
        for (var j = i + 1; j < dots.length; j++) {
          var e = dots[j], dx = d.x - e.x, dy = d.y - e.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < link) {
            ctx.strokeStyle = rgba(colours[d.c], (1 - dist / link) * 0.22);
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.stroke();
          }
        }
        ctx.fillStyle = rgba(colours[d.c], 0.75);
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!still && !document.hidden) requestAnimationFrame(frame); else running = false;
    }
    function go() { if (!running) { running = true; requestAnimationFrame(frame); } }

    readColours(); size();
    if (still) frame(); else go();
    addEventListener("resize", function () { size(); if (still) frame(); });
    // A page opened in a background tab starts with no size at all; measure again the moment it has one.
    if ("ResizeObserver" in window) new ResizeObserver(function () { size(); if (still) frame(); }).observe(canvas);
    addEventListener("pointermove", function (e) { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      size();
      if (still) frame(); else go();
    });
    new MutationObserver(function () { readColours(); if (still) frame(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
