import {
  approveAssessment,
  deleteQuestion,
  generateChallenges,
  publishAssessment,
  unpublishAssessment,
} from "@/app/actions/assessments";
import { QuestionEditor } from "./QuestionEditor";
import type { AiSetup } from "@/lib/ai/types";

export type QuestionView = {
  id: string;
  position: number;
  kind: "multiple_choice" | "true_false";
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  objectiveId: string | null;
};

export type AssessmentView = {
  id: string;
  title: string;
  status: "draft" | "approved" | "published";
  questions: QuestionView[];
};

const STATUS_STYLE: Record<AssessmentView["status"], string> = {
  draft: "bg-[#fdf1e3] text-[#8a5a13]",
  approved: "bg-[#e8f0fb] text-[#2f5b8a]",
  published: "bg-[#e7f3e7] text-[#2f6e48]",
};

const STATUS_LABEL: Record<AssessmentView["status"], string> = {
  draft: "Draft — hidden from students",
  approved: "Approved — not published",
  published: "Published to assigned classes",
};

/**
 * Teacher review surface for generated challenges.
 *
 * The answer key is shown here (teachers only) and is never sent to the student
 * bundle: it lives in its own table with no student policy.
 */
export function AssessmentPanel({
  lessonId,
  assessment,
  approvedObjectiveCount,
  setup,
  objectiveStatements,
}: {
  lessonId: string;
  assessment: AssessmentView | null;
  approvedObjectiveCount: number;
  setup: AiSetup;
  objectiveStatements: Map<string, string>;
}) {
  return (
    <div className="mt-4 space-y-4 rounded-xl border border-[#dce4d8] bg-[#fbfcf8] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[#29483c]">Challenges</p>
          <p className="text-xs text-[#62776d]">
            {assessment
              ? `${assessment.questions.length} question${assessment.questions.length === 1 ? "" : "s"} · ${STATUS_LABEL[assessment.status]}`
              : "No challenge set yet."}
          </p>
        </div>
        <form action={generateChallenges}>
          <input name="lessonId" type="hidden" value={lessonId} />
          <button
            className="min-h-10 rounded-lg bg-[#1f674a] px-4 text-sm font-bold text-white hover:bg-[#174f39] disabled:opacity-60"
            disabled={approvedObjectiveCount === 0}
            title={approvedObjectiveCount === 0 ? "Approve a learning objective first" : undefined}
            type="submit"
          >
            {assessment ? "Regenerate challenges" : "Generate challenges"}
          </button>
        </form>
      </div>

      <p className={`rounded-lg px-3 py-2 text-xs leading-5 ${setup.isMock ? "bg-[#fff7e6] text-[#8a5a13]" : "bg-[#edf3e9] text-[#3f6249]"}`}>
        <span className="font-bold uppercase tracking-wide">{setup.isMock ? "Mock mode" : "Live AI"}</span> · {setup.note}
      </p>
      {approvedObjectiveCount === 0 && (
        <p className="rounded-lg bg-[#fff1e9] px-3 py-2 text-xs leading-5 text-[#9a4324]">
          Every question must point at an approved objective, so approve at least one objective above before generating.
        </p>
      )}
      <p className="text-xs leading-5 text-[#62776d]">
        Answer keys are stored separately from questions and are never sent to students. Editing any question returns the set to
        draft and hides it from students.
      </p>

      {assessment && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${STATUS_STYLE[assessment.status]}`}>{assessment.status}</span>
            {assessment.status === "draft" && (
              <form action={approveAssessment}>
                <input name="assessmentId" type="hidden" value={assessment.id} />
                <button className="min-h-9 rounded-lg border border-[#1f674a] px-3 text-xs font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">
                  Approve this challenge set
                </button>
              </form>
            )}
            {assessment.status === "approved" && (
              <form action={publishAssessment}>
                <input name="assessmentId" type="hidden" value={assessment.id} />
                <button className="min-h-9 rounded-lg bg-[#1f674a] px-3 text-xs font-bold text-white hover:bg-[#174f39]" type="submit">
                  Publish to students
                </button>
              </form>
            )}
            {assessment.status === "published" && (
              <form action={unpublishAssessment}>
                <input name="assessmentId" type="hidden" value={assessment.id} />
                <button className="min-h-9 rounded-lg border border-[#9a4324] px-3 text-xs font-bold text-[#9a4324] hover:bg-[#fff1e9]" type="submit">
                  Unpublish
                </button>
              </form>
            )}
          </div>

          <div className="space-y-3">
            {assessment.questions.map((question, index) => (
              <div className="rounded-lg border border-[#e3eadf] bg-white p-3" key={question.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-[#eef2ea] px-2 py-0.5 text-[11px] font-bold text-[#496451]">Q{index + 1}</span>
                  <span className="rounded bg-[#eef2ea] px-2 py-0.5 text-[11px] font-bold text-[#496451]">
                    {question.kind === "true_false" ? "True / false" : "Multiple choice"}
                  </span>
                  {question.objectiveId && objectiveStatements.get(question.objectiveId) && (
                    <span className="text-[11px] text-[#6a7d72]">→ {objectiveStatements.get(question.objectiveId)}</span>
                  )}
                </div>

                <QuestionEditor
                  correctIndex={question.correctIndex}
                  explanation={question.explanation}
                  kind={question.kind}
                  options={question.options}
                  prompt={question.prompt}
                  questionId={question.id}
                />

                <form action={deleteQuestion} className="mt-2">
                  <input name="questionId" type="hidden" value={question.id} />
                  <button className="text-xs font-semibold text-[#9a4324] underline" type="submit">
                    Remove this question
                  </button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
