-- ============================================================
-- Wilma App 2.0 — Umbau von „Betriebssystem Laura" (E-66, 09.10.2026)
-- Projekt: „Lauras Betriebssystem" (lcdlotidyarunuafonvp) — NICHT DGX!
-- Läuft in EINER Transaktion: entweder alles oder nichts.
-- Rein additiv: keine Zeile wird gelöscht, die alte App läuft weiter.
-- ============================================================
begin;

-- 0. Sicherung aller Tabellen (vollständige Kopie, bleibt liegen)
create schema if not exists sicherung_20261009;
create table sicherung_20261009.tasks             as table public.tasks;
create table sicherung_20261009.routine_items     as table public.routine_items;
create table sicherung_20261009.rules             as table public.rules;
create table sicherung_20261009.checks            as table public.checks;
create table sicherung_20261009.settings          as table public.settings;
create table sicherung_20261009.budget_categories as table public.budget_categories;
create table sicherung_20261009.budgets           as table public.budgets;
create table sicherung_20261009.expenses          as table public.expenses;
create table sicherung_20261009.todos             as table public.todos;
revoke all on schema sicherung_20261009 from anon, authenticated;

-- 1. Bewohner: welche E-Mail ist wer
create table if not exists public.members (
  email text primary key check (email = lower(email)),
  person text not null unique check (person in ('dennis','laura')),
  created_at timestamptz not null default now()
);
-- Die zwei E-Mail-Adressen stehen NICHT im öffentlichen Repo, sondern nur in der privaten Kopie
-- (Agenten-Quartier/Leonardo/konzepte/2026-10_E-66_Wilma-App_Migration.sql):
-- insert into public.members (email, person) values ('<dennis>', 'dennis'), ('<laura>', 'laura')
-- on conflict (email) do update set person = excluded.person;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m
                 where m.email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- 2. Besitz: haus | gemeinsam | dennis | laura  (Bestand: Haushalt = Haus, Rest = Laura)
alter table public.tasks         add column if not exists owner text not null default 'haus';
alter table public.routine_items add column if not exists owner text not null default 'laura';
alter table public.routine_items add column if not exists gate text;
alter table public.routine_items add column if not exists gate_slot text;
alter table public.rules         add column if not exists owner text not null default 'laura';
alter table public.todos         add column if not exists owner text not null default 'laura';
alter table public.todos         add column if not exists done_by text;

alter table public.tasks         add constraint tasks_owner_check         check (owner in ('haus','gemeinsam','dennis','laura'));
alter table public.routine_items add constraint routine_items_owner_check check (owner in ('haus','gemeinsam','dennis','laura'));
alter table public.rules         add constraint rules_owner_check         check (owner in ('haus','gemeinsam','dennis','laura'));
alter table public.todos         add constraint todos_owner_check         check (owner in ('haus','gemeinsam','dennis','laura'));
alter table public.todos         add constraint todos_done_by_check       check (done_by is null or done_by in ('dennis','laura'));
alter table public.routine_items add constraint routine_items_gate_slot_check check (gate_slot is null or gate_slot in ('morgen','abend'));

alter table public.routine_items drop constraint routine_items_section_check;
alter table public.routine_items add constraint routine_items_section_check
  check (section in ('ampel','morgen','grow','hunde','alltag'));

-- 3. Häkchen je Person (Bestand: alle von Laura)
alter table public.checks add column if not exists user_key text not null default 'laura';
alter table public.checks add constraint checks_user_key_check check (user_key in ('dennis','laura'));
alter table public.checks drop constraint checks_pkey;
alter table public.checks add primary key (day, item_key, user_key);

-- 4. Die zwei Hausregeln mit Ampel (gemeinsam, grün erst wenn beide bestätigt haben)
insert into public.routine_items (title, section, owner, gate, gate_slot, pos, active)
select v.title, 'ampel', 'gemeinsam', v.gate, v.slot, v.pos, true
from (values ('OG in Ordnung', 'bevor wir morgens Kaffee trinken', 'morgen', -2),
             ('EG in Ordnung', 'bevor wir schlafen gehen',        'abend',  -1)) as v(title, gate, slot, pos)
where not exists (select 1 from public.routine_items r where r.section = 'ampel' and r.title = v.title);

-- 5. Zugriff nur für die zwei Bewohner (statt „jeder angemeldete Nutzer")
alter table public.members enable row level security;
drop policy if exists "members_read" on public.members;
create policy "members_read" on public.members for select to authenticated using (public.is_member());

do $$
declare t text;
begin
  foreach t in array array['tasks','routine_items','rules','checks','settings',
                          'budget_categories','budgets','expenses','todos'] loop
    execute format('drop policy if exists "auth_all_%s" on public.%I', t, t);
    execute format('drop policy if exists "wilma_%s" on public.%I', t, t);
    execute format(
      'create policy "wilma_%s" on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())',
      t, t);
  end loop;
end $$;

commit;
