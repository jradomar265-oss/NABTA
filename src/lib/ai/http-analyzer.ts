import { parseAnalysis } from "./schema";
import { AiAnalysisError, type AnalyzerRun, type LessonAnalysisInput, type LessonAnalyzer } from "./types";

/**
 * OpenAI-compatible chat-completions adapter.
 *
 * Any provider that speaks `/chat/completions` with JSON output works: only
 * `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` change. The key is read from the
 * server environment and never reaches the browser bundle.
 */

const TIMEOUT_MS = 25_000;

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

type Config = { baseUrl: string; apiKey: string; model: string };

async function callModel(config: Config, input: LessonAnalysisInput, repairReason?: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(input, repairReason) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AiAnalysisError(
        response.status === 401 || response.status === 403
          ? "The AI provider rejected the credentials. Check the configured API key."
          : "The AI provider could not complete the request. Try again in a moment.",
        `http-${response.status}`,
      );
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiAnalysisError("The AI provider returned an empty response.", "empty-completion");
    }
    return content;
  } catch (error) {
    if (error instanceof AiAnalysisError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiAnalysisError("The AI provider took too long to respond. Try again.", "timeout");
    }
    throw new AiAnalysisError("The AI provider could not be reached. Check the network and try again.", "network");
  } finally {
    clearTimeout(timer);
  }
}

export function createHttpAnalyzer(config: Config): LessonAnalyzer {
  if (typeof window !== "undefined") {
    throw new Error("The HTTP analyser must run on the server only.");
  }

  return {
    id: "openai-compatible",
    label: `Live analyser (${config.model})`,
    isMock: false,

    async analyze(input: LessonAnalysisInput): Promise<AnalyzerRun> {
      const started = Date.now();
      const first = parseAnalysis(await callModel(config, input));
      if (first.ok) {
        return { analysis: first.value, provider: "openai-compatible", model: config.model, durationMs: Date.now() - started, repaired: false };
      }

      // One bounded repair attempt, then fail honestly rather than storing junk.
      const second = parseAnalysis(await callModel(config, input, first.reason));
      if (second.ok) {
        return { analysis: second.value, provider: "openai-compatible", model: config.model, durationMs: Date.now() - started, repaired: true };
      }

      throw new AiAnalysisError(
        "The AI returned a response that did not match the required structure, twice. Nothing was saved.",
        `invalid-output: ${second.reason}`,
      );
    },
  };
}
