-- Stage 5: AI challenge generation and publishing.
--
-- The answer key is structurally separate from the question. `questions.options`
-- is a plain array of strings with no correctness flag, so a leaked question row
-- cannot reveal the answer; correctness lives only in `answer_keys`, which has no
-- student policy at all and is therefore invisible to students at the row level.

-- `agent_runs` already exists from Stage 4; extend it to record challenge generation
-- as well, so every AI call (including failures) is auditable in one place.
alter table public.agent_runs drop constraint agent_runs_kind_check;
alter table public.agent_runs add constraint agent_runs_kind_check
  check (kind in ('lesson_analysis', 'challenge_generation'));

create table public.assessments (
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

create index assessments_teacher_idx on public.assessments (teacher_id);
create index assessments_published_idx on public.assessments (lesson_id) where status = 'published';

create table public.questions (
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

create index questions_assessment_idx on public.questions (assessment_id, position);

create table public.answer_keys (
  question_id uuid primary key references public.questions (id) on delete cascade,
  correct_index integer not null check (correct_index >= 0),
  explanation text not null default '' check (char_length(explanation) <= 600),
  created_at timestamptz not null default now()
);

-- Integrity: an answer index must point at a real option. Cross-table CHECK is not
-- possible, so this is enforced with triggers on both sides.
create function public.assert_answer_in_range()
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

create trigger answer_keys_in_range
  before insert or update on public.answer_keys
  for each row execute procedure public.assert_answer_in_range();

create function public.assert_existing_answers_in_range()
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
create policy "Teachers manage their own assessments"
  on public.assessments for all to authenticated
  using (teacher_id = (select auth.uid()))
  with check (
    teacher_id = (select auth.uid())
    and public.is_teacher()
    and exists (select 1 from public.lessons l where l.id = lesson_id and l.teacher_id = (select auth.uid()))
  );

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
create policy "Teachers manage questions on their own assessments"
  on public.questions for all to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id and a.teacher_id = (select auth.uid())))
  with check (exists (
    select 1 from public.assessments a
    where a.id = assessment_id and a.teacher_id = (select auth.uid()) and public.is_teacher()
  ));

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

create trigger assessments_updated_at
  before update on public.assessments
  for each row execute procedure public.set_profile_updated_at();
