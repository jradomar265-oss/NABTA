-- Stage 6: student study quests — submissions, server-side grading, XP, achievements.
--
-- Grading happens in this SECURITY DEFINER function and nowhere else. Students have
-- no INSERT/UPDATE grant on submissions, answers, XP or achievements, and cannot
-- read answer_keys, so a score or an XP total cannot be produced or edited by a client.

create table public.submissions (
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

create index submissions_student_idx on public.submissions (student_id, submitted_at desc);
create index submissions_assessment_idx on public.submissions (assessment_id);

create table public.student_answers (
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

create index student_answers_submission_idx on public.student_answers (submission_id);

create table public.xp_transactions (
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

create index xp_transactions_student_idx on public.xp_transactions (student_id, created_at desc);

create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  code text not null check (code in ('first_quest', 'perfect_score', 'steady_learner')),
  earned_at timestamptz not null default now(),
  unique (student_id, code)
);

create index achievements_student_idx on public.achievements (student_id);

-- XP rewards understanding, not speed: 6 per correct answer, +10 for a full set.
create function public.xp_for_questions(p_correct integer, p_total integer)
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

create function public.level_for_xp(p_xp integer)
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

create policy "Students read their own submissions"
  on public.submissions for select to authenticated
  using (student_id = (select auth.uid()));

create policy "Teachers read submissions for their classes"
  on public.submissions for select to authenticated
  using (exists (
    select 1
    from public.assessments a
    join public.lesson_assignments la on la.lesson_id = a.lesson_id
    join public.classrooms c on c.id = la.classroom_id
    where a.id = assessment_id and c.teacher_id = (select auth.uid())
  ));

create policy "Students read their own answers"
  on public.student_answers for select to authenticated
  using (exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.student_id = (select auth.uid())
  ));

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

create policy "Students read their own xp"
  on public.xp_transactions for select to authenticated
  using (student_id = (select auth.uid()));

create policy "Students read their own achievements"
  on public.achievements for select to authenticated
  using (student_id = (select auth.uid()));

/**
 * Grades a submitted challenge and awards XP exactly once.
 *
 * Rejects anything that is not a published challenge assigned to the caller, an
 * incomplete answer set, or an option index outside the question's options.
 */
create function public.submit_challenge(p_assessment uuid, p_answers jsonb)
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
