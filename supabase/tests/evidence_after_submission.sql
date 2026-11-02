-- Evidence after the first student submission.
--
-- Run in the Supabase SQL editor. Read-only. Every number here is the server's
-- record, so it checks the app's claims rather than repeating them.

-- 1. The graded submission(s). Expect one row, score/total filled, xp_awarded > 0.
select s.id, p.display_name as student, a.title as assessment,
       s.attempt_no, s.score, s.total, s.xp_awarded, s.submitted_at
from public.submissions s
join public.profiles p on p.id = s.student_id
join public.assessments a on a.id = s.assessment_id
order by s.submitted_at desc;

-- 2. Per-question grading. is_correct must agree with choice_index vs the key.
select q.position, left(q.prompt, 48) as prompt, sa.choice_index, sa.correct_index,
       sa.is_correct, (sa.choice_index = sa.correct_index) as should_be
from public.student_answers sa
join public.questions q on q.id = sa.question_id
order by q.position;

-- 3. XP ledger. Expect exactly ONE row per assessment, however many retakes.
select t.amount, t.reason, t.source_type, t.created_at
from public.xp_transactions t
order by t.created_at desc;

-- 4. Student totals, which must equal the ledger sum.
select p.display_name, p.xp, p.level,
       coalesce(sum(t.amount), 0) as ledger_sum,
       (p.xp = coalesce(sum(t.amount), 0)) as xp_matches_ledger
from public.profiles p
left join public.xp_transactions t on t.student_id = p.id
where p.role = 'student'
group by p.id, p.display_name, p.xp, p.level;

-- 5. Achievements earned.
select p.display_name, ach.code, ach.earned_at
from public.achievements ach
join public.profiles p on p.id = ach.student_id
order by ach.earned_at;

-- 6. World state: the quest should now be completed for that student.
select c.name as classroom, l.title as lesson, m.student_id is not null as enrolled,
       sp.studied_at is not null as studied,
       exists (
         select 1 from public.submissions s
         join public.assessments a2 on a2.id = s.assessment_id
         where a2.lesson_id = l.id and s.student_id = m.student_id
       ) as has_submission
from public.lesson_assignments la
join public.lessons l on l.id = la.lesson_id
join public.classrooms c on c.id = la.classroom_id
left join public.classroom_memberships m on m.classroom_id = c.id
left join public.lesson_study_progress sp on sp.assignment_id = la.id and sp.student_id = m.student_id
order by c.name, l.title;
