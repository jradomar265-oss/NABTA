# Development Log

## Open founder actions (carry forward until done)

1. **OpenAI credit.** Checked 2026-11-01: the key authenticates but the account returns `http-429 credit_balance_exhausted`. `AI_PROVIDER` is therefore commented out in `.env.local` and the app runs mock mode. To go live: add credit, uncomment `AI_PROVIDER`, restart the dev server, run `npm run check:live`. If a 404 appears then, the model name (`gpt-6.1-sol`) is not available to the account.
2. **Apply migrations `0004`, `0005`, `0006`** in the Supabase SQL editor, in order. Until then Stages 4–6 have no tables and nothing they write can persist.
3. **Run `supabase/tests/stage6_grading_check.sql`** after the migrations, then make one student submission and one teacher analysis to confirm the flows against the live database.
4. **Founder art review:** the student character sheet and the five quest medallions are still generated candidates.
5. **GitHub remote** is not configured, so nothing can be pushed.
6. **Not yet verified against a real database:** `answer_keys` invisibility to students, the publish gate, XP once-per-assessment, and the RLS on study progress.

## Stage 6 — Student Study Quest Experience

**Execution date:** 2026-11-01  
**Status:** Implemented; grading and RLS untested against a live database

### Implemented

- Migration `202611010006_stage6_study_quests.sql`: `submissions`, `student_answers`, `xp_transactions`, `achievements`, the pure helpers `xp_for_questions` / `level_for_xp`, and the `submit_challenge` RPC that grades and awards XP.
- Grading is server-only by construction: the client submits option indices, the RPC re-validates role, classroom membership, publication status and every index, compares against `answer_keys`, and writes the rows. Students have select-only grants on all four new tables, so no score, answer correctness or XP value can be produced or edited from a browser session.
- XP rewards understanding, never speed: 6 per correct answer, +10 for a full set; awarded once per assessment (unique constraint), so retakes cannot farm it. Levels are `1 + floor(xp/100)`.
- Explanations and the correct option are copied into `student_answers` at grading time, so a student can review feedback without ever reading `answer_keys`.
- New quest detail page `/student/quest/[assignmentId]`: approved objectives, lesson text, study button, challenge form, and a results view with per-question correctness, correct answer, explanation, score and XP.
- World integration: a graded submission turns the quest node into a new gold "mastered" medallion (5th state added to `generate_decor.py`), the HUD shows real level/XP progress and completed counts, and the quest panel links straight to the challenge.
- Student Home now has a real progress summary (level, total XP, challenges completed, lessons started) and a server-recorded achievements list.
- `supabase/tests/stage6_grading_check.sql`: founder-runnable assertions for the XP/level formulas and for the answer-key and grading privileges.

### Verification

- `npm run typecheck` — PASS (exit 0).
- `npm run lint` — PASS (exit 0, no warnings).
- `npm run build` — PASS (exit 0; `.next/server/app/student/quest` produced).
- `npm run check:world` — PASS, and now also asserts the TS XP/level display mirror against the same expected values used by the SQL assertions, plus the studied/completed medallion mapping.
- `npm run check:ai` — PASS (unchanged).
- Medallion sheet regenerated and inspected: 5 states at 32x36.
- `GET /` 200; `/student/quest/[id]` redirects to login without a session.
- **NOT TESTED:** the `submit_challenge` RPC, the new RLS policies, XP persistence and achievements against a live Supabase project — migration 0006 is not applied and no sessions were available. **NOT RUN:** `supabase/tests/stage6_grading_check.sql` (it needs the applied schema).

### Required Setup and Remaining Work

- Apply `202611010006_stage6_study_quests.sql`, then run `supabase/tests/stage6_grading_check.sql`.
- Run the student flow end to end: open a quest, submit answers, confirm score/XP/achievement persist, refresh, confirm the world shows the mastered medallion, and confirm a second submission does not award XP again.
- As a student session, confirm `select * from answer_keys` returns nothing and that `insert into xp_transactions` is denied.
- Known limitations: one XP award per assessment forever (no re-award for later mastery), no mastery confidence model, no objective-level breakdown yet (Stage 7), and `student_answers` keeps the correct option after submission by design.

## Stage 5 — AI Challenge Generation and Publishing

**Execution date:** 2026-11-01  
**Status:** Implemented in mock mode; live provider and database flows untested

### Implemented

- Migration `202611010005_stage5_challenges.sql`: `assessments` (one per lesson, `draft → approved → published`), `questions` (options as a plain `text[]` with **no correctness column**), and `answer_keys` (correct index + explanation, teacher-only). Trigger functions reject an answer index outside the option range, including when options are later shrunk. `agent_runs.kind` extended with `challenge_generation`.
- RLS: teachers manage their own assessments/questions/keys; students may read questions only for a `published` assessment whose lesson is assigned to their class; **students have no policy on `answer_keys` at all**, so answer keys are invisible at the row level rather than hidden by the UI.
- Generator layer: `parseChallenge()` validates structure (distinct options, correct index in range, exactly two options for true/false) **and grounding** (every question must reference an approved objective id). Deterministic mock generator with hand-checked answers for fractions; refuses unsupported topics and missing objectives instead of inventing questions. OpenAI-compatible generator shares the same `completeJson()` client as the analyser.
- Server actions: generate/regenerate (replaces questions, records a run on success *and* failure), edit question, delete question, approve, publish, unpublish. Status transitions are enforced server-side; any question change resets to `draft` and unpublishes.
- Teacher UI: `AssessmentPanel` inside each lesson (status badge, generator mode note, per-question editor with options/format/correct answer/explanation, objective link, approve and publish controls).
- Student surface: a published challenge appears as "N challenge questions published" on the quest panel. Answering and grading are explicitly Stage 6.

### Verification

- `npm run typecheck` — PASS (exit 0).
- `npm run lint` — PASS (exit 0, no warnings).
- `npm run build` — PASS (exit 0, `BUILD_ID` written).
- `npm run check:ai` — PASS, two suites: lesson analyser (validation, failure, determinism, provider resolution) and challenge generator (5 deterministic questions; hand-checked answers — 2/4 equivalent to 1/2, 6/8 → 3/4, 3/4 > 5/8; rejects out-of-range index, duplicate options, 3-option true/false, ungrounded objective, empty list, non-JSON; refuses unsupported topic; refuses to run with zero approved objectives).
- `npm run check:world` — PASS (unchanged).
- `GET /` 200 through the dev server.
- **NOT TESTED:** RLS behaviour of `answer_keys` and the publish gate against a live Supabase project — migrations 0004/0005 are not applied and no sessions were available. **NOT TESTED:** live provider generation (no credentials).

### Required Setup and Remaining Work

- Apply `202611010004_...` and `202611010005_...`, then run the teacher flow: approve objectives → generate → edit a question → approve → publish → confirm the student quest badge appears and disappears on unpublish.
- Confirm directly in Supabase (SQL editor, authenticated as a student) that `select * from answer_keys` returns no rows.
- No answering, submission, grading, feedback display, XP, analytics, or interventions yet (Stages 6–8).

## Stage 4 — AI Lesson Understanding

**Execution date:** 2026-11-01  
**Status:** Implemented in mock mode; live provider untested

### Implemented

- `src/lib/ai/` provider-independent layer: `LessonAnalyzer` interface, zod-validated output contract, deterministic mock analyser, OpenAI-compatible HTTP adapter, and `resolveLessonAnalyzer()` which chooses from server-only env vars and reports *why* it chose mock.
- Migration `202611010004_stage4_ai_lesson_understanding.sql`: `agent_runs` (every attempt, success **and** failure, with provider/model/duration/input size/repair flag) and `lesson_objectives` (statement, skills, evidence quote, `ai`/`teacher` source, approval flag). RLS: teachers own their rows; students can read only approved objectives for lessons assigned to their class.
- Server actions: analyse (replaces previous AI drafts, keeps teacher-authored ones), edit+approve, delete, add teacher objective, approve all. Every action re-checks the teacher role server-side.
- Teacher studio UI: per-lesson objectives panel with mock/live badge, last-run status (including failures), AI-draft/teacher-edit tags, editable statements and skills, per-objective approval, and an "approve all" shortcut.
- Student integration: approved objectives become the learning goal shown on the quest panel, falling back to the teacher's own note when nothing is approved yet.
- Checks: `npm run check:world` and `npm run check:ai` (schema rejection cases, determinism, short-lesson failure, provider resolution incl. half-configured fallback).

### Verification

- `npm run typecheck` — PASS (exit 0).
- `npm run lint` — PASS (exit 0).
- `npm run build` — PASS (exit 0, `BUILD_ID` written).
- `npm run check:ai` — PASS (4 mock objectives from the sample fractions lesson; invalid JSON, empty objective list, missing skills, too-short statement all rejected; mock deterministic across runs; short lesson raises a teacher-readable error; half-configured provider falls back to mock and names the missing variable).
- `npm run check:world` — PASS (unchanged from Stage 3).
- `GET /` 200 and `/teacher` 307 (redirect to login without a session) through the dev server.
- **NOT TESTED:** analyse → review → approve → student view against a live Supabase project (the migration is not applied yet, and no sessions were available). **NOT TESTED:** any live AI provider call — no credentials were configured, and none were purchased.

### Required Setup and Remaining Work

- Apply `202611010004_stage4_ai_lesson_understanding.sql` after the earlier migrations.
- Run the teacher flow end to end: analyse a lesson, edit an objective, approve it, confirm the student quest shows it and a draft does not.
- The AI layer writes `agent_runs` on every attempt, but the UI only surfaces the latest run per lesson; a run history view is not built.
- Evidence quotes come from the analyser, not from a verified retrieval step; grounding is only as good as the prompt.
- No assessment generation, grading, XP, analytics, or interventions yet (Stages 5–8).

## Stage 3 — Student Experience and Teacher Studio Foundations

**Execution date:** 2026-11-01  
**Status:** In progress — student world rebuilt on the approved tileset

### Implemented

- Added a Stage 3 migration for persisted learner onboarding, classroom membership, teacher-authored lessons, and lesson-to-class assignments.
- Added `202611010003_lesson_study_progress.sql`: RLS-scoped study progress with a `mark_lesson_studied` RPC. The table is select-only for clients; there is no client path to write completion or XP.
- Added RLS policies and server-validated actions for teacher class/lesson creation and assignment, student class-code enrolment, and student profile setup.
- Replaced both placeholder workspaces with data-backed teacher and student interfaces.
- Imported the founder-supplied `nabta_plains_16x16_individual_tiles` pack as `source/plains-tileset.png` (byte-for-byte copy) with its supplier manifest, and produced a palette-harmonized atlas that maps its greens onto the approved forest ramp and its soil onto the approved brown ramp. Every mapping is recorded in `manifests/plains.json`.
- Composed a real pixel-art region: `regions/forest-clearing/terrain.png` (960x640) — flat grass tile plus authored grass tufts lifted from the atlas, a terrace band, a river with foam banks, a bridge deck, and a dithered dirt path — plus `decor.json` with the path, six quest node slots and 208 depth-sorted objects.
- Generated a student character sheet (16x24, 18 frames: idle/walk x down/side/up) as an explicit candidate, and quest-node medallions (available/active/completed/locked).
- Replaced the SVG placeholder world with a canvas renderer: camera pan/zoom/pinch/boundaries/recentre, Y-sorted sprites and character, path-following movement, real quest states, `prefers-reduced-motion`, and a keyboard-accessible quest list.
- Restored the accidentally deleted `.env.example`.

### Verification

- `npm.cmd run typecheck` — PASS (exit 0).
- `npm.cmd run lint` — PASS (exit 0).
- `npm.cmd run build` — PASS (exit 0, `BUILD_ID` written; the known Windows SWC warnings remain).
- `python scripts/pixel-art/import_plains_tileset.py` — PASS (151 tiles, harmonized atlas + manifest written).
- `python scripts/pixel-art/build_world.py` — PASS (208 objects, 6 nodes).
- `python scripts/pixel-art/validate_world.py` — PASS (nodes on path, objects clear of path, sprite files resolve).
- `node --experimental-strip-types scripts/student-world/check_systems.mjs` — PASS (path sampling, camera clamp/zoom, medallion mapping).
- Asset delivery from the dev server — PASS (layout JSON, terrain, character sheet, node sheet and approved sprites all return 200).
- `GET /` and `/student` compile and serve through the dev server. **Authenticated in-browser verification of the world is NOT TESTED** — no session was available to this agent.

### Required Setup and Remaining Work

- Apply `supabase/migrations/202611010002_stage3_learning_core.sql` and `202611010003_lesson_study_progress.sql` after the profiles migration.
- Verify the class, join, assignment, study-progress, and wrong-role flows against the configured Supabase project.
- The generated character and quest medallions are **candidates pending founder approval**; previews are in `public/assets/nabta/world/previews/`.
- Generated trees were attempted and rejected for quality; the world currently uses a single approved tree silhouette (mirrored), so tree repetition is the main remaining art gap.
- XP is still never awarded, so the HUD level/XP bar always shows Level 1 with an empty bar. Mastery completion awaits the assessment stage.

### Art decisions taken in this stage

- Palette direction: harmonize the plains pack toward the approved forest sprites rather than mixing two palettes.
- Terrain role: plains pack supplies ground, cliffs and water; props stay the founder-approved forest sprites.
- Character: generated as a candidate, not silently shipped as final art.

## Stage 1 — Foundation and Project Architecture

**Execution date:** 2026-11-01
**Status:** Partially complete

### Implemented

- Created the Next.js App Router foundation with TypeScript, Tailwind CSS, ESLint, and npm.
- Added NABTA landing and sign-in entry screens.
- Added Supabase SSR server client, session-cookie refresh, password sign-in, and sign-out.
- Added server-side student and teacher role checks on protected, request-dynamic route layouts.
- Added a profiles migration with student-default roles, owner-scoped RLS, and role update protection through column grants.
- Preserved all three supplied PNG source files in `Pixel Art/`; dimensions are 256x256, 256x256, and 352x192 (RGBA).

### Verification

- `npm run typecheck` — PASS.
- `npm run lint` — PASS.
- `npm run build` (webpack) — PASS; all five application routes compiled.
- Browser smoke checks — PASS for rendered Tailwind styles, mobile overflow, disabled sign-in without Supabase, and student/teacher redirects without configuration.
- Supabase Auth endpoint — PASS; settings endpoint returned HTTP 200 using the local publishable key (value not logged).
- Profiles API/schema — PASS for table presence; the zero-row anonymous query returned `42501` (permission denied), as expected for an authenticated-only table.
- Student and teacher sign-in/workspace routing — PASS per founder's manual browser verification.
- Wrong-role denial and authenticated RLS behavior — NOT TESTED.
- Default Turbopack build — FAIL on this Windows environment because its native binding is invalid. Project scripts use webpack and Tailwind's PostCSS plugin instead.

### Remaining Stage 1 Work

- Verify wrong-role denial and authenticated RLS behavior against the configured project.
- No GitHub remote is configured, so push cannot be completed until repository access is provided.

### Git

- Implementation commit: `5667fba` (`feat(stage-01): establish NABTA foundations`).
- Push status: BLOCKED; no GitHub remote is configured.

No AI functionality, lesson workflow, assessment workflow, grading, XP, or Pixel Art world was implemented in this stage.

## Stage 2 — Pixel Art Asset Pipeline and Student World Foundation

**Execution date:** 2026-11-01
**Status:** Partially complete

### Implemented

- Copied all three source sheets to `public/assets/nabta/world/source/`; the originals remain unchanged and SHA-256 checks match.
- Recorded dimensions, RGBA mode, transparency counts, partial-alpha values, and source hashes.
- Generated 71 8-connected object-component crops and labeled previews; every crop is marked `pending_manual_review` and is not approved for UI use.
- Generated 8, 16, 32, and 64 pixel terrain-grid previews; 16px best fits the occupied bounds and visual seams, so 62 nonempty 16x16 cells are exported as unconfirmed tile candidates.
- Added asset pipeline unit tests and an output validator that checks source hashes, crop dimensions, alpha mode, pixel equality, and review flags.
- Added a browser region editor and analyzer overrides so separate manual crops can be defined inside one connected alpha component.
- Imported 37 founder-approved user-drawn regions for `forest_demo_objects.png`; original coordinates are preserved and approved crops are under `sprites/approved/`.
- Split the mixed C03 component into separate `c03_plant` and `c03_wood` regions; the merged automatic component is marked superseded when all source pixels are covered by manual crops.

### Verification

- `python -m unittest discover -s scripts/pixel-art -p "test_*.py"` — PASS (9 tests, including connected-frame splitting, approval routing, terrain extraction, and review flags).
- `python scripts/pixel-art/analyze_sheets.py` — PASS; 3 sheets analyzed, 71 automatic and 37 manual object crops plus 62 terrain candidates generated.
- `python scripts/pixel-art/validate_assets.py` — PASS; 37 approved manual crops, 44 remaining object candidates, 62 terrain candidates, and 27 superseded components validated.
- Manual box review flags — 12 approved regions overlap another box; 6 are large; region 018 is 61x85. C03 is superseded by its plant/wood boxes.
- Visual preview inspection — PASS for reviewability; several grouped components remain ambiguous and unapproved.
- Browser region editor — PASS; loaded a real source sheet and drew two distinct regions within its coordinate frame.
- Editor coordinate mapping — PASS; at a responsive 650.5px CSS canvas size, a drag at source (200, 20) reports (200, 20) and paints the box at the corresponding 3x backing-pixel location.

### Remaining Stage 2 Work

- Confirm whether 16px is the actual terrain grid before promoting those tile candidates.
- The student-world renderer and quest path are not integrated. No real quest data exists yet, and fake quest states would violate the product requirements.
- Source asset license/attribution information is unavailable; verify before public or commercial distribution.

No procedural decorative assets or quest markers were added.

### Git

- Stage 2 commit: `c22169a` (`feat(stage-02): add pixel art asset analysis pipeline`).
- Manual segmentation correction: `a8cb494` (`fix(stage-02): support manual sprite regions`).
- User region import: `40159c2` (`feat(stage-02): import manual sprite regions`).
- C03 plant/wood split: `37cf9cc` (`fix(stage-02): split plant and wood from C03`).
- Approved manual sprites and terrain candidates: `9ca7548` (`feat(stage-02): approve sprites and extract terrain candidates`).
- Editor coordinate correction: `51b2d9b` (`fix(stage-02): align editor overlays with canvas scale`).
- Push status: BLOCKED; no GitHub remote is configured.
