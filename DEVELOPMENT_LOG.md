# Development Log

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
- Generated 8, 16, 32, and 64 pixel candidate-grid previews for terrain without slicing terrain as sprites.
- Added asset pipeline unit tests and an output validator that checks source hashes, crop dimensions, alpha mode, pixel equality, and review flags.
- Added a browser region editor and analyzer overrides so separate manual crops can be defined inside one connected alpha component.

### Verification

- `python -m unittest discover -s scripts/pixel-art -p "test_*.py"` — PASS (6 tests, including connected-frame manual splitting).
- `python scripts/pixel-art/analyze_sheets.py` — PASS; 3 sheets analyzed, 71 candidate crops generated.
- `python scripts/pixel-art/validate_assets.py` — PASS; all generated assets validated.
- Visual preview inspection — PASS for reviewability; several grouped components remain ambiguous and unapproved.
- Browser region editor — PASS; loaded a real source sheet and drew two distinct regions within its coordinate frame.

### Remaining Stage 2 Work

- Founder review of object-component boundaries and the terrain grid; no crop is yet approved for app integration.
- The student-world renderer and quest path are not integrated. No real quest data exists yet, and fake quest states would violate the product requirements.
- Source asset license/attribution information is unavailable; verify before public or commercial distribution.

No procedural decorative assets or quest markers were added.

### Git

- Stage 2 commit: `c22169a` (`feat(stage-02): add pixel art asset analysis pipeline`).
- Manual segmentation correction: `a8cb494` (`fix(stage-02): support manual sprite regions`).
- Push status: BLOCKED; no GitHub remote is configured.
