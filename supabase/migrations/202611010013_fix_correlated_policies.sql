-- Stage 9: sweep for the unqualified-correlation bug class.
--
-- Postgres resolves an unqualified column in a subquery against the *innermost* table
-- that owns it. Three policies compared a column of `lesson_assignments` to an
-- unqualified name that also exists on `lesson_assignments`, so the predicate became
-- `la.lesson_id = la.lesson_id` — always true — and the intended join disappeared.
--
-- Found by fixing 202611010011 and then auditing the remaining correlated policies.
-- Each fix below qualifies the outer column. No policy gains access it should not
-- have; two lose access they should never have had.

-- ---------------------------------------------------------------------------
-- 1. Students could read EVERY approved objective (over-permissive).
--    Original: where la.lesson_id = lesson_id   -- both sides resolve to la
--    Effect: any student in any class could read every approved objective, including
--    objectives for lessons never assigned to them.
-- ---------------------------------------------------------------------------
drop policy if exists "Students read approved objectives for assigned lessons" on public.lesson_objectives;

create policy "Students read approved objectives for assigned lessons"
  on public.lesson_objectives for select to authenticated
  using (
    approved
    and exists (
      select 1
      from public.lesson_assignments la
      where la.lesson_id = public.lesson_objectives.lesson_id
        and public.is_classroom_member(la.classroom_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Students could read EVERY published assessment (over-permissive).
--    Original: where la.lesson_id = lesson_id   -- both sides resolve to la
--    Effect: any student in any class could read any published assessment, including
--    assessments for lessons never assigned to them. Unpublished ones stayed hidden,
--    and answer keys were never exposed, but the assessment rows leaked.
-- ---------------------------------------------------------------------------
drop policy if exists "Students read published assessments for assigned lessons" on public.assessments;

create policy "Students read published assessments for assigned lessons"
  on public.assessments for select to authenticated
  using (
    status = 'published'
    and exists (
      select 1
      from public.lesson_assignments la
      where la.lesson_id = public.assessments.lesson_id
        and public.is_classroom_member(la.classroom_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The companion insert check validated the assignment but not the lesson
--    (vacuous condition, not a leak).
--    Original: where la.id = assignment_id and la.lesson_id = lesson_id
--    Effect: `la.lesson_id = lesson_id` was always true, so a student could record a
--    question against their own assignment while claiming any lesson_id. The row was
--    still theirs, so nothing leaked; the label could be wrong.
-- ---------------------------------------------------------------------------
drop policy if exists "Students ask about their own assigned lesson" on public.companion_messages;

create policy "Students ask about their own assigned lesson"
  on public.companion_messages for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and exists (
      select 1
      from public.lesson_assignments la
      join public.classroom_memberships m on m.classroom_id = la.classroom_id
      where la.id = assignment_id
        and la.lesson_id = public.companion_messages.lesson_id
        and m.student_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Audited and left unchanged (verified correct, listed for the reviewer):
--   Teachers manage their own objectives / assessments / agent runs
--     -> `l.id = lesson_id` / `a.id = assessment_id`: the inner table has no such
--        column (lessons owns `id`, not `lesson_id`), so it resolves outward. Correct.
--   Students read questions of published assessments
--     -> `a.id = assessment_id` resolves outward, and the inner lesson join is fully
--        qualified (`la.lesson_id = a.lesson_id`). Correct.
--   Students read their own answers / Teachers read submissions for their classes
--     -> `s.id = submission_id` resolves outward. Correct.
--   Membership policies using public.teaches_classroom(classroom_id)
--     -> classroom_id is a column of the policy's own table. Correct.
-- ---------------------------------------------------------------------------
