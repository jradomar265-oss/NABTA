"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActionRole } from "@/lib/auth/action-role";
import { AiAnalysisError, resolveCompanion } from "@/lib/ai";

const MAX_QUESTION = 600;

function back(assignmentId: string, key: "error" | "askError", message: string): never {
  redirect(`/student/quest/${assignmentId}?${key}=${encodeURIComponent(message)}`);
}

/**
 * Answers one student question about one lesson.
 *
 * The companion receives the lesson text and its approved objectives — never the
 * assessment, never an answer key — and the result is stored so the teacher can see
 * what was discussed. Nothing here writes XP or completion.
 */
export async function askCompanion(formData: FormData) {
  const parsed = z.object({
    assignmentId: z.string().uuid(),
    question: z.string().trim().min(3, "Ask a slightly longer question.").max(MAX_QUESTION),
  }).safeParse({ assignmentId: formData.get("assignmentId"), question: formData.get("question") });

  const rawAssignmentId = typeof formData.get("assignmentId") === "string" ? String(formData.get("assignmentId")) : "unknown";
  if (!parsed.success) {
    back(rawAssignmentId, "askError", "Ask a question between 3 and 600 characters.");
  }

  const { supabase, user } = await requireActionRole("student");
  const page = `/student/quest/${parsed.data.assignmentId}`;

  // RLS already scopes this to the student's own assignments.
  const { data: assignment } = await supabase
    .from("lesson_assignments")
    .select("id, lesson_id, lessons(title, content)")
    .eq("id", parsed.data.assignmentId)
    .maybeSingle();
  if (!assignment) back(parsed.data.assignmentId, "askError", "That lesson could not be found.");

  const lesson = Array.isArray(assignment.lessons) ? assignment.lessons[0] : assignment.lessons;
  const lessonTitle = (lesson?.title as string | undefined) ?? "This lesson";
  const lessonContent = (lesson?.content as string | undefined) ?? "";

  const { data: objectiveRows } = await supabase
    .from("lesson_objectives")
    .select("statement")
    .eq("lesson_id", assignment.lesson_id)
    .eq("approved", true)
    .order("position", { ascending: true });
  const objectives = ((objectiveRows ?? []) as { statement: string }[]).map((row) => row.statement);

  const { data: recentRows } = await supabase
    .from("companion_messages")
    .select("question, answer")
    .eq("student_id", user.id)
    .eq("assignment_id", parsed.data.assignmentId)
    .order("created_at", { ascending: false })
    .limit(3);
  const recentTurns = ((recentRows ?? []) as { question: string; answer: string }[]).reverse();

  const { companion } = resolveCompanion();

  let outcome: { ok: true; run: Awaited<ReturnType<typeof companion.answer>> } | { ok: false; message: string };
  try {
    outcome = {
      ok: true,
      run: await companion.answer({
        lessonTitle,
        lessonContent,
        objectives,
        question: parsed.data.question,
        recentTurns,
      }),
    };
  } catch (error) {
    outcome = {
      ok: false,
      message: error instanceof AiAnalysisError ? error.message : "The companion could not answer just now. Please try again.",
    };
  }

  if (!outcome.ok) back(parsed.data.assignmentId, "askError", outcome.message);

  const { error: insertError } = await supabase.from("companion_messages").insert({
    student_id: user.id,
    lesson_id: assignment.lesson_id,
    assignment_id: parsed.data.assignmentId,
    question: parsed.data.question,
    answer: outcome.run.result.answer,
    refused: outcome.run.result.refused,
    provider: outcome.run.provider,
    model: outcome.run.model,
    context_missing: outcome.run.contextMissing,
  });

  if (insertError) back(parsed.data.assignmentId, "askError", "Your question was answered but could not be saved, so nothing was stored.");

  revalidatePath(page);
  redirect(page);
}
