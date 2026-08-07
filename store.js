/* ============ Datenhaltung: lokal (localStorage) oder Cloud (Supabase) ============ */

const LS_KEY = 'bsl-state-v1';

function newId() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function buildDefaultState() {
  return {
    tasks: DEFAULT_TASKS.map((t, i) => ({
      id: newId(), title: t.title, weekday: t.weekday,
      cadence: t.cadence, anchor: DEFAULT_ANCHOR, pos: i, active: true,
    })),
    routines: DEFAULT_ROUTINES.map((r, i) => ({
      id: newId(), section: r.section, title: r.title, pos: i, active: true,
    })),
    rules: DEFAULT_RULES.map((text, i) => ({ id: newId(), text, pos: i })),
    checks: {},   // { '2026-08-07': { 'task:<id>': true, 'zone': true } }
    settings: { projektzeit: DEFAULT_PROJEKTZEIT },
  };
}

/* ---------- Lokaler Speicher ---------- */
class LocalStore {
  constructor() { this.mode = 'local'; this.onChange = null; }

  async init() {
    const raw = localStorage.getItem(LS_KEY);
    this.state = raw ? JSON.parse(raw) : buildDefaultState();
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

  async addRule(text) {
    this.state.rules.push({ id: newId(), text, pos: this.state.rules.length }); this._save();
  }
  async updateRule(id, text) {
    Object.assign(this.state.rules.find(r => r.id === id) || {}, { text }); this._save();
  }
  async deleteRule(id) {
    this.state.rules = this.state.rules.filter(r => r.id !== id); this._save();
  }

  async setCheck(day, key, on) {
    const d = this.state.checks[day] || (this.state.checks[day] = {});
    if (on) d[key] = true; else delete d[key];
    this._save();
  }

  async setSetting(key, value) { this.state.settings[key] = value; this._save(); }
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
      this.state = raw ? JSON.parse(raw) : buildDefaultState();
    }
  }

  async _loadAll() {
    const [tasks, routines, rules, checks, settings] = await Promise.all([
      this.sb.from('tasks').select('*').order('pos'),
      this.sb.from('routine_items').select('*').order('pos'),
      this.sb.from('rules').select('*').order('pos'),
      this.sb.from('checks').select('*'),
      this.sb.from('settings').select('*'),
    ]);
    for (const r of [tasks, routines, rules, checks, settings]) if (r.error) throw r.error;

    const checkMap = {};
    for (const c of checks.data) {
      (checkMap[c.day] = checkMap[c.day] || {})[c.item_key] = true;
    }
    const settingsMap = { projektzeit: DEFAULT_PROJEKTZEIT };
    for (const s of settings.data) settingsMap[s.key] = s.value?.v ?? s.value;

    this.state = {
      tasks: tasks.data, routines: routines.data, rules: rules.data,
      checks: checkMap, settings: settingsMap,
    };
  }

  async _seed() {
    const d = buildDefaultState();
    await this.sb.from('tasks').insert(d.tasks);
    await this.sb.from('routine_items').insert(d.routines);
    await this.sb.from('rules').insert(d.rules);
    await this.sb.from('settings').upsert({ key: 'projektzeit', value: { v: DEFAULT_PROJEKTZEIT } });
  }

  _subscribe() {
    this.sb.channel('bsl-sync')
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

  async addRule(text) {
    const row = { id: newId(), text, pos: this.state.rules.length };
    this.state.rules.push(row); this._cache();
    await this.sb.from('rules').insert(row);
  }
  async updateRule(id, text) {
    Object.assign(this.state.rules.find(r => r.id === id) || {}, { text }); this._cache();
    await this.sb.from('rules').update({ text }).eq('id', id);
  }
  async deleteRule(id) {
    this.state.rules = this.state.rules.filter(r => r.id !== id); this._cache();
    await this.sb.from('rules').delete().eq('id', id);
  }

  async setCheck(day, key, on) {
    const d = this.state.checks[day] || (this.state.checks[day] = {});
    if (on) d[key] = true; else delete d[key];
    this._cache();
    if (on) await this.sb.from('checks').upsert({ day, item_key: key });
    else await this.sb.from('checks').delete().eq('day', day).eq('item_key', key);
  }

  async setSetting(key, value) {
    this.state.settings[key] = value; this._cache();
    await this.sb.from('settings').upsert({ key, value: { v: value } });
  }
}
