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
- Supabase connectivity, authentication end-to-end, and RLS behavior — NOT TESTED; project credentials and synthetic accounts are not configured.
- Default Turbopack build — FAIL on this Windows environment because its native binding is invalid. Project scripts use webpack and Tailwind's PostCSS plugin instead.

### Remaining Stage 1 Work

- Configure a Supabase project and apply the migration.
- Create synthetic accounts and verify sign-in, role denial, and RLS against the configured project.
- No GitHub remote is configured, so push cannot be completed until repository access is provided.

No AI functionality, lesson workflow, assessment workflow, grading, XP, or Pixel Art world was implemented in this stage.
