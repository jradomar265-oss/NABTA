-- Read-only state report for Stages 4-6. Writes nothing, changes nothing.
--
-- Run this in the Supabase SQL editor BEFORE re-running any migration that failed
-- with "already exists". It tells you which objects are present so you can finish
-- the schema instead of dropping work that is already correct.

with expected(kind, name) as (
  values
    ('table', 'agent_runs'),
    ('table', 'lesson_objectives'),
    ('table', 'assessments'),
    ('table', 'questions'),
    ('table', 'answer_keys'),
    ('table', 'submissions'),
    ('table', 'student_answers'),
    ('table', 'xp_transactions'),
    ('table', 'achievements'),
    ('table', 'lesson_study_progress'),
    ('function', 'xp_for_questions'),
    ('function', 'level_for_xp'),
    ('function', 'submit_challenge'),
    ('function', 'mark_lesson_studied'),
    ('function', 'join_classroom_by_code'),
    ('function', 'assert_answer_in_range'),
    ('function', 'assert_existing_answers_in_range'),
    ('function', 'is_teacher'),
    ('function', 'teaches_classroom'),
    ('function', 'is_classroom_member')
)
select
  e.kind,
  e.name,
  case
    when e.kind = 'table' and exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = e.name and c.relkind = 'r'
    ) then 'ok'
    when e.kind = 'function' and exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = e.name
    ) then 'ok'
    else 'MISSING'
  end as status
from expected e
order by
  case
    when e.kind = 'table' and exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = e.name and c.relkind = 'r'
    ) then 0
    when e.kind = 'function' and exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = e.name
    ) then 0
    else 1
  end,
  e.kind,
  e.name;
