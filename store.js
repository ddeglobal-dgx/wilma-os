/* ============ Wilma OS — Datenhaltung: lokal (localStorage) oder Cloud (Supabase) ============ */

const LS_KEY = 'wilma-state-v1';
const LEGACY_LS_KEY = 'bsl-state-v1';   // Betriebssystem Laura (gleiche Adresse gibt es nicht, nur für lokale Tests)

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function newId() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function buildDefaultState() {
  return {
    tasks: DEFAULT_TASKS.map((t, i) => ({
      id: newId(), title: t.title, weekday: t.weekday, owner: 'haus',
      cadence: t.cadence, anchor: DEFAULT_ANCHOR, pos: i, active: true,
      groesse: t.groesse || 1, zu_zweit: !!t.zu_zweit,
    })),
    routines: DEFAULT_ROUTINES.map((r, i) => ({
      id: newId(), section: r.section, title: r.title, owner: r.owner || 'jeder',
      gate: r.gate || null, gate_slot: r.gate_slot || null, pos: i, active: true,
      groesse: r.groesse || 1, zu_zweit: !!r.zu_zweit,
    })),
    rules: DEFAULT_RULES.map((text, i) => ({ id: newId(), text, owner: 'laura', pos: i })),
    checks: {},   // { '2026-10-09': { 'task:<id>': { laura: true }, 'routine:<id>': { laura: true, dennis: true } } }
    settings: { projektzeit: DEFAULT_PROJEKTZEIT, ziele: DEFAULT_GOALS },
    bookings: [],     // [{ day, item_key, person, slot }]
    budgetCats: [],   // [{ id, name, emoji, pos, active }]
    budgets: {},      // { '2026-08': { <catId>: amountCents } }
    expenses: [],     // [{ id, cat_id, amount (Cent), note, day 'YYYY-MM-DD' }]
    todos: [],        // [{ id, title, pos, created_at, done_at (ISO|null) }]
  };
}

function migrateState(state) {
  if (!state.budgetCats) state.budgetCats = [];
  if (!state.budgets) state.budgets = {};
  if (!state.expenses) state.expenses = [];
  if (!state.todos) state.todos = [];
  if (!state.bookings) state.bookings = [];
  if (!state.settings.ziele) state.settings.ziele = DEFAULT_GOALS;
  for (const x of [...state.tasks, ...state.routines]) { if (!x.groesse) x.groesse = 1; if (x.zu_zweit == null) x.zu_zweit = false; }
  for (const t of state.todos) if (!t.groesse) t.groesse = 3;
  for (const c of state.budgetCats) if (!c.owner) c.owner = 'gemeinsam';
  // Alt-Daten aus „Betriebssystem Laura": alles gehörte Laura, Haushalt wird Haus
  for (const t of state.tasks) if (!t.owner) t.owner = 'haus';
  for (const r of state.routines) if (!r.owner) r.owner = 'laura';
  for (const r of state.rules) if (!r.owner) r.owner = 'laura';
  for (const t of state.todos) if (!t.owner) t.owner = 'laura';
  if (!state.routines.some(r => r.section === 'ampel')) {
    for (const r of DEFAULT_ROUTINES.filter(r => r.section === 'ampel')) {
      state.routines.push({ id: newId(), pos: state.routines.length, active: true, ...r });
    }
  }
  // Häkchen: früher { key: true } (= Laura), jetzt { key: { laura: true, dennis: true } }
  for (const day of Object.keys(state.checks || {})) {
    for (const key of Object.keys(state.checks[day])) {
      if (state.checks[day][key] === true) state.checks[day][key] = { laura: true };
    }
  }
  return state;
}

/* ---------- Lokaler Speicher ---------- */
class LocalStore {
  constructor() { this.mode = 'local'; this.onChange = null; }

  async init() {
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LEGACY_LS_KEY);
    this.state = migrateState(raw ? JSON.parse(raw) : buildDefaultState());
    this._save();
  }
  _save() { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); }

  async addTask(t) {
    this.state.tasks.push({ id: newId(), anchor: DEFAULT_ANCHOR, pos: this.state.tasks.length, active: true, ...t });
    this._save();
  }
  async updateTask(id, patch) {
    Object.assign(this.state.tasks.find(t => t.id === id) || {}, patch); this._save();
  }
  async deleteTask(id) {
    this.state.tasks = this.state.tasks.filter(t => t.id !== id); this._save();
  }

  async addRoutine(r) {
    this.state.routines.push({ id: newId(), pos: this.state.routines.length, active: true, ...r });
    this._save();
  }
  async updateRoutine(id, patch) {
    Object.assign(this.state.routines.find(r => r.id === id) || {}, patch); this._save();
  }
  async deleteRoutine(id) {
    this.state.routines = this.state.routines.filter(r => r.id !== id); this._save();
  }

  async addRule(text, owner = 'haus') {
    this.state.rules.push({ id: newId(), text, owner, pos: this.state.rules.length }); this._save();
  }
  async updateRule(id, patch) {
    Object.assign(this.state.rules.find(r => r.id === id) || {}, patch); this._save();
  }
  async deleteRule(id) {
    this.state.rules = this.state.rules.filter(r => r.id !== id); this._save();
  }

  async setCheck(day, key, who, on) {
    const d = this.state.checks[day] || (this.state.checks[day] = {});
    const c = d[key] || (d[key] = {});
    if (on) c[who] = true; else delete c[who];
    if (!Object.keys(c).length) delete d[key];
    this._save();
  }

  async setSetting(key, value) { this.state.settings[key] = value; this._save(); }

  async book(day, item_key, person, slot) {
    this.state.bookings = this.state.bookings.filter(b => !(b.day === day && b.item_key === item_key && b.person === person));
    this.state.bookings.push({ day, item_key, person, slot }); this._save();
  }
  async unbook(day, item_key, person) {
    this.state.bookings = this.state.bookings.filter(b => !(b.day === day && b.item_key === item_key && b.person === person));
    this._save();
  }

  async addBudgetCat(c) {
    const row = { id: newId(), emoji: '♡', pos: this.state.budgetCats.length, active: true, ...c };
    this.state.budgetCats.push(row); this._save();
    return row;
  }
  async updateBudgetCat(id, patch) {
    Object.assign(this.state.budgetCats.find(c => c.id === id) || {}, patch); this._save();
  }
  async deleteBudgetCat(id) {
    this.state.budgetCats = this.state.budgetCats.filter(c => c.id !== id);
    this.state.expenses = this.state.expenses.filter(e => e.cat_id !== id);
    for (const m of Object.keys(this.state.budgets)) delete this.state.budgets[m][id];
    this._save();
  }
  async setBudget(month, catId, amountCents) {
    const m = this.state.budgets[month] || (this.state.budgets[month] = {});
    if (amountCents > 0) m[catId] = amountCents; else delete m[catId];
    this._save();
  }
  async copyBudgets(month, map) {
    this.state.budgets[month] = { ...map }; this._save();
  }
  async addExpense(e) {
    const row = { id: newId(), note: '', ...e };
    this.state.expenses.push(row); this._save();
    return row;
  }
  async deleteExpense(id) {
    this.state.expenses = this.state.expenses.filter(e => e.id !== id); this._save();
  }

  async addTodo(fields) {
    const row = { id: newId(), groesse: 3, due: null, pos: this.state.todos.length, created_at: new Date().toISOString(), done_at: null, done_by: null, ...fields };
    this.state.todos.push(row); this._save();
    return row;
  }
  async updateTodo(id, patch) {
    Object.assign(this.state.todos.find(t => t.id === id) || {}, patch); this._save();
  }
  async deleteTodo(id) {
    this.state.todos = this.state.todos.filter(t => t.id !== id); this._save();
  }
}

/* ---------- Cloud-Speicher (Supabase) ---------- */
class CloudStore {
  constructor(client) { this.mode = 'cloud'; this.sb = client; this.onChange = null; this.online = true; }

  async init() {
    try {
      await this._loadAll();
      if (!this.state.tasks.length && !this.state.routines.length && !this.state.rules.length) {
        await this._seed();
        await this._loadAll();
      }
      localStorage.setItem(LS_KEY + '-cloudcache', JSON.stringify(this.state));
      this._subscribe();
    } catch (e) {
      console.warn('Cloud nicht erreichbar, nutze Cache:', e);
      this.online = false;
      const raw = localStorage.getItem(LS_KEY + '-cloudcache');
      this.state = migrateState(raw ? JSON.parse(raw) : buildDefaultState());
    }
  }

  async _loadAll() {
    const since = toISODate(new Date(Date.now() - 3 * 86400000));
    const [tasks, routines, rules, checks, settings, cats, budgets, expenses, todos, bookings] = await Promise.all([
      this.sb.from('tasks').select('*').order('pos'),
      this.sb.from('routine_items').select('*').order('pos'),
      this.sb.from('rules').select('*').order('pos'),
      this.sb.from('checks').select('*'),
      this.sb.from('settings').select('*'),
      this.sb.from('budget_categories').select('*').order('pos'),
      this.sb.from('budgets').select('*'),
      this.sb.from('expenses').select('*').order('day'),
      this.sb.from('todos').select('*').order('pos'),
      this.sb.from('bookings').select('*').gte('day', since),
    ]);
    for (const r of [tasks, routines, rules, checks, settings, cats, budgets, expenses, todos, bookings]) if (r.error) throw r.error;

    const checkMap = {};
    for (const c of checks.data) {
      const d = (checkMap[c.day] = checkMap[c.day] || {});
      (d[c.item_key] = d[c.item_key] || {})[c.user_key || 'laura'] = true;
    }
    const settingsMap = { projektzeit: DEFAULT_PROJEKTZEIT, ziele: DEFAULT_GOALS };
    for (const s of settings.data) settingsMap[s.key] = s.value?.v ?? s.value;

    const budgetMap = {};
    for (const b of budgets.data) {
      (budgetMap[b.month] = budgetMap[b.month] || {})[b.cat_id] = b.amount;
    }

    this.state = {
      tasks: tasks.data, routines: routines.data, rules: rules.data,
      checks: checkMap, settings: settingsMap,
      budgetCats: cats.data, budgets: budgetMap, expenses: expenses.data,
      todos: todos.data, bookings: bookings.data,
    };
  }

  async _seed() {
    // Erstes Gerät, das sich anmeldet, füllt die Cloud — bevorzugt mit seinen
    // bestehenden lokalen Daten (Häkchen, Budgets bleiben erhalten), sonst Standard.
    const localRaw = localStorage.getItem(LS_KEY);
    const d = migrateState(localRaw ? JSON.parse(localRaw) : buildDefaultState());
    if (d.tasks.length) await this.sb.from('tasks').insert(d.tasks);
    if (d.routines.length) await this.sb.from('routine_items').insert(d.routines);
    if (d.rules.length) await this.sb.from('rules').insert(d.rules);
    await this.sb.from('settings').upsert({ key: 'projektzeit', value: { v: d.settings.projektzeit || DEFAULT_PROJEKTZEIT } });

    const checkRows = [];
    for (const day of Object.keys(d.checks)) {
      for (const item_key of Object.keys(d.checks[day])) {
        for (const user_key of Object.keys(d.checks[day][item_key])) checkRows.push({ day, item_key, user_key });
      }
    }
    if (checkRows.length) await this.sb.from('checks').upsert(checkRows);

    if (d.budgetCats.length) await this.sb.from('budget_categories').insert(d.budgetCats);
    const budgetRows = [];
    for (const month of Object.keys(d.budgets)) {
      for (const [cat_id, amount] of Object.entries(d.budgets[month])) budgetRows.push({ month, cat_id, amount });
    }
    if (budgetRows.length) await this.sb.from('budgets').upsert(budgetRows);
    if (d.expenses.length) await this.sb.from('expenses').insert(d.expenses);
    if (d.todos.length) await this.sb.from('todos').insert(d.todos);
  }

  _subscribe() {
    this.sb.channel('wilma-sync')
      .on('postgres_changes', { event: '*', schema: 'public' }, async () => {
        try {
          await this._loadAll();
          localStorage.setItem(LS_KEY + '-cloudcache', JSON.stringify(this.state));
          if (this.onChange) this.onChange();
        } catch (e) { console.warn(e); }
      })
      .subscribe();
  }

  _cache() { localStorage.setItem(LS_KEY + '-cloudcache', JSON.stringify(this.state)); }

  // Wer ist angemeldet? E-Mail der Sitzung → 'dennis' | 'laura' (Tabelle members)
  async whoAmI() {
    const { data: { user } } = await this.sb.auth.getUser();
    if (!user) return null;
    const { data, error } = await this.sb.from('members').select('person').eq('email', (user.email || '').toLowerCase()).maybeSingle();
    if (error || !data) return null;
    return data.person;
  }

  async addTask(t) {
    const row = { id: newId(), anchor: DEFAULT_ANCHOR, pos: this.state.tasks.length, active: true, ...t };
    this.state.tasks.push(row); this._cache();
    await this.sb.from('tasks').insert(row);
  }
  async updateTask(id, patch) {
    Object.assign(this.state.tasks.find(t => t.id === id) || {}, patch); this._cache();
    await this.sb.from('tasks').update(patch).eq('id', id);
  }
  async deleteTask(id) {
    this.state.tasks = this.state.tasks.filter(t => t.id !== id); this._cache();
    await this.sb.from('tasks').delete().eq('id', id);
  }

  async addRoutine(r) {
    const row = { id: newId(), pos: this.state.routines.length, active: true, ...r };
    this.state.routines.push(row); this._cache();
    await this.sb.from('routine_items').insert(row);
  }
  async updateRoutine(id, patch) {
    Object.assign(this.state.routines.find(r => r.id === id) || {}, patch); this._cache();
    await this.sb.from('routine_items').update(patch).eq('id', id);
  }
  async deleteRoutine(id) {
    this.state.routines = this.state.routines.filter(r => r.id !== id); this._cache();
    await this.sb.from('routine_items').delete().eq('id', id);
  }

  async addRule(text, owner = 'haus') {
    const row = { id: newId(), text, owner, pos: this.state.rules.length };
    this.state.rules.push(row); this._cache();
    await this.sb.from('rules').insert(row);
  }
  async updateRule(id, patch) {
    Object.assign(this.state.rules.find(r => r.id === id) || {}, patch); this._cache();
    await this.sb.from('rules').update(patch).eq('id', id);
  }
  async deleteRule(id) {
    this.state.rules = this.state.rules.filter(r => r.id !== id); this._cache();
    await this.sb.from('rules').delete().eq('id', id);
  }

  async setCheck(day, key, who, on) {
    const d = this.state.checks[day] || (this.state.checks[day] = {});
    const c = d[key] || (d[key] = {});
    if (on) c[who] = true; else delete c[who];
    if (!Object.keys(c).length) delete d[key];
    this._cache();
    if (on) await this.sb.from('checks').upsert({ day, item_key: key, user_key: who });
    else await this.sb.from('checks').delete().eq('day', day).eq('item_key', key).eq('user_key', who);
  }

  async setSetting(key, value) {
    this.state.settings[key] = value; this._cache();
    await this.sb.from('settings').upsert({ key, value: { v: value } });
  }

  async book(day, item_key, person, slot) {
    this.state.bookings = this.state.bookings.filter(b => !(b.day === day && b.item_key === item_key && b.person === person));
    this.state.bookings.push({ day, item_key, person, slot }); this._cache();
    await this.sb.from('bookings').upsert({ day, item_key, person, slot });
  }
  async unbook(day, item_key, person) {
    this.state.bookings = this.state.bookings.filter(b => !(b.day === day && b.item_key === item_key && b.person === person));
    this._cache();
    await this.sb.from('bookings').delete().eq('day', day).eq('item_key', item_key).eq('person', person);
  }

  async addBudgetCat(c) {
    const row = { id: newId(), emoji: '♡', pos: this.state.budgetCats.length, active: true, ...c };
    this.state.budgetCats.push(row); this._cache();
    await this.sb.from('budget_categories').insert(row);
    return row;
  }
  async updateBudgetCat(id, patch) {
    Object.assign(this.state.budgetCats.find(c => c.id === id) || {}, patch); this._cache();
    await this.sb.from('budget_categories').update(patch).eq('id', id);
  }
  async deleteBudgetCat(id) {
    this.state.budgetCats = this.state.budgetCats.filter(c => c.id !== id);
    this.state.expenses = this.state.expenses.filter(e => e.cat_id !== id);
    for (const m of Object.keys(this.state.budgets)) delete this.state.budgets[m][id];
    this._cache();
    await this.sb.from('budget_categories').delete().eq('id', id);   // cascade löscht budgets/expenses
  }
  async setBudget(month, catId, amountCents) {
    const m = this.state.budgets[month] || (this.state.budgets[month] = {});
    if (amountCents > 0) m[catId] = amountCents; else delete m[catId];
    this._cache();
    if (amountCents > 0) await this.sb.from('budgets').upsert({ month, cat_id: catId, amount: amountCents });
    else await this.sb.from('budgets').delete().eq('month', month).eq('cat_id', catId);
  }
  async copyBudgets(month, map) {
    this.state.budgets[month] = { ...map }; this._cache();
    const rows = Object.entries(map).map(([cat_id, amount]) => ({ month, cat_id, amount }));
    if (rows.length) await this.sb.from('budgets').upsert(rows);
  }
  async addExpense(e) {
    const row = { id: newId(), note: '', ...e };
    this.state.expenses.push(row); this._cache();
    await this.sb.from('expenses').insert(row);
    return row;
  }
  async deleteExpense(id) {
    this.state.expenses = this.state.expenses.filter(e => e.id !== id); this._cache();
    await this.sb.from('expenses').delete().eq('id', id);
  }

  async addTodo(fields) {
    const row = { id: newId(), groesse: 3, due: null, pos: this.state.todos.length, created_at: new Date().toISOString(), done_at: null, done_by: null, ...fields };
    this.state.todos.push(row); this._cache();
    await this.sb.from('todos').insert(row);
    return row;
  }
  async updateTodo(id, patch) {
    Object.assign(this.state.todos.find(t => t.id === id) || {}, patch); this._cache();
    await this.sb.from('todos').update(patch).eq('id', id);
  }
  async deleteTodo(id) {
    this.state.todos = this.state.todos.filter(t => t.id !== id); this._cache();
    await this.sb.from('todos').delete().eq('id', id);
  }
}
