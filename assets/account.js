/* The little account button that sits in the top right of every page.
   Signed out, it stays a plain "Sign in" link. Signed in, it turns into your name with a menu.
   Loaded by every page, so all of them behave the same way. */
(function () {
  var slot = document.getElementById("account");
  if (!slot) return;

  fetch("/api/me", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (out) {
      if (!out || !out.signedIn) return;          // leave the "Sign in" link alone
      build(out.user || {});
    })
    .catch(function () {});

  function build(u) {
    var shown = (u.name && u.name.trim()) ? u.name.trim() : (u.email || "You");
    var first = shown.split(" ")[0];

    var box = document.createElement("div");
    box.className = "acct";
    box.innerHTML =
      '<button class="chip" type="button" aria-haspopup="true" aria-expanded="false">' +
        '<span class="dot"></span><span class="nm"></span>' +
      '</button>' +
      '<div class="menu" hidden>' +
        '<div class="hd"></div>' +
        '<a href="/profile/">Your profile</a>' +
        '<a href="/trading/">Trading</a>' +
        '<button type="button" class="so">Sign out</button>' +
      '</div>';

    box.querySelector(".dot").textContent = first.charAt(0).toUpperCase();
    box.querySelector(".nm").textContent = first;
    box.querySelector(".hd").textContent = u.email || "";

    slot.parentNode.replaceChild(box, slot);

    var chip = box.querySelector(".chip");
    var menu = box.querySelector(".menu");

    function open(yes) {
      menu.hidden = !yes;
      chip.setAttribute("aria-expanded", yes ? "true" : "false");
    }
    chip.addEventListener("click", function (e) { e.stopPropagation(); open(menu.hidden); });
    document.addEventListener("click", function () { open(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") open(false); });
    menu.addEventListener("click", function (e) { e.stopPropagation(); });

    box.querySelector(".so").addEventListener("click", function () {
      var b = this;
      b.disabled = true;
      b.textContent = "Signing out\u2026";
      fetch("/api/logout", { method: "POST", credentials: "same-origin" })
        .then(function () { location.href = "/"; })
        .catch(function () { b.disabled = false; b.textContent = "Sign out"; });
    });
  }
})();
