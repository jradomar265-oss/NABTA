import {
  companionSystemPrompt,
  companionUserPrompt,
  parseCompanionAnswer,
  type Companion,
  type CompanionInput,
  type CompanionRun,
} from "./companion";
import type { ChatTransport } from "./analysis-live";
import { AiAnalysisError } from "./types";

/**
 * Learning companion over any chat transport.
 *
 * The lesson text and objectives are the only context it receives; there is no
 * answer key in the prompt and no assessment payload, so it cannot leak one even if
 * asked directly. Its output must cite the lesson, and refusals carry no citations.
 */
export function createLiveCompanion(options: {
  id: string;
  label: string;
  model: string;
  chat: ChatTransport;
}): Companion {
  if (typeof window !== "undefined") {
    throw new Error("The learning companion must run on the server only.");
  }

  return {
    id: options.id,
    label: options.label,
    isMock: false,

    async answer(input: CompanionInput): Promise<CompanionRun> {
      const started = Date.now();
      const contextMissing = input.lessonContent.trim().length < 80;

      const ask = (repairReason?: string) =>
        options.chat(companionSystemPrompt(input.context), companionUserPrompt(input, repairReason));

      const first = parseCompanionAnswer(await ask(), input.lessonContent);
      if (first.ok) {
        return { result: first.value, provider: options.id, model: options.model, durationMs: Date.now() - started, repaired: false, contextMissing };
      }

      const second = parseCompanionAnswer(await ask(first.reason), input.lessonContent);
      if (second.ok) {
        return { result: second.value, provider: options.id, model: options.model, durationMs: Date.now() - started, repaired: true, contextMissing };
      }

      throw new AiAnalysisError(
        "The companion could not produce a grounded answer, twice. Nothing was saved.",
        `invalid-output: ${second.reason}`,
      );
    },
  };
}
