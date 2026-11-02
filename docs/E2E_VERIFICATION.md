# End-to-end verification runbook

Stages 5–8 have never executed against a real database. This is the single pass that
turns them from "written" to "verified". It takes about fifteen minutes.

Work in this order. After **each checkpoint**, run the matching query in
`supabase/tests/e2e_checkpoints.sql` and keep the output — that is the evidence.

Prerequisites
- `PENDING_MIGRATIONS.sql` applied (0010–0013).
- Dev server running (`npm run dev -- -p 3001`).
- Two accounts: one `teacher`, one `student`. Promote the teacher in the SQL editor if
  needed: `update public.profiles set role = 'teacher' where id = (select id from auth.users where email = '...')`.

---

## Step 1 — Teacher creates a class with real education context

`/teacher` → **Create a class**. Use a class that is *not* Grade 6, so the context work
is exercised rather than accidentally passing:

| Field | Value |
|---|---|
| Class name | `Grade 8 Science — Ecosystems` |
| Grade | `8` |
| Subject | `Science` |
| Curriculum | `UAE MOE` |

**Expect:** the class card appears with a join code.

Then **Checkpoint A**.

---

## Step 2 — Teacher creates a lesson and analyses it

Still on `/teacher` → **Create a lesson**. Paste a real paragraph about food chains or
photosynthesis (200+ words). Leave the objective note blank.

Expand **Learning objectives** → **Analyse lesson**.

**Expect:**
- badge reads **Mock mode** (no provider credit);
- 3–6 objectives appear, each tagged `AI draft` and **unapproved**;
- a last-run line showing provider, duration and objective count.

If objectives about fractions appear instead of your science topic, that is the mock
being honest about its limits — the *report* is the finding, not a bug. Tell me.

Then **Checkpoint B**.

---

## Step 3 — Approve, generate, approve, publish

1. Tick **Approved for students** on one objective → **Save**. Repeat for a second.
2. Expand **Challenges** → **Generate challenges**.
3. Review one question, then **Approve this challenge set** → **Publish to students**.
4. Assign the lesson to the class (the select + **Assign to class**).

**Expect:** status moves `draft → approved → published`. Editing any question drops it
back to draft — try one edit to confirm that, then re-approve and re-publish.

Then **Checkpoint C**.

---

## Step 4 — Student joins and opens the quest

Sign out, sign in as the student. `/student` → **Join class** with the code.

**Expect:** the world renders, the quest medallion appears on the path, and — this is
the 0011 fix — the **lesson text is visible** when you open the quest. Before 0011 it
was blank.

Open the quest. **Expect:** objectives list, lesson text, "Ask NABTA" panel,
challenge form.

Ask NABTA one on-topic question and one clearly off-topic question (e.g. "who won the
match yesterday?").

**Expect:** the on-topic answer quotes the lesson; the off-topic one is refused and
labelled "Outside this lesson". Both appear in the thread.

Then **Checkpoint D**.

---

## Step 5 — Submit the challenge

Answer every question → **Submit answers**.

**Expect:** score, per-question correct/not-yet, the correct answer for the ones you
missed, and an explanation. XP awarded once.

**Now submit a second challenge for the same lesson, if you have one, or re-open the
page and confirm the result persists.**

Then **Checkpoint E** — this is the important one.

---

## Step 6 — Teacher analytics

Back as the teacher → class card → **Class analytics**.

**Expect:** measured performance per objective with an evidence state; "Evidence limits"
if fewer than 3 answers; then **Analyse this class**.

**Expect:** observations that cite the numbers above them, a confidence per observation,
and a "what this analysis cannot tell you" list. With one student the report should say
the class-level judgement needs more students.

Then **Checkpoint F**.

---

## Step 7 — Intervention, practice, follow-up

On the same page → **Create practice** for the flagged objective.

**Expect:** a **draft** intervention listed, with Approve and then Assign buttons.

Approve → assign. Then as the student, reopen the quest.

**Expect:** two new sections — **Practice assigned by your teacher** and **Follow-up
check**. Submit the practice, then the follow-up.

Back on analytics, the **Before and after** panel should appear.

**Expect — and this is the design working as intended:** in mock mode the follow-up
questions are the same templates as the practice, so the panel will say **"Not directly
comparable"** and name *distinctness* as the reason. That is correct behaviour, not a
failure. It becomes comparable only with a live provider or genuinely different
questions.

Then **Checkpoint G**.

---

## Failure modes I expect, and what each means

| Symptom | Likely cause | Meaning |
|---|---|---|
| Student sees **no** assessments after 0013 | nothing published to *their* class | the leak is fixed; assign + publish correctly |
| Practice/follow-up form missing | intervention not `assigned` | publishing only happens on assign |
| "not directly comparable" | identical prompts | correct in mock mode |
| XP not awarded on the follow-up | already awarded for that assessment | one award per assessment, by design |
| "The analysis ran but could not be recorded" | `agent_runs` insert blocked | a policy or grant problem — send me the message |
| Analytics show "0 answers" | submission saved but not for that class | check the assessment belongs to the assigned lesson |

---

## What I need back

The output of **Checkpoints A, C, E and G**. Those four cover class context, publish
state, grading/XP, and the intervention chain. With those I can tell you precisely what
is verified and what still is not.
