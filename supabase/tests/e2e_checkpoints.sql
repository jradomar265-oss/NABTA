-- Checkpoints for the end-to-end run in docs/E2E_VERIFICATION.md.
-- All read-only. Run each block after the matching step and keep the output.

-- ===========================================================================
-- CHECKPOINT A — after the teacher creates the class
-- Expect: one row, grade_level 8, subject 'Science', curriculum 'UAE MOE'.
-- ===========================================================================
select id, name, grade_level, subject, curriculum, join_code, created_at
from public.classrooms
order by created_at desc
limit 3;

-- ===========================================================================
-- CHECKPOINT B — after "Analyse lesson"
-- Expect: 1 succeeded agent_run with provider 'mock', and unapproved objectives.
-- ===========================================================================
select kind, provider, model, status, objective_count, duration_ms, error_message, created_at
from public.agent_runs
order by created_at desc
limit 3;

select l.title, o.approved, o.source, count(*) as objectives
from public.lesson_objectives o
join public.lessons l on l.id = o.lesson_id
group by l.title, o.approved, o.source
order by l.title;

-- ===========================================================================
-- CHECKPOINT C — after approve + publish
-- Expect: assessments.kind 'challenge', status 'published', questions + keys present,
--         and the lesson assigned to the class.
-- ===========================================================================
select a.kind, a.status, a.title,
       (select count(*) from public.questions q where q.assessment_id = a.id) as questions,
       (select count(*) from public.answer_keys k
          join public.questions q2 on q2.id = k.question_id
         where q2.assessment_id = a.id) as answer_keys,
       (select count(*) from public.questions q3 where q3.assessment_id = a.id and q3.difficulty is null) as missing_difficulty
from public.assessments a
order by a.created_at desc
limit 5;

select c.name as classroom, l.title as lesson, la.assigned_at
from public.lesson_assignments la
join public.classrooms c on c.id = la.classroom_id
join public.lessons l on l.id = la.lesson_id
order by la.assigned_at desc
limit 5;

-- ===========================================================================
-- CHECKPOINT D — after the student joins and asks the companion a question
-- Expect: a membership row, and two companion messages (one refused).
-- ===========================================================================
select c.name, count(m.student_id) as members
from public.classrooms c
left join public.classroom_memberships m on m.classroom_id = c.id
group by c.name;

select left(question, 60) as question, refused, provider,
       (lesson_id is not null) as lesson_set, left(answer, 70) as answer
from public.companion_messages
order by created_at desc
limit 5;

-- ===========================================================================
-- CHECKPOINT E — after the student submits (THE important one)
-- Expect:
--   submissions     : score/total filled, xp_awarded > 0
--   student_answers : is_correct agrees with (choice_index = correct_index)
--   xp_transactions : exactly ONE row per assessment
--   profiles        : xp == ledger sum
--   study_progress  : a row exists for the assignment
-- ===========================================================================
select s.id, s.attempt_no, s.score, s.total, s.xp_awarded, s.submitted_at
from public.submissions s
order by s.submitted_at desc
limit 3;

select q.position, left(q.prompt, 44) as prompt, sa.choice_index, sa.correct_index,
       sa.is_correct, (sa.choice_index = sa.correct_index) as should_be
from public.student_answers sa
join public.questions q on q.id = sa.question_id
order by q.position;

select t.amount, t.reason, t.source_type, t.created_at
from public.xp_transactions t
order by t.created_at desc
limit 5;

select p.display_name, p.xp, p.level,
       coalesce(sum(t.amount), 0) as ledger_sum,
       (p.xp = coalesce(sum(t.amount), 0)) as xp_matches_ledger
from public.profiles p
left join public.xp_transactions t on t.student_id = p.id
where p.role = 'student'
group by p.id, p.display_name, p.xp, p.level;

select count(*) as study_progress_rows from public.lesson_study_progress;

select p.display_name, a.code, a.earned_at
from public.achievements a
join public.profiles p on p.id = a.student_id
order by a.earned_at;

-- ===========================================================================
-- CHECKPOINT F — after "Analyse this class"
-- Expect: one learning_analyses row whose evidence_snapshot totals match the
--         answers above, and insufficient_evidence true while only one student
--         has answered.
-- ===========================================================================
select id, provider, insufficient_evidence,
       (evidence_snapshot -> 'totals' ->> 'answers')::int as snapshot_answers,
       (evidence_snapshot -> 'totals' ->> 'correct')::int as snapshot_correct,
       jsonb_array_length(observations -> 'observations') as observations,
       created_at
from public.learning_analyses
order by created_at desc
limit 2;

-- ===========================================================================
-- CHECKPOINT G — after the intervention is assigned and both activities submitted
-- Expect: intervention 'assigned', practice + follow_up assessments both published,
--         one submission for each, and the intervention still class-scoped.
-- ===========================================================================
select i.scope, i.status, i.student_id, left(i.title, 50) as title, i.created_at
from public.interventions i
order by i.created_at desc
limit 3;

select a.kind, a.status, count(s.id) as submissions
from public.assessments a
left join public.submissions s on s.assessment_id = a.id
group by a.kind, a.status
order by a.kind, a.status;

-- Which assessments have evidence on both sides of the comparison?
select
  sum(case when a.kind = 'challenge' then 1 else 0 end) as challenge_answers,
  sum(case when a.kind = 'follow_up' then 1 else 0 end) as follow_up_answers
from public.student_answers sa
join public.questions q on q.id = sa.question_id
join public.assessments a on a.id = q.assessment_id;
