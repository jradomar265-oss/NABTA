-- ============================================================================
--  NABTA - consolidated schema bundle
--  supabase/apply_all.sql
-- ============================================================================
--
--  WHAT THIS IS
--    One file that brings a Supabase project up to the current schema without
--    having to remember the order of the numbered migrations. It is every file
--    in `supabase/migrations/`, in filename order, rewritten so that each
--    statement is safe to run again.
--
--  SOURCE OF TRUTH
--    The individual files in `supabase/migrations/` remain the source of truth.
--    This bundle is a convenience copy for hand-application (SQL editor, a fresh
--    staging project, a local database). When a migration is added or changed,
--    regenerate this file from it. Do not design schema changes here first.
--
--  IDEMPOTENT
--    Safe on an empty database, on a partially migrated one (for example with
--    202611010001 through 202611010008 applied and 202611010009 through
--    202611010011 not), and on a fully migrated one. Re-running it changes
--    nothing and raises no "already exists" errors.
--
--  WHAT IT DOES NOT DO
--    * It does not drop data, truncate, reset, or delete anything.
--    * It does not undo, revert, or re-version any migration.
--    * It does not repair a database that has drifted from the migrations.
--      `create table if not exists` keeps an existing table as it is, and an
--      inline column CHECK is only created together with its column. If a
--      project has diverged, diff it against `supabase/migrations/` first.
--    * It does not create the `auth` schema, the `anon`/`authenticated` roles,
--      or `auth.uid()`; those are provided by Supabase.
--
--  HOW TO RUN
--    Paste the whole file into the Supabase SQL editor and run it as one batch.
--    PostgreSQL runs a multi-statement script in a single transaction, so a
--    failure rolls the whole run back and leaves the database as it was.
--
--  WHAT IT CREATES, IN DEPENDENCY ORDER
--
--    #   source migration (supabase/migrations/)          creates
--    --  -----------------------------------------------  --------------------------------------
--    1   202611010001_profiles.sql                        type app_role; table profiles;
--                                                         fns handle_new_user, set_profile_updated_at;
--                                                         trgs on_auth_user_created, profiles_updated_at
--    2   202611010002_stage3_learning_core.sql            tables classrooms, classroom_memberships,
--                                                         lessons, lesson_assignments;
--                                                         fns is_teacher, teaches_classroom,
--                                                         is_classroom_member, join_classroom_by_code;
--                                                         trg lessons_updated_at
--    3   202611010003_lesson_study_progress.sql           table lesson_study_progress;
--                                                         fn mark_lesson_studied
--    4   202611010004_stage4_ai_lesson_understanding.sql  tables agent_runs, lesson_objectives;
--                                                         fns assert_answer_in_range,
--                                                         assert_existing_answers_in_range;
--                                                         trg lesson_objectives_updated_at
--    5   202611010005_stage5_challenges.sql               tables assessments, questions, answer_keys;
--                                                         trgs answer_keys_in_range,
--                                                         questions_answers_in_range,
--                                                         assessments_updated_at
--    6   202611010006_stage6_study_quests.sql             tables submissions, student_answers,
--                                                         xp_transactions, achievements;
--                                                         fns xp_for_questions, level_for_xp,
--                                                         submit_challenge
--    7   202611010007_stage7_learning_analysis.sql        table learning_analyses
--    8   202611010008_stage8_companion.sql                table companion_messages
--    9   202611010009_stage8_interventions.sql            table interventions;
--                                                         assessments uniqueness moves to (lesson_id, kind)
--    10  202611010010_stage9_comparability.sql            questions.difficulty;
--                                                         interventions.scope, interventions.student_id
--    11  202611010011_fix_student_lessons_policy.sql      recreates lessons policy
--                                                         "Students can read assigned lessons"
--                                                         with an explicit outer qualifier
--
--    Row level security is enabled on every table and every table gets explicit
--    grants. There are 39 distinct policies; each is named at the head of the
--    section that creates it. Stage 11 replaces one of those names, so that
--    single `create policy` appears twice - always right after its own drop.
--
-- ============================================================================


-- ============================================================================
-- 1/11 - 202611010001_profiles.sql
-- Role enum, one profile row per auth user, and the triggers that keep it fresh.
--
-- Policies (2):
--   profiles: "Users can read their own profile"
--             "Users can update their own display name"
-- ============================================================================

-- `create type` has no `if not exists`, so tolerate the duplicate here. If the
-- type exists its labels are left untouched.
do $$
begin
  create type public.app_role as enum ('student', 'teacher');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'student',
  display_name text not null default 'Student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(trim(display_name)) between 1 and 80)
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their own display name" on public.profiles;
create policy "Users can update their own display name"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Signup materialises the profile row. SECURITY DEFINER with an empty search_path
-- so the trigger runs with the definer's rights but resolves every name explicitly.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name)
  values (
    new.id,
    'student',
    coalesce(
      nullif(trim(left(new.raw_user_meta_data ->> 'display_name', 80)), ''),
      nullif(trim(left(split_part(coalesce(new.email, ''), '@', 1), 80)), ''),
      'Student'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Shared touch trigger body, reused by every table with an `updated_at` column.
create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_profile_updated_at();


-- ============================================================================
-- 2/11 - 202611010002_stage3_learning_core.sql
-- Teacher-created classes and lessons, student membership, saved onboarding.
--
-- Policies (12):
--   classrooms:            "Teachers and members can read classrooms"
--                          "Teachers can create classrooms"
--                          "Teachers can update their classrooms"
--                          "Teachers can delete their classrooms"
--   classroom_memberships: "Teachers and students can read their memberships"
--                          "Teachers can manage memberships"
--                          "Teachers can remove memberships"
--   lessons:               "Teachers can manage their lessons"
--                          "Students can read assigned lessons"  <- replaced in stage 11
--   lesson_assignments:    "Teachers and members can read assignments"
--                          "Teachers can create assignments for their classes"
--                          "Teachers can remove assignments from their classes"
-- ============================================================================

-- `if not exists` per clause: an existing column keeps its original definition
-- and its inline CHECK, which is created only together with the column.
alter table public.profiles
  add column if not exists xp integer not null default 0 check (xp >= 0),
  add column if not exists level integer not null default 1 check (level >= 1),
  add column if not exists avatar_key text,
  add column if not exists onboarding_completed boolean not null default false;

grant update (display_name, avatar_key, onboarding_completed) on public.profiles to authenticated;

create table if not exists public.classrooms (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  join_code text not null unique default upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6)),
  created_at timestamptz not null default now()
);

create table if not exists public.classroom_memberships (
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (classroom_id, student_id)
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  learning_objective text not null default '' check (char_length(learning_objective) <= 500),
  content text not null check (char_length(trim(content)) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_assignments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (lesson_id, classroom_id)
);

create index if not exists classroom_memberships_student_id_idx on public.classroom_memberships (student_id);
create index if not exists lesson_assignments_classroom_id_idx on public.lesson_assignments (classroom_id);

-- Policy helpers. SECURITY DEFINER so that a policy on one table can read another
-- table without the caller needing a grant on it; search_path is pinned empty.
create or replace function public.is_teacher()
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

create or replace function public.teaches_classroom(classroom uuid)
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

create or replace function public.is_classroom_member(classroom uuid)
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

drop policy if exists "Teachers and members can read classrooms" on public.classrooms;
create policy "Teachers and members can read classrooms"
  on public.classrooms for select to authenticated
  using (teacher_id = auth.uid() or public.is_classroom_member(id));
drop policy if exists "Teachers can create classrooms" on public.classrooms;
create policy "Teachers can create classrooms"
  on public.classrooms for insert to authenticated
  with check (teacher_id = auth.uid() and public.is_teacher());
drop policy if exists "Teachers can update their classrooms" on public.classrooms;
create policy "Teachers can update their classrooms"
  on public.classrooms for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
drop policy if exists "Teachers can delete their classrooms" on public.classrooms;
create policy "Teachers can delete their classrooms"
  on public.classrooms for delete to authenticated
  using (teacher_id = auth.uid());

drop policy if exists "Teachers and students can read their memberships" on public.classroom_memberships;
create policy "Teachers and students can read their memberships"
  on public.classroom_memberships for select to authenticated
  using (student_id = auth.uid() or public.teaches_classroom(classroom_id));

drop policy if exists "Teachers can manage memberships" on public.classroom_memberships;
create policy "Teachers can manage memberships"
  on public.classroom_memberships for insert to authenticated
  with check (public.teaches_classroom(classroom_id));
drop policy if exists "Teachers can remove memberships" on public.classroom_memberships;
create policy "Teachers can remove memberships"
  on public.classroom_memberships for delete to authenticated
  using (public.teaches_classroom(classroom_id));

drop policy if exists "Teachers can manage their lessons" on public.lessons;
create policy "Teachers can manage their lessons"
  on public.lessons for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid() and public.is_teacher());
drop policy if exists "Students can read assigned lessons" on public.lessons;
create policy "Students can read assigned lessons"
  on public.lessons for select to authenticated
  using (exists (
    select 1 from public.lesson_assignments la
    where la.lesson_id = id and public.is_classroom_member(la.classroom_id)
  ));

drop policy if exists "Teachers and members can read assignments" on public.lesson_assignments;
create policy "Teachers and members can read assignments"
  on public.lesson_assignments for select to authenticated
  using (public.teaches_classroom(classroom_id) or public.is_classroom_member(classroom_id));
drop policy if exists "Teachers can create assignments for their classes" on public.lesson_assignments;
create policy "Teachers can create assignments for their classes"
  on public.lesson_assignments for insert to authenticated
  with check (
    public.teaches_classroom(classroom_id)
    and exists (select 1 from public.lessons where id = lesson_id and teacher_id = auth.uid())
  );
drop policy if exists "Teachers can remove assignments from their classes" on public.lesson_assignments;
create policy "Teachers can remove assignments from their classes"
  on public.lesson_assignments for delete to authenticated
  using (public.teaches_classroom(classroom_id));

-- Join by code is the only way a student writes a membership row; the function
-- verifies the role, so the client never supplies a classroom or student id.
create or replace function public.join_classroom_by_code(p_join_code text)
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

drop trigger if exists lessons_updated_at on public.lessons;
create trigger lessons_updated_at
  before update on public.lessons
  for each row execute procedure public.set_profile_updated_at();


-- ============================================================================
-- 3/11 - 202611010003_lesson_study_progress.sql
-- Per-student quest progress for the learning world.
--
-- A quest is a lesson assignment. Students can only record a *study* step here;
-- mastery completion requires graded assessment evidence and is intentionally not
-- writable in this stage. Nothing in this migration lets a client set 'completed'
-- or award XP.
--
-- Policies (2):
--   lesson_study_progress: "Students read their own study progress"
--                          "Teachers read study progress for their classes"
-- ============================================================================

create table if not exists public.lesson_study_progress (
  student_id uuid not null references public.profiles (id) on delete cascade,
  assignment_id uuid not null references public.lesson_assignments (id) on delete cascade,
  studied_at timestamptz not null default now(),
  primary key (student_id, assignment_id)
);

create index if not exists lesson_study_progress_student_idx on public.lesson_study_progress (student_id);

alter table public.lesson_study_progress enable row level security;

revoke all on table public.lesson_study_progress from anon, authenticated;
grant select on table public.lesson_study_progress to authenticated;

drop policy if exists "Students read their own study progress" on public.lesson_study_progress;
create policy "Students read their own study progress"
  on public.lesson_study_progress for select to authenticated
  using (student_id = (select auth.uid()));

drop policy if exists "Teachers read study progress for their classes" on public.lesson_study_progress;
create policy "Teachers read study progress for their classes"
  on public.lesson_study_progress for select to authenticated
  using (exists (
    select 1
    from public.lesson_assignments la
    join public.classrooms c on c.id = la.classroom_id
    where la.id = assignment_id and c.teacher_id = (select auth.uid())
  ));

-- The only write path: a student marks a lesson they are assigned and enrolled in.
create or replace function public.mark_lesson_studied(p_assignment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can record lesson study';
  end if;

  if not exists (
    select 1
    from public.lesson_assignments la
    join public.classroom_memberships m on m.classroom_id = la.classroom_id
    where la.id = p_assignment and m.student_id = auth.uid()
  ) then
    raise exception 'Lesson is not assigned to this student';
  end if;

  insert into public.lesson_study_progress (student_id, assignment_id)
  values (auth.uid(), p_assignment)
  on conflict (student_id, assignment_id) do nothing;
end;
$$;

grant execute on function public.mark_lesson_studied(uuid) to authenticated;


-- ============================================================================
-- 4/11 - 202611010004_stage4_ai_lesson_understanding.sql
-- AI lesson understanding.
--
-- Two tables: `agent_runs` records every analysis attempt (success or failure, so
-- a failed call can never look like a success) and `lesson_objectives` stores the
-- structured result for teacher review. Nothing here publishes anything: an
-- objective only reaches students once a teacher marks it approved.
--
-- Policies (5):
--   agent_runs:        "Teachers read their own agent runs"
--                      "Teachers record their own agent runs"
--                      "Teachers delete their own agent runs"
--   lesson_objectives: "Teachers manage their own objectives"
--                      "Students read approved objectives for assigned lessons"
-- ============================================================================

create table if not exists public.agent_runs (
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

create index if not exists agent_runs_teacher_idx on public.agent_runs (teacher_id, created_at desc);
create index if not exists agent_runs_lesson_idx on public.agent_runs (lesson_id);

create table if not exists public.lesson_objectives (
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

create index if not exists lesson_objectives_lesson_idx on public.lesson_objectives (lesson_id, position);
create index if not exists lesson_objectives_approved_idx on public.lesson_objectives (lesson_id) where approved;

alter table public.agent_runs enable row level security;
alter table public.lesson_objectives enable row level security;

revoke all on table public.agent_runs, public.lesson_objectives from anon, authenticated;
grant select, insert, update, delete on table public.agent_runs, public.lesson_objectives to authenticated;

-- Runs: a teacher sees and writes only their own.
drop policy if exists "Teachers read their own agent runs" on public.agent_runs;
create policy "Teachers read their own agent runs"
  on public.agent_runs for select to authenticated
  using (teacher_id = (select auth.uid()));

drop policy if exists "Teachers record their own agent runs" on public.agent_runs;
create policy "Teachers record their own agent runs"
  on public.agent_runs for insert to authenticated
  with check (teacher_id = (select auth.uid()) and public.is_teacher());

drop policy if exists "Teachers delete their own agent runs" on public.agent_runs;
create policy "Teachers delete their own agent runs"
  on public.agent_runs for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- Objectives: teacher-owned, and readable by students only once approved.
drop policy if exists "Teachers manage their own objectives" on public.lesson_objectives;
create policy "Teachers manage their own objectives"
  on public.lesson_objectives for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (
    teacher_id = (select auth.uid())
    and public.is_teacher()
    and exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid()))
  );

drop policy if exists "Students read approved objectives for assigned lessons" on public.lesson_objectives;
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

drop trigger if exists lesson_objectives_updated_at on public.lesson_objectives;
create trigger lesson_objectives_updated_at
  before update on public.lesson_objectives
  for each row execute procedure public.set_profile_updated_at();


-- ============================================================================
-- 5/11 - 202611010005_stage5_challenges.sql
-- AI challenge generation and publishing.
--
-- The answer key is structurally separate from the question. `questions.options`
-- is a plain array of strings with no correctness flag, so a leaked question row
-- cannot reveal the answer; correctness lives only in `answer_keys`, which has no
-- student policy at all and is therefore invisible to students at the row level.
--
-- Policies (5):
--   assessments: "Teachers manage their own assessments"
--                "Students read published assessments for assigned lessons"
--   questions:   "Teachers manage questions on their own assessments"
--                "Students read questions of published assessments"
--   answer_keys: "Teachers manage answer keys on their own assessments"
-- ============================================================================

-- `agent_runs` already exists from Stage 4. Its kind CHECK was created inline and
-- is therefore auto-named agent_runs_kind_check; the original file drops that name
-- and re-adds it with the wider value list.
--
-- Re-adding it unconditionally is NOT safe to repeat: a narrower CHECK is
-- validated against existing rows, so on a database that already stores a kind
-- introduced by a later stage the ALTER would fail. So the replacement only runs
-- when the current constraint does not already allow the value added here. The
-- value lists only ever grow, so the final definition is the same either way.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agent_runs'::regclass
      and conname = 'agent_runs_kind_check'
      and pg_get_constraintdef(oid) like '%challenge_generation%'
  ) then
    alter table public.agent_runs drop constraint if exists agent_runs_kind_check;
    alter table public.agent_runs add constraint agent_runs_kind_check
      check (kind in ('lesson_analysis', 'challenge_generation'));
  end if;
end $$;

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  status text not null default 'draft' check (status in ('draft', 'approved', 'published')),
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  published_at timestamptz,
  unique (lesson_id)
);

create index if not exists assessments_teacher_idx on public.assessments (teacher_id);
create index if not exists assessments_published_idx on public.assessments (lesson_id) where status = 'published';

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  position integer not null default 0,
  kind text not null default 'multiple_choice' check (kind in ('multiple_choice', 'true_false')),
  prompt text not null check (char_length(trim(prompt)) between 5 and 600),
  -- No `is_correct` column by design: correctness lives in answer_keys only.
  options text[] not null check (array_length(options, 1) between 2 and 6),
  objective_id uuid references public.lesson_objectives (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists questions_assessment_idx on public.questions (assessment_id, position);

create table if not exists public.answer_keys (
  question_id uuid primary key references public.questions (id) on delete cascade,
  correct_index integer not null check (correct_index >= 0),
  explanation text not null default '' check (char_length(explanation) <= 600),
  created_at timestamptz not null default now()
);

-- Integrity: an answer index must point at a real option. Cross-table CHECK is not
-- possible, so this is enforced with triggers on both sides.
create or replace function public.assert_answer_in_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  option_count integer;
begin
  select array_length(options, 1) into option_count
  from public.questions
  where id = new.question_id;

  if option_count is null then
    raise exception 'Answer key references an unknown question';
  end if;

  if new.correct_index >= option_count then
    raise exception 'correct_index % is outside the % available options', new.correct_index, option_count;
  end if;

  return new;
end;
$$;

drop trigger if exists answer_keys_in_range on public.answer_keys;
create trigger answer_keys_in_range
  before insert or update on public.answer_keys
  for each row execute procedure public.assert_answer_in_range();

create or replace function public.assert_existing_answers_in_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.answer_keys
    where question_id = new.id and correct_index >= array_length(new.options, 1)
  ) then
    raise exception 'Shrinking the options would orphan the stored answer key';
  end if;
  return new;
end;
$$;

drop trigger if exists questions_answers_in_range on public.questions;
create trigger questions_answers_in_range
  before update of options on public.questions
  for each row execute procedure public.assert_existing_answers_in_range();

alter table public.assessments enable row level security;
alter table public.questions enable row level security;
alter table public.answer_keys enable row level security;

revoke all on table public.assessments, public.questions, public.answer_keys from anon, authenticated;
grant select, insert, update, delete on public.assessments, public.questions to authenticated;
-- Teacher-only read/write surface for the key; students have no policy at all.
grant select, insert, update, delete on public.answer_keys to authenticated;

-- Assessments
drop policy if exists "Teachers manage their own assessments" on public.assessments;
create policy "Teachers manage their own assessments"
  on public.assessments for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (
    teacher_id = (select auth.uid())
    and public.is_teacher()
    and exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid()))
  );

drop policy if exists "Students read published assessments for assigned lessons" on public.assessments;
create policy "Students read published assessments for assigned lessons"
  on public.assessments for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.lesson_assignments la
      where la.lesson_id = lesson_id and public.is_classroom_member(la.classroom_id)
    )
  );

-- Questions
drop policy if exists "Teachers manage questions on their own assessments" on public.questions;
create policy "Teachers manage questions on their own assessments"
  on public.questions for all to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id and a.teacher_id = (select auth.uid())))
  with check (exists (
    select 1 from public.assessments a
    where a.id = assessment_id and a.teacher_id = (select auth.uid()) and public.is_teacher()
  ));

drop policy if exists "Students read questions of published assessments" on public.questions;
create policy "Students read questions of published assessments"
  on public.questions for select to authenticated
  using (exists (
    select 1 from public.assessments a
    where a.id = assessment_id
      and a.status = 'published'
      and exists (
        select 1 from public.lesson_assignments la
        where la.lesson_id = a.lesson_id and public.is_classroom_member(la.classroom_id)
      )
  ));

-- Answer keys: teachers only. There is deliberately no student policy.
drop policy if exists "Teachers manage answer keys on their own assessments" on public.answer_keys;
create policy "Teachers manage answer keys on their own assessments"
  on public.answer_keys for all to authenticated
  using (exists (
    select 1
    from public.questions q
    join public.assessments a on a.id = q.assessment_id
    where q.id = question_id and a.teacher_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.questions q
    join public.assessments a on a.id = q.assessment_id
    where q.id = question_id and a.teacher_id = (select auth.uid())
  ));

drop trigger if exists assessments_updated_at on public.assessments;
create trigger assessments_updated_at
  before update on public.assessments
  for each row execute procedure public.set_profile_updated_at();


-- ============================================================================
-- 6/11 - 202611010006_stage6_study_quests.sql
-- Student study quests - submissions, server-side grading, XP, achievements.
--
-- Grading happens in this SECURITY DEFINER function and nowhere else. Students have
-- no INSERT/UPDATE grant on submissions, answers, XP or achievements, and cannot
-- read answer_keys, so a score or an XP total cannot be produced or edited by a
-- client.
--
-- Policies (6):
--   submissions:     "Students read their own submissions"
--                    "Teachers read submissions for their classes"
--   student_answers: "Students read their own answers"
--                    "Teachers read answers for their classes"
--   xp_transactions: "Students read their own xp"
--   achievements:    "Students read their own achievements"
-- ============================================================================

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  attempt_no integer not null default 1 check (attempt_no >= 1),
  score integer not null default 0 check (score >= 0),
  total integer not null default 0 check (total >= 0),
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  submitted_at timestamptz not null default now(),
  unique (student_id, assessment_id, attempt_no)
);

create index if not exists submissions_student_idx on public.submissions (student_id, submitted_at desc);
create index if not exists submissions_assessment_idx on public.submissions (assessment_id);

create table if not exists public.student_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  choice_index integer not null check (choice_index >= 0),
  is_correct boolean not null,
  -- Copied at grading time so a student can review their own feedback without ever
  -- being able to read answer_keys. Only exists for a submission they already made.
  correct_index integer not null default 0 check (correct_index >= 0),
  explanation text not null default '',
  unique (submission_id, question_id)
);

create index if not exists student_answers_submission_idx on public.student_answers (submission_id);

create table if not exists public.xp_transactions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount > 0 and amount <= 500),
  reason text not null check (char_length(reason) between 1 and 200),
  source_type text not null check (source_type in ('assessment')),
  source_id uuid not null,
  created_at timestamptz not null default now(),
  -- One award per student per assessment, whatever the client retries.
  unique (student_id, source_type, source_id)
);

create index if not exists xp_transactions_student_idx on public.xp_transactions (student_id, created_at desc);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  code text not null check (code in ('first_quest', 'perfect_score', 'steady_learner')),
  earned_at timestamptz not null default now(),
  unique (student_id, code)
);

create index if not exists achievements_student_idx on public.achievements (student_id);

-- XP rewards understanding, not speed: 6 per correct answer, +10 for a full set.
-- Pure arithmetic: immutable, no table access, so no definer rights and no
-- search_path pin are needed (identical to the original).
create or replace function public.xp_for_questions(p_correct integer, p_total integer)
returns integer
language sql
immutable
as $$
  select case
    when p_total <= 0 or p_correct <= 0 then 0
    when p_correct >= p_total then (p_total * 6) + 10
    else p_correct * 6
  end;
$$;

create or replace function public.level_for_xp(p_xp integer)
returns integer
language sql
immutable
as $$
  select greatest(1, 1 + (greatest(p_xp, 0) / 100));
$$;

alter table public.submissions enable row level security;
alter table public.student_answers enable row level security;
alter table public.xp_transactions enable row level security;
alter table public.achievements enable row level security;

-- Select-only for everyone: rows are written exclusively by submit_challenge().
revoke all on table public.submissions, public.student_answers, public.xp_transactions, public.achievements from anon, authenticated;
grant select on table public.submissions, public.student_answers, public.xp_transactions, public.achievements to authenticated;

drop policy if exists "Students read their own submissions" on public.submissions;
create policy "Students read their own submissions"
  on public.submissions for select to authenticated
  using (student_id = (select auth.uid()));

drop policy if exists "Teachers read submissions for their classes" on public.submissions;
create policy "Teachers read submissions for their classes"
  on public.submissions for select to authenticated
  using (exists (
    select 1
    from public.assessments a
    join public.lesson_assignments la on la.lesson_id = a.lesson_id
    join public.classrooms c on c.id = la.classroom_id
    where a.id = assessment_id and c.teacher_id = (select auth.uid())
  ));

drop policy if exists "Students read their own answers" on public.student_answers;
create policy "Students read their own answers"
  on public.student_answers for select to authenticated
  using (exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.student_id = (select auth.uid())
  ));

drop policy if exists "Teachers read answers for their classes" on public.student_answers;
create policy "Teachers read answers for their classes"
  on public.student_answers for select to authenticated
  using (exists (
    select 1
    from public.submissions s
    join public.assessments a on a.id = s.assessment_id
    join public.lesson_assignments la on la.lesson_id = a.lesson_id
    join public.classrooms c on c.id = la.classroom_id
    where s.id = submission_id and c.teacher_id = (select auth.uid())
  ));

drop policy if exists "Students read their own xp" on public.xp_transactions;
create policy "Students read their own xp"
  on public.xp_transactions for select to authenticated
  using (student_id = (select auth.uid()));

drop policy if exists "Students read their own achievements" on public.achievements;
create policy "Students read their own achievements"
  on public.achievements for select to authenticated
  using (student_id = (select auth.uid()));

/**
 * Grades a submitted challenge and awards XP exactly once.
 *
 * Rejects anything that is not a published challenge assigned to the caller, an
 * incomplete answer set, or an option index outside the question's options.
 */
create or replace function public.submit_challenge(p_assessment uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_lesson uuid;
  v_status text;
  v_question record;
  v_choice integer;
  v_total integer := 0;
  v_score integer := 0;
  v_submission uuid;
  v_attempt integer;
  v_award integer := 0;
  v_awarded integer := 0;
  v_existing integer := 0;
  v_answers jsonb := '{}'::jsonb;
  v_distinct integer := 0;
begin
  if v_student is null then
    raise exception 'You need to be signed in to submit a challenge';
  end if;

  if not exists (select 1 from public.profiles where id = v_student and role = 'student') then
    raise exception 'Only student accounts can submit challenges';
  end if;

  select a.lesson_id, a.status into v_lesson, v_status
  from public.assessments a where a.id = p_assessment;

  if v_lesson is null then
    raise exception 'That challenge could not be found';
  end if;
  if v_status <> 'published' then
    raise exception 'That challenge is not published yet';
  end if;

  if not exists (
    select 1
    from public.lesson_assignments la
    join public.classroom_memberships m on m.classroom_id = la.classroom_id
    where la.lesson_id = v_lesson and m.student_id = v_student
  ) then
    raise exception 'That challenge is not assigned to you';
  end if;

  select count(*) into v_total from public.questions q where q.assessment_id = p_assessment;
  if v_total = 0 then
    raise exception 'That challenge has no questions yet';
  end if;

  select coalesce(max(s.attempt_no), 0) + 1 into v_attempt
  from public.submissions s
  where s.student_id = v_student and s.assessment_id = p_assessment;

  insert into public.submissions (student_id, assessment_id, attempt_no)
  values (v_student, p_assessment, v_attempt)
  returning id into v_submission;

  for v_question in
    select q.id, q.options, k.correct_index, k.explanation
    from public.questions q
    join public.answer_keys k on k.question_id = q.id
    where q.assessment_id = p_assessment
    order by q.position, q.created_at
  loop
    v_choice := null;
    begin
      v_choice := (p_answers ->> (v_question.id::text))::integer;
    exception when others then
      v_choice := null;
    end;

    if v_choice is null
       or v_choice < 0
       or v_choice >= coalesce(array_length(v_question.options, 1), 0) then
      raise exception 'Every question needs a valid answer before submitting';
    end if;

    if v_choice = v_question.correct_index then
      v_score := v_score + 1;
    end if;

    insert into public.student_answers (submission_id, question_id, choice_index, is_correct, correct_index, explanation)
    values (v_submission, v_question.id, v_choice, v_choice = v_question.correct_index, v_question.correct_index, coalesce(v_question.explanation, ''));

    v_answers := v_answers || jsonb_build_object(
      v_question.id::text,
      jsonb_build_object(
        'correctIndex', v_question.correct_index,
        'isCorrect', v_choice = v_question.correct_index,
        'explanation', coalesce(v_question.explanation, '')
      )
    );
  end loop;

  -- XP is awarded once per assessment, even across retakes.
  select count(*) into v_existing
  from public.xp_transactions t
  where t.student_id = v_student and t.source_type = 'assessment' and t.source_id = p_assessment;

  if v_existing = 0 then
    v_award := public.xp_for_questions(v_score, v_total);
    if v_award > 0 then
      insert into public.xp_transactions (student_id, amount, reason, source_type, source_id)
      values (v_student, v_award, 'Challenge completed', 'assessment', p_assessment)
      on conflict (student_id, source_type, source_id) do nothing;

      if found then
        v_awarded := v_award;
        update public.profiles
        set xp = xp + v_award,
            level = public.level_for_xp(xp + v_award)
        where id = v_student;
      end if;
    end if;
  end if;

  update public.submissions
  set score = v_score, total = v_total, xp_awarded = v_awarded
  where id = v_submission;

  -- Studying is implied by submitting, so the world advances either way.
  insert into public.lesson_study_progress (student_id, assignment_id)
  select v_student, la.id
  from public.lesson_assignments la
  where la.lesson_id = v_lesson
  on conflict (student_id, assignment_id) do nothing;

  insert into public.achievements (student_id, code) values (v_student, 'first_quest')
  on conflict (student_id, code) do nothing;

  if v_score = v_total then
    insert into public.achievements (student_id, code) values (v_student, 'perfect_score')
    on conflict (student_id, code) do nothing;
  end if;

  select count(distinct s.assessment_id) into v_distinct
  from public.submissions s where s.student_id = v_student;

  if v_distinct >= 3 then
    insert into public.achievements (student_id, code) values (v_student, 'steady_learner')
    on conflict (student_id, code) do nothing;
  end if;

  return jsonb_build_object(
    'submissionId', v_submission,
    'score', v_score,
    'total', v_total,
    'xpAwarded', v_awarded,
    'answers', v_answers
  );
end;
$$;

grant execute on function public.submit_challenge(uuid, jsonb) to authenticated;


-- ============================================================================
-- 7/11 - 202611010007_stage7_learning_analysis.sql
-- Learning analysis and teacher analytics.
--
-- Two deliberate stores:
--   `evidence_snapshot` - the numbers the analysis was computed from, frozen at the
--     moment of the run. Facts are never regenerated from a later state, so a report
--     can always be audited against what it actually saw.
--   `observations` - the validated model output, kept separate from the facts and
--     labelled by provider so an interpretation can never masquerade as a
--     measurement.
--
-- Policies (3):
--   learning_analyses: "Teachers read their own class analyses"
--                      "Teachers record analyses for their own classes"
--                      "Teachers delete their own analyses"
-- ============================================================================

-- Widened again for the analysis run kind. Same guard as Stage 5: only replace the
-- check when it does not already allow this value, so a re-run never narrows it.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agent_runs'::regclass
      and conname = 'agent_runs_kind_check'
      and pg_get_constraintdef(oid) like '%learning_analysis%'
  ) then
    alter table public.agent_runs drop constraint if exists agent_runs_kind_check;
    alter table public.agent_runs add constraint agent_runs_kind_check
      check (kind in ('lesson_analysis', 'challenge_generation', 'learning_analysis'));
  end if;
end $$;

create table if not exists public.learning_analyses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  lesson_id uuid references public.lessons (id) on delete set null,
  provider text not null,
  model text not null default '',
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  -- What the numbers said. Never AI-authored.
  evidence_snapshot jsonb not null,
  -- What the model concluded, already schema-validated.
  observations jsonb not null,
  insufficient_evidence boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists learning_analyses_classroom_idx on public.learning_analyses (classroom_id, created_at desc);
create index if not exists learning_analyses_teacher_idx on public.learning_analyses (teacher_id, created_at desc);

alter table public.learning_analyses enable row level security;

revoke all on table public.learning_analyses from anon, authenticated;
grant select, insert, delete on table public.learning_analyses to authenticated;

drop policy if exists "Teachers read their own class analyses" on public.learning_analyses;
create policy "Teachers read their own class analyses"
  on public.learning_analyses for select to authenticated
  using (teacher_id = (select auth.uid()));

drop policy if exists "Teachers record analyses for their own classes" on public.learning_analyses;
create policy "Teachers record analyses for their own classes"
  on public.learning_analyses for insert to authenticated
  with check (
    teacher_id = (select auth.uid())
    and public.is_teacher()
    and public.teaches_classroom(classroom_id)
  );

drop policy if exists "Teachers delete their own analyses" on public.learning_analyses;
create policy "Teachers delete their own analyses"
  on public.learning_analyses for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- No student policy at all: interpretation is a teacher-facing artefact. Students get
-- their own progress from their own answers, computed, never from this table.


-- ============================================================================
-- 8/11 - 202611010008_stage8_companion.sql
-- The AI Learning Companion.
--
-- A student asks a question about the lesson they are studying and gets a grounded
-- explanation. Three constraints are structural, not stylistic:
--   * a student can only write rows about themselves, in a lesson assigned to a
--     class they belong to;
--   * the transcript is readable by the teacher who teaches that class, because
--     adult oversight of AI conversations with minors is not optional;
--   * nothing here can award XP or mark work complete - this is support, not
--     evidence.
--
-- Policies (3):
--   companion_messages: "Students read their own companion thread"
--                       "Students ask about their own assigned lesson"
--                       "Teachers read companion threads for their classes"
-- ============================================================================

create table if not exists public.companion_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  assignment_id uuid not null references public.lesson_assignments (id) on delete cascade,
  question text not null check (char_length(trim(question)) between 3 and 600),
  answer text not null check (char_length(trim(answer)) between 1 and 3000),
  -- True when the companion declined because the question was outside the lesson.
  refused boolean not null default false,
  provider text not null,
  model text not null default '',
  context_missing boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists companion_messages_student_idx on public.companion_messages (student_id, created_at desc);
create index if not exists companion_messages_lesson_idx on public.companion_messages (lesson_id, created_at desc);

alter table public.companion_messages enable row level security;

revoke all on table public.companion_messages from anon, authenticated;
-- Students may read their own thread and append to it; they may never edit or delete
-- an answer that has already been given.
grant select, insert on table public.companion_messages to authenticated;

drop policy if exists "Students read their own companion thread" on public.companion_messages;
create policy "Students read their own companion thread"
  on public.companion_messages for select to authenticated
  using (student_id = (select auth.uid()));

drop policy if exists "Students ask about their own assigned lesson" on public.companion_messages;
create policy "Students ask about their own assigned lesson"
  on public.companion_messages for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and exists (
      select 1
      from public.lesson_assignments la
      join public.classroom_memberships m on m.classroom_id = la.classroom_id
      where la.id = assignment_id
        and la.lesson_id = lesson_id
        and m.student_id = (select auth.uid())
    )
  );

-- Oversight: a teacher sees the companion conversations in their own classes.
drop policy if exists "Teachers read companion threads for their classes" on public.companion_messages;
create policy "Teachers read companion threads for their classes"
  on public.companion_messages for select to authenticated
  using (exists (
    select 1
    from public.lesson_assignments la
    join public.classrooms c on c.id = la.classroom_id
    where la.id = assignment_id and c.teacher_id = (select auth.uid())
  ));


-- ============================================================================
-- 9/11 - 202611010009_stage8_interventions.sql
-- Interventions and follow-up evidence.
--
-- Option (a): assessments gain a `kind`, and uniqueness moves from `lesson_id` to
-- `(lesson_id, kind)`. That keeps one grading path, one answer-key table and one
-- XP-once rule, while storing initial challenges, targeted practice and follow-up
-- checks as separate rows - so follow-up evidence can never be confused with the
-- original attempt.
--
-- Policies (1):
--   interventions: "Teachers manage interventions for their own classes"
-- ============================================================================

alter table public.assessments
  add column if not exists kind text not null default 'challenge'
  check (kind in ('challenge', 'practice', 'follow_up'));

-- One assessment per lesson per kind.
--
-- The original drops the inline `unique (lesson_id)` constraint (auto-named
-- assessments_lesson_id_key) and adds the composite one. Both names are dropped
-- first so a re-run cannot collide with an existing composite constraint, and
-- re-adding is safe against existing rows: any data that satisfied
-- unique(lesson_id) also satisfies unique(lesson_id, kind).
alter table public.assessments drop constraint if exists assessments_lesson_id_key;
alter table public.assessments drop constraint if exists assessments_lesson_kind_key;
alter table public.assessments add constraint assessments_lesson_kind_key unique (lesson_id, kind);

create index if not exists assessments_lesson_kind_idx on public.assessments (lesson_id, kind);

-- Widened once more for intervention generation. Same guard as Stages 5 and 7.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agent_runs'::regclass
      and conname = 'agent_runs_kind_check'
      and pg_get_constraintdef(oid) like '%intervention_generation%'
  ) then
    alter table public.agent_runs drop constraint if exists agent_runs_kind_check;
    alter table public.agent_runs add constraint agent_runs_kind_check
      check (kind in ('lesson_analysis', 'challenge_generation', 'learning_analysis', 'intervention_generation'));
  end if;
end $$;

create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  classroom_id uuid not null references public.classrooms (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  objective_id uuid references public.lesson_objectives (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  rationale text not null default '' check (char_length(rationale) <= 1000),
  -- Approval is mandatory and enforced by the actions: draft -> approved -> assigned.
  status text not null default 'draft' check (status in ('draft', 'approved', 'assigned')),
  practice_assessment_id uuid references public.assessments (id) on delete set null,
  follow_up_assessment_id uuid references public.assessments (id) on delete set null,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  assigned_at timestamptz
);

create index if not exists interventions_classroom_idx on public.interventions (classroom_id, created_at desc);
create index if not exists interventions_teacher_idx on public.interventions (teacher_id, created_at desc);

alter table public.interventions enable row level security;

revoke all on table public.interventions from anon, authenticated;
grant select, insert, update, delete on table public.interventions to authenticated;

drop policy if exists "Teachers manage interventions for their own classes" on public.interventions;
create policy "Teachers manage interventions for their own classes"
  on public.interventions for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (
    teacher_id = (select auth.uid())
    and public.is_teacher()
    and public.teaches_classroom(classroom_id)
  );

-- No student policy: students never read the intervention record. They reach the
-- practice and follow-up assessments, which carry their own publication rules.


-- ============================================================================
-- 10/11 - 202611010010_stage9_comparability.sql
-- What a comparability check needs to be honest about.
--
-- Two additions, both nullable so existing rows stay valid:
--   * `questions.difficulty` - a label the generator records, so two assessments can
--     be compared on their mix instead of pretending that is psychometric evidence;
--   * `interventions.scope` - a class-wide intervention is not the same thing as one
--     aimed at a single student's gap, and the data should say which one it is.
-- ============================================================================

alter table public.questions
  add column if not exists difficulty text
  check (difficulty in ('easy', 'medium', 'hard'));

create index if not exists questions_difficulty_idx on public.questions (assessment_id, difficulty);

alter table public.interventions
  add column if not exists scope text not null default 'class'
  check (scope in ('class', 'student'));

-- Reserved for per-student interventions; unused while scope stays 'class'.
alter table public.interventions
  add column if not exists student_id uuid references public.profiles (id) on delete cascade;

-- Dropping before adding is safe here as well: any row that already satisfied the
-- constraint still satisfies it, so the re-validation cannot fail.
alter table public.interventions drop constraint if exists interventions_student_scope_check;
alter table public.interventions add constraint interventions_student_scope_check
  check (
    (scope = 'class' and student_id is null)
    or (scope = 'student' and student_id is not null)
  );


-- ============================================================================
-- 11/11 - 202611010011_fix_student_lessons_policy.sql
-- Fix an over-restrictive RLS policy on `lessons`.
--
-- Stage 2 created "Students can read assigned lessons" with an unqualified `id`:
-- inside the subquery that name resolves against `lesson_assignments`, which has
-- its own `id` column, so the comparison became `la.lesson_id = la.id` instead of
-- `la.lesson_id = lessons.id`. A student could only read a lesson whose assignment
-- id happened to equal the lesson id - effectively never. Any query that embedded
-- `lessons(...)` from an assignment returned null content.
--
-- Qualifying the outer column fixes it. This does not widen access: a student still
-- only reads lessons assigned to a class they belong to.
--
-- Policies (1, replacing the stage 2 version):
--   lessons: "Students can read assigned lessons"
-- ============================================================================

-- Idempotent as written: drop-if-exists then recreate under the same name, so the
-- policy count is unchanged. This is the only `create policy` that appears twice in
-- the bundle, and the second occurrence must always follow the first.
drop policy if exists "Students can read assigned lessons" on public.lessons;

create policy "Students can read assigned lessons"
  on public.lessons for select to authenticated
  using (exists (
    select 1
    from public.lesson_assignments la
    where la.lesson_id = public.lessons.id
      and public.is_classroom_member(la.classroom_id)
  ));
