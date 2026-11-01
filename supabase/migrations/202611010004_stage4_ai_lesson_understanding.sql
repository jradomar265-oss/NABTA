-- Stage 4: AI lesson understanding.
--
-- Two tables: `agent_runs` records every analysis attempt (success or failure, so a
-- failed call can never look like a success) and `lesson_objectives` stores the
-- structured result for teacher review. Nothing here publishes anything: an
-- objective only reaches students once a teacher marks it approved.

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id uuid references public.lessons (id) on delete cascade,
  kind text not null default 'lesson_analysis' check (kind in ('lesson_analysis')),
  provider text not null,
  model text not null default '',
  status text not null check (status in ('succeeded', 'failed')),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  input_chars integer not null default 0 check (input_chars >= 0),
  objective_count integer not null default 0 check (objective_count >= 0),
  repaired boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index agent_runs_teacher_idx on public.agent_runs (teacher_id, created_at desc);
create index agent_runs_lesson_idx on public.agent_runs (lesson_id);

create table public.lesson_objectives (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null default 0,
  statement text not null check (char_length(trim(statement)) between 5 and 500),
  skills text[] not null default '{}',
  evidence text not null default '' check (char_length(evidence) <= 300),
  source text not null default 'ai' check (source in ('ai', 'teacher')),
  approved boolean not null default false,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lesson_objectives_lesson_idx on public.lesson_objectives (lesson_id, position);
create index lesson_objectives_approved_idx on public.lesson_objectives (lesson_id) where approved;

alter table public.agent_runs enable row level security;
alter table public.lesson_objectives enable row level security;

revoke all on table public.agent_runs, public.lesson_objectives from anon, authenticated;
grant select, insert, update, delete on table public.agent_runs, public.lesson_objectives to authenticated;

-- Runs: a teacher sees and writes only their own.
create policy "Teachers read their own agent runs"
  on public.agent_runs for select to authenticated
  using (teacher_id = (select auth.uid()));

create policy "Teachers record their own agent runs"
  on public.agent_runs for insert to authenticated
  with check (teacher_id = (select auth.uid()) and public.is_teacher());

create policy "Teachers delete their own agent runs"
  on public.agent_runs for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- Objectives: teacher-owned, and readable by students only once approved.
create policy "Teachers manage their own objectives"
  on public.lesson_objectives for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (
    teacher_id = (select auth.uid())
    and public.is_teacher()
    and exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid()))
  );

create policy "Students read approved objectives for assigned lessons"
  on public.lesson_objectives for select to authenticated
  using (
    approved
    and exists (
      select 1
      from public.lesson_assignments la
      where la.lesson_id = lesson_id and public.is_classroom_member(la.classroom_id)
    )
  );

create trigger lesson_objectives_updated_at
  before update on public.lesson_objectives
  for each row execute procedure public.set_profile_updated_at();
