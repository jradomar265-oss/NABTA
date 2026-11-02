import {
  parseChallenge,
  type ChallengeGenerator,
  type ChallengeInput,
  type ChallengeRun,
} from "./challenge";
import { parseAnalysis } from "./schema";
import { ANALYSIS_SYSTEM_PROMPT, CHALLENGE_SYSTEM_PROMPT, analysisUserPrompt, challengeUserPrompt } from "./prompts";
import { AiAnalysisError, type AnalyzerRun, type LessonAnalysisInput, type LessonAnalyzer } from "./types";

/**
 * Native Google Gemini adapter.
 *
 * Talks to the Gemini API directly with `x-goog-api-key` — no OpenAI SDK, no
 * OpenAI compatibility layer, no OpenAI account. Google is mid-migration between
 * two REST surfaces for the same task, so this tries the current Interactions
 * endpoint first and falls back to the long-standing `generateContent` call once
 * the API tells us it is unavailable. Whichever answers is remembered for the
 * life of the process.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/text-generation
 *       https://ai.google.dev/api/generate-content
 */

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
export const GEMINI_DEFAULT_MODEL_HINT = "set AI_MODEL to a Gemini model your key can use";

export type GeminiConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  providerId?: string;
  label?: string;
};

type Surface = "interactions" | "generateContent" | null;

const TIMEOUT_MS = 45_000;

/** Remembers which Gemini surface answered, so only the first call pays for discovery. */
let surface: Surface = null;

function endpoint(config: GeminiConfig, requested: "interactions" | "generateContent"): string {
  const base = (config.baseUrl ?? GEMINI_API_BASE).replace(/\/$/, "");
  return requested === "interactions"
    ? `${base}/v1beta/interactions`
    : `${base}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;
}

function body(config: GeminiConfig, system: string, user: string, requested: "interactions" | "generateContent"): string {
  if (requested === "interactions") {
    // The Interactions endpoint takes a single input payload, so the system rules
    // travel in-band as a preamble.
    return JSON.stringify({
      model: config.model,
      input: `${system}\n\n---\n\n${user}`,
      response_format: { type: "text", mime_type: "application/json" },
    });
  }
  return JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
}

/** Pulls the model's text out of either response shape, ignoring reasoning parts. */
function extractText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;

  if (typeof record.output_text === "string" && record.output_text.trim()) return record.output_text;

  const candidates = record.candidates;
  if (Array.isArray(candidates)) {
    const parts = (candidates[0] as { content?: { parts?: { text?: string; thought?: boolean }[] } } | undefined)?.content?.parts;
    if (Array.isArray(parts)) {
      const text = parts
        .filter((part) => !part.thought && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("")
        .trim();
      if (text) return text;
    }
  }

  // Fall back to the longest JSON-looking string anywhere in the payload. This
  // keeps the adapter working if the response envelope changes again.
  let best: string | null = null;
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      if (node.includes("{") && (best === null || node.length > best.length)) best = node;
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(walk);
    }
  };
  walk(value);
  return best;
}

async function callGemini(config: GeminiConfig, system: string, user: string): Promise<string> {
  if (typeof window !== "undefined") {
    throw new Error("Gemini calls must run on the server only.");
  }

  const order: ("interactions" | "generateContent")[] = surface === "generateContent"
    ? ["generateContent"]
    : surface === "interactions"
      ? ["interactions"]
      : ["interactions", "generateContent"];

  let lastError: AiAnalysisError | null = null;

  for (const requested of order) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(endpoint(config, requested), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
        body: body(config, system, user, requested),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        const error = describeStatus(response.status, requested, detail);

        // Only fall through to the other surface when this one is simply not there.
        const missingSurface = requested === "interactions" && (response.status === 404 || response.status === 400);
        if (missingSurface) {
          lastError = error;
          continue;
        }
        throw error;
      }

      const payload = (await response.json()) as unknown;
      const text = extractText(payload);
      if (!text) throw new AiAnalysisError("Gemini returned an empty response.", "empty-response");

      surface = requested;
      return text;
    } catch (error) {
      if (error instanceof AiAnalysisError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiAnalysisError("Gemini took too long to respond. Try again.", "timeout");
      }
      lastError = new AiAnalysisError("Gemini could not be reached. Check the network and try again.", "network");
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new AiAnalysisError("Gemini could not be reached.", "unknown");
}

function describeStatus(status: number, requested: string, detail: string): AiAnalysisError {
  if (status === 401 || status === 403) {
    return new AiAnalysisError("Gemini rejected the API key. Check GEMINI_API_KEY / AI_API_KEY.", `http-${status}: ${detail}`);
  }
  if (status === 404) {
    return new AiAnalysisError(`Gemini could not find that model or endpoint. ${GEMINI_DEFAULT_MODEL_HINT}.`, `http-404 (${requested}): ${detail}`);
  }
  if (status === 429) {
    return new AiAnalysisError("Gemini rate limit reached. Wait a moment and try again.", "http-429");
  }
  if (status >= 500) {
    return new AiAnalysisError("Gemini had a server error. Try again in a moment.", `http-${status}`);
  }
  return new AiAnalysisError("Gemini rejected the request.", `http-${status} (${requested}): ${detail}`);
}

/** Adapts native Gemini to the generic (system, user) transport. */
export function createGeminiTransport(config: GeminiConfig): (system: string, user: string) => Promise<string> {
  return (system, user) => callGemini(config, system, user);
}

export function createGeminiAnalyzer(config: GeminiConfig): LessonAnalyzer {
  const providerId = config.providerId ?? "gemini";
  const label = config.label ?? `Gemini (${config.model})`;

  return {
    id: providerId,
    label,
    isMock: false,

    async analyze(input: LessonAnalysisInput): Promise<AnalyzerRun> {
      const started = Date.now();
      const ask = (repairReason?: string) =>
        callGemini(config, ANALYSIS_SYSTEM_PROMPT, analysisUserPrompt(input, repairReason));

      const first = parseAnalysis(await ask());
      if (first.ok) {
        return { analysis: first.value, provider: providerId, model: config.model, durationMs: Date.now() - started, repaired: false };
      }

      const second = parseAnalysis(await ask(first.reason));
      if (second.ok) {
        return { analysis: second.value, provider: providerId, model: config.model, durationMs: Date.now() - started, repaired: true };
      }

      throw new AiAnalysisError(
        "Gemini returned a response that did not match the required structure, twice. Nothing was saved.",
        `invalid-output: ${second.reason}`,
      );
    },
  };
}

export function createGeminiChallengeGenerator(config: GeminiConfig): ChallengeGenerator {
  const providerId = config.providerId ?? "gemini";
  const label = config.label ?? `Gemini (${config.model})`;

  return {
    id: providerId,
    label,
    isMock: false,

    async generate(input: ChallengeInput): Promise<ChallengeRun> {
      const started = Date.now();
      const allowed = input.objectives.map((objective) => objective.id);
      const ask = (repairReason?: string) =>
        callGemini(config, CHALLENGE_SYSTEM_PROMPT, challengeUserPrompt(input, repairReason));

      const first = parseChallenge(await ask(), allowed);
      if (first.ok) {
        return { challenge: first.value, provider: providerId, model: config.model, durationMs: Date.now() - started, repaired: false };
      }

      const second = parseChallenge(await ask(first.reason), allowed);
      if (second.ok) {
        return { challenge: second.value, provider: providerId, model: config.model, durationMs: Date.now() - started, repaired: true };
      }

      throw new AiAnalysisError(
        "Gemini returned questions that did not match the required structure, twice. Nothing was saved.",
        `invalid-output: ${second.reason}`,
      );
    },
  };
}

/** Which Gemini surface answered most recently; used by the smoke test. */
export function geminiSurfaceInUse(): Surface {
  return surface;
}
