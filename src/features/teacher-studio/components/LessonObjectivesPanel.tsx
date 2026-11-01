import { addObjective, analyzeLesson, approveLessonObjectives, deleteObjective, updateObjective } from "@/app/actions/lesson-objectives";
import type { AiSetup } from "@/lib/ai/types";

export type LessonObjective = {
  id: string;
  position: number;
  statement: string;
  skills: string[];
  evidence: string;
  source: "ai" | "teacher";
  approved: boolean;
};

export type LastRun = {
  status: "succeeded" | "failed";
  provider: string;
  model: string;
  duration_ms: number;
  objective_count: number;
  repaired: boolean;
  error_message: string | null;
  created_at: string;
};

/**
 * Teacher review surface for AI-generated learning objectives.
 *
 * AI output is never trusted implicitly: it arrives unapproved, is labelled by
 * source, and is editable. Only approved objectives reach students.
 */
export function LessonObjectivesPanel({
  lessonId,
  objectives,
  lastRun,
  setup,
}: {
  lessonId: string;
  objectives: LessonObjective[];
  lastRun: LastRun | null;
  setup: AiSetup;
}) {
  const approved = objectives.filter((objective) => objective.approved).length;

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-[#dce4d8] bg-[#fbfcf8] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[#29483c]">Learning objectives</p>
          <p className="text-xs text-[#62776d]">
            {objectives.length === 0 ? "Nothing generated yet." : `${objectives.length} total · ${approved} approved · students only see approved objectives`}
          </p>
        </div>
        <form action={analyzeLesson}>
          <input name="lessonId" type="hidden" value={lessonId} />
          <button className="min-h-10 rounded-lg bg-[#1f674a] px-4 text-sm font-bold text-white hover:bg-[#174f39]" type="submit">
            {objectives.length === 0 ? "Analyse lesson" : "Re-analyse lesson"}
          </button>
        </form>
      </div>

      <p className={`rounded-lg px-3 py-2 text-xs leading-5 ${setup.isMock ? "bg-[#fff7e6] text-[#8a5a13]" : "bg-[#edf3e9] text-[#3f6249]"}`}>
        <span className="font-bold uppercase tracking-wide">{setup.isMock ? "Mock mode" : "Live AI"}</span> · {setup.note}
      </p>

      {lastRun && (
        <p
          className={`rounded-lg px-3 py-2 text-xs leading-5 ${lastRun.status === "failed" ? "bg-[#fff1e9] text-[#9a4324]" : "bg-white text-[#62776d]"}`}
          role={lastRun.status === "failed" ? "alert" : "status"}
        >
          Last run {lastRun.status} · {lastRun.provider}
          {lastRun.model ? ` (${lastRun.model})` : ""} · {lastRun.duration_ms}ms · {lastRun.objective_count} objective
          {lastRun.objective_count === 1 ? "" : "s"}
          {lastRun.repaired ? " · repaired once" : ""}
          {lastRun.error_message ? ` — ${lastRun.error_message}` : ""}
        </p>
      )}

      {objectives.length > 0 && (
        <div className="space-y-3">
          {objectives.map((objective, index) => (
            <div className="rounded-lg border border-[#e3eadf] bg-white p-3" key={objective.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-[#eef2ea] px-2 py-0.5 text-[11px] font-bold text-[#496451]">#{index + 1}</span>
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${objective.source === "ai" ? "bg-[#e8f0fb] text-[#2f5b8a]" : "bg-[#f3ecf8] text-[#6a4a86]"}`}>
                  {objective.source === "ai" ? "AI draft" : "Teacher edit"}
                </span>
                {objective.approved && <span className="rounded bg-[#e7f3e7] px-2 py-0.5 text-[11px] font-bold text-[#2f6e48]">Approved</span>}
                {!objective.approved && <span className="rounded bg-[#fdf1e3] px-2 py-0.5 text-[11px] font-bold text-[#8a5a13]">Draft — hidden from students</span>}
              </div>

              {objective.evidence && (
                <p className="mt-2 border-l-2 border-[#dce4d8] pl-2 text-xs italic leading-5 text-[#6a7d72]">“{objective.evidence}”</p>
              )}

              <form action={updateObjective} className="mt-2 space-y-2">
                <input name="objectiveId" type="hidden" value={objective.id} />
                <label className="block text-xs font-semibold text-[#496451]">
                  Objective
                  <textarea className="mt-1 min-h-16 w-full rounded-lg border border-[#d5dfd4] px-2 py-1.5 text-sm font-normal" defaultValue={objective.statement} maxLength={500} name="statement" required />
                </label>
                <label className="block text-xs font-semibold text-[#496451]">
                  Skills <span className="font-normal text-[#7b8c81]">(comma separated, max 6)</span>
                  <input className="mt-1 min-h-9 w-full rounded-lg border border-[#d5dfd4] px-2 text-sm font-normal" defaultValue={objective.skills.join(", ")} maxLength={300} name="skills" />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#29483c]">
                    <input defaultChecked={objective.approved} name="approved" type="checkbox" />
                    Approved for students
                  </label>
                  <button className="min-h-9 rounded-lg border border-[#1f674a] px-3 text-xs font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">
                    Save
                  </button>
                </div>
              </form>

              <form action={deleteObjective} className="mt-2">
                <input name="objectiveId" type="hidden" value={objective.id} />
                <button className="text-xs font-semibold text-[#9a4324] underline" type="submit">
                  Remove this objective
                </button>
              </form>
            </div>
          ))}

          {approved < objectives.length && (
            <form action={approveLessonObjectives}>
              <input name="lessonId" type="hidden" value={lessonId} />
              <button className="min-h-9 rounded-lg border border-[#1f674a] px-3 text-xs font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">
                Approve all {objectives.length} objectives
              </button>
            </form>
          )}
        </div>
      )}

      <form action={addObjective} className="space-y-2 border-t border-[#e3eadf] pt-3">
        <input name="lessonId" type="hidden" value={lessonId} />
        <label className="block text-xs font-semibold text-[#496451]">
          Add your own objective
          <input className="mt-1 min-h-9 w-full rounded-lg border border-[#d5dfd4] px-2 text-sm font-normal" maxLength={500} name="statement" placeholder="Students can explain why 1/2 equals 2/4." required />
        </label>
        <button className="min-h-9 rounded-lg border border-[#b9c8b7] px-3 text-xs font-bold text-[#29483c] hover:bg-[#f1f5ec]" type="submit">
          Add draft
        </button>
      </form>
    </div>
  );
}
