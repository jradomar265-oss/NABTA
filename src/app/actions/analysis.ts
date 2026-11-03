"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActionRole } from "@/lib/auth/action-role";
import { AiAnalysisError, resolveLearningAnalyst } from "@/lib/ai";
import { buildAnalysisFacts, type AnswerRow, type QuestionRow } from "@/lib/learning/analysis";
import { contextFromClassroom } from "@/lib/education/context";

/**
 * Computes the facts for one class, then asks the configured analyst to interpret
 * them.
 *
 * The numbers come from `buildAnalysisFacts` over stored answers — never from the
 * model. The model receives those numbers and returns observations that must pass
 * validation, including the rule that thin evidence cannot be presented as a
 * conclusion. Both are stored, side by side, so a report can always be audited.
 */
export async function generateLearningAnalysis(formData: FormData) {
  const parsed = z.object({ classroomId: z.string().uuid() }).safeParse({ classroomId: formData.get("classroomId") });
  const fallback = "/teacher";
  if (!parsed.success) redirect(`${fallback}?error=${encodeURIComponent("Choose a class first.")}`);
  const classroomId = parsed.data.classroomId;
  const page = `/teacher/classrooms/${classroomId}`;

  const { supabase, user } = await requireActionRole("teacher");

  const { data: classroom, error: classroomError } = await supabase
    .from("classrooms")
    .select("id, name, grade_level, subject, curriculum")
    .eq("id", classroomId)
    .eq("teacher_id", user.id)
    .maybeSingle();

  // A query error is not the same thing as a missing row. Reporting both as "class not
  // found" is what hid an invalid-uuid bug behind what looked like an RLS problem, so
  // the two paths are now separate and neither is swallowed.
  if (classroomError) {
    console.error("[analysis] classroom lookup failed", {
      message: classroomError.message,
      code: classroomError.code,
      details: classroomError.details,
      hint: classroomError.hint,
      classroomId,
      userId: user.id,
    });
    redirect(`${fallback}?error=${encodeURIComponent(`The class lookup failed: ${classroomError.message}`)}`);
  }

  if (!classroom) {
    console.error("[analysis] classroom not found", { classroomId, userId: user.id });
    redirect(
      `${fallback}?error=${encodeURIComponent("That class could not be found. It may belong to another teacher, or it may have been deleted.")}`,
    );
  }

  const { data: assignmentRows } = await supabase
    .from("lesson_assignments")
    .select("lesson_id, lessons(id, title)")
    .eq("classroom_id", classroomId);

  const lessons = (assignmentRows ?? [])
    .map((row) => firstRow<{ id: string; title: string }>(row.lessons as { id: string; title: string } | { id: string; title: string }[] | null))
    .filter((lesson): lesson is { id: string; title: string } => Boolean(lesson));
  const lessonIds = Array.from(new Set(lessons.map((lesson) => lesson.id)));

  if (lessonIds.length === 0) {
    redirect(`${page}?error=${encodeURIComponent("This class has no assigned lessons yet, so there is nothing to analyse.")}`);
  }

  const { data: objectiveRows } = await supabase
    .from("lesson_objectives")
    .select("id, statement")
    .in("lesson_id", lessonIds)
    .eq("approved", true)
    .order("position", { ascending: true });

  const objectives = ((objectiveRows ?? []) as { id: string; statement: string }[]).map((row) => ({ id: row.id, statement: row.statement }));
  if (objectives.length === 0) {
    redirect(`${page}?error=${encodeURIComponent("Approve at least one learning objective before analysing this class.")}`);
  }

  const { data: assessmentRows } = await supabase.from("assessments").select("id").in("lesson_id", lessonIds);
  const assessmentIds = ((assessmentRows ?? []) as { id: string }[]).map((row) => row.id);

  const questions: QuestionRow[] = [];
  const submissions: { id: string; student_id: string }[] = [];
  const answers: AnswerRow[] = [];

  if (assessmentIds.length > 0) {
    const { data: questionRows } = await supabase
      .from("questions")
      .select("id, objective_id, options, prompt")
      .in("assessment_id", assessmentIds);
    for (const row of (questionRows ?? []) as { id: string; objective_id: string | null; options: string[]; prompt: string }[]) {
      questions.push({ id: row.id, objectiveId: row.objective_id, options: row.options ?? [], prompt: row.prompt });
    }

    const { data: submissionRows } = await supabase
      .from("submissions")
      .select("id, student_id")
      .in("assessment_id", assessmentIds);
    submissions.push(...((submissionRows ?? []) as { id: string; student_id: string }[]));

    if (submissions.length > 0) {
      const { data: answerRows } = await supabase
        .from("student_answers")
        .select("submission_id, question_id, choice_index, is_correct, correct_index")
        .in("submission_id", submissions.map((submission) => submission.id));

      const studentBySubmission = new Map(submissions.map((submission) => [submission.id, submission.student_id]));
      const questionById = new Map(questions.map((question) => [question.id, question]));

      for (const row of (answerRows ?? []) as {
        submission_id: string;
        question_id: string;
        choice_index: number;
        is_correct: boolean;
        correct_index: number;
      }[]) {
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
          submittedAt: new Date().toISOString(),
        });
      }
    }
  }

  const { data: memberRows } = await supabase
    .from("classroom_memberships")
    .select("student_id, profiles(display_name)")
    .eq("classroom_id", classroomId);

  const students = ((memberRows ?? []) as { student_id: string; profiles: { display_name: string } | { display_name: string }[] | null }[])
    .map((row) => {
      const profile = firstRow<{ display_name: string }>(row.profiles);
      return { id: row.student_id, displayName: profile?.display_name ?? "Student" };
    });

  const computed = buildAnalysisFacts({
    classroom: { id: classroom.id as string, name: classroom.name as string },
    lessons,
    objectives,
    questions,
    answers,
    students,
  });

  const { analyst } = resolveLearningAnalyst();
  const started = Date.now();

  let outcome: { ok: true; run: Awaited<ReturnType<typeof analyst.analyse>> } | { ok: false; message: string; detail?: string };
  try {
    outcome = { ok: true, run: await analyst.analyse(computed, contextFromClassroom(classroom)) };
  } catch (error) {
    outcome = {
      ok: false,
      message: error instanceof AiAnalysisError ? error.message : "The class could not be analysed. Nothing was saved.",
      detail: error instanceof AiAnalysisError ? error.detail : undefined,
    };
  }

  const { data: runRow } = await supabase
    .from("agent_runs")
    .insert({
      teacher_id: user.id,
      lesson_id: lessonIds[0] ?? null,
      kind: "learning_analysis",
      provider: analyst.id,
      model: analyst.isMock ? "deterministic-rules" : "",
      status: outcome.ok ? "succeeded" : "failed",
      duration_ms: outcome.ok ? outcome.run.durationMs : Date.now() - started,
      input_chars: JSON.stringify(computed).length,
      objective_count: outcome.ok ? outcome.run.observations.observations.length : 0,
      repaired: outcome.ok ? outcome.run.repaired : false,
      error_message: outcome.ok ? null : outcome.message.slice(0, 400),
    })
    .select("id")
    .single();

  if (!outcome.ok) {
    revalidatePath(page);
    redirect(`${page}?error=${encodeURIComponent(outcome.message)}`);
  }

  const { error: insertError } = await supabase.from("learning_analyses").insert({
    teacher_id: user.id,
    classroom_id: classroomId,
    lesson_id: lessonIds[0] ?? null,
    provider: outcome.run.provider,
    model: outcome.run.model,
    agent_run_id: runRow?.id ?? null,
    evidence_snapshot: computed,
    observations: outcome.run.observations,
    insufficient_evidence: outcome.run.observations.insufficientEvidence,
  });

  if (insertError) {
    redirect(`${page}?error=${encodeURIComponent("The analysis ran but could not be saved, so nothing was stored.")}`);
  }

  revalidatePath(page);
  redirect(`${page}?notice=analysis-saved`);
}

/** Supabase embeds arrive as an object or a one-element array; normalise. */
function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
