/* Mie Cose — app personale, tutto in locale */
(() => {
  "use strict";

  const STORAGE_KEY = "mie-cose-data-v1";
  const SOGLIA_INPS = 5000;

  const TASK_CATS = [
    { id: "lavoro", label: "Lavoro" },
    { id: "studio", label: "Studio" },
    { id: "personale", label: "Personale" },
    { id: "casa", label: "Casa" },
    { id: "braccio", label: "Braccio" },
    { id: "altro", label: "Altro" },
  ];

  const PRIORITIES = [
    { id: "alta", label: "Alta" },
    { id: "media", label: "Media" },
    { id: "bassa", label: "Bassa" },
  ];

  const EXAM_STATES = [
    { id: "da-preparare", label: "Da preparare" },
    { id: "in-corso", label: "In corso" },
    { id: "superato", label: "Superato" },
  ];

  const TX_CATS = {
    entrata: [
      { id: "commissioni", label: "Commissioni immobiliari" },
      { id: "freelance", label: "Freelance scrittura/editing" },
      { id: "altre-entrate", label: "Altre entrate" },
    ],
    uscita: [
      { id: "casa", label: "Casa" },
      { id: "cibo", label: "Cibo e spesa" },
      { id: "trasporti", label: "Trasporti" },
      { id: "studio", label: "Studio e libri" },
      { id: "braccio", label: "Braccio robotico" },
      { id: "personale", label: "Personale" },
      { id: "altro", label: "Altro" },
    ],
  };

  const MONTHS = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
  ];
  const WEEKDAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

  const moneyFmt = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: true });
  const numFmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  let data;
  let tab = "home";
  let examDetailId = null;
  let taskFilter = "aperti";
  let moneyCursor = startOfMonth(new Date());
  let freelanceYear = new Date().getFullYear();
  const TAB_ORDER = ["home", "tasks", "study", "money", "arm", "settings"];
  let lastViewKey = null;
  let lastTabIdx = 0;
  let lastPhraseShown = null;
  const MM = window.MieMotion || null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayISO() {
    return toISODate(new Date());
  }

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function parseDate(iso) {
    if (!iso) return null;
    if (iso.length === 10) {
      const parts = iso.split("-").map(Number);
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDate(iso, opts) {
    opts = opts || {};
    const d = parseDate(iso);
    if (!d) return "";
    const day = d.getDate();
    const month = MONTHS[d.getMonth()];
    const year = d.getFullYear();
    if (opts.withWeekday) {
      return WEEKDAYS[d.getDay()] + " " + day + " " + month + (opts.withYear === false ? "" : " " + year);
    }
    if (opts.short) return day + " " + month.slice(0, 3) + (opts.withYear === false ? "" : " " + year);
    return day + " " + month + " " + year;
  }

  function formatTime(iso) {
    if (!iso || iso.length <= 10) return "";
    const d = parseDate(iso);
    if (!d) return "";
    return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }

  function formatEuro(n) {
    return moneyFmt.format(Number(n) || 0);
  }

  function labelOf(list, id) {
    const item = list.find((x) => x.id === id);
    return item ? item.label : id || "";
  }

  function taskDueSortValue(task) {
    if (!task.due) return Number.MAX_SAFE_INTEGER / 2;
    if (task.due.length === 10) {
      const d = parseDate(task.due);
      return d ? d.getTime() + 24 * 60 * 60 * 1000 - 1 : Number.MAX_SAFE_INTEGER / 2;
    }
    const d = parseDate(task.due);
    return d ? d.getTime() : Number.MAX_SAFE_INTEGER / 2;
  }

  function isOverdue(task) {
    if (!task || task.done || !task.due) return false;
    if (task.due.length === 10) return task.due < todayISO();
    const d = parseDate(task.due);
    return d ? d.getTime() < Date.now() : false;
  }

  function relativeDue(iso) {
    if (!iso) return "";
    const dateOnly = iso.length === 10;
    const d = parseDate(iso);
    if (!d) return "";
    const isoDay = toISODate(d);
    const time = formatTime(iso);
    const timeBit = !dateOnly && time ? ", " + time : "";
    if (isoDay === todayISO()) return "Oggi" + timeBit;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (isoDay === toISODate(tomorrow)) return "Domani" + timeBit;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (isoDay === toISODate(yesterday)) return "Ieri" + timeBit;
    return formatDate(iso, { withWeekday: true, withYear: d.getFullYear() !== new Date().getFullYear(), short: true }) + timeBit;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return "Buongiorno";
    if (h < 18) return "Buon pomeriggio";
    return "Buonasera";
  }

  function headerDate() {
    const d = new Date();
    return WEEKDAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()];
  }

  function iconCheck() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 9.5 17 19 7"></path></svg>';
  }

  function iconChevron() {
    return '<svg class="chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"></path></svg>';
  }

  function progressRing(pct, opts) {
    opts = opts || {};
    const size = opts.size || 72;
    const stroke = opts.stroke || 7;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const off = c * (1 - p / 100);
    const cls = opts.cls ? " " + opts.cls : "";
    return '<svg class="ring' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size +
      '" style="--ring-c:' + c.toFixed(2) + ";--ring-off:" + off.toFixed(2) + '" aria-hidden="true">' +
      '<circle class="ring-track" cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" style="stroke-width:' + stroke + '"></circle>' +
      '<circle class="ring-val" cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r +
      '" style="stroke-width:' + stroke + ";stroke-dasharray:" + c.toFixed(2) + ";stroke-dashoffset:" + off.toFixed(2) + '"></circle></svg>';
  }

  function ringBlock(pct, captionStrong, captionSub, opts) {
    opts = opts || {};
    const size = opts.size || 84;
    return '<div class="ring-center">' + progressRing(pct, opts) +
      '<div class="ring-caption"><strong>' + captionStrong + "</strong>" +
      (captionSub ? "<span>" + captionSub + "</span>" : "") + "</div></div>";
  }

  function applyTheme() {
    const name = examDetailId ? "study" : tab;
    document.body.setAttribute("data-theme", name);
  }

  function viewInfo() {
    const key = examDetailId ? "exam:" + examDetailId : tab;
    const fresh = key !== lastViewKey;
    const idx = TAB_ORDER.indexOf(tab);
    let dir = "fwd";
    if (examDetailId || tab === "settings") dir = "up";
    else if (lastViewKey && (lastViewKey.indexOf("exam:") === 0 || lastViewKey === "settings")) dir = "back";
    else if (idx < lastTabIdx) dir = "back";
    return { key: key, freshView: fresh, dir: dir, idx: idx };
  }

  function paintContent(html, info) {
    if (window.MiaArm3D && window.MiaArm3D.isMounted && window.MiaArm3D.isMounted()) {
      if (data && data.arm) data.arm.joints = window.MiaArm3D.getJoints();
      window.MiaArm3D.unmount();
    }
    info = info || viewInfo();
    const el = $("#content");
    if (MM) MM.beforePaint(el, info);
    el.innerHTML = html;
    lastViewKey = info.key;
    lastTabIdx = info.idx;
    if (MM) {
      MM.afterPaint(el, info);
      if (info.freshView) { MM.swapTitle(); MM.popFab(); MM.updateTabGlider(true); }
      else MM.updateTabGlider(false);
    } else {
      el.classList.remove("enter");
      void el.offsetWidth;
      el.classList.add("enter");
    }
    liveTick();
    if (tab === "arm" && !examDetailId) mountArm3D();
  }

  function mountArm3D() {
    if (!window.MiaArm3D || !document.getElementById("arm-viewport")) return;
    window.MiaArm3D.mount(document.getElementById("arm-viewport"), {
      joints: data.arm.joints,
      poses: data.arm.poses || [],
      config: data.arm.config,
      onConfigChange: function (config) {
        data.arm.config = config;
        save();
      },
      onChange: function (joints) {
        data.arm.joints = joints;
        save();
      },
      onSavePose: function (name, joints) {
        if (!data.arm.poses) data.arm.poses = [];
        data.arm.poses.push({ id: uid(), name: name, joints: joints });
        data.arm.joints = joints;
        save();
        toast("Pose salvata");
        render();
      },
      onDeletePose: function (id) {
        data.arm.poses = (data.arm.poses || []).filter(function (p) { return p.id !== id; });
        save();
        toast("Pose eliminata");
        render();
      },
      onToast: toast,
    });
  }

  var EMPTY_ICONS = {
    calendar: '<path d="M7 4v3M17 4v3M5 9h14M6 7h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/><path d="M8 13h3M13 13h3M8 17h3"/>',
    tasks: '<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4 7.2 5.2 8.4 7.3 6"/><circle cx="5.5" cy="12" r="1.3"/><circle cx="5.5" cy="17" r="1.3"/>',
    study: '<path d="M4 6.5c2.2-1.2 4.4-1.5 8-.2 3.6-1.3 5.8-1 8 .2v11c-2.2-1.2-4.4-1.5-8-.2-3.6 1.3-5.8 1-8-.2v-11z"/><path d="M12 6.5v10.8"/>',
    money: '<rect x="3" y="6" width="18" height="13" rx="2.2"/><path d="M3 10h18"/><path d="M16 14.2c0-1 .8-1.6 1.8-1.6s1.7.6 1.7 1.5c0 2-3.5 1.1-3.5 3h3.5"/>',
    arm: '<circle cx="6" cy="19" r="2.1"/><path d="M6 16.8V11.2"/><circle cx="6" cy="10.2" r="1.3"/><path d="M7.2 9.4 12.5 6.4 16.2 11.2"/><circle cx="16.2" cy="11.2" r="1.3"/><path d="M17.3 10.5 20.6 8.4M19.2 6.8 21.8 10"/>',
    spark: '<path d="M12 3.5 13.6 8.8 19 10.5 13.6 12.2 12 17.5 10.4 12.2 5 10.5 10.4 8.8z"/>'
  };


  function emptyData() {
    return {
      version: 1,
      tasks: [],
      exams: [],
      transactions: [],
      arm: { milestones: [], parts: [], log: [], poses: [], joints: null, config: null },
      settings: { notifyPhrases: false, notifyDeadlines: false },
      phrases: { cursor: "0", favorites: [], lastNotifySlot: null, deadlineLog: {}, pinnedIndex: null, pinnedSlot: null }
    };
  }

  function normalize(raw) {
    const base = emptyData();
    if (!raw || typeof raw !== "object") return base;
    base.tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
    base.exams = Array.isArray(raw.exams) ? raw.exams : [];
    base.transactions = Array.isArray(raw.transactions) ? raw.transactions : [];
    const arm = raw.arm && typeof raw.arm === "object" ? raw.arm : {};
    base.arm.milestones = Array.isArray(arm.milestones) ? arm.milestones : Array.isArray(arm.todos) ? arm.todos : [];
    base.arm.parts = Array.isArray(arm.parts) ? arm.parts : [];
    base.arm.log = Array.isArray(arm.log) ? arm.log : [];
    base.arm.poses = Array.isArray(arm.poses) ? arm.poses : [];
    base.arm.joints = arm.joints && typeof arm.joints === "object" ? arm.joints : null;
    base.arm.config = arm.config && typeof arm.config === "object" ? arm.config : null;
    const settings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
    base.settings.notifyPhrases = !!settings.notifyPhrases;
    base.settings.notifyDeadlines = !!settings.notifyDeadlines;
    if (settings.pushSubscription && typeof settings.pushSubscription === "object") {
      base.settings.pushSubscription = settings.pushSubscription;
    }
    const ph = raw.phrases && typeof raw.phrases === "object" ? raw.phrases : {};
    base.phrases.cursor = ph.cursor != null ? String(ph.cursor) : "0";
    base.phrases.favorites = Array.isArray(ph.favorites) ? ph.favorites : [];
    base.phrases.lastNotifySlot = ph.lastNotifySlot != null ? ph.lastNotifySlot : null;
    base.phrases.deadlineLog = ph.deadlineLog && typeof ph.deadlineLog === "object" ? ph.deadlineLog : {};
    base.phrases.pinnedIndex = ph.pinnedIndex != null ? ph.pinnedIndex : null;
    base.phrases.pinnedSlot = ph.pinnedSlot != null ? ph.pinnedSlot : null;
    return base;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      data = normalize(raw ? JSON.parse(raw) : null);
    } catch (err) {
      data = emptyData();
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function isValidBackup(raw) {
    return raw && typeof raw === "object" && (Array.isArray(raw.tasks) || Array.isArray(raw.exams) || Array.isArray(raw.transactions) || (raw.arm && typeof raw.arm === "object"));
  }

  let toastTimer;
  let toastTimer2;
  function toast(msg, opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    const root = $("#toast-root");
    root.innerHTML = '<div class="toast' + (opts.action ? " has-action" : "") + (opts.tone ? " tone-" + opts.tone : "") + '"><span class="toast-msg">' + escapeHtml(msg) + "</span>" +
      (opts.action ? '<button type="button" class="toast-action">' + escapeHtml(opts.action) + "</button>" : "") + "</div>";
    clearTimeout(toastTimer);
    clearTimeout(toastTimer2);
    const el = root.firstChild;
    if (opts.action && opts.onAction) {
      el.querySelector(".toast-action").addEventListener("click", function () {
        clearTimeout(toastTimer);
        clearTimeout(toastTimer2);
        root.innerHTML = "";
        opts.onAction();
      });
    }
    toastTimer = setTimeout(function () {
      el.classList.add("out");
      toastTimer2 = setTimeout(function () { if (el.parentNode === root) root.innerHTML = ""; }, 260);
    }, opts.duration || (opts.action ? 4800 : 2400));
  }

  let sheetToken = 0;
  function closeSheet() {
    const root = $("#sheet-root");
    if (root.hidden) return;
    const token = ++sheetToken;
    if (!MM || MM.reduced() || !root.querySelector(".sheet")) {
      root.hidden = true;
      root.innerHTML = "";
      root.classList.remove("closing");
      return;
    }
    root.classList.add("closing");
    setTimeout(function () {
      if (token !== sheetToken) return;
      root.hidden = true;
      root.innerHTML = "";
      root.classList.remove("closing");
    }, 280);
  }

  function openSheet(opts) {
    const title = opts.title;
    const body = opts.body;
    const onSave = opts.onSave;
    const saveLabel = opts.saveLabel || "Salva";
    const onDelete = opts.onDelete;
    const deleteLabel = opts.deleteLabel || "Elimina";
    const root = $("#sheet-root");
    sheetToken++;
    root.classList.remove("closing");
    root.hidden = false;
    root.innerHTML =
      '<div class="sheet-backdrop" data-close-sheet></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + escapeHtml(title) + '">' +
      '<div class="sheet-handle"></div>' +
      '<div class="sheet-head">' +
      '<button type="button" class="text-btn" data-close-sheet>Annulla</button>' +
      "<h2>" + escapeHtml(title) + "</h2>" +
      '<button type="button" class="text-btn" data-sheet-save>' + escapeHtml(saveLabel) + "</button>" +
      "</div>" +
      '<div class="sheet-body">' + body +
      (onDelete ? '<button type="button" class="btn-danger" data-sheet-delete>' + escapeHtml(deleteLabel) + "</button>" : "") +
      "</div></div>";

    root.querySelector("[data-sheet-save]").addEventListener("click", function () {
      const form = root.querySelector("form");
      if (form && !form.reportValidity()) return;
      const ok = onSave(form);
      if (ok !== false) closeSheet();
    });

    if (onDelete) {
      root.querySelector("[data-sheet-delete]").addEventListener("click", function () {
        onDelete();
        closeSheet();
      });
    }

    root.querySelectorAll("[data-close-sheet]").forEach(function (el) {
      el.addEventListener("click", closeSheet);
    });
    if (MM) {
      MM.bindSheetDrag(root, closeSheet);
      MM.enhanceSegments(root);
    }

    const first = root.querySelector("input, textarea, select");
    if (first && first.type !== "date" && first.type !== "time" && first.type !== "month") {
      setTimeout(function () { first.focus(); }, 350);
    }
  }

  function formSelect(name, options, value, extra) {
    extra = extra || "";
    return '<select name="' + name + '" ' + extra + ">" + options.map(function (o) {
      return '<option value="' + escapeHtml(o.id) + '"' + (o.id === value ? " selected" : "") + ">" + escapeHtml(o.label) + "</option>";
    }).join("") + "</select>";
  }

  function setTab(next) {
    tab = next;
    examDetailId = null;
    render();
  }

  function backChevron(label) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 5l-8 7 8 7"></path></svg> ' + label;
  }

  function render() {
    $$("#tabbar .tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === (examDetailId ? "study" : tab));
    });

    const back = $("#back-btn");
    const settings = $("#settings-btn");
    const fab = $("#fab");
    const eyebrow = $("#eyebrow");
    const title = $("#title");

    back.classList.add("hidden");
    back.classList.remove("back-chevron");
    back.innerHTML = "";
    settings.classList.toggle("hidden", tab !== "home" || !!examDetailId);
    fab.classList.add("hidden");
    fab.removeAttribute("data-action");

    if (examDetailId) {
      const exam = data.exams.find(function (e) { return e.id === examDetailId; });
      back.classList.remove("hidden");
      back.classList.add("back-chevron");
      back.innerHTML = backChevron("Studio");
      eyebrow.textContent = "Esame";
      title.textContent = exam ? exam.materia : "Esame";
      fab.classList.remove("hidden");
      fab.setAttribute("aria-label", "Aggiungi sessione di studio");
      fab.dataset.action = "add-session";
      applyTheme();
      const infoD = viewInfo();
      paintContent(exam ? renderExamDetail(exam) : '<p class="empty">Esame non trovato.</p>', infoD);
      return;
    }

    const views = {
      home: { eyebrow: headerDate(), title: greeting(), render: renderHome },
      tasks: { eyebrow: "", title: "Da fare", render: renderTasks, fab: "Aggiungi cosa da fare", action: "add-task" },
      study: { eyebrow: "", title: "Studio", render: renderStudy, fab: "Aggiungi esame", action: "add-exam" },
      money: { eyebrow: "", title: "Soldi", render: renderMoney, fab: "Aggiungi movimento", action: "add-tx" },
      arm: { eyebrow: "Progetto", title: "Braccio", render: renderArm },
      settings: { eyebrow: "App", title: "Impostazioni", render: renderSettings },
    };

    const view = views[tab] || views.home;
    eyebrow.textContent = view.eyebrow;
    title.textContent = view.title;
    if (view.fab) {
      fab.classList.remove("hidden");
      fab.setAttribute("aria-label", view.fab);
      fab.dataset.action = view.action;
    }
    if (tab === "settings") {
      back.classList.remove("hidden");
      back.classList.add("back-chevron");
      back.innerHTML = backChevron("Inizio");
    }

    applyTheme();
    const info = viewInfo();
    paintContent(view.render(), info);
    bindDynamic();
  }

  function bindDynamic() {
    const yearSel = $("#freelance-year");
    if (yearSel) {
      yearSel.addEventListener("change", function (e) {
        freelanceYear = Number(e.target.value);
        render();
      });
    }
  }

  function emptyState(title, text, kind) {
    const icon = EMPTY_ICONS[kind] || EMPTY_ICONS.spark;
    return '<div class="empty card"><div class="art"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      icon + "</svg></div><h3>" + escapeHtml(title) + "</h3><p>" + escapeHtml(text) + "</p></div>";
  }

  function countSpan(value, kind, key, text, cls) {
    const v = Number(value) || 0;
    return '<span class="num' + (cls ? " " + cls : "") + '" data-count="' + v + '" data-fmt="' + kind + '" data-count-key="' + key + '">' + text + "</span>";
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  function countdownText(ms) {
    if (ms <= 0) return "adesso";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return (d ? d + "g " : "") + pad2(h) + ":" + pad2(m) + ":" + pad2(sec);
  }

  function nextDeadline() {
    const now = Date.now();
    const cands = [];
    data.tasks.forEach(function (t) {
      if (t.done || !t.due) return;
      const at = taskDueSortValue(t);
      if (at > now) cands.push({ kind: "task", id: t.id, title: t.title, at: at, label: "Scade tra" });
    });
    data.exams.forEach(function (e) {
      if (e.stato === "superato" || !e.dataAppello) return;
      const d = parseDate(e.dataAppello);
      if (!d) return;
      const at = d.getTime();
      if (at > now) cands.push({ kind: "exam", id: e.id, title: e.materia, at: at, label: "Appello tra" });
    });
    cands.sort(function (a, b) { return a.at - b.at; });
    return cands[0] || null;
  }

  function dayProgress() {
    const n = new Date();
    return (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400;
  }

  function liveHeroHtml(overdue) {
    const n = new Date();
    const next = nextDeadline();
    const dp = dayProgress();
    const nextHtml = next
      ? '<button type="button" class="live-next pressable" data-open="' + next.kind + '" data-id="' + next.id + '">' +
        '<span class="live-next-ico ' + next.kind + '" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        (next.kind === "exam" ? EMPTY_ICONS.study : EMPTY_ICONS.calendar) + "</svg></span>" +
        '<span class="live-next-copy"><span class="live-next-lab">' + next.label + "</span>" +
        '<span class="live-next-title">' + escapeHtml(next.title) + "</span></span>" +
        '<span class="live-cd" data-countdown="' + next.at + '">' + countdownText(next.at - Date.now()) + "</span></button>"
      : '<div class="live-next calm"><span class="live-next-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        EMPTY_ICONS.spark + '</svg></span><span class="live-next-copy"><span class="live-next-lab">Tutto sotto controllo</span><span class="live-next-title">Nessuna scadenza in arrivo</span></span></div>';
    return '<section class="live-hero" aria-label="Adesso">' +
      '<div class="live-top"><div class="live-clock" aria-live="off"><span data-live-hm>' + pad2(n.getHours()) + ":" + pad2(n.getMinutes()) + "</span>" +
      '<span class="live-sec" data-live-sec>' + pad2(n.getSeconds()) + "</span></div>" +
      (overdue ? '<span class="live-alert"><i></i>' + overdue + " in ritardo</span>" : '<span class="live-ok"><i></i>In orario</span>') + "</div>" +
      '<div class="live-day"><span class="live-day-lab">Giornata</span><div class="live-day-bar"><span data-day-bar style="transform:scaleX(' + dp.toFixed(4) + ')"></span></div>' +
      '<span class="live-day-pct" data-day-pct>' + Math.round(dp * 100) + "%</span></div>" +
      nextHtml + "</section>";
  }

  function liveTick() {
    const root = document.getElementById("content");
    if (!root) return;
    const n = new Date();
    const hm = root.querySelector("[data-live-hm]");
    if (hm) {
      hm.textContent = pad2(n.getHours()) + ":" + pad2(n.getMinutes());
      const sec = root.querySelector("[data-live-sec]");
      if (sec) sec.textContent = pad2(n.getSeconds());
      const dp = dayProgress();
      const bar = root.querySelector("[data-day-bar]");
      if (bar) bar.style.transform = "scaleX(" + dp.toFixed(4) + ")";
      const pct = root.querySelector("[data-day-pct]");
      if (pct) pct.textContent = Math.round(dp * 100) + "%";
    }
    root.querySelectorAll("[data-countdown]").forEach(function (el) {
      el.textContent = countdownText(Number(el.getAttribute("data-countdown")) - Date.now());
    });
    const left = root.querySelector("[data-slot-left]");
    if (left) {
      const ms = SLOT_MS - (Date.now() % SLOT_MS);
      left.textContent = pad2(Math.floor(ms / 60000)) + ":" + pad2(Math.floor((ms % 60000) / 1000));
      const sb = root.querySelector("[data-slot-bar]");
      if (sb) sb.style.transform = "scaleX(" + (1 - ms / SLOT_MS).toFixed(4) + ")";
    }
  }

  function daysUntil(iso) {
    const d = parseDate(iso);
    if (!d) return null;
    const t = new Date();
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  }

  function upcomingItems() {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 21);
    const horizonISO = toISODate(horizon);
    const items = [];

    data.tasks.filter(function (t) { return !t.done && t.due; }).forEach(function (t) {
      const day = t.due.slice(0, 10);
      if (day <= horizonISO) {
        items.push({ type: "task", id: t.id, title: t.title, when: t.due, overdue: isOverdue(t), meta: labelOf(TASK_CATS, t.category) });
      }
    });

    data.exams.filter(function (e) { return e.stato !== "superato" && e.dataAppello; }).forEach(function (e) {
      if (e.dataAppello <= horizonISO || e.dataAppello < todayISO()) {
        items.push({ type: "exam", id: e.id, title: e.materia, when: e.dataAppello, overdue: e.dataAppello < todayISO(), meta: "Appello" });
      }
    });

    items.sort(function (a, b) { return String(a.when).localeCompare(String(b.when)); });
    return items.slice(0, 8);
  }


  const SLOT_MS = 30 * 60 * 1000;
  let slotTimer = 0;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
  }

  function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function currentSlot() {
    return Math.floor(Date.now() / SLOT_MS);
  }

  function minutesToNextSlot() {
    return Math.ceil((SLOT_MS - (Date.now() % SLOT_MS)) / 60000);
  }

  function displayedPhrase() {
    if (!window.MiaFrasi) return null;
    const slot = currentSlot();
    const ph = data.phrases;
    if (ph.pinnedIndex != null && Number(ph.pinnedSlot) === slot) {
      const p = window.MiaFrasi.phraseAt(ph.pinnedIndex);
      return p;
    }
    return window.MiaFrasi.phraseForSlot(slot);
  }

  function isFavorite(n) {
    return (data.phrases.favorites || []).some(function (f) { return Number(f.n) === Number(n); });
  }

  function toggleFavorite(phrase) {
    if (!phrase) return;
    if (isFavorite(phrase.n)) {
      data.phrases.favorites = data.phrases.favorites.filter(function (f) { return Number(f.n) !== Number(phrase.n); });
      save();
      toast("Tolta dai preferiti");
    } else {
      data.phrases.favorites.unshift({
        v: phrase.v || 1,
        n: phrase.n,
        text: phrase.text,
        theme: phrase.theme,
        addedAt: new Date().toISOString()
      });
      save();
      toast("Aggiunta ai preferiti");
    }
  }

  function drawNextPhrase() {
    if (!window.MiaFrasi) return;
    let k = Number(data.phrases.cursor || 0);
    if (!Number.isFinite(k) || k < 0) k = 0;
    const moment = displayedPhrase();
    let p = window.MiaFrasi.streamAt(k);
    let guard = 0;
    while (moment && p.n === moment.n && guard < 5) {
      k += 1;
      p = window.MiaFrasi.streamAt(k);
      guard += 1;
    }
    data.phrases.cursor = String(k + 1);
    data.phrases.pinnedIndex = p.n;
    data.phrases.pinnedSlot = currentSlot();
    save();
    toast("Nuova frase");
  }

  function sharePhrase(text) {
    const payload = { title: "Mie Cose", text: text + "\n— Mie Cose" };
    if (navigator.share) {
      navigator.share(payload).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload.text).then(function () { toast("Frase copiata"); }).catch(function () {
        toast("Impossibile condividere");
      });
      return;
    }
    toast("Copia la frase e incollala dove vuoi");
  }

  function phraseCardHtml() {
    const p = displayedPhrase();
    if (!p) return "";
    const tot = window.MiaFrasi.formatTotal();
    const mins = minutesToNextSlot();
    const fav = isFavorite(p.n);
    const favs = data.phrases.favorites || [];
    const favHtml = favs.length
      ? '<div class="phrase-favs"><h2 class="section-title">Frasi preferite</h2><div class="list">' +
        favs.map(function (f) {
          return '<div class="row fav-row"><div class="row-body"><span class="row-title">' + escapeHtml(f.text) +
            "</span></div>" +
            '<button type="button" class="icon-btn" data-action="phrase-unfav" data-n="' + f.n +
            '" aria-label="Togli dai preferiti">×</button></div>';
        }).join("") + "</div></div>"
      : "";
    const reveal = lastPhraseShown !== p.n || lastViewKey !== "home";
    lastPhraseShown = p.n;
    const slotMs = SLOT_MS - (Date.now() % SLOT_MS);
    return '<section class="phrase-card' + (reveal ? " reveal" : "") + '" id="frase-momento">' +
      '<div class="phrase-head"><img src="logo.svg" width="28" height="28" alt="">' +
      '<div class="copy"><p class="label">Frase del momento</p>' +
      '<span class="pill">' + escapeHtml(p.themeLabel || "Vita") + "</span></div></div>" +
      '<blockquote class="phrase-text" aria-label="' + escapeHtml(p.text) + '">' + (MM ? MM.wordsHtml(p.text, escapeHtml) : escapeHtml(p.text)) + "</blockquote>" +
      '<div class="slot-timer" title="Prossima frase tra ' + mins + ' min"><span class="slot-lab">Prossima frase</span><div class="slot-bar"><span data-slot-bar style="transform:scaleX(' + (1 - slotMs / SLOT_MS).toFixed(4) + ')"></span></div>' +
      '<span class="slot-left" data-slot-left>' + pad2(Math.floor(slotMs / 60000)) + ":" + pad2(Math.floor((slotMs % 60000) / 1000)) + "</span></div>" +
      '<p class="phrase-meta">Una tra ' + escapeHtml(tot.human) + " di frasi possibili (" +
      escapeHtml(tot.exact) + "). Si rinnova ogni 30 minuti. Tira giù la pagina per cambiarla.</p>" +
      '<div class="phrase-actions">' +
      '<button type="button" class="btn-primary" data-action="phrase-new">Nuova</button>' +
      '<button type="button" class="btn-secondary" data-action="phrase-fav" aria-pressed="' + (fav ? "true" : "false") + '">' +
      (fav ? "Preferita" : "Preferiti") + "</button>" +
      '<button type="button" class="btn-secondary" data-action="phrase-share">Condividi</button></div>' +
      favHtml + "</section>";
  }

  function vapidPublicKey() {
    return String(window.MIE_COSE_VAPID_PUBLIC_KEY || "").trim();
  }

  function urlBase64ToUint8Array(base64String) {
    const pad = "=".repeat((4 - base64String.length % 4) % 4);
    const b64 = (base64String + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function requestNotifyPermission() {
    if (!("Notification" in window)) {
      toast("Questo dispositivo non supporta le notifiche.");
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      toast("Le notifiche sono bloccate nelle impostazioni del telefono.");
      return false;
    }
    try {
      const r = await Notification.requestPermission();
      return r === "granted";
    } catch (err) {
      toast("Impossibile chiedere il permesso per le notifiche.");
      return false;
    }
  }

  async function showLocalNotification(title, body, tag, data) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = {
      body: body,
      icon: "./icons/icon-192.png",
      badge: "./icons/favicon.png",
      lang: "it",
      tag: tag || "mie-cose",
      renotify: !!tag,
      data: data || { url: "./" }
    };
    try {
      if (navigator.serviceWorker) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, opts);
        return;
      }
    } catch (err) {}
    try { new Notification(title, opts); } catch (err) {}
  }

  async function maybeNotifyPhrase() {
    if (!data.settings.notifyPhrases) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const slot = currentSlot();
    if (data.phrases.lastNotifySlot === slot) return;
    const p = window.MiaFrasi ? window.MiaFrasi.phraseForSlot(slot) : null;
    data.phrases.lastNotifySlot = slot;
    save();
    await showLocalNotification("Frase del momento", p ? p.text : "Hai una nuova frase in Mie Cose.", "frase-momento");
  }

  async function maybeNotifyDeadlines() {
    if (!data.settings.notifyDeadlines) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const today = todayISO();
    const log = data.phrases.deadlineLog || {};
    const items = [];
    data.tasks.forEach(function (t) {
      if (t.done || !t.due) return;
      const day = String(t.due).slice(0, 10);
      if (day > today && !isOverdue(t)) return;
      if (day > today) return;
      const key = "task-" + t.id + "-" + today;
      if (log[key]) return;
      items.push({ key: key, title: "Scadenza", body: t.title + (isOverdue(t) ? " · in ritardo" : " · oggi") });
    });
    const limit = new Date();
    limit.setDate(limit.getDate() + 3);
    const limitISO = toISODate(limit);
    data.exams.forEach(function (e) {
      if (e.stato === "superato" || !e.dataAppello) return;
      const day = String(e.dataAppello).slice(0, 10);
      if (day < today || day > limitISO) return;
      const key = "exam-" + e.id + "-" + today;
      if (log[key]) return;
      items.push({ key: key, title: "Appello", body: e.materia + " · " + relativeDue(e.dataAppello) });
    });
    if (!items.length) return;
    items.slice(0, 3).forEach(function (it) { log[it.key] = true; });
    data.phrases.deadlineLog = log;
    save();
    for (let i = 0; i < Math.min(3, items.length); i++) {
      await showLocalNotification(items[i].title, items[i].body, items[i].key);
    }
  }

  function armSlotTimer() {
    clearTimeout(slotTimer);
    const wait = (SLOT_MS - (Date.now() % SLOT_MS)) + 400;
    slotTimer = setTimeout(function () {
      onSlotBoundary();
      armSlotTimer();
    }, wait);
  }

  function onSlotBoundary() {
    maybeNotifyPhrase();
    maybeNotifyDeadlines();
    if (tab === "home" && !examDetailId) render();
  }

  async function toggleNotifySetting(which) {
    const turningOn = !data.settings[which];
    if (turningOn) {
      if (isIOSDevice() && !isStandalone()) {
        toast("Su iPhone: prima aggiungi l’app alla schermata Home, poi riapri Mie Cose e attiva le notifiche.");
        return;
      }
      const ok = await requestNotifyPermission();
      if (!ok) return;
    }
    data.settings[which] = turningOn;
    save();
    if (turningOn) {
      if (which === "notifyPhrases") maybeNotifyPhrase();
      if (which === "notifyDeadlines") maybeNotifyDeadlines();
      toast("Notifiche attivate");
    } else {
      toast("Notifiche disattivate");
    }
    render();
  }

  async function subscribePushIfConfigured() {
    const key = vapidPublicKey();
    if (!key) {
      toast("Nessuna chiave VAPID configurata. Serve un server push, vedi PUSH.md.");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast("Il push non è disponibile su questo dispositivo.");
      return;
    }
    const ok = await requestNotifyPermission();
    if (!ok) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
      data.settings.pushSubscription = sub.toJSON();
      save();
      toast("Iscrizione push salvata su questo telefono. Per completarla serve il server descritto in PUSH.md.");
      render();
    } catch (err) {
      toast("Iscrizione push non riuscita.");
    }
  }

  function renderHome() {
    const openTasks = data.tasks.filter(function (t) { return !t.done; });
    const overdue = openTasks.filter(isOverdue).length;
    const todayTasks = openTasks.filter(function (t) { return t.due && t.due.slice(0, 10) === todayISO(); }).length;
    const nextExam = data.exams
      .filter(function (e) { return e.stato !== "superato" && e.dataAppello; })
      .sort(function (a, b) { return a.dataAppello.localeCompare(b.dataAppello); })[0];
    const now = new Date();
    const monthPrefix = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const monthTx = data.transactions.filter(function (t) { return t.date && t.date.startsWith(monthPrefix); });
    const monthIn = sumBy(monthTx, function (t) { return t.type === "entrata"; });
    const monthOut = sumBy(monthTx, function (t) { return t.type === "uscita"; });
    const monthBal = monthIn - monthOut;
    const doneMs = data.arm.milestones.filter(function (m) { return m.done; }).length;
    const totalMs = data.arm.milestones.length;
    const upcoming = upcomingItems();
    const examSub = nextExam
      ? escapeHtml(nextExam.materia) + " · " + escapeHtml(relativeDue(nextExam.dataAppello))
      : "Nessun appello in programma";
    const taskSub = overdue
      ? '<span class="danger">' + overdue + " in ritardo</span>"
      : (todayTasks ? todayTasks + " per oggi" : "Niente in ritardo");

    const upcomingHtml = upcoming.length
      ? '<div class="list">' + upcoming.map(function (it) {
          return '<button type="button" class="row pressable" data-open="' + it.type + '" data-id="' + it.id + '">' +
            '<div class="row-body"><span class="row-title">' + escapeHtml(it.title) + '</span>' +
            '<div class="row-meta"><span class="pill ' + (it.overdue ? "overdue" : "") + '">' +
            (it.overdue ? "In ritardo · " : "") + escapeHtml(relativeDue(it.when)) +
            '</span><span class="pill">' + escapeHtml(it.meta) + "</span></div></div>" +
            iconChevron() + "</button>";
        }).join("") + "</div>"
      : emptyState("Nessuna scadenza vicina", "Le cose da fare e gli appelli dei prossimi 21 giorni appariranno qui.", "calendar");

    const doneTasks = data.tasks.filter(function (t) { return t.done; }).length;
    const allTasks = data.tasks.length;
    const taskPct = allTasks ? (doneTasks / allTasks) * 100 : 0;
    const armPct = totalMs ? (doneMs / totalMs) * 100 : 0;
    const monthMax = Math.max(monthIn, monthOut, 1);
    const inBar = Math.round((monthIn / monthMax) * 100);
    const outBar = Math.round((monthOut / monthMax) * 100);

    const examDays = nextExam ? daysUntil(nextExam.dataAppello) : null;
    return liveHeroHtml(overdue) + phraseCardHtml() +
      '<div class="stats">' +
      '<div class="stat tint-tasks"><div class="stat-row"><div class="copy"><p class="label">Da fare</p><div class="value">' + countSpan(openTasks.length, "int", "home-open", String(openTasks.length)) +
      '</div><div class="sub">' + taskSub + '</div></div>' + progressRing(taskPct, { size: 56, stroke: 6, cls: "tasks" }) + "</div></div>" +
      '<div class="stat tint-study"><p class="label">Prossimo esame</p><div class="value" style="font-size:18px;padding-top:4px">' +
      (nextExam ? (examDays != null && examDays > 1 ? "tra " + countSpan(examDays, "int", "home-exam-days", String(examDays)) + " giorni" : escapeHtml(relativeDue(nextExam.dataAppello) || "—")) : "—") +
      '</div><div class="sub">' + examSub + "</div></div>" +
      '<div class="stat tint-money"><p class="label">Questo mese</p><div class="value amount ' + (monthBal >= 0 ? "pos" : "neg") + '">' +
      countSpan(monthBal, "euro", "home-bal", formatEuro(monthBal)) + '</div><div class="mini-bars" style="margin-top:8px">' +
      '<div class="mini-bar"><span class="lbl">In</span><div class="track"><span style="width:' + inBar + '%"></span></div></div>' +
      '<div class="mini-bar"><span class="lbl">Out</span><div class="track out"><span style="width:' + outBar + '%"></span></div></div>' +
      "</div></div>" +
      '<div class="stat tint-arm"><div class="stat-row"><div class="copy"><p class="label">Braccio</p><div class="value">' +
      (totalMs ? doneMs + "/" + totalMs : "—") + '</div><div class="sub">' +
      (totalMs ? "Tappe completate" : "Nessuna tappa ancora") + "</div></div>" +
      progressRing(armPct, { size: 56, stroke: 6, cls: "arm" }) + "</div></div></div>" +
      '<h2 class="section-title">Prossime scadenze</h2>' + upcomingHtml +
      '<h2 class="section-title">Backup</h2>' +
      '<div class="list"><button type="button" class="action-row" data-action="goto-settings">' +
      '<div class="left"><span>Impostazioni e copie di sicurezza</span>' +
      "<span>Esporta, importa o carica dati di esempio</span></div>" + iconChevron() +
      "</button></div>" +
      '<p class="hint install-hint" style="margin-top:18px">Su iPhone, apri questa pagina in Safari, tocca il pulsante Condividi e scegli <strong>Aggiungi alla schermata Home</strong>. L\'app si aprirà a tutto schermo, anche senza connessione.</p>';
  }

  function renderTasks() {
    let tasks = data.tasks.slice();
    const today = todayISO();
    if (taskFilter === "aperti") tasks = tasks.filter(function (t) { return !t.done; });
    else if (taskFilter === "oggi") tasks = tasks.filter(function (t) { return !t.done && t.due && t.due.slice(0, 10) === today; });
    else if (taskFilter === "ritardo") tasks = tasks.filter(isOverdue);
    else if (taskFilter === "completati") tasks = tasks.filter(function (t) { return t.done; });

    tasks.sort(function (a, b) {
      if (taskFilter !== "completati" && a.done !== b.done) return a.done ? 1 : -1;
      return taskDueSortValue(a) - taskDueSortValue(b);
    });

    const filters = [["aperti", "Aperti"], ["oggi", "Oggi"], ["ritardo", "In ritardo"], ["completati", "Fatti"]];
    const segs = '<div class="segments" role="tablist" data-seg-key="task-filter">' + filters.map(function (f) {
      return '<button type="button" role="tab" class="' + (taskFilter === f[0] ? "active" : "") + '" data-task-filter="' + f[0] + '">' + f[1] + "</button>";
    }).join("") + "</div>";

    const list = tasks.length
      ? '<div class="list">' + tasks.map(taskRow).join("") + "</div>"
      : emptyState(taskFilter === "completati" ? "Nessun completato" : "Niente da fare qui", "Tocca + per aggiungere una cosa da fare, con data, priorità e categoria.", "tasks");

    const allT = data.tasks.length;
    const doneT = data.tasks.filter(function (x) { return x.done; }).length;
    const pctT = allT ? (doneT / allT) * 100 : 0;
    const head = '<div class="task-head"><div class="task-head-copy"><span class="task-head-big">' + countSpan(doneT, "int", "tasks-done", String(doneT)) +
      '<small>/' + allT + '</small></span><span class="task-head-lab">completate</span></div>' +
      '<div class="task-progress"><span style="transform:scaleX(' + (pctT / 100).toFixed(4) + ')"></span></div>' +
      '<span class="task-head-pct">' + countSpan(pctT, "pct", "tasks-pct", Math.round(pctT) + "%") + "</span></div>";
    const tip = tasks.length && taskFilter !== "completati" ? '<p class="hint swipe-hint">Scorri una riga a destra per completarla, a sinistra per eliminarla.</p>' : "";
    return head + segs + list + tip;
  }

  function taskRow(t) {
    const overdue = isOverdue(t);
    return '<div class="swipe" data-swipe-id="' + t.id + '">' +
      '<div class="swipe-bg" aria-hidden="true"><span class="sw-right">' + iconCheck() + (t.done ? " Riapri" : " Fatta") + '</span>' +
      '<span class="sw-left">Elimina <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></span></div>' +
      '<div class="row swipe-row prio-' + escapeHtml(t.priority || "media") + '" data-task-id="' + t.id + '">' +
      '<button type="button" class="check ' + (t.done ? "on" : "") + '" data-toggle-task="' + t.id +
      '" aria-label="' + (t.done ? "Segna come da fare" : "Segna come fatta") + '">' + iconCheck() + "</button>" +
      '<button type="button" class="row-body pressable" data-edit-task="' + t.id + '" style="background:transparent;padding:0;text-align:left">' +
      '<span class="row-title ' + (t.done ? "done" : "") + '">' + escapeHtml(t.title) + "</span>" +
      '<div class="row-meta">' +
      (t.due
        ? '<span class="pill ' + (overdue ? "overdue" : "") + '">' + (overdue ? "In ritardo · " : "") + escapeHtml(relativeDue(t.due)) + "</span>"
        : '<span class="pill">Senza data</span>') +
      (t.priority ? '<span class="pill ' + t.priority + '">' + escapeHtml(labelOf(PRIORITIES, t.priority)) + "</span>" : "") +
      (t.category ? '<span class="pill">' + escapeHtml(labelOf(TASK_CATS, t.category)) + "</span>" : "") +
      "</div></button></div></div>";
  }

  function openTaskForm(id) {
    const t = id ? data.tasks.find(function (x) { return x.id === id; }) : null;
    const dueDate = t && t.due ? t.due.slice(0, 10) : "";
    const dueTime = t && t.due && t.due.length > 10 ? t.due.slice(11, 16) : "";
    openSheet({
      title: t ? "Modifica attività" : "Nuova attività",
      onDelete: t ? function () {
        data.tasks = data.tasks.filter(function (x) { return x.id !== t.id; });
        save();
        toast("Attività eliminata");
        render();
      } : null,
      body: "<form>" +
        '<div class="field"><label for="task-title">Titolo</label>' +
        '<input id="task-title" name="title" type="text" required maxlength="200" placeholder="Cosa devi fare?" value="' + escapeHtml(t ? t.title : "") + '"></div>' +
        '<div class="field-row"><div class="field"><label for="task-date">Data</label>' +
        '<input id="task-date" name="dueDate" type="date" value="' + escapeHtml(dueDate) + '"></div>' +
        '<div class="field"><label for="task-time">Ora (facoltativa)</label>' +
        '<input id="task-time" name="dueTime" type="time" value="' + escapeHtml(dueTime) + '"></div></div>' +
        '<div class="field"><label for="task-priority">Priorità</label>' +
        formSelect("priority", PRIORITIES, t ? t.priority : "media", 'id="task-priority"') + "</div>" +
        '<div class="field"><label for="task-cat">Categoria</label>' +
        formSelect("category", TASK_CATS, t ? t.category : "altro", 'id="task-cat"') + "</div>" +
        '<div class="field"><label for="task-notes">Note</label>' +
        '<textarea id="task-notes" name="notes" maxlength="2000" placeholder="Dettagli, luogo, riferimenti…">' +
        escapeHtml(t ? t.notes || "" : "") + "</textarea></div></form>",
      onSave: function (form) {
        const fd = new FormData(form);
        const title = String(fd.get("title") || "").trim();
        if (!title) return false;
        const dueDateVal = String(fd.get("dueDate") || "");
        const dueTimeVal = String(fd.get("dueTime") || "");
        let due = "";
        if (dueDateVal && dueTimeVal) due = dueDateVal + "T" + dueTimeVal;
        else if (dueDateVal) due = dueDateVal;
        const payload = {
          title: title,
          due: due,
          priority: String(fd.get("priority") || "media"),
          category: String(fd.get("category") || "altro"),
          notes: String(fd.get("notes") || "").trim(),
        };
        if (t) Object.assign(t, payload);
        else data.tasks.push(Object.assign({ id: uid(), done: false, createdAt: new Date().toISOString() }, payload));
        save();
        toast(t ? "Attività aggiornata" : "Attività aggiunta");
        render();
      },
    });
  }

  function isFiniteNumber(n) {
    return typeof n === "number" && Number.isFinite(n);
  }

  function passedExams() {
    return data.exams.filter(function (e) { return e.stato === "superato" && isFiniteNumber(e.voto); });
  }

  function mediaPonderata() {
    const passed = passedExams();
    const cfu = passed.reduce(function (s, e) { return s + (Number(e.cfu) || 0); }, 0);
    if (!cfu) return null;
    const weighted = passed.reduce(function (s, e) { return s + Number(e.voto) * (Number(e.cfu) || 0); }, 0);
    return weighted / cfu;
  }

  function cfuTotals() {
    const previsti = data.exams.reduce(function (s, e) { return s + (Number(e.cfu) || 0); }, 0);
    const acquisiti = data.exams.filter(function (e) { return e.stato === "superato"; }).reduce(function (s, e) { return s + (Number(e.cfu) || 0); }, 0);
    return { previsti: previsti, acquisiti: acquisiti };
  }

  function sessionMinutes(exam) {
    return (exam.sessions || []).reduce(function (s, x) { return s + (Number(x.minutes) || 0); }, 0);
  }

  function formatHours(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (!h) return m + " min";
    if (!m) return h + " h";
    return h + " h " + m + " min";
  }

  function renderStudy() {
    const media = mediaPonderata();
    const totals = cfuTotals();
    const exams = data.exams.slice().sort(function (a, b) {
      const order = { "in-corso": 0, "da-preparare": 1, superato: 2 };
      const d = (order[a.stato] ?? 9) - (order[b.stato] ?? 9);
      if (d) return d;
      return String(a.dataAppello || "9999").localeCompare(String(b.dataAppello || "9999"));
    });
    const mediaLabel = media == null ? "—" : numFmt.format(Math.round(media * 10) / 10);
    const pct = totals.previsti ? Math.min(100, (totals.acquisiti / totals.previsti) * 100) : 0;
    const list = exams.length ? exams.map(examCard).join("") : emptyState("Nessun esame", "Aggiungi le materie con data d’appello, CFU e stato. Potrai annotare le sessioni di studio.", "study");

    const mediaVal = media == null ? null : Math.round(media * 10) / 10;
    return '<div class="hero-stat hero-split"><div class="hero-copy"><p class="label">Media ponderata</p><div class="value">' +
      (mediaVal == null ? mediaLabel : countSpan(mediaVal, "dec1", "study-media", mediaLabel)) + "</div>" +
      '<div class="row-meta" style="margin-top:8px"><span>' + countSpan(totals.acquisiti, "int", "study-cfu", String(totals.acquisiti)) + " CFU acquisiti · " + totals.previsti + " CFU previsti</span></div>" +
      '<p class="hint" style="margin:10px 0 0">La media è calcolata sugli esami superati con voto. Se hai 30 e lode, la lode è conteggiata come 30 (alcuni atenei usano 31 o 32).</p></div>' +
      ringBlock(pct, totals.previsti ? countSpan(pct, "pct", "study-pct", Math.round(pct) + "%") : "—", "CFU", { size: 96, stroke: 8, cls: "study" }) +
      "</div>" + studyChartHtml() +
      '<h2 class="section-title">Esami</h2>' + list;
  }

  function studyChartHtml() {
    const days = 14;
    const perDay = {};
    data.exams.forEach(function (e) {
      (e.sessions || []).forEach(function (x) {
        if (!x.date) return;
        perDay[x.date] = (perDay[x.date] || 0) + (Number(x.minutes) || 0);
      });
    });
    const cols = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = toISODate(d);
      cols.push({ iso: iso, min: perDay[iso] || 0, wd: WEEKDAYS[d.getDay()].slice(0, 1).toUpperCase(), today: i === 0 });
    }
    const max = Math.max(60, Math.max.apply(null, cols.map(function (c) { return c.min; })));
    const totalMin = cols.reduce(function (a, c) { return a + c.min; }, 0);
    const week = cols.slice(-7).reduce(function (a, c) { return a + c.min; }, 0);
    let streak = 0;
    for (let i = cols.length - 1; i >= 0; i--) {
      if (cols[i].min > 0) streak++;
      else if (i === cols.length - 1) continue;
      else break;
    }
    const bars = cols.map(function (c, i) {
      const h = c.min ? Math.max(0.06, c.min / max) : 0.02;
      return '<div class="bcol14' + (c.today ? " today" : "") + (c.min ? " has" : "") + '" style="--k:' + i + '" title="' + escapeHtml(formatDate(c.iso, { short: true })) + ": " + formatHours(c.min) + '">' +
        '<div class="b14wrap"><span class="b14" style="height:' + (h * 100).toFixed(1) + '%"></span></div><span class="bl">' + c.wd + "</span></div>";
    }).join("");
    return '<section class="card chart-card" data-reveal>' +
      '<div class="chart-head"><h3>Studio, ultimi 14 giorni</h3>' +
      '<span class="streak' + (streak ? " on" : "") + '"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2c1 3.5-1.5 5-1.5 7.5 0 1.4 1 2.5 2.3 2.5 1.7 0 2.7-1.5 2.2-3.6C17.8 10.3 19 13 19 15a7 7 0 1 1-14 0c0-4.4 4-6.9 7-13z"/></svg>' +
      countSpan(streak, "int", "study-streak", String(streak)) + (streak === 1 ? " giorno" : " giorni") + "</span></div>" +
      '<div class="chart-kpis"><div><span class="kpi">' + countSpan(week / 60, "hours", "study-week", numFmt.format(Math.round(week / 6) / 10) + " h") + '</span><span class="kpi-lab">questa settimana</span></div>' +
      '<div><span class="kpi">' + countSpan(totalMin / 60, "hours", "study-14", numFmt.format(Math.round(totalMin / 6) / 10) + " h") + '</span><span class="kpi-lab">in 14 giorni</span></div></div>' +
      '<div class="bars14">' + bars + "</div></section>";
  }

  function examCard(e) {
    const mins = sessionMinutes(e);
    const target = Number(e.targetHours) || 0;
    const hours = mins / 60;
    let progress = "";
    let ring = "";
    if (target > 0 && mins > 0) {
      const pct = Math.min(100, (hours / target) * 100);
      progress = '<div class="row-meta" style="margin-top:8px"><span>' + formatHours(mins) + " su " + escapeHtml(String(target)) + " h previste</span></div>";
      ring = progressRing(pct, { size: 48, stroke: 5, cls: "study" });
    } else if (target > 0 && e.stato !== "superato") {
      progress = '<div class="row-meta" style="margin-top:6px"><span>0 min su ' + escapeHtml(String(target)) + " h previste</span></div>";
      ring = progressRing(0, { size: 48, stroke: 5, cls: "study" });
    } else if (mins) {
      progress = '<div class="row-meta" style="margin-top:6px"><span>' + formatHours(mins) + " di studio</span></div>";
    }
    const voto = e.stato === "superato" && isFiniteNumber(e.voto)
      ? '<div class="voto">' + e.voto + (e.lode ? " e lode" : "") + "</div>"
      : "";
    const dl = e.stato !== "superato" && e.dataAppello ? daysUntil(e.dataAppello) : null;
    const dlPill = dl == null ? "" : dl < 0 ? '<span class="pill overdue">passato</span>'
      : '<span class="pill days-left' + (dl <= 7 ? " hot" : dl <= 21 ? " warm" : "") + '">' + (dl === 0 ? "oggi" : dl === 1 ? "domani" : "tra " + dl + " g") + "</span>";
    return '<button type="button" class="exam-card st-' + e.stato + '" data-open-exam="' + e.id + '">' +
      '<div class="top"><div><h3>' + escapeHtml(e.materia) + '</h3><div class="meta">' +
      (e.cfu ? e.cfu + " CFU" : "CFU non indicati") +
      (e.dataAppello ? " · " + escapeHtml(formatDate(e.dataAppello, { short: true })) : "") +
      progress +
      '</div></div><div class="exam-side"><span class="pill ' + e.stato + '">' +
      escapeHtml(labelOf(EXAM_STATES, e.stato)) + "</span>" + dlPill + voto + ring + "</div></div></button>";
  }

  function renderExamDetail(e) {
    const sessions = (e.sessions || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    const mins = sessionMinutes(e);
    const target = Number(e.targetHours) || 0;
    const pct = target > 0 ? Math.min(100, (mins / 60 / target) * 100) : 0;
    const sessionList = sessions.length
      ? '<div class="list">' + sessions.map(function (s) {
          return '<button type="button" class="row pressable log-item" data-edit-session="' + s.id + '">' +
            '<div class="row-body"><div class="log-date">' + escapeHtml(formatDate(s.date, { withWeekday: true, short: true })) +
            " · " + formatHours(Number(s.minutes) || 0) + '</div><span class="row-title">' +
            escapeHtml(s.notes || "Sessione di studio") + "</span></div>" + iconChevron() + "</button>";
        }).join("") + "</div>"
      : emptyState("Nessuna sessione", "Tocca + per registrare una sessione di studio con durata e appunti.", "study");

    return '<div class="hero-stat hero-split"><div class="hero-copy"><div class="row-meta" style="margin-bottom:8px">' +
      '<span class="pill ' + e.stato + '">' + escapeHtml(labelOf(EXAM_STATES, e.stato)) + "</span>" +
      (e.cfu ? '<span class="pill">' + e.cfu + " CFU</span>" : "") +
      (e.stato === "superato" && isFiniteNumber(e.voto) ? '<span class="pill superato">' + e.voto + (e.lode ? " e lode" : "") + "</span>" : "") +
      "</div>" +
      (e.dataAppello ? '<p class="muted" style="margin:0 0 8px">Appello: ' + escapeHtml(formatDate(e.dataAppello, { withWeekday: true })) + "</p>" : "") +
      (e.dataAppello && e.stato !== "superato" && parseDate(e.dataAppello) && parseDate(e.dataAppello).getTime() > Date.now()
        ? '<p class="exam-cd"><span>Mancano</span> <strong data-countdown="' + parseDate(e.dataAppello).getTime() + '">' + countdownText(parseDate(e.dataAppello).getTime() - Date.now()) + "</strong></p>" : "") +
      '<p class="label" style="margin:0">Tempo di studio</p>' +
      '<div class="value" style="font-size:28px;margin-top:4px">' + (mins ? formatHours(mins) : "—") + "</div>" +
      (target ? '<p class="hint" style="margin:8px 0 0">Obiettivo: ' + escapeHtml(String(target)) + " h</p>" : "") +
      (e.notes ? '<p style="margin:12px 0 0;white-space:pre-wrap">' + escapeHtml(e.notes) + "</p>" : "") +
      '<button type="button" class="btn-secondary" data-edit-exam="' + e.id + '" style="margin-top:14px">Modifica esame</button></div>' +
      (target ? ringBlock(pct, countSpan(pct, "pct", "exam-pct", Math.round(pct) + "%"), "studio", { size: 96, stroke: 8, cls: "study" }) : "") +
      "</div>" +
      '<h2 class="section-title">Sessioni di studio</h2>' + sessionList;
  }

  function openExamForm(id) {
    const e = id ? data.exams.find(function (x) { return x.id === id; }) : null;
    openSheet({
      title: e ? "Modifica esame" : "Nuovo esame",
      onDelete: e ? function () {
        data.exams = data.exams.filter(function (x) { return x.id !== e.id; });
        if (examDetailId === e.id) examDetailId = null;
        save();
        toast("Esame eliminato");
        render();
      } : null,
      body: "<form>" +
        '<div class="field"><label for="ex-materia">Materia</label>' +
        '<input id="ex-materia" name="materia" type="text" required maxlength="200" placeholder="Es. Diritto privato" value="' + escapeHtml(e ? e.materia : "") + '"></div>' +
        '<div class="field-row"><div class="field"><label for="ex-date">Data appello</label>' +
        '<input id="ex-date" name="dataAppello" type="date" value="' + escapeHtml(e && e.dataAppello ? e.dataAppello : "") + '"></div>' +
        '<div class="field"><label for="ex-cfu">CFU</label>' +
        '<input id="ex-cfu" name="cfu" type="number" min="0" max="30" step="1" inputmode="numeric" value="' + (e && e.cfu != null ? escapeHtml(String(e.cfu)) : "") + '"></div></div>' +
        '<div class="field"><label for="ex-stato">Stato</label>' +
        formSelect("stato", EXAM_STATES, e ? e.stato : "da-preparare", 'id="ex-stato"') + "</div>" +
        '<div class="field-row"><div class="field"><label for="ex-voto">Voto (se superato)</label>' +
        '<input id="ex-voto" name="voto" type="number" min="18" max="30" step="1" inputmode="numeric" value="' + (e && e.voto != null ? escapeHtml(String(e.voto)) : "") + '"></div>' +
        '<div class="field"><label for="ex-target">Ore obiettivo</label>' +
        '<input id="ex-target" name="targetHours" type="number" min="0" max="999" step="1" inputmode="numeric" value="' + (e && e.targetHours != null ? escapeHtml(String(e.targetHours)) : "") + '"></div></div>' +
        '<div class="field"><label class="toggle" style="margin:0"><span>30 e lode</span>' +
        '<input type="checkbox" name="lode"' + (e && e.lode ? " checked" : "") + "></label></div>" +
        '<div class="field"><label for="ex-notes">Note</label>' +
        '<textarea id="ex-notes" name="notes" maxlength="4000" placeholder="Programma, libri, argomenti da ripassare…">' +
        escapeHtml(e ? e.notes || "" : "") + "</textarea></div></form>",
      onSave: function (form) {
        const fd = new FormData(form);
        const materia = String(fd.get("materia") || "").trim();
        if (!materia) return false;
        const votoRaw = String(fd.get("voto") || "").trim();
        const voto = votoRaw === "" ? null : Number(votoRaw);
        const cfuRaw = String(fd.get("cfu") || "").trim();
        const targetRaw = String(fd.get("targetHours") || "").trim();
        const payload = {
          materia: materia,
          dataAppello: String(fd.get("dataAppello") || ""),
          cfu: cfuRaw === "" ? null : Number(cfuRaw),
          stato: String(fd.get("stato") || "da-preparare"),
          voto: votoRaw === "" || !Number.isFinite(voto) ? null : voto,
          lode: form.querySelector('[name="lode"]').checked,
          targetHours: targetRaw === "" ? null : Number(targetRaw),
          notes: String(fd.get("notes") || "").trim(),
        };
        if (payload.lode && payload.voto == null) payload.voto = 30;
        const justPassed = payload.stato === "superato" && (!e || e.stato !== "superato");
        if (justPassed && MM) setTimeout(function () { MM.celebrate(); toast("Esame superato. Complimenti!", { tone: "win" }); }, 320);
        if (e) Object.assign(e, payload);
        else data.exams.push(Object.assign({ id: uid(), sessions: [] }, payload));
        save();
        if (!justPassed) toast(e ? "Esame aggiornato" : "Esame aggiunto");
        render();
      },
    });
  }

  function openSessionForm(examId, sessionId) {
    const exam = data.exams.find(function (x) { return x.id === examId; });
    if (!exam) return;
    if (!exam.sessions) exam.sessions = [];
    const s = sessionId ? exam.sessions.find(function (x) { return x.id === sessionId; }) : null;
    openSheet({
      title: s ? "Modifica sessione" : "Nuova sessione",
      onDelete: s ? function () {
        exam.sessions = exam.sessions.filter(function (x) { return x.id !== s.id; });
        save();
        toast("Sessione eliminata");
        render();
      } : null,
      body: "<form>" +
        '<div class="field-row"><div class="field"><label for="se-date">Data</label>' +
        '<input id="se-date" name="date" type="date" required value="' + escapeHtml(s ? s.date : todayISO()) + '"></div>' +
        '<div class="field"><label for="se-min">Minuti</label>' +
        '<input id="se-min" name="minutes" type="number" required min="1" max="1440" step="1" inputmode="numeric" value="' + (s ? escapeHtml(String(s.minutes)) : "60") + '"></div></div>' +
        '<div class="field"><label for="se-notes">Appunti</label>' +
        '<textarea id="se-notes" name="notes" maxlength="4000" placeholder="Cosa hai studiato, dubbi, pagine…">' +
        escapeHtml(s ? s.notes || "" : "") + "</textarea></div></form>",
      onSave: function (form) {
        const fd = new FormData(form);
        const payload = {
          date: String(fd.get("date") || todayISO()),
          minutes: Number(fd.get("minutes")) || 0,
          notes: String(fd.get("notes") || "").trim(),
        };
        if (payload.minutes < 1) return false;
        if (s) Object.assign(s, payload);
        else exam.sessions.push(Object.assign({ id: uid() }, payload));
        save();
        toast(s ? "Sessione aggiornata" : "Sessione aggiunta");
        render();
      },
    });
  }

  function sumBy(list, pred) {
    return list.reduce(function (s, t) { return s + (pred(t) ? Number(t.amount) || 0 : 0); }, 0);
  }

  function monthKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function txsInMonth(cursor) {
    const key = monthKey(cursor);
    return data.transactions.filter(function (t) { return t.date && t.date.startsWith(key); });
  }

  function freelanceInYear(year) {
    const prefix = String(year);
    return data.transactions.filter(function (t) { return t.type === "entrata" && t.freelance && t.date && t.date.startsWith(prefix); });
  }

  function renderMoney() {
    const monthTx = txsInMonth(moneyCursor).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    const entrate = sumBy(monthTx, function (t) { return t.type === "entrata"; });
    const uscite = sumBy(monthTx, function (t) { return t.type === "uscita"; });
    const saldo = entrate - uscite;
    const allIn = sumBy(data.transactions, function (t) { return t.type === "entrata"; });
    const allOut = sumBy(data.transactions, function (t) { return t.type === "uscita"; });
    const allBal = allIn - allOut;

    const years = new Set(data.transactions.filter(function (t) { return t.freelance && t.date; }).map(function (t) { return Number(t.date.slice(0, 4)); }));
    years.add(new Date().getFullYear());
    years.add(freelanceYear);
    const yearOpts = Array.from(years).sort(function (a, b) { return b - a; });

    const fl = freelanceInYear(freelanceYear);
    const flTot = sumBy(fl, function () { return true; });
    const flPct = Math.min(100, (flTot / SOGLIA_INPS) * 100);
    const over = flTot > SOGLIA_INPS;
    const near = !over && flTot >= SOGLIA_INPS * 0.8;
    const remain = Math.max(0, SOGLIA_INPS - flTot);

    const grouped = [];
    monthTx.forEach(function (t) {
      const last = grouped[grouped.length - 1];
      if (!last || last.day !== t.date) grouped.push({ day: t.date, items: [t] });
      else last.items.push(t);
    });

    const list = grouped.length
      ? grouped.map(function (g) {
          return '<p class="section-title" style="margin-top:14px">' + escapeHtml(formatDate(g.day, { withWeekday: true, short: true, withYear: false })) +
            '</p><div class="list">' + g.items.map(txRow).join("") + "</div>";
        }).join("")
      : emptyState("Nessun movimento in questo mese", "Tocca + per registrare un'entrata o un'uscita.", "money");

    const monthMax = Math.max(entrate, uscite, 1);
    const flTone = over ? "danger" : near ? "warn" : "ok";
    return '<div class="period-nav">' +
      '<button type="button" class="nav-btn" data-month-delta="-1" aria-label="Mese precedente">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 5l-8 7 8 7"></path></svg></button>' +
      "<h2>" + MONTHS[moneyCursor.getMonth()] + " " + moneyCursor.getFullYear() + "</h2>" +
      '<button type="button" class="nav-btn" data-month-delta="1" aria-label="Mese successivo">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l8 7-8 7"></path></svg></button></div>' +
      '<div class="hero-stat">' +
      '<div class="stats cols3" style="margin:0">' +
      '<div class="stat" style="padding:0;border:0;box-shadow:none;background:transparent"><p class="label">Entrate</p><div class="value amount pos" style="font-size:18px">' + countSpan(entrate, "euro", "m-in", formatEuro(entrate)) + "</div></div>" +
      '<div class="stat" style="padding:0;border:0;box-shadow:none;background:transparent"><p class="label">Uscite</p><div class="value amount neg" style="font-size:18px">' + countSpan(uscite, "euro", "m-out", formatEuro(uscite)) + "</div></div>" +
      '<div class="stat" style="padding:0;border:0;box-shadow:none;background:transparent"><p class="label">Saldo</p><div class="value amount ' + (saldo >= 0 ? "pos" : "neg") + '" style="font-size:18px">' + countSpan(saldo, "euro", "m-bal", formatEuro(saldo)) + "</div></div></div>" +
      '<div class="mini-bars">' +
      '<div class="mini-bar"><span class="lbl">Entrate</span><div class="track"><span style="width:' + Math.round((entrate / monthMax) * 100) + '%"></span></div><span class="amt pos">' + formatEuro(entrate) + "</span></div>" +
      '<div class="mini-bar"><span class="lbl">Uscite</span><div class="track out"><span style="width:' + Math.round((uscite / monthMax) * 100) + '%"></span></div><span class="amt neg">' + formatEuro(uscite) + "</span></div>" +
      "</div>" +
      '<p class="hint" style="margin:10px 0 0">Saldo complessivo: <strong>' + countSpan(allBal, "euro", "m-all", formatEuro(allBal)) + "</strong></p></div>" +
      moneyChartsHtml(monthTx, uscite) +
      '<h2 class="section-title">Freelance ' + freelanceYear + "</h2>" +
      '<div class="card hero-split" style="padding:16px 18px">' +
      '<div class="hero-copy"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><div>' +
      '<div class="amount" style="font-size:24px">' + countSpan(flTot, "euro", "m-fl", formatEuro(flTot)) + "</div>" +
      '<div class="muted" style="font-size:13px;margin-top:2px">su ' + formatEuro(SOGLIA_INPS) + " di franchigia</div></div>" +
      '<label class="muted" style="font-size:13px">Anno <select id="freelance-year" style="margin-left:6px;background:var(--fill);border:0;border-radius:8px;padding:6px 8px">' +
      yearOpts.map(function (y) { return '<option value="' + y + '"' + (y === freelanceYear ? " selected" : "") + ">" + y + "</option>"; }).join("") +
      "</select></label></div>" +
      '<p class="hint" style="margin:10px 0 0">' + (over ? "Soglia superata di " + formatEuro(flTot - SOGLIA_INPS) + "." : "Restano " + formatEuro(remain) + " prima della soglia.") + "</p></div>" +
      ringBlock(flPct, countSpan(flPct, "pct", "m-flpct", Math.round(flPct) + "%"), "soglia", { size: 92, stroke: 8, cls: "money " + flTone }) +
      "</div>" +
      '<div class="callout legal ' + (over ? "danger-soft" : near ? "warn" : "") + '" style="margin-top:10px">' +
      "<strong>Promemoria INPS (lavoro autonomo occasionale).</strong> " +
      "I primi " + formatEuro(SOGLIA_INPS) + " di compensi da lavoro autonomo occasionale, sommati da tutti i committenti nell'anno solare (1° gennaio–31 dicembre), costituiscono di norma una franchigia contributiva INPS: sotto questa soglia non scatta l'obbligo di iscrizione alla Gestione Separata. Oltre i " + formatEuro(SOGLIA_INPS) + " i contributi si applicano solo alla parte eccedente e va comunicato tempestivamente il superamento ai committenti. " +
      "Questa sezione è solo un promemoria e non sostituisce un parere fiscale o previdenziale. Resta distinta dal regime del contratto di prestazione occasionale / Libretto Famiglia (art. 54-bis)." +
      "</div>" +
      '<h2 class="section-title">Movimenti</h2>' + list;
  }

  const DONUT_COLORS = { casa: "#5B4DFF", cibo: "#FF7A1A", trasporti: "#0ABAB5", studio: "#A855F7", braccio: "#FFB020", personale: "#F43F5E", altro: "#94A3B8" };

  function moneyChartsHtml(monthTx, uscite) {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(moneyCursor.getFullYear(), moneyCursor.getMonth() - i, 1);
      const key = monthKey(d);
      const list = data.transactions.filter(function (t) { return t.date && t.date.startsWith(key); });
      months.push({
        key: key, label: MONTHS[d.getMonth()].slice(0, 3), cur: i === 0,
        inn: sumBy(list, function (t) { return t.type === "entrata"; }),
        out: sumBy(list, function (t) { return t.type === "uscita"; })
      });
    }
    const max = Math.max(1, Math.max.apply(null, months.map(function (m) { return Math.max(m.inn, m.out); })));
    const net6 = months.reduce(function (a, m) { return a + m.inn - m.out; }, 0);
    const cols = months.map(function (m, i) {
      const hi = m.inn ? Math.max(0.04, m.inn / max) : 0.015;
      const ho = m.out ? Math.max(0.04, m.out / max) : 0.015;
      return '<button type="button" class="bcol' + (m.cur ? " cur" : "") + '" data-month-set="' + m.key + '" style="--k:' + i + '" aria-label="' + m.label + ": entrate " + formatEuro(m.inn) + ", uscite " + formatEuro(m.out) + '">' +
        '<div class="bpair"><span class="b in" style="height:' + (hi * 100).toFixed(1) + '%"></span><span class="b out" style="height:' + (ho * 100).toFixed(1) + '%"></span></div>' +
        '<span class="bl">' + m.label + "</span></button>";
    }).join("");
    const bars = '<section class="card chart-card" data-reveal><div class="chart-head"><h3>Ultimi 6 mesi</h3>' +
      '<div class="legend"><span><i class="in"></i>Entrate</span><span><i class="out"></i>Uscite</span></div></div>' +
      '<div class="chart-kpis"><div><span class="kpi amount ' + (net6 >= 0 ? "pos" : "neg") + '">' + countSpan(net6, "euro", "m-net6", formatEuro(net6)) + '</span><span class="kpi-lab">saldo dei 6 mesi</span></div></div>' +
      '<div class="bars6">' + cols + "</div><p class=\"hint\" style=\"margin:6px 0 0\">Tocca un mese per aprirlo.</p></section>";

    const outs = monthTx.filter(function (t) { return t.type === "uscita"; });
    if (!outs.length || uscite <= 0) return bars;
    const byCat = {};
    outs.forEach(function (t) { byCat[t.category || "altro"] = (byCat[t.category || "altro"] || 0) + (Number(t.amount) || 0); });
    const cats = Object.keys(byCat).map(function (k) { return { id: k, v: byCat[k] }; }).sort(function (a, b) { return b.v - a.v; });
    const size = 132, stroke = 18, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let acc = 0;
    const gap = cats.length > 1 ? 2 : 0;
    const segs = cats.map(function (k, i) {
      const len = Math.max(0, (k.v / uscite) * c - gap);
      const seg = '<circle class="donut-seg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" style="stroke:' + (DONUT_COLORS[k.id] || "#94A3B8") +
        ";stroke-width:" + stroke + ";stroke-dasharray:" + len.toFixed(2) + " " + (c - len).toFixed(2) + ";stroke-dashoffset:" + (-acc).toFixed(2) +
        ";--len:" + len.toFixed(2) + ";--c:" + c.toFixed(2) + ";--k:" + i + '"></circle>';
      acc += (k.v / uscite) * c;
      return seg;
    }).join("");
    const legend = cats.map(function (k, i) {
      const pctC = (k.v / uscite) * 100;
      return '<div class="dl-row" style="--k:' + i + '"><i style="background:' + (DONUT_COLORS[k.id] || "#94A3B8") + '"></i><span class="dl-name">' + escapeHtml(labelOf(TX_CATS.uscita, k.id)) +
        '</span><span class="dl-pct">' + Math.round(pctC) + '%</span><span class="dl-amt">' + formatEuro(k.v) + "</span></div>";
    }).join("");
    const donut = '<section class="card chart-card donut-card" data-reveal><div class="chart-head"><h3>Dove vanno i soldi</h3><span class="muted" style="font-size:12px">' +
      MONTHS[moneyCursor.getMonth()] + "</span></div>" +
      '<div class="donut-wrap"><div class="donut"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '" aria-hidden="true">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="donut-track" style="stroke-width:' + stroke + '"></circle>' + segs + "</svg>" +
      '<div class="donut-center"><strong>' + countSpan(uscite, "euro", "m-donut", formatEuro(uscite)) + "</strong><span>uscite</span></div></div>" +
      '<div class="donut-legend">' + legend + "</div></div></section>";
    return bars + donut;
  }

  function txRow(t) {
    const cats = TX_CATS[t.type] || [];
    const sign = t.type === "entrata" ? "+" : "−";
    return '<button type="button" class="row pressable" data-edit-tx="' + t.id + '">' +
      '<div class="row-body"><span class="row-title">' + escapeHtml(t.note || labelOf(cats, t.category) || "Movimento") + "</span>" +
      '<div class="row-meta"><span class="pill ' + t.type + '">' + (t.type === "entrata" ? "Entrata" : "Uscita") + "</span>" +
      '<span class="pill">' + escapeHtml(labelOf(cats, t.category)) + "</span>" +
      (t.freelance ? '<span class="pill freelance">Freelance</span>' : "") +
      '</div></div><span class="amount ' + (t.type === "entrata" ? "pos" : "neg") + '">' +
      sign + formatEuro(t.amount).replace("€", "").trim() + " €</span></button>";
  }

  function openTxForm(id) {
    const t = id ? data.transactions.find(function (x) { return x.id === id; }) : null;
    const initialType = t ? t.type : "uscita";
    const body = '<form id="tx-form">' +
      '<div class="field"><label>Tipo</label><div class="segments" style="margin:0">' +
      '<button type="button" class="' + (initialType === "entrata" ? "active" : "") + '" data-tx-type="entrata">Entrata</button>' +
      '<button type="button" class="' + (initialType === "uscita" ? "active" : "") + '" data-tx-type="uscita">Uscita</button>' +
      '</div><input type="hidden" name="type" value="' + initialType + '"></div>' +
      '<div class="field"><label for="tx-amount">Importo (euro)</label>' +
      '<input id="tx-amount" name="amount" type="number" required min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" value="' + (t ? escapeHtml(String(t.amount)) : "") + '"></div>' +
      '<div class="field"><label for="tx-date">Data</label>' +
      '<input id="tx-date" name="date" type="date" required value="' + escapeHtml(t ? t.date : todayISO()) + '"></div>' +
      '<div class="field"><label for="tx-cat">Categoria</label><select id="tx-cat" name="category"></select></div>' +
      '<div class="field"><label class="toggle" style="margin:0"><span>Compenso freelance / occasionale</span>' +
      '<input type="checkbox" name="freelance"' + (t && t.freelance ? " checked" : "") + "></label></div>" +
      '<div class="field"><label for="tx-note">Descrizione</label>' +
      '<input id="tx-note" name="note" type="text" maxlength="200" placeholder="Es. Editing articolo, spesa settimanale…" value="' +
      escapeHtml(t ? t.note || "" : "") + '"></div></form>';

    openSheet({
      title: t ? "Modifica movimento" : "Nuovo movimento",
      onDelete: t ? function () {
        data.transactions = data.transactions.filter(function (x) { return x.id !== t.id; });
        save();
        toast("Movimento eliminato");
        render();
      } : null,
      body: body,
      onSave: function (form) {
        const fd = new FormData(form);
        const amount = Number(fd.get("amount"));
        if (!Number.isFinite(amount) || amount <= 0) return false;
        const type = String(fd.get("type") || "uscita");
        const payload = {
          type: type,
          amount: amount,
          date: String(fd.get("date") || todayISO()),
          category: String(fd.get("category") || "altro"),
          freelance: type === "entrata" ? form.querySelector('[name="freelance"]').checked : false,
          note: String(fd.get("note") || "").trim(),
        };
        if (t) Object.assign(t, payload);
        else data.transactions.push(Object.assign({ id: uid() }, payload));
        save();
        toast(t ? "Movimento aggiornato" : "Movimento aggiunto");
        render();
      },
    });

    const form = $("#tx-form");
    const typeInput = form.querySelector('[name="type"]');
    const catSel = form.querySelector('[name="category"]');
    const freelanceBox = form.querySelector('[name="freelance"]');

    function fillCats(type, selected) {
      const opts = TX_CATS[type];
      catSel.innerHTML = opts.map(function (o) {
        return '<option value="' + o.id + '"' + (o.id === selected ? " selected" : "") + ">" + o.label + "</option>";
      }).join("");
    }

    fillCats(initialType, t ? t.category : TX_CATS[initialType][0].id);

    form.querySelectorAll("[data-tx-type]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const type = btn.dataset.txType;
        typeInput.value = type;
        form.querySelectorAll("[data-tx-type]").forEach(function (b) { b.classList.toggle("active", b === btn); });
        fillCats(type, catSel.value);
        if (type === "uscita") freelanceBox.checked = false;
        if (type === "entrata" && catSel.value === "freelance") freelanceBox.checked = true;
      });
    });

    catSel.addEventListener("change", function () {
      if (typeInput.value === "entrata" && catSel.value === "freelance") freelanceBox.checked = true;
    });
  }

  function partsTotal(onlyBought) {
    return data.arm.parts.reduce(function (s, p) {
      if (onlyBought && !p.bought) return s;
      return s + (Number(p.qty) || 0) * (Number(p.cost) || 0);
    }, 0);
  }


  function armSetupHtml() {
    const c = data.arm.config || {};
    const payload = c.payload != null ? String(c.payload) : "0.05";
    const servo = c.servo || "MG996R";
    const cm = function (key, fallback) {
      const n = Number(c[key]);
      return String((Number.isFinite(n) ? n : fallback) * 100);
    };
    const optPay = [["0","0 g"],["0.05","50 g"],["0.1","100 g"],["0.2","200 g"],["0.5","500 g"]].map(function (o) {
      return '<option value="' + o[0] + '"' + (payload === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
    }).join("");
    const optServo = [
      ["MG996R", "MG996R (1,1 N·m)"],
      ["DS3218", "DS3218 (2,0 N·m)"],
      ["SG90", "SG90 (0,18 N·m)"]
    ].map(function (o) {
      return '<option value="' + o[0] + '"' + (servo === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
    }).join("");
    return '<div class="arm-setup">' +
      '<h2 class="section-title" style="margin-top:14px">Il mio braccio</h2>' +
      '<p class="hint">Regola lunghezze e servo come sul braccio vero: la fisica della coppia e la portata della pinza si adeguano.</p>' +
      '<div class="arm-setup-row">' +
      '<label class="arm-field"><span>Carico</span><select data-arm-payload>' + optPay + "</select></label>" +
      '<label class="arm-field"><span>Servo</span><select data-arm-servo>' + optServo + "</select></label></div>" +
      '<div class="arm-setup-grid">' +
      '<label class="arm-field"><span>Braccio (cm)</span><input data-arm-cfg="L1" type="number" inputmode="decimal" step="0.5" min="6" max="40" value="' + cm("L1", 0.15) + '"></label>' +
      '<label class="arm-field"><span>Avambraccio (cm)</span><input data-arm-cfg="L2" type="number" inputmode="decimal" step="0.5" min="6" max="40" value="' + cm("L2", 0.12) + '"></label>' +
      '<label class="arm-field"><span>Polso-pinza (cm)</span><input data-arm-cfg="L3" type="number" inputmode="decimal" step="0.5" min="3" max="25" value="' + cm("L3", 0.09) + '"></label>' +
      '<label class="arm-field"><span>Altezza base (cm)</span><input data-arm-cfg="baseH" type="number" inputmode="decimal" step="0.5" min="4" max="20" value="' + cm("baseH", 0.08) + '"></label></div>' +
      '<button type="button" class="btn-secondary arm-btn" data-arm="apply-config">Applica misure</button></div>';
  }

  function renderArm() {
    const ms = data.arm.milestones.slice();
    const done = ms.filter(function (m) { return m.done; }).length;
    const pct = ms.length ? Math.round((done / ms.length) * 100) : 0;
    const tot = partsTotal(false);
    const spent = partsTotal(true);
    const parts = data.arm.parts.slice();
    const logs = data.arm.log.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    const msList = ms.length
      ? '<div class="list">' + ms.map(function (m) {
          return '<div class="row"><button type="button" class="check ' + (m.done ? "on" : "") + '" data-toggle-milestone="' + m.id + '" aria-label="Completata">' + iconCheck() + "</button>" +
            '<button type="button" class="row-body" data-edit-milestone="' + m.id + '" style="background:transparent;padding:0;text-align:left">' +
            '<span class="row-title ' + (m.done ? "done" : "") + '">' + escapeHtml(m.title) + "</span>" +
            (m.due ? '<div class="row-meta"><span class="pill">' + escapeHtml(relativeDue(m.due)) + "</span></div>" : "") +
            "</button></div>";
        }).join("") + "</div>"
      : emptyState("Nessuna tappa", "Spezza il progetto in traguardi: telaio, elettronica, codice, prove…", "arm");

    const partList = parts.length
      ? '<div class="list">' + parts.map(function (p) {
          const line = (Number(p.qty) || 0) * (Number(p.cost) || 0);
          return '<button type="button" class="row pressable" data-edit-part="' + p.id + '">' +
            '<div class="row-body"><span class="row-title ' + (p.bought ? "done" : "") + '">' + escapeHtml(p.name) + "</span>" +
            '<div class="row-meta"><span class="pill">' + escapeHtml(String(p.qty || 1)) + " × " + formatEuro(p.cost || 0) + "</span>" +
            (p.bought ? '<span class="pill superato">Acquistato</span>' : '<span class="pill">Da comprare</span>') +
            '</div></div><span class="amount">' + formatEuro(line) + "</span></button>";
        }).join("") + "</div>"
      : emptyState("Nessun componente", "Elenca pezzi e costi: il totale si aggiorna da solo.", "arm");

    const logList = logs.length
      ? '<div class="list">' + logs.map(function (l) {
          return '<button type="button" class="row pressable log-item" data-edit-log="' + l.id + '">' +
            '<div class="row-body"><div class="log-date">' + escapeHtml(formatDate(l.date, { withWeekday: true, short: true })) +
            '</div><span class="row-title">' + escapeHtml(l.text) + "</span></div>" + iconChevron() + "</button>";
        }).join("") + "</div>"
      : emptyState("Diario vuoto", "Annota prove, misure, idee e problemi incontrati.", "spark");

    const spentPct = tot ? Math.min(100, (spent / tot) * 100) : 0;
    const poses = data.arm.poses || [];
    const poseHtml = poses.length
      ? '<div class="arm-pose-list">' + poses.map(function (p) {
          return '<div class="arm-pose-chip"><button type="button" data-arm="load-pose" data-id="' + p.id + '">' +
            escapeHtml(p.name) + '</button><button type="button" class="arm-pose-del" data-arm="delete-pose" data-id="' +
            p.id + '" aria-label="Elimina pose">×</button></div>';
        }).join("") + "</div>"
      : '<p class="hint">Salva una posizione del braccio per ritrovarla in seguito.</p>';
    const sliders = [
      ["base", "Base"],
      ["shoulder", "Spalla"],
      ["elbow", "Gomito"],
      ["wrist", "Polso"],
      ["roll", "Rotazione polso"],
      ["gripper", "Pinza"]
    ];
    const ranges = { base: [-180, 180], shoulder: [-90, 90], elbow: [-135, 135], wrist: [-90, 90], roll: [-180, 180], gripper: [0, 100] };
    const cur = data.arm.joints || { base: 25, shoulder: -35, elbow: 55, wrist: 20, roll: 0, gripper: 40 };
    const sliderHtml = sliders.map(function (s) {
      const key = s[0];
      const r = ranges[key];
      const v = cur[key] != null ? cur[key] : 0;
      const unit = key === "gripper" ? "%" : "°";
      return '<label class="arm-slider"><span class="arm-slider-lab">' + s[1] +
        '</span><input type="range" min="' + r[0] + '" max="' + r[1] + '" step="1" value="' + v +
        '" data-joint="' + key + '"><span class="arm-slider-val" data-joint-val="' + key + '">' +
        Math.round(v) + unit + "</span></label>";
    }).join("");

    return '<section class="arm-3d" id="arm-3d">' +
      '<div class="arm-stage" id="arm-viewport"></div>' +
      '<div class="arm-hud" id="arm-telemetry" aria-hidden="true"></div>' +
      '<p class="arm-stage-hint">Trascina per ruotare · pizzica per lo zoom · tocca il piano o un oggetto per spostare la pinza</p>' +
      '<div class="arm-actions">' +
      '<button type="button" class="btn-primary arm-btn" data-arm="demo">Demo</button>' +
      '<button type="button" class="btn-secondary arm-btn" data-arm="reset">Reset</button>' +
      "</div>" +
      '<div class="arm-sliders">' + sliderHtml + "</div>" +
      armSetupHtml() +
      '<div class="arm-pose-save"><input id="arm-pose-name" type="text" maxlength="40" placeholder="Nome della pose" autocomplete="off">' +
      '<button type="button" class="btn-secondary arm-btn" data-arm="save-pose">Salva pose</button></div>' +
      '<h2 class="section-title" style="margin-top:14px">Pose salvate</h2>' + poseHtml +
      "</section>" +
      '<div class="hero-stat hero-split">' +
      '<div class="hero-copy"><p class="label">Avanzamento</p>' +
      '<div class="value">' + (ms.length ? done + "/" + ms.length : "—") + "</div>" +
      '<div class="sub" style="margin-top:6px">' + (ms.length ? pct + "% delle tappe completato" : "Aggiungi le tappe del progetto") + "</div>" +
      '<p class="label" style="margin:14px 0 4px">Costo componenti</p>' +
      '<div class="value" style="font-size:22px">' + formatEuro(tot) + "</div>" +
      '<div class="sub">Già acquistati: ' + formatEuro(spent) + "</div>" +
      '<div class="mini-bars"><div class="mini-bar"><span class="lbl">Speso</span><div class="track"><span style="width:' + Math.round(spentPct) + '%"></span></div></div></div></div>' +
      ringBlock(pct, (ms.length ? pct + "%" : "—"), "tappe", { size: 96, stroke: 8, cls: "arm" }) +
      "</div>" +
      '<div class="sec-head"><h2 class="section-title">Tappe</h2>' +
      '<button type="button" class="text-add" data-action="add-milestone">Aggiungi</button></div>' +
      msList +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<h2 class="section-title" style="margin-bottom:8px">Componenti</h2>' +
      '<button type="button" data-action="add-part" style="color:var(--accent-text);font-weight:600;font-size:15px;padding:8px 4px">Aggiungi</button></div>' +
      partList +
      '<div style="display:flex;justify-content:space-between;align-items:center">' +
      '<h2 class="section-title" style="margin-bottom:8px">Diario</h2>' +
      '<button type="button" data-action="add-log" style="color:var(--accent-text);font-weight:600;font-size:15px;padding:8px 4px">Aggiungi</button></div>' +
      logList;
  }

  function openMilestoneForm(id) {
    const m = id ? data.arm.milestones.find(function (x) { return x.id === id; }) : null;
    openSheet({
      title: m ? "Modifica tappa" : "Nuova tappa",
      onDelete: m ? function () {
        data.arm.milestones = data.arm.milestones.filter(function (x) { return x.id !== m.id; });
        save();
        toast("Tappa eliminata");
        render();
      } : null,
      body: "<form>" +
        '<div class="field"><label for="ms-title">Tappa</label>' +
        '<input id="ms-title" name="title" type="text" required maxlength="200" placeholder="Es. Assemblare il telaio base" value="' + escapeHtml(m ? m.title : "") + '"></div>' +
        '<div class="field"><label for="ms-due">Scadenza (facoltativa)</label>' +
        '<input id="ms-due" name="due" type="date" value="' + escapeHtml(m && m.due ? m.due : "") + '"></div></form>',
      onSave: function (form) {
        const fd = new FormData(form);
        const title = String(fd.get("title") || "").trim();
        if (!title) return false;
        const due = String(fd.get("due") || "");
        if (m) Object.assign(m, { title: title, due: due });
        else data.arm.milestones.push({ id: uid(), title: title, due: due, done: false });
        save();
        toast(m ? "Tappa aggiornata" : "Tappa aggiunta");
        render();
      },
    });
  }

  function openPartForm(id) {
    const p = id ? data.arm.parts.find(function (x) { return x.id === id; }) : null;
    openSheet({
      title: p ? "Modifica componente" : "Nuovo componente",
      onDelete: p ? function () {
        data.arm.parts = data.arm.parts.filter(function (x) { return x.id !== p.id; });
        save();
        toast("Componente eliminato");
        render();
      } : null,
      body: "<form>" +
        '<div class="field"><label for="pt-name">Nome</label>' +
        '<input id="pt-name" name="name" type="text" required maxlength="200" placeholder="Es. Servomotore MG996R" value="' + escapeHtml(p ? p.name : "") + '"></div>' +
        '<div class="field-row"><div class="field"><label for="pt-qty">Quantità</label>' +
        '<input id="pt-qty" name="qty" type="number" required min="1" step="1" inputmode="numeric" value="' + (p ? escapeHtml(String(p.qty || 1)) : "1") + '"></div>' +
        '<div class="field"><label for="pt-cost">Costo unitario (euro)</label>' +
        '<input id="pt-cost" name="cost" type="number" required min="0" step="0.01" inputmode="decimal" value="' + (p ? escapeHtml(String(p.cost || 0)) : "") + '"></div></div>' +
        '<div class="field"><label class="toggle" style="margin:0"><span>Già acquistato</span>' +
        '<input type="checkbox" name="bought"' + (p && p.bought ? " checked" : "") + "></label></div>" +
        '<div class="field"><label for="pt-note">Note</label>' +
        '<input id="pt-note" name="note" type="text" maxlength="300" placeholder="Fornitore, link, misure…" value="' +
        escapeHtml(p && p.note ? p.note : "") + '"></div></form>',
      onSave: function (form) {
        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        if (!name) return false;
        const payload = {
          name: name,
          qty: Number(fd.get("qty")) || 1,
          cost: Number(fd.get("cost")) || 0,
          bought: form.querySelector('[name="bought"]').checked,
          note: String(fd.get("note") || "").trim(),
        };
        if (p) Object.assign(p, payload);
        else data.arm.parts.push(Object.assign({ id: uid() }, payload));
        save();
        toast(p ? "Componente aggiornato" : "Componente aggiunto");
        render();
      },
    });
  }

  function openLogForm(id) {
    const l = id ? data.arm.log.find(function (x) { return x.id === id; }) : null;
    openSheet({
      title: l ? "Modifica nota" : "Nota di diario",
      onDelete: l ? function () {
        data.arm.log = data.arm.log.filter(function (x) { return x.id !== l.id; });
        save();
        toast("Nota eliminata");
        render();
      } : null,
      body: "<form>" +
        '<div class="field"><label for="lg-date">Data</label>' +
        '<input id="lg-date" name="date" type="date" required value="' + escapeHtml(l ? l.date : todayISO()) + '"></div>' +
        '<div class="field"><label for="lg-text">Testo</label>' +
        '<textarea id="lg-text" name="text" required maxlength="4000" placeholder="Cosa hai fatto o scoperto…">' +
        escapeHtml(l ? l.text : "") + "</textarea></div></form>",
      onSave: function (form) {
        const fd = new FormData(form);
        const text = String(fd.get("text") || "").trim();
        if (!text) return false;
        const payload = { date: String(fd.get("date") || todayISO()), text: text };
        if (l) Object.assign(l, payload);
        else data.arm.log.push(Object.assign({ id: uid() }, payload));
        save();
        toast(l ? "Nota aggiornata" : "Nota aggiunta");
        render();
      },
    });
  }

  function renderSettings() {
    const n = data.tasks.length + data.exams.length + data.transactions.length +
      data.arm.milestones.length + data.arm.parts.length + data.arm.log.length;
    const perm = ("Notification" in window) ? Notification.permission : "unsupported";
    const permLabel = perm === "granted" ? "Permesso concesso" : perm === "denied" ? "Permesso negato" : perm === "unsupported" ? "Non supportate da questo browser" : "Permesso non ancora chiesto";
    const iosTip = (isIOSDevice() && !isStandalone())
      ? '<div class="callout warn">Su iPhone le notifiche funzionano solo se l’app è installata: Safari → Condividi → <strong>Aggiungi alla schermata Home</strong>, poi aprila da lì (iOS 16.4 o successivo).</div>'
      : "";
    const vapid = vapidPublicKey();
    const pushBlock = vapid
      ? '<div class="list"><button type="button" class="action-row" data-action="push-subscribe"><div class="left"><span>Iscriviti al push (app chiusa)</span><span>' +
        (data.settings.pushSubscription ? "Iscrizione già salvata su questo telefono. Serve ancora il server per l'invio." : "Chiave VAPID presente: iscrive questo dispositivo. L'invio a app chiusa richiede il server descritto in PUSH.md.") +
        "</span></div>" + iconChevron() + "</button></div>"
      : '<p class="hint">Per ricevere le frasi anche a app completamente chiusa serve un piccolo server di invio (Web Push) e una chiave VAPID pubblica in <span style="white-space:nowrap">push-config.js</span>. Il piano, gratuito, è descritto in PUSH.md. Senza server, le notifiche partono solo mentre l’app è aperta o lasciata poco in secondo piano.</p>';
    const notifyHtml = '<h2 class="section-title">Notifiche</h2>' + iosTip +
      '<div class="list">' +
      '<div class="row"><button type="button" class="switch-row" data-action="toggle-notify-phrases"><div class="left"><span>Frasi ogni 30 minuti</span><span>Una frase nuova, se l’app è aperta o in secondo piano per poco</span></div>' +
      '<span class="switch' + (data.settings.notifyPhrases ? " on" : "") + '" role="switch" aria-checked="' + (data.settings.notifyPhrases ? "true" : "false") + '"></span></button></div>' +
      '<div class="row"><button type="button" class="switch-row" data-action="toggle-notify-deadlines"><div class="left"><span>Promemoria scadenze e appelli</span><span>Avviso per cose da fare in scadenza o in ritardo e per gli appelli vicini</span></div>' +
      '<span class="switch' + (data.settings.notifyDeadlines ? " on" : "") + '" role="switch" aria-checked="' + (data.settings.notifyDeadlines ? "true" : "false") + '"></span></button></div></div>' +
      '<p class="hint" style="margin:8px 4px 14px">' + escapeHtml(permLabel) + ". Con l’app chiusa del tutto, iOS e gli altri sistemi richiedono un servizio push.</p>" +
      pushBlock;
    return '<div class="callout">I dati restano solo su questo iPhone, nel browser. Non passano da nessun server. Fai un backup di tanto in tanto, soprattutto prima di cancellare i dati di Safari.</div>' +
      notifyHtml +
      '<h2 class="section-title">Copie di sicurezza</h2><div class="list">' +
      '<button type="button" class="action-row" data-action="export"><div class="left"><span>Esporta backup JSON</span><span>Scarica una copia di tutti i dati</span></div>' + iconChevron() + "</button>" +
      '<button type="button" class="action-row" data-action="import"><div class="left"><span>Importa backup JSON</span><span>Sostituisce i dati attuali</span></div>' + iconChevron() + "</button></div>" +
      '<h2 class="section-title">Dati</h2><div class="list">' +
      '<button type="button" class="action-row" data-action="demo"><div class="left"><span>Carica dati di esempio</span><span>Utile per provare l\'app (sovrascrive i dati)</span></div>' + iconChevron() + "</button>" +
      '<button type="button" class="action-row" data-action="reset"><div class="left"><span class="danger">Cancella tutti i dati</span><span>' + n + " elementi salvati su questo dispositivo</span></div></button></div>" +
      '<h2 class="section-title">Su questa app</h2><div class="callout legal"><strong>Mie Cose</strong> è un\'app personale, gratuita e senza account. Funziona anche offline dopo la prima apertura. Per installarla su iPhone: Safari → pulsante Condividi → <strong>Aggiungi alla schermata Home</strong>. Il tema chiaro o scuro segue le impostazioni del telefono.</div>';
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mie-cose-backup-" + todayISO() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast("Backup esportato");
  }

  function importBackupFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const raw = JSON.parse(String(reader.result || ""));
        if (!isValidBackup(raw)) { toast("File non valido"); return; }
        if (!window.confirm("L'importazione sostituisce tutti i dati attuali. Continuare?")) return;
        data = normalize(raw);
        save();
        tab = "home";
        examDetailId = null;
        render();
        toast("Dati importati");
      } catch (err) {
        toast("Impossibile leggere il file");
      }
    };
    reader.readAsText(file);
  }

  function addDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return toISODate(d);
  }

  function loadDemo() {
    const t = todayISO();
    const ym = t.slice(0, 7);
    const year = new Date().getFullYear();
    data = {
      version: 1,
      tasks: [
        { id: uid(), title: "Visita immobile in Via Roma 12", due: addDays(1) + "T10:30", priority: "alta", category: "lavoro", notes: "Chiavi dal proprietario, portare planimetria.", done: false, createdAt: new Date().toISOString() },
        { id: uid(), title: "Ripassare Diritto privato — obbligazioni", due: t, priority: "alta", category: "studio", notes: "Capitoli 4 e 5, casi pratici.", done: false, createdAt: new Date().toISOString() },
        { id: uid(), title: "Inviare preventivo editing articolo", due: addDays(-2), priority: "media", category: "lavoro", notes: "Testo di circa 12 cartelle.", done: false, createdAt: new Date().toISOString() },
        { id: uid(), title: "Ordinare servomotori MG996R", due: addDays(4), priority: "media", category: "braccio", notes: "Servono 6 pezzi.", done: false, createdAt: new Date().toISOString() },
        { id: uid(), title: "Chiamare il notaio per l'atto di martedì", due: t + "T16:00", priority: "alta", category: "lavoro", notes: "", done: true, createdAt: new Date().toISOString() }
      ],
      exams: [
        {
          id: "ex-privato",
          materia: "Diritto privato",
          dataAppello: addDays(18),
          cfu: 12,
          stato: "in-corso",
          voto: null,
          lode: false,
          targetHours: 40,
          notes: "Programma: contratti, obbligazioni, diritti reali.",
          sessions: [
            { id: uid(), date: addDays(-2), minutes: 90, notes: "Obbligazioni: adempimento e mora." },
            { id: uid(), date: addDays(-5), minutes: 75, notes: "Introduzione ai diritti reali." }
          ]
        },
        { id: uid(), materia: "Diritto costituzionale", dataAppello: addDays(40), cfu: 9, stato: "da-preparare", voto: null, lode: false, targetHours: 30, notes: "", sessions: [] },
        { id: uid(), materia: "Istituzioni di diritto romano", dataAppello: addDays(-60), cfu: 9, stato: "superato", voto: 28, lode: false, targetHours: 25, notes: "Superato a giugno.", sessions: [] }
      ],
      transactions: [
        { id: uid(), type: "entrata", amount: 850, date: ym + "-03", category: "commissioni", freelance: false, note: "Provvigione visita conclusa" },
        { id: uid(), type: "entrata", amount: 320, date: ym + "-08", category: "freelance", freelance: true, note: "Editing articolo giuridico" },
        { id: uid(), type: "uscita", amount: 46.9, date: ym + "-06", category: "studio", freelance: false, note: "Manuale di diritto privato" },
        { id: uid(), type: "uscita", amount: 62.4, date: ym + "-09", category: "cibo", freelance: false, note: "Spesa settimanale" },
        { id: uid(), type: "uscita", amount: 28.5, date: ym + "-11", category: "braccio", freelance: false, note: "Filamento PLA" },
        { id: uid(), type: "entrata", amount: 180, date: year + "-02-14", category: "freelance", freelance: true, note: "Revisione tesi (febbraio)" }
      ],
      arm: {
        milestones: [
          { id: uid(), title: "Progetto e misure del telaio", due: addDays(-10), done: true },
          { id: uid(), title: "Stampare le articolazioni in PLA", due: addDays(7), done: false },
          { id: uid(), title: "Montare servomotori e cablaggio", due: addDays(20), done: false },
          { id: uid(), title: "Scrivere il firmware di controllo", due: addDays(35), done: false }
        ],
        parts: [
          { id: uid(), name: "Arduino Uno", qty: 1, cost: 24.9, bought: true, note: "Già in cassetto" },
          { id: uid(), name: "Servomotore MG996R", qty: 6, cost: 8.5, bought: false, note: "" },
          { id: uid(), name: "Filamento PLA 1 kg", qty: 1, cost: 18.9, bought: true, note: "Bianco" },
          { id: uid(), name: "Alimentatore 6 V 5 A", qty: 1, cost: 16, bought: false, note: "" }
        ],
        log: [
          { id: uid(), date: addDays(-3), text: "Prima prova di stampa del polso: la tolleranza era stretta, allargare di 0,3 mm." },
          { id: uid(), date: addDays(-8), text: "Scelto lo schema a 5 gradi di libertà, base rotante esclusa per ora." }
        ],
        poses: [
          { id: uid(), name: "Riposo", joints: { base: 25, shoulder: -35, elbow: 55, wrist: 20, roll: 0, gripper: 40 } },
          { id: uid(), name: "Presa", joints: { base: 8, shoulder: 8, elbow: 92, wrist: 22, roll: 0, gripper: 6 } }
        ],
        joints: { base: 25, shoulder: -35, elbow: 55, wrist: 20, roll: 0, gripper: 40 }
      }
    };
    data = normalize(data);
    save();
  }

  function completeTask(task, at) {
    at = at || {};
    if (at.wrap && at.wrap.classList.contains("completing")) return;
    const willBeDone = !task.done;
    const apply = function () {
      task.done = willBeDone;
      if (willBeDone) task.doneAt = new Date().toISOString();
      save();
      render();
    };
    if (!willBeDone) {
      apply();
      toast("Attività riaperta");
      return;
    }
    const undo = function () { task.done = false; delete task.doneAt; save(); render(); toast("Annullato"); };
    if (MM && !MM.reduced()) {
      if (at.check) { at.check.classList.add("on", "just-on"); }
      if (at.wrap) at.wrap.classList.add("completing");
      MM.confetti(at.x, at.y, { count: 46, power: 0.8 });
      MM.haptic(14);
      const left = data.tasks.filter(function (x) { return !x.done && x !== task; }).length;
      setTimeout(function () {
        apply();
        if (!left) { MM.celebrate(); toast("Hai finito tutto. Ottimo lavoro!", { tone: "win", action: "Annulla", onAction: undo }); }
        else toast("Fatto. Ne restano " + left, { action: "Annulla", onAction: undo });
      }, 480);
    } else {
      apply();
      toast("Fatto", { action: "Annulla", onAction: undo });
    }
  }

  function deleteTaskWithUndo(id) {
    const idx = data.tasks.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    const removed = data.tasks.splice(idx, 1)[0];
    save();
    render();
    toast("Attività eliminata", {
      action: "Annulla",
      onAction: function () {
        data.tasks.splice(Math.min(idx, data.tasks.length), 0, removed);
        save();
        render();
        toast("Ripristinata");
      }
    });
  }

  function onClick(e) {
    const t = e.target.closest("[data-month-set], [data-tab], [data-action], [data-task-filter], [data-toggle-task], [data-edit-task], [data-open], [data-open-exam], [data-edit-exam], [data-edit-session], [data-edit-tx], [data-month-delta], [data-toggle-milestone], [data-edit-milestone], [data-edit-part], [data-edit-log], #fab, #back-btn, #settings-btn");
    if (!t) return;

    if (t.id === "back-btn") {
      if (examDetailId) examDetailId = null;
      else if (tab === "settings") tab = "home";
      render();
      return;
    }
    if (t.id === "settings-btn") {
      tab = "settings";
      examDetailId = null;
      render();
      return;
    }
    if (t.id === "fab") {
      handleAction(t.dataset.action || ({ tasks: "add-task", study: "add-exam", money: "add-tx" }[tab]));
      return;
    }
    if (t.dataset.monthSet) {
      const parts = t.dataset.monthSet.split("-").map(Number);
      moneyCursor = new Date(parts[0], parts[1] - 1, 1);
      if (MM) MM.haptic(6);
      render();
      return;
    }
    if (t.dataset.tab) {
      if (t.dataset.tab !== tab || examDetailId) { if (MM) MM.haptic(6); }
      setTab(t.dataset.tab);
      return;
    }
    if (t.dataset.taskFilter) { taskFilter = t.dataset.taskFilter; render(); return; }
    if (t.dataset.toggleTask) {
      const task = data.tasks.find(function (x) { return x.id === t.dataset.toggleTask; });
      if (!task) return;
      const r = t.getBoundingClientRect();
      completeTask(task, { x: r.left + r.width / 2, y: r.top + r.height / 2, check: t, wrap: t.closest(".swipe") });
      return;
    }
    if (t.dataset.editTask) { openTaskForm(t.dataset.editTask); return; }
    if (t.dataset.open) {
      if (t.dataset.open === "task") { setTab("tasks"); openTaskForm(t.dataset.id); }
      else if (t.dataset.open === "exam") { tab = "study"; examDetailId = t.dataset.id; render(); }
      return;
    }
    if (t.dataset.openExam) { examDetailId = t.dataset.openExam; render(); return; }
    if (t.dataset.editExam) { openExamForm(t.dataset.editExam); return; }
    if (t.dataset.editSession) { openSessionForm(examDetailId, t.dataset.editSession); return; }
    if (t.dataset.editTx) { openTxForm(t.dataset.editTx); return; }
    if (t.dataset.monthDelta) {
      moneyCursor = new Date(moneyCursor.getFullYear(), moneyCursor.getMonth() + Number(t.dataset.monthDelta), 1);
      render();
      return;
    }
    if (t.dataset.toggleMilestone) {
      const m = data.arm.milestones.find(function (x) { return x.id === t.dataset.toggleMilestone; });
      if (m) {
        m.done = !m.done;
        save();
        if (m.done && MM) {
          const r = t.getBoundingClientRect();
          MM.confetti(r.left + r.width / 2, r.top + r.height / 2, { count: 60 });
          MM.haptic(12);
          const allDone = data.arm.milestones.length && data.arm.milestones.every(function (x) { return x.done; });
          if (allDone) setTimeout(function () { MM.celebrate(); toast("Tutte le tappe completate!", { tone: "win" }); }, 250);
        }
        render();
      }
      return;
    }
    if (t.dataset.editMilestone) { openMilestoneForm(t.dataset.editMilestone); return; }
    if (t.dataset.editPart) { openPartForm(t.dataset.editPart); return; }
    if (t.dataset.editLog) { openLogForm(t.dataset.editLog); return; }
    if (t.dataset.action === "phrase-unfav") {
      const n = t.dataset.n;
      data.phrases.favorites = (data.phrases.favorites || []).filter(function (f) { return String(f.n) !== String(n); });
      save();
      toast("Tolta dai preferiti");
      render();
      return;
    }
    if (t.dataset.action) handleAction(t.dataset.action);
  }

  function handleAction(action) {
    switch (action) {
      case "add-task": openTaskForm(); break;
      case "add-exam": openExamForm(); break;
      case "add-session": if (examDetailId) openSessionForm(examDetailId); break;
      case "add-tx": openTxForm(); break;
      case "add-milestone": openMilestoneForm(); break;
      case "add-part": openPartForm(); break;
      case "add-log": openLogForm(); break;
      case "goto-settings": tab = "settings"; render(); break;
      case "phrase-new":
        drawNextPhrase();
        render();
        break;
      case "phrase-fav":
        toggleFavorite(displayedPhrase());
        render();
        break;
      case "phrase-share": {
        const cur = displayedPhrase();
        if (cur) sharePhrase(cur.text);
        break;
      }
      case "toggle-notify-phrases": toggleNotifySetting("notifyPhrases"); break;
      case "toggle-notify-deadlines": toggleNotifySetting("notifyDeadlines"); break;
      case "push-subscribe": subscribePushIfConfigured(); break;
      case "export": exportBackup(); break;
      case "import": $("#import-file").click(); break;
      case "demo":
        if (!window.confirm("I dati di esempio sostituiscono quelli attuali. Continuare?")) return;
        loadDemo();
        tab = "home";
        examDetailId = null;
        render();
        toast("Dati di esempio caricati");
        break;
      case "reset":
        if (!window.confirm("Vuoi davvero cancellare tutti i dati? L'operazione non si può annullare, salvo un backup già esportato.")) return;
        data = emptyData();
        save();
        tab = "home";
        examDetailId = null;
        render();
        toast("Dati cancellati");
        break;
    }
  }

  function init() {
    load();
    if (MM) {
      MM.init();
      MM.swipeHandlers.right = function (id, at) {
        const task = data.tasks.find(function (x) { return x.id === id; });
        if (!task) return;
        if (task.done) { completeTask(task, {}); return; }
        if (MM) MM.confetti(at.x, at.y, { count: 46, power: 0.8 });
        task.done = true;
        task.doneAt = new Date().toISOString();
        save();
        render();
        const left = data.tasks.filter(function (x) { return !x.done; }).length;
        const undo = function () { task.done = false; delete task.doneAt; save(); render(); toast("Annullato"); };
        if (!left) { MM.celebrate(); toast("Hai finito tutto. Ottimo lavoro!", { tone: "win", action: "Annulla", onAction: undo }); }
        else toast("Fatto. Ne restano " + left, { action: "Annulla", onAction: undo });
      };
      MM.swipeHandlers.left = function (id) { deleteTaskWithUndo(id); };
      MM.canPull = function () { return tab === "home" && !examDetailId && $("#sheet-root").hidden; };
      MM.pullHandler = function () { drawNextPhrase(); render(); };
      MM.onTick(liveTick);
    }
    const params = new URLSearchParams(location.search);
    if (params.has("demo") && !data.tasks.length && !data.exams.length && !data.transactions.length) {
      loadDemo();
    }
    if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
      document.body.classList.add("standalone");
    }
    document.addEventListener("click", onClick);
    $("#import-file").addEventListener("change", function (e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (file) importBackupFile(file);
    });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("#sheet-root").hidden) closeSheet();
    });
    window.addEventListener("mia-arm3d-ready", function () {
      if (tab === "arm" && !examDetailId) mountArm3D();
    });
    render();
    armSlotTimer();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        maybeNotifyPhrase();
        maybeNotifyDeadlines();
        if (tab === "home" && !examDetailId) render();
      }
    });
    window.addEventListener("focus", function () {
      maybeNotifyPhrase();
      maybeNotifyDeadlines();
    });
    setTimeout(function () {
      maybeNotifyPhrase();
      maybeNotifyDeadlines();
    }, 800);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
