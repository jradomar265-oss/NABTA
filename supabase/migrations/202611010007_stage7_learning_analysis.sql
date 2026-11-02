-- Stage 7: learning analysis and teacher analytics.
--
-- Two deliberate stores:
--   `evidence_snapshot` — the numbers the analysis was computed from, frozen at the
--     moment of the run. Facts are never regenerated from a later state, so a report
--     can always be audited against what it actually saw.
--   `observations` — the validated model output, kept separate from the facts and
--     labelled by provider so an interpretation can never masquerade as a measurement.

alter table public.agent_runs drop constraint agent_runs_kind_check;
alter table public.agent_runs add constraint agent_runs_kind_check
  check (kind in ('lesson_analysis', 'challenge_generation', 'learning_analysis'));

create table public.learning_analyses (
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

create index learning_analyses_classroom_idx on public.learning_analyses (classroom_id, created_at desc);
create index learning_analyses_teacher_idx on public.learning_analyses (teacher_id, created_at desc);

alter table public.learning_analyses enable row level security;

revoke all on table public.learning_analyses from anon, authenticated;
grant select, insert, delete on table public.learning_analyses to authenticated;

create policy "Teachers read their own class analyses"
  on public.learning_analyses for select to authenticated
  using (teacher_id = (select auth.uid()));

create policy "Teachers record analyses for their own classes"
  on public.learning_analyses for insert to authenticated
  with check (
    teacher_id = (select auth.uid())
    and public.is_teacher()
    and public.teaches_classroom(classroom_id)
  );

create policy "Teachers delete their own analyses"
  on public.learning_analyses for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- No student policy at all: interpretation is a teacher-facing artefact. Students get
-- their own progress from their own answers, computed, never from this table.
