import {
  parseObservations,
  type LearningAnalysisRun,
  type LearningAnalyst,
  type LearningObservations,
  type Observation,
} from "./analysis";
import type { AnalysisFacts } from "@/lib/learning/analysis";
import { AiAnalysisError } from "./types";

/**
 * Deterministic stand-in for the learning analyst.
 *
 * It reads only the computed fact sheet and writes observations straight from the
 * thresholds, so it can never say more than the numbers support. Its output goes
 * through the same validator as a live model, including the rule that thin facts
 * must be reported as insufficient.
 */
export const mockLearningAnalyst: LearningAnalyst = {
  id: "mock",
  label: "Mock analyst (deterministic, no model call)",
  isMock: true,

  async analyse(facts: AnalysisFacts): Promise<LearningAnalysisRun> {
    const started = Date.now();

    if (facts.totals.answers === 0) {
      const empty: LearningObservations = {
        summary: `No student has answered the challenge for ${facts.classroom.name} yet, so there is nothing to interpret.`,
        observations: [],
        challengeItems: [],
        difficultyRecommendation: null,
        limitations: [facts.insufficientReasons[0] ?? "No answers recorded."],
        insufficientEvidence: true,
      };
      const parsed = parseObservations(empty, facts);
      if (!parsed.ok) throw new AiAnalysisError("The analysis failed validation.", `mock:invalid-output: ${parsed.reason}`);
      return { observations: parsed.value, provider: "mock", model: "deterministic-rules", durationMs: Date.now() - started, repaired: false };
    }

    const observations: Observation[] = [];

    for (const objective of facts.objectives) {
      const percent = objective.accuracy === null ? 0 : Math.round(objective.accuracy * 100);
      const evidence = `${objective.correct} of ${objective.attempts} answers correct (${percent}%) from ${objective.studentsAttempted} student(s).`;
      const confidence: Observation["confidence"] = objective.attempts >= 8 ? "high" : objective.attempts >= 5 ? "moderate" : "low";

      if (objective.status === "strength") {
        observations.push({
          kind: "strength",
          objectiveId: objective.objectiveId,
          statement: `The class showed secure work on "${objective.statement}".`,
          evidence,
          confidence,
        });
      } else if (objective.status === "gap") {
        const distractor = objective.topDistractor
          ? ` The wrong answer chosen most often was "${objective.topDistractor.text}" (${objective.topDistractor.count} times), which suggests a shared misconception worth addressing.`
          : "";
        observations.push({
          kind: "gap",
          objectiveId: objective.objectiveId,
          statement: `"${objective.statement}" is not yet secure for this class.`,
          evidence: `${evidence}${distractor}`,
          confidence,
        });
      } else if (objective.status === "needs-more-evidence") {
        observations.push({
          kind: "insufficient",
          objectiveId: objective.objectiveId,
          statement: `"${objective.statement}" needs more answers before anything can be said about it.`,
          evidence: `Only ${objective.attempts} answer(s) recorded; ${facts.thresholds.minAttemptsForHypothesis} are needed.`,
          confidence: "low",
        });
      } else if (objective.status === "not-assessed") {
        observations.push({
          kind: "insufficient",
          objectiveId: objective.objectiveId,
          statement: `"${objective.statement}" has not been assessed yet.`,
          evidence: `No answers recorded for this objective (0 of ${facts.thresholds.minAttemptsForHypothesis} needed).`,
          confidence: "low",
        });
      }
    }

    // Gaps and strengths are actionable; "needs more evidence" is context. Keep that
    // order so truncation never hides the findings a teacher can act on.
    const priority: Record<Observation["kind"], number> = { gap: 0, strength: 1, insufficient: 2 };
    observations.sort((left, right) => priority[left.kind] - priority[right.kind]);

    const strengths = observations.filter((observation) => observation.kind === "strength").length;
    const gaps = observations.filter((observation) => observation.kind === "gap").length;

    // Comment on how the QUESTIONS behaved, from the option counts alone.
    const challengeItems: LearningObservations["challengeItems"] = [];
    for (const question of facts.questions) {
      if (question.evidenceState !== "usable") continue;
      const percent = question.accuracy === null ? 0 : Math.round(question.accuracy * 100);
      const spread = question.optionCounts.map((count, index) => `option ${index + 1} chosen ${count} time(s)`).join(", ");
      if (question.status === "too-hard") {
        challengeItems.push({
          questionId: question.questionId,
          statement: `This question was answered correctly only ${percent}% of the time, so it may be testing something the lesson did not settle.`,
          evidence: `${question.correct}/${question.attempts} correct (${percent}%); ${spread}.`,
          confidence: question.attempts >= 8 ? "moderate" : "low",
        });
      } else if (question.status === "too-easy") {
        challengeItems.push({
          questionId: question.questionId,
          statement: "Almost everyone answered this question correctly, so it tells you little about who needs help.",
          evidence: `${question.correct}/${question.attempts} correct (${percent}%); ${spread}.`,
          confidence: question.attempts >= 8 ? "moderate" : "low",
        });
      }
      if (challengeItems.length >= 5) break;
    }

    const hasGap = facts.objectives.some((objective) => objective.status === "gap");
    const allSecure = facts.objectives.every((objective) => objective.status === "strength" || objective.status === "not-assessed");
    const tooHard = facts.questions.some((question) => question.status === "too-hard");

    const difficultyRecommendation: LearningObservations["difficultyRecommendation"] =
      facts.evidenceState !== "usable"
        ? null
        : hasGap || tooHard
          ? { direction: "easier", reason: `Accuracy is low enough that the next set should rehearse the same objective with more scaffolding before raising demand.` }
          : allSecure
            ? { direction: "harder", reason: "Every assessed objective is secure on this evidence, so the next set can add a step of difficulty." }
            : { direction: "keep", reason: "The current demand looks appropriate; more evidence is needed before changing it." };

    const limitations = [
      ...facts.insufficientReasons,
      "Based on one assessment of one class; it describes these answers, not the students' ability in general.",
    ].slice(0, 4);

    const candidate: LearningObservations = {
      summary: `${facts.classroom.name}: ${facts.totals.correct} of ${facts.totals.answers} answers correct (${Math.round((facts.totals.accuracy ?? 0) * 100)}%) across ${facts.objectives.length} objectives. ${strengths} secure area(s), ${gaps} area(s) needing practice.`,
      observations: observations.slice(0, 6),
      challengeItems,
      difficultyRecommendation,
      limitations,
      insufficientEvidence: facts.evidenceState !== "usable",
    };

    const parsed = parseObservations(candidate, facts);
    if (!parsed.ok) {
      throw new AiAnalysisError("The analysis failed validation.", `mock:invalid-output: ${parsed.reason}`);
    }

    return {
      observations: parsed.value,
      provider: "mock",
      model: "deterministic-rules",
      durationMs: Date.now() - started,
      repaired: false,
    };
  },
};
