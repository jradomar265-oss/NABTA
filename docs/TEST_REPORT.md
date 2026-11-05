# Test report — NABTA MVP

**Test date:** 2026-11-03
**Sections run:** A (partial), D, E, F (partial), G (partial), H (partial), J
**Sections not run:** B, C, I

Status vocabulary used in this report:

| Status | Meaning |
|---|---|
| **PASS** | Observed behaviour matched the assertion, with recorded evidence |
| **FAIL** | Observed behaviour contradicted the assertion |
| **NOT VERIFIED** | Not exercised, or exercised without recorded evidence. Never a placeholder for "probably fine". |
| **NOT APPLICABLE** | The assertion cannot apply in the current build |

**Headline:** Stage 9 is **not complete**. The grading RPC has now been executed for
real and behaves correctly, but sections B, C and I have never run.

---

## Environment under test

| Field | Value |
|---|---|
| Date | 2026-11-03 |
| AI provider | **mock** (`AI_PROVIDER` unset) |
| Browser + OS | Chrome, Windows |
| Viewport(s) | desktop only |
| Database | Supabase project used by `.env.local` |
| Demo data | `supabase/seed_demo.sql` (Grade 8 Science — Ecosystems) |

---

## A. Student joins and reads a lesson

| # | Assertion | Result |
|---|---|---|
| A1 | Student signs in and reaches `/student` without error | **PASS** — `student@test.com` signed in and landed on `/student` |
| A2 | World renders; no missing-asset errors in the console | **NOT VERIFIED** — page rendered and was navigable, but the console was never inspected |
| A3 | Quest medallion for the assigned lesson is `available`, not `locked` | **NOT VERIFIED** — medallion state not recorded |
| A4 | Opening the quest shows the **lesson text** | **PASS** — the Food Chains lesson text was visible to the student (this is the `0011` policy fix) |
| A5 | Objectives listed match the approved ones | **NOT VERIFIED** — not compared against the database |

## B. World interaction

Never run. All assertions **NOT VERIFIED**: B1 movement, B2 camera bounds,
B3 pixel crispness on zoom, B4 pinch-zoom on a touch device, B5 locked/completed
states, B6 reduced-motion behaviour.

## C. Assess, approve, publish

**NOT RUN in this session.** The challenge and practice/follow-up rows in the database
were created by the seed, not through generation in this test.

| # | Assertion | Result |
|---|---|---|
| C1 | Generating challenges produces questions grounded in the lesson | **NOT VERIFIED** |
| C2 | Publishing before approval is refused | **NOT VERIFIED** |
| C3 | Approve → publish sets `status='published'` and `published_at` | **NOT VERIFIED** for generated content — see G2 for the intervention path, which does set both |
| C4 | `answer_keys` count equals question count | **NOT VERIFIED** — per-assessment key counts were observed (5 / 4 / 2 / 2) but not reconciled against question counts |
| C5 | Editing a question resets the assessment to `draft` | **NOT VERIFIED** |
| C6 | As the student, `select * from answer_keys` returns 0 rows | **NOT VERIFIED** by direct query. Indirect evidence: the duplicate-XP test had to build answers with the privileged role because the student role cannot read `answer_keys`. |
| C7 | An unpublished assessment is invisible to the student | **NOT VERIFIED** |

## D. Submit, grade, award XP

**This section is now genuinely verified.** The targeted practice had no prior
submission, so submitting it executed `public.submit_challenge()` for the first time.
Earlier in the session D had been mistakenly recorded as passing on the strength of a
**seeded** submission; that is corrected below.

| # | Assertion | Result |
|---|---|---|
| D1 | All questions render with their options | **PASS** — practice questions and their options rendered |
| D2 | Submitting returns a score immediately | **PASS** — real submission returned 2/2 |
| D3 | Every `student_answers` row: `is_correct = (choice_index = correct_index)` | **PASS** — two RPC-generated rows matched their stored correct indexes |
| D4 | Explanations shown only after answering | **PASS** — appeared after submission |
| D5 | `xp_awarded` > 0 and matches the XP rule | **PASS** — 22 XP for 2 questions (6 × 2 + 10 full-set bonus) |
| D6 | No second `xp_transactions` row on resubmission | **PASS** — a second RPC call inside a rolled-back transaction produced `attempt_no = 2`, `xp_awarded = 0`, ledger still one row; all four assertions true. A follow-up read confirmed the rollback: one persisted submission, latest attempt 1, one XP transaction, XP still 102 |
| D7 | `attempt_no` increments on a **user-facing** retake | **NOT VERIFIED through the UI.** The submit form is hidden once a submission exists, so no user can retake. The SQL rollback test exercised the increment at the database level, but that does not establish user-facing retake support |
| D8 | Student XP total equals the sum of ledger rows | **PASS** — 102 = 102 |
| D9 | Quest medallion flips to `completed` | **NOT VERIFIED** |
| D10 | Achievements award once each | **NOT VERIFIED** |

### D notes

- **Retakes are not implemented in the UI.** `src/app/student/quest/[assignmentId]/page.tsx:223`
  renders the submit form only when no submission exists. The RPC supports retakes;
  the interface does not offer them. This is a product decision, not a bug, but it
  means D7 cannot pass until retakes are built or explicitly dropped from scope.
- **XP transaction reason is hard-coded as `'Challenge completed'`** in
  `202611010006_stage6_study_quests.sql:245`, even for targeted practice and follow-up
  checks. Cosmetic today; misleading in a ledger a teacher inspects.
- **Attempt counter race:** `select coalesce(max(attempt_no),0)+1` (line 191) is a
  read-modify-write. Two concurrent submissions for the same student and assessment
  can compute the same value; `unique (student_id, assessment_id, attempt_no)` then
  rejects the loser. **XP cannot be duplicated** — the loser's whole transaction rolls
  back — but a double-click can surface a raw unique-constraint error instead of a
  retry. Not observed in testing; identified by inspection.

## E. Companion

| # | Assertion | Result |
|---|---|---|
| E1 | On-topic question answered from the lesson | **PASS** — answer quoted the lesson ("This is why food chains rarely have more than four or five links") |
| E2 | Off-topic question refused and labelled outside the lesson | **PASS** — football question refused with "That is not covered in this lesson, so I would only be guessing", labelled "Outside this lesson" |
| E3 | Both stored in `companion_messages` | **PASS** — two rows, the refused one with `refused = true` |
| E4 | A student cannot read another student's messages | **PASS** — authenticated-JWT simulation: `student2` saw 0 rows, `student@test.com` saw 2. The positive case rules out a vacuous zero. |

## F. Learning analysis

| # | Assertion | Result |
|---|---|---|
| F1 | Per-objective totals on screen match stored evidence | **PASS** — 3/6 and 2/2 shown, reconciling to the stored snapshot of 8 answers / 5 correct |
| F2 | `evidence_snapshot` totals equal the answers table | **PASS** — recomputed the class scope bounded to `created_at` and `submitted_at <= analysis time`: answers 8 = 8, correct 5 = 5, students 2 = 2, questions 4 = 4. Note the scope must be time-bounded: practice and follow-up were submitted later, so today's scoped total is 12 while the snapshot correctly froze 8. |
| F3 | With thin evidence, `insufficient_evidence` is true and the report says why | **PASS** — the thin objective was reported as needing more evidence; the class-level flag was correctly `false` because two students had answered |
| F4 | Every observation cites a number that appears above it | **PASS** — both observations cited their counts |
| F5 | No causal language | **PASS** — none observed in the mock output |
| F6 | Question-level comments reference real question ids only | **NOT VERIFIED** — question-level comments were not exercised against real data |
| F7 | A failed AI call is reported as failure, never success | **NOT VERIFIED** — no failure path was exercised |

### F notes

- `insufficient_evidence` is a **class-level** flag requiring two students. It can be
  `false` while an individual objective still lacks evidence. Both statements can be
  true at once; documented in `KNOWN_LIMITATIONS.md` §5b.
- Retakes are double-counted in the fact sheet (limitation §5a) — unchanged.

## G. Intervention and comparison

| # | Assertion | Result |
|---|---|---|
| G1 | Assigning before approval is refused | **NOT VERIFIED** — the Assign control only renders when status is `approved`, so the UI cannot offer it. The server guard exists (`src/app/actions/interventions.ts:229`) but was not exercised |
| G2 | Approve → assign sets `assigned` and publishes **both** assessments | **PASS** — intervention approved, then assigned; both practice and follow-up became `published` |
| G3 | Practice and follow-up appear as separate sections | **PASS** — both rendered as distinct sections on the quest |
| G4 | Both submissions stored against their own assessment | **PASS** — two real submissions, each against its own assessment id |
| G5 | Mock mode reads "Not directly comparable" | **NOT VERIFIED** — the comparison panel was not read after the submissions |
| G6 | The comparison states no causal claim | **NOT VERIFIED** — same |
| G7 | `scope = 'class'` and the rationale says it is class-wide | **NOT VERIFIED** — the stored rationale was not read back |

## H. Invariants

| # | Invariant | Result |
|---|---|---|
| H1 | No duplicate XP per assessment | **PASS for the tested pair** — the D6 transaction test left exactly one `xp_transactions` row for practice. The global duplicate scan was run once earlier and returned 0, but after later submissions it was not re-run. |
| H2 | Grading matches the stored key | **PASS** — `grading_mismatches = 0`, including RPC-generated rows |
| H3 | No submission was accepted while its assessment was unpublished | **NOT VERIFIED — unverifiable from stored state.** The original wording ("no submissions on unpublished assessments") was **withdrawn** because it compared submissions against *current* status and so flagged correct behaviour: `unpublishAssessment` sets `status='approved', published_at=null`, which is exactly the state seen for assessment `3fb7d820…`. Its submission is therefore legitimate (published → submitted → unpublished). `submit_challenge` rejects any status other than `published` (`0006:172`, asserted statically as S-14 in the smoke suite), but the schema stores no publish history, so the property cannot be checked retrospectively. |
| H4 | No intervention assigned without approval | **NOT VERIFIED** — not queried |

## I. Authorization matrix

**NOT RUN.** All assertions **NOT VERIFIED**: student → `/teacher`, student → another
class's assessments via PostgREST, teacher → `/student`, anon → protected routes,
student → `answer_keys`.

This is the highest-value remaining section. Section I is the only one that tests what
a *malicious* student could do rather than what a cooperative one sees — and it is where
the `0013` cross-class fixes would be proven.

## J. Technical checks

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | **PASS** |
| Lint | `npm run lint` | **PASS** (0 warnings) |
| Build | `npm run build` | **PASS** |
| AI suites (offline) | `npm run check:ai` | **PASS** (6 suites) |
| World suites | `npm run check:world` | **NOT VERIFIED** — not run in this session |
| Live provider | `npm run check:live` | **NOT VERIFIED** — no provider credit; not run |

---

## Defects found during this run

| # | Section | Severity | Description | Status |
|---|---|---|---|---|
| 1 | F/analysis | High | `const classroomId = parsed.data` assigned the zod result object, not the uuid inside it; PostgREST produced `22P02 invalid uuid: "[object Object]"`, which the swallowed error reported as "class could not be found" | **Fixed** |
| 2 | All teacher actions | Medium | Supabase errors were discarded, so a query failure and a missing row were indistinguishable | **Fixed in `analysis.ts` only**; `interventions.ts:39` still has the blind spot |
| 3 | D | Medium | A seeded submission made the graded-result panel look like a successful submission; `submit_challenge` had never executed while D was recorded as passing | **Corrected** — D re-tested for real |
| 4 | D/UI | Medium | Retakes are unreachable: the submit form is hidden once a submission exists | **Open** — product decision needed |
| 5 | D/RPC | Low | `xp_transactions.reason` hard-coded to `'Challenge completed'` for all assessment kinds | **Open** |
| 6 | D/RPC | Low | Attempt counter is a read-modify-write; concurrent submits can collide on the unique constraint (no duplicate XP) | **Open** |
| 7 | F | Low | Retakes double-counted in the analysis fact sheet | **Documented**, deliberately not fixed |
| 8 | Security | High | Four RLS policies compared a column to itself (`la.lesson_id = id`), mis-scoping lessons, objectives, assessments and the companion insert | **Fixed** in `0011` and `0013` |

## Sign-off

| Item | Value |
|---|---|
| Sections with any evidence | A, D, E, F, G, H, J |
| Sections with no run at all | **B, C, I** |
| Blocking defects open | 0 verified — but 4 open items above (1 medium decision, 3 low) |
| Safe to demonstrate | **Conditionally** — teacher + student core loop works end to end; the world (B), the generation pipeline (C) and the permission matrix (I) are unproven |
| Stage 9 complete | **No** |

**Standing rule:** a section with any blank or unrecorded assertion is not verified. No
stage may be declared complete because the interface looked correct.
