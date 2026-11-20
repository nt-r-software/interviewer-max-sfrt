-- Pega esto en Supabase → SQL Editor → Run. Plan gratuito suficiente.
create table if not exists sessions (
  id         text primary key,
  created_at timestamptz not null,
  mode       text,
  label      text,
  summary    text,
  stats      jsonb,
  entries    jsonb
);

create table if not exists memory (
  id         text primary key,        -- siempre 'main'
  content    text,
  updated_at timestamptz
);

-- Seguridad: RLS activado y SIN políticas públicas = nadie accede con la clave anon.
-- La app usa la clave "service_role" (Project Settings → API). Es solo para uso personal:
-- guárdala solo en tu equipo (la app la cifra) y no la compartas ni la subas a ningún repo.
alter table sessions enable row level security;
alter table memory   enable row level security;
