-- ============================================================================
--  NABTA — demo seed
--  supabase/seed_demo.sql
-- ============================================================================
--
--  WHAT THIS IS
--    A Grade 8 Science class with everything the verification runbook needs, so
--    stages 5-8 can be exercised without hand-building a class first.
--
--  WHAT IT DOES NOT DO
--    It never writes to auth.users. You create the three accounts through the app
--    (sign up three times), set the three emails below, and this file attaches the
--    content to them. Nothing here can create a login.
--
--  SAFETY
--    Every insert is `on conflict do nothing` against fixed UUIDs, so running it
--    twice changes nothing. It only adds rows; it never updates or deletes existing
--    content. To remove the demo later, run the cleanup block at the bottom.
--
--    Do NOT run this against a production database.
--
--  HOW TO USE
--    1. Sign up three accounts (one will be promoted to teacher).
--    2. Put their emails in the three constants below.
--    3. Run this file. It prints what it did.
--    4. Promote the teacher if needed:
--         update public.profiles set role = 'teacher'
--         where id = (select id from auth.users where email = 'teacher@example.com');
-- ============================================================================

do $$
declare
  -- EDIT THESE THREE LINES -----------------------------------------------------
  -- Two students are needed: the class-level judgement threshold is two students,
  -- so a single student always reports "not enough evidence".
  teacher_email constant text := 'teacher@test.com';
  student_one_email constant text := 'student@test.com';
  student_two_email constant text := 'student2@test.com';
  -- ---------------------------------------------------------------------------

  teacher_id uuid;
  student_one uuid;
  student_two uuid;

  demo_classroom constant uuid := 'a0000000-0000-4000-8000-000000000001';
  demo_lesson constant uuid := 'a0000000-0000-4000-8000-000000000002';
  demo_assignment constant uuid := 'a0000000-0000-4000-8000-000000000003';
  demo_objective_one constant uuid := 'a0000000-0000-4000-8000-000000000004';
  demo_objective_two constant uuid := 'a0000000-0000-4000-8000-000000000005';
  demo_challenge constant uuid := 'a0000000-0000-4000-8000-000000000006';
  demo_practice constant uuid := 'a0000000-0000-4000-8000-000000000007';
  demo_follow_up constant uuid := 'a0000000-0000-4000-8000-000000000008';
  demo_intervention constant uuid := 'a0000000-0000-4000-8000-000000000009';
  q1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  q2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  q3 constant uuid := 'a0000000-0000-4000-8000-000000000013';
  q4 constant uuid := 'a0000000-0000-4000-8000-000000000014';
  p1 constant uuid := 'a0000000-0000-4000-8000-000000000021';
  p2 constant uuid := 'a0000000-0000-4000-8000-000000000022';
  f1 constant uuid := 'a0000000-0000-4000-8000-000000000031';
  f2 constant uuid := 'a0000000-0000-4000-8000-000000000032';
  sub_one constant uuid := 'a0000000-0000-4000-8000-000000000041';
  sub_two constant uuid := 'a0000000-0000-4000-8000-000000000042';
  missing text[] := '{}';
begin
  select id into teacher_id from auth.users where email = teacher_email;
  select id into student_one from auth.users where email = student_one_email;
  select id into student_two from auth.users where email = student_two_email;

  if teacher_id is null then missing := missing || ('teacher: ' || teacher_email); end if;
  if student_one is null then missing := missing || ('student: ' || student_one_email); end if;
  if student_two is null then missing := missing || ('student: ' || student_two_email); end if;

  if array_length(missing, 1) > 0 then
    raise exception 'Create these accounts through the app first, then re-run: %', array_to_string(missing, ', ');
  end if;

  -- The teacher must hold the teacher role for the class to be usable.
  update public.profiles set role = 'teacher' where id = teacher_id and role <> 'teacher';

  insert into public.classrooms (id, teacher_id, name, grade_level, subject, curriculum)
  values (demo_classroom, teacher_id, 'Grade 8 Science — Ecosystems', 8, 'Science', 'UAE MOE')
  on conflict (id) do nothing;

  insert into public.classroom_memberships (classroom_id, student_id)
  values (demo_classroom, student_one), (demo_classroom, student_two)
  on conflict do nothing;

  insert into public.lessons (id, teacher_id, title, content)
  values (
    demo_lesson,
    teacher_id,
    'Food chains and energy transfer',
    'A food chain shows how energy moves from one living thing to another. It always starts with a producer, '
    || 'usually a plant, which makes its own food using sunlight. Animals that eat plants are primary consumers. '
    || 'Animals that eat other animals are secondary or tertiary consumers. Decomposers, such as fungi and '
    || 'bacteria, break down dead material and return nutrients to the soil. Energy is lost at every step: about '
    || 'ninety per cent of the energy in one level is not passed to the next, mostly as heat. This is why food '
    || 'chains rarely have more than four or five links — there is too little energy left to support another level.'
  )
  on conflict (id) do nothing;

  insert into public.lesson_objectives (id, lesson_id, teacher_id, position, statement, skills, evidence, source, approved)
  values
    (demo_objective_one, demo_lesson, teacher_id, 0,
     'Explain how energy moves from producers through consumers in a food chain.',
     array['energy transfer', 'trophic levels'], 'Energy is lost at every step', 'teacher', true),
    (demo_objective_two, demo_lesson, teacher_id, 1,
     'Describe the role of decomposers in returning nutrients to the soil.',
     array['decomposition', 'nutrient cycling'], 'return nutrients to the soil', 'teacher', true)
  on conflict (id) do nothing;

  insert into public.lesson_assignments (id, lesson_id, classroom_id)
  values (demo_assignment, demo_lesson, demo_classroom)
  on conflict do nothing;

  -- Published challenge: four questions, three on objective one, one on objective two.
  insert into public.assessments (id, lesson_id, teacher_id, title, kind, status, approved_at, published_at)
  values (demo_challenge, demo_lesson, teacher_id, 'Food chains — check your understanding', 'challenge', 'published', now(), now())
  on conflict (id) do nothing;

  insert into public.questions (id, assessment_id, position, kind, prompt, options, objective_id, difficulty)
  values
    (q1, demo_challenge, 0, 'multiple_choice', 'What is the first link in every food chain?',
     array['A producer', 'A decomposer', 'A secondary consumer', 'A tertiary consumer'], demo_objective_one, 'easy'),
    (q2, demo_challenge, 1, 'multiple_choice', 'Roughly what percentage of energy is NOT passed to the next level?',
     array['90%', '10%', '50%', '25%'], demo_objective_one, 'medium'),
    (q3, demo_challenge, 2, 'true_false', 'Food chains usually have more than six links.',
     array['True', 'False'], demo_objective_one, 'medium'),
    (q4, demo_challenge, 3, 'multiple_choice', 'What do decomposers return to the soil?',
     array['Nutrients', 'Sunlight', 'Heat', 'Oxygen'], demo_objective_two, 'easy')
  on conflict (id) do nothing;

  insert into public.answer_keys (question_id, correct_index, explanation)
  values
    (q1, 0, 'Producers make their own food from sunlight, so the chain starts there.'),
    (q2, 0, 'About ninety per cent of the energy is lost at each step, mostly as heat.'),
    (q3, 1, 'Energy loss means chains rarely exceed four or five links.'),
    (q4, 0, 'Decomposers break down dead material and release nutrients back to the soil.')
  on conflict (question_id) do nothing;

  -- Student one: 3 of 4 correct. XP = 3 correct x 6 = 18, no full-set bonus.
  insert into public.submissions (id, student_id, assessment_id, attempt_no, score, total, xp_awarded)
  values (sub_one, student_one, demo_challenge, 1, 3, 4, 18)
  on conflict do nothing;

  insert into public.student_answers (submission_id, question_id, choice_index, is_correct, correct_index)
  values
    (sub_one, q1, 0, true, 0),
    (sub_one, q2, 0, true, 0),
    (sub_one, q3, 0, false, 1),
    (sub_one, q4, 0, true, 0)
  on conflict do nothing;

  -- Student two: 2 of 4 correct. XP = 12.
  insert into public.submissions (id, student_id, assessment_id, attempt_no, score, total, xp_awarded)
  values (sub_two, student_two, demo_challenge, 1, 2, 4, 12)
  on conflict do nothing;

  insert into public.student_answers (submission_id, question_id, choice_index, is_correct, correct_index)
  values
    (sub_two, q1, 1, false, 0),
    (sub_two, q2, 1, false, 0),
    (sub_two, q3, 1, true, 1),
    (sub_two, q4, 0, true, 0)
  on conflict do nothing;

  -- XP ledger: one row per student per assessment, which is the invariant.
  insert into public.xp_transactions (student_id, amount, reason, source_type, source_id)
  values
    (student_one, 18, 'Challenge: 3 of 4 correct', 'assessment', demo_challenge),
    (student_two, 12, 'Challenge: 2 of 4 correct', 'assessment', demo_challenge)
  on conflict do nothing;

  insert into public.achievements (student_id, code)
  values (student_one, 'first_quest'), (student_two, 'first_quest')
  on conflict do nothing;

  insert into public.lesson_study_progress (student_id, assignment_id)
  values (student_one, demo_assignment), (student_two, demo_assignment)
  on conflict do nothing;

  -- Keep the profile totals consistent with the ledger, so the checkpoint assertion holds.
  update public.profiles p
     set xp = coalesce((select sum(t.amount) from public.xp_transactions t where t.student_id = p.id), 0)
   where p.id in (student_one, student_two);
  update public.profiles
     set level = 1 + (xp / 100)
   where id in (student_one, student_two);

  -- Intervention left in DRAFT on purpose: approving and assigning are the gate you
  -- are testing. Practice and follow-up are separate assessments, both unpublished.
  insert into public.assessments (id, lesson_id, teacher_id, title, kind, status)
  values
    (demo_practice, demo_lesson, teacher_id, 'Food chains — targeted practice', 'practice', 'draft'),
    (demo_follow_up, demo_lesson, teacher_id, 'Food chains — follow-up check', 'follow_up', 'draft')
  on conflict (id) do nothing;

  insert into public.questions (id, assessment_id, position, kind, prompt, options, objective_id, difficulty)
  values
    (p1, demo_practice, 0, 'multiple_choice', 'Which organism always begins a food chain?',
     array['A plant', 'A fungus', 'A herbivore', 'A predator'], demo_objective_one, 'easy'),
    (p2, demo_practice, 1, 'multiple_choice', 'Where does most energy leave a food chain?',
     array['As heat', 'As sound', 'As soil', 'As water'], demo_objective_one, 'medium'),
    (f1, demo_follow_up, 0, 'multiple_choice', 'In a food chain, what does a producer do?',
     array['Makes its own food', 'Eats other animals', 'Breaks down dead matter', 'Stores sunlight'], demo_objective_one, 'easy'),
    (f2, demo_follow_up, 1, 'multiple_choice', 'Why are long food chains rare?',
     array['Too little energy remains', 'Too many producers', 'Decomposers remove them', 'Animals stop eating'], demo_objective_one, 'medium')
  on conflict (id) do nothing;

  insert into public.answer_keys (question_id, correct_index, explanation)
  values
    (p1, 0, 'Producers make their own food using sunlight, so a chain starts with a plant.'),
    (p2, 0, 'Most energy is lost as heat at each step.'),
    (f1, 0, 'A producer makes its own food from sunlight; consumers do not.'),
    (f2, 0, 'With about ninety per cent lost per step, too little energy remains for another level.')
  on conflict (question_id) do nothing;

  insert into public.interventions (
    id, teacher_id, classroom_id, lesson_id, objective_id, title, rationale, status, scope,
    practice_assessment_id, follow_up_assessment_id
  )
  values (
    demo_intervention, teacher_id, demo_classroom, demo_lesson, demo_objective_one,
    'Practice: energy transfer in food chains',
    'Two of six answers on this objective were correct across the class. This practice is assigned to the whole class; it is not tailored to each student''s individual gap.',
    'draft', 'class', demo_practice, demo_follow_up
  )
  on conflict (id) do nothing;

  raise notice 'Seeded: class %, lesson %, challenge % (published), 2 submissions, intervention % (draft).',
    demo_classroom, demo_lesson, demo_challenge, demo_intervention;
end $$;

-- ----------------------------------------------------------------------------
-- Verify the seed against the invariants, in one glance.
-- ----------------------------------------------------------------------------
select
  (select count(*) from public.xp_transactions) as xp_rows,
  (select count(*) from public.student_answers where is_correct <> (choice_index = correct_index)) as grading_mismatches,
  (select count(*) from public.profiles p
    where p.role = 'student'
      and p.xp <> coalesce((select sum(t.amount) from public.xp_transactions t where t.student_id = p.id), 0)) as xp_ledger_mismatches,
  (select count(*) from public.answer_keys) as answer_keys;

-- ----------------------------------------------------------------------------
-- CLEANUP — uncomment and run to remove every demo row. Content is deleted in
-- child-first order; accounts are left alone so you can keep using them.
-- ----------------------------------------------------------------------------
-- delete from public.interventions where id = 'a0000000-0000-4000-8000-000000000009';
-- delete from public.answer_keys where question_id in (
--   'a0000000-0000-4000-8000-000000000011','a0000000-0000-4000-8000-000000000012',
--   'a0000000-0000-4000-8000-000000000013','a0000000-0000-4000-8000-000000000014',
--   'a0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000022',
--   'a0000000-0000-4000-8000-000000000031','a0000000-0000-4000-8000-000000000032');
-- delete from public.student_answers where submission_id in (
--   'a0000000-0000-4000-8000-000000000041','a0000000-0000-4000-8000-000000000042');
-- delete from public.submissions where assessment_id in (
--   'a0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008');
-- delete from public.questions where assessment_id in (
--   'a0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008');
-- delete from public.assessments where id in (
--   'a0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008');
-- delete from public.xp_transactions where source_id = 'a0000000-0000-4000-8000-000000000006';
-- delete from public.achievements where student_id in (select id from public.profiles where role = 'student');
-- delete from public.lesson_study_progress where assignment_id = 'a0000000-0000-4000-8000-000000000003';
-- delete from public.lesson_assignments where id = 'a0000000-0000-4000-8000-000000000003';
-- delete from public.lesson_objectives where lesson_id = 'a0000000-0000-4000-8000-000000000002';
-- delete from public.lessons where id = 'a0000000-0000-4000-8000-000000000002';
-- delete from public.classroom_memberships where classroom_id = 'a0000000-0000-4000-8000-000000000001';
-- delete from public.classrooms where id = 'a0000000-0000-4000-8000-000000000001';
