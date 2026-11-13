/* Mie Cose — motore delle animazioni: transizioni, numeri che contano, gesti, coriandoli.
   Solo transform/opacity, requestAnimationFrame, rispetta "riduci movimento". */
(function () {
  "use strict";

  var mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var M = {};
  M.reduced = function () { return !!(mqReduce && mqReduce.matches); };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeOutBack(t) { var c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

  /* —— Vibrazione (iOS la ignora, Android la usa) —— */
  M.haptic = function (ms) {
    try {
      var ua = navigator.userActivation;
      if (navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(ms || 8);
    } catch (e) {}
  };

  /* —— Numeri che contano —— */
  var euroFmt = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: true });
  var dec1Fmt = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var intFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
  function fmt(kind, v) {
    if (kind === "euro") return euroFmt.format(v);
    if (kind === "dec1") return dec1Fmt.format(v);
    if (kind === "pct") return intFmt.format(Math.round(v)) + "%";
    if (kind === "hours") return dec1Fmt.format(v) + " h";
    return intFmt.format(Math.round(v));
  }
  M.fmt = fmt;
  var lastValues = Object.create(null);
  var counters = [];
  var counterRaf = 0;
  function tickCounters(now) {
    counterRaf = 0;
    var alive = [];
    for (var i = 0; i < counters.length; i++) {
      var c = counters[i];
      if (!c.el.isConnected) continue;
      if (c.start == null) c.start = now + c.delay;
      var t = clamp((now - c.start) / c.dur, 0, 1);
      var v = c.from + (c.to - c.from) * easeOutExpo(t);
      c.el.textContent = (c.prefix || "") + fmt(c.kind, t >= 1 ? c.to : v) + (c.suffix || "");
      if (t < 1) alive.push(c);
    }
    counters = alive;
    if (counters.length) counterRaf = requestAnimationFrame(tickCounters);
  }
  function runCounters(root, freshView) {
    var els = root.querySelectorAll("[data-count]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var to = Number(el.getAttribute("data-count"));
      if (!Number.isFinite(to)) continue;
      var key = el.getAttribute("data-count-key") || "k" + i;
      var kind = el.getAttribute("data-fmt") || "int";
      var prev = lastValues[key];
      lastValues[key] = to;
      var from = freshView || prev == null ? 0 : prev;
      if (M.reduced() || from === to) continue;
      counters.push({
        el: el, from: from, to: to, kind: kind, start: null,
        prefix: el.getAttribute("data-prefix") || "", suffix: el.getAttribute("data-suffix") || "",
        dur: Number(el.getAttribute("data-dur")) || (freshView ? 1100 : 650),
        delay: freshView ? Number(el.getAttribute("data-delay")) || 120 : 0
      });
      el.textContent = (el.getAttribute("data-prefix") || "") + fmt(kind, from) + (el.getAttribute("data-suffix") || "");
    }
    if (counters.length && !counterRaf) counterRaf = requestAnimationFrame(tickCounters);
  }

  /* —— Indice animato per i controlli segmentati —— */
  var segMemory = Object.create(null);
  function placeGlider(seg, animate) {
    var btns = seg.querySelectorAll("button");
    if (!btns.length) return;
    var glider = seg.querySelector(".seg-glider");
    if (!glider) {
      glider = document.createElement("span");
      glider.className = "seg-glider";
      glider.setAttribute("aria-hidden", "true");
      seg.insertBefore(glider, seg.firstChild);
      seg.classList.add("has-glider");
    }
    var idx = 0;
    for (var i = 0; i < btns.length; i++) if (btns[i].classList.contains("active")) idx = i;
    var key = seg.getAttribute("data-seg-key");
    var prev = key && segMemory[key] != null ? segMemory[key] : idx;
    if (key) segMemory[key] = idx;
    glider.style.width = "calc((100% - 6px) / " + btns.length + ")";
    if (animate && prev !== idx && !M.reduced()) {
      glider.style.transition = "none";
      glider.style.transform = "translateX(" + prev * 100 + "%)";
      void glider.offsetWidth;
      glider.style.transition = "";
    }
    glider.style.transform = "translateX(" + idx * 100 + "%)";
  }
  M.enhanceSegments = function (root) {
    var segs = (root || document).querySelectorAll(".segments");
    for (var i = 0; i < segs.length; i++) placeGlider(segs[i], true);
  };

  /* —— Barra delle schede: pillola che scorre —— */
  M.updateTabGlider = function (bounce) {
    var bar = document.getElementById("tabbar");
    if (!bar) return;
    var glider = bar.querySelector(".tab-glider");
    if (!glider) {
      glider = document.createElement("span");
      glider.className = "tab-glider";
      glider.setAttribute("aria-hidden", "true");
      bar.insertBefore(glider, bar.firstChild);
    }
    var active = bar.querySelector(".tab.active");
    if (!active) { glider.style.opacity = "0"; return; }
    glider.style.opacity = "1";
    var w = active.offsetWidth;
    var x = active.offsetLeft;
    glider.style.width = w + "px";
    glider.style.transform = "translateX(" + x + "px)";
    if (bounce && !M.reduced()) {
      active.classList.remove("bounce");
      void active.offsetWidth;
      active.classList.add("bounce");
    }
  };

  /* —— Transizione tra le pagine —— */
  M.beforePaint = function (content, info) {
    if (!info.freshView || M.reduced() || !content.firstChild) return;
    var r = content.getBoundingClientRect();
    var old = document.querySelectorAll(".content-ghost");
    for (var o = 0; o < old.length; o++) old[o].remove();
    var ghost = document.createElement("div");
    ghost.className = "content-ghost dir-" + info.dir;
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.top = r.top + "px";
    ghost.style.left = r.left + "px";
    ghost.style.width = r.width + "px";
    ghost.style.height = r.height + "px";
    var inner = document.createElement("div");
    inner.className = "content-ghost-inner";
    var cs = getComputedStyle(content);
    inner.style.padding = cs.paddingTop + " " + cs.paddingRight + " 0 " + cs.paddingLeft;
    inner.style.transform = "translateY(" + -content.scrollTop + "px)";
    while (content.firstChild) inner.appendChild(content.firstChild);
    var ids = inner.querySelectorAll("[id]");
    for (var i = 0; i < ids.length; i++) ids[i].removeAttribute("id");
    ghost.appendChild(inner);
    (document.getElementById("app") || document.body).appendChild(ghost);
    setTimeout(function () { ghost.remove(); }, 420);
  };

  M.afterPaint = function (content, info) {
    content.classList.remove("enter", "dir-fwd", "dir-back", "dir-up", "static");
    if (info.freshView) {
      content.scrollTop = 0;
      // indici per la cascata dentro liste e griglie
      var kids = content.children;
      for (var i = 0; i < kids.length; i++) kids[i].style.setProperty("--i", Math.min(i, 10));
      var rows = content.querySelectorAll(".list > *, .stats > *, .bars6 > *, .bars14 > *");
      for (var j = 0; j < rows.length; j++) {
        var idx = Array.prototype.indexOf.call(rows[j].parentNode.children, rows[j]);
        rows[j].style.setProperty("--j", Math.min(idx, 12));
      }
      void content.offsetWidth;
      content.classList.add("enter", "dir-" + info.dir);
    } else {
      content.classList.add("static");
    }
    runCounters(content, info.freshView);
    M.enhanceSegments(content);
    observeReveal(content);
    updateHeader();
  };

  /* —— Rivelazione allo scorrimento —— */
  var io = null;
  function observeReveal(root) {
    var els = root.querySelectorAll("[data-reveal]");
    if (!els.length) return;
    if (!("IntersectionObserver" in window) || M.reduced()) {
      for (var i = 0; i < els.length; i++) els[i].classList.add("revealed");
      return;
    }
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("revealed"); io.unobserve(en.target); }
        });
      }, { root: document.getElementById("content"), threshold: 0.12 });
    }
    for (var k = 0; k < els.length; k++) io.observe(els[k]);
  }

  /* —— Titolo che entra —— */
  M.swapTitle = function () {
    if (M.reduced()) return;
    var t = document.querySelector(".topbar-titles");
    if (!t) return;
    t.classList.remove("swap");
    void t.offsetWidth;
    t.classList.add("swap");
  };

  /* —— FAB che rimbalza —— */
  M.popFab = function () {
    var f = document.getElementById("fab");
    if (!f || f.classList.contains("hidden") || M.reduced()) return;
    f.classList.remove("fab-in");
    void f.offsetWidth;
    f.classList.add("fab-in");
  };

  /* —— Testata che si restringe scorrendo —— */
  var headerRaf = 0;
  function updateHeader() {
    headerRaf = 0;
    var content = document.getElementById("content");
    var top = document.getElementById("topbar");
    if (!content || !top) return;
    var p = clamp(content.scrollTop / 80, 0, 1);
    top.style.setProperty("--shrink", p.toFixed(3));
    top.classList.toggle("scrolled", p > 0.6);
    var amb = document.querySelector(".ambiance");
    if (amb && !M.reduced()) amb.style.transform = "translate3d(0," + (-Math.min(content.scrollTop, 600) * 0.08).toFixed(1) + "px,0)";
  }

  /* —— Inclinazione 3D e riflesso sulle card —— */
  var TILT_SEL = ".stat, .hero-stat, .exam-card, .phrase-card, .live-hero, .chart-card";
  var tiltEl = null;
  function tiltMove(e) {
    if (!tiltEl) return;
    var r = tiltEl.getBoundingClientRect();
    var px = clamp((e.clientX - r.left) / r.width, 0, 1);
    var py = clamp((e.clientY - r.top) / r.height, 0, 1);
    var max = r.width > 250 ? 3.5 : 7;
    tiltEl.style.transform = "perspective(700px) rotateX(" + ((0.5 - py) * max).toFixed(2) + "deg) rotateY(" + ((px - 0.5) * max).toFixed(2) + "deg) scale(0.985)";
    tiltEl.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
    tiltEl.style.setProperty("--my", (py * 100).toFixed(1) + "%");
  }
  function tiltEnd() {
    if (!tiltEl) return;
    var el = tiltEl;
    tiltEl = null;
    el.classList.remove("tilting");
    el.style.transform = "";
  }
  function tiltStart(e) {
    if (M.reduced() || e.pointerType === "mouse" && e.button !== 0) return;
    var card = e.target.closest(TILT_SEL);
    if (!card || card.closest(".arm-3d")) return;
    var inter = e.target.closest("button, input, select, textarea, a, label");
    if (inter && inter !== card) return;
    tiltEl = card;
    card.classList.add("tilting");
    tiltMove(e);
  }

  /* —— Onda al tocco sui pulsanti —— */
  var RIPPLE_SEL = ".btn-primary, .btn-secondary, .btn-danger, .action-row, .nav-btn, .text-add, .arm-btn, .switch-row, .live-next";
  function ripple(e) {
    if (M.reduced()) return;
    var b = e.target.closest(RIPPLE_SEL);
    if (!b) return;
    var r = b.getBoundingClientRect();
    var s = Math.max(r.width, r.height) * 2.2;
    var dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.width = dot.style.height = s + "px";
    dot.style.left = (e.clientX - r.left - s / 2) + "px";
    dot.style.top = (e.clientY - r.top - s / 2) + "px";
    b.appendChild(dot);
    setTimeout(function () { dot.remove(); }, 650);
  }

  /* —— Scorrimento laterale sulle righe (fatta / elimina) —— */
  var swipe = null;
  var suppressClickUntil = 0;
  M.swipeHandlers = { right: null, left: null };
  function swipeDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var wrap = e.target.closest(".swipe");
    if (!wrap || wrap.classList.contains("leaving")) return;
    var row = wrap.querySelector(".swipe-row");
    swipe = { wrap: wrap, row: row, x0: e.clientX, y0: e.clientY, dx: 0, engaged: false, armed: 0, id: e.pointerId, w: wrap.offsetWidth };
  }
  function swipeMove(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    var dx = e.clientX - swipe.x0;
    var dy = e.clientY - swipe.y0;
    if (!swipe.engaged) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      swipe.engaged = true;
      swipe.wrap.classList.add("swiping");
      try { swipe.wrap.setPointerCapture(e.pointerId); } catch (err) {}
    }
    var lim = swipe.w * 0.9;
    var eff = Math.abs(dx) > lim ? Math.sign(dx) * (lim + (Math.abs(dx) - lim) * 0.2) : dx;
    swipe.dx = eff;
    swipe.row.style.transform = "translate3d(" + eff.toFixed(1) + "px,0,0)";
    swipe.wrap.classList.toggle("to-right", eff > 0);
    swipe.wrap.classList.toggle("to-left", eff < 0);
    var armed = Math.abs(eff) > swipe.w * 0.32 ? Math.sign(eff) : 0;
    if (armed !== swipe.armed) {
      swipe.armed = armed;
      swipe.wrap.classList.toggle("armed", !!armed);
      if (armed) M.haptic(12);
    }
    swipe.wrap.style.setProperty("--swipe-p", clamp(Math.abs(eff) / (swipe.w * 0.32), 0, 1).toFixed(3));
  }
  function swipeUp(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    var s = swipe;
    swipe = null;
    if (!s.engaged) return;
    suppressClickUntil = Date.now() + 400;
    var id = s.wrap.getAttribute("data-swipe-id");
    if (s.armed) {
      var dir = s.armed > 0 ? "right" : "left";
      s.wrap.classList.add("leaving");
      s.row.style.transition = "transform 0.28s cubic-bezier(0.22,1,0.36,1)";
      s.row.style.transform = "translate3d(" + (s.armed * (s.w + 40)) + "px,0,0)";
      var rect = s.wrap.getBoundingClientRect();
      setTimeout(function () {
        var fn = M.swipeHandlers[dir];
        if (fn) fn(id, { x: dir === "right" ? rect.left + 40 : rect.right - 40, y: rect.top + rect.height / 2, wrap: s.wrap });
      }, 260);
    } else {
      s.row.style.transition = "transform 0.45s cubic-bezier(0.34,1.56,0.64,1)";
      s.row.style.transform = "";
      s.wrap.classList.remove("swiping", "to-left", "to-right", "armed");
      setTimeout(function () { s.row.style.transition = ""; }, 460);
    }
  }

  /* —— Tira giù per una nuova frase —— */
  var pull = null;
  M.pullHandler = null;
  M.canPull = function () { return false; };
  var ptrEl = null;
  function ensurePtr() {
    if (ptrEl) return ptrEl;
    ptrEl = document.createElement("div");
    ptrEl.className = "ptr";
    ptrEl.setAttribute("aria-hidden", "true");
    ptrEl.innerHTML = '<span class="ptr-dot"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 4v10M7 10l5 5 5-5"/></svg></span><span class="ptr-txt">Tira per una nuova frase</span>';
    document.body.appendChild(ptrEl);
    return ptrEl;
  }
  function pullStart(e) {
    var content = document.getElementById("content");
    if (!M.canPull() || M.reduced() || content.scrollTop > 0 || e.touches.length !== 1) return;
    if (e.target.closest(".swipe, input, select, textarea")) return;
    pull = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, d: 0, on: false, armed: false, content: content };
  }
  function pullMove(e) {
    if (!pull) return;
    var dy = e.touches[0].clientY - pull.y0;
    var dx = e.touches[0].clientX - pull.x0;
    if (!pull.on) {
      if (dy < 6 || Math.abs(dx) > dy) { if (dy < -4 || Math.abs(dx) > 12) pull = null; return; }
      if (pull.content.scrollTop > 0) { pull = null; return; }
      pull.on = true;
      ensurePtr().classList.add("show");
    }
    if (e.cancelable) e.preventDefault();
    var d = Math.min(140, dy * 0.5);
    pull.d = d;
    pull.content.style.transform = "translate3d(0," + d.toFixed(1) + "px,0)";
    var p = ensurePtr();
    p.style.setProperty("--pull", clamp(d / 70, 0, 1).toFixed(3));
    p.style.transform = "translate3d(-50%," + (d * 0.6).toFixed(1) + "px,0)";
    var armed = d > 70;
    if (armed !== pull.armed) {
      pull.armed = armed;
      p.classList.toggle("armed", armed);
      p.querySelector(".ptr-txt").textContent = armed ? "Rilascia" : "Tira per una nuova frase";
      if (armed) M.haptic(10);
    }
  }
  function pullEnd() {
    if (!pull) return;
    var pl = pull;
    pull = null;
    if (!pl.on) return;
    var p = ensurePtr();
    pl.content.style.transition = "transform 0.5s cubic-bezier(0.34,1.4,0.64,1)";
    pl.content.style.transform = "";
    p.style.transition = "transform 0.45s cubic-bezier(0.22,1,0.36,1), opacity 0.3s";
    p.style.transform = "";
    p.classList.remove("show", "armed");
    setTimeout(function () { pl.content.style.transition = ""; p.style.transition = ""; }, 520);
    if (pl.armed && M.pullHandler) M.pullHandler();
  }

  /* —— Trascina giù il foglio per chiuderlo —— */
  M.bindSheetDrag = function (root, onClose) {
    var sheet = root.querySelector(".sheet");
    if (!sheet) return;
    var head = sheet.querySelectorAll(".sheet-handle, .sheet-head");
    var st = null;
    function down(e) {
      if (e.target.closest("button")) return;
      st = { y0: e.clientY, d: 0, id: e.pointerId, t0: Date.now() };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
      sheet.style.transition = "none";
    }
    function move(e) {
      if (!st || e.pointerId !== st.id) return;
      st.d = Math.max(0, e.clientY - st.y0);
      sheet.style.transform = "translate3d(0," + st.d + "px,0)";
    }
    function up() {
      if (!st) return;
      var s = st;
      st = null;
      var fast = s.d > 40 && (Date.now() - s.t0) < 220;
      sheet.style.transition = "";
      if (s.d > 120 || fast) { M.haptic(8); onClose(); }
      else sheet.style.transform = "";
    }
    for (var i = 0; i < head.length; i++) {
      head[i].style.touchAction = "none";
      head[i].addEventListener("pointerdown", down);
      head[i].addEventListener("pointermove", move);
      head[i].addEventListener("pointerup", up);
      head[i].addEventListener("pointercancel", up);
    }
  };

  /* —— Coriandoli —— */
  var COLORS = ["#5B4DFF", "#A855F7", "#FF5A45", "#FFB020", "#12B981", "#0ABAB5", "#F43F5E", "#FDE047"];
  var confettiCanvas = null, confettiCtx = null, parts = [], confettiRaf = 0, lastT = 0;
  function ensureCanvas() {
    if (confettiCanvas) return;
    confettiCanvas = document.createElement("canvas");
    confettiCanvas.className = "confetti-canvas";
    confettiCanvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(confettiCanvas);
    confettiCtx = confettiCanvas.getContext("2d");
    sizeCanvas();
  }
  function sizeCanvas() {
    if (!confettiCanvas) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    confettiCanvas.width = Math.round(window.innerWidth * dpr);
    confettiCanvas.height = Math.round(window.innerHeight * dpr);
    confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function confettiFrame(t) {
    var dt = Math.min(0.033, (t - (lastT || t)) / 1000);
    lastT = t;
    var ctx = confettiCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    var alive = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.life += dt;
      p.vy += 900 * dt;
      p.vx *= Math.pow(0.18, dt);
      p.vy *= Math.pow(0.5, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      var a = 1 - clamp((p.life - p.ttl * 0.7) / (p.ttl * 0.3), 0, 1);
      if (p.life < p.ttl && p.y < window.innerHeight + 30) alive.push(p);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.tilt));
      ctx.fillStyle = p.c;
      if (p.shape === 0) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      else { ctx.beginPath(); ctx.arc(0, 0, p.s / 3, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    parts = alive;
    if (parts.length) confettiRaf = requestAnimationFrame(confettiFrame);
    else { confettiRaf = 0; lastT = 0; ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
  }
  M.confetti = function (x, y, opts) {
    if (M.reduced()) return;
    opts = opts || {};
    ensureCanvas();
    var n = opts.count || 70;
    var power = opts.power || 1;
    if (x == null) x = window.innerWidth / 2;
    if (y == null) y = window.innerHeight * 0.4;
    for (var i = 0; i < n; i++) {
      var ang = opts.spread === "up" ? (-Math.PI / 2 + (Math.random() - 0.5) * 1.9) : Math.random() * Math.PI * 2;
      var sp = (260 + Math.random() * 520) * power;
      parts.push({
        x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 160 * power,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, tilt: Math.random() * 6, vt: 4 + Math.random() * 8,
        s: 6 + Math.random() * 7, c: COLORS[(Math.random() * COLORS.length) | 0], shape: Math.random() < 0.72 ? 0 : 1,
        life: 0, ttl: 1.6 + Math.random() * 1.2
      });
    }
    if (parts.length > 500) parts = parts.slice(-500);
    if (!confettiRaf) confettiRaf = requestAnimationFrame(confettiFrame);
  };
  M.celebrate = function () {
    var w = window.innerWidth, h = window.innerHeight;
    M.confetti(w * 0.2, h * 0.55, { count: 70, spread: "up", power: 1.25 });
    setTimeout(function () { M.confetti(w * 0.8, h * 0.55, { count: 70, spread: "up", power: 1.25 }); }, 140);
    setTimeout(function () { M.confetti(w * 0.5, h * 0.35, { count: 90, power: 1 }); }, 300);
    M.haptic([10, 40, 18]);
  };

  /* —— Battito: un solo timer a 1 Hz per orologio e conti alla rovescia —— */
  var tickers = [];
  var tickTimer = 0;
  function beat() {
    for (var i = 0; i < tickers.length; i++) { try { tickers[i](); } catch (e) {} }
    tickTimer = setTimeout(beat, 1000 - (Date.now() % 1000) + 5);
  }
  M.onTick = function (fn) {
    tickers.push(fn);
    if (!tickTimer) beat();
  };

  /* —— Testo frase che appare parola per parola —— */
  M.wordsHtml = function (text, esc) {
    var words = String(text).split(/\s+/).filter(Boolean);
    return words.map(function (w, i) {
      return '<span class="w" style="--w:' + Math.min(i, 60) + '">' + esc(w) + "</span>";
    }).join(" ");
  };

  /* —— Apertura —— */
  function splash() {
    var s = document.getElementById("splash");
    if (!s) return;
    var seen = false;
    try { seen = sessionStorage.getItem("mie-cose-splash") === "1"; sessionStorage.setItem("mie-cose-splash", "1"); } catch (e) {}
    if (seen || M.reduced()) { s.remove(); return; }
    setTimeout(function () { s.classList.add("out"); }, 650);
    setTimeout(function () { s.remove(); }, 1250);
  }

  M.init = function () {
    var content = document.getElementById("content");
    splash();
    document.addEventListener("pointerdown", function (e) { tiltStart(e); ripple(e); swipeDown(e); }, { passive: true });
    document.addEventListener("pointermove", function (e) { tiltMove(e); swipeMove(e); }, { passive: true });
    document.addEventListener("pointerup", function (e) { tiltEnd(); swipeUp(e); }, { passive: true });
    document.addEventListener("pointercancel", function (e) { tiltEnd(); swipeUp(e); }, { passive: true });
    document.addEventListener("click", function (e) {
      if (Date.now() < suppressClickUntil && e.target.closest(".swipe")) { e.stopPropagation(); e.preventDefault(); }
      var segBtn = e.target.closest(".segments button");
      if (segBtn) setTimeout(function () { var seg = segBtn.closest(".segments"); if (seg && seg.isConnected) placeGlider(seg, false); }, 0);
    }, true);
    if (content) {
      content.addEventListener("scroll", function () { if (!headerRaf) headerRaf = requestAnimationFrame(updateHeader); }, { passive: true });
      content.addEventListener("touchstart", pullStart, { passive: true });
      content.addEventListener("touchmove", pullMove, { passive: false });
      content.addEventListener("touchend", pullEnd, { passive: true });
      content.addEventListener("touchcancel", pullEnd, { passive: true });
    }
    window.addEventListener("resize", function () { M.updateTabGlider(false); sizeCanvas(); });
    document.addEventListener("visibilitychange", function () {
      document.body.classList.toggle("paused", document.visibilityState !== "visible");
    });
  };

  window.MieMotion = M;
})();
