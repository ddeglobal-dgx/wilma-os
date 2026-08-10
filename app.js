/* ============ Betriebssystem Laura — App-Logik ============ */

const APP_VERSION = '1.3.0';

let store = null;
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

/* ---------- Checks ---------- */
function isChecked(day, key) { return !!(store.state.checks[day] && store.state.checks[day][key]); }
async function toggleCheck(day, key) {
  const on = !isChecked(day, key);
  await store.setCheck(day, key, on);
  // Zone abgehakt → Timer ist damit erledigt und stoppt
  if (key === 'zone' && on && day === todayISO()) {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    timerPaused = false; timerSecondsLeft = 15 * 60;
  }
  render();
  if (on) maybeCelebrate();
}

/* ---------- Tages-Items ---------- */
function tasksForDate(date) {
  const wd = isoWeekday(date);
  return store.state.tasks
    .filter(t => t.active && t.weekday === wd)
    .sort((a, b) => a.pos - b.pos);
}
function routinesBySection() {
  const groups = {};
  for (const r of store.state.routines.filter(r => r.active).sort((a, b) => a.pos - b.pos)) {
    (groups[r.section] = groups[r.section] || []).push(r);
  }
  return groups;
}
function todayProgress() {
  const date = new Date();
  const day = todayISO();
  const keys = [];
  for (const r of store.state.routines.filter(r => r.active)) keys.push('routine:' + r.id);
  for (const t of tasksForDate(date)) if (isBiweeklyDue(t, date)) keys.push('task:' + t.id);
  keys.push('zone');
  const done = keys.filter(k => isChecked(day, k)).length;
  return { done, total: keys.length };
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
function checkItemHTML(day, key, label, note) {
  const done = isChecked(day, key);
  return `<div class="check-item ${done ? 'done' : ''}" role="button" tabindex="0" aria-pressed="${done}" data-day="${day}" data-key="${esc(key)}">
    <div class="check-box">✓</div>
    <div class="check-label">${esc(label)}</div>
    ${note ? `<div class="check-note">${esc(note)}</div>` : ''}
  </div>`;
}

/* ---------- Ansicht: Heute ---------- */
function renderHeute() {
  const now = new Date();
  const day = todayISO();
  const hour = now.getHours();
  const hello = hour < 11 ? 'Guten Morgen, Laura' : hour < 18 ? 'Hallo, Laura' : 'Guten Abend, Laura';
  const quote = QUOTES[dayOfYear(now) % QUOTES.length];
  const { done, total } = todayProgress();
  const pct = total ? Math.round(done / total * 100) : 0;
  const complete = total > 0 && done === total;

  const groups = routinesBySection();
  const sections = Object.keys(groups)
    .sort((a, b) => (SECTION_META[a]?.order || 9) - (SECTION_META[b]?.order || 9))
    .map(sec => `
      <div class="card">
        <h2 class="section-title">${esc(SECTION_META[sec]?.label || sec)}</h2>
        ${groups[sec].map(r => checkItemHTML(day, 'routine:' + r.id, r.title)).join('')}
      </div>`).join('');

  const todaysTasks = tasksForDate(now);
  const dueTasks = todaysTasks.filter(t => isBiweeklyDue(t, now));
  const pausedTasks = todaysTasks.filter(t => !isBiweeklyDue(t, now));
  const tasksHTML = `
    <div class="card">
      <h2 class="section-title">Haushalt heute</h2>
      ${dueTasks.length
        ? dueTasks.map(t => checkItemHTML(day, 'task:' + t.id, t.title, t.cadence === 'biweekly' ? '2-wöchentlich' : '')).join('')
        : '<p class="empty-note">Heute steht kein Haushalt an – wie schön! ♡</p>'}
      ${pausedTasks.map(t => `<div class="check-item skip-week"><div class="check-box"></div>
        <div class="check-label">${esc(t.title)}</div><div class="check-note">erst nächste Woche</div></div>`).join('')}
    </div>`;

  const mins = Math.floor(timerSecondsLeft / 60), secs = timerSecondsLeft % 60;
  const timerRunning = timerInterval !== null;
  const timerStarted = timerRunning || timerPaused;
  const mainLabel = timerRunning ? 'Pause' : (timerPaused ? 'Weiter ♡' : 'Timer starten');
  const zoneDone = isChecked(day, 'zone');
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
      <div style="margin-top:10px">${checkItemHTML(day, 'zone', '15-Minuten-Zone geschafft')}</div>
    </div>`;

  const banner = complete ? `
    <div class="card celebrate-banner">
      <span class="script big">${CELEBRATE_MESSAGES[dayOfYear(now) % CELEBRATE_MESSAGES.length]}</span>
      <p class="celebrate-sub">Alle Häkchen gesetzt – der Rest des Tages gehört dir. ♡</p>
    </div>` : '';

  return `
    <div class="greeting">
      <div class="hello">${hello} ♡</div>
      <div class="date">${formatDateLong(now)}</div>
    </div>
    <div class="card quote-card"><span class="q-heart">♡</span>${esc(quote)}</div>
    <div class="card progress-card">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-label">${complete ? '<span class="progress-done">Geschafft!</span>' : `${done} von ${total}`}</div>
    </div>
    ${banner}
    ${sections}
    ${tasksHTML}
    ${zoneHTML}`;
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
    cards.push(`
      <div class="card day-card ${isToday ? 'today' : ''}">
        <div class="day-title">${WEEKDAY_NAMES[i + 1]} · ${date.getDate()}.${date.getMonth() + 1}.</div>
        ${due.map(t => checkItemHTML(dayIso, 'task:' + t.id, t.title, t.cadence === 'biweekly' ? '2-wö.' : '')).join('')}
        ${paused.map(t => `<div class="check-item skip-week"><div class="check-box"></div>
          <div class="check-label">${esc(t.title)}</div><div class="check-note">nächste Wo.</div></div>`).join('')}
        <div style="margin-top:6px">${checkItemHTML(dayIso, 'zone', '15-Minuten-Zone')}</div>
      </div>`);
  }
  return `<div class="week-grid">${cards.join('')}</div>`;
}

/* ---------- Ansicht: Regeln ---------- */
function renderRegeln() {
  const rules = store.state.rules.slice().sort((a, b) => a.pos - b.pos);
  return `
    <div class="card">
      <h2 class="section-title">Meine Regeln</h2>
      ${rules.map(r => `<div class="rule-item"><span class="rule-heart">♡</span><span class="grow">${esc(r.text)}</span></div>`).join('')}
    </div>
    <div class="card">
      <h2 class="section-title">Projektzeit</h2>
      <p class="projekt-text">${esc(store.state.settings.projektzeit || DEFAULT_PROJEKTZEIT)}</p>
    </div>
    <p class="empty-note" style="text-align:center">Ändern kannst du beides unter „Anpassen" ✎</p>`;
}

/* ---------- Ansicht: Anpassen ---------- */
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
          <span class="grow">${esc(t.title)} ${t.cadence === 'biweekly' ? '<span class="badge">2-wöchentlich</span>' : ''}</span>
          <button class="btn small subtle" data-edit-task="${t.id}">✎</button>
        </div>`).join('') || '<p class="empty-note">Noch keine Aufgaben.</p>'}
      <div style="margin-top:10px"><button class="btn small" data-add-task="${wd}">+ Aufgabe</button></div>
    </div>`).join('');

  const groups = routinesBySection();
  const routineBlocks = Object.keys(SECTION_META)
    .sort((a, b) => SECTION_META[a].order - SECTION_META[b].order)
    .map(sec => `
      <div class="card">
        <h2 class="section-title">${SECTION_META[sec].label}</h2>
        ${(groups[sec] || []).map(r => `
          <div class="settings-row">
            <span class="grow">${esc(r.title)}</span>
            <button class="btn small subtle" data-edit-routine="${r.id}">✎</button>
          </div>`).join('') || '<p class="empty-note">Noch keine Punkte.</p>'}
        <div style="margin-top:10px"><button class="btn small" data-add-routine="${sec}">+ Punkt</button></div>
      </div>`).join('');

  const rules = store.state.rules.slice().sort((a, b) => a.pos - b.pos);
  const rulesBlock = `
    <div class="card">
      <h2 class="section-title">Meine Regeln</h2>
      ${rules.map(r => `
        <div class="settings-row">
          <span class="grow">${esc(r.text)}</span>
          <button class="btn small subtle" data-edit-rule="${r.id}">✎</button>
        </div>`).join('')}
      <div style="margin-top:10px">
        <button class="btn small" id="add-rule">+ Regel</button>
        <button class="btn small subtle" id="edit-projektzeit">Projektzeit-Text ändern</button>
      </div>
    </div>`;

  const sync = store.mode === 'cloud'
    ? `<span class="sync-status ok">● Synchronisiert über die Cloud${store.online === false ? ' (gerade offline, nutzt lokalen Stand)' : ''}</span>`
    : `<span class="sync-status off">● Lokaler Modus – Daten bleiben auf diesem Gerät</span>`;
  const infoBlock = `
    <div class="card">
      <h2 class="section-title">App</h2>
      <p style="margin-bottom:8px">${sync}</p>
      <p class="settings-sub" style="margin-bottom:8px">Version ${APP_VERSION} · Die App sucht selbst nach Updates und sagt dir Bescheid. ♡</p>
      <p class="settings-sub">Tipp: In Safari über „Teilen → Zum Home-Bildschirm" installieren, dann fühlt sich die App wie eine echte App an. ♡</p>
    </div>`;

  return `<h2 class="section-title" style="margin-bottom:10px">Routinen</h2>${routineBlocks}
    <h2 class="section-title" style="margin:14px 0 10px">Wochenplan</h2>${dayBlocks}
    ${rulesBlock}${infoBlock}`;
}

/* ---------- Budget ---------- */
let budgetMonth = null;
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
  s = String(s).trim().replace(/€/g, '').trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
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

function renderBudget() {
  if (!budgetMonth) budgetMonth = monthKeyOf(new Date());
  ensureMonthBudgets(budgetMonth);
  const cats = store.state.budgetCats.filter(c => c.active).sort((a, b) => a.pos - b.pos);
  const budgets = store.state.budgets[budgetMonth] || {};
  const monthExpenses = monthExpensesFor(budgetMonth);
  const spent = {};
  for (const e of monthExpenses) spent[e.cat_id] = (spent[e.cat_id] || 0) + e.amount;
  const totalBudget = cats.reduce((s, c) => s + (budgets[c.id] || 0), 0);
  const totalSpent = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const totalLeft = totalBudget - totalSpent;

  const nav = `
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
          <div class="cat-name">${esc(c.name)} <span class="badge">${n} ${n === 1 ? 'Eintrag' : 'Einträge'}</span></div>
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

  return nav + summary + catCards + empty + actions;
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
    const cents = parseEuro(document.getElementById('m-budget').value) || 0;
    let id;
    if (isNew) {
      const row = await store.addBudgetCat({ name, emoji });
      id = row.id;
    } else {
      await store.updateBudgetCat(cat.id, { name, emoji });
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
  const cats = store.state.budgetCats.filter(c => c.active).sort((a, b) => a.pos - b.pos);
  if (!cats.length) return;
  openModal(`
    <h3>Neue Ausgabe</h3>
    <label>Betrag (€)</label>
    <input type="text" id="m-amount" inputmode="decimal" placeholder="z. B. 12,50" autofocus>
    <label>Kategorie</label>
    <select id="m-cat">
      ${cats.map(c => `<option value="${c.id}" ${c.id === prefillCatId ? 'selected' : ''}>${esc(c.emoji || '♡')} ${esc(c.name)}</option>`).join('')}
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
    });
    budgetMonth = day.slice(0, 7);
    closeModal(); render();
  };
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
    const patch = { title, weekday: Number(document.getElementById('m-weekday').value), cadence, anchor };
    if (isNew) await store.addTask(patch); else await store.updateTask(task.id, patch);
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => {
    await store.deleteTask(task.id); closeModal(); render();
  };
}

function routineModal(item, section) {
  const isNew = !item;
  openModal(`
    <h3>${isNew ? 'Neuer Routine-Punkt' : 'Routine bearbeiten'}</h3>
    <label>Bezeichnung</label>
    <input type="text" id="m-title" value="${item ? esc(item.title) : ''}" placeholder="z. B. Dehnen (5 Minuten)">
    <label>Gehört zu</label>
    <select id="m-section">
      ${Object.keys(SECTION_META).map(s => `<option value="${s}" ${(item ? item.section : section) === s ? 'selected' : ''}>${SECTION_META[s].label}</option>`).join('')}
    </select>
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const title = document.getElementById('m-title').value.trim();
    if (!title) return;
    const patch = { title, section: document.getElementById('m-section').value };
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
    <label>Deine Regel</label>
    <textarea id="m-text">${rule ? esc(rule.text) : ''}</textarea>
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const text = document.getElementById('m-text').value.trim();
    if (!text) return;
    if (isNew) await store.addRule(text); else await store.updateRule(rule.id, text);
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
  else if (currentTab === 'budget') view.innerHTML = renderBudget();
  else if (currentTab === 'regeln') view.innerHTML = renderRegeln();
  else view.innerHTML = renderEinstellungen();

  const now = new Date();
  document.getElementById('top-sub').textContent =
    currentTab === 'woche' ? 'Wochenplan Haushalt' :
    currentTab === 'budget' ? 'Dein Geld im Blick' :
    currentTab === 'regeln' ? 'Meine Regeln & Projektzeit' :
    currentTab === 'einstellungen' ? 'Alles nach deinem Geschmack' :
    'Dein Tag · ' + now.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' });

  // Events
  view.querySelectorAll('.check-item[data-key]').forEach(el => {
    el.onclick = () => toggleCheck(el.dataset.day, el.dataset.key);
    el.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCheck(el.dataset.day, el.dataset.key); }
    };
  });
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

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    render();
    window.scrollTo({ top: 0 });
  };
});

document.getElementById('modal-wrap').addEventListener('click', e => {
  if (e.target.id === 'modal-wrap') closeModal();
});

/* ---------- Boot ---------- */
async function bootWithStore(s) {
  store = s;
  await store.init();
  store.onChange = () => render();
  const { done, total } = todayProgress();
  dayWasComplete = total > 0 && done === total;
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  render();
}

async function boot() {
  const cloudConfigured = typeof SUPABASE_URL === 'string' && SUPABASE_URL && SUPABASE_ANON_KEY;
  if (!cloudConfigured) {
    await bootWithStore(new LocalStore());
    return;
  }
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await bootWithStore(new CloudStore(sb));
  } else {
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('login-btn').onclick = async () => {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-pass').value;
      const errEl = document.getElementById('login-error');
      errEl.textContent = '';
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { errEl.textContent = 'Das hat leider nicht geklappt – bitte prüf E-Mail & Passwort.'; return; }
      await bootWithStore(new CloudStore(sb));
    };
  }
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
      b.textContent = '✨ Ein kleines Update ist da – antippen zum Aktualisieren ♡';
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
