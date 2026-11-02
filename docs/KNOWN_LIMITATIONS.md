# Known limitations — NABTA MVP

**Last updated:** 2026-11-01
**Applies to:** the current build, before any end-to-end verification run.

This is the honest list. Anything here that a reviewer, judge, teacher or school
might reasonably assume works — and does not — belongs in this file.

---

## 1. The AI has never run live

Every AI surface has only ever executed against the **deterministic mock**:

| Surface | Live provider called? |
|---|---|
| Lesson understanding (objectives) | no |
| Challenge generation | no |
| Learning analysis | no |
| Learning companion | no |
| Intervention generation | no |

`AI_PROVIDER` is commented out in `.env.local` and `AI_MODEL` holds a placeholder.
The provider code path exists and is unit-checked, but **no real model response has
ever been validated or observed.**

Consequences a reviewer should know:

- Mock objectives, questions and analyses are **template-derived from fractions
  content**. Point the mock at a science lesson and it will still emit fractions
  questions — visibly wrong, and a fair demonstration of why the mock is not AI.
- `npm run check:live` is the one script that actually calls a provider. It must be
  run before claiming any AI capability.
- Mock outputs are labelled in the UI. Nothing is presented as AI that is not.

## 2. Difficulty is a label, not a measurement

Questions carry `easy` / `medium` / `hard`. These are **generator-assigned strings**.

- They are not calibrated against any student population.
- The same label does not represent the same demand across grades or subjects.
- The comparability check compares *distributions of labels*. Two assessments both
  "50% medium" can still differ substantially in difficulty.

Matching labels does **not** establish statistical equivalence, and the product says
so wherever a comparison is shown. There is no psychometric calibration, no item
response model, and no equating.

## 3. Comparisons are structure-checked, not fair

The before/after panel refuses to call a comparison fair when the two assessments
differ in question count, question-type mix, objective coverage, difficulty
distribution or question distinctness. That check is real.

What it cannot detect:

- Wording difficulty.
- Distractor quality.
- Guessing.
- Rote recall versus understanding.
- Fatigue or carelessness on the second occasion.

`causalClaim` is hard-coded `false`. **NABTA never claims that it caused
improvement**, and the UI says so explicitly, because nothing in a two-occasion
design supports that inference.

In mock mode a practice/follow-up pair is always reported as **"not directly
comparable"**, because the mock reuses its templates. That is correct behaviour, not
a defect: it demonstrates the guard working.

## 4. Interventions are class-wide only

`interventions.scope` accepts `class` and `student`, and a CHECK constraint enforces
that `student` requires a `student_id`.

**Only `class` is implemented.** There is:

- no per-student assignment,
- no per-student RLS path,
- no per-student targeting logic.

A class-wide intervention does **not** address each student's individual gap, and
the stored rationale says so in words. Do not read a class-wide improvement as
evidence about any individual student.

## 5. Learning analysis is bounded by its evidence

- Thresholds are fixed constants (3 attempts before a hypothesis, 2 students before
  a class-level judgement, 4 attempts and 80% for a strength). They are guesses, not
  validated cut-offs.
- With one student the analysis must report insufficient evidence. It is designed to.
- The AI reads computed numbers and may not produce new ones. A well-written
  observation can still be wrong if the numbers behind it are thin.

## 6. Stages 5–8 have never run end to end

| Stage | State |
|---|---|
| 3 Learning core | verified against the live database |
| 4 Lesson understanding | verified against the live database |
| 5 Challenges | built, **never executed** |
| 6 Study quests, grading, XP | built, **never executed** |
| 7 Learning analysis | built, **never executed** |
| 8 Companion, interventions | built, **never executed** |
| 9 Integration | in progress |

No student has ever submitted an answer in this build against a real database.
Grading, XP-award-once, achievements, medallions and the companion have only been
exercised in unit checks with hand-built fixtures.

## 7. Security: four bugs were found, and the class of bug is subtle

Found during review and fixed. Listed because they are informative, not because they
are open:

| Bug | Effect | Fixed in |
|---|---|---|
| `la.lesson_id = id` in the lessons policy | students could read **no** lesson content | `0011` |
| `la.lesson_id = lesson_id` in objectives | any student could read **every** approved objective | `0013` |
| same in assessments | any student could read **every** published assessment | `0013` |
| same in companion insert | vacuous check; lesson id was not validated | `0013` |

The root cause: an unqualified column inside an RLS subquery resolves to the
**innermost** table that owns it. Every correlated policy must qualify the outer
table (`public.assessments.lesson_id`).

**Consequence for review:** this class of bug is silent. It produces policies that
parse, apply, and pass a review that reads for intent rather than name resolution.
The current mitigation is a documented convention, not a test. A regression test that
asserts a student in class A cannot see class B's rows does not yet exist.

Also noted, not changed: `anon` holds Supabase's default `SELECT` grant on
`lessons`, `classrooms` and similar tables. RLS returns zero rows so nothing leaks,
but privilege hygiene should be tightened before release.

## 8. World and visual state

- The 2D world renders from baked terrain plus a decor manifest, with a canvas
  renderer, camera pan/zoom/pinch and a path-following character.
- **No browser verification has been done by the engineering agent** on any viewport.
  Mobile touch, reduced-motion, and animation stability are unproven.
- The student character sheet and the five quest medallions were generated
  procedurally and are **still awaiting founder approval**. Other generated art was
  rejected on quality and deleted rather than shipped.
- Asset licensing has **not** been verified. Before any public or commercial release,
  confirm the licence and attribution terms of every asset pack used.

## 9. Scope deliberately not built

Per the MVP exclusions: no mobile app, no multiplayer, no leaderboards, no private
messaging, no payments, no parent portal, no LMS integration, no 3D, no avatar
marketplace.

Also deferred on purpose: curriculum standards mapping (for example UAE MOE codes),
per-grade world regions, Arabic runtime strings, kindergarten and post-12 grades,
per-grade XP curves.

## 10. Operational realities

- **Deployed:** no. The MVP has never been deployed to any host.
- **Pushed:** no. Nothing is on a remote; the work exists on one machine.
- **Data:** synthetic demo data only. No real student data has been used, and none
  should be until guardian-consent and data-protection requirements are settled.
- **Cost:** no paid service is active. Enabling a live AI provider requires founder
  approval (plan §21.2).
