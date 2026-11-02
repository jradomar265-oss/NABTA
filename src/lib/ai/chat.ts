import { AiAnalysisError } from "./types";

/**
 * One place that talks to a chat-completions endpoint.
 *
 * Both the lesson analyser and the challenge generator use it, so provider
 * handling, timeouts and error translation cannot drift apart.
 */
export type ChatConfig = { baseUrl: string; apiKey: string; model: string };

const DEFAULT_TIMEOUT_MS = 25_000;

/** Adapts the OpenAI-shaped endpoint to the generic (system, user) transport. */
export function createChatTransport(config: ChatConfig): (system: string, user: string) => Promise<string> {
  return (system, user) =>
    completeJson(config, [
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
}

/** Turns a provider error body into something a teacher (or the founder) can act on. */
export function describeFailure(status: number, rawBody: string): AiAnalysisError {
  let code = "";
  let message = "";
  try {
    const parsed = JSON.parse(rawBody) as { error?: { code?: string; type?: string; message?: string } };
    code = parsed.error?.code ?? parsed.error?.type ?? "";
    message = parsed.error?.message ?? "";
  } catch {
    message = rawBody.slice(0, 240);
  }

  const detail = `http-${status}${code ? ` ${code}` : ""}${message ? `: ${message.slice(0, 240)}` : ""}`;

  if (status === 401 || status === 403) {
    return new AiAnalysisError("The AI provider rejected the credentials. Check the configured API key.", detail);
  }
  if (status === 402 || status === 429) {
    // Quota/credit exhaustion and rate limiting share status codes but need very
    // different fixes, so read the provider's own wording.
    const looksBilling = /quota|credit|billing|balance|payment/i.test(code) || /quota|credit|billing|balance|payment/i.test(message);
    if (looksBilling) {
      return new AiAnalysisError(
        "The AI account has no remaining credit, so nothing was generated. Add credit to the provider account, or switch provider — the app falls back to clearly-labelled mock mode if you remove the AI variables.",
        detail,
      );
    }
    return new AiAnalysisError("The AI provider is rate limiting requests. Wait a moment and try again.", detail);
  }
  if (status === 404) {
    return new AiAnalysisError("The provider could not find that model or endpoint. Check AI_MODEL and AI_BASE_URL.", detail);
  }
  if (status === 400) {
    return new AiAnalysisError("The provider rejected the request. The detail below usually names the bad parameter.", detail);
  }
  if (status >= 500) {
    return new AiAnalysisError("The AI provider had a server error. Try again in a moment.", detail);
  }
  return new AiAnalysisError("The AI provider could not complete the request.", detail);
}

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
      throw describeFailure(response.status, await response.text().catch(() => ""));
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
