/* ============ Wilma OS — App-Logik (früher „Betriebssystem Laura" / Wilma App) ============ */

const APP_VERSION = '3.2.0';

let store = null;
let me = null;            // wer dieses Gerät benutzt: 'dennis' | 'laura'
let currentTab = 'heute';
let dayWasComplete = false;
let timerInterval = null;
let timerSecondsLeft = 15 * 60;
let timerPaused = false;

const WEEKDAY_NAMES = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/* ---------- Datum-Helfer ---------- */
function toISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayISO() { return toISO(new Date()); }
function isoWeekday(d) { return d.getDay() === 0 ? 7 : d.getDay(); }
function mondayOf(d) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - (isoWeekday(copy) - 1));
  return copy;
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function isBiweeklyDue(task, date) {
  if (task.cadence !== 'biweekly') return true;
  const anchorMon = mondayOf(parseISO(task.anchor || DEFAULT_ANCHOR));
  const thisMon = mondayOf(date);
  const weeks = Math.round((thisMon - anchorMon) / (7 * 24 * 3600 * 1000));
  return ((weeks % 2) + 2) % 2 === 0;
}
function dayOfYear(d) {
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / (24 * 3600 * 1000));
}
function formatDateLong(d) {
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* ---------- Personen ---------- */
function partnerOf(p) { return p === 'dennis' ? 'laura' : 'dennis'; }
function nameOf(p) { return PEOPLE[p]?.name || p; }
function genitiv(p) { const n = nameOf(p); return /[sxz]$/i.test(n) ? n + "'" : n + 's'; }

/* ---------- Checks ----------
   checks[day][key] = { dennis: true, laura: true } — wer hat abgehakt.
   Erledigt heißt je nach Besitz:
     haus      → einer reicht (bei „zu zweit" darf jeder Beteiligte haken)
     gemeinsam → beide (Ampel)
     jeder     → jeder für sich
     dennis/laura → nur diese Person                                            */
function checkers(day, key) { return (store.state.checks[day] && store.state.checks[day][key]) || {}; }
function hasChecked(day, key, who) { return !!checkers(day, key)[who]; }
function isDoneFor(day, key, owner) {
  const c = checkers(day, key);
  if (owner === 'gemeinsam') return PERSON_KEYS.every(p => c[p]);
  if (owner === 'haus') return Object.keys(c).length > 0;
  if (owner === 'jeder') return !!c[me];
  return !!c[owner];
}
function canToggle(owner) { return owner === 'haus' || owner === 'gemeinsam' || owner === 'jeder' || owner === me; }

function showToast(text) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

async function toggleCheck(day, key, owner, zuZweit) {
  if (!canToggle(owner)) { showToast(`Das hakt ${nameOf(owner)} selbst ab ♡`); return; }
  const c = checkers(day, key);
  if (owner === 'haus' && !c[me] && Object.keys(c).length) {
    if (!zuZweit) { showToast(`Hat ${Object.keys(c).map(nameOf).join(' & ')} schon erledigt ♡`); return; }
    if (!bookingsFor(day, key).some(b => b.person === me)) { showToast('Erst dazubuchen, dann abhaken ♡'); return; }
  }
  const wasDone = isDoneFor(day, key, owner);
  const on = !c[me];
  const goalsBefore = weekGoalState();
  await store.setCheck(day, key, me, on);
  // Zone abgehakt → Timer ist damit erledigt und stoppt
  if (key === 'zone' && on && day === todayISO()) {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    timerPaused = false; timerSecondsLeft = 15 * 60;
  }
  render();
  if (on) {
    const item = itemOf(key);
    let msg = item ? ptsText(item.groesse, pointArtOf(item.owner)) : '';
    const title = item ? item.title : key;
    if (owner === 'gemeinsam' && !wasDone && isDoneFor(day, key, owner)) {
      rainHearts(40); msg = 'Beide bestätigt – grün! ' + msg;
      notify('Grün! ♡', `${nameOf(me)} hat „${title}" auch bestätigt – ihr seid durch.`);
    } else if (owner === 'gemeinsam') {
      msg += ` · jetzt fehlt noch ${nameOf(partnerOf(me))}`;
      notify('Die Ampel braucht noch dich', `${nameOf(me)} hat „${title}" bestätigt – jetzt fehlt nur noch deine Bestätigung.`);
    } else if (owner === 'haus' && day === todayISO()) {
      notify('Erledigt ✓', `${nameOf(me)} hat „${title}" erledigt (${ptsText(item.groesse, 'wilma')}).`);
    } else if (owner === 'jeder' && day === todayISO() && item && key.startsWith('routine:')) {
      const r = store.state.routines.find(x => 'routine:' + x.id === key);
      if (r && r.section === 'morgen' && morningDoneBy(me, day)) notify('Morgenroutine geschafft ♡', `${nameOf(me)} hat die Morgenroutine komplett – guten Start in den Tag!`);
    }
    showToast(msg + ' ♡');
    celebrateGoals(goalsBefore);
    maybeCelebrate();
  }
}

/* ---------- Push-Nachrichten ----------
   Versand läuft über die Edge Function „wilma-push" (prüft Bewohner, Ruhezeit 22–7, nie an sich selbst). */
const PUSH_OK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function urlB64ToU8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}
async function pushStatus() {
  if (!PUSH_OK) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch (e) { return 'off'; }
}
async function enablePush() {
  if (!PUSH_OK) { showToast('Dieses Gerät kann keine Push-Nachrichten.'); return; }
  if (isIOS() && !isStandalone()) { showToast('Erst zum Home-Bildschirm hinzufügen, dann einschalten ♡'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { showToast('Nicht erlaubt – du kannst es in den Einstellungen ändern.'); render(); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(VAPID_PUBLIC_KEY) });
    await store.savePushSubscription(sub.toJSON(), me);
    showToast('Push ist an – Wilma OS sagt dir Bescheid ♡');
  } catch (e) { console.warn(e); showToast('Das hat nicht geklappt: ' + (e.message || e)); }
  render();
}
async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await store.removePushSubscription(sub.endpoint); await sub.unsubscribe(); }
  } catch (e) { console.warn(e); }
  showToast('Push ist aus.'); render();
}
// Nachricht an die andere Person (nie an sich selbst). Läuft im Hintergrund, Fehler stören die App nicht.
function notify(title, body, opts = {}) {
  if (!store || store.mode !== 'cloud' || !me) return;
  const hour = new Date().getHours();
  if (!opts.force && (hour >= 22 || hour < 7)) return;
  const to = partnerOf(me);
  try {
    store.sb.functions.invoke('wilma-push', { body: { to, title, body, url: opts.url || './' } })
      .then(r => { if (r.error) console.warn('push', r.error); })
      .catch(e => console.warn('push', e));
  } catch (e) { console.warn('push', e); }
}
function morningDoneBy(person, day) {
  const items = store.state.routines.filter(r => r.active && r.section === 'morgen' && (r.owner === 'jeder' || r.owner === person));
  return items.length > 0 && items.every(r => hasChecked(day, 'routine:' + r.id, person));
}

function ptsText(n, art) { return `+${n} ${art === 'wilma' ? 'Wilma' : 'Soul'}-${n === 1 ? 'Punkt' : 'Punkte'}`; }

/* ---------- Punkte, Quoten, Ziele ----------
   Punkte werden nie gespeichert, sondern aus Häkchen × Größe berechnet.
   Quote = erledigte / laut Plan fällige Standardaufgaben (ohne To-dos).            */
function itemOf(key) {
  if (key === 'zone') return { owner: 'jeder', groesse: ZONE_SIZE, title: '15-Minuten-Zone' };
  const [kind, id] = key.split(':');
  const list = kind === 'routine' ? store.state.routines : kind === 'task' ? store.state.tasks : [];
  const x = list.find(i => i.id === id);
  if (!x) return null;
  return { owner: x.owner, groesse: x.groesse || 1, title: x.title, zu_zweit: !!x.zu_zweit };
}

// Punkte einer Person im Zeitraum [startIso, endIso]
function pointsFor(person, startIso, endIso) {
  const pts = { soul: 0, wilma: 0 };
  for (const day of Object.keys(store.state.checks)) {
    if (day < startIso || day > endIso) continue;
    for (const [key, c] of Object.entries(store.state.checks[day])) {
      if (!c[person]) continue;
      const it = itemOf(key);
      if (it) pts[pointArtOf(it.owner)] += it.groesse;
    }
  }
  for (const t of store.state.todos) {
    if (t.done_at && t.done_by === person) {
      const d = t.done_at.slice(0, 10);
      if (d >= startIso && d <= endIso) pts.wilma += t.groesse || 3;
    }
  }
  return pts;
}

function firstCheckDays() {
  const first = { any: null };
  for (const p of PERSON_KEYS) first[p] = null;
  for (const day of Object.keys(store.state.checks)) {
    for (const c of Object.values(store.state.checks[day])) {
      for (const p of PERSON_KEYS) if (c[p] && (!first[p] || day < first[p])) first[p] = day;
    }
  }
  for (const p of PERSON_KEYS) if (first[p] && (!first.any || first[p] < first.any)) first.any = first[p];
  return first;
}

// Alle laut Plan fälligen Standardpunkte eines Tages: [{ key, owner, groesse }]
// Für vergangene Tage zählt eine Aufgabe erst ab dem Tag, an dem sie angelegt wurde.
function existedOn(x, iso) { return !x.created_at || x.created_at.slice(0, 10) <= iso; }
function dayItems(date) {
  const iso = toISO(date);
  const items = [];
  for (const r of store.state.routines.filter(r => r.active && existedOn(r, iso))) items.push({ key: 'routine:' + r.id, owner: r.owner, groesse: r.groesse || 1 });
  for (const t of tasksForDate(date)) if (isBiweeklyDue(t, date) && existedOn(t, iso)) items.push({ key: 'task:' + t.id, owner: t.owner, groesse: t.groesse || 1 });
  items.push({ key: 'zone', owner: 'jeder', groesse: ZONE_SIZE });
  return items;
}

// Team-Quote einer Punkteart im Zeitraum. Jede Person zählt erst ab ihrem ersten Häkchen.
function quota(art, start, end, first = firstCheckDays(), includeFuture = false) {
  const today = todayISO();
  let done = 0, expected = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = toISO(d);
    if (iso > today && !includeFuture) break;
    const started = p => first[p] && (iso >= first[p] || iso > today);
    for (const it of dayItems(d)) {
      if (pointArtOf(it.owner) !== art) continue;
      const c = checkers(iso, it.key);
      if (it.owner === 'jeder') {
        for (const p of PERSON_KEYS) if (started(p)) { expected++; if (c[p]) done++; }
      } else if (it.owner === 'dennis' || it.owner === 'laura') {
        if (started(it.owner)) { expected++; if (c[it.owner]) done++; }
      } else if (started('any')) {
        expected++;
        if (it.owner === 'gemeinsam' ? PERSON_KEYS.every(p => c[p]) : Object.keys(c).length > 0) done++;
      }
    }
  }
  return { pct: expected ? Math.round(done / expected * 100) : null, done, expected };
}

function periodRange(mode, offset = 0) {
  const now = new Date();
  let start, end, label;
  if (mode === 'woche') {
    const mon = mondayOf(now);
    start = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 7 * offset);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    label = 'KW ' + isoWeekNum(start);
  } else if (mode === 'monat') {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    label = start.toLocaleDateString('de-DE', { month: 'short' });
  } else if (mode === 'quartal') {
    const q = Math.floor(now.getMonth() / 3) + offset;
    start = new Date(now.getFullYear(), q * 3, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
    label = 'Q' + (Math.floor(start.getMonth() / 3) + 1) + ' ' + String(start.getFullYear()).slice(2);
  } else {
    start = new Date(now.getFullYear() + offset, 0, 1);
    end = new Date(start.getFullYear(), 11, 31);
    label = String(start.getFullYear());
  }
  return { start, end, label, startIso: toISO(start), endIso: toISO(end) };
}

function goals() {
  const g = store.state.settings.ziele || {};
  return {
    soul: { ...DEFAULT_GOALS.soul, ...(g.soul || {}) },
    wilma: { ...DEFAULT_GOALS.wilma, ...(g.wilma || {}) },
  };
}

function weekGoalState() {
  const r = periodRange('woche');
  const first = firstCheckDays();
  const g = goals();
  return {
    soul: (quota('soul', r.start, r.end, first).pct ?? 0) >= g.soul.woche,
    wilma: (quota('wilma', r.start, r.end, first).pct ?? 0) >= g.wilma.woche,
  };
}
function celebrateGoals(before) {
  const after = weekGoalState();
  for (const art of ['soul', 'wilma']) {
    if (!before[art] && after[art]) {
      rainHearts(60);
      showToast(`Wochenziel ${art === 'soul' ? 'Soul' : 'Wilma'} erreicht – als Team! ♡`);
      notify('Wochenziel erreicht ♡', `Ihr habt das ${art === 'soul' ? 'Soul' : 'Wilma'}-Ziel dieser Woche geschafft – als Team!`);
    }
  }
}

/* ---------- Tages-Items ---------- */
function tasksForDate(date) {
  const wd = isoWeekday(date);
  return store.state.tasks.filter(t => t.active && t.weekday === wd).sort((a, b) => a.pos - b.pos);
}
function routinesBySection(owner) {
  const groups = {};
  for (const r of store.state.routines.filter(r => r.active && (!owner || r.owner === owner)).sort((a, b) => a.pos - b.pos)) {
    (groups[r.section] = groups[r.section] || []).push(r);
  }
  return groups;
}
// Ampeln: vormittags steht die Morgen-Ampel oben, ab 14 Uhr die Abend-Ampel
function ampelRoutines() {
  const first = new Date().getHours() < 14 ? 'morgen' : 'abend';
  return store.state.routines.filter(r => r.active && r.section === 'ampel')
    .sort((a, b) => (a.gate_slot === first ? 0 : 1) - (b.gate_slot === first ? 0 : 1) || a.pos - b.pos);
}
// Mein heutiger Soul-Stand: alles „für jeden", meins und meine Zone
function todayProgress(person = me) {
  const date = new Date();
  const day = todayISO();
  const items = dayItems(date).filter(i => i.owner === 'jeder' || i.owner === person);
  const done = items.filter(i => hasChecked(day, i.key, person)).length;
  return { done, total: items.length };
}

/* ---------- Feier ---------- */
function maybeCelebrate() {
  const { done, total } = todayProgress();
  const complete = total > 0 && done === total;
  if (complete && !dayWasComplete) rainHearts(40);
  dayWasComplete = complete;
}
function rainHearts(n) {
  const wrap = document.getElementById('hearts');
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.textContent = ['♥', '♡', '❀'][i % 3];
    s.style.left = Math.random() * 100 + 'vw';
    s.style.fontSize = (14 + Math.random() * 22) + 'px';
    s.style.animationDuration = (2.5 + Math.random() * 2.5) + 's';
    s.style.animationDelay = (Math.random() * 0.8) + 's';
    wrap.appendChild(s);
    setTimeout(() => s.remove(), 6000);
  }
}

/* ---------- HTML-Helfer ---------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function whoChips(day, key) {
  const c = checkers(day, key);
  return PERSON_KEYS.filter(p => c[p]).map(p => `<span class="who who-${p}" title="${nameOf(p)}">${PEOPLE[p].short}</span>`).join('');
}
// beide Personen, gefüllt = erledigt, leer = noch offen
function bothChips(day, key) {
  const c = checkers(day, key);
  return PERSON_KEYS.slice().sort((a, b) => (a === me ? -1 : b === me ? 1 : 0))
    .map(p => `<span class="who who-${p} ${c[p] ? '' : 'off'}" title="${nameOf(p)} ${c[p] ? 'erledigt' : 'offen'}">${PEOPLE[p].short}</span>`).join('');
}
function ptsBadge(item) {
  if (!item) return '';
  return `<span class="pts pts-${pointArtOf(item.owner)}">+${item.groesse}</span>`;
}
function bookingsFor(day, key) { return store.state.bookings.filter(b => b.day === day && (key === null || b.item_key === key)); }
function bookingHTML(day, key) {
  if (day !== todayISO()) return '';
  const list = bookingsFor(day, key);
  const mine = list.find(b => b.person === me);
  const done = hasChecked(day, key, me);
  const chips = list.map(b => `<span class="book-chip book-${b.person}">${nameOf(b.person)} · ${SLOTS[b.slot]}</span>`).join('');
  let btn = '';
  if (!mine && !done) btn = list.length
    ? `<button class="btn small subtle book-btn" data-book="${esc(key)}" data-act="join">Dazubuchen</button>`
    : `<button class="btn small subtle book-btn" data-book="${esc(key)}" data-act="take">Ich übernehme</button>`;
  else if (mine && !done) btn = `<button class="btn small subtle book-btn" data-book="${esc(key)}" data-act="release">Zurückgeben</button>`;
  return (chips || btn) ? `<div class="book-row">${chips}${btn}</div>` : '';
}
function checkItemHTML(day, key, label, note, owner = 'haus', item = null) {
  item = item || itemOf(key);
  const zz = !!(item && item.zu_zweit);
  const done = isDoneFor(day, key, owner);
  const partial = owner === 'gemeinsam' && !done && Object.keys(checkers(day, key)).length > 0;
  const readonly = !canToggle(owner);
  const chips = owner === 'jeder' ? bothChips(day, key)
    : (owner === 'haus' || owner === 'gemeinsam') ? whoChips(day, key) : '';
  const ownerNote = (owner === 'dennis' || owner === 'laura') ? nameOf(owner) : '';
  const fullNote = [ownerNote, note].filter(Boolean).join(' · ');
  return `<div class="check-item ${done ? 'done' : ''} ${partial ? 'partial' : ''} ${readonly ? 'readonly' : ''}" role="button" tabindex="0" aria-pressed="${done}" data-day="${day}" data-key="${esc(key)}" data-owner="${owner}" data-zz="${zz ? 1 : ''}">
    <div class="check-box">✓</div>
    <div class="check-main">
      <div class="check-label">${esc(label)} ${ptsBadge(item)}</div>
      ${zz && owner === 'haus' ? bookingHTML(day, key) : ''}
    </div>
    ${fullNote ? `<div class="check-note">${esc(fullNote)}</div>` : ''}
    ${chips ? `<div class="who-wrap">${chips}</div>` : ''}
  </div>`;
}

/* ---------- Ampel (Hausregel, beide bestätigen) ---------- */
function ampelHTML(day, r) {
  const key = 'routine:' + r.id;
  const c = checkers(day, key);
  const n = PERSON_KEYS.filter(p => c[p]).length;
  const state = n === 2 ? 'gruen' : n === 1 ? 'gelb' : 'rot';
  const mine = !!c[me];
  const status = PERSON_KEYS.map(p => `<span class="ampel-who ${c[p] ? 'ok' : ''}">${nameOf(p)} ${c[p] ? '✓' : '…'}</span>`).join('');
  const headline = state === 'gruen'
    ? (r.gate_slot === 'abend' ? 'Grün – ab ins Bett ♡' : 'Grün – Kaffee! ☕')
    : `${esc(r.title)} – ${esc(r.gate || '')}`;
  return `
    <div class="ampel ampel-${state}">
      <div class="ampel-light" aria-label="${state}"></div>
      <div class="ampel-main">
        <div class="ampel-slot">${r.gate_slot === 'abend' ? 'Abend-Ampel' : 'Morgen-Ampel'} ${ptsBadge(itemOf(key))}</div>
        <div class="ampel-title">${headline}</div>
        <div class="ampel-status">${status}</div>
        <button class="btn small ${mine ? 'subtle' : 'primary'} ampel-btn" data-ampel="${r.id}">${mine ? 'Meine Bestätigung zurücknehmen' : 'Ich bestätige ✓'}</button>
      </div>
    </div>`;
}

/* ---------- Wilma-Topf & Belohnungen ----------
   Topf = alle Wilma-Punkte beider (seit Anfang) minus eingelöste (bestätigte + angefragte) Belohnungen. */
function wilmaPot() {
  const earned = PERSON_KEYS.reduce((sum, p) => sum + pointsFor(p, '2000-01-01', '2999-12-31').wilma, 0);
  const spent = store.state.redemptions.reduce((sum, r) => sum + (r.cost || 0), 0);
  return { earned, spent, left: earned - spent };
}
async function requestRedemption(reward) {
  const pot = wilmaPot();
  if (pot.left < reward.cost) { showToast(`Noch ${reward.cost - pot.left} Wilma-Punkte bis dahin ♡`); return; }
  await store.addRedemption({ reward_id: reward.id, title: reward.title, cost: reward.cost, requested_by: me });
  render(); showToast(`Angefragt – ${nameOf(partnerOf(me))} muss noch bestätigen ♡`);
  notify('Belohnung einlösen?', `${nameOf(me)} möchte „${reward.title}" einlösen (${reward.cost} Wilma-Punkte). Bestätigst du?`);
}
async function confirmRedemption(r) {
  await store.updateRedemption(r.id, { confirmed_by: me, confirmed_at: new Date().toISOString() });
  render(); rainHearts(40); showToast(`„${r.title}" ist eingelöst – viel Freude! ♡`);
  notify('Eingelöst ♡', `${nameOf(me)} hat „${r.title}" bestätigt – viel Freude euch beiden!`);
}
function rewardsHTML() {
  const pot = wilmaPot();
  const rewards = store.state.rewards.filter(r => r.active).sort((a, b) => a.cost - b.cost || a.pos - b.pos);
  const pending = store.state.redemptions.filter(r => !r.confirmed_at);
  const done = store.state.redemptions.filter(r => r.confirmed_at).sort((a, b) => b.confirmed_at.localeCompare(a.confirmed_at)).slice(0, 6);
  return `
    <div class="card" id="rewards-card">
      <h2 class="section-title">Belohnungen</h2>
      <div class="pot"><span class="pot-label">Wilma-Topf</span><b>${pot.left}</b><span class="settings-sub">von ${pot.earned} gesammelt · ${pot.spent} eingelöst</span></div>
      ${pending.map(r => `
        <div class="hist-row pending">
          <span class="who who-${r.requested_by}">${PEOPLE[r.requested_by].short}</span>
          <span class="grow">${esc(nameOf(r.requested_by))} möchte „${esc(r.title)}" einlösen <span class="pts pts-wilma">−${r.cost}</span></span>
          ${r.requested_by === me
            ? `<button class="btn small subtle" data-redeem-cancel="${r.id}">Zurück</button>`
            : `<button class="btn small primary" data-redeem-confirm="${r.id}">Bestätigen ♡</button>`}
        </div>`).join('')}
      ${rewards.length ? rewards.map(r => `
        <div class="hist-row">
          <span class="reward-emoji">${esc(r.emoji || '🎁')}</span>
          <span class="grow">${esc(r.title)}</span>
          <span class="pts pts-wilma">${r.cost}</span>
          <button class="btn small ${pot.left >= r.cost ? 'primary' : 'subtle'}" data-redeem="${r.id}">Einlösen</button>
          <button class="btn small subtle" data-edit-reward="${r.id}">✎</button>
        </div>`).join('') : '<p class="empty-note">Noch keine Belohnung – z. B. „Essen gehen" für 300 Wilma-Punkte. ♡</p>'}
      <div style="margin-top:10px"><button class="btn small" id="add-reward">+ Belohnung</button></div>
      ${done.length ? `<div class="hist-group-title" style="margin-top:12px">Eingelöst</div>${done.map(r => `
        <div class="hist-row"><span class="exp-day">${r.confirmed_at.slice(8, 10)}.${r.confirmed_at.slice(5, 7)}.</span>
        <span class="grow done-title">${esc(r.title)}</span><span class="who who-${r.requested_by}">${PEOPLE[r.requested_by].short}</span><span class="pts pts-wilma">−${r.cost}</span></div>`).join('')}` : ''}
    </div>`;
}
function rewardModal(reward) {
  const isNew = !reward;
  openModal(`
    <h3>${isNew ? 'Neue Belohnung' : 'Belohnung bearbeiten'}</h3>
    <label>Wofür sammelt ihr?</label>
    <input type="text" id="m-title" value="${reward ? esc(reward.title) : ''}" placeholder="z. B. Essen gehen">
    <label>Symbol (Emoji)</label>
    <input type="text" id="m-emoji" value="${reward ? esc(reward.emoji || '') : ''}" placeholder="🍝" maxlength="4">
    <label>Kostet (Wilma-Punkte)</label>
    <input type="number" id="m-cost" inputmode="numeric" min="1" value="${reward ? reward.cost : 300}">
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const title = document.getElementById('m-title').value.trim();
    const cost = Math.round(Number(document.getElementById('m-cost').value));
    if (!title || !(cost > 0)) return;
    const f = { title, cost, emoji: document.getElementById('m-emoji').value.trim() || '🎁' };
    if (isNew) await store.addReward(f); else await store.updateReward(reward.id, f);
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => { await store.deleteReward(reward.id); closeModal(); render(); };
}

/* ---------- „Unser Stand": Ziele als Team, Punkte je Person ---------- */
function ringHTML(art, q, goal) {
  const pct = q.pct ?? 0;
  const reached = q.pct !== null && q.pct >= goal;
  return `
    <div class="ring-wrap">
      <div class="ring ring-${art} ${reached ? 'reached' : ''}" style="--p:${Math.min(100, pct)}">
        <div class="ring-inner"><b>${q.pct === null ? '–' : q.pct + '%'}</b><span>Ziel ${goal}%</span></div>
      </div>
      <div class="ring-label">${art === 'soul' ? 'Soul' : 'Wilma'} ${reached ? '✓' : ''}</div>
    </div>`;
}
function standHTML() {
  const first = firstCheckDays();
  const g = goals();
  const wk = periodRange('woche');
  const qs = quota('soul', wk.start, wk.end, first), qw = quota('wilma', wk.start, wk.end, first);
  const people = PERSON_KEYS.slice().sort((a, b) => (a === me ? -1 : b === me ? 1 : 0)).map(p => {
    const pt = pointsFor(p, wk.startIso, wk.endIso);
    return `<div class="stand-person"><span class="who who-${p}">${PEOPLE[p].short}</span>
      <span>${esc(nameOf(p))}</span><span class="pts pts-soul">${pt.soul}</span><span class="pts pts-wilma">${pt.wilma}</span></div>`;
  }).join('');
  // Wie viele Häkchen fehlen noch bis zum Wochenziel (ganze Woche inkl. kommender Tage)?
  const remain = art => {
    const full = quota(art, wk.start, wk.end, first, true);
    if (!full.expected) return '';
    const need = Math.ceil(g[art].woche / 100 * full.expected) - full.done;
    const name = art === 'soul' ? 'Soul' : 'Wilma';
    return need <= 0 ? `<span class="remain ok">${name}-Ziel geschafft ✓</span>`
      : `<span class="remain">${name}: noch <b>${need}</b> ${need === 1 ? 'Häkchen' : 'Häkchen'}</span>`;
  };
  const more = ['monat', 'quartal', 'jahr'].map(m => {
    const r = periodRange(m);
    const s = quota('soul', r.start, r.end, first), w = quota('wilma', r.start, r.end, first);
    const f = q => q.pct === null ? '–' : `${q.pct}%`;
    return `<div><b>${PERIOD_META[m]}</b> Soul ${f(s)} · Wilma ${f(w)}</div>`;
  }).join('');
  return `
    <div class="card stand-card" id="stand-card" role="button" tabindex="0">
      <h2 class="section-title">Unser Stand · ${esc(wk.label)}</h2>
      <div class="stand-rings">${ringHTML('soul', qs, g.soul.woche)}${ringHTML('wilma', qw, g.wilma.woche)}</div>
      <div class="stand-remain">${remain('soul')}${remain('wilma')}</div>
      <div class="stand-people"><div class="stand-person stand-head"><span></span><span>Punkte diese Woche</span><span>Soul</span><span>Wilma</span></div>${people}</div>
      <div class="stand-periods">${more}<div><b>Topf</b> ${wilmaPot().left} Wilma-Punkte für Belohnungen</div><div class="settings-sub">antippen → Verlauf</div></div>
    </div>`;
}

/* ---------- „Heute im Haus": wer hat heute wann was gemacht ---------- */
function timeOf(v) { return (typeof v === 'string' && v.length > 10) ? v : null; }
function hhmm(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
function feedHTML(day) {
  const entries = [];
  for (const [key, c] of Object.entries(store.state.checks[day] || {})) {
    const it = itemOf(key);
    if (!it) continue;
    for (const p of PERSON_KEYS) if (c[p]) entries.push({ t: timeOf(c[p]), p, text: it.title + ' ✓', pts: ptsBadge(it) });
  }
  for (const t of store.state.todos) {
    if (t.done_at && t.done_at.slice(0, 10) === day && t.done_by) entries.push({ t: t.done_at, p: t.done_by, text: t.title + ' ✓', pts: `<span class="pts pts-wilma">+${t.groesse || 3}</span>` });
  }
  for (const b of bookingsFor(day, null)) {
    const it = itemOf(b.item_key);
    if (it) entries.push({ t: b.created_at || null, p: b.person, text: `übernimmt ${it.title} (${SLOTS[b.slot]})`, pts: '' });
  }
  if (!entries.length) return '';
  entries.sort((a, b) => (b.t || '').localeCompare(a.t || ''));
  const shown = entries.slice(0, 8);
  return `
    <div class="card feed-card">
      <h2 class="section-title">Heute im Haus</h2>
      ${shown.map(e => `<div class="feed-row"><span class="feed-time">${e.t ? hhmm(e.t) : '–'}</span><span class="who who-${e.p}">${PEOPLE[e.p].short}</span><span class="grow">${esc(e.text)}</span>${e.pts}</div>`).join('')}
      ${entries.length > shown.length ? `<p class="settings-sub" style="margin-top:6px">… und ${entries.length - shown.length} weitere</p>` : ''}
    </div>`;
}

/* ---------- Ansicht: Heute ---------- */
function renderHeute() {
  const now = new Date();
  const day = todayISO();
  const hour = now.getHours();
  const hello = hour < 11 ? `Guten Morgen, ${nameOf(me)}` : hour < 18 ? `Hallo, ${nameOf(me)}` : `Guten Abend, ${nameOf(me)}`;
  const quote = QUOTES[dayOfYear(now) % QUOTES.length];
  const { done, total } = todayProgress(me);
  const complete = total > 0 && done === total;

  const ampeln = ampelRoutines();
  const ampelCard = ampeln.length ? `
    <div class="card ampel-card">
      <h2 class="section-title">Hausregeln</h2>
      ${ampeln.map(r => ampelHTML(day, r)).join('')}
    </div>` : '';

  // Routinen nach Abschnitt (ohne Ampeln); persönliche des anderen sind sichtbar, aber nur lesbar
  const groups = routinesBySection();
  delete groups.ampel;
  const secKeys = Object.keys(groups).sort((a, b) => (SECTION_META[a]?.order || 9) - (SECTION_META[b]?.order || 9));
  const sections = secKeys.map(sec => `
      <div class="card">
        <h2 class="section-title">${esc(SECTION_META[sec]?.label || sec)}</h2>
        ${groups[sec].map(r => checkItemHTML(day, 'routine:' + r.id, r.title, '', r.owner)).join('')}
      </div>`).join('');

  const todaysTasks = tasksForDate(now);
  const dueTasks = todaysTasks.filter(t => isBiweeklyDue(t, now));
  const pausedTasks = todaysTasks.filter(t => !isBiweeklyDue(t, now));
  const tasksHTML = `
    <div class="card">
      <h2 class="section-title">Haushalt heute</h2>
      ${dueTasks.length
        ? dueTasks.map(t => checkItemHTML(day, 'task:' + t.id, t.title, t.cadence === 'biweekly' ? '2-wöchentlich' : '', t.owner)).join('')
        : '<p class="empty-note">Heute steht kein Haushalt an – wie schön! ♡</p>'}
      ${pausedTasks.map(t => `<div class="check-item skip-week"><div class="check-box"></div>
        <div class="check-label">${esc(t.title)}</div><div class="check-note">erst nächste Woche</div></div>`).join('')}
    </div>`;

  // To-dos, die heute fällig oder überfällig sind
  const dueTodos = store.state.todos.filter(t => !t.done_at && t.due && t.due <= day).sort((a, b) => a.due.localeCompare(b.due));
  const openCount = store.state.todos.filter(t => !t.done_at).length;
  const todoHTML = (dueTodos.length || openCount) ? `
    <div class="card">
      <h2 class="section-title">To-dos</h2>
      ${dueTodos.map(t => todoRowHTML(t)).join('')}
      <p class="empty-note"><a href="#" id="goto-todos">${openCount} offen${dueTodos.length ? '' : ', heute nichts fällig'} → zu den To-dos</a></p>
    </div>` : '';

  const mins = Math.floor(timerSecondsLeft / 60), secs = timerSecondsLeft % 60;
  const timerRunning = timerInterval !== null;
  const timerStarted = timerRunning || timerPaused;
  const mainLabel = timerRunning ? 'Pause' : (timerPaused ? 'Weiter ♡' : 'Timer starten');
  const zoneDone = hasChecked(day, 'zone', me);
  const timerBlock = zoneDone
    ? '<p class="zone-desc" style="margin:4px 0 2px">Für heute geschafft ♡</p>'
    : `<div class="zone-row">
        <div class="timer-display ${timerRunning ? 'running' : ''} ${timerPaused ? 'paused' : ''}" id="timer-display">
          ${mins}:${String(secs).padStart(2, '0')}
        </div>
        <button class="btn ${timerRunning ? '' : 'primary'}" id="timer-btn">${mainLabel}</button>
        ${timerStarted ? '<button class="btn subtle" id="timer-reset">Zurücksetzen</button>' : ''}
      </div>
      ${timerPaused ? '<p class="zone-desc" style="margin-top:8px">Pausiert – dein Fortschritt wartet auf dich. ♡</p>' : ''}`;
  const zoneHTML = `
    <div class="card zone-card">
      <h2 class="section-title">♡ 15-Minuten-Zone</h2>
      <p class="zone-desc">Ein Bereich, 15 Minuten, Timer an – mehr nicht.</p>
      ${timerBlock}
      <div style="margin-top:10px">${checkItemHTML(day, 'zone', '15-Minuten-Zone geschafft', '', 'jeder')}</div>
    </div>`;

  const banner = complete ? `
    <div class="card celebrate-banner">
      <span class="script big">${CELEBRATE_MESSAGES[dayOfYear(now) % CELEBRATE_MESSAGES.length]}</span>
      <p class="celebrate-sub">Alles für dich heute erledigt – der Rest des Tages gehört dir. ♡</p>
    </div>` : '';

  return `
    <div class="greeting">
      <div class="hello">${hello} ♡</div>
      <div class="date">${formatDateLong(now)}</div>
    </div>
    <div class="card quote-card"><span class="q-heart">♡</span>${esc(quote)}</div>
    ${standHTML()}
    ${banner}
    ${ampelCard}
    ${feedHTML(day)}
    ${sections}
    ${tasksHTML}
    ${todoHTML}
    ${zoneHTML}`;
}

/* ---------- Ansicht: To-dos ---------- */
function ownerBadge(owner) {
  const label = owner === 'haus' ? 'Beide' : (OWNER_META[owner]?.label || owner);
  return `<span class="owner-badge owner-${owner}">${esc(label)}</span>`;
}
function dueLabel(t) {
  if (!t.due) return '';
  const day = todayISO();
  if (t.due < day) return `<span class="due over">überfällig · ${t.due.slice(8, 10)}.${t.due.slice(5, 7)}.</span>`;
  if (t.due === day) return '<span class="due today">heute</span>';
  return `<span class="due">bis ${t.due.slice(8, 10)}.${t.due.slice(5, 7)}.</span>`;
}
function todoRowHTML(t) {
  return `
    <div class="check-item ${t.done_at ? 'done' : ''}" data-todo="${t.id}">
      <div class="check-box">✓</div>
      <div class="check-main">
        <div class="check-label">${esc(t.title)} <span class="pts pts-wilma">+${t.groesse || 3}</span></div>
        <div class="todo-meta">${ownerBadge(t.owner)} ${dueLabel(t)}</div>
      </div>
      ${t.done_by ? `<div class="who-wrap"><span class="who who-${t.done_by}">${PEOPLE[t.done_by]?.short || ''}</span></div>` : ''}
      ${t.done_at ? '' : `<button class="btn small subtle todo-edit" data-edit-todo="${t.id}">✎</button>`}
    </div>`;
}
function renderTodos() {
  const day = todayISO();
  const order = [me, 'haus', partnerOf(me)];
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.pos - b.pos;
  const open = store.state.todos.filter(t => !t.done_at);
  const doneToday = store.state.todos
    .filter(t => t.done_at && t.done_at.slice(0, 10) === day)
    .sort((a, b) => b.done_at.localeCompare(a.done_at));

  const groupTitle = o => o === 'haus' ? 'Für uns beide' : o === me ? 'Für mich' : `Für ${nameOf(o)}`;
  const groupsHTML = order.map(o => {
    const list = open.filter(t => t.owner === o).sort(byDue);
    if (!list.length) return '';
    return `<div class="hist-group-title">${esc(groupTitle(o))} <span class="badge">${list.length}</span></div>` +
      list.map(todoRowHTML).join('');
  }).join('');

  const openCard = `
    <div class="card">
      <h2 class="section-title">Offen ${open.length ? `<span class="badge">${open.length}</span>` : ''}</h2>
      ${open.length ? groupsHTML : '<p class="empty-note">Gerade nichts Einmaliges offen – wie schön! ♡</p>'}
      <div style="margin-top:10px"><button class="btn primary small" id="add-todo">+ To-do</button></div>
    </div>`;

  const doneCard = doneToday.length ? `
    <div class="card">
      <h2 class="section-title">Heute erledigt</h2>
      ${doneToday.map(todoRowHTML).join('')}
    </div>` : '';

  return openCard + doneCard + `
    <p class="empty-note" style="text-align:center">Alles früher Erledigte findet ihr im Verlauf ↺</p>`;
}

/* ---------- Ansicht: Woche ---------- */
function renderWoche() {
  const now = new Date();
  const monday = mondayOf(now);
  const cards = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const dayIso = toISO(date);
    const isToday = dayIso === todayISO();
    const tasks = tasksForDate(date);
    const due = tasks.filter(t => isBiweeklyDue(t, date));
    const paused = tasks.filter(t => !isBiweeklyDue(t, date));
    const note = t => t.cadence === 'biweekly' ? '2-wö.' : '';
    cards.push(`
      <div class="card day-card ${isToday ? 'today' : ''}">
        <div class="day-title">${WEEKDAY_NAMES[i + 1]} · ${date.getDate()}.${date.getMonth() + 1}.</div>
        ${due.map(t => checkItemHTML(dayIso, 'task:' + t.id, t.title, note(t), t.owner)).join('')}
        ${paused.map(t => `<div class="check-item skip-week"><div class="check-box"></div>
          <div class="check-label">${esc(t.title)}</div><div class="check-note">nächste Wo.</div></div>`).join('')}
        <div style="margin-top:6px">${checkItemHTML(dayIso, 'zone', '15-Minuten-Zone', '', 'jeder')}</div>
      </div>`);
  }
  return `<div class="week-grid">${cards.join('')}</div>`;
}

/* ---------- Ansicht: Regeln ---------- */
function renderRegeln() {
  const rules = store.state.rules.slice().sort((a, b) => a.pos - b.pos);
  const ampeln = ampelRoutines();
  const ruleList = list => list.map(r => `<div class="rule-item"><span class="rule-heart">♡</span><span class="grow">${esc(r.text)}</span></div>`).join('');
  const haus = rules.filter(r => r.owner === 'haus' || r.owner === 'gemeinsam');
  const personCards = PERSON_KEYS.map(p => {
    const list = rules.filter(r => r.owner === p);
    return list.length ? `<div class="card"><h2 class="section-title">${esc(genitiv(p))} Regeln</h2>${ruleList(list)}</div>` : '';
  }).join('');
  return `
    <div class="card">
      <h2 class="section-title">Unsere Hausregeln</h2>
      ${ampeln.map(r => `<div class="rule-item"><span class="rule-heart">●</span><span class="grow"><b>${esc(r.title)}</b>, ${esc(r.gate || '')}.<br><span class="settings-sub">Wird grün, wenn ihr beide bestätigt habt.</span></span></div>`).join('')}
      ${ruleList(haus)}
      ${!ampeln.length && !haus.length ? '<p class="empty-note">Noch keine Hausregeln.</p>' : ''}
    </div>
    ${personCards}
    <div class="card">
      <h2 class="section-title">Lauras Projektzeit</h2>
      <p class="projekt-text">${esc(store.state.settings.projektzeit || DEFAULT_PROJEKTZEIT)}</p>
    </div>
    <p class="empty-note" style="text-align:center">Ändern könnt ihr alles unter „Anpassen" ✎</p>`;
}

/* ---------- Ansicht: Anpassen ---------- */
function ownerOptions(selected, allowed = ['haus', 'jeder', 'gemeinsam', 'dennis', 'laura']) {
  const hint = { haus: ' (einer reicht)', jeder: ' (jeder hakt für sich)', gemeinsam: ' (Ampel – beide bestätigen)' };
  return allowed.map(o => `<option value="${o}" ${selected === o ? 'selected' : ''}>${esc(OWNER_META[o].label)}${hint[o] || ''}</option>`).join('');
}
function sizeOptions(selected) {
  return SIZES.map(g => `<option value="${g}" ${Number(selected) === g ? 'selected' : ''}>${SIZE_META[g]} · ${g} ${g === 1 ? 'Punkt' : 'Punkte'}</option>`).join('');
}
function itemBadges(x) {
  return `<span class="pts pts-${pointArtOf(x.owner)}">+${x.groesse || 1}</span>${x.zu_zweit ? ' <span class="badge">zu zweit</span>' : ''}`;
}

function renderEinstellungen() {
  const tasksByDay = {};
  for (const t of store.state.tasks.filter(t => t.active).sort((a, b) => a.pos - b.pos)) {
    (tasksByDay[t.weekday] = tasksByDay[t.weekday] || []).push(t);
  }
  const dayBlocks = [1, 2, 3, 4, 5, 6, 7].map(wd => `
    <div class="card">
      <h2 class="section-title">${WEEKDAY_NAMES[wd]}</h2>
      ${(tasksByDay[wd] || []).map(t => `
        <div class="settings-row">
          <span class="grow">${esc(t.title)} ${itemBadges(t)} ${t.owner !== 'haus' ? ownerBadge(t.owner) : ''} ${t.cadence === 'biweekly' ? '<span class="badge">2-wöchentlich</span>' : ''}</span>
          <button class="btn small subtle" data-edit-task="${t.id}">✎</button>
        </div>`).join('') || '<p class="empty-note">Noch keine Aufgaben.</p>'}
      <div style="margin-top:10px"><button class="btn small" data-add-task="${wd}">+ Aufgabe</button></div>
    </div>`).join('');

  const blockTitle = { jeder: 'Für jeden (z. B. Morgenroutine)', haus: 'Haus (einer reicht / zu zweit)', gemeinsam: 'Gemeinsam (Ampeln)' };
  const routineBlocks = ['jeder', 'haus', 'gemeinsam', me, partnerOf(me)].map(owner => {
    const groups = routinesBySection(owner);
    const secs = Object.keys(groups).sort((a, b) => (SECTION_META[a]?.order || 9) - (SECTION_META[b]?.order || 9));
    const title = blockTitle[owner] || (owner === me ? 'Nur für mich' : `Nur für ${nameOf(owner)}`);
    return `
      <div class="card">
        <h2 class="section-title">${esc(title)}</h2>
        ${secs.map(sec => `
          <div class="hist-group-title">${esc(SECTION_META[sec]?.label || sec)}</div>
          ${groups[sec].map(r => `
            <div class="settings-row">
              <span class="grow">${esc(r.title)} ${itemBadges(r)}${r.gate ? ` <span class="settings-sub">– ${esc(r.gate)}</span>` : ''}</span>
              <button class="btn small subtle" data-edit-routine="${r.id}">✎</button>
            </div>`).join('')}`).join('') || '<p class="empty-note">Noch keine Punkte.</p>'}
        <div style="margin-top:10px"><button class="btn small" data-add-routine="${owner}">+ Punkt</button></div>
      </div>`;
  }).join('');

  const g = goals();
  const goalsBlock = `
    <div class="card">
      <h2 class="section-title">Unsere Ziele</h2>
      <p class="settings-sub" style="margin-bottom:8px">Anteil der laut Plan fälligen Aufgaben, den ihr zusammen schaffen wollt. To-dos geben Punkte, zählen aber nicht in die Quote.</p>
      <div class="goals-grid">
        <span></span><b>Soul</b><b>Wilma</b>
        ${Object.keys(PERIOD_META).map(m => `
          <span>${PERIOD_META[m]}</span>
          <input type="number" min="10" max="100" step="5" inputmode="numeric" data-goal="soul.${m}" value="${g.soul[m]}">
          <input type="number" min="10" max="100" step="5" inputmode="numeric" data-goal="wilma.${m}" value="${g.wilma[m]}">`).join('')}
      </div>
      <div style="margin-top:10px"><button class="btn small primary" id="save-goals">Ziele speichern ♡</button></div>
    </div>`;

  const rules = store.state.rules.slice().sort((a, b) => a.pos - b.pos);
  const rulesBlock = `
    <div class="card">
      <h2 class="section-title">Regeln</h2>
      ${rules.map(r => `
        <div class="settings-row">
          <span class="grow">${esc(r.text)} ${ownerBadge(r.owner)}</span>
          <button class="btn small subtle" data-edit-rule="${r.id}">✎</button>
        </div>`).join('')}
      <div style="margin-top:10px">
        <button class="btn small" id="add-rule">+ Regel</button>
        <button class="btn small subtle" id="edit-projektzeit">Lauras Projektzeit-Text ändern</button>
      </div>
      <p class="settings-sub" style="margin-top:8px">Eine Hausregel mit Ampel (beide bestätigen) legt ihr oben unter „Gemeinsam → + Punkt" an.</p>
    </div>`;

  const sync = store.mode === 'cloud'
    ? `<span class="sync-status ok">● Synchronisiert über die Cloud${store.online === false ? ' (gerade offline, nutzt lokalen Stand)' : ''}</span>`
    : `<span class="sync-status off">● Testmodus – Daten bleiben auf diesem Gerät</span>`;
  const whoBlock = store.mode === 'cloud'
    ? `<p style="margin-bottom:8px">Angemeldet als <b>${esc(nameOf(me))}</b> <button class="btn small subtle" id="logout">Abmelden</button></p>`
    : `<p style="margin-bottom:8px">Testmodus – ich bin: ${PERSON_KEYS.map(p => `<button class="btn small ${p === me ? 'primary' : 'subtle'}" data-be="${p}">${nameOf(p)}</button>`).join(' ')}</p>`;
  const pushBlock = store.mode === 'cloud' ? `
    <div class="card" id="push-card">
      <h2 class="section-title">Benachrichtigungen</h2>
      <p class="settings-sub" style="margin-bottom:8px">Wilma OS sagt dir Bescheid, wenn ${esc(nameOf(partnerOf(me)))} etwas erledigt, bucht oder dir ein To-do gibt. Ruhezeit 22–7 Uhr. Nie für dein eigenes Häkchen.</p>
      <div id="push-status"><span class="settings-sub">… prüfe</span></div>
    </div>` : '';
  const infoBlock = `
    <div class="card">
      <h2 class="section-title">App</h2>
      ${whoBlock}
      <p style="margin-bottom:8px">${sync}</p>
      <p class="settings-sub" style="margin-bottom:8px">Wilma OS · Version ${APP_VERSION} · Die App sucht selbst nach Updates und sagt Bescheid. ♡</p>
      <p class="settings-sub">Tipp: In Safari über „Teilen → Zum Home-Bildschirm" installieren, dann fühlt sich Wilma OS wie eine echte App an. ♡</p>
    </div>`;

  return `${goalsBlock}
    <h2 class="section-title" style="margin:14px 0 10px">Routinen</h2>${routineBlocks}
    <h2 class="section-title" style="margin:14px 0 10px">Wochenplan</h2>${dayBlocks}
    ${rulesBlock}${pushBlock}${infoBlock}`;
}
async function fillPushStatus() {
  const el = document.getElementById('push-status');
  if (!el) return;
  const st = await pushStatus();
  const hint = isIOS() && !isStandalone() ? '<p class="settings-sub" style="margin-top:6px">Auf dem iPhone geht das nur in der installierten App (Teilen → Zum Home-Bildschirm).</p>' : '';
  el.innerHTML = st === 'on' ? '<span class="sync-status ok">● Push ist an auf diesem Gerät</span> <button class="btn small subtle" id="push-off">Ausschalten</button>'
    : st === 'denied' ? '<span class="sync-status off">● In den Geräte-Einstellungen blockiert</span>' + hint
    : st === 'unsupported' ? '<span class="sync-status off">● Dieses Gerät kann keine Push-Nachrichten</span>' + hint
    : '<button class="btn small primary" id="push-on">Push einschalten ♡</button>' + hint;
  const on = document.getElementById('push-on'); if (on) on.onclick = enablePush;
  const off = document.getElementById('push-off'); if (off) off.onclick = disablePush;
}

/* ---------- Budget ---------- */
let budgetMonth = null;
let budgetFilter = 'alle';   // alle | dennis | laura | gemeinsam
let budgetView = 'ausgaben'; // ausgaben | konten
const CAT_PASTELS = ['#f8e3d1', '#f5d8d3', '#f4ecc9', '#d9ece7', '#e4def2', '#f7e0ea'];

function monthKeyOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return monthKeyOf(new Date(y, m - 1 + delta, 1));
}
function euro(cents) { return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
function parseEuro(s) {
  s = String(s).trim().replace(/€/g, '').replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(s)) s = s.replace(/\./g, '');   // „2.350" = Tausender-Punkt, „2.35" = Dezimalpunkt
  const n = parseFloat(s);
  return (isNaN(n) || n < 0) ? null : Math.round(n * 100);
}
function ensureMonthBudgets(month) {
  const b = store.state.budgets;
  if (b[month]) return;
  const prev = Object.keys(b).filter(k => k < month && Object.keys(b[k]).length).sort().pop();
  if (prev) store.copyBudgets(month, b[prev]);
  else b[month] = {};
}
function monthExpensesFor(month) {
  return store.state.expenses.filter(e => (e.day || '').startsWith(month));
}

function parseEuroSigned(s) {
  s = String(s).trim();
  const neg = s.startsWith('-') || s.startsWith('−');
  const v = parseEuro(s.replace(/^[-−]\s*/, ''));
  return v === null ? null : (neg ? -v : v);
}
function euroSigned(cents) { return (cents < 0 ? '−' : '') + euro(Math.abs(cents)); }
// Letzter Kontostand bis einschließlich Tag (oder überhaupt)
function balanceAt(accountId, dayIso) {
  const list = store.state.balances.filter(b => b.account_id === accountId && (!dayIso || b.day <= dayIso)).sort((a, b) => a.day.localeCompare(b.day));
  return list.length ? list[list.length - 1] : null;
}
function netAt(accounts, dayIso) {
  let sum = 0, any = false;
  for (const a of accounts) { const b = balanceAt(a.id, dayIso); if (b) { any = true; sum += (ACCOUNT_ARTS[a.art]?.sign || 1) * b.amount; } }
  return any ? sum : null;
}
function netChartHTML(accounts) {
  const months = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);   // Monatsende
    const end = i === 0 ? todayISO() : toISO(d);
    months.push({ label: d.toLocaleDateString('de-DE', { month: 'short' }), net: netAt(accounts, end), key: monthKeyOf(d) });
  }
  const pts = months.filter(m => m.net !== null);
  if (pts.length < 2) return '<p class="settings-sub">Ab dem zweiten Monat mit Kontoständen erscheint hier die Kurve.</p>';
  const vals = pts.map(p => p.net);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const W = 320, H = 110, pad = 8;
  const x = i => pad + i * (W - 2 * pad) / (months.length - 1);
  const y = v => H - pad - ((v - min) / ((max - min) || 1)) * (H - 2 * pad);
  const path = months.map((m, i) => m.net === null ? null : `${x(i).toFixed(1)},${y(m.net).toFixed(1)}`).filter(Boolean);
  const zero = y(0);
  return `
    <svg class="net-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Vermögensverlauf 12 Monate">
      <line x1="${pad}" y1="${zero}" x2="${W - pad}" y2="${zero}" class="net-zero"/>
      <polyline points="${path.join(' ')}" class="net-line"/>
      ${months.map((m, i) => m.net === null ? '' : `<circle cx="${x(i)}" cy="${y(m.net)}" r="3" class="net-dot ${i === months.length - 1 ? 'last' : ''}"/>`).join('')}
    </svg>
    <div class="net-labels">${months.map(m => `<span>${m.label}</span>`).join('')}</div>`;
}
function renderKonten() {
  const accounts = store.state.accounts.filter(a => a.active).sort((a, b) => a.pos - b.pos);
  const today = todayISO();
  const month = today.slice(0, 7);
  const net = netAt(accounts, today);
  const prevMonthEnd = toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 0));
  const netPrev = netAt(accounts, prevMonthEnd);
  const delta = (net !== null && netPrev !== null) ? net - netPrev : null;
  const needsEntry = accounts.length && !store.state.balances.some(b => b.day.startsWith(month)) && Number(today.slice(8, 10)) <= 10;

  const summary = accounts.length ? `
    <div class="card net-card">
      <h2 class="section-title">Vermögen netto</h2>
      <div class="net-value ${net !== null && net < 0 ? 'over-text' : ''}">${net === null ? '–' : euroSigned(net)}</div>
      ${delta !== null ? `<div class="settings-sub">seit Vormonat ${delta >= 0 ? '+' : '−'}${euro(Math.abs(delta))} ${trendArrow(delta, 0)}</div>` : '<div class="settings-sub">Guthaben minus Schulden (Kredite, Kreditkarte)</div>'}
      ${netChartHTML(accounts)}
    </div>` : '';

  const reminder = needsEntry ? `
    <div class="card reminder-card">
      <b>Zeit für die Kontostände ${monthLabel(month)} ♡</b>
      <p class="settings-sub">Einmal im Monat alle Stände eintragen – dann wächst die Kurve.</p>
      <div style="margin-top:8px"><button class="btn small primary" data-add-balance="">+ Kontostand</button></div>
    </div>` : '';

  const list = accounts.map(a => {
    const art = ACCOUNT_ARTS[a.art] || ACCOUNT_ARTS.sonstiges;
    const cur = balanceAt(a.id, null);
    const hist = store.state.balances.filter(b => b.account_id === a.id).sort((x, y) => x.day.localeCompare(y.day));
    const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
    const d = cur && prev ? art.sign * (cur.amount - prev.amount) : null;   // Wirkung aufs Vermögen (Tilgung = plus)
    return `
      <div class="card budget-cat" data-account="${a.id}">
        <div class="cat-emoji" style="background:${art.sign < 0 ? '#f5d8d3' : '#d9ece7'}">${art.emoji}</div>
        <div class="cat-main">
          <div class="cat-name">${esc(a.name)} ${(a.owner || 'gemeinsam') !== 'gemeinsam' ? `<span class="who who-${a.owner}">${PEOPLE[a.owner].short}</span>` : ''}</div>
          <div class="cat-sub">${art.label}${cur ? ` · Stand ${cur.day.slice(8, 10)}.${cur.day.slice(5, 7)}.` : ' · noch kein Stand'}${d !== null ? ` · ${d >= 0 ? '+' : '−'}${euro(Math.abs(d))} ${trendArrow(d, 0)}` : ''}</div>
        </div>
        <div class="acc-amount ${art.sign < 0 ? 'over-text' : ''}">${cur ? (art.sign < 0 ? '−' : '') + euro(Math.abs(cur.amount)) : '–'}</div>
      </div>`;
  }).join('');

  const empty = accounts.length ? '' : `
    <div class="card" style="text-align:center"><p class="empty-note">Legt eure Konten an – Giro, Tagesgeld, Depot, auch den Hauskredit. Einmal im Monat die Stände eintragen, und ihr seht, wie sich euer Vermögen entwickelt. ♡</p></div>`;
  const actions = `
    <div class="budget-actions">
      ${accounts.length ? '<button class="btn primary" data-add-balance="">+ Kontostand</button>' : ''}
      <button class="btn" id="add-account">+ Konto</button>
    </div>`;
  return reminder + summary + list + empty + actions;
}
function accountModal(acc) {
  const isNew = !acc;
  openModal(`
    <h3>${isNew ? 'Neues Konto' : 'Konto bearbeiten'}</h3>
    <label>Name</label>
    <input type="text" id="m-name" value="${acc ? esc(acc.name) : ''}" placeholder="z. B. Giro Laura, Hauskredit">
    <label>Art</label>
    <select id="m-art">${Object.keys(ACCOUNT_ARTS).map(k => `<option value="${k}" ${(acc ? acc.art : 'giro') === k ? 'selected' : ''}>${ACCOUNT_ARTS[k].emoji} ${ACCOUNT_ARTS[k].label}</option>`).join('')}</select>
    <label>Wem gehört es?</label>
    <select id="m-aowner">${['gemeinsam', 'dennis', 'laura'].map(o => `<option value="${o}" ${(acc ? acc.owner : 'gemeinsam') === o ? 'selected' : ''}>${o === 'gemeinsam' ? 'Gemeinsam' : nameOf(o)}</option>`).join('')}</select>
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const name = document.getElementById('m-name').value.trim();
    if (!name) return;
    const f = { name, art: document.getElementById('m-art').value, owner: document.getElementById('m-aowner').value };
    if (isNew) await store.addAccount(f); else await store.updateAccount(acc.id, f);
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => {
    if (!confirm(`„${acc.name}" und alle Kontostände löschen?`)) return;
    await store.deleteAccount(acc.id); closeModal(); render();
  };
}
function balanceModal(prefillId) {
  const accounts = store.state.accounts.filter(a => a.active).sort((a, b) => a.pos - b.pos);
  if (!accounts.length) return;
  openModal(`
    <h3>Kontostand eintragen</h3>
    <label>Konto</label>
    <select id="m-acc">${accounts.map(a => `<option value="${a.id}" ${a.id === prefillId ? 'selected' : ''}>${ACCOUNT_ARTS[a.art]?.emoji || ''} ${esc(a.name)}</option>`).join('')}</select>
    <label>Stand (€) – bei Krediten den offenen Betrag</label>
    <input type="text" id="m-amount" inputmode="decimal" placeholder="z. B. 2.350,00" autofocus>
    <label>Stichtag</label>
    <input type="date" id="m-day" value="${todayISO()}">
    <div class="modal-actions">
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const amount = parseEuroSigned(document.getElementById('m-amount').value);
    if (amount === null) { document.getElementById('m-amount').focus(); return; }
    await store.setBalance(document.getElementById('m-acc').value, document.getElementById('m-day').value || todayISO(), amount, me);
    closeModal(); render(); showToast('Kontostand gespeichert ♡');
  };
}
function accountDetailModal(acc) {
  const art = ACCOUNT_ARTS[acc.art] || ACCOUNT_ARTS.sonstiges;
  const hist = store.state.balances.filter(b => b.account_id === acc.id).sort((x, y) => y.day.localeCompare(x.day));
  openModal(`
    <h3>${art.emoji} ${esc(acc.name)}</h3>
    ${hist.length ? hist.map((b, i) => {
      const prev = hist[i + 1];
      const d = prev ? b.amount - prev.amount : null;
      return `<div class="expense-row">
        <span class="exp-day">${b.day.slice(8, 10)}.${b.day.slice(5, 7)}.${b.day.slice(2, 4)}</span>
        <span class="grow">${d !== null ? `<span class="settings-sub">${d >= 0 ? '+' : '−'}${euro(Math.abs(d))}</span>` : ''}</span>
        ${b.created_by ? `<span class="who who-${b.created_by}">${PEOPLE[b.created_by].short}</span>` : ''}
        <span class="exp-amount">${euroSigned(b.amount)}</span>
        <button class="btn small danger" data-del-bal="${b.day}">×</button>
      </div>`; }).join('') : '<p class="empty-note">Noch kein Kontostand eingetragen.</p>'}
    <div class="modal-actions">
      <button class="btn small subtle" id="m-cancel">Schließen</button>
      <button class="btn small" id="m-edit-acc">Bearbeiten</button>
      <button class="btn small primary" id="m-add-bal">+ Kontostand ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-edit-acc').onclick = () => { closeModal(); accountModal(acc); };
  document.getElementById('m-add-bal').onclick = () => { closeModal(); balanceModal(acc.id); };
  document.querySelectorAll('[data-del-bal]').forEach(b => b.onclick = async () => {
    await store.deleteBalance(acc.id, b.dataset.delBal); closeModal(); render(); accountDetailModal(acc);
  });
}

function renderBudget() {
  const viewBar = `
    <div class="seg-toggle">
      <button class="seg ${budgetView === 'ausgaben' ? 'active' : ''}" data-bview="ausgaben">Ausgaben</button>
      <button class="seg ${budgetView === 'konten' ? 'active' : ''}" data-bview="konten">Konten</button>
    </div>`;
  if (budgetView === 'konten') return viewBar + renderKonten();
  if (!budgetMonth) budgetMonth = monthKeyOf(new Date());
  ensureMonthBudgets(budgetMonth);
  const cats = store.state.budgetCats.filter(c => c.active && (budgetFilter === 'alle' || (c.owner || 'gemeinsam') === budgetFilter)).sort((a, b) => a.pos - b.pos);
  const catIds = new Set(cats.map(c => c.id));
  const budgets = store.state.budgets[budgetMonth] || {};
  const monthExpenses = monthExpensesFor(budgetMonth).filter(e => catIds.has(e.cat_id));
  const spent = {};
  for (const e of monthExpenses) spent[e.cat_id] = (spent[e.cat_id] || 0) + e.amount;
  const totalBudget = cats.reduce((s, c) => s + (budgets[c.id] || 0), 0);
  const totalSpent = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const totalLeft = totalBudget - totalSpent;

  const filterLabel = { alle: 'Alle', [me]: 'Meine', [partnerOf(me)]: genitiv(partnerOf(me)), gemeinsam: 'Gemeinsam' };
  const filterBar = `
    <div class="seg-toggle">
      ${['alle', me, partnerOf(me), 'gemeinsam'].map(f => `<button class="seg ${budgetFilter === f ? 'active' : ''}" data-bfilter="${f}">${esc(filterLabel[f])}</button>`).join('')}
    </div>`;
  const nav = filterBar + `
    <div class="month-nav">
      <button class="btn small subtle" id="bm-prev">‹</button>
      <div class="month-label">${monthLabel(budgetMonth)}</div>
      <button class="btn small subtle" id="bm-next">›</button>
    </div>`;

  const summary = cats.length ? `
    <div class="card budget-summary">
      <div class="bs-row">
        <span>${euro(totalSpent)} von ${euro(totalBudget)}</span>
        <span class="${totalLeft < 0 ? 'over-text' : ''}">${totalLeft < 0 ? euro(-totalLeft) + ' drüber' : euro(totalLeft) + ' übrig'}</span>
      </div>
      <div class="cat-bar"><div class="cat-fill ${totalBudget && totalSpent > totalBudget ? 'over' : ''}"
        style="width:${totalBudget ? Math.min(100, totalSpent / totalBudget * 100) : 0}%"></div></div>
    </div>` : '';

  const catCards = cats.map((c, i) => {
    const bud = budgets[c.id] || 0;
    const sp = spent[c.id] || 0;
    const left = bud - sp;
    const n = monthExpenses.filter(e => e.cat_id === c.id).length;
    const pct = bud ? Math.min(100, sp / bud * 100) : (sp > 0 ? 100 : 0);
    const stateCls = bud && sp > bud ? 'over' : (bud && sp / bud >= 0.9 ? 'warn' : '');
    return `
      <div class="card budget-cat" data-cat="${c.id}">
        <div class="cat-emoji" style="background:${CAT_PASTELS[i % CAT_PASTELS.length]}">${esc(c.emoji || '♡')}</div>
        <div class="cat-main">
          <div class="cat-name">${esc(c.name)} ${(c.owner || 'gemeinsam') !== 'gemeinsam' ? `<span class="who who-${c.owner}">${PEOPLE[c.owner].short}</span>` : ''} <span class="badge">${n} ${n === 1 ? 'Eintrag' : 'Einträge'}</span></div>
          <div class="cat-bar"><div class="cat-fill ${stateCls}" style="width:${pct}%"></div></div>
          <div class="cat-sub">${euro(sp)} von ${euro(bud)} · <span class="${left < 0 ? 'over-text' : ''}">${left < 0 ? euro(-left) + ' drüber' : euro(left) + ' übrig'}</span></div>
        </div>
        <button class="btn small subtle" data-edit-cat="${c.id}">✎</button>
      </div>`;
  }).join('');

  const empty = cats.length ? '' : `
    <div class="card" style="text-align:center">
      <p class="empty-note">Leg deine erste Kategorie an – z. B. Taschengeld, Drogerie oder Hund 🐾<br>Dann kannst du jede Ausgabe eintragen und siehst sofort, wie viel noch übrig ist. ♡</p>
    </div>`;

  const actions = `
    <div class="budget-actions">
      ${cats.length ? '<button class="btn primary" id="add-expense">+ Ausgabe</button>' : ''}
      <button class="btn" id="add-cat">+ Kategorie</button>
    </div>`;

  return viewBar + nav + summary + catCards + empty + actions;
}

function catDetailModal(cat) {
  const list = monthExpensesFor(budgetMonth)
    .filter(e => e.cat_id === cat.id)
    .sort((a, b) => b.day.localeCompare(a.day));
  const budgets = store.state.budgets[budgetMonth] || {};
  const bud = budgets[cat.id] || 0;
  const sp = list.reduce((s, e) => s + e.amount, 0);
  openModal(`
    <h3>${esc(cat.emoji || '♡')} ${esc(cat.name)} · ${monthLabel(budgetMonth)}</h3>
    <p class="cat-sub" style="margin-bottom:8px">${euro(sp)} von ${euro(bud)} · ${bud - sp < 0 ? euro(sp - bud) + ' drüber' : euro(bud - sp) + ' übrig'}</p>
    ${list.length ? list.map(e => `
      <div class="expense-row">
        <span class="exp-day">${e.day.slice(8, 10)}.${e.day.slice(5, 7)}.</span>
        <span class="grow">${esc(e.note || '–')}</span>
        <span class="who who-${e.created_by || 'laura'}">${PEOPLE[e.created_by || 'laura'].short}</span>
        <span class="exp-amount">${euro(e.amount)}</span>
        <button class="btn small danger" data-del-exp="${e.id}">×</button>
      </div>`).join('') : '<p class="empty-note">Noch keine Ausgaben in diesem Monat.</p>'}
    <div class="modal-actions">
      <button class="btn small subtle" id="m-cancel">Schließen</button>
      <button class="btn small" id="m-edit-cat">Bearbeiten</button>
      <button class="btn small primary" id="m-add-exp">+ Ausgabe ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-edit-cat').onclick = () => { closeModal(); budgetCatModal(cat); };
  document.getElementById('m-add-exp').onclick = () => { closeModal(); expenseModal(cat.id); };
  document.querySelectorAll('[data-del-exp]').forEach(b => b.onclick = async () => {
    await store.deleteExpense(b.dataset.delExp);
    closeModal(); render(); catDetailModal(cat);
  });
}

function budgetCatModal(cat) {
  const isNew = !cat;
  const budgets = store.state.budgets[budgetMonth] || {};
  const curBudget = cat ? (budgets[cat.id] || 0) : 0;
  openModal(`
    <h3>${isNew ? 'Neue Kategorie' : 'Kategorie bearbeiten'}</h3>
    <label>Name</label>
    <input type="text" id="m-name" value="${cat ? esc(cat.name) : ''}" placeholder="z. B. Taschengeld">
    <label>Symbol (Emoji)</label>
    <input type="text" id="m-emoji" value="${cat ? esc(cat.emoji || '') : ''}" placeholder="z. B. 🛍️" maxlength="4">
    <label>Wessen Budget?</label>
    <select id="m-cowner">
      ${['gemeinsam', 'dennis', 'laura'].map(o => `<option value="${o}" ${(cat ? (cat.owner || 'gemeinsam') : me) === o ? 'selected' : ''}>${o === 'gemeinsam' ? 'Gemeinsam' : nameOf(o)}</option>`).join('')}
    </select>
    <label>Budget für ${monthLabel(budgetMonth)} (€)</label>
    <input type="text" id="m-budget" inputmode="decimal" value="${curBudget ? (curBudget / 100).toLocaleString('de-DE') : ''}" placeholder="z. B. 100">
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const name = document.getElementById('m-name').value.trim();
    if (!name) return;
    const emoji = document.getElementById('m-emoji').value.trim() || '♡';
    const owner = document.getElementById('m-cowner').value;
    const cents = parseEuro(document.getElementById('m-budget').value) || 0;
    let id;
    if (isNew) {
      const row = await store.addBudgetCat({ name, emoji, owner });
      id = row.id;
    } else {
      await store.updateBudgetCat(cat.id, { name, emoji, owner });
      id = cat.id;
    }
    await store.setBudget(budgetMonth, id, cents);
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => {
    if (!confirm(`„${cat.name}" und alle zugehörigen Ausgaben löschen?`)) return;
    await store.deleteBudgetCat(cat.id);
    closeModal(); render();
  };
}

function expenseModal(prefillCatId) {
  const ownRank = c => ({ [me]: 0, gemeinsam: 1 }[c.owner || 'gemeinsam'] ?? 2);
  const cats = store.state.budgetCats.filter(c => c.active).sort((a, b) => ownRank(a) - ownRank(b) || a.pos - b.pos);
  if (!cats.length) return;
  const catLabel = c => `${c.emoji || '♡'} ${c.name}${(c.owner || 'gemeinsam') === 'gemeinsam' ? '' : ' (' + nameOf(c.owner) + ')'}`;
  openModal(`
    <h3>Neue Ausgabe</h3>
    <label>Betrag (€)</label>
    <input type="text" id="m-amount" inputmode="decimal" placeholder="z. B. 12,50" autofocus>
    <label>Kategorie</label>
    <select id="m-cat">
      ${cats.map(c => `<option value="${c.id}" ${c.id === prefillCatId ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')}
    </select>
    <label>Notiz (optional)</label>
    <input type="text" id="m-note" placeholder="z. B. dm-Einkauf">
    <label>Datum</label>
    <input type="date" id="m-day" value="${todayISO()}">
    <div class="modal-actions">
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Eintragen ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const amount = parseEuro(document.getElementById('m-amount').value);
    if (!amount) { document.getElementById('m-amount').focus(); return; }
    const day = document.getElementById('m-day').value || todayISO();
    await store.addExpense({
      cat_id: document.getElementById('m-cat').value,
      amount,
      note: document.getElementById('m-note').value.trim(),
      day,
      created_by: me,
    });
    budgetMonth = day.slice(0, 7);
    closeModal(); render();
  };
}

/* ---------- To-dos ---------- */
// Wer zuerst kommt: jeder darf jedes To-do abhaken, gespeichert wird, wer es war.
async function toggleTodo(id) {
  const t = store.state.todos.find(t => t.id === id);
  if (!t) return;
  const on = !t.done_at;
  await store.updateTodo(id, on ? { done_at: new Date().toISOString(), done_by: me } : { done_at: null, done_by: null });
  render();
  if (on) {
    showToast(ptsText(t.groesse || 3, 'wilma') + ' ♡');
    notify('To-do erledigt ✓', `${nameOf(me)} hat „${t.title}" erledigt (${ptsText(t.groesse || 3, 'wilma')}).`);
  }
}

function todoModal(todo) {
  const isNew = !todo;
  openModal(`
    <h3>${isNew ? 'Neues To-do' : 'To-do bearbeiten'}</h3>
    <label>Was steht an?</label>
    <input type="text" id="m-title" value="${todo ? esc(todo.title) : ''}" placeholder="z. B. Glühbirne Flur tauschen">
    <label>Für wen?</label>
    <select id="m-owner">
      ${['haus', 'dennis', 'laura'].map(o => `<option value="${o}" ${(todo ? todo.owner : 'haus') === o ? 'selected' : ''}>${o === 'haus' ? 'Beide (einer reicht)' : nameOf(o)}</option>`).join('')}
    </select>
    <label>Größe</label>
    <select id="m-size">${sizeOptions(todo ? todo.groesse || 3 : 3)}</select>
    <label>Fällig am (optional)</label>
    <input type="date" id="m-due" value="${todo && todo.due ? todo.due : ''}">
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const title = document.getElementById('m-title').value.trim();
    if (!title) return;
    const fields = {
      title,
      owner: document.getElementById('m-owner').value,
      groesse: Number(document.getElementById('m-size').value),
      due: document.getElementById('m-due').value || null,
    };
    if (isNew) await store.addTodo(fields); else await store.updateTodo(todo.id, fields);
    if (fields.owner === partnerOf(me) && (isNew || todo.owner !== fields.owner)) {
      notify('Neues To-do für dich', `${nameOf(me)}: „${fields.title}"${fields.due ? ' · bis ' + fields.due.slice(8, 10) + '.' + fields.due.slice(5, 7) + '.' : ''}`);
    }
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => {
    await store.deleteTodo(todo.id); closeModal(); render();
  };
}

/* ---------- Buchen („Ich übernehme" / „Dazubuchen" / „Zurückgeben") ---------- */
async function bookingAction(key, act) {
  const day = todayISO();
  const title = itemOf(key)?.title || 'Aufgabe';
  if (act === 'release') {
    await store.unbook(day, key, me);
    render(); showToast(`${title} zurückgegeben`);
    notify('Zurückgegeben', `${nameOf(me)} gibt „${title}" zurück – jemand muss übernehmen.`);
    return;
  }
  const hour = new Date().getHours();
  const guess = /abend/i.test(title) ? 'abend' : /morgen/i.test(title) ? 'morgen' : hour < 11 ? 'morgen' : hour < 16 ? 'mittag' : 'abend';
  if (act === 'join') {
    const other = bookingsFor(day, key).find(b => b.person !== me);
    await store.book(day, key, me, other ? other.slot : guess);
    render(); showToast(`Du bist bei „${title}" dabei ♡`);
    notify('Dabei ♡', `${nameOf(me)} kommt bei „${title}" mit.`);
    return;
  }
  openModal(`
    <h3>${esc(title)}</h3>
    <label>Wann übernimmst du?</label>
    <div class="slot-row">
      ${Object.keys(SLOTS).map(k => `<button class="btn ${k === guess ? 'primary' : ''}" data-slot="${k}">${SLOTS[k]}</button>`).join('')}
    </div>
    <div class="modal-actions"><button class="btn small subtle" id="m-cancel">Abbrechen</button></div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.querySelectorAll('[data-slot]').forEach(b => b.onclick = async () => {
    await store.book(day, key, me, b.dataset.slot);
    closeModal(); render();
    showToast(`Gebucht: ${title} · ${SLOTS[b.dataset.slot]} ♡`);
    notify('Übernommen', `${nameOf(me)} übernimmt „${title}" ${SLOTS[b.dataset.slot]} – du kannst dich dazubuchen.`);
  });
}

/* ---------- Verlauf (Team-Ziele, Punkte, Historie) ---------- */
let verlaufMode = 'woche';
const VERLAUF_COUNT = { woche: 8, monat: 6, quartal: 4, jahr: 3 };

function isoWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function trendArrow(cur, prev) {
  if (cur > prev) return '<span class="trend up">▲</span>';
  if (cur < prev) return '<span class="trend down">▼</span>';
  return '<span class="trend flat">●</span>';
}

// wie oft wurde ein Punkt im Zeitraum von wem abgehakt: { dennis: n, laura: n }
function itemCountsByPerson(key, startIso, endIso) {
  const out = { dennis: 0, laura: 0 };
  const today = todayISO();
  for (const day of Object.keys(store.state.checks)) {
    if (day < startIso || day > endIso || day > today) continue;
    const c = store.state.checks[day][key];
    if (c) for (const p of PERSON_KEYS) if (c[p]) out[p]++;
  }
  return out;
}

function renderVerlauf() {
  const mode = verlaufMode;
  const n = VERLAUF_COUNT[mode];
  const first = firstCheckDays();
  const g = goals();
  const toggle = `
    <div class="seg-toggle">
      ${Object.keys(PERIOD_META).map(m => `<button class="seg ${mode === m ? 'active' : ''}" data-mode="${m}">${PERIOD_META[m]}</button>`).join('')}
    </div>`;

  if (!first.any) {
    return toggle + `<div class="card" style="text-align:center">
      <p class="empty-note">Sobald ihr die ersten Häkchen setzt, wächst hier euer Verlauf. ♡</p></div>`;
  }

  const periods = [];
  for (let i = n - 1; i >= 0; i--) periods.push(periodRange(mode, -i));
  const stats = periods.map(p => ({ ...p, soul: quota('soul', p.start, p.end, first), wilma: quota('wilma', p.start, p.end, first) }))
    .filter(s => s.soul.pct !== null || s.wilma.pct !== null);

  const bar = (art, q) => `
    <div class="vbar-track"><div class="vbar vbar-${art}" style="height:${Math.max(3, q.pct ?? 0)}%"></div>
      <div class="vgoal" style="bottom:${g[art][mode]}%"></div></div>`;
  const bars = stats.map((s, i) => `
    <div class="vbar-wrap ${i === stats.length - 1 ? 'current' : ''}">
      <div class="vbar-pct">${s.soul.pct ?? '–'} · ${s.wilma.pct ?? '–'}</div>
      <div class="vpair">${bar('soul', s.soul)}${bar('wilma', s.wilma)}</div>
      <div class="vbar-label">${esc(s.label)}</div>
    </div>`).join('');

  let trendText = '';
  if (stats.length >= 2) {
    const cur = stats[stats.length - 1], prev = stats[stats.length - 2];
    const line = art => {
      const c = cur[art].pct, p = prev[art].pct;
      if (c === null || p === null) return '';
      const d = c - p;
      return `<div>${art === 'soul' ? 'Soul' : 'Wilma'}: <b>${c} %</b> (Ziel ${g[art][mode]} %) ${d > 0 ? `<span class="trend up">▲ +${d}</span>` : d < 0 ? `<span class="trend down">▼ ${d}</span>` : '<span class="trend flat">●</span>'}</div>`;
    };
    trendText = `<div class="trend-line">${line('soul')}${line('wilma')}<div class="settings-sub">verglichen mit dem Zeitraum davor – jeder Tag zählt neu ♡</div></div>`;
  }

  const chartCard = `
    <div class="card">
      <h2 class="section-title">Unsere Quote</h2>
      <div class="vlegend"><span class="lg lg-soul">Soul</span><span class="lg lg-wilma">Wilma</span><span class="lg lg-goal">Ziel</span></div>
      <div class="vchart">${bars}</div>
      ${trendText}
    </div>`;

  const cur = periods[periods.length - 1], prev = periods[periods.length - 2];
  const pointsCard = `
    <div class="card">
      <h2 class="section-title">Punkte · ${esc(cur.label)}</h2>
      ${PERSON_KEYS.map(p => {
        const a = pointsFor(p, cur.startIso, cur.endIso);
        const b = prev ? pointsFor(p, prev.startIso, prev.endIso) : { soul: 0, wilma: 0 };
        return `<div class="hist-row"><span class="who who-${p}">${PEOPLE[p].short}</span><span class="grow">${esc(nameOf(p))}</span>
          <span class="pts pts-soul">${a.soul}</span> ${trendArrow(a.soul, b.soul)}
          <span class="pts pts-wilma">${a.wilma}</span> ${trendArrow(a.wilma, b.wilma)}</div>`;
      }).join('')}
      <p class="settings-sub" style="margin-top:8px">Soul = für sich selbst · Wilma = fürs Haus (inkl. To-dos)</p>
    </div>`;

  // Wer hat was wie oft gemacht (aktueller Zeitraum, Pfeil = Vergleich zum vorigen)
  const rows = [];
  const pushRow = (key, label) => {
    const a = itemCountsByPerson(key, cur.startIso, cur.endIso);
    const b = prev ? itemCountsByPerson(key, prev.startIso, prev.endIso) : { dennis: 0, laura: 0 };
    const total = a.dennis + a.laura, totalPrev = b.dennis + b.laura;
    if (!total && !totalPrev) return;
    rows.push(`<div class="hist-row"><span class="grow">${esc(label)}</span>
      ${PERSON_KEYS.filter(p => a[p]).map(p => `<span class="who who-${p}">${PEOPLE[p].short}</span><span class="hist-count">${a[p]}</span>`).join(' ')}
      ${trendArrow(total, totalPrev)}</div>`);
  };
  for (const r of store.state.routines.filter(r => r.active).sort((a, b) => (SECTION_META[a.section]?.order || 9) - (SECTION_META[b.section]?.order || 9) || a.pos - b.pos)) pushRow('routine:' + r.id, r.title);
  for (const t of store.state.tasks.filter(t => t.active).sort((a, b) => a.weekday - b.weekday || a.pos - b.pos)) pushRow('task:' + t.id, t.title);
  pushRow('zone', '15-Minuten-Zone ♡');
  const itemsCard = `
    <div class="card">
      <h2 class="section-title">Wer hat was gemacht · ${esc(cur.label)}</h2>
      ${rows.join('') || '<p class="empty-note">In diesem Zeitraum noch nichts abgehakt.</p>'}
    </div>`;

  // Erledigte To-dos im aktuellen Zeitraum
  const doneTodos = store.state.todos
    .filter(t => t.done_at && t.done_at.slice(0, 10) >= cur.startIso && t.done_at.slice(0, 10) <= cur.endIso)
    .sort((a, b) => b.done_at.localeCompare(a.done_at));
  const todosCard = `
    <div class="card">
      <h2 class="section-title">Erledigte To-dos · ${esc(cur.label)}</h2>
      ${doneTodos.length ? doneTodos.map(t => `
        <div class="hist-row">
          <span class="exp-day">${t.done_at.slice(8, 10)}.${t.done_at.slice(5, 7)}.</span>
          <span class="grow done-title">${esc(t.title)}</span>
          ${t.done_by ? `<span class="who who-${t.done_by}">${PEOPLE[t.done_by].short}</span>` : ''}
          <span class="pts pts-wilma">+${t.groesse || 3}</span>
        </div>`).join('') : '<p class="empty-note">In diesem Zeitraum noch keine To-dos erledigt.</p>'}
    </div>`;

  return toggle + chartCard + pointsCard + rewardsHTML() + itemsCard + todosCard;
}

/* ---------- Modals ---------- */
function openModal(html) {
  const wrap = document.getElementById('modal-wrap');
  document.getElementById('modal').innerHTML = html;
  wrap.classList.remove('hidden');
}
function closeModal() { document.getElementById('modal-wrap').classList.add('hidden'); }

function taskModal(task, weekday) {
  const isNew = !task;
  openModal(`
    <h3>${isNew ? 'Neue Aufgabe' : 'Aufgabe bearbeiten'}</h3>
    <label>Was ist zu tun?</label>
    <input type="text" id="m-title" value="${task ? esc(task.title) : ''}" placeholder="z. B. Hundeschule 🐾">
    <label>Wer?</label>
    <select id="m-owner">${ownerOptions(task ? task.owner : 'haus')}</select>
    <label>Größe</label>
    <select id="m-size">${sizeOptions(task ? task.groesse || 1 : 1)}</select>
    <label class="check-line"><input type="checkbox" id="m-zz" ${task && task.zu_zweit ? 'checked' : ''}> Zu zweit möglich (buchen &amp; dazubuchen)</label>
    <label>Wochentag</label>
    <select id="m-weekday">
      ${[1, 2, 3, 4, 5, 6, 7].map(wd => `<option value="${wd}" ${(task ? task.weekday : weekday) === wd ? 'selected' : ''}>${WEEKDAY_NAMES[wd]}</option>`).join('')}
    </select>
    <label>Rhythmus</label>
    <select id="m-cadence">
      <option value="weekly" ${(!task || task.cadence === 'weekly') ? 'selected' : ''}>Jede Woche</option>
      <option value="biweekly" ${(task && task.cadence === 'biweekly') ? 'selected' : ''}>Alle 2 Wochen</option>
    </select>
    <div id="m-anchor-row" style="${(task && task.cadence === 'biweekly') ? '' : 'display:none'}">
      <label>Diese Aufgabe ist dran …</label>
      <select id="m-anchor">
        <option value="this">diese Woche</option>
        <option value="next">erst nächste Woche</option>
      </select>
    </div>
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);

  const cadenceSel = document.getElementById('m-cadence');
  cadenceSel.onchange = () => {
    document.getElementById('m-anchor-row').style.display = cadenceSel.value === 'biweekly' ? '' : 'none';
  };
  if (task && task.cadence === 'biweekly') {
    document.getElementById('m-anchor').value = isBiweeklyDue(task, new Date()) ? 'this' : 'next';
  }
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const title = document.getElementById('m-title').value.trim();
    if (!title) return;
    const cadence = cadenceSel.value;
    let anchor = task ? task.anchor : toISO(mondayOf(new Date()));
    if (cadence === 'biweekly') {
      const choice = document.getElementById('m-anchor').value;
      const thisMon = mondayOf(new Date());
      if (choice === 'this') anchor = toISO(thisMon);
      else {
        const nextMon = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() + 7);
        anchor = toISO(nextMon);
      }
    }
    const owner = document.getElementById('m-owner').value;
    const patch = { title, owner, weekday: Number(document.getElementById('m-weekday').value), cadence, anchor,
      groesse: Number(document.getElementById('m-size').value), zu_zweit: owner === 'haus' && document.getElementById('m-zz').checked };
    if (isNew) await store.addTask(patch); else await store.updateTask(task.id, patch);
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => {
    await store.deleteTask(task.id); closeModal(); render();
  };
}

function routineModal(item, owner) {
  const isNew = !item;
  const curOwner = item ? item.owner : owner;
  const curSec = item ? item.section : (curOwner === 'gemeinsam' ? 'ampel' : curOwner === 'jeder' ? 'morgen' : 'alltag');
  openModal(`
    <h3>${isNew ? 'Neuer Routine-Punkt' : 'Routine bearbeiten'}</h3>
    <label>Bezeichnung</label>
    <input type="text" id="m-title" value="${item ? esc(item.title) : ''}" placeholder="z. B. Spülmaschine ausräumen">
    <label>Wer?</label>
    <select id="m-owner">${ownerOptions(curOwner)}</select>
    <label>Größe</label>
    <select id="m-size">${sizeOptions(item ? item.groesse || 1 : 1)}</select>
    <label class="check-line"><input type="checkbox" id="m-zz" ${item && item.zu_zweit ? 'checked' : ''}> Zu zweit möglich (buchen &amp; dazubuchen)</label>
    <label>Gehört zu</label>
    <select id="m-section">
      ${Object.keys(SECTION_META).map(s => `<option value="${s}" ${curSec === s ? 'selected' : ''}>${SECTION_META[s].label}</option>`).join('')}
    </select>
    <div id="m-gate-row">
      <label>Wann muss es erledigt sein?</label>
      <input type="text" id="m-gate" value="${item && item.gate ? esc(item.gate) : ''}" placeholder="z. B. bevor wir schlafen gehen">
      <label>Ampel</label>
      <select id="m-slot">
        <option value="morgen" ${item && item.gate_slot === 'morgen' ? 'selected' : ''}>Morgen-Ampel</option>
        <option value="abend" ${!item || item.gate_slot !== 'morgen' ? 'selected' : ''}>Abend-Ampel</option>
      </select>
      <p class="settings-sub" style="margin-top:6px">Eine Ampel wird erst grün, wenn ihr beide bestätigt habt.</p>
    </div>
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  const secSel = document.getElementById('m-section');
  const ownSel = document.getElementById('m-owner');
  const sync = () => {
    const isAmpel = secSel.value === 'ampel';
    if (isAmpel) ownSel.value = 'gemeinsam';
    ownSel.disabled = isAmpel;
    document.getElementById('m-gate-row').style.display = isAmpel ? '' : 'none';
  };
  secSel.onchange = sync; sync();
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const title = document.getElementById('m-title').value.trim();
    if (!title) return;
    const section = secSel.value;
    const isAmpel = section === 'ampel';
    const patch = {
      title, section,
      owner: isAmpel ? 'gemeinsam' : ownSel.value,
      groesse: Number(document.getElementById('m-size').value),
      zu_zweit: !isAmpel && ownSel.value === 'haus' && document.getElementById('m-zz').checked,
      gate: isAmpel ? (document.getElementById('m-gate').value.trim() || null) : null,
      gate_slot: isAmpel ? document.getElementById('m-slot').value : null,
    };
    if (isNew) await store.addRoutine(patch); else await store.updateRoutine(item.id, patch);
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => {
    await store.deleteRoutine(item.id); closeModal(); render();
  };
}

function ruleModal(rule) {
  const isNew = !rule;
  openModal(`
    <h3>${isNew ? 'Neue Regel' : 'Regel bearbeiten'}</h3>
    <label>Regel</label>
    <textarea id="m-text">${rule ? esc(rule.text) : ''}</textarea>
    <label>Für wen?</label>
    <select id="m-owner">${ownerOptions(rule ? rule.owner : 'haus', ['haus', 'dennis', 'laura'])}</select>
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const text = document.getElementById('m-text').value.trim();
    if (!text) return;
    const owner = document.getElementById('m-owner').value;
    if (isNew) await store.addRule(text, owner); else await store.updateRule(rule.id, { text, owner });
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => {
    await store.deleteRule(rule.id); closeModal(); render();
  };
}

function projektzeitModal() {
  openModal(`
    <h3>Projektzeit</h3>
    <label>Dein Text</label>
    <textarea id="m-text">${esc(store.state.settings.projektzeit || DEFAULT_PROJEKTZEIT)}</textarea>
    <div class="modal-actions">
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    await store.setSetting('projektzeit', document.getElementById('m-text').value.trim());
    closeModal(); render();
  };
}

/* ---------- Timer (Start / Pause / Weiter / Zurücksetzen) ---------- */
function startTimerTick() {
  timerInterval = setInterval(() => {
    timerSecondsLeft--;
    const el = document.getElementById('timer-display');
    if (el) {
      const m = Math.floor(timerSecondsLeft / 60), s = timerSecondsLeft % 60;
      el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
    if (timerSecondsLeft <= 0) {
      clearInterval(timerInterval); timerInterval = null;
      timerPaused = false; timerSecondsLeft = 15 * 60;
      rainHearts(25);
      render();
    }
  }, 1000);
}
function toggleTimer() {
  if (timerInterval) {
    // läuft → pausieren (Stand bleibt erhalten)
    clearInterval(timerInterval); timerInterval = null; timerPaused = true;
  } else {
    // startet neu oder läuft weiter
    timerPaused = false;
    startTimerTick();
  }
  render();
}
function resetTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerPaused = false; timerSecondsLeft = 15 * 60;
  render();
}

/* ---------- Render & Events ---------- */
function render() {
  const view = document.getElementById('view');
  if (currentTab === 'heute') view.innerHTML = renderHeute();
  else if (currentTab === 'woche') view.innerHTML = renderWoche();
  else if (currentTab === 'todos') view.innerHTML = renderTodos();
  else if (currentTab === 'budget') view.innerHTML = renderBudget();
  else if (currentTab === 'verlauf') view.innerHTML = renderVerlauf();
  else if (currentTab === 'regeln') view.innerHTML = renderRegeln();
  else view.innerHTML = renderEinstellungen();

  const now = new Date();
  document.getElementById('top-sub').textContent =
    currentTab === 'woche' ? 'Wochenplan Haushalt' :
    currentTab === 'todos' ? 'Einmal erledigen, für immer abgehakt' :
    currentTab === 'budget' ? 'Unser Geld im Blick' :
    currentTab === 'verlauf' ? 'Unser Weg, sichtbar gemacht' :
    currentTab === 'regeln' ? 'Hausregeln & persönliche Regeln' :
    currentTab === 'einstellungen' ? 'Alles nach eurem Geschmack' :
    'Unser Tag · ' + now.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });

  // Events
  view.querySelectorAll('.check-item[data-key]').forEach(el => {
    const go = () => toggleCheck(el.dataset.day, el.dataset.key, el.dataset.owner, !!el.dataset.zz);
    el.onclick = ev => { if (ev.target.closest('[data-book]')) return; go(); };
    el.onkeydown = e => {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    };
  });
  view.querySelectorAll('[data-book]').forEach(b => b.onclick = ev => { ev.stopPropagation(); bookingAction(b.dataset.book, b.dataset.act); });
  view.querySelectorAll('[data-ampel]').forEach(b => b.onclick = () => toggleCheck(todayISO(), 'routine:' + b.dataset.ampel, 'gemeinsam'));
  const stand = document.getElementById('stand-card');
  if (stand) stand.onclick = () => switchTab('verlauf');
  const gotoTodos = document.getElementById('goto-todos');
  if (gotoTodos) gotoTodos.onclick = ev => { ev.preventDefault(); switchTab('todos'); };
  const saveGoals = document.getElementById('save-goals');
  if (saveGoals) saveGoals.onclick = async () => {
    const g = goals();
    view.querySelectorAll('[data-goal]').forEach(inp => {
      const [art, m] = inp.dataset.goal.split('.');
      const v = Math.round(Number(inp.value));
      if (v >= 10 && v <= 100) g[art][m] = v;
    });
    await store.setSetting('ziele', g);
    render(); showToast('Ziele gespeichert ♡');
  };
  view.querySelectorAll('[data-bfilter]').forEach(b => b.onclick = () => { budgetFilter = b.dataset.bfilter; render(); });
  view.querySelectorAll('[data-bview]').forEach(b => b.onclick = () => { budgetView = b.dataset.bview; render(); });
  const addAcc = document.getElementById('add-account');
  if (addAcc) addAcc.onclick = () => accountModal(null);
  view.querySelectorAll('[data-add-balance]').forEach(b => b.onclick = () => balanceModal(b.dataset.addBalance || null));
  view.querySelectorAll('[data-account]').forEach(el => el.onclick = () => accountDetailModal(store.state.accounts.find(a => a.id === el.dataset.account)));
  const addReward = document.getElementById('add-reward');
  if (addReward) addReward.onclick = () => rewardModal(null);
  view.querySelectorAll('[data-edit-reward]').forEach(b => b.onclick = () => rewardModal(store.state.rewards.find(r => r.id === b.dataset.editReward)));
  view.querySelectorAll('[data-redeem]').forEach(b => b.onclick = () => requestRedemption(store.state.rewards.find(r => r.id === b.dataset.redeem)));
  view.querySelectorAll('[data-redeem-confirm]').forEach(b => b.onclick = () => confirmRedemption(store.state.redemptions.find(r => r.id === b.dataset.redeemConfirm)));
  view.querySelectorAll('[data-redeem-cancel]').forEach(b => b.onclick = async () => { await store.deleteRedemption(b.dataset.redeemCancel); render(); });
  fillPushStatus();
  view.querySelectorAll('[data-be]').forEach(b => b.onclick = () => {
    me = b.dataset.be;
    try { localStorage.setItem('wilma-me', me); } catch (e) {}
    render();
  });
  const logout = document.getElementById('logout');
  if (logout) logout.onclick = async () => {
    if (!confirm('Auf diesem Gerät abmelden?')) return;
    await store.sb.auth.signOut();
    location.reload();
  };
  const timerBtn = document.getElementById('timer-btn');
  if (timerBtn) timerBtn.onclick = toggleTimer;
  const timerReset = document.getElementById('timer-reset');
  if (timerReset) timerReset.onclick = resetTimer;

  view.querySelectorAll('[data-add-task]').forEach(b => b.onclick = () => taskModal(null, Number(b.dataset.addTask)));
  view.querySelectorAll('[data-edit-task]').forEach(b => b.onclick = () => {
    taskModal(store.state.tasks.find(t => t.id === b.dataset.editTask));
  });
  view.querySelectorAll('[data-add-routine]').forEach(b => b.onclick = () => routineModal(null, b.dataset.addRoutine));
  view.querySelectorAll('[data-edit-routine]').forEach(b => b.onclick = () => {
    routineModal(store.state.routines.find(r => r.id === b.dataset.editRoutine));
  });
  const addRule = document.getElementById('add-rule');
  if (addRule) addRule.onclick = () => ruleModal(null);
  view.querySelectorAll('[data-edit-rule]').forEach(b => b.onclick = () => {
    ruleModal(store.state.rules.find(r => r.id === b.dataset.editRule));
  });
  const pz = document.getElementById('edit-projektzeit');
  if (pz) pz.onclick = projektzeitModal;

  // To-do-Events
  view.querySelectorAll('.check-item[data-todo]').forEach(el => {
    el.onclick = (ev) => {
      if (ev.target.closest('[data-edit-todo]')) return;
      toggleTodo(el.dataset.todo);
    };
  });
  view.querySelectorAll('[data-edit-todo]').forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    todoModal(store.state.todos.find(t => t.id === b.dataset.editTodo));
  });
  const addTodo = document.getElementById('add-todo');
  if (addTodo) addTodo.onclick = () => todoModal(null);

  // Verlauf-Events
  view.querySelectorAll('.seg[data-mode]').forEach(b => b.onclick = () => {
    verlaufMode = b.dataset.mode; render();
  });

  // Budget-Events
  const bmPrev = document.getElementById('bm-prev');
  if (bmPrev) bmPrev.onclick = () => { budgetMonth = shiftMonth(budgetMonth, -1); render(); };
  const bmNext = document.getElementById('bm-next');
  if (bmNext) bmNext.onclick = () => { budgetMonth = shiftMonth(budgetMonth, 1); render(); };
  const addExp = document.getElementById('add-expense');
  if (addExp) addExp.onclick = () => expenseModal();
  const addCat = document.getElementById('add-cat');
  if (addCat) addCat.onclick = () => budgetCatModal(null);
  view.querySelectorAll('[data-edit-cat]').forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    budgetCatModal(store.state.budgetCats.find(c => c.id === b.dataset.editCat));
  });
  view.querySelectorAll('.budget-cat[data-cat]').forEach(el => el.onclick = () => {
    catDetailModal(store.state.budgetCats.find(c => c.id === el.dataset.cat));
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tab').forEach(btn => { btn.onclick = () => switchTab(btn.dataset.tab); });

document.getElementById('modal-wrap').addEventListener('click', e => {
  if (e.target.id === 'modal-wrap') closeModal();
});

/* ---------- Boot ---------- */
async function bootWithStore(s, person) {
  store = s;
  await store.init();
  me = person;
  store.onChange = () => render();
  const { done, total } = todayProgress();
  dayWasComplete = total > 0 && done === total;
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  render();
}

function localPersonOrNull() {
  try { const p = localStorage.getItem('wilma-me'); if (PERSON_KEYS.includes(p)) return p; } catch (e) {}
  return null;
}
function localPerson() { return localPersonOrNull() || 'dennis'; }

// Anmeldung mit E-Mail + Passwort. Danach bleibt das Gerät dauerhaft angemeldet.
function showLogin(sb) {
  document.getElementById('login').classList.remove('hidden');
  const emailEl = document.getElementById('login-email');
  const passEl = document.getElementById('login-pass');
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  btn.onclick = async () => {
    const email = emailEl.value.trim().toLowerCase();
    const password = passEl.value;
    errEl.textContent = '';
    if (!email.includes('@') || !password) { errEl.textContent = 'Bitte E-Mail und Passwort eintragen.'; return; }
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) { errEl.textContent = 'Das hat nicht geklappt – bitte E-Mail und Passwort prüfen.'; return; }
    await enterCloud(sb);
  };
  passEl.onkeydown = e => { if (e.key === 'Enter') btn.click(); };
  emailEl.onkeydown = e => { if (e.key === 'Enter') passEl.focus(); };
}

async function enterCloud(sb) {
  const cs = new CloudStore(sb);
  const who = await cs.whoAmI();
  let person = who.person;
  if (!person && who.offline) {
    // Kein Netz: die zuletzt bekannte Person dieses Geräts weiterverwenden (Daten aus dem Zwischenspeicher)
    person = localPersonOrNull();
    if (!person) { showLogin(sb); document.getElementById('login-error').textContent = 'Gerade kein Netz – bitte später noch einmal.'; return; }
  }
  if (!person) {
    await sb.auth.signOut();
    showLogin(sb);
    document.getElementById('login-error').textContent = 'Diese E-Mail gehört nicht zu Wilma OS.';
    return;
  }
  try { localStorage.setItem('wilma-me', person); } catch (e) {}
  await bootWithStore(cs, person);
}

async function boot() {
  const forceLocal = new URLSearchParams(location.search).has('local');
  const cloudConfigured = typeof SUPABASE_URL === 'string' && SUPABASE_URL && SUPABASE_ANON_KEY;
  if (!cloudConfigured || forceLocal) {
    await bootWithStore(new LocalStore(), localPerson());
    return;
  }
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wilma-auth' } });
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enterCloud(sb);
  else showLogin(sb);
}

// Bei Tageswechsel oder Rückkehr zur App aktualisieren
let lastRenderedDay = todayISO();
setInterval(() => {
  if (todayISO() !== lastRenderedDay) {
    lastRenderedDay = todayISO();
    dayWasComplete = false;
    if (store) render();
  }
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && store) render();
});

/* ---------- Update-Erkennung ---------- */
let updateBannerShown = false;
async function checkForUpdate() {
  try {
    const res = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const j = await res.json();
    if (j.v && j.v !== APP_VERSION && !updateBannerShown) {
      updateBannerShown = true;
      const b = document.createElement('button');
      b.className = 'update-banner';
      b.textContent = '✨ Wilma OS hat ein kleines Update – antippen zum Aktualisieren ♡';
      b.onclick = async () => {
        try {
          if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          if (navigator.serviceWorker) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.update()));
          }
        } catch (e) {}
        location.reload();
      };
      document.body.appendChild(b);
    }
  } catch (e) { /* offline o. ä. — still bleiben */ }
}
setInterval(checkForUpdate, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
checkForUpdate();

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
