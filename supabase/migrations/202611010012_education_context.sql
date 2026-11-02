-- Stage 9: education context on a class.
--
-- NABTA is not a Grade 6 mathematics product. A class now carries the educational
-- context that prompts, difficulty and safety behaviour need: grade, subject and
-- curriculum.
--
-- All three are NULLABLE on purpose:
--   * existing classrooms keep working untouched (no backfill, no rewrite);
--   * the current Grade 6 mathematics demo remains a valid configuration rather than
--     a hardcoded assumption;
--   * a class with no context still functions — prompts fall back to neutral wording
--     instead of silently pretending to be Grade 6.
--
-- No policy, grant, constraint, trigger or index is removed or weakened here.

alter table public.classrooms
  -- 1-12 covers the school years NABTA targets. Kindergarten and post-12 are a
  -- future widening, not an assumption baked in now.
  add column if not exists grade_level integer,
  add column if not exists subject text,
  add column if not exists curriculum text;

-- Constraints added separately so a re-run cannot duplicate them, and so an existing
-- row with an out-of-range value fails loudly rather than being silently coerced.
alter table public.classrooms drop constraint if exists classrooms_grade_level_check;
alter table public.classrooms add constraint classrooms_grade_level_check
  check (grade_level is null or grade_level between 1 and 12);

alter table public.classrooms drop constraint if exists classrooms_subject_check;
alter table public.classrooms add constraint classrooms_subject_check
  check (subject is null or char_length(trim(subject)) between 1 and 60);

alter table public.classrooms drop constraint if exists classrooms_curriculum_check;
alter table public.classrooms add constraint classrooms_curriculum_check
  check (curriculum is null or char_length(trim(curriculum)) between 1 and 80);

-- Colours are not part of this change.
