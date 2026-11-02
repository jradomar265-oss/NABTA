-- One-shot verification for Stages 4-6.
--
-- Run in the Supabase SQL editor. It asserts that every function the app calls
-- exists and that grading/XP/security behave, then lists what is actually stored.
-- The DO block raises on the first problem, so a failure names the missing object
-- instead of leaving you to guess.

do $$
declare
  missing text[] := '{}';
  needed text[] := array[
    'submit_challenge', 'xp_for_questions', 'level_for_xp',
    'mark_lesson_studied', 'join_classroom_by_code',
    'assert_answer_in_range', 'assert_existing_answers_in_range',
    'is_teacher', 'teaches_classroom', 'is_classroom_member'
  ];
  fn text;
  failures text[] := '{}';
begin
  foreach fn in array needed loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    ) then
      missing := missing || fn;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception 'Missing functions (migration 0006 did not finish): %', array_to_string(missing, ', ');
  end if;

  -- XP: 6 per correct answer, +10 for a full set, never more than a full set.
  if public.xp_for_questions(0, 5) <> 0 then failures := failures || 'xp_for_questions(0,5)'; end if;
  if public.xp_for_questions(5, 5) <> 40 then failures := failures || 'xp_for_questions(5,5)'; end if;
  if public.xp_for_questions(4, 5) <> 24 then failures := failures || 'xp_for_questions(4,5)'; end if;
  if public.xp_for_questions(9, 5) <> 40 then failures := failures || 'xp_for_questions(9,5) caps at a full set'; end if;

  -- Levels: 100 XP each, never below 1.
  if public.level_for_xp(0) <> 1 then failures := failures || 'level_for_xp(0)'; end if;
  if public.level_for_xp(99) <> 1 then failures := failures || 'level_for_xp(99)'; end if;
  if public.level_for_xp(100) <> 2 then failures := failures || 'level_for_xp(100)'; end if;

  -- Clients must not be able to write grades, XP or achievements.
  if has_table_privilege('authenticated', 'public.submissions', 'INSERT') then
    failures := failures || 'authenticated can INSERT submissions';
  end if;
  if has_table_privilege('authenticated', 'public.xp_transactions', 'INSERT') then
    failures := failures || 'authenticated can INSERT xp_transactions';
  end if;
  if has_table_privilege('authenticated', 'public.achievements', 'INSERT') then
    failures := failures || 'authenticated can INSERT achievements';
  end if;

  -- Answer keys must only ever be visible through a teacher-scoped policy.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'answer_keys' and cmd in ('SELECT', 'ALL')
  ) then
    failures := failures || 'answer_keys has no policy at all (teachers cannot read their own keys)';
  end if;

  if array_length(failures, 1) is not null then
    raise exception 'Stage 4-6 verification failed: %', array_to_string(failures, ' | ');
  end if;

  raise notice 'Functions, XP math and write privileges OK';
end;
$$;

-- The audit trail: a failed AI call must never be recorded as a success.
select status, provider, model, objective_count, error_message, created_at
from public.agent_runs
order by created_at desc
limit 10;

-- What the teacher currently has to review.
select l.title as lesson, o.approved, count(*) as objectives
from public.lesson_objectives o
join public.lessons l on l.id = o.lesson_id
group by l.title, o.approved
order by l.title, o.approved;
