import Link from "next/link";
import { notFound } from "next/navigation";

import { submitChallenge } from "@/app/actions/challenges";
import { askCompanion } from "@/app/actions/companion";
import { markLessonStudiedFromForm } from "@/app/actions/learning";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCompanion } from "@/lib/ai";
import { xpForQuestions } from "@/lib/learning/xp";

type Params = Promise<{ assignmentId: string }>;
type SearchParams = Promise<{ error?: string; submitted?: string; askError?: string }>;

type LessonRow = { title: string; content: string; learning_objective: string } | null;
type Question = { id: string; assessment_id: string; position: number; kind: "multiple_choice" | "true_false"; prompt: string; options: string[] };
type AnswerRow = { submission_id: string; question_id: string; choice_index: number; is_correct: boolean; correct_index: number; explanation: string };
type Assessment = { id: string; title: string; kind: "challenge" | "practice" | "follow_up" };
type Submission = { id: string; assessment_id: string; score: number; total: number; xp_awarded: number; submitted_at: string };

const KIND_LABEL: Record<Assessment["kind"], { heading: string; hint: string }> = {
  challenge: { heading: "", hint: "Answer every question. Grading happens on the server." },
  practice: { heading: "Practice assigned by your teacher", hint: "This practice is not graded as mastery — it is here to help the idea settle." },
  follow_up: { heading: "Follow-up check", hint: "This check shows what has changed since your first attempt." },
};

function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function QuestPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireRole("student");
  const { assignmentId } = await params;
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  if (!supabase) notFound();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: assignment } = await supabase
    .from("lesson_assignments")
    .select("id, lesson_id, lessons(title, content, learning_objective), classrooms(name)")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) notFound();

  const lesson = firstRow<LessonRow>(assignment.lessons as LessonRow | LessonRow[] | null);
  const classroom = firstRow<{ name: string }>(assignment.classrooms as { name: string } | { name: string }[] | null);

  const { data: objectiveRows } = await supabase
    .from("lesson_objectives")
    .select("statement")
    .eq("lesson_id", assignment.lesson_id)
    .eq("approved", true)
    .order("position", { ascending: true });

  const { data: studyRow } = await supabase
    .from("lesson_study_progress")
    .select("assignment_id")
    .eq("student_id", user.id)
    .eq("assignment_id", assignment.id)
    .maybeSingle();

  // Every published activity for this lesson: the initial challenge, any targeted
  // practice, and the follow-up check. Each has its own questions and its own result.
  const { data: assessmentRows } = await supabase
    .from("assessments")
    .select("id, title, kind")
    .eq("lesson_id", assignment.lesson_id)
    .eq("status", "published");
  const assessments = ((assessmentRows ?? []) as Assessment[]).sort((left, right) => {
    const order = { challenge: 0, practice: 1, follow_up: 2 };
    return order[left.kind] - order[right.kind];
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);

  const { data: questionRows } = assessmentIds.length
    ? await supabase.from("questions").select("id, assessment_id, position, kind, prompt, options").in("assessment_id", assessmentIds).order("position", { ascending: true })
    : { data: [] };
  const questions = (questionRows ?? []) as Question[];
  const questionsByAssessment = new Map<string, Question[]>();
  for (const question of questions) {
    questionsByAssessment.set(question.assessment_id, [...(questionsByAssessment.get(question.assessment_id) ?? []), question]);
  }

  const { data: submissionRows } = assessmentIds.length
    ? await supabase
      .from("submissions")
      .select("id, assessment_id, score, total, xp_awarded, submitted_at")
      .in("assessment_id", assessmentIds)
      .eq("student_id", user.id)
      .order("submitted_at", { ascending: false })
    : { data: [] };
  const latestByAssessment = new Map<string, Submission>();
  for (const submission of (submissionRows ?? []) as Submission[]) {
    if (!latestByAssessment.has(submission.assessment_id)) latestByAssessment.set(submission.assessment_id, submission);
  }

  const submissionIds = Array.from(latestByAssessment.values()).map((submission) => submission.id);
  const { data: answerRows } = submissionIds.length
    ? await supabase
      .from("student_answers")
      .select("submission_id, question_id, choice_index, is_correct, correct_index, explanation")
      .in("submission_id", submissionIds)
    : { data: [] };
  const answersBySubmission = new Map<string, Map<string, AnswerRow>>();
  for (const answer of (answerRows ?? []) as AnswerRow[]) {
    const bucket = answersBySubmission.get(answer.submission_id) ?? new Map<string, AnswerRow>();
    bucket.set(answer.question_id, answer);
    answersBySubmission.set(answer.submission_id, bucket);
  }

  const { data: companionRows } = await supabase
    .from("companion_messages")
    .select("question, answer, refused, created_at")
    .eq("student_id", user.id)
    .eq("assignment_id", assignment.id)
    .order("created_at", { ascending: false })
    .limit(4);
  const companionTurns = ((companionRows ?? []) as { question: string; answer: string; refused: boolean; created_at: string }[]).reverse();
  const { setup: companionSetup } = resolveCompanion();

  const studied = Boolean(studyRow);
  const challenge = assessments.find((assessment) => assessment.kind === "challenge");
  const challengeSubmitted = challenge ? latestByAssessment.has(challenge.id) : false;

  return <section className="max-w-3xl">
    <Link className="text-sm font-semibold text-[#1f674a] underline" href="/student">← Back to my world</Link>
    <p className="mt-4 text-sm font-bold uppercase tracking-wide text-[#b65e35]">{classroom?.name ?? "Class lesson"}</p>
    <h1 className="mt-2 text-3xl font-bold">{lesson?.title ?? "Quest"}</h1>

    {query.error && <p className="mt-4 rounded-lg bg-[#fff1e9] px-4 py-3 text-sm text-[#9a4324]" role="alert">{query.error}</p>}
    {query.submitted && (
      <p className="mt-4 rounded-lg bg-[#edf3e9] px-4 py-3 text-sm font-semibold text-[#3f6249]" role="status">
        Your answers were graded on the server. XP is awarded once per activity.
      </p>
    )}

    {objectiveRows && objectiveRows.length > 0 && (
      <div className="mt-5 rounded-2xl border border-[#dce4d8] bg-white p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#b65e35]">What you are learning</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-[#496451]">
          {(objectiveRows as { statement: string }[]).map((objective) => <li key={objective.statement}>{objective.statement}</li>)}
        </ul>
      </div>
    )}

    <article className="mt-5 rounded-2xl border border-[#dce4d8] bg-white p-6">
      <h2 className="text-lg font-bold">The lesson</h2>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#496451]">{lesson?.content}</p>
      {!studied && !challengeSubmitted && (
        <form action={markLessonStudiedFromForm} className="mt-5">
          <input name="assignmentId" type="hidden" value={assignment.id} />
          <button className="min-h-10 rounded-lg border border-[#1f674a] px-4 text-sm font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">
            Mark this lesson studied
          </button>
        </form>
      )}
      {studied && !challengeSubmitted && <p className="mt-4 text-xs font-semibold text-[#3f6249]">Studied ✓</p>}
    </article>

    {/* Learning Companion — grounded in this lesson, never in the answer key */}
    <section className="mt-5 rounded-2xl border border-[#d6e0d4] bg-[#f7faf4] p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Ask NABTA about this lesson</h2>
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${companionSetup.isMock ? "bg-[#fff7e6] text-[#8a5a13]" : "bg-[#e7f3e7] text-[#2f6e48]"}`}>
          {companionSetup.isMock ? "Mock companion" : "Live AI"}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[#62776d]">
        It explains this lesson and gives hints. It will not tell you the answer to a challenge question, and your teacher can see these questions.
      </p>

      {query.askError && <p className="mt-3 rounded-lg bg-[#fff1e9] px-3 py-2 text-xs text-[#9a4324]" role="alert">{query.askError}</p>}

      <form action={askCompanion} className="mt-4">
        <input name="assignmentId" type="hidden" value={assignment.id} />
        <label className="block text-sm font-semibold text-[#29483c]">
          Your question
          <textarea className="mt-1 min-h-20 w-full rounded-lg border border-[#d5dfd4] bg-white px-3 py-2 text-sm font-normal" maxLength={600} name="question" placeholder="Why does the denominator not get added?" required />
        </label>
        <button className="mt-3 min-h-10 rounded-lg bg-[#1f674a] px-4 text-sm font-bold text-white hover:bg-[#174f39]" type="submit">Ask</button>
      </form>

      {companionTurns.length > 0 && (
        <ol className="mt-4 space-y-3">
          {companionTurns.map((turn) => (
            <li className={`rounded-xl border bg-white p-3 ${turn.refused ? "border-[#efdcc9] bg-[#fffdf8]" : "border-[#e3eadf]"}`} key={`${turn.created_at}-${turn.question}`}>
              <p className="text-sm font-semibold text-[#29483c]">{turn.question}</p>
              <p className="mt-1 text-sm leading-6 text-[#496451]">{turn.answer}</p>
              {turn.refused && <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[#8a5a13]">Outside this lesson</p>}
            </li>
          ))}
        </ol>
      )}
    </section>

    {assessments.length === 0 && (
      <p className="mt-5 rounded-2xl border border-dashed border-[#cfdacd] p-6 text-sm leading-6 text-[#62776d]">
        Your teacher has not published an activity for this lesson yet. Studying it still moves your path forward.
      </p>
    )}

    {assessments.map((assessment) => {
      const items = questionsByAssessment.get(assessment.id) ?? [];
      const submission = latestByAssessment.get(assessment.id);
      const answers = submission ? answersBySubmission.get(submission.id) : undefined;
      const label = KIND_LABEL[assessment.kind];
      const maxXp = xpForQuestions(items.length, items.length);

      if (items.length === 0) return null;

      return <section className="mt-5 rounded-2xl border border-[#dce4d8] bg-white p-6" key={assessment.id}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">{label.heading || assessment.title}</h2>
          <p className="text-xs font-semibold text-[#62776d]">
            {items.length} questions{assessment.kind === "challenge" ? ` · up to ${maxXp} XP` : ""}
          </p>
        </div>

        {!submission && (
          <>
            <p className="mt-1 text-xs leading-5 text-[#62776d]">{label.hint}</p>
            <form action={submitChallenge} className="mt-4">
              <input name="assignmentId" type="hidden" value={assignment.id} />
              <input name="assessmentId" type="hidden" value={assessment.id} />
              <ol className="space-y-5">
                {items.map((question, index) => (
                  <li key={question.id}>
                    <fieldset>
                      <legend className="text-sm font-semibold text-[#29483c]">
                        <span className="mr-2 rounded bg-[#eef2ea] px-1.5 py-0.5 text-[11px] font-bold text-[#496451]">Q{index + 1}</span>
                        {question.prompt}
                      </legend>
                      <div className="mt-2 space-y-2">
                        {question.options.map((option, optionIndex) => (
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e3eadf] px-3 py-2 text-sm has-[:checked]:border-[#1f674a] has-[:checked]:bg-[#edf3e9]" key={`${question.id}-${optionIndex}`}>
                            <input className="size-4" name={`choice_${question.id}`} required type="radio" value={optionIndex} />
                            <span>{option}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </li>
                ))}
              </ol>
              <button className="mt-6 min-h-11 rounded-lg bg-[#1f674a] px-5 text-sm font-bold text-white hover:bg-[#174f39]" type="submit">Submit answers</button>
            </form>
          </>
        )}

        {submission && (
          <>
            <p className="mt-1 text-sm font-bold text-[#1f674a]">
              {submission.score} / {submission.total} correct{submission.xp_awarded > 0 ? ` · ${submission.xp_awarded} XP` : ""}
            </p>
            <p className="text-xs text-[#62776d]">Submitted {new Date(submission.submitted_at).toLocaleString()}</p>
            <ol className="mt-4 space-y-4">
              {items.map((question, index) => {
                const answer = answers?.get(question.id);
                return <li className="rounded-xl border border-[#e3eadf] p-4" key={question.id}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-[#29483c]">
                      <span className="mr-2 rounded bg-[#eef2ea] px-1.5 py-0.5 text-[11px] font-bold text-[#496451]">Q{index + 1}</span>
                      {question.prompt}
                    </p>
                    <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold uppercase ${answer?.is_correct ? "bg-[#e7f3e7] text-[#2f6e48]" : "bg-[#fff1e9] text-[#9a4324]"}`}>
                      {answer?.is_correct ? "Correct" : "Not yet"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[#496451]">Your answer: <span className="font-semibold">{answer ? question.options[answer.choice_index] : "—"}</span></p>
                  {answer && !answer.is_correct && (
                    <p className="mt-1 text-sm text-[#496451]">Correct answer: <span className="font-semibold">{question.options[answer.correct_index] ?? "—"}</span></p>
                  )}
                  {answer?.explanation && <p className="mt-2 rounded-lg bg-[#f6f8f2] px-3 py-2 text-sm leading-6 text-[#62776d]">{answer.explanation}</p>}
                </li>;
              })}
            </ol>
          </>
        )}
      </section>;
    })}
  </section>;
}
