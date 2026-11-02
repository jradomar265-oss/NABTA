import { z } from "zod";

import type { AnalysisFacts, EvidenceState } from "@/lib/learning/analysis";

/** An interpretation, never a measurement. Every one must carry its numbers. */
export type Observation = {
  kind: "strength" | "gap" | "insufficient";
  objectiveId: string | null;
  statement: string;
  evidence: string;
  confidence: "high" | "moderate" | "low";
};

export type LearningObservations = {
  summary: string;
  observations: Observation[];
  limitations: string[];
  insufficientEvidence: boolean;
};

export type LearningAnalysisRun = {
  observations: LearningObservations;
  provider: string;
  model: string;
  durationMs: number;
  repaired: boolean;
};

export interface LearningAnalyst {
  readonly id: string;
  readonly label: string;
  readonly isMock: boolean;
  analyse(facts: AnalysisFacts): Promise<LearningAnalysisRun>;
}

const observationSchema = z.object({
  kind: z.enum(["strength", "gap", "insufficient"]),
  objectiveId: z.string().uuid().nullable(),
  statement: z.string().trim().min(10, "observation is too short").max(400),
  evidence: z.string().trim().min(5, "observation must cite the numbers it is based on").max(400),
  confidence: z.enum(["high", "moderate", "low"]),
});

export const observationsSchema = z.object({
  summary: z.string().trim().min(10).max(1200),
  observations: z.array(observationSchema).max(8),
  limitations: z.array(z.string().trim().min(5).max(300)).max(6),
  insufficientEvidence: z.boolean(),
});

export type ParseResult =
  | { ok: true; value: LearningObservations }
  | { ok: false; reason: string };

/**
 * Validates a model's observations against the facts they claim to describe.
 *
 * Two rules beyond the schema:
 * - every `objectiveId` must exist in the fact sheet, so a hypothesis cannot be
 *   attached to an objective that was never assessed;
 * - when the facts are not usable, `insufficientEvidence` must be true, so a model
 *   cannot sound certain about one answer.
 */
export function parseObservations(
  raw: unknown,
  facts: Pick<AnalysisFacts, "objectives" | "evidenceState">,
): ParseResult {
  let candidate: unknown = raw;

  if (typeof raw === "string") {
    const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      candidate = JSON.parse(text);
    } catch {
      return { ok: false, reason: "the response was not valid JSON" };
    }
  }

  if (!candidate || typeof candidate !== "object") {
    return { ok: false, reason: "the response was not a JSON object" };
  }

  const parsed = observationsSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: `${first?.path.join(".") || "response"}: ${first?.message ?? "did not match the schema"}` };
  }

  const allowed = new Set(facts.objectives.map((objective) => objective.objectiveId).filter(Boolean) as string[]);
  const stray = parsed.data.observations.find((observation) => observation.objectiveId && !allowed.has(observation.objectiveId));
  if (stray) {
    return { ok: false, reason: "an observation referenced an objective that is not in the fact sheet" };
  }

  if (facts.evidenceState !== "usable" && !parsed.data.insufficientEvidence) {
    return { ok: false, reason: "the facts are not strong enough to support conclusions, so insufficientEvidence must be true" };
  }

  return { ok: true, value: parsed.data };
}

/** Renders the fact sheet as prompt input — numbers only, no free-text student data. */
export function factsForPrompt(facts: AnalysisFacts): string {
  const objectives = facts.objectives
    .map((objective, index) => {
      const accuracy = objective.accuracy === null ? "n/a" : `${Math.round(objective.accuracy * 100)}%`;
      const distractor = objective.topDistractor
        ? ` most-chosen wrong answer: "${objective.topDistractor.text}" x${objective.topDistractor.count}`
        : "";
      return `${index + 1}. "${objective.statement}" — answered ${objective.attempts} times by ${objective.studentsAttempted} student(s), ${objective.correct} correct (${accuracy}), evidence: ${objective.evidenceState}, computed status: ${objective.status}.${distractor}`;
    })
    .join("\n");

  const students = facts.students
    .filter((student) => student.attempts > 0)
    .map((student) => `- ${student.displayName}: ${student.correct}/${student.attempts} correct (${student.accuracy === null ? "n/a" : `${Math.round(student.accuracy * 100)}%`}) across ${student.objectivesAttempted} objectives`)
    .join("\n");

  return [
    `Class: ${facts.classroom.name}`,
    `Lessons: ${facts.lessons.map((lesson) => lesson.title).join(", ") || "none"}`,
    `Totals: ${facts.totals.answers} answers, ${facts.totals.correct} correct, ${facts.totals.accuracy === null ? "n/a" : `${Math.round(facts.totals.accuracy * 100)}%`}, from ${facts.totals.studentsWithAnswers} student(s).`,
    `Overall evidence state: ${facts.evidenceState}.`,
    "Objectives:",
    objectives || "none",
    "Students who answered:",
    students || "none",
    facts.insufficientReasons.length > 0 ? `Known evidence limits:\n- ${facts.insufficientReasons.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const ANALYSIS_SYSTEM_PROMPT = [
  "You help a teacher interpret assessment numbers for a Grade 6 class.",
  "You are given a fact sheet that was computed from stored answers. You do not calculate anything yourself.",
  "Rules:",
  "- Every observation MUST cite the numbers it is based on, copied from the fact sheet (attempts, correct count, percentage, number of students).",
  "- Never describe a student's ability, personality, effort or potential. Describe only the evidence from this assessment.",
  "- Do not claim causation. Say what the answers show, not why.",
  "- If an objective's evidence state is not 'usable', you may only report it as needing more evidence.",
  "- If the overall evidence state is not 'usable', set insufficientEvidence to true.",
  "- Keep 'limitations' to honest scope statements (small sample, single assessment, one class).",
  "- objectiveId must be one of the ids implicit in the fact-sheet order; use the exact uuid supplied in the input list.",
  'Return JSON only: {"summary": string, "observations": [{"kind": "strength"|"gap"|"insufficient", "objectiveId": string|null, "statement": string, "evidence": string, "confidence": "high"|"moderate"|"low"}], "limitations": string[], "insufficientEvidence": boolean}',
].join("\n");

export function analysisUserPrompt(facts: AnalysisFacts, objectiveIds: string[], repairReason?: string): string {
  const ids = facts.objectives
    .map((objective, index) => `${index + 1}. ${objective.objectiveId ?? "unassigned"} — "${objective.statement}"`)
    .join("\n");

  const parts = [
    "Objective ids (use these exact values in objectiveId):",
    ids,
    "Fact sheet:",
    factsForPrompt(facts),
    "Write at most 6 observations. Prefer fewer, well-evidenced ones.",
  ];
  if (repairReason) {
    parts.push(`Your previous answer could not be used because ${repairReason}. Return corrected JSON only.`);
  }
  return parts.join("\n\n");
}

/** Honest fallback wording when the facts cannot support conclusions. */
export function evidenceLimitNote(state: EvidenceState): string {
  if (state === "none") return "No answers have been recorded for this class yet.";
  if (state === "insufficient") return "There is not enough evidence yet to draw conclusions about this class.";
  return "These observations describe one assessment of one class, not the students' overall ability.";
}
