"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActionRole } from "@/lib/auth/action-role";

function teacherError(message: string): never {
  redirect(`/teacher?error=${encodeURIComponent(message)}`);
}

function studentError(message: string): never {
  redirect(`/student?error=${encodeURIComponent(message)}`);
}

export async function createClassroom(formData: FormData) {
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse({ name: formData.get("name") });
  if (!parsed.success) teacherError("Enter a class name of up to 80 characters.");
  const { supabase, user } = await requireActionRole("teacher");
  const { error } = await supabase.from("classrooms").insert({ name: parsed.data.name, teacher_id: user.id });
  if (error) teacherError("We could not create that class. Please try again.");
  revalidatePath("/teacher");
  redirect("/teacher?notice=class-created");
}

export async function createLesson(formData: FormData) {
  const parsed = z.object({
    title: z.string().trim().min(1).max(160),
    learningObjective: z.string().trim().max(500),
    content: z.string().trim().min(1).max(20000),
  }).safeParse({ title: formData.get("title"), learningObjective: formData.get("learningObjective"), content: formData.get("content") });
  if (!parsed.success) teacherError("Add a title, lesson content, and an optional objective within the allowed lengths.");
  const { supabase, user } = await requireActionRole("teacher");
  const { error } = await supabase.from("lessons").insert({
    teacher_id: user.id,
    title: parsed.data.title,
    learning_objective: parsed.data.learningObjective,
    content: parsed.data.content,
  });
  if (error) teacherError("We could not save that lesson. Please try again.");
  revalidatePath("/teacher");
  redirect("/teacher?notice=lesson-saved");
}

export async function assignLesson(formData: FormData) {
  const parsed = z.object({ lessonId: z.string().uuid(), classroomId: z.string().uuid() }).safeParse({ lessonId: formData.get("lessonId"), classroomId: formData.get("classroomId") });
  if (!parsed.success) teacherError("Choose both a class and a lesson.");
  const { supabase } = await requireActionRole("teacher");
  const { error } = await supabase.from("lesson_assignments").upsert({ lesson_id: parsed.data.lessonId, classroom_id: parsed.data.classroomId }, { onConflict: "lesson_id,classroom_id" });
  if (error) teacherError("We could not assign that lesson. Please try again.");
  revalidatePath("/teacher");
  revalidatePath("/student");
  redirect("/teacher?notice=lesson-assigned");
}

export async function joinClassroom(formData: FormData) {
  const parsed = z.object({ code: z.string().trim().regex(/^[a-zA-Z0-9]{6}$/) }).safeParse({ code: formData.get("code") });
  if (!parsed.success) studentError("Enter the six-character class code from your teacher.");
  const { supabase } = await requireActionRole("student");
  const { error } = await supabase.rpc("join_classroom_by_code", { p_join_code: parsed.data.code });
  if (error) studentError("That class code could not be joined. Check it with your teacher and try again.");
  revalidatePath("/student");
  redirect("/student?notice=class-joined");
}

export async function saveStudentOnboarding(formData: FormData) {
  const parsed = z.object({
    displayName: z.string().trim().min(1).max(80),
    avatarKey: z.enum(["sprout", "sun", "leaf"]),
  }).safeParse({ displayName: formData.get("displayName"), avatarKey: formData.get("avatarKey") });
  if (!parsed.success) studentError("Choose a name and one of the available character markers.");
  const { supabase, user } = await requireActionRole("student");
  const { error } = await supabase.from("profiles").update({ display_name: parsed.data.displayName, avatar_key: parsed.data.avatarKey, onboarding_completed: true }).eq("id", user.id);
  if (error) studentError("We could not save your learning profile. Please try again.");
  revalidatePath("/student");
  redirect("/student?notice=profile-saved");
}

/**
 * Records that a student has studied an assigned lesson.
 *
 * This is a study acknowledgement, not mastery: the row only opens the next quest.
 * The RPC re-checks the student role and classroom membership server-side, and the
 * table grants are select-only so no client can write progress or XP directly.
 */
export async function markLessonStudied(assignmentId: string) {
  const parsed = z.string().uuid().safeParse(assignmentId);
  if (!parsed.success) studentError("That quest could not be found.");
  const { supabase } = await requireActionRole("student");
  const { error } = await supabase.rpc("mark_lesson_studied", { p_assignment: parsed.data });
  if (error) studentError("We could not save your study progress. Please try again.");
  revalidatePath("/student");
}

/** Form-friendly wrapper so a plain <form action> can mark study from the quest page. */
export async function markLessonStudiedFromForm(formData: FormData) {
  const parsed = z.string().uuid().safeParse(formData.get("assignmentId"));
  if (!parsed.success) studentError("That quest could not be found.");
  await markLessonStudied(parsed.data);
  revalidatePath("/student");
}
