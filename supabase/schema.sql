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

-- ---------- RLS: nur angemeldete Nutzer (= Laura & Dennis) ----------
do $$
begin
  execute 'alter table public.tasks enable row level security';
  execute 'alter table public.routine_items enable row level security';
  execute 'alter table public.rules enable row level security';
  execute 'alter table public.checks enable row level security';
  execute 'alter table public.settings enable row level security';
end $$;

do $$
declare t text;
begin
  foreach t in array array['tasks','routine_items','rules','checks','settings'] loop
    execute format('drop policy if exists "auth_all_%s" on public.%I', t, t);
    execute format(
      'create policy "auth_all_%s" on public.%I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- ---------- Realtime: Geräte halten sich gegenseitig aktuell ----------
do $$
begin
  begin
    alter publication supabase_realtime add table public.tasks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.routine_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.rules;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.checks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.settings;
  exception when duplicate_object then null;
  end;
end $$;

-- Hinweis: Die Startdaten (Lauras Wochenplan, Routinen, Regeln) trägt die App
-- beim ersten Start selbst ein — hier ist kein Seed nötig.
