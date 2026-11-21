(() => {
"use strict";

const C = Object.assign({
  TITRE: "Agenda", SCRIPT_URL: "", DEBUT_SEMAINE: 1, NUMEROS_SEMAINES: true,
  DUREE_DEFAUT_MIN: 60, HEURE_DEFAUT: 9, CACHE_SECONDES: 60
}, window.CONFIG || {});

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
  mode: LS.get("mode", "agenda"),
  plan: LS.get("planCals", null)
};

/* ---------- Connexion / API ---------- */
const url = () => C.SCRIPT_URL || LS.get("url", "");
const configured = () => !!(url() && LS.get("token", ""));

async function api(action, data) {
  const u = url(), token = LS.get("token", "");
  if (!u || !token) throw new Error("config");
  let res;
  if (action === "create") {
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

function dayEvents(d) {
  const plan = S.mode === "planning";
  const ps = plan ? planSet() : null;
  const a = (S.byDay.get(d) || []).filter((e) => plan ? (ps.size ? ps.has(e.cal) : PLAN_RE.test(e.title)) : !S.hidden.has(e.cal));
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
  for (let w = 0; w < weeks; w++) {
    const r0 = new Date(start); r0.setDate(r0.getDate() + w * 7);
    const thu = new Date(r0); thu.setDate(thu.getDate() + ((4 - ws + 7) % 7));
    h += `<div class="row7"><span class="wn">${C.NUMEROS_SEMAINES ? isoWeek(thu) : ""}</span>`;
    for (let i = 0; i < 7; i++) {
      const d = new Date(r0); d.setDate(d.getDate() + i);
      const s = ymd(d);
      const all = dayEvents(s);
      const cls = ["day"];
      if (d.getMonth() !== m) cls.push("other");
      if (d.getDay() === 0 || d.getDay() === 6) cls.push("we");
      if (s === today) cls.push("today");
      if (s === S.sel) cls.push("sel");
      if (S.mode === "planning") {
        const k = kindOf(all);
        cls.push("pc"); if (k) cls.push("k-" + k);
        h += `<button class="${cls.join(" ")}" data-d="${s}"><span class="n">${d.getDate()}</span><span class="lb">${esc(shortTitle(all))}</span></button>`;
      } else {
        const bars = all.slice(0, 4).map((e) => `<i style="background:${esc(calColor(e.cal))}"></i>`).join("");
        h += `<button class="${cls.join(" ")}" data-d="${s}"><span class="n">${d.getDate()}</span><span class="bars">${bars}</span></button>`;
      }
    }
    h += `</div>`;
  }
  if (S.mode === "planning") h += `<div class="leg"><span class="k-ve">VE</span><span class="k-jour">Jour</span><span class="k-soir">Soir</span><span class="k-rh">RH</span><span class="k-rtt">RTT</span></div>`;
  $("#grid").innerHTML = h;
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

function toggleAll() {
  $("#fCreate").classList.toggle("allday", isAll());
  if (isAll()) durDays = 0; else dur = C.DUREE_DEFAUT_MIN * 60000;
  applyEnd();
}

function openCreate() {
  if (!S.cals.length) { openSettings(); return; }
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
  dlgOpen("#dCreate");
  setTimeout(() => $("#cTitle").focus(), 50);
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
  const btn = $("#cSave"); btn.disabled = true; btn.textContent = "…";
  try {
    await api("create", data);
    LS.set("lastCal", data.calendarId);
    $("#dCreate").close();
    S.sel = firstDay;
    const d = parseYmd(firstDay);
    S.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
    renderAll();
    await loadAround(true);
  } catch (e) {
    err.textContent = "Échec : " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Ajouter";
  }
});

/* Agendas visibles */
function openCals() {
  const ps = planSet();
  const cals = S.cals.slice().sort((a, b) => (b.owned - a.owned) || a.name.localeCompare(b.name));
  $("#calList").innerHTML = cals.length
    ? cals.map((c, i) => `<div class="cl"><label class="lab" for="cb${i}"><i style="background:${esc(c.color)}"></i><span>${esc(c.name)}</span></label><button type="button" class="pk${ps.has(c.id) ? " on" : ""}" data-plan="${esc(c.id)}">Planning</button><input type="checkbox" id="cb${i}" data-id="${esc(c.id)}" ${S.hidden.has(c.id) ? "" : "checked"}></div>`).join("")
    : `<p class="hint">Aucun agenda pour l’instant : renseignez la connexion ci-dessous.</p>`;
  dlgOpen("#dCals");
}

$("#calList").addEventListener("change", (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.checked) S.hidden.delete(id); else S.hidden.add(id);
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
$("#bAdd").addEventListener("click", openCreate);
$("#bCals").addEventListener("click", openCals);
$("#bSettings").addEventListener("click", openSettings);
$("#bRefresh").addEventListener("click", () => loadAround(true));
function setMode(m) {
  S.mode = m; LS.set("mode", m);
  $("#bMode").textContent = m === "planning" ? "Agenda" : "Planning";
  renderAll();
}
$("#bMode").addEventListener("click", () => setMode(S.mode === "planning" ? "agenda" : "planning"));

let tx = 0, ty = 0;
$("#grid").addEventListener("touchstart", (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
$("#grid").addEventListener("touchend", (e) => {
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) > 50 && Math.abs(dy) < 40) goMonth(dx < 0 ? 1 : -1);
}, { passive: true });

document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAround(false); });

/* ---------- Démarrage ---------- */
document.title = C.TITRE;
$("#bMode").textContent = S.mode === "planning" ? "Agenda" : "Planning";
rebuild();
renderAll();
if (!configured()) openSettings(); else loadAround(false);
})();
