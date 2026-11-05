-- Full-product Stage 2a: the world becomes data, not a hardcoded array.
--
-- Two tables only. `quest_nodes` is deliberately NOT created yet: node-to-lesson
-- binding depends on the loader's mapping rule, which is the next step, and inventing
-- the table now would fix a shape before the code that uses it exists.
--
-- Design notes
--   * World structure is authored content, identical for every student. It is therefore
--     read-only to `authenticated` and has NO student or teacher write path: rows arrive
--     through migrations. Selling per-class ownership of a shared map is a Stage 4
--     question, not one to guess at here.
--   * No per-student world state is stored. Node state is derived from
--     lesson_study_progress, submissions and assessments, because a stored copy drifts
--     from the truth and the vision requires progress to back the world, not decorate it.
--   * Coordinates are percentages of the region canvas (0-100), so the layout survives
--     any viewport and any terrain resolution.

create table if not exists public.world_regions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  art_key text not null check (art_key ~ '^[a-z0-9-]{2,40}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.world_locations (
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.world_regions (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  kind text not null default 'lesson'
    check (kind in ('lesson', 'milestone', 'arena', 'shrine', 'discovery')),
  -- Coordinates as percentages of the region canvas.
  x real not null check (x >= 0 and x <= 100),
  y real not null check (y >= 0 and y <= 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (region_id, key)
);

create index if not exists world_locations_region_idx on public.world_locations (region_id, sort_order);

alter table public.world_regions enable row level security;
alter table public.world_locations enable row level security;

-- Read-only for every signed-in user. No write policies exist, so no client can mutate
-- the map: an INSERT would be rejected by RLS with no matching policy.
drop policy if exists "Signed-in users can read world regions" on public.world_regions;
create policy "Signed-in users can read world regions"
  on public.world_regions for select to authenticated
  using (true);

drop policy if exists "Signed-in users can read world locations" on public.world_locations;
create policy "Signed-in users can read world locations"
  on public.world_locations for select to authenticated
  using (true);

revoke all on public.world_regions, public.world_locations from anon;
grant select on public.world_regions, public.world_locations to authenticated;

-- The first region: the reference image's forest clearing. Six named places along the
-- S-curve path, in the order the reference presents them.
insert into public.world_regions (key, name, art_key, sort_order)
values ('forest-clearing', 'Forest Clearing', 'forest-clearing', 0)
on conflict (key) do nothing;

insert into public.world_locations (region_id, key, name, kind, x, y, sort_order)
select r.id, v.key, v.name, v.kind, v.x, v.y, v.sort_order
from public.world_regions r
cross join (values
  ('trailhead',  'Trailhead',        'lesson',    46.0, 84.0, 0),
  ('cabin',      'Learning Cabin',   'lesson',    38.0, 62.0, 1),
  ('bridge',     'River Crossing',   'lesson',    52.0, 46.0, 2),
  ('grove',      'Blossom Grove',    'discovery', 63.0, 33.0, 3),
  ('falls',      'Cascade Falls',    'lesson',    78.0, 20.0, 4),
  ('gate',       'Knowledge Shrine', 'milestone', 86.0, 10.0, 5)
) as v(key, name, kind, x, y, sort_order)
where r.key = 'forest-clearing'
on conflict (region_id, key) do nothing;
