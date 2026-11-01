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
```

The build and dev scripts use webpack because the installed Next.js native Turbopack binding is incompatible with this Windows environment.

## Stage 1 Architecture

- Next.js App Router and TypeScript provide the application and server-rendered route foundation.
- Supabase Auth sessions use `@supabase/ssr`; `proxy.ts` refreshes cookies, and server layouts independently verify the signed-in user and database role.
- `profiles` stores the trusted `student` or `teacher` role. RLS restricts profile reads/updates to the owner, and column grants prevent users from changing their role.
- New accounts default to student. Teacher role assignment is an administrator action; public sign-up is not exposed.
- Original Pixel Art sources remain unchanged in `Pixel Art/`; canonical copies, founder-approved manual sprites, and review-only automatic candidates are under `public/assets/nabta/world/`. They are not integrated into the student UI.

## Pixel Art Analysis

The source analysis workflow, generated previews, crop approval rules, and validation commands are documented in [scripts/pixel-art/README.md](scripts/pixel-art/README.md). Founder-approved manual sprites are under `public/assets/nabta/world/sprites/approved/`; automatic alpha-component detections remain diagnostic candidates. The terrain sheet has 16px tile candidates, but its grid is unconfirmed. Use the [Sprite Region Editor](http://localhost:3001/assets/nabta/world/tools/region-editor.html) to correct further object boundaries.

See [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) for verified progress and remaining Stage 1 checks.
