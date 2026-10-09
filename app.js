/* ============ Wilma App — App-Logik (früher „Betriebssystem Laura") ============ */

const APP_VERSION = '2.0.0';

let store = null;
let me = null;            // wer dieses Gerät benutzt: 'dennis' | 'laura'
let viewPerson = null;    // wessen Tag gerade angezeigt wird (Umschalter)
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
     haus      → einer reicht
     gemeinsam → beide
     dennis/laura → nur diese Person zählt                                    */
function checkers(day, key) { return (store.state.checks[day] && store.state.checks[day][key]) || {}; }
function hasChecked(day, key, who) { return !!checkers(day, key)[who]; }
function isDoneFor(day, key, owner) {
  const c = checkers(day, key);
  if (owner === 'gemeinsam') return PERSON_KEYS.every(p => c[p]);
  if (owner === 'haus') return Object.keys(c).length > 0;
  return !!c[owner];
}
// Fortschritt einer Person: bei Gemeinsamem zählt ihre eigene Bestätigung
function doneForPerson(day, key, owner, person) {
  if (owner === 'gemeinsam') return hasChecked(day, key, person);
  return isDoneFor(day, key, owner);
}
function canToggle(owner) { return owner === 'haus' || owner === 'gemeinsam' || owner === me; }

function showToast(text) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

async function toggleCheck(day, key, owner) {
  if (!canToggle(owner)) { showToast(`Das hakt ${nameOf(owner)} selbst ab ♡`); return; }
  const c = checkers(day, key);
  if (owner === 'haus' && !c[me] && Object.keys(c).length) {
    showToast(`Hat ${Object.keys(c).map(nameOf).join(' & ')} schon erledigt ♡`); return;
  }
  const wasDone = isDoneFor(day, key, owner);
  const on = !c[me];
  await store.setCheck(day, key, me, on);
  // Zone abgehakt → Timer ist damit erledigt und stoppt
  if (key === 'zone' && on && day === todayISO()) {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    timerPaused = false; timerSecondsLeft = 15 * 60;
  }
  render();
  if (owner === 'gemeinsam' && on && !wasDone && isDoneFor(day, key, owner)) {
    rainHearts(40);
    showToast('Beide bestätigt – grün! ♡');
  } else if (owner === 'gemeinsam' && on) {
    showToast(`Bestätigt – jetzt fehlt noch ${nameOf(partnerOf(me))}.`);
  }
  if (on) maybeCelebrate();
}

/* ---------- Tages-Items ---------- */
function tasksForDate(date, person) {
  const wd = isoWeekday(date);
  return store.state.tasks
    .filter(t => t.active && t.weekday === wd && (!person || t.owner === 'haus' || t.owner === 'gemeinsam' || t.owner === person))
    .sort((a, b) => a.pos - b.pos);
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
// Alle Punkte, die an einem Tag für eine Person zählen: [{ key, owner }]
function dayItems(date, person) {
  const items = [];
  for (const r of store.state.routines.filter(r => r.active && (r.owner === person || r.owner === 'gemeinsam'))) {
    items.push({ key: 'routine:' + r.id, owner: r.owner });
  }
  for (const t of tasksForDate(date, person)) if (isBiweeklyDue(t, date)) items.push({ key: 'task:' + t.id, owner: t.owner });
  items.push({ key: 'zone', owner: person });
  return items;
}
function todayProgress(person = me) {
  const date = new Date();
  const day = todayISO();
  const items = dayItems(date, person);
  const done = items.filter(i => doneForPerson(day, i.key, i.owner, person)).length;
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
function checkItemHTML(day, key, label, note, owner = 'haus') {
  const done = isDoneFor(day, key, owner);
  const partial = owner === 'gemeinsam' && !done && Object.keys(checkers(day, key)).length > 0;
  const readonly = !canToggle(owner);
  const chips = (owner === 'haus' || owner === 'gemeinsam') ? whoChips(day, key) : '';
  return `<div class="check-item ${done ? 'done' : ''} ${partial ? 'partial' : ''} ${readonly ? 'readonly' : ''}" role="button" tabindex="0" aria-pressed="${done}" data-day="${day}" data-key="${esc(key)}" data-owner="${owner}">
    <div class="check-box">✓</div>
    <div class="check-label">${esc(label)}</div>
    ${note ? `<div class="check-note">${esc(note)}</div>` : ''}
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
        <div class="ampel-slot">${r.gate_slot === 'abend' ? 'Abend-Ampel' : 'Morgen-Ampel'}</div>
        <div class="ampel-title">${headline}</div>
        <div class="ampel-status">${status}</div>
        <button class="btn small ${mine ? 'subtle' : 'primary'} ampel-btn" data-ampel="${r.id}">${mine ? 'Meine Bestätigung zurücknehmen' : 'Ich bestätige ✓'}</button>
      </div>
    </div>`;
}

/* ---------- Ansicht: Heute ---------- */
function personToggleHTML() {
  return `
    <div class="seg-toggle">
      ${PERSON_KEYS.slice().sort((a, b) => (a === me ? -1 : b === me ? 1 : 0)).map(p => `
        <button class="seg ${viewPerson === p ? 'active' : ''}" data-person="${p}">${p === me ? 'Mein Tag' : genitiv(p) + ' Tag'}</button>`).join('')}
    </div>`;
}

function renderHeute() {
  const now = new Date();
  const day = todayISO();
  const hour = now.getHours();
  const hello = hour < 11 ? `Guten Morgen, ${nameOf(me)}` : hour < 18 ? `Hallo, ${nameOf(me)}` : `Guten Abend, ${nameOf(me)}`;
  const quote = QUOTES[dayOfYear(now) % QUOTES.length];
  const P = viewPerson;
  const isMe = P === me;
  const { done, total } = todayProgress(P);
  const pct = total ? Math.round(done / total * 100) : 0;
  const complete = total > 0 && done === total;

  // Hausregeln mit Ampel — immer oben, für beide gleich
  const ampeln = ampelRoutines();
  const ampelCard = ampeln.length ? `
    <div class="card ampel-card">
      <h2 class="section-title">Hausregeln</h2>
      ${ampeln.map(r => ampelHTML(day, r)).join('')}
    </div>` : '';

  // weitere gemeinsame Routinen (ohne Ampel)
  const sharedGroups = routinesBySection('gemeinsam');
  delete sharedGroups.ampel;
  const sharedItems = Object.values(sharedGroups).flat();
  const sharedCard = sharedItems.length ? `
    <div class="card">
      <h2 class="section-title">Gemeinsam</h2>
      ${sharedItems.map(r => checkItemHTML(day, 'routine:' + r.id, r.title, '', 'gemeinsam')).join('')}
    </div>` : '';

  // persönliche Routinen der angezeigten Person
  const groups = routinesBySection(P);
  const secKeys = Object.keys(groups).sort((a, b) => (SECTION_META[a]?.order || 9) - (SECTION_META[b]?.order || 9));
  const sections = secKeys.length ? secKeys.map(sec => `
      <div class="card">
        <h2 class="section-title">${esc(SECTION_META[sec]?.label || sec)}</h2>
        ${groups[sec].map(r => checkItemHTML(day, 'routine:' + r.id, r.title, '', P)).join('')}
      </div>`).join('')
    : `<div class="card"><p class="empty-note">${isMe ? 'Du hast noch keine eigenen Routinen – leg dir welche unter „Anpassen" an. ♡' : `${nameOf(P)} hat noch keine eigenen Routinen.`}</p></div>`;

  const todaysTasks = tasksForDate(now, P);
  const dueTasks = todaysTasks.filter(t => isBiweeklyDue(t, now));
  const pausedTasks = todaysTasks.filter(t => !isBiweeklyDue(t, now));
  const taskNote = t => [t.owner !== 'haus' ? nameOf(t.owner) : '', t.cadence === 'biweekly' ? '2-wöchentlich' : ''].filter(Boolean).join(' · ');
  const tasksHTML = `
    <div class="card">
      <h2 class="section-title">Haushalt heute</h2>
      ${dueTasks.length
        ? dueTasks.map(t => checkItemHTML(day, 'task:' + t.id, t.title, taskNote(t), t.owner)).join('')
        : '<p class="empty-note">Heute steht kein Haushalt an – wie schön! ♡</p>'}
      ${pausedTasks.map(t => `<div class="check-item skip-week"><div class="check-box"></div>
        <div class="check-label">${esc(t.title)}</div><div class="check-note">erst nächste Woche</div></div>`).join('')}
    </div>`;

  const mins = Math.floor(timerSecondsLeft / 60), secs = timerSecondsLeft % 60;
  const timerRunning = timerInterval !== null;
  const timerStarted = timerRunning || timerPaused;
  const mainLabel = timerRunning ? 'Pause' : (timerPaused ? 'Weiter ♡' : 'Timer starten');
  const zoneDone = hasChecked(day, 'zone', P);
  const timerBlock = !isMe ? ''
    : zoneDone
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
      <div style="margin-top:10px">${checkItemHTML(day, 'zone', '15-Minuten-Zone geschafft', '', P)}</div>
    </div>`;

  const banner = complete ? `
    <div class="card celebrate-banner">
      <span class="script big">${isMe ? CELEBRATE_MESSAGES[dayOfYear(now) % CELEBRATE_MESSAGES.length] : `${nameOf(P)} hat alles geschafft!`}</span>
      <p class="celebrate-sub">${isMe ? 'Alle Häkchen gesetzt – der Rest des Tages gehört dir. ♡' : 'Vielleicht ein kleines Danke wert? ♡'}</p>
    </div>` : '';

  return `
    <div class="greeting">
      <div class="hello">${hello} ♡</div>
      <div class="date">${formatDateLong(now)}</div>
    </div>
    <div class="card quote-card"><span class="q-heart">♡</span>${esc(quote)}</div>
    ${ampelCard}
    ${sharedCard}
    ${personToggleHTML()}
    <div class="card progress-card">
      <div class="progress-who">${isMe ? 'Du' : esc(nameOf(P))}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-label">${complete ? '<span class="progress-done">Geschafft!</span>' : `${done} von ${total}`}</div>
    </div>
    ${banner}
    ${sections}
    ${tasksHTML}
    ${zoneHTML}`;
}

/* ---------- Ansicht: To-dos ---------- */
function ownerBadge(owner) {
  return `<span class="owner-badge owner-${owner}">${esc(OWNER_META[owner]?.label || owner)}</span>`;
}
function renderTodos() {
  const day = todayISO();
  const order = ['haus', me, partnerOf(me)];
  const open = store.state.todos.filter(t => !t.done_at)
    .sort((a, b) => order.indexOf(a.owner) - order.indexOf(b.owner) || a.pos - b.pos);
  const doneToday = store.state.todos
    .filter(t => t.done_at && t.done_at.slice(0, 10) === day)
    .sort((a, b) => b.done_at.localeCompare(a.done_at));

  const groupTitle = o => o === 'haus' ? 'Fürs Haus' : o === me ? 'Meine' : genitiv(o);
  const groupsHTML = order.map(o => {
    const list = open.filter(t => t.owner === o);
    if (!list.length) return '';
    return `<div class="hist-group-title">${esc(groupTitle(o))} <span class="badge">${list.length}</span></div>` +
      list.map(t => `
        <div class="check-item ${canToggle(t.owner) ? '' : 'readonly'}" data-todo="${t.id}">
          <div class="check-box">✓</div>
          <div class="check-label">${esc(t.title)}</div>
          <button class="btn small subtle todo-edit" data-edit-todo="${t.id}">✎</button>
        </div>`).join('');
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
      ${doneToday.map(t => `
        <div class="check-item done ${canToggle(t.owner) ? '' : 'readonly'}" data-todo="${t.id}">
          <div class="check-box">✓</div>
          <div class="check-label">${esc(t.title)}</div>
          ${t.done_by ? `<div class="who-wrap"><span class="who who-${t.done_by}">${PEOPLE[t.done_by]?.short || ''}</span></div>` : ''}
        </div>`).join('')}
    </div>` : '';

  return openCard + doneCard + `
    <p class="empty-note" style="text-align:center">Alles früher Erledigte findest du im Verlauf ↺</p>`;
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
    const note = t => [t.owner !== 'haus' ? PEOPLE[t.owner]?.name || '' : '', t.cadence === 'biweekly' ? '2-wö.' : ''].filter(Boolean).join(' · ');
    cards.push(`
      <div class="card day-card ${isToday ? 'today' : ''}">
        <div class="day-title">${WEEKDAY_NAMES[i + 1]} · ${date.getDate()}.${date.getMonth() + 1}.</div>
        ${due.map(t => checkItemHTML(dayIso, 'task:' + t.id, t.title, note(t), t.owner)).join('')}
        ${paused.map(t => `<div class="check-item skip-week"><div class="check-box"></div>
          <div class="check-label">${esc(t.title)}</div><div class="check-note">nächste Wo.</div></div>`).join('')}
        <div style="margin-top:6px">${checkItemHTML(dayIso, 'zone', 'Meine 15-Minuten-Zone', '', me)}</div>
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
function ownerOptions(selected, allowed = ['haus', 'gemeinsam', 'dennis', 'laura']) {
  return allowed.map(o => `<option value="${o}" ${selected === o ? 'selected' : ''}>${esc(OWNER_META[o].label)}${o === 'gemeinsam' ? ' (beide bestätigen)' : o === 'haus' ? ' (einer reicht)' : ''}</option>`).join('');
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
          <span class="grow">${esc(t.title)} ${t.owner !== 'haus' ? ownerBadge(t.owner) : ''} ${t.cadence === 'biweekly' ? '<span class="badge">2-wöchentlich</span>' : ''}</span>
          <button class="btn small subtle" data-edit-task="${t.id}">✎</button>
        </div>`).join('') || '<p class="empty-note">Noch keine Aufgaben.</p>'}
      <div style="margin-top:10px"><button class="btn small" data-add-task="${wd}">+ Aufgabe</button></div>
    </div>`).join('');

  const routineBlocks = ['gemeinsam', me, partnerOf(me)].map(owner => {
    const groups = routinesBySection(owner);
    const secs = Object.keys(groups).sort((a, b) => (SECTION_META[a]?.order || 9) - (SECTION_META[b]?.order || 9));
    const title = owner === 'gemeinsam' ? 'Gemeinsam' : owner === me ? 'Meine Routinen' : `${genitiv(owner)} Routinen`;
    return `
      <div class="card">
        <h2 class="section-title">${esc(title)}</h2>
        ${secs.map(sec => `
          <div class="hist-group-title">${esc(SECTION_META[sec]?.label || sec)}</div>
          ${groups[sec].map(r => `
            <div class="settings-row">
              <span class="grow">${esc(r.title)}${r.gate ? ` <span class="settings-sub">– ${esc(r.gate)}</span>` : ''}</span>
              <button class="btn small subtle" data-edit-routine="${r.id}">✎</button>
            </div>`).join('')}`).join('') || '<p class="empty-note">Noch keine Punkte.</p>'}
        <div style="margin-top:10px"><button class="btn small" data-add-routine="${owner}">+ Punkt</button></div>
      </div>`;
  }).join('');

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
      <p class="settings-sub" style="margin-top:8px">Eine Hausregel mit Ampel (beide bestätigen) legst du oben unter „Gemeinsam → + Punkt" an.</p>
    </div>`;

  const sync = store.mode === 'cloud'
    ? `<span class="sync-status ok">● Synchronisiert über die Cloud${store.online === false ? ' (gerade offline, nutzt lokalen Stand)' : ''}</span>`
    : `<span class="sync-status off">● Testmodus – Daten bleiben auf diesem Gerät</span>`;
  const whoBlock = store.mode === 'cloud'
    ? `<p style="margin-bottom:8px">Angemeldet als <b>${esc(nameOf(me))}</b> <button class="btn small subtle" id="logout">Abmelden</button></p>`
    : `<p style="margin-bottom:8px">Testmodus – ich bin: ${PERSON_KEYS.map(p => `<button class="btn small ${p === me ? 'primary' : 'subtle'}" data-be="${p}">${nameOf(p)}</button>`).join(' ')}</p>`;
  const infoBlock = `
    <div class="card">
      <h2 class="section-title">App</h2>
      ${whoBlock}
      <p style="margin-bottom:8px">${sync}</p>
      <p class="settings-sub" style="margin-bottom:8px">Wilma · Version ${APP_VERSION} · Die App sucht selbst nach Updates und sagt Bescheid. ♡</p>
      <p class="settings-sub">Tipp: In Safari über „Teilen → Zum Home-Bildschirm" installieren, dann fühlt sich Wilma wie eine echte App an. ♡</p>
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

/* ---------- To-dos ---------- */
async function toggleTodo(id) {
  const t = store.state.todos.find(t => t.id === id);
  if (!t) return;
  if (!canToggle(t.owner)) { showToast(`Das hakt ${nameOf(t.owner)} selbst ab ♡`); return; }
  await store.updateTodo(id, t.done_at ? { done_at: null, done_by: null } : { done_at: new Date().toISOString(), done_by: me });
  render();
}

function todoModal(todo) {
  const isNew = !todo;
  openModal(`
    <h3>${isNew ? 'Neues To-do' : 'To-do bearbeiten'}</h3>
    <label>Was steht an?</label>
    <input type="text" id="m-title" value="${todo ? esc(todo.title) : ''}" placeholder="z. B. Glühbirne Flur tauschen">
    <label>Für wen?</label>
    <select id="m-owner">${ownerOptions(todo ? todo.owner : me, ['haus', 'dennis', 'laura'])}</select>
    <div class="modal-actions">
      ${isNew ? '' : '<button class="btn small danger" id="m-delete">Löschen</button>'}
      <button class="btn small subtle" id="m-cancel">Abbrechen</button>
      <button class="btn small primary" id="m-save">Speichern ♡</button>
    </div>`);
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-save').onclick = async () => {
    const title = document.getElementById('m-title').value.trim();
    if (!title) return;
    const owner = document.getElementById('m-owner').value;
    if (isNew) await store.addTodo(title, owner); else await store.updateTodo(todo.id, { title, owner });
    closeModal(); render();
  };
  if (!isNew) document.getElementById('m-delete').onclick = async () => {
    await store.deleteTodo(todo.id); closeModal(); render();
  };
}

/* ---------- Verlauf (Historie & Trends) ---------- */
let verlaufMode = 'woche';

function isoWeekNum(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function verlaufPeriods(mode, n) {
  const periods = [];
  const today = new Date();
  if (mode === 'woche') {
    const thisMon = mondayOf(today);
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7 * i);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      periods.push({ start, end, label: 'KW ' + isoWeekNum(start) });
    }
  } else {
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      periods.push({ start, end, label: start.toLocaleDateString('de-DE', { month: 'short' }) });
    }
  }
  return periods;
}

// erster Tag, an dem diese Person (oder für Haus-Aufgaben irgendwer) etwas abgehakt hat
function firstCheckDay(person) {
  const days = Object.keys(store.state.checks).filter(d =>
    Object.values(store.state.checks[d]).some(c => c[person]));
  return days.length ? days.sort()[0] : null;
}

// Anteil erledigter Punkte einer Person in einem Zeitraum (nur Tage seit ihrem ersten Häkchen, nicht in der Zukunft)
function periodStats(start, end, person) {
  const first = firstCheckDay(person);
  if (!first) return { pct: null, done: 0, expected: 0 };
  const today = todayISO();
  let done = 0, expected = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = toISO(d);
    if (iso < first || iso > today) continue;
    for (const it of dayItems(d, person)) {
      expected++;
      if (doneForPerson(iso, it.key, it.owner, person)) done++;
    }
  }
  return { pct: expected ? Math.round(done / expected * 100) : null, done, expected };
}

// Erledigt-Zähler je Punkt in einem Zeitraum (+ mögliche Tage)
function itemPeriodCounts(start, end, person) {
  const today = todayISO();
  const counts = {};
  let daysCounted = 0;
  const taskPossible = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = toISO(d);
    if (iso > today) continue;
    daysCounted++;
    for (const t of tasksForDate(d, person)) {
      if (isBiweeklyDue(t, d)) taskPossible[t.id] = (taskPossible[t.id] || 0) + 1;
    }
    for (const it of dayItems(d, person)) {
      if (doneForPerson(iso, it.key, it.owner, person)) counts[it.key] = (counts[it.key] || 0) + 1;
    }
  }
  return { counts, days: daysCounted, taskPossible };
}

function trendArrow(cur, prev) {
  if (cur > prev) return '<span class="trend up">▲</span>';
  if (cur < prev) return '<span class="trend down">▼</span>';
  return '<span class="trend flat">●</span>';
}

function renderVerlauf() {
  const isWeek = verlaufMode === 'woche';
  const n = isWeek ? 8 : 6;
  const periods = verlaufPeriods(verlaufMode, n);
  const P = viewPerson;
  const first = firstCheckDay(P);

  const toggle = `
    <div class="seg-toggle">
      <button class="seg ${isWeek ? 'active' : ''}" data-mode="woche">Wochen</button>
      <button class="seg ${isWeek ? '' : 'active'}" data-mode="monat">Monate</button>
    </div>` + personToggleHTML();

  if (!first) {
    return toggle + `<div class="card" style="text-align:center">
      <p class="empty-note">${P === me ? 'Sobald du die ersten Häkchen setzt, wächst hier dein Verlauf. ♡' : `Sobald ${nameOf(P)} die ersten Häkchen setzt, wächst hier der Verlauf. ♡`}</p></div>`;
  }

  // Balken-Chart
  const stats = periods.map(p => ({ ...p, ...periodStats(p.start, p.end, P) }));
  const visible = stats.filter(s => s.pct !== null);
  const bars = visible.map((s, i) => `
    <div class="vbar-wrap ${i === visible.length - 1 ? 'current' : ''}">
      <div class="vbar-pct">${s.pct}%</div>
      <div class="vbar-track"><div class="vbar" style="height:${Math.max(3, s.pct)}%"></div></div>
      <div class="vbar-label">${esc(s.label)}</div>
    </div>`).join('');

  let trendText = '';
  if (visible.length >= 2) {
    const cur = visible[visible.length - 1], prev = visible[visible.length - 2];
    const diff = cur.pct - prev.pct;
    const word = isWeek ? ['Diese Woche', 'Vorwoche'] : ['Dieser Monat', 'Vormonat'];
    trendText = `<p class="trend-line">${word[0]}: <b>${cur.pct} %</b> · ${word[1]}: ${prev.pct} %
      ${diff > 0 ? `<span class="trend up">▲ +${diff}</span> – schöne Entwicklung!`
        : diff < 0 ? `<span class="trend down">▼ ${diff}</span> – alles okay, jeder Tag zählt neu. ♡`
        : '<span class="trend flat">●</span> – schön stabil.'}</p>`;
  }

  const chartCard = `
    <div class="card">
      <h2 class="section-title">${P === me ? 'Mein Regelmäßiges' : esc(genitiv(P)) + ' Regelmäßiges'}</h2>
      <div class="vchart">${bars}</div>
      ${trendText}
    </div>`;

  // Einzelauswertung: aktueller vs. vorheriger Zeitraum
  const curP = periods[periods.length - 1];
  const prevP = periods[periods.length - 2];
  const curC = itemPeriodCounts(curP.start, curP.end, P);
  const prevC = prevP ? itemPeriodCounts(prevP.start, prevP.end, P) : { counts: {}, days: 0, taskPossible: {} };

  const rows = [];
  for (const owner of ['gemeinsam', P]) {
    const groups = routinesBySection(owner);
    for (const sec of Object.keys(SECTION_META).sort((a, b) => SECTION_META[a].order - SECTION_META[b].order)) {
      for (const r of (groups[sec] || [])) {
        const key = 'routine:' + r.id;
        rows.push({ label: r.title + (owner === 'gemeinsam' ? ' (gemeinsam)' : ''), cur: curC.counts[key] || 0, possible: curC.days, prev: prevC.counts[key] || 0 });
      }
    }
  }
  for (const t of store.state.tasks.filter(t => t.active && (t.owner === 'haus' || t.owner === 'gemeinsam' || t.owner === P)).sort((a, b) => a.weekday - b.weekday || a.pos - b.pos)) {
    const key = 'task:' + t.id;
    rows.push({ label: t.title, cur: curC.counts[key] || 0, possible: curC.taskPossible[t.id] || 0, prev: prevC.counts[key] || 0 });
  }
  rows.push({ label: '15-Minuten-Zone ♡', cur: curC.counts['zone'] || 0, possible: curC.days, prev: prevC.counts['zone'] || 0 });

  const itemsCard = `
    <div class="card">
      <h2 class="section-title">${isWeek ? 'Diese Woche' : 'Dieser Monat'} im Detail</h2>
      ${rows.map(r => `
        <div class="hist-row">
          <span class="grow">${esc(r.label)}</span>
          <span class="hist-count">${r.cur}${r.possible ? ' / ' + r.possible : ''}</span>
          ${trendArrow(r.cur, r.prev)}
        </div>`).join('')}
      <p class="settings-sub" style="margin-top:8px">Pfeile vergleichen mit ${isWeek ? 'der Vorwoche' : 'dem Vormonat'}.</p>
    </div>`;

  // Erledigte To-dos, gruppiert nach Zeitraum
  const doneTodos = store.state.todos
    .filter(t => t.done_at && (t.owner === P || t.done_by === P || (t.owner === 'haus' && !t.done_by)))
    .sort((a, b) => b.done_at.localeCompare(a.done_at));
  const groupsMap = new Map();
  for (const t of doneTodos) {
    const d = parseISO(t.done_at.slice(0, 10));
    const key = isWeek
      ? d.getFullYear() + '-KW' + String(isoWeekNum(d)).padStart(2, '0')
      : t.done_at.slice(0, 7);
    const label = isWeek
      ? 'KW ' + isoWeekNum(d)
      : d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    if (!groupsMap.has(key)) groupsMap.set(key, { label, items: [] });
    groupsMap.get(key).items.push(t);
  }
  const todoGroups = [...groupsMap.values()].slice(0, n);
  const todosCard = `
    <div class="card">
      <h2 class="section-title">Erledigte To-dos</h2>
      ${todoGroups.length ? todoGroups.map(g => `
        <div class="hist-group">
          <div class="hist-group-title">${esc(g.label)} <span class="badge">${g.items.length}</span></div>
          ${g.items.map(t => `
            <div class="hist-row">
              <span class="exp-day">${t.done_at.slice(8, 10)}.${t.done_at.slice(5, 7)}.</span>
              <span class="grow done-title">${esc(t.title)}</span>
            </div>`).join('')}
        </div>`).join('') : '<p class="empty-note">Noch keine erledigten To-dos – die Liste füllt sich von selbst. ♡</p>'}
    </div>`;

  return toggle + chartCard + itemsCard + todosCard;
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
    const patch = { title, owner: document.getElementById('m-owner').value, weekday: Number(document.getElementById('m-weekday').value), cadence, anchor };
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
  const curSec = item ? item.section : (curOwner === 'gemeinsam' ? 'ampel' : 'alltag');
  openModal(`
    <h3>${isNew ? 'Neuer Routine-Punkt' : 'Routine bearbeiten'}</h3>
    <label>Bezeichnung</label>
    <input type="text" id="m-title" value="${item ? esc(item.title) : ''}" placeholder="z. B. Spülmaschine ausräumen">
    <label>Wer?</label>
    <select id="m-owner">${ownerOptions(curOwner, ['gemeinsam', 'dennis', 'laura'])}</select>
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
    el.onclick = () => toggleCheck(el.dataset.day, el.dataset.key, el.dataset.owner);
    el.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCheck(el.dataset.day, el.dataset.key, el.dataset.owner); }
    };
  });
  view.querySelectorAll('[data-ampel]').forEach(b => b.onclick = () => toggleCheck(todayISO(), 'routine:' + b.dataset.ampel, 'gemeinsam'));
  view.querySelectorAll('.seg[data-person]').forEach(b => b.onclick = () => { viewPerson = b.dataset.person; render(); });
  view.querySelectorAll('[data-be]').forEach(b => b.onclick = () => {
    me = viewPerson = b.dataset.be;
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
async function bootWithStore(s, person) {
  store = s;
  await store.init();
  me = person;
  viewPerson = me;
  store.onChange = () => render();
  const { done, total } = todayProgress();
  dayWasComplete = total > 0 && done === total;
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  render();
}

function localPerson() {
  try { const p = localStorage.getItem('wilma-me'); if (PERSON_KEYS.includes(p)) return p; } catch (e) {}
  return 'dennis';
}

// Anmeldung ohne Passwort: E-Mail → 6-stelliger Code aus der Mail → angemeldet (bleibt dauerhaft)
function showLogin(sb) {
  const login = document.getElementById('login');
  login.classList.remove('hidden');
  const emailEl = document.getElementById('login-email');
  const codeRow = document.getElementById('login-code-row');
  const codeEl = document.getElementById('login-code');
  const errEl = document.getElementById('login-error');
  const infoEl = document.getElementById('login-info');
  const sendBtn = document.getElementById('login-send');
  const verifyBtn = document.getElementById('login-verify');

  sendBtn.onclick = async () => {
    const email = emailEl.value.trim().toLowerCase();
    errEl.textContent = ''; infoEl.textContent = '';
    if (!email.includes('@')) { errEl.textContent = 'Bitte deine E-Mail-Adresse eintragen.'; return; }
    sendBtn.disabled = true;
    // shouldCreateUser: Dennis' Konto entsteht beim ersten Code. Zugriff auf Daten haben trotzdem nur die zwei E-Mails in `members`.
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    sendBtn.disabled = false;
    if (error) { errEl.textContent = 'Das hat nicht geklappt – ist das die richtige Adresse? (' + error.message + ')'; return; }
    infoEl.textContent = 'Schau in dein Postfach: Dort ist ein Code mit 6 Ziffern. ♡';
    codeRow.classList.remove('hidden');
    codeEl.focus();
  };
  verifyBtn.onclick = async () => {
    const email = emailEl.value.trim().toLowerCase();
    const token = codeEl.value.replace(/\D/g, '');
    errEl.textContent = '';
    if (token.length < 6) { errEl.textContent = 'Der Code hat 6 Ziffern.'; return; }
    verifyBtn.disabled = true;
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    verifyBtn.disabled = false;
    if (error) { errEl.textContent = 'Der Code passt nicht oder ist abgelaufen – fordere einfach einen neuen an.'; return; }
    await enterCloud(sb);
  };
  codeEl.onkeydown = e => { if (e.key === 'Enter') verifyBtn.click(); };
  emailEl.onkeydown = e => { if (e.key === 'Enter') sendBtn.click(); };
}

async function enterCloud(sb) {
  const cs = new CloudStore(sb);
  const person = await cs.whoAmI();
  if (!person) {
    await sb.auth.signOut();
    document.getElementById('login').classList.remove('hidden');
    document.getElementById('login-error').textContent = 'Diese E-Mail gehört nicht zu Wilma.';
    return;
  }
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
      b.textContent = '✨ Wilma hat ein kleines Update – antippen zum Aktualisieren ♡';
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
