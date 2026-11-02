# Test report — NABTA MVP

**Sections A–G must be filled in one verification run.** Each row has an assertion and
an empty result cell. Do not mark a row PASS on the basis of the interface looking
right — the plan is explicit that this is not evidence.

---

## How to run

1. Apply `supabase/PENDING_MIGRATIONS.sql`.
2. Create the three accounts: `teacher@test.com`, `student@test.com`, `student2@test.com`.
3. Put those emails in `supabase/seed_demo.sql` (already set) and run it.
4. Start the dev server: `npm run dev -- -p 3001`.
5. Work through A–G. Run the matching block in `supabase/tests/e2e_checkpoints.sql`
   after each section and record the output.

**Environment under test**

| Field | Value |
|---|---|
| Date | |
| Commit | |
| AI provider | mock / live: |
| Browser + OS | |
| Viewport(s) tested | |
| Database | Supabase project ref: |

---

## A. Student joins and reads a lesson

| # | Assertion | Result |
|---|---|---|
| A1 | Student signs in and reaches `/student` without error | |
| A2 | World renders; no missing-asset errors in the console | |
| A3 | Quest medallion for the assigned lesson is `available`, not `locked` | |
| A4 | Opening the quest shows the **lesson text** (empty text = the `0011` bug is back) | |
| A5 | Objectives listed for the quest match the approved ones | |

## B. World interaction

| # | Assertion | Result |
|---|---|---|
| B1 | Character can be moved along the path | |
| B2 | Camera pans and does not expose empty space beyond the map edge | |
| B3 | Zoom keeps pixels crisp (no smoothing/blur) | |
| B4 | Pinch-zoom works on a real touch device | |
| B5 | Locked quests stay locked; completed quests show `completed` | |
| B6 | With reduced motion enabled, animation stops and nothing breaks | |

## C. Assess, approve, publish

| # | Assertion | Result |
|---|---|---|
| C1 | Generating challenges produces questions grounded in the lesson text | |
| C2 | **Publishing before approval is refused** | |
| C3 | Approve → publish sets `status='published'` and `published_at` | |
| C4 | `answer_keys` count equals question count (checkpoint C) | |
| C5 | Editing a question resets the assessment to `draft` | |
| C6 | As the student, `select * from answer_keys` returns **0 rows** | |
| C7 | An unpublished assessment is invisible to the student | |

## D. Submit, grade, award XP

| # | Assertion | Result |
|---|---|---|
| D1 | All questions render with their options | |
| D2 | Submitting returns a score immediately | |
| D3 | Every `student_answers` row: `is_correct = (choice_index = correct_index)` | |
| D4 | Explanations are shown only after answering | |
| D5 | `xp_awarded` is greater than zero and matches the XP rule | |
| D6 | **Resubmitting does not create a second `xp_transactions` row** | |
| D7 | `attempt_no` increments on a retake | |
| D8 | Student's XP total equals the sum of their ledger rows | |
| D9 | Quest medallion flips to `completed` after submission | |
| D10 | Achievements award once each (`first_quest`, `perfect_score`) | |

## E. Companion

| # | Assertion | Result |
|---|---|---|
| E1 | An on-topic question is answered and quotes the lesson | |
| E2 | An off-topic question is refused and labelled as outside the lesson | |
| E3 | The question and answer are stored in `companion_messages` | |
| E4 | A student cannot read another student's companion messages | |

## F. Learning analysis

| # | Assertion | Result |
|---|---|---|
| F1 | Per-objective totals on screen match checkpoint C | |
| F2 | `evidence_snapshot` totals **equal** the answers table | |
| F3 | With one student, `insufficient_evidence` is true and the report says why | |
| F4 | Every observation cites a number that appears above it | |
| F5 | No causal language ("because", "caused", "improved") | |
| F6 | Question-level comments reference real question ids only | |
| F7 | A failed AI call is reported as a failure, never as success | |

## G. Intervention and comparison

| # | Assertion | Result |
|---|---|---|
| G1 | **Assigning before approval is refused** | |
| G2 | Approve → assign sets `status='assigned'` and publishes **both** assessments | |
| G3 | Practice and follow-up appear as separate sections on the quest | |
| G4 | Both submissions are stored against their own assessment | |
| G5 | In mock mode the comparison reads **"Not directly comparable"** (distinctness) | |
| G6 | The comparison states no causal claim | |
| G7 | `interventions.scope = 'class'` and the rationale says it is class-wide | |

## H. Invariants — must all return zero

```sql
-- 1. no duplicate XP for one assessment
select count(*) from (
  select student_id, source_id from public.xp_transactions group by 1,2 having count(*) > 1
) t;

-- 2. grading agrees with the stored key
select count(*) from public.student_answers where is_correct <> (choice_index = correct_index);

-- 3. nothing unpublished has submissions
select count(*) from public.assessments a
 where a.status <> 'published' and exists (select 1 from public.submissions s where s.assessment_id = a.id);

-- 4. no intervention skipped approval
select count(*) from public.interventions where status = 'assigned' and approved_at is null;
```

| # | Invariant | Result |
|---|---|---|
| H1 | No duplicate XP per assessment | |
| H2 | Grading matches the key | |
| H3 | No submissions on unpublished assessments | |
| H4 | No intervention assigned without approval | |

## I. Authorization matrix

Sign in as each role and confirm the other role's routes are refused.

| Actor | Route | Expected | Result |
|---|---|---|---|
| student | `/teacher` | refused | |
| student | `/teacher/classrooms/{other class}` | refused | |
| student | another class's assessments (direct PostgREST) | **0 rows** | |
| teacher | `/student` | refused | |
| anon | `/teacher`, `/student` | redirected to sign-in | |
| student | `answer_keys` via PostgREST | **0 rows** | |

## J. Technical checks

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | |
| Lint | `npm run lint` | |
| Build | `npm run build` | |
| AI suites (offline) | `npm run check:ai` | |
| World suites | `npm run check:world` | |
| Live provider | `npm run check:live` | |

---

## Defects found

| # | Section | Severity | Description | Status |
|---|---|---|---|---|
| 1 | | | | |

## Sign-off

| Item | Value |
|---|---|
| Sections A–H complete | |
| Blocking defects open | |
| Safe to demonstrate | yes / no |
| Signed | |

---

**Standing rule:** a section with any blank result cell is not verified. The plan
states that no stage may be declared complete solely because the interface looks
correct, and this report exists to make that checkable.
