-- Stage 3: per-student quest progress for the learning world.
--
-- A quest is a lesson assignment. Students can only record a *study* step here;
-- mastery completion requires graded assessment evidence and is intentionally not
-- writable in this stage. Nothing in this migration lets a client set 'completed'
-- or award XP.

create table public.lesson_study_progress (
  student_id uuid not null references public.profiles (id) on delete cascade,
  assignment_id uuid not null references public.lesson_assignments (id) on delete cascade,
  studied_at timestamptz not null default now(),
  primary key (student_id, assignment_id)
);

create index lesson_study_progress_student_idx on public.lesson_study_progress (student_id);

alter table public.lesson_study_progress enable row level security;

revoke all on table public.lesson_study_progress from anon, authenticated;
grant select on table public.lesson_study_progress to authenticated;

create policy "Students read their own study progress"
  on public.lesson_study_progress for select to authenticated
  using (student_id = (select auth.uid()));

create policy "Teachers read study progress for their classes"
  on public.lesson_study_progress for select to authenticated
  using (exists (
    select 1
    from public.lesson_assignments la
    join public.classrooms c on c.id = la.classroom_id
    where la.id = assignment_id and c.teacher_id = (select auth.uid())
  ));

-- The only write path: a student marks a lesson they are assigned and enrolled in.
create function public.mark_lesson_studied(p_assignment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  ) then
    raise exception 'Only students can record lesson study';
  end if;

  if not exists (
    select 1
    from public.lesson_assignments la
    join public.classroom_memberships m on m.classroom_id = la.classroom_id
    where la.id = p_assignment and m.student_id = auth.uid()
  ) then
    raise exception 'Lesson is not assigned to this student';
  end if;

  insert into public.lesson_study_progress (student_id, assignment_id)
  values (auth.uid(), p_assignment)
  on conflict (student_id, assignment_id) do nothing;
end;
$$;

grant execute on function public.mark_lesson_studied(uuid) to authenticated;
