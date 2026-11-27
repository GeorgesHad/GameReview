create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete restrict,
  user_id uuid not null references public.profiles (user_id) on delete restrict,
  role text not null check (role in ('admin', 'player')),
  active boolean not null default true,
  player_code text check (player_code ~ '^[A-Z0-9_-]{1,32}$' and player_code <> 'ALL'),
  shirt_number smallint check (shirt_number between 0 and 999),
  created_at timestamptz not null default now(),
  unique (team_id, user_id),
  unique (team_id, player_code),
  check (role <> 'player' or player_code is not null)
);

create index team_memberships_user_id_idx on public.team_memberships (user_id);

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;

-- These tables are only accessible through the trusted server or an operator.
revoke all on public.profiles, public.teams, public.team_memberships from public, anon, authenticated;
grant select, insert, update, delete on public.profiles, public.teams, public.team_memberships to service_role;
