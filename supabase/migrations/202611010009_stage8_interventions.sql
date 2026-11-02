-- Stage 8 (part 2): interventions and follow-up evidence.
--
-- Option (a): assessments gain a `kind`, and uniqueness moves from `lesson_id` to
-- `(lesson_id, kind)`. That keeps one grading path, one answer-key table and one
-- XP-once rule, while storing initial challenges, targeted practice and follow-up
-- checks as separate rows — so follow-up evidence can never be confused with the
-- original attempt.

alter table public.assessments
  add column kind text not null default 'challenge'
  check (kind in ('challenge', 'practice', 'follow_up'));

-- One assessment per lesson per kind.
alter table public.assessments drop constraint assessments_lesson_id_key;
alter table public.assessments add constraint assessments_lesson_kind_key unique (lesson_id, kind);

create index assessments_lesson_kind_idx on public.assessments (lesson_id, kind);

alter table public.agent_runs drop constraint agent_runs_kind_check;
alter table public.agent_runs add constraint agent_runs_kind_check
  check (kind in ('lesson_analysis', 'challenge_generation', 'learning_analysis', 'intervention_generation'));

create table public.interventions (
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

create index interventions_classroom_idx on public.interventions (classroom_id, created_at desc);
create index interventions_teacher_idx on public.interventions (teacher_id, created_at desc);

alter table public.interventions enable row level security;

revoke all on table public.interventions from anon, authenticated;
grant select, insert, update, delete on table public.interventions to authenticated;

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
