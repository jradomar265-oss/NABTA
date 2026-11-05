/**
 * NABTA Stage 9 smoke suite.
 *
 *   npm run check:smoke
 *
 * Three layers, deliberately separated by what they can honestly prove:
 *
 *   static  — reads the migrations and source. Proves contracts exist (constraints,
 *             guards, policy qualifiers), never that the database behaves.
 *   http    — talks to the running app on localhost. Proves route guards.
 *   db      — needs SUPABASE_SERVICE_ROLE_KEY. Skipped, and reported as
 *             NOT VERIFIED, when the key is absent. It never silently passes.
 *
 * Nothing here writes to the database, calls a paid provider, or prints a secret.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const results = [];

function record({ id, area, assertion, result, evidence, limitation, maps }) {
  results.push({ id, area, assertion, result, evidence, limitation: limitation ?? "", maps: maps ?? "" });
}

function read(path) {
  try {
    return readFileSync(join(ROOT, path), "utf8");
  } catch {
    return null;
  }
}

function migrations() {
  const dir = join(ROOT, "supabase", "migrations");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => read(join("supabase", "migrations", name)) ?? "")
    .join("\n");
}

/** Runs one static assertion; a thrown error is a FAIL, never a silent skip. */
function staticCheck(spec, fn) {
  try {
    const { ok, evidence } = fn();
    record({ ...spec, result: ok ? "PASS" : "FAIL", evidence });
  } catch (error) {
    record({ ...spec, result: "FAIL", evidence: `threw: ${error.message}` });
  }
}

// ---------------------------------------------------------------- A/B source
const sql = migrations();
const sources = ["src/lib/ai/analysis.ts", "src/lib/learning/analysis.ts", "src/lib/learning/compare.ts", "src/lib/learning/comparability.ts", "src/lib/education/context.ts"]
  .map((path) => read(path) ?? "")
  .join("\n");

staticCheck(
  { id: "S-01", area: "D", maps: "D5", assertion: "Grading RPC exists with the documented signature", limitation: "Contract only; does not execute the RPC." },
  () => {
    const ok = /create (or replace )?function public\.submit_challenge\(p_assessment uuid, p_answers jsonb\)/.test(sql)
      && /security definer/.test(sql);
    return { ok, evidence: ok ? "submit_challenge(uuid, jsonb) security definer present" : "signature not found" };
  },
);

staticCheck(
  { id: "S-02", area: "D", maps: "D6", assertion: "XP is awarded at most once per assessment inside the RPC", limitation: "Proves the guard exists; execution evidence lives in TEST_REPORT D6." },
  () => {
    const hasConflict = /insert into public\.xp_transactions[\s\S]{0,400}?on conflict \(student_id, source_type, source_id\) do nothing/.test(sql);
    const hasFoundGuard = /if found then[\s\S]{0,300}?update public\.profiles/.test(sql);
    const hasPrecheck = /v_existing = 0/.test(sql);
    return { ok: hasConflict && hasFoundGuard && hasPrecheck, evidence: `on-conflict=${hasConflict} found-guard=${hasFoundGuard} precheck=${hasPrecheck}` };
  },
);

staticCheck(
  { id: "S-03", area: "H", maps: "H1", assertion: "XP ledger has a unique (student, source_type, source_id) constraint", limitation: "Schema contract." },
  () => {
    const ok = /xp_transactions[\s\S]{0,600}?unique \(student_id, source_type, source_id\)/.test(sql);
    return { ok, evidence: ok ? "unique (student_id, source_type, source_id) present" : "not found" };
  },
);

staticCheck(
  {
    id: "S-04",
    area: "I",
    maps: "I5",
    assertion: "No RLS policy gives students access to answer_keys",
    limitation:
      "0005:111 grants select/insert/update/delete on answer_keys to `authenticated` (teachers write keys through the same role). RLS is therefore the ONLY protection for answer keys; a permissive policy or disabled RLS would expose them. Row-level denial is proven in TEST_REPORT E4/C6.",
  },
  () => {
    const policyBlocks = [...sql.matchAll(/create policy "([^"]+)"\s+on public\.answer_keys[^;]*;/g)].map((match) => match[0]);
    const studentFacing = policyBlocks.filter((block) => /auth\.uid\(\)/.test(block) && !/is_teacher|teacher_id/.test(block));
    const broadGrant = /grant select, insert, update, delete on public\.answer_keys to authenticated/.test(sql);
    return {
      ok: policyBlocks.length > 0 && studentFacing.length === 0,
      evidence: `${policyBlocks.length} answer_keys policies, ${studentFacing.length} student-facing, table-grant-to-authenticated=${broadGrant}`,
    };
  },
);

staticCheck(
  { id: "S-05", area: "I", maps: "I5", assertion: "Lessons policy qualifies the outer table (0011 regression)", limitation: "Source text; the live policy is proven in E4." },
  () => {
    const ok = /la\.lesson_id = public\.lessons\.id/.test(sql);
    return { ok, evidence: ok ? "public.lessons.id qualifier present" : "outer qualifier missing" };
  },
);

staticCheck(
  { id: "S-06", area: "I", maps: "I2", assertion: "Objectives, assessments and companion policies qualify the outer table (0013)", limitation: "Source text." },
  () => {
    const objectives = /la\.lesson_id = public\.lesson_objectives\.lesson_id/.test(sql);
    const assessments = /la\.lesson_id = public\.assessments\.lesson_id/.test(sql);
    const companion = /la\.lesson_id = public\.companion_messages\.lesson_id/.test(sql);
    return { ok: objectives && assessments && companion, evidence: `objectives=${objectives} assessments=${assessments} companion=${companion}` };
  },
);

staticCheck(
  { id: "S-07", area: "F", maps: "F5", assertion: "No AI prompt hardcodes a single grade", limitation: "Source scan; a live model could still deviate." },
  () => {
    const prompts = ["src/lib/ai/prompts.ts", "src/lib/ai/companion.ts", "src/lib/ai/analysis.ts", "src/lib/ai/challenge-http.ts"]
      .map((path) => read(path) ?? "")
      .join("\n");
    const ok = !/Grade 6/.test(prompts);
    return { ok, evidence: ok ? "no 'Grade 6' literal in prompt modules" : "'Grade 6' literal still present" };
  },
);

staticCheck(
  { id: "S-08", area: "G", maps: "G5", assertion: "Comparison refuses unequal question counts", limitation: "Logic present; refused pair shown in TEST_REPORT G5." },
  () => {
    const ok = /MAX_COUNT_DRIFT/.test(sources) && /Not directly comparable/.test(sources);
    return { ok, evidence: `count-drift-rule=${/MAX_COUNT_DRIFT/.test(sources)} not-comparable-wording=${/Not directly comparable/.test(sources)}` };
  },
);

staticCheck(
  { id: "S-09", area: "G", maps: "G6", assertion: "Causal claims are hard-coded false", limitation: "Source text." },
  () => {
    const compare = read("src/lib/learning/compare.ts") ?? "";
    const ok = /causalClaim: false/.test(compare);
    return { ok, evidence: ok ? "causalClaim: false present" : "causal claim not pinned" };
  },
);

staticCheck(
  { id: "S-10", area: "D", maps: "D7", assertion: "Retakes are not offered: the submit form is hidden once a submission exists", limitation: "Documents the limitation rather than testing a feature that does not exist." },
  () => {
    const quest = read("src/app/student/quest/[assignmentId]/page.tsx") ?? "";
    const hidden = /\{!submission && \(/.test(quest);
    const noRetake = !/\?retake=/.test(quest);
    return { ok: hidden && noRetake, evidence: `form-hidden=${hidden} retake-affordance=${!noRetake}` };
  },
);

staticCheck(
  { id: "S-11", area: "J", maps: "J1", assertion: "Consolidated SQL bundles cover every migration verbatim", limitation: "Byte containment, not execution." },
  () => {
    const dir = join(ROOT, "supabase", "migrations");
    const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".sql")).sort() : [];
    const bundle = read("supabase/ALL_MIGRATIONS.sql") ?? "";
    const missing = files.filter((name) => !bundle.includes((read(join("supabase", "migrations", name)) ?? "").trimEnd()));
    return { ok: files.length > 0 && missing.length === 0, evidence: `${files.length} migrations, ${missing.length} missing from bundle` };
  },
);

staticCheck(
  { id: "S-12", area: "J", maps: "J1", assertion: "Stage 9 documents exist", limitation: "Presence only." },
  () => {
    const docs = ["docs/TEST_REPORT.md", "docs/KNOWN_LIMITATIONS.md", "docs/DEPLOYMENT.md", "docs/E2E_VERIFICATION.md"];
    const missing = docs.filter((path) => !existsSync(join(ROOT, path)));
    return { ok: missing.length === 0, evidence: `missing: ${missing.join(", ") || "none"}` };
  },
);

staticCheck(
  { id: "S-13", area: "I", maps: "I4", assertion: "No service-role key is referenced from application source", limitation: "Text scan; cannot prove absence in other files." },
  () => {
    const dir = join(ROOT, "src");
    const hits = [];
    const walk = (path) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && /SERVICE_ROLE/.test(readFileSync(full, "utf8"))) hits.push(full);
      }
    };
    if (existsSync(dir)) walk(dir);
    return { ok: hits.length === 0, evidence: `${hits.length} file(s) reference SERVICE_ROLE` };
  },
);

staticCheck(
  {
    id: "S-14",
    area: "D",
    maps: "H3",
    assertion: "submit_challenge rejects every status other than published",
    limitation: "Source evidence. The database cannot verify this retrospectively because publish history is not stored.",
  },
  () => {
    const gate = sql.match(/if v_status <> 'published' then\s*\n\s*raise exception 'That challenge is not published yet'/);
    return { ok: Boolean(gate), evidence: gate ? "gate found: v_status <> 'published' raises" : "no strict published gate in submit_challenge" };
  },
);

// ------------------------------------------------------------------- HTTP
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3001";

async function httpCheck({ id, area, maps, assertion, path, expect, limitation }) {
  try {
    const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const location = response.headers.get("location") ?? "";
    const ok = expect === "redirect"
      ? response.status >= 300 && response.status < 400 && location.includes("/login")
      : response.status === 200;
    record({ id, area, maps, assertion, result: ok ? "PASS" : "FAIL", evidence: `${path} -> ${response.status}${location ? ` location=${location}` : ""}`, limitation: limitation ?? "" });
  } catch (error) {
    record({ id, area, maps, assertion, result: "NOT VERIFIED", evidence: `server unreachable at ${BASE}: ${error.message}`, limitation: "Start the app with `npm run dev -- -p 3001`." });
  }
}

await httpCheck({ id: "H-01", area: "I", maps: "I6", assertion: "Anonymous visitor can load the sign-in page", path: "/login", expect: "ok" });
await httpCheck({ id: "H-02", area: "I", maps: "I1", assertion: "Anonymous visitor is redirected away from /teacher", path: "/teacher", expect: "redirect" });
await httpCheck({ id: "H-03", area: "I", maps: "I1", assertion: "Anonymous visitor is redirected away from /student", path: "/student", expect: "redirect" });
await httpCheck({ id: "H-04", area: "I", maps: "I2", assertion: "Anonymous visitor is redirected away from a classroom analytics page", path: "/teacher/classrooms/a0000000-0000-4000-8000-000000000001", expect: "redirect" });

// --------------------------------------------------------------------- DB
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const studentEmail = process.env.SMOKE_STUDENT_EMAIL;
const studentPassword = process.env.SMOKE_STUDENT_PASSWORD;

const dbChecks = [
  { id: "DB-01", area: "H", maps: "H1", assertion: "No duplicate XP transactions per assessment" },
  { id: "DB-02", area: "H", maps: "H2", assertion: "Every stored grade matches its answer key" },
  { id: "DB-04", area: "H", maps: "H4", assertion: "No intervention is assigned without approval" },
  { id: "DB-05", area: "H", maps: "D8", assertion: "Every student's XP equals their ledger total" },
  { id: "DB-06", area: "C", maps: "C4", assertion: "Every question has an answer key" },
];

/**
 * Authenticated student checks use a REAL signed-in session with the publishable key,
 * never the service role. Without student credentials this is reported NOT VERIFIED:
 * an unauthenticated request would prove nothing, and service-role access proves the
 * opposite of what the assertion is about.
 */
const NON_MEMBER_CLASSROOM = "66232e05-78e4-4472-b208-067af60e8227";
const OWN_CLASSROOM = "a0000000-0000-4000-8000-000000000001";
const IMPERSONATION_NOTE =
  "Supporting evidence only: SQL JWT impersonation on 2026-11-03 returned exactly this student's two classrooms and excluded 66232e05. Impersonation is not a PostgREST authentication test.";

const authChecks = [
  { id: "AUTH-01", area: "I", maps: "C6", assertion: "A signed-in student selects zero rows from answer_keys" },
  { id: "AUTH-02", area: "I", maps: "I2", assertion: "A signed-in student cannot read a classroom they are not enrolled in" },
  { id: "AUTH-03", area: "I", maps: "I2", assertion: "The same session CAN read its own classroom (positive control for AUTH-02)" },
];

if (!studentEmail || !studentPassword || !supabaseUrl || !publishableKey) {
  for (const check of authChecks) {
    record({
      ...check,
      result: "NOT VERIFIED",
      evidence:
        "SMOKE_STUDENT_EMAIL / SMOKE_STUDENT_PASSWORD (and NEXT_PUBLIC_SUPABASE_URL/KEY) not set, so no real student session exists",
      limitation:
        (check.id === "AUTH-02" ? `${IMPERSONATION_NOTE} ` : "") +
        "Simulating the result with the service role or an unauthenticated request would not test the policy.",
    });
  }
} else {
  const { createClient } = await import("@supabase/supabase-js");
  const student = createClient(supabaseUrl, publishableKey, { auth: { persistSession: false } });
  const { error: signInError } = await student.auth.signInWithPassword({ email: studentEmail, password: studentPassword });

  if (signInError) {
    for (const check of authChecks) {
      record({ ...check, result: "FAIL", evidence: `sign-in failed: ${signInError.message}`, limitation: "" });
    }
  } else {
    const keys = await student.from("answer_keys").select("question_id").limit(5);
    record({
      id: "AUTH-01",
      area: "I",
      maps: "C6",
      assertion: "A signed-in student selects zero rows from answer_keys",
      result: !keys.error && (keys.data ?? []).length === 0 ? "PASS" : "FAIL",
      evidence: `rows=${(keys.data ?? []).length}${keys.error ? ` error=${keys.error.message}` : ""}`,
      limitation: "Proves the policy denies rows for this student. Does not prove the grant is minimal.",
    });

    const foreign = await student.from("classrooms").select("id, name").eq("id", NON_MEMBER_CLASSROOM);
    record({
      id: "AUTH-02",
      area: "I",
      maps: "I2",
      assertion: "A signed-in student cannot read a classroom they are not enrolled in",
      result: !foreign.error && (foreign.data ?? []).length === 0 ? "PASS" : "FAIL",
      evidence: `classroom ${NON_MEMBER_CLASSROOM} rows=${(foreign.data ?? []).length}${foreign.error ? ` error=${foreign.error.message}` : ""}`,
      limitation: "The row exists, so zero rows is meaningful. Child-table isolation still needs content in that classroom.",
    });

    const own = await student.from("classrooms").select("id, name").eq("id", OWN_CLASSROOM);
    record({
      id: "AUTH-03",
      area: "I",
      maps: "I2",
      assertion: "The same session CAN read its own classroom (positive control for AUTH-02)",
      result: !own.error && (own.data ?? []).length === 1 ? "PASS" : "FAIL",
      evidence: `classroom ${OWN_CLASSROOM} rows=${(own.data ?? []).length}${own.error ? ` error=${own.error.message}` : ""}`,
      limitation: "Without this control, an AUTH-02 zero could equally mean the session never established.",
    });

    await student.auth.signOut();
  }
}

if (!serviceKey || !supabaseUrl) {
  for (const check of dbChecks) {
    record({
      ...check,
      result: "NOT VERIFIED",
      evidence: "SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) not set in this shell",
      limitation: "Run `supabase/tests/e2e_checkpoints.sql` in the SQL editor, or export the key.",
    });
  }
} else {
  for (const check of dbChecks) {
    record({
      ...check,
      result: "NOT VERIFIED",
      evidence: "a service-role key was supplied but no read-only SQL runner exists yet",
      limitation: "Needs a read-only SQL path (pg or a Postgres RPC); deferred rather than faked.",
    });
  }
}

// ------------------------------------------------ externally verified evidence
/**
 * Observations a human verified in the Supabase SQL editor, with the date. These are
 * recorded separately from executed checks because this runner cannot see grants or
 * policy expressions without a SQL path. They are labelled as external so a PASS here
 * never reads like a machine-verified result.
 */
const EXTERNAL_NOTE = "Recorded from a SQL editor verification on 2026-11-03; this runner cannot observe grants or policy text.";

if (process.env.SMOKE_SKIP_EXTERNAL !== "1") {
  record({
    id: "DB-07",
    area: "H",
    maps: "S-04",
    assertion: "authenticated holds SELECT, INSERT and UPDATE on answer_keys, and no DELETE (0014)",
    result: "PASS",
    evidence: "information_schema.role_table_grants: authenticated = INSERT, SELECT, UPDATE. DELETE absent. anon holds no privileges.",
    limitation: EXTERNAL_NOTE,
  });
  record({
    id: "DB-08",
    area: "I",
    maps: "S-04",
    assertion: "answer_keys has RLS enabled and FORCE RLS disabled",
    result: "PASS",
    evidence: "pg_class: relrowsecurity = true, relforcerowsecurity = false — submit_challenge's SECURITY DEFINER read path remains intact.",
    limitation: EXTERNAL_NOTE,
  });
  record({
    id: "DB-03",
    area: "H",
    maps: "H3",
    assertion: "No submission was accepted while its assessment was unpublished",
    result: "NOT VERIFIED",
    evidence:
      "Withdrawn as a current-state check: it compared submissions to today status, which flags a legitimate publish -> submit -> unpublish sequence (unpublishAssessment sets status=approved and published_at=NULL). The 3fb7d820 submission is explained by exactly that.",
    limitation:
      "Unverifiable retrospectively: the schema records only the latest publish state, with no unpublished_at and no publish history. The behaviour itself is asserted statically in S-14.",
  });
  record({
    id: "DB-09",
    area: "I",
    maps: "C6",
    assertion: "answer_keys has exactly one policy: teachers, ALL, correct USING and WITH CHECK",
    result: "PASS",
    evidence: `pg_policies: 1 row, "Teachers manage answer keys on their own assessments", cmd=ALL, roles={authenticated}, both expressions require q.id = answer_keys.question_id AND a.teacher_id = (select auth.uid()).`,
    limitation: `${EXTERNAL_NOTE} Policy text proves intent; the row-level denial for a student is still unexercised (see AUTH-01).`,
  });
}

// ------------------------------------------------------------------ report
const counts = { PASS: 0, FAIL: 0, "NOT VERIFIED": 0, "NOT APPLICABLE": 0 };
for (const item of results) counts[item.result] += 1;

const pad = (value, width) => String(value).padEnd(width);
console.log("");
console.log(`${pad("ID", 8)}${pad("Area", 6)}${pad("Result", 15)}Assertion`);
console.log("-".repeat(110));
for (const item of results) {
  console.log(`${pad(item.id, 8)}${pad(item.area, 6)}${pad(item.result, 15)}${item.assertion}`);
}
console.log("-".repeat(110));
console.log(`PASS ${counts.PASS}  FAIL ${counts.FAIL}  NOT VERIFIED ${counts["NOT VERIFIED"]}  NOT APPLICABLE ${counts["NOT APPLICABLE"]}`);

const markdown = [
  "# NABTA smoke test report",
  "",
  "Generated by `npm run check:smoke`. Do not edit by hand.",
  "",
  `**Generated:** ${new Date().toISOString()}`,
  `**App under test:** ${BASE}`,
  "",
  "A PASS here means the specific assertion was observed. It does not mean the area is verified:",
  "the manual assertions in `docs/TEST_REPORT.md` remain the authority, and this suite only",
  "upgrades an original assertion when its evidence is equivalent or stronger.",
  "",
  "| Test ID | Area | Assertion | Result | Evidence | Limitation |",
  "|---|---|---|---|---|---|",
  ...results.map((item) => `| ${item.id} | ${item.area} | ${item.assertion} | **${item.result}** | ${item.evidence.replace(/\|/g, "\\|")} | ${item.limitation.replace(/\|/g, "\\|")} |`),
  "",
  "## Totals",
  "",
  `- PASS: **${counts.PASS}**`,
  `- FAIL: **${counts.FAIL}**`,
  `- NOT VERIFIED: **${counts["NOT VERIFIED"]}**`,
  `- NOT APPLICABLE: **${counts["NOT APPLICABLE"]}**`,
  "",
  "## Skipped, and why",
  "",
  "| Area | Not automated | Reason |",
  "|---|---|---|",
  "| B | Camera bounds, pinch-zoom, reduced motion, pixel crispness | Needs a real browser and a touch device; partially covered by `npm run check:world` |",
  "| C | Publishing before approval, question-edit reset | Requires authenticated teacher actions; not reachable without a session |",
  "| D | RPC execution, XP award | Requires the database; executed manually and recorded in TEST_REPORT D |",
  "| E | Companion grounding and refusal | Requires a live session; recorded in TEST_REPORT E |",
  "| G | Approve/assign ordering | App-enforced only; the database does not constrain it |",
  "| I | Cross-class data access | Needs two authenticated students; proven manually in E4 |",
  "",
  "## Tests requiring a real touch device",
  "",
  "- Pinch-zoom on the world canvas.",
  "- Tap targets on the quest and companion forms.",
  "",
  "## Tests requiring manual visual confirmation",
  "",
  "- Pixel art crispness at non-integer zoom.",
  "- Character animation without flicker.",
  "- Mobile layout of the teacher analytics table.",
  "",
];

writeFileSync(join(ROOT, "docs", "SMOKE_TEST_REPORT.md"), markdown.join("\n"), "utf8");
console.log("");
console.log("report written to docs/SMOKE_TEST_REPORT.md");

if (counts.FAIL > 0) process.exit(1);
