import { xpForQuestions } from "@/lib/learning/xp";
import type { QuestStatus, WorldQuest } from "@/features/student-world/types";

/**
 * Builds the student's world from their real progress.
 *
 * Pure on purpose: the page keeps ownership of its queries, and this can be reasoned
 * about (and checked) without a database. Nothing here writes, and nothing here invents
 * state — every status comes from data the page already fetched.
 *
 * Progression rules, unchanged from the page-level implementation this replaces:
 *   completed — a graded submission exists for the lesson's challenge
 *   studied   — a lesson_study_progress row exists for the assignment
 *   available — the first not-yet-studied assignment in each classroom
 *   locked    — everything else
 */

export type WorldAssignmentInput = {
  id: string;
  classroomId: string;
  lessonId: string;
  title: string;
  objective: string;
  classroomName: string;
  /** Published challenge questions for the lesson, used for the XP reward preview. */
  questions: number;
  studied: boolean;
  completed: boolean;
};

export type BuildWorldQuestsInput = {
  assignments: WorldAssignmentInput[];
  /**
   * `sort_order` values from `world_locations`, ascending. When empty the loader falls
   * back to array position, which is the pre-loader behaviour — so a missing or failed
   * world_locations query degrades to the old behaviour instead of an empty world.
   */
  locationOrder?: number[];
};

export function buildWorldQuests({ assignments, locationOrder = [] }: BuildWorldQuestsInput): WorldQuest[] {
  // One open quest per classroom: the first assignment the student has not studied yet.
  const nextAvailable = new Set<string>();
  const classroomWithOpenQuest = new Set<string>();
  for (const assignment of assignments) {
    if (classroomWithOpenQuest.has(assignment.classroomId)) continue;
    if (!assignment.studied) {
      nextAvailable.add(assignment.id);
      classroomWithOpenQuest.add(assignment.classroomId);
    }
  }

  const usesLocations = locationOrder.length > 0;

  return assignments.map((assignment, index) => {
    const status: QuestStatus = assignment.completed
      ? "completed"
      : assignment.studied
        ? "studied"
        : nextAvailable.has(assignment.id)
          ? "available"
          : "locked";

    const questions = assignment.questions;
    const reward = questions > 0 ? xpForQuestions(questions, questions) : 0;

    return {
      id: assignment.id,
      slot: usesLocations ? (locationOrder[index] ?? index) : index,
      title: assignment.title,
      objective: assignment.objective,
      classroomName: assignment.classroomName,
      status,
      rewardXp: reward,
      challengeQuestions: questions,
      challengeMaxXp: reward,
    };
  });
}
