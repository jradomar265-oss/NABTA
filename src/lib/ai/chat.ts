import { AiAnalysisError } from "./types";

/**
 * One place that talks to a chat-completions endpoint.
 *
 * Both the lesson analyser and the challenge generator use it, so provider
 * handling, timeouts and error translation cannot drift apart.
 */
export type ChatConfig = { baseUrl: string; apiKey: string; model: string };

const DEFAULT_TIMEOUT_MS = 25_000;

export async function completeJson(
  config: ChatConfig,
  messages: { role: "system" | "user"; content: string }[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  if (typeof window !== "undefined") {
    throw new Error("AI calls must run on the server only.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
        messages,
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

    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
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
