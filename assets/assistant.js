/* The "Ask" helper (AI-1, 30 Sep 2026): a small round button on every private page that opens a chat box.
 *
 * It only appears for the site's owner (the server checks that too - this file is just the look). It sends the
 * question to /api/assistant and shows the answer in words. The helper is READ-ONLY: it cannot press a button or change
 * anything. If it suggests a Control button, Salman taps it himself on the Control page.
 * Works on a phone (sits above the tab bar) and in both looks. Nothing is stored in the browser.
 */
(function () {
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M9 11h.01M12 11h.01M15 11h.01"/></svg>';
  var TIPS = ["How are my bots doing?", "Does anything need me?", "Which bot is best?", "How are the Bees?"];
  var root, box, log, input, sendBtn, foot, busy = false;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function add(kind, text) {
    var m = el("div", "askMsg " + kind, text);
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  function open(yes) {
    box.hidden = !yes;
    fab.setAttribute("aria-expanded", yes ? "true" : "false");
    if (yes) { setTimeout(function () { input.focus(); }, 30); }
  }

  var fab;
  function build(state) {
    root = el("div", "asker");
    fab = el("button", "askFab");
    fab.type = "button";
    fab.innerHTML = ICON + "<span>Ask</span>";
    fab.setAttribute("aria-label", "Ask the helper about your bots");
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-haspopup", "dialog");

    box = el("div", "askBox");
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Ask the helper");

    var head = el("div", "askHead");
    head.appendChild(el("b", "", "Ask about your bots"));
    var x = el("button", "", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Close the helper");
    head.appendChild(x);

    log = el("div", "askLog");
    log.setAttribute("aria-live", "polite");
    add("ai", "Hi! Ask me anything about your practice bots. I can only read the numbers. I never press buttons or trade.");

    var tips = el("div", "askTips");
    TIPS.forEach(function (t) {
      var b = el("button", "", t);
      b.type = "button";
      b.addEventListener("click", function () { ask(t); });
      tips.appendChild(b);
    });

    var form = el("form", "askForm");
    input = el("input");
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = "Type a question…";
    input.setAttribute("aria-label", "Your question");
    input.autocomplete = "off";
    sendBtn = el("button", "", "Send");
    sendBtn.type = "submit";
    form.appendChild(input);
    form.appendChild(sendBtn);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (q) ask(q);
    });

    foot = el("div", "askFoot", state && typeof state.left === "number" ? state.left + " questions left today" : "");

    box.appendChild(head);
    box.appendChild(log);
    box.appendChild(tips);
    box.appendChild(form);
    box.appendChild(foot);
    root.appendChild(box);
    root.appendChild(fab);
    document.body.appendChild(root);

    fab.addEventListener("click", function () { open(box.hidden); });
    x.addEventListener("click", function () { open(false); fab.focus(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !box.hidden) { open(false); fab.focus(); } });
  }

  function ask(q) {
    if (busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    add("me", q);
    var wait = add("ai wait", "Thinking…");
    fetch("/api/assistant", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        wait.className = "askMsg ai";
        wait.textContent = x.ok && x.j.answer ? x.j.answer : (x.j && x.j.error) || "The helper did not answer. Please try again.";
        if (x.j && typeof x.j.left === "number") foot.textContent = x.j.left + " questions left today";
      })
      .catch(function () {
        wait.className = "askMsg ai";
        wait.textContent = "Could not reach the site. Check your connection and try again.";
      })
      .then(function () {
        busy = false;
        sendBtn.disabled = false;
        log.scrollTop = log.scrollHeight;
        input.focus();
      });
  }

  function start() {
    if (/^\/(login|404)/.test(location.pathname)) return;
    fetch("/api/me", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (me) {
        if (!me || !me.signedIn) return null;
        return fetch("/api/assistant", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; });
      })
      .then(function (state) { if (state) build(state); })
      .catch(function () {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
