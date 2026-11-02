import {
  analysisSystemPrompt,
  analysisUserPrompt,
  parseObservations,
  type LearningAnalysisRun,
  type LearningAnalyst,
} from "./analysis";
import type { AnalysisFacts } from "@/lib/learning/analysis";
import type { EducationContext } from "@/lib/education/context";
import { AiAnalysisError } from "./types";

/** A chat transport: takes a system and user message, returns the model's text. */
export type ChatTransport = (system: string, user: string) => Promise<string>;

/**
 * Learning analyst over any chat transport (Gemini native, or an OpenAI-shaped
 * endpoint). It sees only the fact sheet, and its output must pass the same
 * validator as the mock — including the rule that thin facts cannot be presented
 * as conclusions.
 */
export function createLiveLearningAnalyst(options: {
  id: string;
  label: string;
  model: string;
  chat: ChatTransport;
}): LearningAnalyst {
  if (typeof window !== "undefined") {
    throw new Error("The learning analyst must run on the server only.");
  }

  return {
    id: options.id,
    label: options.label,
    isMock: false,

    async analyse(facts: AnalysisFacts, context?: EducationContext | null): Promise<LearningAnalysisRun> {
      const started = Date.now();
      const objectiveIds = facts.objectives.map((objective) => objective.objectiveId).filter(Boolean) as string[];

      const ask = (repairReason?: string) =>
        options.chat(analysisSystemPrompt(context), analysisUserPrompt(facts, objectiveIds, repairReason));

      const first = parseObservations(await ask(), facts);
      if (first.ok) {
        return { observations: first.value, provider: options.id, model: options.model, durationMs: Date.now() - started, repaired: false };
      }

      const second = parseObservations(await ask(first.reason), facts);
      if (second.ok) {
        return { observations: second.value, provider: options.id, model: options.model, durationMs: Date.now() - started, repaired: true };
      }

      throw new AiAnalysisError(
        "The AI returned observations that did not match the required structure, twice. Nothing was saved.",
        `invalid-output: ${second.reason}`,
      );
    },
  };
}
