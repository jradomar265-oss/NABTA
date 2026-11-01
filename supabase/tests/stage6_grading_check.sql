-- Assertions for the Stage 6 grading helpers.
--
-- Run this in the Supabase SQL editor after applying
-- 202611010006_stage6_study_quests.sql. It writes nothing: it either prints
-- "Stage 6 grading checks passed" or raises with the broken expectation.

do $$
declare
  failures text[] := '{}';
begin
  -- xp_for_questions: 6 per correct answer, +10 for a full set, 0 for none.
  if public.xp_for_questions(0, 5) <> 0 then
    failures := failures || 'xp_for_questions(0,5) should be 0';
  end if;
  if public.xp_for_questions(5, 5) <> 40 then
    failures := failures || 'xp_for_questions(5,5) should be 40 (30 + 10 mastery)';
  end if;
  if public.xp_for_questions(4, 5) <> 24 then
    failures := failures || 'xp_for_questions(4,5) should be 24';
  end if;
  if public.xp_for_questions(1, 1) <> 16 then
    failures := failures || 'xp_for_questions(1,1) should be 16';
  end if;
  if public.xp_for_questions(0, 0) <> 0 then
    failures := failures || 'xp_for_questions(0,0) should be 0';
  end if;
  if public.xp_for_questions(9, 5) <> 40 then
    failures := failures || 'xp_for_questions must not reward more than a full set';
  end if;

  -- level_for_xp: 100 XP per level, never below 1.
  if public.level_for_xp(0) <> 1 then
    failures := failures || 'level_for_xp(0) should be 1';
  end if;
  if public.level_for_xp(-50) <> 1 then
    failures := failures || 'level_for_xp(negative) should be 1';
  end if;
  if public.level_for_xp(99) <> 1 then
    failures := failures || 'level_for_xp(99) should be 1';
  end if;
  if public.level_for_xp(100) <> 2 then
    failures := failures || 'level_for_xp(100) should be 2';
  end if;
  if public.level_for_xp(407) <> 5 then
    failures := failures || 'level_for_xp(407) should be 5';
  end if;

  -- The answer key must stay unreadable for students: no policy may expose it.
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'answer_keys'
      and cmd in ('SELECT', 'ALL')
      and coalesce(qual, '') not like '%teacher_id%'
  ) then
    failures := failures || 'answer_keys has a SELECT policy that does not scope to the owning teacher';
  end if;

  -- Students must not be able to write grades or XP directly.
  if has_table_privilege('authenticated', 'public.submissions', 'INSERT') then
    failures := failures || 'authenticated must not have INSERT on submissions';
  end if;
  if has_table_privilege('authenticated', 'public.xp_transactions', 'INSERT') then
    failures := failures || 'authenticated must not have INSERT on xp_transactions';
  end if;
  if has_table_privilege('authenticated', 'public.answer_keys', 'SELECT') and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'answer_keys' and cmd in ('SELECT', 'ALL')
  ) then
    failures := failures || 'answer_keys is readable without any policy';
  end if;

  if array_length(failures, 1) is not null then
    raise exception 'Stage 6 grading checks failed: %', array_to_string(failures, ' | ');
  end if;

  raise notice 'Stage 6 grading checks passed';
end;
$$;
