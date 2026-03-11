-- Fix name casing: aplica Title Case a name y lastname en public.profiles
-- Fecha: 2026-03-11
-- Ejecutar en Supabase SQL Editor.
-- Convierte "JUAN" -> "Juan", "maria" -> "Maria", "PEDRO PABLO" -> "Pedro Pablo"

begin;

-- Backup antes de modificar
create schema if not exists backups;

do $$
declare
  ts text := to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS');
begin
  execute format(
    'create table backups.profiles_name_fix_%s as table public.profiles',
    ts
  );
  execute format(
    'alter table backups.profiles_name_fix_%s enable row level security',
    ts
  );
end $$;

-- Aplicar Title Case (initcap) a name y lastname
update public.profiles
set
  name     = initcap(name),
  lastname = initcap(lastname)
where
  name     is not null
  or lastname is not null;

commit;
