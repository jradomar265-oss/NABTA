# NABTA

## Product Scope

NABTA is a student-first learning platform: **Learn. Play. Grow.** The current repository work establishes Stage 1 foundations only; classroom lessons, assessments, AI workflows, and the interactive world are not implemented yet.

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
- Pixel Art sources remain in `Pixel Art/` and are not yet integrated into the product.

See [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) for verified progress and remaining Stage 1 checks.
