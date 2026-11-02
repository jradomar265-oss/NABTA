# Deployment guide — NABTA MVP

**Status:** the MVP has never been deployed. This document is the procedure, written
so that the first deployment is boring.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js | The project was built with Node 24. `node -v` before installing. |
| Supabase project | Free tier is sufficient for the MVP. |
| Host | Vercel is the intended target (Next.js native). |
| AI provider | **Optional.** Without one, NABTA runs in clearly-labelled mock mode. |

## 2. Environment variables

Create `.env.local` locally, and the same keys in the host's dashboard for production.

| Variable | Required | Example | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | `https://xxxx.supabase.co` | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | `sb_publishable_...` | Safe to expose; RLS does the work |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | — | Do **not** set this unless a server task needs it. It bypasses RLS. |
| `AI_PROVIDER` | no | `openai-compatible` \| `gemini` | Omit to stay in mock mode |
| `AI_BASE_URL` | with provider | `https://api.openai.com/v1` | OpenAI-compatible endpoints only |
| `AI_MODEL` | with provider | `gpt-4o-mini` | **Must be a real model id.** A wrong value becomes a 404 at request time. |
| `AI_API_KEY` | with provider | `sk-...` | Server-side only. Never prefix with `NEXT_PUBLIC_`. |

Rules:

- Nothing secret may be prefixed `NEXT_PUBLIC_`.
- `.env.local` is git-ignored. Confirm with `git check-ignore -v .env.local`.
- After changing any env value, **restart the dev server**. Next.js does not hot-reload
  server environment variables.

## 3. Database

### Fresh project

Run **`supabase/ALL_MIGRATIONS.sql`** once, in the SQL editor. It contains all
migrations verbatim in filename order.

It is deliberately **not idempotent** — a fresh install should fail loudly rather
than half-apply. If it fails part-way, the project is in a partial state: read the
error, fix the cause, and re-run from the failed section, not from the top.

### Existing project

Run **`supabase/PENDING_MIGRATIONS.sql`**. It contains only the migrations still
outstanding, chosen by inspecting the actual schema rather than by filename, and every
statement in it is safe to re-run.

### Migration order (for manual application)

| # | File | Adds |
|---|---|---|
| 1 | `202611010001_profiles.sql` | `app_role` enum, `profiles`, signup trigger |
| 2 | `..._0002_stage3_learning_core.sql` | classrooms, memberships, lessons, assignments, xp/level columns, RLS |
| 3 | `..._0003_lesson_study_progress.sql` | study progress |
| 4 | `..._0004_stage4_ai_lesson_understanding.sql` | `agent_runs`, `lesson_objectives` |
| 5 | `..._0005_stage5_challenges.sql` | assessments, questions, answer_keys |
| 6 | `..._0006_stage6_study_quests.sql` | submissions, answers, XP ledger, achievements, `submit_challenge` |
| 7 | `..._0007_stage7_learning_analysis.sql` | `learning_analyses` |
| 8 | `..._0008_stage8_companion.sql` | `companion_messages` |
| 9 | `..._0009_stage8_interventions.sql` | `assessments.kind`, `interventions` |
| 10 | `..._0010_stage9_comparability.sql` | `questions.difficulty`, `interventions.scope` |
| 11 | `..._0011_fix_student_lessons_policy.sql` | fixes the lessons RLS policy |
| 12 | `..._0012_education_context.sql` | grade, subject, curriculum on classrooms |
| 13 | `..._0013_fix_correlated_policies.sql` | fixes three correlated policies |

Regenerate the two bundled files after adding a migration:

```
node scripts/db/build-migration-files.mjs
```

## 4. Supabase settings to check

| Setting | Value | Why |
|---|---|---|
| Auth → Providers → Email | enabled | Only sign-in method used |
| Auth → Confirm email | your choice | Off is easier for a demo; on is correct for production |
| Auth → Site URL | your deployed URL | Otherwise confirmation links point at localhost |
| Auth → Redirect URLs | `http://localhost:3001/**` and the deployed URL | Called back after sign-in |
| Database → Extensions | `pgcrypto` available | Used by `gen_random_uuid()` |

Creating a teacher: sign up normally, then promote in the SQL editor.

```sql
update public.profiles set role = 'teacher'
where id = (select id from auth.users where email = 'teacher@test.com');
```

## 5. Local run

```
npm install
npm run dev -- -p 3001
```

The dev server runs on **3001**, not 3000.

```
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run build         # next build
npm run check:ai      # 6 offline AI suites, no network
npm run check:world   # world/camera/path/medallion checks
npm run check:live    # opt-in: makes one real provider call
```

**Windows note:** this project builds with `next build --webpack` because the native
SWC binary fails on this machine. Do not "simplify" the scripts back to plain
`next build` without testing on the target OS.

**Stop the dev server before `npm run build`.** They share `.next` and will corrupt
each other.

## 6. Deploy

1. Push the repository to GitHub (nothing is pushed yet).
2. Import it into the host.
3. Set every environment variable from §2 in the host dashboard.
4. Build command `npm run build`, output as the host detects for Next.js.
5. Deploy, then open the deployed URL and complete §7.

## 7. Pre-flight checklist

Run before declaring a deployment good.

**Database**
- [ ] `ALL_MIGRATIONS.sql` or `PENDING_MIGRATIONS.sql` applied without error
- [ ] `select count(*) from public.profiles` returns rows (signup trigger works)
- [ ] `answer_keys` returns **0 rows** to an authenticated student

**Auth and roles**
- [ ] Teacher can sign in and reach `/teacher`
- [ ] Student can sign in and reach `/student`
- [ ] A student hitting `/teacher` is refused, and a teacher hitting `/student` is refused
- [ ] Sign-out works and the session does not persist

**Product**
- [ ] Teacher creates a class with grade and subject
- [ ] Teacher creates a lesson and the analysis produces objectives
- [ ] Objectives can be approved; challenges can be generated, approved and published
- [ ] Student joins with the code and sees the quest
- [ ] Lesson text is visible to the student (this was broken before `0011`)
- [ ] Submitting grades correctly and awards XP exactly once
- [ ] Analytics runs; with one student it reports insufficient evidence
- [ ] An intervention cannot be assigned before it is approved

**World**
- [ ] Terrain renders, no missing images in the console
- [ ] Character walks the path; camera pans; pinch-zoom works on a touch device
- [ ] Locked/available/completed medallions match real progress
- [ ] With reduced motion enabled, no animation runs and nothing breaks

**Hygiene**
- [ ] No secrets in the repository (`git log -p | grep -i "api_key"`)
- [ ] `.env.local` is git-ignored
- [ ] Console has no errors on first load of `/`, `/teacher`, `/student`

## 8. Rollback

Migrations here have no down-migrations. To undo:

- **Restore from a Supabase backup** (Database → Backups) — the only complete undo.
- Or reverse a specific change by hand: policies and functions can be dropped and
  recreated from the numbered migration that introduced them. Tables cannot be
  un-dropped.

Take a manual backup before applying anything to a database holding data anyone cares
about.
