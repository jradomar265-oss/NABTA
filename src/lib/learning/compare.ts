/**
 * Comparing two measurement points for the same class.
 *
 * This is the arithmetic behind "did the follow-up show more understanding than the
 * first attempt". It reports movement; it does not explain it. A change between two
 * assessments has many possible causes and this module never asserts one — that
 * restraint is a product requirement, not a style choice.
 */

import { accuracyOf, type AnalysisFacts, type ObjectiveFact } from "./analysis";

export type ComparisonRow = {
  objectiveId: string | null;
  statement: string;
  before: { attempts: number; correct: number; accuracy: number | null };
  after: { attempts: number; correct: number; accuracy: number | null };
  /** Percentage-point change, or null when either side is not comparable. */
  deltaPoints: number | null;
  verdict: "improved" | "lower" | "unchanged" | "not-comparable";
  /** Why it is not comparable, when it is not. */
  reason: string | null;
};

export type Comparison = {
  rows: ComparisonRow[];
  comparable: number;
  improved: number;
  lower: number;
  /** Always false. Kept explicit so a caller cannot quietly claim causation. */
  causalClaim: boolean;
  statement: string;
  /** Set when the two sides were not a compatible pair and no comparison was made. */
  incompatibleReason: string | null;
};

/** A side needs usable evidence before its movement can be read. */
const MIN_COMPARABLE_ATTEMPTS = 3;

/**
 * Only these pairings are compatible. A challenge compared with targeted practice
 * would mix a test with a teaching activity, and comparing a challenge with itself
 * says nothing. Follow-up evidence is only meaningful against the initial challenge.
 */
const COMPATIBLE_PAIRS: Record<string, string[]> = {
  challenge: ["follow_up"],
  follow_up: ["challenge"],
};

export type AssessmentKind = "challenge" | "practice" | "follow_up";

export type Compatibility =
  | { compatible: true }
  | { compatible: false; reason: string };

/** Refuses to compare evidence that does not come from a compatible pair of assessments. */
export function checkCompatibility(beforeKind: AssessmentKind, afterKind: AssessmentKind): Compatibility {
  if (beforeKind === afterKind) {
    return { compatible: false, reason: `Both sides come from a ${afterKind.replace("_", "-")} assessment, so there is no change to measure.` };
  }
  const allowed = COMPATIBLE_PAIRS[beforeKind] ?? [];
  if (!allowed.includes(afterKind)) {
    return {
      compatible: false,
      reason: `A ${beforeKind.replace("_", "-")} assessment cannot be compared with a ${afterKind.replace("_", "-")} assessment; only an initial challenge can be compared with a follow-up.`,
    };
  }
  return { compatible: true };
}

function sideOf(objective: ObjectiveFact | undefined): ComparisonRow["before"] {
  if (!objective) return { attempts: 0, correct: 0, accuracy: null };
  return { attempts: objective.attempts, correct: objective.correct, accuracy: objective.accuracy };
}

/**
 * Rows are matched by objective id. An objective present on only one side is
 * reported as not comparable rather than treated as a change of zero.
 */
export function compareEvidence(
  before: AnalysisFacts,
  after: AnalysisFacts,
  kinds: { before: AssessmentKind; after: AssessmentKind } = { before: "challenge", after: "follow_up" },
): Comparison {
  const compatibility = checkCompatibility(kinds.before, kinds.after);
  if (!compatibility.compatible) {
    return {
      rows: [],
      comparable: 0,
      improved: 0,
      lower: 0,
      causalClaim: false,
      statement: "These two sets of evidence cannot be compared, so no change is reported.",
      incompatibleReason: compatibility.reason,
    };
  }

  const afterById = new Map(after.objectives.map((objective) => [objective.objectiveId, objective]));
  const seen = new Set<string | null>();

  const rows: ComparisonRow[] = [];

  for (const objective of before.objectives) {
    seen.add(objective.objectiveId);
    const counterpart = afterById.get(objective.objectiveId);
    rows.push(buildRow(objective.objectiveId, objective.statement, sideOf(objective), sideOf(counterpart)));
  }

  for (const objective of after.objectives) {
    if (seen.has(objective.objectiveId)) continue;
    rows.push(buildRow(objective.objectiveId, objective.statement, { attempts: 0, correct: 0, accuracy: null }, sideOf(objective)));
  }

  const comparable = rows.filter((row) => row.verdict !== "not-comparable").length;
  const improved = rows.filter((row) => row.verdict === "improved").length;
  const lower = rows.filter((row) => row.verdict === "lower").length;

  const statement = comparable === 0
    ? "No objective had enough answers on both occasions, so no comparison can be made."
    : `${improved} of ${comparable} comparable objective${comparable === 1 ? "" : "s"} moved up and ${lower} moved down. This is a change between two assessments, not proof of what caused it.`;

  return { rows, comparable, improved, lower, causalClaim: false, statement, incompatibleReason: null };
}

function buildRow(
  objectiveId: string | null,
  statement: string,
  before: ComparisonRow["before"],
  after: ComparisonRow["after"],
): ComparisonRow {
  if (before.attempts < MIN_COMPARABLE_ATTEMPTS) {
    return { objectiveId, statement, before, after, deltaPoints: null, verdict: "not-comparable", reason: `Only ${before.attempts} answer(s) on the first occasion; ${MIN_COMPARABLE_ATTEMPTS} are needed.` };
  }
  if (after.attempts < MIN_COMPARABLE_ATTEMPTS) {
    return { objectiveId, statement, before, after, deltaPoints: null, verdict: "not-comparable", reason: `Only ${after.attempts} answer(s) on the follow-up; ${MIN_COMPARABLE_ATTEMPTS} are needed.` };
  }
  if (before.accuracy === null || after.accuracy === null) {
    return { objectiveId, statement, before, after, deltaPoints: null, verdict: "not-comparable", reason: "One side has no accuracy to compare." };
  }

  const deltaPoints = Math.round((after.accuracy - before.accuracy) * 100);
  const verdict = deltaPoints >= 10 ? "improved" : deltaPoints <= -10 ? "lower" : "unchanged";
  return { objectiveId, statement, before, after, deltaPoints, verdict, reason: null };
}

/** Recomputes accuracy for a side that only carries raw counts (e.g. a stored snapshot). */
export function sideAccuracy(correct: number, attempts: number): number | null {
  return accuracyOf(correct, attempts);
}
