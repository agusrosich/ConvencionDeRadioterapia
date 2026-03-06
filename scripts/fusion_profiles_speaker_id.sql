-- Fusion segura de speaker_id en public.profiles
-- Fecha: 2026-03-06
-- Ejecutar en Supabase SQL Editor.
-- Este script NO borra perfiles.

begin;

-- 0) Backup completo con timestamp (no pisa backups anteriores)
do $$
begin
  execute format(
    'create table public.profiles_backup_%s as table public.profiles',
    to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS')
  );
end $$;

-- 1) Mapeo validado: user_id -> speaker_id correcto
--    Si new_speaker_id es NULL, se limpia el speaker_id incorrecto.
with mapping(user_id, new_speaker_id, note) as (
  values
    ('4c606d77-15ed-4b65-9045-789cd9d3d4b5', 'speaker-019', 'Agustin Rosich'),
    ('6ff781dd-5685-4653-b7aa-e8ceee2a8fb0', 'speaker-075', 'Emiliano Rivero'),
    ('e5e05bf7-693a-4a65-bac1-50a7c62526f6', 'speaker-068', 'Sergio Aguiar'),
    ('a8c4e33a-2534-449a-998f-7dd84374795d', 'speaker-035', 'Ricardo Ruggeri'),
    ('4bdf8d84-1fde-4947-beca-cae9e0f6022e', 'speaker-014', 'Federico Lorenzo'),
    ('1b4f5eaa-cdd6-4024-9f71-5ffa719b210f', 'speaker-017', 'Natalia Gadea'),
    ('b01090d0-fd35-4521-91ab-ac3bfb97008f', 'speaker-018', 'Jesica Lell'),
    ('edda4e15-8f18-483b-bb8c-a86b474b27b7', 'speaker-046', 'Mathias Jeldres'),
    ('95fdf086-581c-462d-b031-e60d5c2f5a8c', null,          'Sebastian Viettro (sin speaker en catalogo actual)')
),

-- 2) Solo filas de profiles que realmente existen
target as (
  select
    p.user_id,
    p.speaker_id as old_speaker_id,
    m.new_speaker_id,
    m.note
  from public.profiles p
  join mapping m on m.user_id = p.user_id
)

-- 3) Paso A: limpiar speaker_id para evitar choques por unique durante reasignacion
update public.profiles p
set speaker_id = null
from target t
where p.user_id = t.user_id
  and p.speaker_id is not null;

-- 4) Paso B: setear speaker_id final (solo no nulos)
with mapping(user_id, new_speaker_id) as (
  values
    ('4c606d77-15ed-4b65-9045-789cd9d3d4b5', 'speaker-019'),
    ('6ff781dd-5685-4653-b7aa-e8ceee2a8fb0', 'speaker-075'),
    ('e5e05bf7-693a-4a65-bac1-50a7c62526f6', 'speaker-068'),
    ('a8c4e33a-2534-449a-998f-7dd84374795d', 'speaker-035'),
    ('4bdf8d84-1fde-4947-beca-cae9e0f6022e', 'speaker-014'),
    ('1b4f5eaa-cdd6-4024-9f71-5ffa719b210f', 'speaker-017'),
    ('b01090d0-fd35-4521-91ab-ac3bfb97008f', 'speaker-018'),
    ('edda4e15-8f18-483b-bb8c-a86b474b27b7', 'speaker-046')
)
update public.profiles p
set speaker_id = m.new_speaker_id
from mapping m
where p.user_id = m.user_id;

-- 5) Reporte post-fusion
--    a) Perfiles con speaker_id
--    b) Duplicados por speaker_id (deberia dar 0)
select
  count(*) as total_profiles,
  count(*) filter (where speaker_id is not null) as profiles_with_speaker_id
from public.profiles;

select speaker_id, count(*) as qty
from public.profiles
where speaker_id is not null
group by speaker_id
having count(*) > 1
order by qty desc, speaker_id;

commit;

