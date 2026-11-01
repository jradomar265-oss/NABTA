import { completeJson } from "./chat";
import { parseAnalysis } from "./schema";
import { AiAnalysisError, type AnalyzerRun, type LessonAnalysisInput, type LessonAnalyzer } from "./types";

/**
 * OpenAI-compatible chat-completions adapter for lesson analysis.
 *
 * Any provider that speaks `/chat/completions` with JSON output works: only
 * `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` change. The key is read from the
 * server environment and never reaches the browser bundle.
 */

const SYSTEM_PROMPT = [
  "You analyse a teacher's lesson text and return learning objectives.",
  "Rules:",
  "- Use only the supplied lesson text. Never add facts the lesson does not contain.",
  "- One objective per testable skill; start each with an observable verb.",
  "- Keep statements under 240 characters.",
  "- `skills` holds 1-6 short skill labels.",
  "- `evidence` is a short quote (max 160 characters) copied from the lesson that supports the objective.",
  "- If something needed for an objective is missing from the lesson, list it in `uncertainties` instead of inventing it.",
  'Return JSON only: {"summary": string, "concepts": string[], "objectives": [{"statement": string, "skills": string[], "evidence": string}], "uncertainties": string[]}',
].join("\n");

function userPrompt(input: LessonAnalysisInput, repairReason?: string): string {
  const parts = [
    `Lesson title: ${input.title}`,
    input.learningObjectiveHint ? `Teacher's current objective note: ${input.learningObjectiveHint}` : "",
    "Lesson text:",
    input.content.slice(0, 12_000),
  ].filter(Boolean);
  if (repairReason) {
    parts.push(
      `Your previous answer could not be used because ${repairReason}. Return corrected JSON only, with no commentary.`,
    );
  }
  return parts.join("\n\n");
}

type Config = { baseUrl: string; apiKey: string; model: string; providerId?: string; label?: string };

export function createHttpAnalyzer(config: Config): LessonAnalyzer {
  if (typeof window !== "undefined") {
    throw new Error("The HTTP analyser must run on the server only.");
  }

  const ask = (input: LessonAnalysisInput, repairReason?: string) =>
    completeJson(config, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(input, repairReason) },
    ]);

  const providerId = config.providerId ?? "openai-compatible";

  return {
    id: providerId,
    label: config.label ?? `Live analyser (${config.model})`,
    isMock: false,

    async analyze(input: LessonAnalysisInput): Promise<AnalyzerRun> {
      const started = Date.now();
      const first = parseAnalysis(await ask(input));
      if (first.ok) {
        return { analysis: first.value, provider: providerId, model: config.model, durationMs: Date.now() - started, repaired: false };
      }

      // One bounded repair attempt, then fail honestly rather than storing junk.
      const second = parseAnalysis(await ask(input, first.reason));
      if (second.ok) {
        return { analysis: second.value, provider: providerId, model: config.model, durationMs: Date.now() - started, repaired: true };
      }

      throw new AiAnalysisError(
        "The AI returned a response that did not match the required structure, twice. Nothing was saved.",
        `invalid-output: ${second.reason}`,
      );
    },
  };
}
