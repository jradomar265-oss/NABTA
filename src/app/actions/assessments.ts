"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActionRole } from "@/lib/auth/action-role";
import { AiAnalysisError, resolveChallengeGenerator } from "@/lib/ai";

function teacherError(message: string, detail?: string): never {
  const query = new URLSearchParams({ error: message });
  if (detail) query.set("detail", detail.slice(0, 180));
  redirect(`/teacher?${query.toString()}`);
}

function teacherNotice(notice: string): never {
  redirect(`/teacher?notice=${notice}`);
}

/** Any change to questions must drop the assessment back to an unapproved draft. */
async function resetToDraft(
  supabase: Awaited<ReturnType<typeof requireActionRole>>["supabase"],
  assessmentId: string,
) {
  await supabase
    .from("assessments")
    .update({ status: "draft", approved_at: null, published_at: null, updated_at: new Date().toISOString() })
    .eq("id", assessmentId);
}

/**
 * Generates challenges from the lesson plus its *approved* objectives.
 *
 * Questions are stored without any correctness flag; the answer key goes to
 * `answer_keys`, which students cannot read. Regenerating replaces questions and
 * always returns the assessment to draft.
 */
export async function generateChallenges(formData: FormData) {
  const parsed = z.object({ lessonId: z.string().uuid() }).safeParse({ lessonId: formData.get("lessonId") });
  if (!parsed.success) teacherError("Choose a lesson first.");
  const { supabase, user } = await requireActionRole("teacher");

  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, title, content")
    .eq("id", parsed.data.lessonId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  if (!lesson) teacherError("That lesson could not be found.");

  const { data: objectiveRows } = await supabase
    .from("lesson_objectives")
    .select("id, statement, skills, approved")
    .eq("lesson_id", lesson.id)
    .eq("teacher_id", user.id)
    .eq("approved", true)
    .order("position", { ascending: true });

  const objectives = (objectiveRows ?? []) as { id: string; statement: string; skills: string[] | null }[];
  if (objectives.length === 0) {
    teacherError("Approve at least one learning objective before generating challenges.");
  }

  const { generator } = resolveChallengeGenerator();
  const started = Date.now();

  let outcome: { ok: true; run: Awaited<ReturnType<typeof generator.generate>> } | { ok: false; message: string; detail?: string };
  try {
    const run = await generator.generate({
      title: lesson.title,
      content: lesson.content ?? "",
      objectives: objectives.map((objective) => ({ id: objective.id, statement: objective.statement, skills: objective.skills ?? [] })),
    });
    outcome = { ok: true, run };
  } catch (error) {
    outcome = {
      ok: false,
      message: error instanceof AiAnalysisError ? error.message : "Challenges could not be generated. Nothing was saved.",
      detail: error instanceof AiAnalysisError ? error.detail : undefined,
    };
  }

  if (!outcome.ok) {
    await supabase.from("agent_runs").insert({
      teacher_id: user.id,
      lesson_id: lesson.id,
      kind: "challenge_generation",
      provider: generator.id,
      model: generator.isMock ? "deterministic-templates" : "",
      status: "failed",
      duration_ms: Date.now() - started,
      input_chars: (lesson.content ?? "").length,
      objective_count: 0,
      error_message: outcome.message.slice(0, 400),
    });
    revalidatePath("/teacher");
    teacherError(outcome.message, outcome.detail);
  }

  const run = outcome.run;

  const { data: runRow } = await supabase
    .from("agent_runs")
    .insert({
      teacher_id: user.id,
      lesson_id: lesson.id,
      kind: "challenge_generation",
      provider: run.provider,
      model: run.model,
      status: "succeeded",
      duration_ms: run.durationMs,
      input_chars: (lesson.content ?? "").length,
      objective_count: run.challenge.questions.length,
      repaired: run.repaired,
    })
    .select("id")
    .single();

  // One assessment per lesson: replace its questions wholesale.
  const { data: assessment, error: assessmentError } = await supabase
    .from("assessments")
    .upsert(
      {
        lesson_id: lesson.id,
        teacher_id: user.id,
        title: `${lesson.title} — challenge`,
        kind: "challenge" as const,
        status: "draft",
        approved_at: null,
        published_at: null,
        agent_run_id: runRow?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lesson_id,kind" },
    )
    .select("id")
    .single();

  if (assessmentError || !assessment) teacherError("The challenge set could not be created. Please try again.");

  const { error: clearError } = await supabase.from("questions").delete().eq("assessment_id", assessment.id);
  if (clearError) teacherError("Previous questions could not be replaced. Please try again.");

  for (const [index, question] of run.challenge.questions.entries()) {
    const { data: inserted, error: questionError } = await supabase
      .from("questions")
      .insert({
        assessment_id: assessment.id,
        position: index,
        kind: question.kind,
        prompt: question.prompt,
        options: question.options,
        objective_id: question.objectiveId,
        difficulty: question.difficulty,
      })
      .select("id")
      .single();

    if (questionError || !inserted) teacherError("The questions could not be saved. Please try again.");

    const { error: keyError } = await supabase.from("answer_keys").insert({
      question_id: inserted.id,
      correct_index: question.correctIndex,
      explanation: question.explanation,
    });
    if (keyError) teacherError("The answer key could not be saved. Nothing was published.");
  }

  revalidatePath("/teacher");
  teacherNotice("challenges-generated");
}

const questionInput = z.object({
  questionId: z.string().uuid(),
  prompt: z.string().trim().min(10).max(600),
  kind: z.enum(["multiple_choice", "true_false"]),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(6),
  correctIndex: z.coerce.number().int().min(0).max(5),
  explanation: z.string().trim().min(10).max(600),
});

export async function updateQuestion(formData: FormData) {
  const options = String(formData.get("options") ?? "")
    .split("\n")
    .map((option) => option.trim())
    .filter(Boolean);

  const parsed = questionInput.safeParse({
    questionId: formData.get("questionId"),
    prompt: formData.get("prompt"),
    kind: formData.get("kind"),
    options,
    correctIndex: formData.get("correctIndex"),
    explanation: formData.get("explanation"),
  });

  if (!parsed.success) {
    teacherError("Check the question: it needs a prompt, 2–6 distinct options, a valid correct answer and an explanation.");
  }

  const { supabase } = await requireActionRole("teacher");
  const data = parsed.data;

  if (data.correctIndex >= data.options.length) teacherError("The correct answer must be one of the listed options.");
  const normalised = data.options.map((option) => option.toLowerCase());
  if (new Set(normalised).size !== normalised.length) teacherError("Options must be distinct.");
  if (data.kind === "true_false" && data.options.length !== 2) teacherError("A true/false question needs exactly two options.");

  const { data: question } = await supabase
    .from("questions")
    .select("id, assessment_id")
    .eq("id", data.questionId)
    .maybeSingle();
  if (!question) teacherError("That question could not be found.");

  const { error: updateError } = await supabase
    .from("questions")
    .update({ prompt: data.prompt, kind: data.kind, options: data.options })
    .eq("id", question.id);
  if (updateError) teacherError("That question could not be saved. Please try again.");

  const { error: keyError } = await supabase
    .from("answer_keys")
    .upsert(
      { question_id: question.id, correct_index: data.correctIndex, explanation: data.explanation },
      { onConflict: "question_id" },
    );
  if (keyError) teacherError("The answer key could not be saved. Please try again.");

  await resetToDraft(supabase, question.assessment_id as string);
  revalidatePath("/teacher");
  revalidatePath("/student");
  teacherNotice("question-saved");
}

export async function deleteQuestion(formData: FormData) {
  const parsed = z.object({ questionId: z.string().uuid() }).safeParse({ questionId: formData.get("questionId") });
  if (!parsed.success) teacherError("That question could not be found.");
  const { supabase } = await requireActionRole("teacher");

  const { data: question } = await supabase
    .from("questions")
    .select("id, assessment_id")
    .eq("id", parsed.data.questionId)
    .maybeSingle();
  if (!question) teacherError("That question could not be found.");

  const { error } = await supabase.from("questions").delete().eq("id", question.id);
  if (error) teacherError("That question could not be removed. Please try again.");

  await resetToDraft(supabase, question.assessment_id as string);
  revalidatePath("/teacher");
  revalidatePath("/student");
  teacherNotice("question-removed");
}

/** Teacher approval is mandatory before publishing; status transitions are enforced here, not in the UI. */
export async function approveAssessment(formData: FormData) {
  const parsed = z.object({ assessmentId: z.string().uuid() }).safeParse({ assessmentId: formData.get("assessmentId") });
  if (!parsed.success) teacherError("That challenge set could not be found.");
  const { supabase, user } = await requireActionRole("teacher");

  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, teacher_id")
    .eq("id", parsed.data.assessmentId)
    .maybeSingle();
  if (!assessment || assessment.teacher_id !== user.id) teacherError("That challenge set could not be found.");

  const { count } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("assessment_id", assessment.id);
  if (!count) teacherError("Add at least one question before approving.");

  const { error } = await supabase
    .from("assessments")
    .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", assessment.id);
  if (error) teacherError("That challenge set could not be approved. Please try again.");

  revalidatePath("/teacher");
  teacherNotice("assessment-approved");
}

export async function publishAssessment(formData: FormData) {
  const parsed = z.object({ assessmentId: z.string().uuid() }).safeParse({ assessmentId: formData.get("assessmentId") });
  if (!parsed.success) teacherError("That challenge set could not be found.");
  const { supabase, user } = await requireActionRole("teacher");

  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, status, teacher_id")
    .eq("id", parsed.data.assessmentId)
    .maybeSingle();
  if (!assessment || assessment.teacher_id !== user.id) teacherError("That challenge set could not be found.");
  if (assessment.status !== "approved") teacherError("Approve the challenge set before publishing it to students.");

  const { error } = await supabase
    .from("assessments")
    .update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", assessment.id);
  if (error) teacherError("That challenge set could not be published. Please try again.");

  revalidatePath("/teacher");
  revalidatePath("/student");
  teacherNotice("assessment-published");
}

export async function unpublishAssessment(formData: FormData) {
  const parsed = z.object({ assessmentId: z.string().uuid() }).safeParse({ assessmentId: formData.get("assessmentId") });
  if (!parsed.success) teacherError("That challenge set could not be found.");
  const { supabase } = await requireActionRole("teacher");

  const { error } = await supabase
    .from("assessments")
    .update({ status: "approved", published_at: null, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.assessmentId);
  if (error) teacherError("That challenge set could not be unpublished. Please try again.");

  revalidatePath("/teacher");
  revalidatePath("/student");
  teacherNotice("assessment-unpublished");
}
