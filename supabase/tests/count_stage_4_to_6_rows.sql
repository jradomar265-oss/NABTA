-- Row counts for the Stage 4-6 tables.
--
-- Run this ONLY if inspect_stage_4_to_6.sql reports every object as "ok".
-- It tells you whether the schema holds real data, which decides whether a reset
-- would destroy anything. Every count is expected to be 0 until the app is used.

select 'submissions' as table_name, count(*) as rows from public.submissions
union all select 'student_answers', count(*) from public.student_answers
union all select 'xp_transactions', count(*) from public.xp_transactions
union all select 'achievements', count(*) from public.achievements
union all select 'assessments', count(*) from public.assessments
union all select 'questions', count(*) from public.questions
union all select 'answer_keys', count(*) from public.answer_keys
union all select 'lesson_objectives', count(*) from public.lesson_objectives
union all select 'agent_runs', count(*) from public.agent_runs
union all select 'lesson_study_progress', count(*) from public.lesson_study_progress
order by table_name;
