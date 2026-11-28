-- Temporary DEV proof of concept. No browser role has table or RPC access.
create table public.video_poc_recordings (
  id uuid primary key,
  team_id uuid not null,
  owner_id uuid not null,
  filename text not null check (char_length(filename) between 5 and 240),
  size_bytes bigint not null check (size_bytes between 1 and 9750000000),
  duration_ms integer not null check (duration_ms between 1 and 86400000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'starting' check (status in ('starting', 'uploading', 'completing', 'ready', 'deleting')),
  upload_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  busy_until timestamptz default now() + interval '3 minutes',
  foreign key (team_id, owner_id) references public.team_memberships (team_id, user_id) on delete restrict,
  check (status not in ('uploading', 'completing', 'ready') or upload_id is not null)
);

create index video_poc_owner_idx on public.video_poc_recordings (team_id, owner_id, created_at desc);
alter table public.video_poc_recordings enable row level security;
revoke all on public.video_poc_recordings from public, anon, authenticated;
grant select, insert, update, delete on public.video_poc_recordings to service_role;

-- The lock serializes reservation attempts across this DEV database. Rows stay
-- charged through completion and cleanup, then deletion releases the bytes.
create function public.video_poc_reserve(
  p_id uuid, p_team uuid, p_owner uuid, p_filename text, p_size bigint,
  p_duration integer, p_sha256 text, p_cap bigint
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  existing public.video_poc_recordings;
  total bigint;
  recording_count bigint;
begin
  if not exists (
    select 1 from public.team_memberships m join public.teams t on t.id = m.team_id
    where m.team_id = p_team and m.user_id = p_owner and m.active and t.active and m.role = 'admin'
  ) then
    return jsonb_build_object('result', 'forbidden');
  end if;

  perform pg_advisory_xact_lock(771911, 1);
  select * into existing from public.video_poc_recordings where id = p_id;
  if found then
    if existing.team_id <> p_team or existing.owner_id <> p_owner or existing.filename <> p_filename
      or existing.size_bytes <> p_size or existing.duration_ms <> p_duration or existing.sha256 <> p_sha256 then
      return jsonb_build_object('result', 'conflict');
    end if;
    return jsonb_build_object('result', 'existing', 'row', to_jsonb(existing));
  end if;

  select coalesce(sum(size_bytes), 0), count(*) into total, recording_count from public.video_poc_recordings;
  if recording_count >= 20 or p_cap not between 1 and 9750000000 or p_size > p_cap - total then
    return jsonb_build_object('result', 'quota');
  end if;

  insert into public.video_poc_recordings (id, team_id, owner_id, filename, size_bytes, duration_ms, sha256)
    values (p_id, p_team, p_owner, p_filename, p_size, p_duration, p_sha256) returning * into existing;
  return jsonb_build_object('result', 'created', 'row', to_jsonb(existing));
end;
$$;

revoke all on function public.video_poc_reserve(uuid, uuid, uuid, text, bigint, integer, text, bigint) from public, anon, authenticated;
grant execute on function public.video_poc_reserve(uuid, uuid, uuid, text, bigint, integer, text, bigint) to service_role;

create function public.video_poc_usage() returns bigint
language sql stable security invoker set search_path = ''
as $$ select coalesce(sum(size_bytes), 0)::bigint from public.video_poc_recordings $$;

revoke all on function public.video_poc_usage() from public, anon, authenticated;
grant execute on function public.video_poc_usage() to service_role;
