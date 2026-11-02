-- Stage 8 (part 1): the AI Learning Companion.
--
-- A student asks a question about the lesson they are studying and gets a grounded
-- explanation. Three constraints are structural, not stylistic:
--   * a student can only write rows about themselves, in a lesson assigned to a
--     class they belong to;
--   * the transcript is readable by the teacher who teaches that class, because
--     adult oversight of AI conversations with minors is not optional;
--   * nothing here can award XP or mark work complete — this is support, not evidence.

create table public.companion_messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  assignment_id uuid not null references public.lesson_assignments (id) on delete cascade,
  question text not null check (char_length(trim(question)) between 3 and 600),
  answer text not null check (char_length(trim(answer)) between 1 and 3000),
  -- True when the companion declined because the question was outside the lesson.
  refused boolean not null default false,
  provider text not null,
  model text not null default '',
  context_missing boolean not null default false,
  created_at timestamptz not null default now()
);

create index companion_messages_student_idx on public.companion_messages (student_id, created_at desc);
create index companion_messages_lesson_idx on public.companion_messages (lesson_id, created_at desc);

alter table public.companion_messages enable row level security;

revoke all on table public.companion_messages from anon, authenticated;
-- Students may read their own thread and append to it; they may never edit or delete
-- an answer that has already been given.
grant select, insert on table public.companion_messages to authenticated;

create policy "Students read their own companion thread"
  on public.companion_messages for select to authenticated
  using (student_id = (select auth.uid()));

create policy "Students ask about their own assigned lesson"
  on public.companion_messages for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and exists (
      select 1
      from public.lesson_assignments la
      join public.classroom_memberships m on m.classroom_id = la.classroom_id
      where la.id = assignment_id
        and la.lesson_id = lesson_id
        and m.student_id = (select auth.uid())
    )
  );

-- Oversight: a teacher sees the companion conversations in their own classes.
create policy "Teachers read companion threads for their classes"
  on public.companion_messages for select to authenticated
  using (exists (
    select 1
    from public.lesson_assignments la
    join public.classrooms c on c.id = la.classroom_id
    where la.id = assignment_id and c.teacher_id = (select auth.uid())
  ));
