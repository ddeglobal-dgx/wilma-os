-- ============================================================
-- Betriebssystem Laura — Supabase-Schema (Stufe 1)
-- Neues, eigenes Supabase-Projekt (NICHT das DGX-Projekt!)
-- Einmalig im SQL-Editor ausführen. Idempotent.
-- ============================================================

-- Wochenplan-Aufgaben
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  weekday int not null check (weekday between 1 and 7),   -- 1 = Montag … 7 = Sonntag
  cadence text not null default 'weekly' check (cadence in ('weekly','biweekly')),
  anchor date,                                            -- Montag der Woche, in der eine 2-wö. Aufgabe "dran" ist
  pos int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Routine-Punkte (Morgenroutine, Time to Grow, Hunde)
create table if not exists public.routine_items (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('morgen','grow','hunde')),
  title text not null,
  pos int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Meine Regeln
create table if not exists public.rules (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  pos int not null default 0,
  created_at timestamptz not null default now()
);

-- Häkchen (pro Tag & Punkt)
create table if not exists public.checks (
  day date not null,
  item_key text not null,          -- 'task:<uuid>' | 'routine:<uuid>' | 'zone'
  checked_at timestamptz not null default now(),
  primary key (day, item_key)
);

-- Einstellungen (z. B. Projektzeit-Text)
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Budget: Kategorien (von Laura selbst angelegt)
create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '♡',
  pos int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Budget: Monatsbudgets je Kategorie (Betrag in Cent)
create table if not exists public.budgets (
  month text not null,                 -- 'YYYY-MM'
  cat_id uuid not null references public.budget_categories(id) on delete cascade,
  amount int not null check (amount >= 0),
  primary key (month, cat_id)
);

-- Budget: Ausgaben (Betrag in Cent)
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  cat_id uuid not null references public.budget_categories(id) on delete cascade,
  amount int not null check (amount > 0),
  note text not null default '',
  day date not null,
  created_at timestamptz not null default now()
);

-- Einmalige To-dos (Historie über done_at)
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  pos int not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

-- ---------- RLS: nur angemeldete Nutzer (= Laura & Dennis) ----------
do $$
declare t text;
begin
  foreach t in array array['tasks','routine_items','rules','checks','settings',
                          'budget_categories','budgets','expenses','todos'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['tasks','routine_items','rules','checks','settings',
                          'budget_categories','budgets','expenses','todos'] loop
    execute format('drop policy if exists "auth_all_%s" on public.%I', t, t);
    execute format(
      'create policy "auth_all_%s" on public.%I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- ---------- Realtime: Geräte halten sich gegenseitig aktuell ----------
do $$
declare t text;
begin
  foreach t in array array['tasks','routine_items','rules','checks','settings',
                          'budget_categories','budgets','expenses','todos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Hinweis: Die Startdaten (Lauras Wochenplan, Routinen, Regeln) trägt die App
-- beim ersten Start selbst ein — hier ist kein Seed nötig.
