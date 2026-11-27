-- Optional DEV-only fixture. Creates no Supabase Auth users or credentials.
insert into public.teams (id, name) values
  ('3e5d1e3d-2d06-460b-86b7-ac47af63a600', 'Training XI'),
  ('c909f9f4-e896-4be1-aacb-9c2d10a595ff', 'Opposition XI')
on conflict (id) do nothing;
