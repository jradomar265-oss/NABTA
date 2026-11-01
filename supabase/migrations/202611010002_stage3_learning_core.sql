-- Stage 3: teacher-created classes and lessons, student membership, and saved onboarding.

alter table public.profiles
  add column xp integer not null default 0 check (xp >= 0),
  add column level integer not null default 1 check (level >= 1),
  add column avatar_key text,
  add column onboarding_completed boolean not null default false;

grant update (display_name, avatar_key, onboarding_completed) on public.profiles to authenticated;

create table public.classrooms (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  join_code text not null unique default upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6)),
  created_at timestamptz not null default now()
);

create table public.classroom_memberships (
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (classroom_id, student_id)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  learning_objective text not null default '' check (char_length(learning_objective) <= 500),
  content text not null check (char_length(trim(content)) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lesson_assignments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (lesson_id, classroom_id)
);

create index classroom_memberships_student_id_idx on public.classroom_memberships (student_id);
create index lesson_assignments_classroom_id_idx on public.lesson_assignments (classroom_id);

create function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher'
  );
$$;

create function public.teaches_classroom(classroom uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classrooms
    where id = classroom and teacher_id = auth.uid()
  );
$$;

create function public.is_classroom_member(classroom uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classroom_memberships
    where classroom_id = classroom and student_id = auth.uid()
  );
$$;

alter table public.classrooms enable row level security;
alter table public.classroom_memberships enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_assignments enable row level security;

grant select, insert, update, delete on public.classrooms, public.classroom_memberships, public.lessons, public.lesson_assignments to authenticated;

create policy "Teachers and members can read classrooms"
  on public.classrooms for select to authenticated
  using (teacher_id = auth.uid() or public.is_classroom_member(id));
create policy "Teachers can create classrooms"
  on public.classrooms for insert to authenticated
  with check (teacher_id = auth.uid() and public.is_teacher());
create policy "Teachers can update their classrooms"
  on public.classrooms for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
create policy "Teachers can delete their classrooms"
  on public.classrooms for delete to authenticated
  using (teacher_id = auth.uid());

create policy "Teachers and students can read their memberships"
  on public.classroom_memberships for select to authenticated
  using (student_id = auth.uid() or public.teaches_classroom(classroom_id));

create policy "Teachers can manage memberships"
  on public.classroom_memberships for insert to authenticated
  with check (public.teaches_classroom(classroom_id));
create policy "Teachers can remove memberships"
  on public.classroom_memberships for delete to authenticated
  using (public.teaches_classroom(classroom_id));

create policy "Teachers can manage their lessons"
  on public.lessons for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid() and public.is_teacher());
create policy "Students can read assigned lessons"
  on public.lessons for select to authenticated
  using (exists (
    select 1 from public.lesson_assignments la
    where la.lesson_id = id and public.is_classroom_member(la.classroom_id)
  ));

create policy "Teachers and members can read assignments"
  on public.lesson_assignments for select to authenticated
  using (public.teaches_classroom(classroom_id) or public.is_classroom_member(classroom_id));
create policy "Teachers can create assignments for their classes"
  on public.lesson_assignments for insert to authenticated
  with check (
    public.teaches_classroom(classroom_id)
    and exists (select 1 from public.lessons where id = lesson_id and teacher_id = auth.uid())
  );
create policy "Teachers can remove assignments from their classes"
  on public.lesson_assignments for delete to authenticated
  using (public.teaches_classroom(classroom_id));

create function public.join_classroom_by_code(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_classroom uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'student') then
    raise exception 'Only student accounts can join a class';
  end if;

  select id into selected_classroom
  from public.classrooms
  where join_code = upper(trim(p_join_code));

  if selected_classroom is null then
    raise exception 'Class code not found';
  end if;

  insert into public.classroom_memberships (classroom_id, student_id)
  values (selected_classroom, auth.uid())
  on conflict do nothing;

  return selected_classroom;
end;
$$;

grant execute on function public.join_classroom_by_code(text) to authenticated;

create trigger lessons_updated_at
  before update on public.lessons
  for each row execute procedure public.set_profile_updated_at();
