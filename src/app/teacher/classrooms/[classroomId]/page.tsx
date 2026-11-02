import Link from "next/link";
import { notFound } from "next/navigation";

import { generateLearningAnalysis } from "@/app/actions/analysis";
import { analyzeLesson } from "@/app/actions/lesson-objectives";
import { generateChallenges } from "@/app/actions/assessments";
import { approveIntervention, assignIntervention, createIntervention } from "@/app/actions/interventions";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveLearningAnalyst } from "@/lib/ai";
import type { LearningObservations } from "@/lib/ai";
import { buildAnalysisFacts, type AnalysisFacts, type AnswerRow, type QuestionRow } from "@/lib/learning/analysis";
import { compareEvidence, type AssessmentKind } from "@/lib/learning/compare";
import { checkComparability } from "@/lib/learning/comparability";

type Params = Promise<{ classroomId: string }>;
type SearchParams = Promise<{ error?: string; notice?: string }>;

type StoredObservation = LearningObservations;

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

const STATUS_STYLE: Record<string, string> = {
  strength: "bg-[#e7f3e7] text-[#2f6e48]",
  gap: "bg-[#fff1e9] text-[#9a4324]",
  "on-track": "bg-[#e8f0fb] text-[#2f5b8a]",
  "needs-more-evidence": "bg-[#f3f6ef] text-[#62776d]",
  "not-assessed": "bg-[#f3f6ef] text-[#9aa79f]",
};

export default async function ClassroomAnalyticsPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireRole("teacher");
  const { classroomId } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  if (!supabase) notFound();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: classroom } = await supabase
    .from("classrooms")
    .select("id, name, join_code")
    .eq("id", classroomId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  if (!classroom) notFound();

  const { data: assignmentRows } = await supabase
    .from("lesson_assignments")
    .select("lesson_id, lessons(id, title)")
    .eq("classroom_id", classroomId);

  const lessons = (assignmentRows ?? [])
    .map((row) => firstRow<{ id: string; title: string }>(row.lessons as { id: string; title: string } | { id: string; title: string }[] | null))
    .filter((lesson): lesson is { id: string; title: string } => Boolean(lesson));
  const lessonIds = Array.from(new Set(lessons.map((lesson) => lesson.id)));

  const { data: objectiveRows } = lessonIds.length
    ? await supabase.from("lesson_objectives").select("id, statement").in("lesson_id", lessonIds).eq("approved", true).order("position", { ascending: true })
    : { data: [] };
  const objectives = ((objectiveRows ?? []) as { id: string; statement: string }[]).map((row) => ({ id: row.id, statement: row.statement }));

  const { data: assessmentRows } = lessonIds.length
    ? await supabase.from("assessments").select("id, kind").in("lesson_id", lessonIds)
    : { data: [] };
  const assessmentKind = new Map(((assessmentRows ?? []) as { id: string; kind: AssessmentKind }[]).map((row) => [row.id, row.kind]));
  const assessmentIds = Array.from(assessmentKind.keys());

  const questions: QuestionRow[] = [];
  const questionProfiles: { assessmentId: string; id: string; objectiveId: string | null; kind: string; prompt: string; difficulty: string | null }[] = [];
  const submissions: { id: string; student_id: string; assessment_id: string }[] = [];
  const answers: (AnswerRow & { submissionId: string })[] = [];

  if (assessmentIds.length > 0) {
    const { data: questionRows } = await supabase.from("questions").select("id, assessment_id, objective_id, options, prompt, kind, difficulty").in("assessment_id", assessmentIds);
    for (const row of (questionRows ?? []) as { id: string; assessment_id: string; objective_id: string | null; options: string[]; prompt: string; kind: string; difficulty: string | null }[]) {
      questions.push({ id: row.id, objectiveId: row.objective_id, options: row.options ?? [], prompt: row.prompt });
      questionProfiles.push({ assessmentId: row.assessment_id, id: row.id, objectiveId: row.objective_id, kind: row.kind, prompt: row.prompt, difficulty: row.difficulty });
    }

    const { data: submissionRows } = await supabase.from("submissions").select("id, student_id, assessment_id").in("assessment_id", assessmentIds);
    submissions.push(...((submissionRows ?? []) as { id: string; student_id: string; assessment_id: string }[]));

    if (submissions.length > 0) {
      const { data: answerRows } = await supabase
        .from("student_answers")
        .select("submission_id, question_id, choice_index, is_correct, correct_index")
        .in("submission_id", submissions.map((submission) => submission.id));

      const studentBySubmission = new Map(submissions.map((submission) => [submission.id, submission.student_id]));
      const questionById = new Map(questions.map((question) => [question.id, question]));
      for (const row of (answerRows ?? []) as { submission_id: string; question_id: string; choice_index: number; is_correct: boolean; correct_index: number }[]) {
        const question = questionById.get(row.question_id);
        const studentId = studentBySubmission.get(row.submission_id);
        if (!question || !studentId) continue;
        answers.push({
          questionId: row.question_id,
          objectiveId: question.objectiveId,
          choiceIndex: row.choice_index,
          correctIndex: row.correct_index,
          isCorrect: row.is_correct,
          options: question.options,
          studentId,
          submissionId: row.submission_id,
          submittedAt: "",
        });
      }
    }
  }

  const { data: memberRows } = await supabase.from("classroom_memberships").select("student_id, profiles(display_name)").eq("classroom_id", classroomId);
  const students = ((memberRows ?? []) as { student_id: string; profiles: { display_name: string } | { display_name: string }[] | null }[]).map((row) => ({
    id: row.student_id,
    displayName: firstRow<{ display_name: string }>(row.profiles)?.display_name ?? "Student",
  }));

  const facts: AnalysisFacts = buildAnalysisFacts({
    classroom: { id: classroom.id as string, name: classroom.name as string },
    lessons,
    objectives,
    questions,
    answers,
    students,
  });

  const { data: analysisRows } = await supabase
    .from("learning_analyses")
    .select("id, provider, model, observations, insufficient_evidence, created_at")
    .eq("classroom_id", classroomId)
    .order("created_at", { ascending: false })
    .limit(1);

  const latest = (analysisRows ?? [])[0] as
    | { id: string; provider: string; model: string; observations: StoredObservation; insufficient_evidence: boolean; created_at: string }
    | undefined;

  const { setup } = resolveLearningAnalyst();

  // Split the same evidence by assessment kind, so the comparison only ever puts an
  // initial challenge against a follow-up check.
  const kindBySubmission = new Map(submissions.map((submission) => [submission.id, assessmentKind.get(submission.assessment_id)]));
  const answersOfKind = (kind: AssessmentKind) => answers.filter((answer) => kindBySubmission.get(answer.submissionId) === kind);

  const initialFacts = buildAnalysisFacts({
    classroom: { id: classroom.id as string, name: classroom.name as string },
    lessons,
    objectives,
    questions,
    answers: answersOfKind("challenge"),
    students,
  });

  const followUpFacts = buildAnalysisFacts({
    classroom: { id: classroom.id as string, name: classroom.name as string },
    lessons,
    objectives,
    questions,
    answers: answersOfKind("follow_up"),
    students,
  });

  const comparison = compareEvidence(initialFacts, followUpFacts, { before: "challenge", after: "follow_up" });

  // Comparability: did the two occasions actually measure the same thing?
  const comparability = checkComparability(
    questionProfiles.filter((question) => assessmentKind.get(question.assessmentId) === "challenge"),
    questionProfiles.filter((question) => assessmentKind.get(question.assessmentId) === "follow_up"),
  );

  const { data: interventionRows } = await supabase
    .from("interventions")
    .select("id, title, rationale, status, created_at, objective_id")
    .eq("classroom_id", classroomId)
    .order("created_at", { ascending: false });
  const interventions = (interventionRows ?? []) as { id: string; title: string; rationale: string; status: string; created_at: string; objective_id: string | null }[];

  return (
    <section className="max-w-5xl">
      <Link className="text-sm font-semibold text-[#1f674a] underline" href="/teacher">← Back to the studio</Link>
      <p className="mt-4 text-sm font-bold uppercase tracking-wide text-[#b65e35]">Class analytics</p>
      <h1 className="mt-2 text-3xl font-bold">{classroom.name as string}</h1>
      <p className="mt-2 text-sm text-[#62776d]">Join code {classroom.join_code as string} · {students.length} students · {lessons.length} assigned lessons</p>

      {query.error && <p className="mt-4 rounded-lg bg-[#fff1e9] px-4 py-3 text-sm text-[#9a4324]" role="alert">{query.error}</p>}
      {query.notice === "analysis-saved" && <p className="mt-4 rounded-lg bg-[#edf3e9] px-4 py-3 text-sm font-semibold text-[#3f6249]" role="status">Analysis saved. The numbers below were computed from stored answers; the observations are interpretations.</p>}

      {/* FACTS — computed, never AI-authored */}
      <section className="mt-6 rounded-2xl border border-[#dce4d8] bg-white p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Measured performance</h2>
          <p className="text-xs font-semibold text-[#62776d]">
            {facts.totals.answers} answers · {percent(facts.totals.accuracy)} correct · {facts.totals.studentsWithAnswers} student(s)
          </p>
        </div>
        <p className="mt-1 text-xs text-[#62776d]">Calculated in the app from stored answers. No model is involved in these figures.</p>

        {facts.objectives.length === 0
          ? <p className="mt-4 rounded-lg border border-dashed border-[#cfdacd] p-4 text-sm text-[#62776d]">Approve learning objectives first — analytics are reported per objective.</p>
          : <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e3eadf] text-left text-xs uppercase tracking-wide text-[#6a7d72]">
                  <th className="py-2 pr-3 font-bold">Objective</th>
                  <th className="py-2 pr-3 font-bold">Answers</th>
                  <th className="py-2 pr-3 font-bold">Correct</th>
                  <th className="py-2 pr-3 font-bold">Accuracy</th>
                  <th className="py-2 pr-3 font-bold">Evidence</th>
                  <th className="py-2 font-bold">Reading</th>
                </tr>
              </thead>
              <tbody>
                {facts.objectives.map((objective) => (
                  <tr className="border-b border-[#f1f4ee] align-top" key={objective.objectiveId ?? objective.statement}>
                    <td className="py-2 pr-3">{objective.statement}</td>
                    <td className="py-2 pr-3">{objective.attempts} ({objective.studentsAttempted} students)</td>
                    <td className="py-2 pr-3">{objective.correct}</td>
                    <td className="py-2 pr-3 font-semibold">{percent(objective.accuracy)}</td>
                    <td className="py-2 pr-3">{objective.evidenceState}</td>
                    <td className="py-2">
                      <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[objective.status] ?? ""}`}>{objective.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}

        {facts.insufficientReasons.length > 0 && (
          <div className="mt-4 rounded-lg bg-[#f8f5ea] px-4 py-3 text-xs leading-5 text-[#7a6428]">
            <p className="font-bold uppercase tracking-wide">Evidence limits</p>
            <ul className="mt-1 list-disc pl-4">
              {facts.insufficientReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}

        {facts.students.some((student) => student.attempts > 0) && (
          <div className="mt-4">
            <h3 className="text-sm font-bold text-[#29483c]">Per student</h3>
            <ul className="mt-2 space-y-1 text-sm text-[#496451]">
              {facts.students.filter((student) => student.attempts > 0).map((student) => (
                <li key={student.studentId}>{student.displayName}: {student.correct}/{student.attempts} correct ({percent(student.accuracy)}) across {student.objectivesAttempted} objective(s)</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* INTERPRETATION — clearly separated */}
      <section className="mt-5 rounded-2xl border border-[#e0d6c3] bg-[#fffdf6] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Interpretation</h2>
            <p className="mt-1 text-xs text-[#7d6c48]">AI observations about the numbers above. These are hypotheses, not measurements.</p>
          </div>
          <form action={generateLearningAnalysis}>
            <input name="classroomId" type="hidden" value={classroom.id as string} />
            <button className="min-h-10 rounded-lg bg-[#1f674a] px-4 text-sm font-bold text-white hover:bg-[#174f39]" type="submit">
              {latest ? "Re-run analysis" : "Analyse this class"}
            </button>
          </form>
        </div>

        <p className={`mt-3 rounded-lg px-3 py-2 text-xs leading-5 ${setup.isMock ? "bg-[#fff7e6] text-[#8a5a13]" : "bg-[#edf3e9] text-[#3f6249]"}`}>
          <span className="font-bold uppercase tracking-wide">{setup.isMock ? "Mock mode" : "Live AI"}</span> · {setup.note}
        </p>

        {!latest && <p className="mt-4 text-sm text-[#7d6c48]">No interpretation yet. The measured numbers above are complete without one.</p>}

        {latest && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
              <span className="rounded bg-[#f1e9d6] px-2 py-0.5 uppercase text-[#8a5a13]">{latest.provider}{latest.model ? ` · ${latest.model}` : ""}</span>
              <span className="text-[#8a7a5a]">{new Date(latest.created_at).toLocaleString()}</span>
              {latest.insufficient_evidence && <span className="rounded bg-[#fff1e9] px-2 py-0.5 uppercase text-[#9a4324]">Insufficient evidence</span>}
            </div>

            <p className="text-sm leading-6 text-[#4a4232]">{latest.observations.summary}</p>

            <ul className="space-y-2">
              {latest.observations.observations.map((observation, index) => (
                <li className="rounded-lg border border-[#ece2cd] bg-white px-3 py-2" key={`${observation.objectiveId ?? "none"}-${index}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${observation.kind === "strength" ? "bg-[#e7f3e7] text-[#2f6e48]" : observation.kind === "gap" ? "bg-[#fff1e9] text-[#9a4324]" : "bg-[#f1f4ee] text-[#62776d]"}`}>
                      {observation.kind}
                    </span>
                    <span className="text-[11px] font-bold uppercase text-[#8a7a5a]">{observation.confidence} confidence</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[#3f3a2e]">{observation.statement}</p>
                  <p className="mt-1 text-xs italic text-[#7d6c48]">Evidence: {observation.evidence}</p>
                </li>
              ))}
            </ul>

            {latest.observations.challengeItems.length > 0 && (
              <div className="rounded-lg border border-[#ece2cd] bg-white px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-[#8a7a5a]">How the questions behaved</p>
                <ul className="mt-1 space-y-2">
                  {latest.observations.challengeItems.map((item, index) => (
                    <li key={`${item.questionId}-${index}`}>
                      <p className="text-sm font-semibold text-[#3f3a2e]">{item.statement}</p>
                      <p className="text-xs italic text-[#7d6c48]">Evidence: {item.evidence}</p>
                      <p className="text-[11px] font-bold uppercase text-[#8a7a5a]">{item.confidence} confidence</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {latest.observations.difficultyRecommendation && (
              <p className="rounded-lg bg-[#eef2ea] px-3 py-2 text-sm text-[#3f6249]">
                <span className="font-bold uppercase tracking-wide">{latest.observations.difficultyRecommendation.direction}</span>{" "}
                — {latest.observations.difficultyRecommendation.reason}
              </p>
            )}

            {latest.observations.limitations.length > 0 && (
              <div className="rounded-lg bg-[#f8f5ea] px-4 py-3 text-xs leading-5 text-[#7a6428]">
                <p className="font-bold uppercase tracking-wide">What this analysis cannot tell you</p>
                <ul className="mt-1 list-disc pl-4">
                  {latest.observations.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
      {/* AGENT — one loop: objectives, then challenges, then analysis. Approval stays human. */}
      <section className="mt-5 rounded-2xl border border-[#d9dfe8] bg-[#fbfcfe] p-6">
        <h2 className="text-lg font-bold">Run the agent</h2>
        <p className="mt-1 text-xs leading-5 text-[#5b6b7d]">
          The agent drafts objectives, then challenges, then the interpretation. Every generated item starts as a draft — nothing reaches
          students until you approve it.
        </p>

        {lessons[0] ? (
          <ol className="mt-4 space-y-3">
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-[#29483c]">1. Objectives</p>
                <p className="text-xs text-[#62776d]">{objectives.length} approved · from “{lessons[0].title}”</p>
              </div>
              <form action={analyzeLesson}>
                <input name="lessonId" type="hidden" value={lessons[0].id} />
                <input name="returnTo" type="hidden" value={`/teacher/classrooms/${classroomId}`} />
                <button className="min-h-8 rounded-lg border border-[#1f674a] px-3 text-xs font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">
                  Draft objectives
                </button>
              </form>
            </li>

            <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-[#29483c]">2. Challenges</p>
                <p className="text-xs text-[#62776d]">
                  {Array.from(assessmentKind.values()).filter((kind) => kind === "challenge").length} challenge set(s) · needs an approved objective
                </p>
              </div>
              <form action={generateChallenges}>
                <input name="lessonId" type="hidden" value={lessons[0].id} />
                <input name="returnTo" type="hidden" value={`/teacher/classrooms/${classroomId}`} />
                <button className="min-h-8 rounded-lg border border-[#1f674a] px-3 text-xs font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">
                  Draft challenges
                </button>
              </form>
            </li>

            <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-[#29483c]">3. Analysis</p>
                <p className="text-xs text-[#62776d]">{facts.totals.answers} answer(s) on record · runs on the numbers below</p>
              </div>
              <p className="text-xs text-[#5b6b7d]">Use “Analyse this class” in the interpretation panel.</p>
            </li>
          </ol>
        ) : (
          <p className="mt-3 rounded-lg bg-[#f8f5ea] px-4 py-3 text-xs leading-5 text-[#7a6428]">
            This class has no lesson yet, so there is nothing for the agent to work on. Create and assign a lesson first.
          </p>
        )}
      </section>

      {/* COMPARISON — initial challenge vs follow-up, never causal */}
      <section className="mt-5 rounded-2xl border border-[#dce4d8] bg-white p-6">
        <h2 className="text-lg font-bold">Before and after</h2>
        <p className="mt-1 text-xs text-[#62776d]">
          An initial challenge compared with a follow-up check. Only these two kinds are compared; targeted practice is not evidence.
        </p>

        {comparison.incompatibleReason && (
          <p className="mt-3 rounded-lg bg-[#f8f5ea] px-4 py-3 text-xs leading-5 text-[#7a6428]">{comparison.incompatibleReason}</p>
        )}

        <div className={`mt-3 rounded-lg px-4 py-3 text-xs leading-5 ${comparability.comparable ? "bg-[#edf3e9] text-[#3f6249]" : "bg-[#fff1e9] text-[#9a4324]"}`}>
          <p className="font-bold uppercase tracking-wide">{comparability.comparable ? "Comparable" : "Not directly comparable"}</p>
          <p className="mt-1">{comparability.headline}</p>
          {comparability.mismatches.length > 0 && (
            <ul className="mt-2 list-disc pl-4">
              {comparability.mismatches.map((mismatch) => <li key={`${mismatch.area}-${mismatch.detail}`}>{mismatch.detail}</li>)}
            </ul>
          )}
          {comparability.notes.length > 0 && (
            <ul className="mt-2 list-disc pl-4 opacity-80">
              {comparability.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
          <p className="mt-2 opacity-80">{comparability.limitations[0]}</p>
        </div>

        <p className="mt-3 text-sm font-semibold text-[#29483c]">{comparison.statement}</p>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[#9a4324]">
          Causal claim: {comparison.causalClaim ? "made" : "none — NABTA does not claim it caused any change"}
        </p>

        {comparison.rows.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e3eadf] text-left text-xs uppercase tracking-wide text-[#6a7d72]">
                  <th className="py-2 pr-3 font-bold">Objective</th>
                  <th className="py-2 pr-3 font-bold">First attempt</th>
                  <th className="py-2 pr-3 font-bold">Follow-up</th>
                  <th className="py-2 font-bold">Change</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr className="border-b border-[#f1f4ee] align-top" key={row.objectiveId ?? row.statement}>
                    <td className="py-2 pr-3">{row.statement}</td>
                    <td className="py-2 pr-3">{row.before.correct}/{row.before.attempts} ({percent(row.before.accuracy)})</td>
                    <td className="py-2 pr-3">{row.after.correct}/{row.after.attempts} ({percent(row.after.accuracy)})</td>
                    <td className="py-2">
                      {row.verdict === "not-comparable"
                        ? <span className="text-xs text-[#7b8c81]">not comparable — {row.reason}</span>
                        : <span className="text-xs font-bold">{row.deltaPoints !== null && row.deltaPoints > 0 ? "+" : ""}{row.deltaPoints} points · {row.verdict}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* INTERVENTIONS — teacher approval is mandatory before students see anything */}
      <section className="mt-5 rounded-2xl border border-[#dce4d8] bg-white p-6">
        <h2 className="text-lg font-bold">Targeted practice</h2>
        <p className="mt-1 text-xs text-[#62776d]">
          Practice is generated for one objective, then a separate follow-up check measures movement. Nothing is visible to students until you
          approve the intervention and assign it.
        </p>

        {objectiveRows ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {facts.objectives
              .filter((objective) => objective.objectiveId && (objective.status === "gap" || objective.status === "needs-more-evidence"))
              .map((objective) => {
                const lessonForObjective = lessons[0];
                if (!lessonForObjective) return null;
                return (
                  <form action={createIntervention} key={objective.objectiveId}>
                    <input name="classroomId" type="hidden" value={classroom.id as string} />
                    <input name="lessonId" type="hidden" value={lessonForObjective.id} />
                    <input name="objectiveId" type="hidden" value={objective.objectiveId as string} />
                    <button className="min-h-9 rounded-lg border border-[#1f674a] px-3 text-left text-xs font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">
                      Create practice for “{objective.statement.slice(0, 60)}{objective.statement.length > 60 ? "…" : ""}”
                    </button>
                  </form>
                );
              })}
            {facts.objectives.every((objective) => objective.status !== "gap" && objective.status !== "needs-more-evidence") && (
              <p className="text-xs text-[#62776d]">No objective is currently flagged for practice. Re-run the analysis after more answers arrive.</p>
            )}
          </div>
        ) : null}

        {interventions.length > 0 && (
          <ul className="mt-4 space-y-2">
            {interventions.map((intervention) => (
              <li className="rounded-lg border border-[#e3eadf] px-3 py-2" key={intervention.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#29483c]">{intervention.title}</p>
                  <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${intervention.status === "assigned" ? "bg-[#e7f3e7] text-[#2f6e48]" : intervention.status === "approved" ? "bg-[#e8f0fb] text-[#2f5b8a]" : "bg-[#fdf1e3] text-[#8a5a13]"}`}>
                    {intervention.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#6a7d72]">{intervention.rationale}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {intervention.status === "draft" && (
                    <form action={approveIntervention}>
                      <input name="interventionId" type="hidden" value={intervention.id} />
                      <input name="classroomId" type="hidden" value={classroomId} />
                      <button className="min-h-8 rounded-lg border border-[#1f674a] px-3 text-xs font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">Approve</button>
                    </form>
                  )}
                  {intervention.status === "approved" && (
                    <form action={assignIntervention}>
                      <input name="interventionId" type="hidden" value={intervention.id} />
                      <input name="classroomId" type="hidden" value={classroomId} />
                      <button className="min-h-8 rounded-lg bg-[#1f674a] px-3 text-xs font-bold text-white hover:bg-[#174f39]" type="submit">Assign to class</button>
                    </form>
                  )}
                  {intervention.status === "assigned" && <span className="text-xs text-[#62776d]">Students can see the practice and follow-up.</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
