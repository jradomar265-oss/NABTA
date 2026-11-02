import { createHttpChallengeGenerator } from "./challenge-http";
import { mockChallengeGenerator } from "./challenge-mock";
import type { ChallengeGenerator } from "./challenge";
import { createGeminiAnalyzer, createGeminiChallengeGenerator, createGeminiTransport, GEMINI_API_BASE } from "./gemini";
import { createChatTransport } from "./chat";
import { createHttpAnalyzer } from "./http-analyzer";
import { mockLessonAnalyzer } from "./mock-analyzer";
import { mockLearningAnalyst } from "./analysis-mock";
import { createLiveLearningAnalyst } from "./analysis-live";
import type { LearningAnalyst } from "./analysis";
import type { AiSetup, LessonAnalyzer } from "./types";

export { AiAnalysisError } from "./types";
export type { AiSetup, AnalyzerRun, LessonAnalysis, LessonAnalysisInput, LessonAnalyzer } from "./types";
export { parseAnalysis } from "./schema";
export { parseChallenge } from "./challenge";
export { parseObservations } from "./analysis";
export type { LearningAnalyst, LearningObservations, Observation } from "./analysis";
export type { ChallengeGenerator, ChallengeInput, ChallengeObjective, ChallengeRun, GeneratedQuestion } from "./challenge";
export { geminiSurfaceInUse, GEMINI_API_BASE } from "./gemini";

type Resolved = { analyzer: LessonAnalyzer; setup: AiSetup };
type ResolvedChallenge = { generator: ChallengeGenerator; setup: AiSetup };
type ResolvedAnalyst = { analyst: LearningAnalyst; setup: AiSetup };

type AiConfig =
  | {
    live: true;
    kind: "gemini" | "openai-compatible";
    baseUrl: string;
    apiKey: string;
    model: string;
    providerId: string;
    providerLabel: string;
  }
  | { live: false; missing: string[] };

/**
 * Reads the provider configuration once, so analysis and generation can never
 * disagree about whether AI is live or mocked.
 *
 * `AI_PROVIDER=gemini` calls the Gemini API directly (native `x-goog-api-key`
 * authentication) and only needs AI_API_KEY or GEMINI_API_KEY plus AI_MODEL.
 */
function readConfig(env: Record<string, string | undefined>): AiConfig {
  const requested = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  const model = (env.AI_MODEL ?? "").trim();
  const apiKeyOverride = (env.AI_API_KEY ?? "").trim();
  const baseUrlOverride = (env.AI_BASE_URL ?? "").trim();

  if (requested === "gemini" || requested === "google") {
    const apiKey = apiKeyOverride || (env.GEMINI_API_KEY ?? "").trim();
    const missing = [!apiKey ? "GEMINI_API_KEY (or AI_API_KEY)" : "", !model ? "AI_MODEL" : ""].filter(Boolean);
    if (missing.length > 0) return { live: false, missing };
    return {
      live: true,
      kind: "gemini",
      baseUrl: baseUrlOverride || GEMINI_API_BASE,
      apiKey,
      model,
      providerId: "gemini",
      providerLabel: `Gemini (${model})`,
    };
  }

  if (requested !== "openai-compatible" && requested !== "openai") {
    return { live: false, missing: [] };
  }

  const missing = [
    !baseUrlOverride ? "AI_BASE_URL" : "",
    !apiKeyOverride ? "AI_API_KEY" : "",
    !model ? "AI_MODEL" : "",
  ].filter(Boolean);

  if (missing.length > 0) return { live: false, missing };
  return {
    live: true,
    kind: "openai-compatible",
    baseUrl: baseUrlOverride,
    apiKey: apiKeyOverride,
    model,
    providerId: "openai-compatible",
    providerLabel: `OpenAI-compatible endpoint (${model})`,
  };
}

/**
 * Body text for a mock setup note.
 *
 * The UI already renders its own "Mock mode" / "Live AI" badge, so these strings
 * must not repeat that label — they only explain *why* it is mocked.
 */
function mockNote(missing: string[], extra?: string): string {
  const base = missing.length > 0
    ? `A live provider was requested but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing, so this runs in mock mode.`
    : "No AI provider is configured, so results come from fixed rules over the lesson text rather than from a model.";
  return extra ? `${base} ${extra}` : base;
}

/** Chooses the lesson analyser. Defaults to mock; a half-configured live provider says so. */
export function resolveLessonAnalyzer(env: Record<string, string | undefined> = process.env): Resolved {
  const config = readConfig(env);

  if (config.live) {
    const analyzer = config.kind === "gemini"
      ? createGeminiAnalyzer({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, providerId: config.providerId, label: `Live analyser — ${config.providerLabel}` })
      : createHttpAnalyzer({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, providerId: config.providerId, label: `Live analyser — ${config.providerLabel}` });
    return {
      analyzer,
      setup: {
        isMock: false,
        provider: analyzer.id,
        label: analyzer.label,
        note: `${config.providerLabel} is configured. Output is still validated against the required structure before it is saved.`,
      },
    };
  }

  return {
    analyzer: mockLessonAnalyzer,
    setup: {
      isMock: true,
      provider: mockLessonAnalyzer.id,
      label: mockLessonAnalyzer.label,
      note: mockNote(config.missing),
    },
  };
}

/** Chooses the challenge generator, using the same configuration as the analyser. */
export function resolveChallengeGenerator(env: Record<string, string | undefined> = process.env): ResolvedChallenge {
  const config = readConfig(env);

  if (config.live) {
    const generator = config.kind === "gemini"
      ? createGeminiChallengeGenerator({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, providerId: config.providerId, label: `Live generator — ${config.providerLabel}` })
      : createHttpChallengeGenerator({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, providerId: config.providerId, label: `Live generator — ${config.providerLabel}` });
    return {
      generator,
      setup: {
        isMock: false,
        provider: generator.id,
        label: generator.label,
        note: `${config.providerLabel} is configured. Every question is validated, and its answer key stays on the server.`,
      },
    };
  }

  return {
    generator: mockChallengeGenerator,
    setup: {
      isMock: true,
      provider: mockChallengeGenerator.id,
      label: mockChallengeGenerator.label,
      note: mockNote(config.missing, "Only fraction lessons are supported."),
    },
  };
}

export function getLessonAnalyzer(): Resolved {
  return resolveLessonAnalyzer();
}

/** Chooses the learning analyst. Facts are always computed locally; only interpretation varies. */
export function resolveLearningAnalyst(env: Record<string, string | undefined> = process.env): ResolvedAnalyst {
  const config = readConfig(env);

  if (config.live) {
    const chat = config.kind === "gemini"
      ? createGeminiTransport({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model })
      : createChatTransport({ baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model });
    const analyst = createLiveLearningAnalyst({
      id: config.providerId,
      label: `Live analyst — ${config.providerLabel}`,
      model: config.model,
      chat,
    });
    return {
      analyst,
      setup: {
        isMock: false,
        provider: analyst.id,
        label: analyst.label,
        note: `${config.providerLabel} is configured. It only sees the computed fact sheet, and its output is validated before it is saved.`,
      },
    };
  }

  return {
    analyst: mockLearningAnalyst,
    setup: {
      isMock: true,
      provider: mockLearningAnalyst.id,
      label: mockLearningAnalyst.label,
      note: mockNote(config.missing),
    },
  };
}

export function getChallengeGenerator(): ResolvedChallenge {
  return resolveChallengeGenerator();
}
