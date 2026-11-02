-- Stage 9: what a comparability check needs to be honest about.
--
-- Two additions, both nullable so existing rows stay valid:
--   * `questions.difficulty` — a label the generator records, so two assessments can
--     be compared on their mix instead of pretending that is psychometric evidence;
--   * `interventions.scope` — a class-wide intervention is not the same thing as one
--     aimed at a single student's gap, and the data should say which one it is.

alter table public.questions
  add column if not exists difficulty text
  check (difficulty in ('easy', 'medium', 'hard'));

create index if not exists questions_difficulty_idx on public.questions (assessment_id, difficulty);

alter table public.interventions
  add column if not exists scope text not null default 'class'
  check (scope in ('class', 'student'));

-- Reserved for per-student interventions; unused while scope stays 'class'.
alter table public.interventions
  add column if not exists student_id uuid references public.profiles (id) on delete cascade;

alter table public.interventions drop constraint if exists interventions_student_scope_check;
alter table public.interventions add constraint interventions_student_scope_check
  check (
    (scope = 'class' and student_id is null)
    or (scope = 'student' and student_id is not null)
  );
