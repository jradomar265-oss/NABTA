import { createHttpAnalyzer } from "./http-analyzer";
import { mockLessonAnalyzer } from "./mock-analyzer";
import type { AiSetup, LessonAnalyzer } from "./types";

export { AiAnalysisError } from "./types";
export type { AiSetup, AnalyzerRun, LessonAnalysis, LessonAnalysisInput, LessonAnalyzer } from "./types";
export { parseAnalysis } from "./schema";

type Resolved = { analyzer: LessonAnalyzer; setup: AiSetup };

/**
 * Chooses the analyser from server-only environment variables.
 *
 * Defaults to the mock analyser. A live provider is used only when it is fully
 * configured; a half-configured provider falls back to mock *and says so*, rather
 * than silently pretending to be live.
 */
export function resolveLessonAnalyzer(env: Record<string, string | undefined> = process.env): Resolved {
  const requested = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  const baseUrl = (env.AI_BASE_URL ?? "").trim();
  const apiKey = (env.AI_API_KEY ?? "").trim();
  const model = (env.AI_MODEL ?? "").trim();

  if (requested === "openai-compatible" || requested === "openai") {
    const missing = [
      !baseUrl ? "AI_BASE_URL" : "",
      !apiKey ? "AI_API_KEY" : "",
      !model ? "AI_MODEL" : "",
    ].filter(Boolean);

    if (missing.length === 0) {
      const analyzer = createHttpAnalyzer({ baseUrl, apiKey, model });
      return {
        analyzer,
        setup: {
          isMock: false,
          provider: analyzer.id,
          label: analyzer.label,
          note: "Live AI analysis. Output is still validated against the required structure before it is saved.",
        },
      };
    }

    return {
      analyzer: mockLessonAnalyzer,
      setup: {
        isMock: true,
        provider: mockLessonAnalyzer.id,
        label: mockLessonAnalyzer.label,
        note: `A live provider was requested but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing, so analysis runs in mock mode.`,
      },
    };
  }

  return {
    analyzer: mockLessonAnalyzer,
    setup: {
      isMock: true,
      provider: mockLessonAnalyzer.id,
      label: mockLessonAnalyzer.label,
      note: "Mock analysis: no AI provider is configured. Objectives come from fixed rules over the lesson text, not from a model.",
    },
  };
}

export function getLessonAnalyzer(): Resolved {
  return resolveLessonAnalyzer();
}
