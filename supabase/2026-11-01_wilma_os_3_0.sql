-- ============================================================
-- Wilma OS 3.0 — Stufe 1 (E-197, 01.11.2026)
-- Projekt: „Lauras Betriebssystem" (lcdlotidyarunuafonvp) — NICHT DGX!
-- Eine Transaktion: alles oder nichts. Additiv: keine Zeile wird gelöscht.
-- Die alte App (Betriebssystem Laura v1.5) läuft danach weiter.
-- ============================================================
begin;

-- 0. Sicherung aller Tabellen
create schema if not exists sicherung_20261101;
create table sicherung_20261101.tasks             as table public.tasks;
create table sicherung_20261101.routine_items     as table public.routine_items;
create table sicherung_20261101.rules             as table public.rules;
create table sicherung_20261101.checks            as table public.checks;
create table sicherung_20261101.settings          as table public.settings;
create table sicherung_20261101.budget_categories as table public.budget_categories;
create table sicherung_20261101.budgets           as table public.budgets;
create table sicherung_20261101.expenses          as table public.expenses;
create table sicherung_20261101.todos             as table public.todos;
create table sicherung_20261101.members           as table public.members;
revoke all on schema sicherung_20261101 from anon, authenticated;

-- 1. Neue Besitzart „jeder" (gleiche Aufgabe für beide, jeder hakt für sich ab)
alter table public.tasks         drop constraint tasks_owner_check;
alter table public.tasks         add  constraint tasks_owner_check         check (owner in ('haus','gemeinsam','jeder','dennis','laura'));
alter table public.routine_items drop constraint routine_items_owner_check;
alter table public.routine_items add  constraint routine_items_owner_check check (owner in ('haus','gemeinsam','jeder','dennis','laura'));

-- 2. Größe (= Punkte) und „zu zweit möglich"
alter table public.tasks         add column if not exists groesse  int     not null default 1;
alter table public.tasks         add column if not exists zu_zweit boolean not null default false;
alter table public.routine_items add column if not exists groesse  int     not null default 1;
alter table public.routine_items add column if not exists zu_zweit boolean not null default false;
alter table public.todos         add column if not exists groesse  int     not null default 3;
alter table public.todos         add column if not exists due      date;
alter table public.tasks         add constraint tasks_groesse_check         check (groesse in (1,3,5,10));
alter table public.routine_items add constraint routine_items_groesse_check check (groesse in (1,3,5,10));
alter table public.todos         add constraint todos_groesse_check         check (groesse in (1,3,5,10));

-- 3. Buchungen („Ich übernehme" / „Dazubuchen") — gelten nur für ihren Tag
create table if not exists public.bookings (
  day        date not null,
  item_key   text not null,
  person     text not null check (person in ('dennis','laura')),
  slot       text not null check (slot in ('morgen','mittag','abend')),
  created_at timestamptz not null default now(),
  primary key (day, item_key, person)
);

-- 4. Budget je Person, Ausgabe mit Urheber
alter table public.budget_categories add column if not exists owner text not null default 'gemeinsam';
alter table public.budget_categories add constraint budget_categories_owner_check check (owner in ('gemeinsam','dennis','laura'));
alter table public.expenses add column if not exists created_by text;
alter table public.expenses add constraint expenses_created_by_check check (created_by is null or created_by in ('dennis','laura'));
update public.budget_categories set owner = 'laura';                       -- alle bisherigen hat Laura angelegt
update public.expenses set created_by = 'laura' where created_by is null;  -- alle bisherigen hat Laura eingetragen

-- 5. Morgenroutine für beide, Time to Grow als ein Punkt, Hunderunden zu zweit
update public.routine_items set owner = 'jeder' where section = 'morgen' and active;
update public.routine_items set active = false   where section = 'grow';    -- Verlauf bleibt erhalten
insert into public.routine_items (title, section, owner, groesse, pos, active)
select 'Time to Grow ✨', 'morgen', 'jeder', 5,
       coalesce((select max(pos) from public.routine_items where section = 'morgen'), 0) + 1, true
where not exists (select 1 from public.routine_items where section = 'morgen' and title like 'Time to Grow%');
update public.routine_items set owner = 'haus', zu_zweit = true, groesse = 3 where section = 'hunde';
update public.routine_items set groesse = 3 where section = 'ampel';
update public.routine_items set groesse = 3 where section = 'morgen' and title like 'Kaffee%';
update public.routine_items set groesse = 1 where section = 'morgen' and title in ('Aufstehen & Bad','Betten kurz machen (OG)','5-Minuten-Ordnung oben');

-- 6. Startgrößen Wochenplan (änderbar unter „Anpassen")
update public.tasks t set groesse = v.g, zu_zweit = v.z
from (values
  ('Garten',5,true), ('Vorgarten',3,true),
  ('Saugen und wischen UG',5,false), ('Saugen und wischen OG',5,false),
  ('Kühlschrank',5,false), ('Dusche Grund',5,false), ('Bügeln',5,false),
  ('Betten beziehen',3,false), ('Staub unten',3,false), ('Staub oben',3,false),
  ('Spüle intensiv',3,false), ('Küchenschränke außen',3,false),
  ('WC OG',3,false), ('WC unten',3,false), ('Teppich Bad',3,false)
) as v(title, g, z)
where t.title = v.title;

-- 7. Team-Ziele (Erledigungsquote in Prozent)
insert into public.settings (key, value)
values ('ziele', '{"v": {"soul": {"woche": 70, "monat": 70, "quartal": 70, "jahr": 70},
                         "wilma": {"woche": 70, "monat": 70, "quartal": 70, "jahr": 70}}}'::jsonb)
on conflict (key) do nothing;

-- 8. Zugriff nur für die zwei Bewohner + Live-Abgleich
alter table public.bookings enable row level security;
drop policy if exists "wilma_bookings" on public.bookings;
create policy "wilma_bookings" on public.bookings for all to authenticated
  using (public.is_member()) with check (public.is_member());
do $$
begin
  begin
    alter publication supabase_realtime add table public.bookings;
  exception when duplicate_object then null;
  end;
end $$;

commit;

-- ---------- Nachprüfung (separat ausführen) ----------
-- select 'häkchen' k, count(*) from public.checks
-- union all select 'häkchen sicherung', count(*) from sicherung_20261101.checks
-- union all select 'todos', count(*) from public.todos
-- union all select 'ausgaben', count(*) from public.expenses
-- union all select 'aufgaben', count(*) from public.tasks
-- union all select 'routinen aktiv '||owner, count(*) from public.routine_items where active group by owner
-- union all select 'kategorien '||owner, count(*) from public.budget_categories group by owner;
