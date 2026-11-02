/**
 * Comparability between two assessments.
 *
 * A before/after comparison is only worth reading if the two occasions actually
 * measured the same thing in a similar way. This module checks the things we can
 * observe — question count, question-type mix, objective coverage, difficulty
 * labels, and whether the questions are genuinely different — and reports exactly
 * what matched and what did not.
 *
 * LIMITATION, and it must be shown to teachers: matching counts, types and difficulty
 * labels does NOT prove statistical equivalence. Two assessments can look alike and
 * still differ in wording difficulty, distractor quality, or luck. This is a
 * transparency aid, not a calibration system, and it does not make raw score movement
 * reliable evidence of learning.
 */

export type QuestionProfileInput = {
  id: string;
  objectiveId: string | null;
  kind: string;
  prompt: string;
  difficulty: string | null;
};

export type AssessmentProfile = {
  questionCount: number;
  kinds: Record<string, number>;
  difficulties: Record<string, number>;
  objectives: string[];
  /** Number of questions that could not be attributed to an objective. */
  unattributed: number;
  prompts: string[];
  /** True when at least one question carries a difficulty label. */
  difficultyRecorded: boolean;
};

export type ComparabilityMismatch = {
  area: "count" | "kinds" | "objectives" | "difficulty" | "distinctness";
  detail: string;
};

export type Comparability = {
  comparable: boolean;
  mismatches: ComparabilityMismatch[];
  /** Observations that are worth showing even when the pair is comparable. */
  notes: string[];
  /** Always present, always shown. */
  limitations: string[];
  headline: string;
};

export const COMPARABILITY_LIMITATION =
  "Matching question counts, types and difficulty labels does not prove the two assessments measure the same thing equally well. Treat any movement as a signal to investigate, not as a measurement of learning.";

const MAX_COUNT_DRIFT = 1;
const MAX_SHARE_DRIFT = 0.25;

export function profileAssessment(questions: QuestionProfileInput[]): AssessmentProfile {
  const kinds: Record<string, number> = {};
  const difficulties: Record<string, number> = {};
  const objectives = new Set<string>();
  let unattributed = 0;

  for (const question of questions) {
    kinds[question.kind] = (kinds[question.kind] ?? 0) + 1;
    if (question.difficulty) difficulties[question.difficulty] = (difficulties[question.difficulty] ?? 0) + 1;
    if (question.objectiveId) objectives.add(question.objectiveId);
    else unattributed += 1;
  }

  return {
    questionCount: questions.length,
    kinds,
    difficulties,
    objectives: Array.from(objectives).sort(),
    unattributed,
    prompts: questions.map((question) => normalise(question.prompt)),
    difficultyRecorded: Object.keys(difficulties).length > 0,
  };
}

function normalise(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

function shares(counts: Record<string, number>, total: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    out[key] = total === 0 ? 0 : value / total;
  }
  return out;
}

/**
 * Compares two assessments.
 *
 * `initial` is the challenge, `followUp` is the later check. The result is
 * deliberately conservative: any material mismatch sets `comparable: false`, and the
 * caller must then label the comparison "not directly comparable" rather than
 * presenting score movement as evidence.
 */
export function checkComparability(
  initialQuestions: QuestionProfileInput[],
  followUpQuestions: QuestionProfileInput[],
): Comparability {
  const initial = profileAssessment(initialQuestions);
  const followUp = profileAssessment(followUpQuestions);
  const mismatches: ComparabilityMismatch[] = [];
  const notes: string[] = [];

  if (initial.questionCount === 0 || followUp.questionCount === 0) {
    return {
      comparable: false,
      mismatches: [{ area: "count", detail: "One of the two assessments has no questions." }],
      notes: [],
      limitations: [COMPARABILITY_LIMITATION],
      headline: "Not directly comparable: one assessment has no questions.",
    };
  }

  if (Math.abs(initial.questionCount - followUp.questionCount) > MAX_COUNT_DRIFT) {
    mismatches.push({
      area: "count",
      detail: `The first assessment has ${initial.questionCount} questions and the follow-up has ${followUp.questionCount}.`,
    });
  }

  const initialKindShares = shares(initial.kinds, initial.questionCount);
  const followUpKindShares = shares(followUp.kinds, followUp.questionCount);
  for (const kind of new Set([...Object.keys(initialKindShares), ...Object.keys(followUpKindShares)])) {
    const drift = Math.abs((initialKindShares[kind] ?? 0) - (followUpKindShares[kind] ?? 0));
    if (drift > MAX_SHARE_DRIFT) {
      mismatches.push({
        area: "kinds",
        detail: `The share of ${kind.replace("_", " ")} questions differs by ${Math.round(drift * 100)} percentage points.`,
      });
    }
  }

  const missingObjectives = initial.objectives.filter((objective) => !followUp.objectives.includes(objective));
  const extraObjectives = followUp.objectives.filter((objective) => !initial.objectives.includes(objective));
  if (missingObjectives.length > 0 || extraObjectives.length > 0) {
    mismatches.push({
      area: "objectives",
      detail:
        `${missingObjectives.length} objective(s) covered by the first assessment are not covered by the follow-up` +
        `${extraObjectives.length > 0 ? `, and ${extraObjectives.length} new objective(s) appear only in the follow-up` : ""}.`,
    });
  }

  if (initial.unattributed > 0 || followUp.unattributed > 0) {
    notes.push(
      `${initial.unattributed + followUp.unattributed} question(s) are not linked to a learning objective, so they cannot be matched between the two occasions.`,
    );
  }

  if (!initial.difficultyRecorded || !followUp.difficultyRecorded) {
    notes.push("Difficulty was not recorded for both assessments, so difficulty could not be matched at all.");
  } else {
    const initialDifficultyShares = shares(initial.difficulties, initial.questionCount);
    const followUpDifficultyShares = shares(followUp.difficulties, followUp.questionCount);
    for (const level of new Set([...Object.keys(initialDifficultyShares), ...Object.keys(followUpDifficultyShares)])) {
      const drift = Math.abs((initialDifficultyShares[level] ?? 0) - (followUpDifficultyShares[level] ?? 0));
      if (drift > MAX_SHARE_DRIFT) {
        mismatches.push({
          area: "difficulty",
          detail: `The share of ${level} questions differs by ${Math.round(drift * 100)} percentage points.`,
        });
      }
    }
  }

  const overlap = initial.prompts.filter((prompt) => followUp.prompts.includes(prompt));
  if (overlap.length > 0) {
    mismatches.push({
      area: "distinctness",
      detail: `${overlap.length} question(s) are identical in both assessments, so those items are practice rather than a fresh check.`,
    });
  }

  const comparable = mismatches.length === 0;
  const headline = comparable
    ? "The two assessments match on count, question types, objective coverage, difficulty and distinctness."
    : `Not directly comparable: ${mismatches.length} difference${mismatches.length === 1 ? "" : "s"} found. Score movement is not reliable evidence of learning here.`;

  return { comparable, mismatches, notes, limitations: [COMPARABILITY_LIMITATION], headline };
}
