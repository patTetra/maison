(() => {
"use strict";

const C = Object.assign({
  TITRE: "Agenda", SCRIPT_URL: "", DEBUT_SEMAINE: 1, NUMEROS_SEMAINES: true,
  DUREE_DEFAUT_MIN: 60, HEURE_DEFAUT: 9, CACHE_SECONDES: 60
}, window.CONFIG || {});

const VERSION = "21 nov. 11:00";
const MOIS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const MOIS_C = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const JOURS = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const JOURS_L = ["D","L","M","M","J","V","S"];

const $ = (s) => document.querySelector(s);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayStr = () => ymd(new Date());
const longDay = (s) => { const d = parseYmd(s); return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()].toLowerCase()}`; };

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

const now0 = new Date();
const S = {
  cursor: new Date(now0.getFullYear(), now0.getMonth(), 1),
  sel: todayStr(),
  cals: LS.get("cals", []),
  hidden: new Set(LS.get("hidden", [])),
  hiddenInit: LS.get("hidden", null) !== null,
  raw: {},
  byDay: new Map(),
  busy: 0,
  error: "",
  list: [],
  plan: LS.get("planCals", null),
  open: LS.get("open2", null),
  selRow: 0
};

/* ---------- Connexion / API ---------- */
const url = () => C.SCRIPT_URL || LS.get("url", "");
const configured = () => !!(url() && LS.get("token", ""));

async function api(action, data) {
  const u = url(), token = LS.get("token", "");
  if (!u || !token) throw new Error("config");
  let res;
  if (action === "create" || action === "update" || action === "delete") {
    res = await fetch(u, { method: "POST", body: JSON.stringify(Object.assign({}, data, { action, token })) });
  } else {
    const q = new URLSearchParams(Object.assign({}, data, { action, token }));
    res = await fetch(u + (u.includes("?") ? "&" : "?") + q.toString());
  }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error("réponse illisible (vérifiez l’adresse du script)"); }
  if (!j.ok) throw new Error(j.error || "erreur");
  return j;
}

/* ---------- Données ---------- */
function norm(e) {
  if (e.allDay) {
    const d0 = e.start;
    let d1 = addDays(e.end, -1);
    if (d1 < d0) d1 = d0;
    return Object.assign({}, e, { d0, d1 });
  }
  const s = new Date(e.start), en = new Date(e.end);
  const d0 = ymd(s);
  const d1 = ymd(new Date(Math.max(+en - 1, +s)));
  return Object.assign({}, e, { s, en, d0, d1 });
}

function rebuild() {
  const seen = new Set(), map = new Map();
  for (const k in S.raw) {
    for (const e of S.raw[k]) {
      const id = e.cal + "|" + e.id + "|" + e.start;
      if (seen.has(id)) continue;
      seen.add(id);
      let d = e.d0, n = 0;
      while (d <= e.d1 && n < 93) {
        if (!map.has(d)) map.set(d, []);
        map.get(d).push(e);
        d = addDays(d, 1); n++;
      }
    }
  }
  S.byDay = map;
}

const calOf = (id) => S.cals.find((c) => c.id === id) || {};
const calColor = (id) => calOf(id).color || "#8e8e93";
const startOn = (e, d) => (e.d0 === d ? +e.s : +parseYmd(d));

const PLAN_RE = /^\s*patrick\s+(jour|soir|ve|rh|rtt|cp|matin|nuit)\b/i;
function planSet() {
  if (Array.isArray(S.plan)) return new Set(S.plan);
  return new Set(S.cals.filter((c) => /planning/i.test(c.name)).map((c) => c.id));
}
function kindOf(evs) {
  const t = evs.map((e) => e.title).join(" ");
  if (/soir/i.test(t)) return "soir";
  if (/\bVE\b/i.test(t)) return "ve";
  if (/jour/i.test(t)) return "jour";
  if (/rtt/i.test(t)) return "rtt";
  return evs.length ? "rh" : "";
}
const shortTitle = (evs) => evs.map((e) => e.title.replace(/^\s*patrick\s*/i, "") || e.title).join(" · ");

function planEvents(d) {
  const ps = planSet();
  return (S.byDay.get(d) || []).filter((e) => (ps.size ? ps.has(e.cal) : PLAN_RE.test(e.title)));
}

function dayEvents(d) {
  const a = (S.byDay.get(d) || []).filter((e) => !S.hidden.has(e.cal));
  return a.sort((x, y) => {
    if (x.allDay !== y.allDay) return x.allDay ? -1 : 1;
    if (x.allDay) return (calOf(x.cal).name || "").localeCompare(calOf(y.cal).name || "");
    return startOn(x, d) - startOn(y, d);
  });
}

function monthRange(y, m) {
  const ws = C.DEBUT_SEMAINE;
  const first = new Date(y, m, 1);
  const off = (first.getDay() - ws + 7) % 7;
  const start = new Date(y, m, 1 - off);
  const n = new Date(y, m + 1, 0).getDate();
  const weeks = Math.ceil((off + n) / 7);
  const end = new Date(start);
  end.setDate(end.getDate() + weeks * 7);
  return { start, end, weeks };
}

function prune() {
  try {
    const cm = S.cursor.getFullYear() * 12 + S.cursor.getMonth();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("ev_")) {
        const [yy, mm] = k.slice(3).split("-").map(Number);
        if (Math.abs(yy * 12 + (mm - 1) - cm) > 3) localStorage.removeItem(k);
      }
    }
  } catch (e) {}
}

async function ensureMonth(y, m, force) {
  const key = `${y}-${pad(m + 1)}`;
  const c = LS.get("ev_" + key, null);
  if (c && !S.raw[key]) {
    S.raw[key] = c.events.map(norm);
    rebuild(); renderAll();
  }
  if (!configured()) return;
  const fresh = c && Date.now() - c.t < C.CACHE_SECONDES * 1000;
  if (fresh && !force) return;
  S.busy++; setStatus();
  try {
    const { start, end } = monthRange(y, m);
    const j = await api("events", { from: start.toISOString(), to: end.toISOString() });
    S.cals = j.calendars; LS.set("cals", S.cals);
    if (!S.hiddenInit) {
      S.hidden = new Set(S.cals.filter((x) => x.selected === false).map((x) => x.id));
      LS.set("hidden", [...S.hidden]); S.hiddenInit = true;
    }
    S.raw[key] = j.events.map(norm);
    rebuild();
    LS.set("ev_" + key, { t: Date.now(), events: j.events });
    S.error = "";
  } catch (err) {
    S.error = err.message === "config" ? "" : "Hors ligne ou erreur : " + err.message;
  } finally {
    S.busy--; setStatus(); renderAll();
  }
}

const monthOf = (delta) => { const d = new Date(S.cursor.getFullYear(), S.cursor.getMonth() + delta, 1); return [d.getFullYear(), d.getMonth()]; };

async function loadAround(force) {
  prune();
  await ensureMonth(...monthOf(0), force);
  ensureMonth(...monthOf(-1), force);
  ensureMonth(...monthOf(1), force);
}

function setStatus() {
  const el = $("#status");
  el.textContent = S.error || (S.busy ? "Mise à jour…" : "");
  el.classList.toggle("err", !!S.error);
}

/* ---------- Rendu ---------- */
function renderAll() { renderHead(); renderGrid(); renderList(); }

function renderHead() {
  $("#title").innerHTML = `${MOIS[S.cursor.getMonth()]}<small>${S.cursor.getFullYear()}</small>`;
}

function renderGrid() {
  const y = S.cursor.getFullYear(), m = S.cursor.getMonth();
  const ws = C.DEBUT_SEMAINE;
  const { start, weeks } = monthRange(y, m);
  const today = todayStr();
  let h = `<div class="wk"><span></span>`;
  for (let i = 0; i < 7; i++) h += `<span>${JOURS_L[(ws + i) % 7]}</span>`;
  h += `</div>`;
  h += `<div class="rw"><div class="rows">`;
  S.selRow = 0;
  for (let w = 0; w < weeks; w++) {
    const r0 = new Date(start); r0.setDate(r0.getDate() + w * 7);
    if (S.sel >= ymd(r0) && S.sel <= addDays(ymd(r0), 6)) S.selRow = w;
    const thu = new Date(r0); thu.setDate(thu.getDate() + ((4 - ws + 7) % 7));
    h += `<div class="row7"><span class="wn">${C.NUMEROS_SEMAINES ? isoWeek(thu) : ""}</span>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(r0); d.setDate(d.getDate() + i);
      const s = ymd(d);
      const all = planEvents(s);
      const cls = ["day", "pc"];
      if (d.getMonth() !== m) cls.push("other");
      if (d.getDay() === 0 || d.getDay() === 6) cls.push("we");
      if (s === today) cls.push("today");
      if (s === S.sel) cls.push("sel");
      const k = kindOf(all);
      if (k) cls.push("k-" + k);
      h += `<button class="${cls.join(" ")}" data-d="${s}"><span class="n">${d.getDate()}</span><span class="lb">${esc(shortTitle(all))}</span></button>`;
    }
    h += `</div>`;
  }
  h += `</div></div>`;
  $("#grid").innerHTML = h;
  applyOpen();
}

/* Hauteur du mois réglable : 0 = seulement la semaine du jour choisi, 1 = le mois occupe presque tout l'écran */
function metrics() {
  const rw = $("#grid .rw"), rows = $("#grid .rows");
  if (!rw || !rows || !rows.children.length) return null;
  const kids = Array.from(rows.children);
  kids.forEach((k) => { k.style.height = ""; });
  rows.style.removeProperty("--sc");
  rows.style.transform = "";
  const row = kids[Math.min(S.selRow, kids.length - 1)];
  const nat = rows.offsetHeight, minH = row.offsetHeight, selTop = row.offsetTop;
  const topRel = rw.getBoundingClientRect().top - document.body.getBoundingClientRect().top;
  const used = $("#handle").offsetHeight + $("#bar").offsetHeight + 110;
  const maxH = Math.max(nat, document.body.clientHeight - topRel - used);
  return { rw, rows, kids, nat, minH, selTop, maxH, natFrac: (nat - minH) / Math.max(1, maxH - minH) };
}

function applyOpen() {
  const m = metrics();
  if (!m) return;
  if (S.open == null || isNaN(S.open)) S.open = m.natFrac;
  S.open = Math.min(1, Math.max(0, S.open));
  const H = m.minH + (m.maxH - m.minH) * S.open;
  m.rw.style.height = H + "px";
  if (H <= m.nat) {
    const prog = (m.nat - H) / Math.max(1, m.nat - m.minH);
    m.rows.style.transform = `translateY(${-m.selTop * prog}px)`;
  } else {
    const rh = H / m.kids.length;
    m.kids.forEach((k) => { k.style.height = rh + "px"; });
    m.rows.style.setProperty("--sc", Math.min(1.9, H / m.nat).toFixed(2));
  }
}

function renderList() {
  const d = S.sel;
  const evs = dayEvents(d);
  S.list = evs;
  const dt = parseYmd(d);
  let h = `<div class="dh ${d === todayStr() ? "today" : ""}"><b>${longDay(d)}</b><span>S${isoWeek(dt)}</span></div>`;
  if (!evs.length) h += `<div class="empty">Aucun événement</div>`;
  evs.forEach((e, i) => {
    const col = esc(calColor(e.cal));
    const loc = e.location ? `<div class="l">${esc(e.location)}</div>` : "";
    if (e.allDay) {
      h += `<button class="ev" data-i="${i}"><span class="dot" style="background:${col}"></span><span class="tx"><div class="t">${esc(e.title)}</div>${loc}</span><span class="h">jour entier</span></button>`;
    } else {
      const a = e.d0 === d ? hhmm(e.s) : "…";
      const b = e.d1 === d ? hhmm(e.en) : "…";
      h += `<button class="ev" data-i="${i}"><span class="bar" style="background:${col}"></span><span class="tx"><div class="t">${esc(e.title)}</div>${loc}</span><span class="h"><b>${a}</b>${b}</span></button>`;
    }
  });
  const el = $("#list");
  el.innerHTML = h;
}

/* ---------- Navigation ---------- */
function selectDay(s) {
  S.sel = s;
  const dt = parseYmd(s);
  if (dt.getMonth() !== S.cursor.getMonth() || dt.getFullYear() !== S.cursor.getFullYear()) {
    S.cursor = new Date(dt.getFullYear(), dt.getMonth(), 1);
    loadAround();
  }
  renderAll();
  $("#list").scrollTop = 0;
}

function goMonth(delta) {
  if (S.open != null && S.open < 0.03) { selectDay(addDays(S.sel, delta * 7)); return; }
  S.cursor = new Date(S.cursor.getFullYear(), S.cursor.getMonth() + delta, 1);
  const t = parseYmd(todayStr());
  S.sel = (t.getFullYear() === S.cursor.getFullYear() && t.getMonth() === S.cursor.getMonth()) ? todayStr() : ymd(S.cursor);
  renderAll(); loadAround();
}

function goToday() {
  const t = new Date();
  S.cursor = new Date(t.getFullYear(), t.getMonth(), 1);
  S.sel = todayStr();
  renderAll(); loadAround();
  $("#list").scrollTop = 0;
}

/* ---------- Fenêtres ---------- */
const dlgOpen = (s) => { const d = $(s); if (!d.open) d.showModal(); };
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

/* Détail */
function openDetail(e) {
  const c = calOf(e.cal);
  let when;
  if (e.allDay) {
    when = e.d0 === e.d1 ? longDay(e.d0) : `Du ${longDay(e.d0)} au ${longDay(e.d1)}`;
    when += " · jour entier";
  } else if (e.d0 === e.d1) {
    when = `${longDay(e.d0)}, ${hhmm(e.s)} – ${hhmm(e.en)}`;
  } else {
    const f = (d) => `${d.getDate()} ${MOIS_C[d.getMonth()]} ${hhmm(d)}`;
    when = `${f(e.s)} → ${f(e.en)}`;
  }
  const link = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  let h = `<h2>${esc(e.title)}</h2><div class="meta">${esc(when)}</div>`;
  h += `<div class="box"><small>Agenda</small><span style="color:${esc(c.color || "#8e8e93")}">●</span> ${esc(c.name || "")}</div>`;
  if (e.location) h += `<div class="box"><small>Lieu</small>${esc(e.location)}</div>`;
  if (e.description) h += `<div class="box"><small>Notes</small>${link(e.description)}</div>`;
  h += `<p class="err" id="dErr"></p>`;
  if (e.rec) h += `<p class="hint">Cet événement se répète : « Modifier » ne change que cette occurrence.</p>`;
  h += `<div class="acts"><button type="button" class="btn" data-act="edit">Modifier</button>` +
    (e.rec
      ? `<button type="button" class="btn del" data-act="del1">Supprimer cette occurrence</button><button type="button" class="btn del" data-act="delall">Supprimer toute la série</button>`
      : `<button type="button" class="btn del" data-act="del1">Supprimer</button>`) + `</div>`;
  S.cur = e;
  $("#detail").innerHTML = h;
  dlgOpen("#dDetail");
}

/* Création */
let dur = 3600000, durDays = 0;
const isAll = () => $("#cAll").checked;
const startDate = () => isAll() ? parseYmd($("#cD0").value) : new Date($("#cD0").value + "T" + ($("#cT0").value || "00:00"));
const endDate = () => isAll() ? parseYmd($("#cD1").value) : new Date($("#cD1").value + "T" + ($("#cT1").value || "00:00"));

function applyEnd() {
  if (!$("#cD0").value) return;
  if (isAll()) { $("#cD1").value = addDays($("#cD0").value, durDays); return; }
  const e = new Date(+startDate() + dur);
  $("#cD1").value = ymd(e); $("#cT1").value = hhmm(e);
}

function readDuration() {
  if (isAll()) durDays = Math.max(0, daysBetween($("#cD0").value, $("#cD1").value));
  else dur = Math.max(0, +endDate() - +startDate());
}

const AL_TIMED = [["def", ""], ["none", "Aucune"], ["0", "À l’heure de l’événement"], ["5", "5 minutes avant"], ["10", "10 minutes avant"], ["15", "15 minutes avant"], ["30", "30 minutes avant"], ["60", "1 heure avant"], ["120", "2 heures avant"], ["1440", "1 jour avant"]];
const AL_ALL = [["def", ""], ["none", "Aucune"], ["360", "La veille à 18 h"], ["900", "La veille à 9 h"], ["2340", "2 jours avant, 9 h"], ["9540", "1 semaine avant, 9 h"]];

function fillAlerts() {
  const opts = (isAll() ? AL_ALL : AL_TIMED).map(([v, t]) => `<option value="${v}">${esc(v === "def" ? (S.edit ? "Inchangées" : "Par défaut de l’agenda") : t)}</option>`).join("");
  $("#cAl1").innerHTML = opts;
  $("#cAl2").innerHTML = opts;
  syncAl2();
}
function syncAl2() {
  const v = $("#cAl1").value;
  $("#rAl2").style.display = (v === "def" || v === "none") ? "none" : "";
  if (v === "def" || v === "none") $("#cAl2").value = "def";
}
$("#cAl1").addEventListener("change", syncAl2);

function toggleAll() {
  fillAlerts();
  $("#fCreate").classList.toggle("allday", isAll());
  if (isAll()) durDays = 0; else dur = C.DUREE_DEFAUT_MIN * 60000;
  applyEnd();
}

function syncRep() { $("#rUntil").style.display = $("#cRep").value ? "" : "none"; }
$("#cRep").addEventListener("change", syncRep);

function openCreate(edit) {
  if (!S.cals.length) { openSettings(); return; }
  S.edit = edit || null;
  $("#cHead").textContent = edit ? "Modifier" : "Nouvel événement";
  $("#cSave").textContent = edit ? "Enregistrer" : "Ajouter";
  $("#cCal").disabled = !!edit;
  $("#rRep").style.display = edit ? "none" : "";
  $("#cRep").value = ""; $("#cUntil").value = ""; syncRep();
  const cals = S.cals.slice().sort((a, b) => (b.owned - a.owned) || a.name.localeCompare(b.name));
  $("#cCal").innerHTML = cals.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.owned ? "" : " (partagé)"}</option>`).join("");
  const last = LS.get("lastCal", "");
  if (cals.some((c) => c.id === last)) $("#cCal").value = last;
  $("#cTitle").value = ""; $("#cLoc").value = ""; $("#cNote").value = ""; $("#cErr").textContent = "";
  $("#cAll").checked = false;
  const n = new Date();
  const hr = S.sel === todayStr() ? Math.min(23, n.getHours() + 1) : C.HEURE_DEFAUT;
  $("#cD0").value = S.sel; $("#cT0").value = pad(hr) + ":00";
  $("#fCreate").classList.remove("allday");
  dur = C.DUREE_DEFAUT_MIN * 60000;
  applyEnd();
  fillAlerts();
  if (edit) {
    $("#cCal").value = edit.cal;
    $("#cTitle").value = edit.title; $("#cLoc").value = edit.location || ""; $("#cNote").value = edit.description || "";
    $("#cAll").checked = edit.allDay;
    $("#fCreate").classList.toggle("allday", edit.allDay);
    fillAlerts();
    if (edit.allDay) { $("#cD0").value = edit.d0; $("#cD1").value = edit.d1; }
    else {
      $("#cD0").value = ymd(edit.s); $("#cT0").value = hhmm(edit.s);
      $("#cD1").value = ymd(edit.en); $("#cT1").value = hhmm(edit.en);
    }
    readDuration();
  }
  dlgOpen("#dCreate");
  if (!edit) setTimeout(() => $("#cTitle").focus(), 50);
}

$("#cAll").addEventListener("change", toggleAll);
["#cD0", "#cT0"].forEach((s) => $(s).addEventListener("change", applyEnd));
["#cD1", "#cT1"].forEach((s) => $(s).addEventListener("change", readDuration));

$("#fCreate").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = $("#cErr"); err.textContent = "";
  const all = isAll();
  const data = {
    calendarId: $("#cCal").value,
    title: $("#cTitle").value.trim() || "Sans titre",
    allDay: all,
    location: $("#cLoc").value.trim(),
    description: $("#cNote").value.trim()
  };
  let firstDay;
  if (all) {
    if (!$("#cD0").value || !$("#cD1").value) { err.textContent = "Choisissez les dates."; return; }
    if ($("#cD1").value < $("#cD0").value) { err.textContent = "La fin est avant le début."; return; }
    data.start = $("#cD0").value; data.end = addDays($("#cD1").value, 1); firstDay = data.start;
  } else {
    const s = startDate(), e = endDate();
    if (isNaN(s) || isNaN(e)) { err.textContent = "Choisissez les dates et heures."; return; }
    if (e <= s) { err.textContent = "La fin doit être après le début."; return; }
    data.start = s.toISOString(); data.end = e.toISOString(); firstDay = ymd(s);
  }
  if (!S.edit && $("#cRep").value) {
    data.repeat = $("#cRep").value;
    const u = $("#cUntil").value;
    if (u) {
      if (u < firstDay) { err.textContent = "La fin de répétition est avant le début."; return; }
      data.repeatUntil = u;
    }
  }
  if (S.edit) {
    data.calendarId = S.edit.cal; data.id = S.edit.id;
    data.origStart = S.edit.start; data.origAllDay = S.edit.allDay;
  }
  const a1 = $("#cAl1").value, a2 = $("#cAl2").value;
  if (a1 === "none") data.alertMode = "none";
  else if (a1 !== "def") {
    data.alertMode = "custom";
    data.alerts = [...new Set([a1, a2].filter((v) => v !== "def" && v !== "none").map(Number))];
  }
  const btn = $("#cSave"); btn.disabled = true; btn.textContent = "…";
  let warn = "";
  try {
    const res = await api(S.edit ? "update" : "create", data);
    if (res.warnings && res.warnings.length) warn = "Enregistré, mais " + res.warnings.join(" ");
    LS.set("lastCal", data.calendarId);
    $("#dCreate").close();
    S.sel = firstDay;
    const d = parseYmd(firstDay);
    S.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    renderAll();
    await loadAround(true);
    if (warn) { S.error = warn; setStatus(); }
  } catch (e) {
    err.textContent = "Échec : " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = S.edit ? "Enregistrer" : "Ajouter";
  }
});

$("#detail").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]");
  if (!b || !S.cur) return;
  const e = S.cur, act = b.dataset.act;
  if (act === "edit") { $("#dDetail").close(); openCreate(e); return; }
  const all = act === "delall";
  if (!confirm(all ? `Supprimer toute la série « ${e.title} » ?` : `Supprimer « ${e.title} » ?`)) return;
  b.disabled = true;
  try {
    await api("delete", { calendarId: e.cal, id: e.id, origStart: e.start, origAllDay: e.allDay, scope: all ? "all" : "one" });
    $("#dDetail").close();
    await loadAround(true);
  } catch (err) {
    b.disabled = false;
    $("#dErr").textContent = "Suppression impossible : " + err.message;
  }
});

/* Recherche */
let sTimer = 0, sSeq = 0;
function srDate(e) {
  const d = parseYmd(e.d0);
  let t = `${JOURS[d.getDay()].slice(0, 3)}. ${d.getDate()} ${MOIS_C[d.getMonth()]} ${d.getFullYear()}`;
  t += e.allDay ? " · jour entier" : ` · ${hhmm(e.s)}`;
  const n = calOf(e.cal).name;
  return n ? `${t} · ${n}` : t;
}
function openSearch() {
  if (!configured()) { openSettings(); return; }
  $("#sQ").value = ""; $("#sRes").innerHTML = "";
  dlgOpen("#dSearch");
  setTimeout(() => $("#sQ").focus(), 50);
}
async function runSearch() {
  const q = $("#sQ").value.trim(), res = $("#sRes");
  if (q.length < 2) { res.innerHTML = ""; return; }
  const my = ++sSeq;
  res.innerHTML = `<p class="hint">Recherche…</p>`;
  try {
    const a = new Date(); a.setFullYear(a.getFullYear() - 1);
    const b = new Date(); b.setFullYear(b.getFullYear() + 2);
    const j = await api("search", { q, from: a.toISOString(), to: b.toISOString() });
    if (my !== sSeq) return;
    S.sres = j.events.map(norm);
    res.innerHTML = S.sres.length
      ? S.sres.map((e, i) => `<button type="button" class="sr" data-i="${i}"><i style="background:${esc(calColor(e.cal))}"></i><span class="srt"><b>${esc(e.title)}</b><small>${esc(srDate(e))}</small></span></button>`).join("")
      : `<p class="hint">Aucun résultat.</p>`;
  } catch (err) {
    if (my === sSeq) res.innerHTML = `<p class="err">${esc(err.message)}</p>`;
  }
}
$("#sQ").addEventListener("input", () => { clearTimeout(sTimer); sTimer = setTimeout(runSearch, 450); });
$("#sQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(sTimer); runSearch(); } });
$("#sRes").addEventListener("click", (e) => {
  const b = e.target.closest(".sr");
  if (!b) return;
  const ev = S.sres[+b.dataset.i];
  $("#dSearch").close();
  selectDay(ev.d0);
});
$("#bSearch").addEventListener("click", openSearch);

/* Agendas visibles */
function openCals() {
  const ps = planSet();
  const cals = S.cals.slice().sort((a, b) => (b.owned - a.owned) || a.name.localeCompare(b.name));
  $("#calList").innerHTML = cals.length
    ? cals.map((c, i) => `<div class="cl${S.hidden.has(c.id) ? " off" : ""}"><label class="lab" for="cb${i}"><i style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span></label><button type="button" class="pk${ps.has(c.id) ? " on" : ""}" data-plan="${esc(c.id)}">Planning</button><input type="checkbox" id="cb${i}" data-id="${esc(c.id)}" ${S.hidden.has(c.id) ? "" : "checked"}></div>`).join("")
    : `<p class="hint">Aucun agenda pour l’instant : renseignez la connexion ci-dessous.</p>`;
  $("#ver").textContent = "Version " + VERSION;
  dlgOpen("#dCals");
}

$("#calList").addEventListener("change", (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.checked) S.hidden.delete(id); else S.hidden.add(id);
  e.target.closest(".cl").classList.toggle("off", !e.target.checked);
  LS.set("hidden", [...S.hidden]);
  renderAll();
});

$("#calList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-plan]");
  if (!b) return;
  const id = b.dataset.plan, ps = planSet();
  if (ps.has(id)) ps.delete(id); else ps.add(id);
  S.plan = [...ps]; LS.set("planCals", S.plan);
  b.classList.toggle("on", ps.has(id));
  renderAll();
});

/* Connexion */
function openSettings() {
  $("#dCals").close();
  $("#sUrl").value = url(); $("#sToken").value = LS.get("token", ""); $("#sErr").textContent = "";
  dlgOpen("#dSettings");
}

$("#fSettings").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const u = $("#sUrl").value.trim(), t = $("#sToken").value.trim();
  const err = $("#sErr");
  if (!u || !t) { err.textContent = "Renseignez l’adresse et le code."; return; }
  const oldU = LS.get("url", ""), oldT = LS.get("token", "");
  LS.set("url", u); LS.set("token", t);
  const btn = $("#sSave"); btn.disabled = true; btn.textContent = "…";
  try {
    const j = await api("ping", {});
    S.cals = j.calendars; LS.set("cals", S.cals);
    $("#dSettings").close();
    S.raw = {}; S.byDay = new Map();
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith("ev_")) localStorage.removeItem(k); }
    renderAll(); await loadAround(true);
  } catch (e) {
    LS.set("url", oldU); LS.set("token", oldT);
    err.textContent = "Connexion impossible : " + (e.message === "config" ? "valeurs manquantes" : e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Enregistrer";
  }
});

/* ---------- Événements d'interface ---------- */
$("#grid").addEventListener("click", (e) => { const b = e.target.closest(".day"); if (b) selectDay(b.dataset.d); });
$("#list").addEventListener("click", (e) => { const b = e.target.closest(".ev"); if (b) openDetail(S.list[+b.dataset.i]); });
$("#bPrev").addEventListener("click", () => goMonth(-1));
$("#bNext").addEventListener("click", () => goMonth(1));
$("#bToday").addEventListener("click", goToday);
$("#bAdd").addEventListener("click", () => openCreate());
$("#bCals").addEventListener("click", openCals);
$("#bSettings").addEventListener("click", openSettings);
$("#bRefresh").addEventListener("click", () => loadAround(true));


let tx = 0, ty = 0;
$("#grid").addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
$("#grid").addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) > 50 && Math.abs(dy) < 40) goMonth(dx < 0 ? 1 : -1);
}, { passive: true });

/* Barre grise : on la glisse pour agrandir ou réduire le mois en direct */
(function () {
  const hd = $("#handle");
  let y0 = 0, o0 = 0, range = 1, moved = false, on = false;
  const setOpen = (v) => { S.open = Math.min(1, Math.max(0, v)); applyOpen(); };
  function start(y) {
    const m = metrics();
    if (!m) return;
    if (S.open == null || isNaN(S.open)) S.open = m.natFrac;
    range = Math.max(1, m.maxH - m.minH);
    y0 = y; o0 = S.open; moved = false; on = true;
    applyOpen();
  }
  function move(y) {
    if (!on) return;
    const dy = y - y0;
    if (Math.abs(dy) > 4) moved = true;
    if (moved) setOpen(o0 + dy / range);
  }
  function end() {
    if (!on) return;
    on = false;
    const m = metrics();
    if (m) {
      if (!moved) {                                      // simple toucher : une semaine → mois → grand → une semaine
        if (S.open < m.natFrac - 0.03) setOpen(m.natFrac);
        else if (S.open < 0.97) setOpen(1);
        else setOpen(0);
      } else if (Math.abs(S.open - m.natFrac) < 0.04) setOpen(m.natFrac);
      else if (S.open > 0.96) setOpen(1);
      else if (S.open < 0.04) setOpen(0);
    }
    LS.set("open2", S.open);
  }
  if ("ontouchstart" in window) {
    hd.addEventListener("touchstart", (e) => start(e.touches[0].clientY), { passive: true });
    hd.addEventListener("touchmove", (e) => { e.preventDefault(); move(e.touches[0].clientY); }, { passive: false });
    hd.addEventListener("touchend", end);
    hd.addEventListener("touchcancel", end);
  } else {
    hd.addEventListener("pointerdown", (e) => { start(e.clientY); try { hd.setPointerCapture(e.pointerId); } catch (err) {} });
    hd.addEventListener("pointermove", (e) => move(e.clientY));
    hd.addEventListener("pointerup", end);
    hd.addEventListener("pointercancel", end);
  }
  window.addEventListener("resize", applyOpen);
})();

document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAround(false); });

/* ---------- Démarrage ---------- */
document.title = C.TITRE;
rebuild();
renderAll();
if (!configured()) openSettings(); else loadAround(false);
})();
