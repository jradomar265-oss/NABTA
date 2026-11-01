"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActionRole } from "@/lib/auth/action-role";
import { AiAnalysisError, resolveLessonAnalyzer } from "@/lib/ai";

function teacherError(message: string, detail?: string): never {
  const query = new URLSearchParams({ error: message });
  if (detail) query.set("detail", detail.slice(0, 180));
  redirect(`/teacher?${query.toString()}`);
}

function teacherNotice(notice: string): never {
  redirect(`/teacher?notice=${notice}`);
}

const uuid = z.string().uuid();

/**
 * Runs the configured analyser over one teacher-owned lesson.
 *
 * Every attempt is written to `agent_runs` — including failures — so the teacher
 * timeline and the audit trail cannot show a failed call as a success. Previous
 * AI objectives for the lesson are replaced, teacher-authored ones are kept.
 */
export async function analyzeLesson(formData: FormData) {
  const parsed = z.object({ lessonId: z.string().uuid() }).safeParse({ lessonId: formData.get("lessonId") });
  if (!parsed.success) teacherError("Choose a lesson to analyse.");
  const { supabase, user } = await requireActionRole("teacher");

  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, title, learning_objective, content")
    .eq("id", parsed.data.lessonId)
    .eq("teacher_id", user.id)
    .maybeSingle();

  if (!lesson) teacherError("That lesson could not be found.");

  const { analyzer } = resolveLessonAnalyzer();
  const started = Date.now();
  const inputChars = (lesson.content ?? "").length;

  // The model call is isolated in its own try/catch: `redirect()` throws, so a
  // redirect placed inside the same block would be caught and misreported as an
  // analysis failure.
  let outcome: { ok: true; run: Awaited<ReturnType<typeof analyzer.analyze>> } | { ok: false; message: string; detail?: string };
  try {
    const run = await analyzer.analyze({
      lessonId: lesson.id,
      title: lesson.title,
      learningObjectiveHint: lesson.learning_objective ?? "",
      content: lesson.content ?? "",
    });
    outcome = { ok: true, run };
  } catch (error) {
    outcome = {
      ok: false,
      message: error instanceof AiAnalysisError ? error.message : "The lesson could not be analysed. Nothing was saved.",
      detail: error instanceof AiAnalysisError ? error.detail : undefined,
    };
  }

  if (!outcome.ok) {
    await supabase.from("agent_runs").insert({
      teacher_id: user.id,
      lesson_id: lesson.id,
      kind: "lesson_analysis",
      provider: analyzer.id,
      model: analyzer.isMock ? "deterministic-rules" : "",
      status: "failed",
      duration_ms: Date.now() - started,
      input_chars: inputChars,
      objective_count: 0,
      error_message: outcome.message.slice(0, 400),
    });
    revalidatePath("/teacher");
    teacherError(outcome.message, outcome.detail);
  }

  const run = outcome.run;

  const { data: runRow, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      teacher_id: user.id,
      lesson_id: lesson.id,
      kind: "lesson_analysis",
      provider: run.provider,
      model: run.model,
      status: "succeeded",
      duration_ms: run.durationMs,
      input_chars: inputChars,
      objective_count: run.analysis.objectives.length,
      repaired: run.repaired,
    })
    .select("id")
    .single();

  if (runError || !runRow) {
    teacherError("The analysis ran but could not be recorded, so nothing was saved. Please try again.");
  }

  // Replace this lesson's previous AI objectives; keep teacher-authored ones.
  const { error: clearError } = await supabase
    .from("lesson_objectives")
    .delete()
    .eq("lesson_id", lesson.id)
    .eq("teacher_id", user.id)
    .eq("source", "ai");
  if (clearError) teacherError("The previous AI objectives could not be replaced. Please try again.");

  const { error: insertError } = await supabase.from("lesson_objectives").insert(
    run.analysis.objectives.map((objective, index) => ({
      lesson_id: lesson.id,
      teacher_id: user.id,
      position: index,
      statement: objective.statement,
      skills: objective.skills,
      evidence: objective.evidence,
      source: "ai" as const,
      approved: false,
      agent_run_id: runRow.id,
    })),
  );
  if (insertError) teacherError("The objectives could not be saved. Please try again.");

  revalidatePath("/teacher");
  teacherNotice(run.analysis.objectives.length === 1 ? "objective-generated" : "objectives-generated");
}

/** Teacher edit of one objective. Saving also records the approval flag. */
export async function updateObjective(formData: FormData) {
  const parsed = z.object({
    objectiveId: z.string().uuid(),
    statement: z.string().trim().min(5).max(500),
    skills: z.string().trim().max(300),
    approved: z.union([z.literal("on"), z.literal("")]).optional(),
  }).safeParse({
    objectiveId: formData.get("objectiveId"),
    statement: formData.get("statement"),
    skills: formData.get("skills") ?? "",
    approved: formData.get("approved") ?? "",
  });
  if (!parsed.success) teacherError("Write an objective between 5 and 500 characters.");
  const { supabase, user } = await requireActionRole("teacher");

  const skills = parsed.data.skills
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 6);

  const { error } = await supabase
    .from("lesson_objectives")
    .update({
      statement: parsed.data.statement,
      skills,
      approved: parsed.data.approved === "on",
      source: "teacher",
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.objectiveId)
    .eq("teacher_id", user.id);

  if (error) teacherError("That objective could not be saved. Please try again.");
  revalidatePath("/teacher");
  revalidatePath("/student");
  teacherNotice("objective-saved");
}

export async function deleteObjective(formData: FormData) {
  const parsed = z.object({ objectiveId: z.string().uuid() }).safeParse({ objectiveId: formData.get("objectiveId") });
  if (!parsed.success) teacherError("That objective could not be found.");
  const { supabase, user } = await requireActionRole("teacher");

  const { error } = await supabase
    .from("lesson_objectives")
    .delete()
    .eq("id", parsed.data.objectiveId)
    .eq("teacher_id", user.id);

  if (error) teacherError("That objective could not be removed. Please try again.");
  revalidatePath("/teacher");
  revalidatePath("/student");
  teacherNotice("objective-removed");
}

/** Teacher-authored objective, for when the analysis missed something. */
export async function addObjective(formData: FormData) {
  const parsed = z.object({
    lessonId: z.string().uuid(),
    statement: z.string().trim().min(5).max(500),
  }).safeParse({ lessonId: formData.get("lessonId"), statement: formData.get("statement") });
  if (!parsed.success) teacherError("Write an objective between 5 and 500 characters.");
  const { supabase, user } = await requireActionRole("teacher");

  const { data: lesson } = await supabase
    .from("lessons")
    .select("id")
    .eq("id", parsed.data.lessonId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  if (!lesson) teacherError("That lesson could not be found.");

  const { count } = await supabase
    .from("lesson_objectives")
    .select("id", { count: "exact", head: true })
    .eq("lesson_id", lesson.id);

  const { error } = await supabase.from("lesson_objectives").insert({
    lesson_id: lesson.id,
    teacher_id: user.id,
    position: count ?? 0,
    statement: parsed.data.statement,
    skills: [],
    evidence: "",
    source: "teacher",
    approved: false,
  });

  if (error) teacherError("That objective could not be added. Please try again.");
  revalidatePath("/teacher");
  teacherNotice("objective-added");
}

/** Approves every objective for a lesson in one step. */
export async function approveLessonObjectives(formData: FormData) {
  const parsed = z.object({ lessonId: uuid }).safeParse({ lessonId: formData.get("lessonId") });
  if (!parsed.success) teacherError("That lesson could not be found.");
  const { supabase, user } = await requireActionRole("teacher");

  const { error } = await supabase
    .from("lesson_objectives")
    .update({ approved: true, updated_at: new Date().toISOString() })
    .eq("lesson_id", parsed.data.lessonId)
    .eq("teacher_id", user.id);

  if (error) teacherError("Those objectives could not be approved. Please try again.");
  revalidatePath("/teacher");
  revalidatePath("/student");
  teacherNotice("objectives-approved");
}
