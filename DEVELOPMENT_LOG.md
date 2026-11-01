# Development Log

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
