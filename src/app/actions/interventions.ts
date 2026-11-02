"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActionRole } from "@/lib/auth/action-role";
import { AiAnalysisError, resolveChallengeGenerator } from "@/lib/ai";
import { contextFromClassroom } from "@/lib/education/context";

function back(classroomId: string, kind: "error" | "notice", message: string): never {
  redirect(`/teacher/classrooms/${classroomId}?${kind}=${encodeURIComponent(message)}`);
}

/**
 * Creates a draft intervention for one learning objective, with targeted practice and
 * a separate follow-up check.
 *
 * Nothing here is visible to students: the intervention is a draft and both
 * assessments are created unpublished. Teacher approval and assignment are separate,
 * explicitly gated steps.
 */
export async function createIntervention(formData: FormData) {
  const parsed = z.object({
    classroomId: z.string().uuid(),
    lessonId: z.string().uuid(),
    objectiveId: z.string().uuid(),
  }).safeParse({
    classroomId: formData.get("classroomId"),
    lessonId: formData.get("lessonId"),
    objectiveId: formData.get("objectiveId"),
  });
  if (!parsed.success) redirect("/teacher?error=" + encodeURIComponent("Choose an objective to build practice for."));
  const { classroomId, lessonId, objectiveId } = parsed.data;

  const { supabase, user } = await requireActionRole("teacher");

  const { data: classroom } = await supabase.from("classrooms").select("id, name, grade_level, subject, curriculum").eq("id", classroomId).eq("teacher_id", user.id).maybeSingle();
  if (!classroom) back(classroomId, "error", "That class could not be found.");

  const { data: lesson } = await supabase.from("lessons").select("id, title, content").eq("id", lessonId).eq("teacher_id", user.id).maybeSingle();
  if (!lesson) back(classroomId, "error", "That lesson could not be found.");

  const { data: objective } = await supabase
    .from("lesson_objectives")
    .select("id, statement, skills")
    .eq("id", objectiveId)
    .eq("teacher_id", user.id)
    .eq("approved", true)
    .maybeSingle();
  if (!objective) back(classroomId, "error", "That objective is not approved, so it cannot be the target of an intervention.");

  const { generator } = resolveChallengeGenerator();
  const objectives = [{ id: objective.id as string, statement: objective.statement as string, skills: (objective.skills as string[] | null) ?? [] }];

  async function generate(requirements?: { questionCount?: number; difficultyMix?: Record<string, number>; avoidPrompts?: string[] }) {
    try {
      const run = await generator.generate({
        title: lesson!.title as string,
        content: lesson!.content as string,
        objectives,
        context: contextFromClassroom(classroom),
        requirements,
      });
      return { questions: run.challenge.questions, provider: run.provider, model: run.model, durationMs: run.durationMs };
    } catch (error) {
      const message = error instanceof AiAnalysisError ? error.message : "The practice could not be generated. Nothing was saved.";
      back(classroomId, "error", message);
    }
  }

  // Practice teaches, then the follow-up is requested with the same shape so a
  // comparison has a chance of being fair. Mock mode cannot reword its templates, so
  // such a pair will honestly read as "not directly comparable".
  const practice = await generate();

  const difficultyMix: Record<string, number> = {};
  for (const question of practice.questions) {
    difficultyMix[question.difficulty] = (difficultyMix[question.difficulty] ?? 0) + 1;
  }

  const followUp = await generate({
    questionCount: practice.questions.length,
    difficultyMix,
    avoidPrompts: practice.questions.map((question) => question.prompt),
  });

  const { data: runRow } = await supabase
    .from("agent_runs")
    .insert({
      teacher_id: user.id,
      lesson_id: lesson.id,
      kind: "intervention_generation",
      provider: practice.provider,
      model: practice.model,
      status: "succeeded",
      duration_ms: practice.durationMs + followUp.durationMs,
      input_chars: (lesson.content ?? "").length,
      objective_count: practice.questions.length + followUp.questions.length,
      repaired: false,
    })
    .select("id")
    .single();

  async function writeAssessment(kind: "practice" | "follow_up", title: string, items: typeof practice.questions): Promise<string> {
    const { data: assessment, error } = await supabase
      .from("assessments")
      .upsert(
        {
          lesson_id: lesson!.id,
          teacher_id: user!.id,
          title,
          kind,
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
    if (error || !assessment) back(classroomId, "error", `The ${kind.replace("_", "-")} activity could not be created.`);

    await supabase.from("questions").delete().eq("assessment_id", assessment.id);

    for (const [index, question] of items.entries()) {
      const { data: inserted, error: questionError } = await supabase
        .from("questions")
        .insert({
          assessment_id: assessment.id,
          position: index,
          kind: question.kind,
          prompt: question.prompt,
          options: question.options,
          objective_id: objective!.id,
          difficulty: question.difficulty,
        })
        .select("id")
        .single();
      if (questionError || !inserted) back(classroomId, "error", "The practice questions could not be saved.");

      const { error: keyError } = await supabase.from("answer_keys").insert({
        question_id: inserted.id,
        correct_index: question.correctIndex,
        explanation: question.explanation,
      });
      if (keyError) back(classroomId, "error", "The answer keys could not be saved. Nothing was assigned.");
    }

    return assessment.id as string;
  }

  const practiceId = await writeAssessment("practice", `${lesson.title} — targeted practice`, practice.questions);
  const followUpId = await writeAssessment("follow_up", `${lesson.title} — follow-up check`, followUp.questions);

  const { error: insertError } = await supabase.from("interventions").insert({
    teacher_id: user.id,
    classroom_id: classroomId,
    lesson_id: lesson.id,
    objective_id: objective.id,
    title: `Practice: ${(objective.statement as string).slice(0, 120)}`,
    rationale: `Created from the class analysis for ${classroom.name as string}. Target objective: ${objective.statement as string}. This practice is assigned to the whole class; it is not tailored to each student's individual gap.`,
    status: "draft",
    scope: "class" as const,
    practice_assessment_id: practiceId,
    follow_up_assessment_id: followUpId,
    agent_run_id: runRow?.id ?? null,
  });

  if (insertError) back(classroomId, "error", "The intervention could not be saved, so nothing was assigned.");

  revalidatePath(`/teacher/classrooms/${classroomId}`);
  back(classroomId, "notice", "Draft intervention created. Review the questions, then approve it — students cannot see it yet.");
}

/** Teacher approval. Required before an intervention can be assigned. */
export async function approveIntervention(formData: FormData) {
  const parsed = z.object({ interventionId: z.string().uuid(), classroomId: z.string().uuid() }).safeParse({
    interventionId: formData.get("interventionId"),
    classroomId: formData.get("classroomId"),
  });
  if (!parsed.success) redirect("/teacher?error=" + encodeURIComponent("That intervention could not be found."));
  const { classroomId } = parsed.data;

  const { supabase, user } = await requireActionRole("teacher");
  const { data: intervention } = await supabase
    .from("interventions")
    .select("id, status")
    .eq("id", parsed.data.interventionId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  if (!intervention) back(classroomId, "error", "That intervention could not be found.");
  if (intervention.status !== "draft") back(classroomId, "error", "Only a draft intervention can be approved.");

  const { error } = await supabase
    .from("interventions")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", intervention.id);
  if (error) back(classroomId, "error", "That intervention could not be approved.");

  revalidatePath(`/teacher/classrooms/${classroomId}`);
  back(classroomId, "notice", "Intervention approved. Assign it when you are ready for students to see it.");
}

/**
 * Assignment publishes the practice and follow-up assessments for the class.
 *
 * Publishing is what makes them readable by students (RLS requires
 * `status = 'published'`), so an approved-but-unassigned intervention stays invisible.
 */
export async function assignIntervention(formData: FormData) {
  const parsed = z.object({ interventionId: z.string().uuid(), classroomId: z.string().uuid() }).safeParse({
    interventionId: formData.get("interventionId"),
    classroomId: formData.get("classroomId"),
  });
  if (!parsed.success) redirect("/teacher?error=" + encodeURIComponent("That intervention could not be found."));
  const { classroomId } = parsed.data;

  const { supabase, user } = await requireActionRole("teacher");
  const { data: intervention } = await supabase
    .from("interventions")
    .select("id, status, practice_assessment_id, follow_up_assessment_id")
    .eq("id", parsed.data.interventionId)
    .eq("teacher_id", user.id)
    .maybeSingle();
  if (!intervention) back(classroomId, "error", "That intervention could not be found.");
  if (intervention.status !== "approved") back(classroomId, "error", "Approve the intervention before assigning it.");

  const ids = [intervention.practice_assessment_id, intervention.follow_up_assessment_id].filter(Boolean) as string[];
  if (ids.length !== 2) back(classroomId, "error", "This intervention is missing its practice or follow-up activity.");

  const { error: publishError } = await supabase
    .from("assessments")
    .update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in("id", ids);
  if (publishError) back(classroomId, "error", "The activities could not be published, so nothing was assigned.");

  const { error } = await supabase
    .from("interventions")
    .update({ status: "assigned", assigned_at: new Date().toISOString() })
    .eq("id", intervention.id);
  if (error) back(classroomId, "error", "The activities were published but the intervention could not be marked as assigned.");

  revalidatePath(`/teacher/classrooms/${classroomId}`);
  revalidatePath("/student");
  back(classroomId, "notice", "Intervention assigned. Students now see the practice and the follow-up check on that quest.");
}
