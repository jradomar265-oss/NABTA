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
- A live provider is used only when `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` are all set. A half-configured provider falls back to mock **and says which variable is missing**.
- All output passes a zod schema before anything is stored. A live model gets one bounded repair attempt; if the second response is also unusable the call fails and nothing is saved.
- Every attempt — success or failure — is written to `agent_runs`, so a failed call can never appear as a success.
- Objectives land in `lesson_objectives` as unapproved drafts tagged `AI draft` or `Teacher edit`. RLS lets students read only `approved = true` objectives for lessons assigned to their class. Approved objectives become the learning goal shown on the student's quest.

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

Apply in order from `supabase/migrations/`: `..._profiles.sql`, `..._stage3_learning_core.sql`, `..._lesson_study_progress.sql`, `..._stage4_ai_lesson_understanding.sql`.

See [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) for verified progress and known limitations.
