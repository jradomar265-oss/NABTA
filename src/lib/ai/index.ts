import { createHttpChallengeGenerator } from "./challenge-http";
import { mockChallengeGenerator } from "./challenge-mock";
import type { ChallengeGenerator } from "./challenge";
import { createHttpAnalyzer } from "./http-analyzer";
import { mockLessonAnalyzer } from "./mock-analyzer";
import type { AiSetup, LessonAnalyzer } from "./types";

export { AiAnalysisError } from "./types";
export type { AiSetup, AnalyzerRun, LessonAnalysis, LessonAnalysisInput, LessonAnalyzer } from "./types";
export { parseAnalysis } from "./schema";
export { parseChallenge } from "./challenge";
export type { ChallengeGenerator, ChallengeInput, ChallengeObjective, ChallengeRun, GeneratedQuestion } from "./challenge";

type Resolved = { analyzer: LessonAnalyzer; setup: AiSetup };
type ResolvedChallenge = { generator: ChallengeGenerator; setup: AiSetup };

type AiConfig =
  | { live: true; baseUrl: string; apiKey: string; model: string }
  | { live: false; missing: string[] };

/**
 * Reads the provider configuration once, so analysis and generation can never
 * disagree about whether AI is live or mocked.
 */
function readConfig(env: Record<string, string | undefined>): AiConfig {
  const requested = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  const baseUrl = (env.AI_BASE_URL ?? "").trim();
  const apiKey = (env.AI_API_KEY ?? "").trim();
  const model = (env.AI_MODEL ?? "").trim();

  if (requested !== "openai-compatible" && requested !== "openai") {
    return { live: false, missing: [] };
  }

  const missing = [
    !baseUrl ? "AI_BASE_URL" : "",
    !apiKey ? "AI_API_KEY" : "",
    !model ? "AI_MODEL" : "",
  ].filter(Boolean);

  if (missing.length > 0) return { live: false, missing };
  return { live: true, baseUrl, apiKey, model };
}

function mockNote(missing: string[]): string {
  if (missing.length > 0) {
    return `A live provider was requested but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing, so this runs in mock mode.`;
  }
  return "Mock mode: no AI provider is configured. Output comes from fixed rules over the lesson text, not from a model.";
}

/** Chooses the lesson analyser. Defaults to mock; a half-configured live provider says so. */
export function resolveLessonAnalyzer(env: Record<string, string | undefined> = process.env): Resolved {
  const config = readConfig(env);

  if (config.live) {
    const analyzer = createHttpAnalyzer({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model });
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
      note: `Mock analysis: ${mockNote(config.missing)}`,
    },
  };
}

/** Chooses the challenge generator, using the same configuration as the analyser. */
export function resolveChallengeGenerator(env: Record<string, string | undefined> = process.env): ResolvedChallenge {
  const config = readConfig(env);

  if (config.live) {
    const generator = createHttpChallengeGenerator({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model });
    return {
      generator,
      setup: {
        isMock: false,
        provider: generator.id,
        label: generator.label,
        note: "Live AI generation. Every question is validated, and its answer key stays on the server.",
      },
    };
  }

  return {
    generator: mockChallengeGenerator,
    setup: {
      isMock: true,
      provider: mockChallengeGenerator.id,
      label: mockChallengeGenerator.label,
      note: `Mock generation: ${mockNote(config.missing)} Only fraction lessons are supported.`,
    },
  };
}

export function getLessonAnalyzer(): Resolved {
  return resolveLessonAnalyzer();
}

export function getChallengeGenerator(): ResolvedChallenge {
  return resolveChallengeGenerator();
}
