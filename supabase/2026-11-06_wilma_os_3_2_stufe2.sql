-- ============================================================
-- Wilma OS 3.2 — Stufe 2: Push, Konten, Belohnungen (E-197, 06.11.2026)
-- Projekt: „Lauras Betriebssystem" (lcdlotidyarunuafonvp) — NICHT DGX!
-- Eine Transaktion, rein additiv. Nichts wird gelöscht.
-- ============================================================
begin;

-- 1. Push-Abonnements je Gerät
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  person     text not null check (person in ('dennis','laura')),
  keys       jsonb not null,            -- { p256dh, auth }
  ua         text,
  created_at timestamptz not null default now()
);

-- 2. Konten und Kontostände (Beträge in Cent; Kredite als Art 'kredit' werden negativ gerechnet)
create table if not exists public.accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner      text not null default 'gemeinsam' check (owner in ('gemeinsam','dennis','laura')),
  art        text not null default 'giro' check (art in ('giro','tagesgeld','depot','kreditkarte','kredit','bar','sonstiges')),
  pos        int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.account_balances (
  account_id uuid not null references public.accounts(id) on delete cascade,
  day        date not null,
  amount     bigint not null,
  created_by text check (created_by is null or created_by in ('dennis','laura')),
  created_at timestamptz not null default now(),
  primary key (account_id, day)
);

-- 3. Belohnungen aus dem gemeinsamen Wilma-Topf
create table if not exists public.rewards (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  emoji      text not null default '🎁',
  cost       int not null check (cost > 0),
  pos        int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.reward_redemptions (
  id           uuid primary key default gen_random_uuid(),
  reward_id    uuid not null references public.rewards(id) on delete cascade,
  title        text not null,                 -- Kopie, falls die Belohnung später gelöscht wird
  cost         int not null,
  requested_by text not null check (requested_by in ('dennis','laura')),
  confirmed_by text check (confirmed_by is null or confirmed_by in ('dennis','laura')),
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

-- 4. Zugriff nur für die zwei Bewohner + Live-Abgleich
do $$
declare t text;
begin
  foreach t in array array['push_subscriptions','accounts','account_balances','rewards','reward_redemptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "wilma_%s" on public.%I', t, t);
    execute format('create policy "wilma_%s" on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t, t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

commit;

-- Nachprüfung (separat):
-- select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('push_subscriptions','accounts','account_balances','rewards','reward_redemptions');
