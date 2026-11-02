-- Stage 9 (found while verifying the consolidated schema bundle).
--
-- Fix an over-restrictive RLS policy on `lessons`.
--
-- The policy added in 202611010002_stage3_learning_core.sql reads:
--
--   using (exists (
--     select 1 from public.lesson_assignments la
--     where la.lesson_id = id and public.is_classroom_member(la.classroom_id)
--   ));
--
-- Inside the subquery, an unqualified `id` resolves against `lesson_assignments`,
-- which has its own `id` column, so the comparison became `la.lesson_id = la.id`
-- instead of `la.lesson_id = lessons.id`. In practice a student could only read a
-- lesson whose assignment id happened to equal the lesson id — effectively never.
--
-- Effect of the bug: students received no lesson rows from this policy, so any query
-- that embeds `lessons(...)` from an assignment returned null content.
--
-- The fix qualifies the outer column explicitly. It does NOT widen access: a student
-- still only reads lessons assigned to a class they belong to.

drop policy if exists "Students can read assigned lessons" on public.lessons;

create policy "Students can read assigned lessons"
  on public.lessons for select to authenticated
  using (exists (
    select 1
    from public.lesson_assignments la
    where la.lesson_id = public.lessons.id
      and public.is_classroom_member(la.classroom_id)
  ));
