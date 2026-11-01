# NABTA

## Product Scope

NABTA is a student-first learning platform: **Learn. Play. Grow.** The repository has Stage 1 authentication foundations and a Stage 2 Pixel Art analysis pipeline. Classroom lessons, assessments, AI workflows, and the data-connected interactive world are not implemented yet.

## Local Setup

Requirements: Node.js 24 LTS and npm.

1. Install dependencies with `npm ci`.
2. Create `.env.local` in the repository root. It is ignored by Git. Add the Supabase project URL and publishable key:

   ```text
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

3. Run `supabase/migrations/202611010001_profiles.sql` in the Supabase SQL Editor.
4. Create accounts through Supabase Auth; new accounts receive the `student` role. Promote a teacher from the SQL Editor using an administrator-controlled query, for example:

   ```sql
   update public.profiles
   set role = 'teacher'
   where id = (select id from auth.users where email = 'teacher@example.com');
   ```

5. Start the app with `npm run dev`.

Without Supabase configuration, public pages build and run, while login is explicitly disabled and protected pages redirect to setup guidance. Do not put service-role keys in browser-visible environment variables.

## Checks

```text
npm run typecheck
npm run lint
npm run build
npm run check:world
npm run check:ai
```

`check:world` verifies quest nodes sit on the authored path, camera bounds and node-state mapping. `check:ai` compiles the AI layer and verifies structured-output validation, honest failure, deterministic mock output and provider resolution.

The build and dev scripts use webpack because the installed Next.js native Turbopack binding is incompatible with this Windows environment.

## AI Lesson Understanding

The teacher studio can analyse a saved lesson and turn it into learning objectives the teacher reviews before students see anything.

- `src/lib/ai/` is provider-independent: `LessonAnalyzer` is the only surface the app calls, and `resolveLessonAnalyzer()` picks the implementation from server-only environment variables.
- **Mock mode is the default.** With no AI variables set, analysis runs on fixed, deterministic rules over the lesson text. Every surface that shows the result labels it as mock. It exists so the workflow is testable with no spend, and it is never presented as real AI.
- **Google Gemini is the supported live provider** and is called natively: `x-goog-api-key` against `generativelanguage.googleapis.com`, no OpenAI account, key or SDK involved. Set `AI_PROVIDER=gemini`, `GEMINI_API_KEY` (or `AI_API_KEY`) and `AI_MODEL`. Google is mid-migration between two REST surfaces for text generation, so the adapter uses the current Interactions endpoint and falls back once to `generateContent` if the API says the former is unavailable; whichever answers is reused for the process lifetime.
- A generic `AI_PROVIDER=openai-compatible` adapter remains for any other OpenAI-shaped endpoint (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`). A half-configured provider falls back to mock **and says which variable is missing**.
- `npm run check:live` makes exactly one analysis and one challenge generation against the configured provider, prints what came back, stores nothing, and fails loudly if either breaks. Run it before relying on a live provider.
- All output passes a zod schema before anything is stored. A live model gets one bounded repair attempt; if the second response is also unusable the call fails and nothing is saved.
- Every attempt — success or failure — is written to `agent_runs`, so a failed call can never appear as a success.
- Objectives land in `lesson_objectives` as unapproved drafts tagged `AI draft` or `Teacher edit`. RLS lets students read only `approved = true` objectives for lessons assigned to their class. Approved objectives become the learning goal shown on the student's quest.

### Challenge generation and publishing

- A challenge set is generated from the lesson plus its **approved** objectives; generation is refused when no objective is approved, because every question must be tied to one.
- `questions.options` is a plain `text[]` with **no correctness column**, so a readable question row cannot reveal its answer. Correct index and explanation live in `answer_keys`, which has teacher-only policies and no student policy at all. Trigger functions keep the index inside the option range, including when options shrink.
- Teacher approval is enforced in the action, not the UI: `approve` requires at least one question, `publish` requires `status = 'approved'`, and any question edit or regeneration resets the set to `draft` (which hides it from students again).
- Students see a published challenge as a quest badge ("N challenge questions published"). Answering, grading and XP are Stage 6 — the student surface does not pretend otherwise.
- Generation attempts are recorded in `agent_runs` with `kind = 'challenge_generation'`.

### Study quests, grading and XP

- `/student/quest/[assignmentId]` is the quest detail page: approved objectives, the lesson text, the published challenge, and the student's result with explanations.
- **Grading exists only in the database.** `submit_challenge(assessment, answers)` is a `SECURITY DEFINER` function that re-checks the student role, classroom membership, publication status and every option index, compares against `answer_keys`, writes the submission and answers, and returns the per-question result. The client sends option indices and nothing else — no score, no correctness, no XP.
- Students have **no INSERT/UPDATE grant** on `submissions`, `student_answers`, `xp_transactions` or `achievements`; those tables are select-only, and rows appear only through the function.
- XP: `xp_for_questions(correct, total)` = 6 per correct answer, +10 for a full set, 0 for none — understanding, not speed. Awarded **once per assessment** (unique `student_id, source_type, source_id`), so retakes cannot farm it. Levels are `1 + floor(xp / 100)`.
- Feedback explanations and the correct option are copied into `student_answers` at grading time, so a student can review their own result without ever being able to read `answer_keys`.
- Submitting also records the lesson as studied, so the world advances; a graded submission turns the quest node into the gold "mastered" medallion.
- Achievements: `first_quest`, `perfect_score`, `steady_learner` (three different challenges). No streaks, no rankings, no speed bonuses.

## Stage 1 Architecture

- Next.js App Router and TypeScript provide the application and server-rendered route foundation.
- Supabase Auth sessions use `@supabase/ssr`; `proxy.ts` refreshes cookies, and server layouts independently verify the signed-in user and database role.
- `profiles` stores the trusted `student` or `teacher` role. RLS restricts profile reads/updates to the owner, and column grants prevent users from changing their role.
- New accounts default to student. Teacher role assignment is an administrator action; public sign-up is not exposed.
- Original Pixel Art sources remain unchanged in `Pixel Art/`; canonical copies, founder-approved manual sprites, and review-only automatic candidates are under `public/assets/nabta/world/`.

## Student World

The student home renders a real, data-driven pixel-art region instead of a mock map:

- `public/assets/nabta/world/regions/forest-clearing/` holds the composed ground layer (`terrain.png`) and the layout data (`decor.json`: path waypoints, six quest node slots, 208 depth-sorted objects).
- `src/features/student-world/` holds a canvas renderer with a camera (drag, wheel, pinch, zoom buttons, recentre), Y-sorted sprites, a path-following student character with idle/walk animation, and quest medallions that reflect persisted state.
- Quest state is derived server-side: the first unstudied lesson in a class is *available*, later lessons stay *locked*, and a persisted `lesson_study_progress` row marks a lesson *studied*. Studying is recorded through the `mark_lesson_studied` RPC; the table is select-only for clients and there is no client path to write completion or XP.
- `prefers-reduced-motion` is honoured (no pulse or walk frames). The quest list under the map is keyboard accessible and mirrors the map nodes.

## Pixel Art Analysis

The source analysis, palette harmonization, world composition, and validation commands are documented in [scripts/pixel-art/README.md](scripts/pixel-art/README.md). Founder-approved manual sprites are under `public/assets/nabta/world/sprites/approved/`; automatic alpha-component detections remain diagnostic candidates. Use the [Sprite Region Editor](http://localhost:3001/assets/nabta/world/tools/region-editor.html) to correct further object boundaries.

## Migrations

Apply in order from `supabase/migrations/`: `..._profiles.sql`, `..._stage3_learning_core.sql`, `..._lesson_study_progress.sql`, `..._stage4_ai_lesson_understanding.sql`, `..._stage5_challenges.sql`, `..._stage6_study_quests.sql`.

After applying migrations, run `supabase/tests/stage6_grading_check.sql` in the SQL editor. It writes nothing and verifies the XP/level formulas plus the answer-key and grading privileges.

See [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) for verified progress and known limitations.
