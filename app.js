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

  function paintContent(html) {
    if (window.MiaArm3D && window.MiaArm3D.isMounted && window.MiaArm3D.isMounted()) {
      if (data && data.arm) data.arm.joints = window.MiaArm3D.getJoints();
      window.MiaArm3D.unmount();
    }
    const el = $("#content");
    el.classList.remove("enter");
    el.innerHTML = html;
    void el.offsetWidth;
    el.classList.add("enter");
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
  function toast(msg) {
    const root = $("#toast-root");
    root.innerHTML = '<div class="toast">' + escapeHtml(msg) + "</div>";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { root.innerHTML = ""; }, 2400);
  }

  function closeSheet() {
    const root = $("#sheet-root");
    root.hidden = true;
    root.innerHTML = "";
  }

  function openSheet(opts) {
    const title = opts.title;
    const body = opts.body;
    const onSave = opts.onSave;
    const saveLabel = opts.saveLabel || "Salva";
    const onDelete = opts.onDelete;
    const deleteLabel = opts.deleteLabel || "Elimina";
    const root = $("#sheet-root");
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
      paintContent(exam ? renderExamDetail(exam) : '<p class="empty">Esame non trovato.</p>');
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
    paintContent(view.render());
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

    return '<div class="stats">' +
      '<div class="stat tint-tasks"><div class="stat-row"><div class="copy"><p class="label">Da fare</p><div class="value">' + openTasks.length +
      '</div><div class="sub">' + taskSub + '</div></div>' + progressRing(taskPct, { size: 56, stroke: 6, cls: "tasks" }) + "</div></div>" +
      '<div class="stat tint-study"><p class="label">Prossimo esame</p><div class="value" style="font-size:18px;padding-top:4px">' +
      (nextExam ? escapeHtml(relativeDue(nextExam.dataAppello) || "—") : "—") +
      '</div><div class="sub">' + examSub + "</div></div>" +
      '<div class="stat tint-money"><p class="label">Questo mese</p><div class="value amount ' + (monthBal >= 0 ? "pos" : "neg") + '">' +
      formatEuro(monthBal) + '</div><div class="mini-bars" style="margin-top:8px">' +
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
    const segs = '<div class="segments" role="tablist">' + filters.map(function (f) {
      return '<button type="button" role="tab" class="' + (taskFilter === f[0] ? "active" : "") + '" data-task-filter="' + f[0] + '">' + f[1] + "</button>";
    }).join("") + "</div>";

    const list = tasks.length
      ? '<div class="list">' + tasks.map(taskRow).join("") + "</div>"
      : emptyState(taskFilter === "completati" ? "Nessun completato" : "Niente da fare qui", "Tocca + per aggiungere una cosa da fare, con data, priorità e categoria.", "tasks");

    return segs + list;
  }

  function taskRow(t) {
    const overdue = isOverdue(t);
    return '<div class="row" data-task-id="' + t.id + '">' +
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
      "</div></button></div>";
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
    const list = exams.length ? exams.map(examCard).join("") : emptyState("Nessun esame", "Aggiungi le materie con data d'appello, CFU e stato. Potrai annotare le sessioni di studio.", "study");

    return '<div class="hero-stat hero-split"><div class="hero-copy"><p class="label">Media ponderata</p><div class="value">' + mediaLabel + "</div>" +
      '<div class="row-meta" style="margin-top:8px"><span>' + totals.acquisiti + " CFU acquisiti · " + totals.previsti + " CFU previsti</span></div>" +
      '<p class="hint" style="margin:10px 0 0">La media è calcolata sugli esami superati con voto. Se hai 30 e lode, la lode è conteggiata come 30 (alcuni atenei usano 31 o 32).</p></div>' +
      ringBlock(pct, totals.previsti ? Math.round(pct) + "%" : "—", "CFU", { size: 96, stroke: 8, cls: "study" }) +
      "</div>" +
      '<h2 class="section-title">Esami</h2>' + list;
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
    return '<button type="button" class="exam-card" data-open-exam="' + e.id + '">' +
      '<div class="top"><div><h3>' + escapeHtml(e.materia) + '</h3><div class="meta">' +
      (e.cfu ? e.cfu + " CFU" : "CFU non indicati") +
      (e.dataAppello ? " · " + escapeHtml(formatDate(e.dataAppello, { short: true })) : "") +
      progress +
      '</div></div><div class="exam-side"><span class="pill ' + e.stato + '">' +
      escapeHtml(labelOf(EXAM_STATES, e.stato)) + "</span>" + voto + ring + "</div></div></button>";
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
      '<p class="label" style="margin:0">Tempo di studio</p>' +
      '<div class="value" style="font-size:28px;margin-top:4px">' + (mins ? formatHours(mins) : "—") + "</div>" +
      (target ? '<p class="hint" style="margin:8px 0 0">Obiettivo: ' + escapeHtml(String(target)) + " h</p>" : "") +
      (e.notes ? '<p style="margin:12px 0 0;white-space:pre-wrap">' + escapeHtml(e.notes) + "</p>" : "") +
      '<button type="button" class="btn-secondary" data-edit-exam="' + e.id + '" style="margin-top:14px">Modifica esame</button></div>' +
      (target ? ringBlock(pct, Math.round(pct) + "%", "studio", { size: 96, stroke: 8, cls: "study" }) : "") +
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
        if (e) Object.assign(e, payload);
        else data.exams.push(Object.assign({ id: uid(), sessions: [] }, payload));
        save();
        toast(e ? "Esame aggiornato" : "Esame aggiunto");
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
      '<div class="stat" style="padding:0;border:0;box-shadow:none;background:transparent"><p class="label">Entrate</p><div class="value amount pos" style="font-size:18px">' + formatEuro(entrate) + "</div></div>" +
      '<div class="stat" style="padding:0;border:0;box-shadow:none;background:transparent"><p class="label">Uscite</p><div class="value amount neg" style="font-size:18px">' + formatEuro(uscite) + "</div></div>" +
      '<div class="stat" style="padding:0;border:0;box-shadow:none;background:transparent"><p class="label">Saldo</p><div class="value amount ' + (saldo >= 0 ? "pos" : "neg") + '" style="font-size:18px">' + formatEuro(saldo) + "</div></div></div>" +
      '<div class="mini-bars">' +
      '<div class="mini-bar"><span class="lbl">Entrate</span><div class="track"><span style="width:' + Math.round((entrate / monthMax) * 100) + '%"></span></div><span class="amt pos">' + formatEuro(entrate) + "</span></div>" +
      '<div class="mini-bar"><span class="lbl">Uscite</span><div class="track out"><span style="width:' + Math.round((uscite / monthMax) * 100) + '%"></span></div><span class="amt neg">' + formatEuro(uscite) + "</span></div>" +
      "</div>" +
      '<p class="hint" style="margin:10px 0 0">Saldo complessivo: <strong>' + formatEuro(allBal) + "</strong></p></div>" +
      '<h2 class="section-title">Freelance ' + freelanceYear + "</h2>" +
      '<div class="card hero-split" style="padding:16px 18px">' +
      '<div class="hero-copy"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><div>' +
      '<div class="amount" style="font-size:24px">' + formatEuro(flTot) + "</div>" +
      '<div class="muted" style="font-size:13px;margin-top:2px">su ' + formatEuro(SOGLIA_INPS) + " di franchigia</div></div>" +
      '<label class="muted" style="font-size:13px">Anno <select id="freelance-year" style="margin-left:6px;background:var(--fill);border:0;border-radius:8px;padding:6px 8px">' +
      yearOpts.map(function (y) { return '<option value="' + y + '"' + (y === freelanceYear ? " selected" : "") + ">" + y + "</option>"; }).join("") +
      "</select></label></div>" +
      '<p class="hint" style="margin:10px 0 0">' + (over ? "Soglia superata di " + formatEuro(flTot - SOGLIA_INPS) + "." : "Restano " + formatEuro(remain) + " prima della soglia.") + "</p></div>" +
      ringBlock(flPct, Math.round(flPct) + "%", "soglia", { size: 92, stroke: 8, cls: "money " + flTone }) +
      "</div>" +
      '<div class="callout legal ' + (over ? "danger-soft" : near ? "warn" : "") + '" style="margin-top:10px">' +
      "<strong>Promemoria INPS (lavoro autonomo occasionale).</strong> " +
      "I primi " + formatEuro(SOGLIA_INPS) + " di compensi da lavoro autonomo occasionale, sommati da tutti i committenti nell'anno solare (1° gennaio–31 dicembre), costituiscono di norma una franchigia contributiva INPS: sotto questa soglia non scatta l'obbligo di iscrizione alla Gestione Separata. Oltre i " + formatEuro(SOGLIA_INPS) + " i contributi si applicano solo alla parte eccedente e va comunicato tempestivamente il superamento ai committenti. " +
      "Questa sezione è solo un promemoria e non sostituisce un parere fiscale o previdenziale. Resta distinta dal regime del contratto di prestazione occasionale / Libretto Famiglia (art. 54-bis)." +
      "</div>" +
      '<h2 class="section-title">Movimenti</h2>' + list;
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
    return '<div class="callout">I dati restano solo su questo iPhone, nel browser. Non passano da nessun server. Fai un backup di tanto in tanto, soprattutto prima di cancellare i dati di Safari.</div>' +
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
    save();
  }

  function onClick(e) {
    const t = e.target.closest("[data-tab], [data-action], [data-task-filter], [data-toggle-task], [data-edit-task], [data-open], [data-open-exam], [data-edit-exam], [data-edit-session], [data-edit-tx], [data-month-delta], [data-toggle-milestone], [data-edit-milestone], [data-edit-part], [data-edit-log], #fab, #back-btn, #settings-btn");
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
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.dataset.taskFilter) { taskFilter = t.dataset.taskFilter; render(); return; }
    if (t.dataset.toggleTask) {
      const task = data.tasks.find(function (x) { return x.id === t.dataset.toggleTask; });
      if (task) { task.done = !task.done; save(); render(); }
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
      if (m) { m.done = !m.done; save(); render(); }
      return;
    }
    if (t.dataset.editMilestone) { openMilestoneForm(t.dataset.editMilestone); return; }
    if (t.dataset.editPart) { openPartForm(t.dataset.editPart); return; }
    if (t.dataset.editLog) { openLogForm(t.dataset.editLog); return; }
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
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
