"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActionRole } from "@/lib/auth/action-role";

function questError(assignmentId: string, message: string): never {
  redirect(`/student/quest/${assignmentId}?error=${encodeURIComponent(message)}`);
}

/**
 * Collects the student's choices and hands grading to the database.
 *
 * No score, correctness flag or XP value is computed or accepted here: the client
 * only sends option indices, and `submit_challenge()` re-checks everything against
 * the stored answer key that students cannot read.
 */
export async function submitChallenge(formData: FormData) {
  const parsed = z.string().uuid().safeParse(formData.get("assignmentId"));
  if (!parsed.success) redirect("/student?error=That%20quest%20could%20not%20be%20found.");
  const assignmentId = parsed.data;

  const { supabase } = await requireActionRole("student");

  const { data: assignment } = await supabase
    .from("lesson_assignments")
    .select("id, lesson_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment) questError(assignmentId, "That quest is not assigned to you.");

  const { data: assessment } = await supabase
    .from("assessments")
    .select("id, status")
    .eq("lesson_id", assignment.lesson_id)
    .maybeSingle();
  if (!assessment) questError(assignmentId, "This lesson has no challenge yet.");
  if (assessment.status !== "published") questError(assignmentId, "This challenge has not been published by your teacher.");

  const { data: questions } = await supabase.from("questions").select("id, options").eq("assessment_id", assessment.id);
  if (!questions || questions.length === 0) questError(assignmentId, "This challenge has no questions yet.");

  const answers: Record<string, number> = {};
  for (const question of questions as { id: string; options: string[] }[]) {
    const raw = formData.get(`choice_${question.id}`);
    const choice = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length) {
      questError(assignmentId, "Answer every question before submitting.");
    }
    answers[question.id] = choice;
  }

  const { error } = await supabase.rpc("submit_challenge", {
    p_assessment: assessment.id,
    p_answers: answers,
  });

  if (error) {
    questError(assignmentId, error.message || "Your answers could not be submitted. Please try again.");
  }

  revalidatePath("/student");
  revalidatePath(`/student/quest/${assignmentId}`);
  redirect(`/student/quest/${assignmentId}?submitted=1`);
}
