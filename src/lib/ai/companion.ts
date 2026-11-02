import { z } from "zod";

/**
 * The AI Learning Companion contract.
 *
 * It explains, hints and encourages. It does not grade, does not give away answers
 * to graded questions, and does not discuss anything outside the lesson it was given.
 */

export type CompanionInput = {
  lessonTitle: string;
  lessonContent: string;
  objectives: string[];
  question: string;
  /** Questions already asked in this thread, oldest first, to keep answers from repeating. */
  recentTurns?: { question: string; answer: string }[];
};

export type CompanionAnswer = {
  answer: string;
  /** True when the companion declined: off-topic, or not answerable from the lesson. */
  refused: boolean;
  /** Short quotes from the lesson the explanation rests on. Empty when refused. */
  groundedIn: string[];
  /** One concrete next step for the student, or empty. */
  nextStep: string;
};

export type CompanionRun = {
  result: CompanionAnswer;
  provider: string;
  model: string;
  durationMs: number;
  repaired: boolean;
  /** True when the lesson text supplied was too thin to ground an answer. */
  contextMissing: boolean;
};

export interface Companion {
  readonly id: string;
  readonly label: string;
  readonly isMock: boolean;
  answer(input: CompanionInput): Promise<CompanionRun>;
}

const answerSchema = z.object({
  answer: z.string().trim().min(1).max(3000),
  refused: z.boolean(),
  groundedIn: z.array(z.string().trim().min(3).max(200)).max(3).default([]),
  nextStep: z.string().trim().max(300).default(""),
});

export type ParseResult =
  | { ok: true; value: CompanionAnswer }
  | { ok: false; reason: string };

/**
 * Validates a companion answer.
 *
 * Two rules beyond the schema:
 * - a non-refused answer must cite at least one quote from the lesson, so an
 *   explanation cannot be invented from general knowledge;
 * - a refused answer must not cite anything.
 */
export function parseCompanionAnswer(raw: unknown, lessonContent: string): ParseResult {
  let candidate: unknown = raw;

  if (typeof raw === "string") {
    const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      candidate = JSON.parse(text);
    } catch {
      return { ok: false, reason: "the response was not valid JSON" };
    }
  }

  if (!candidate || typeof candidate !== "object") {
    return { ok: false, reason: "the response was not a JSON object" };
  }

  const parsed = answerSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, reason: `${first?.path.join(".") || "response"}: ${first?.message ?? "did not match the schema"}` };
  }

  if (!parsed.data.refused && parsed.data.groundedIn.length === 0) {
    return { ok: false, reason: "an explanation must quote the lesson it is based on" };
  }

  if (parsed.data.refused && parsed.data.groundedIn.length > 0) {
    return { ok: false, reason: "a refusal must not cite lesson quotes" };
  }

  const normalisedLesson = lessonContent.toLowerCase().replace(/\s+/g, " ");
  const invented = parsed.data.groundedIn.find(
    (quote) => !normalisedLesson.includes(quote.toLowerCase().replace(/\s+/g, " ").slice(0, 40)),
  );
  if (invented) {
    return { ok: false, reason: `the quote "${invented.slice(0, 40)}..." does not appear in the lesson` };
  }

  return { ok: true, value: parsed.data };
}

export const COMPANION_SYSTEM_PROMPT = [
  "You are NABTA's learning companion for a Grade 6 student studying one specific lesson.",
  "You explain, hint and encourage. You never grade and you never take over the work.",
  "Hard rules:",
  "- Answer ONLY from the lesson text you are given. If the lesson does not cover it, refuse.",
  "- Never state the answer to an assessment question. If asked, give a hint that helps them work it out.",
  "- If the question is off-topic, personal, or unrelated to this lesson, refuse politely in one sentence.",
  "- Grade 6 reading level: short sentences, no jargon the lesson does not use.",
  "- Be warm but brief: at most 120 words.",
  "- Never ask for personal information.",
  'Return JSON only: {"answer": string, "refused": boolean, "groundedIn": string[], "nextStep": string}',
  "`groundedIn` must contain 1-3 short quotes copied exactly from the lesson, and must be empty when refused.",
].join("\n");

export function companionUserPrompt(input: CompanionInput, repairReason?: string): string {
  const parts = [
    `Lesson title: ${input.lessonTitle}`,
    `Learning objectives:\n${input.objectives.map((objective) => `- ${objective}`).join("\n") || "- (none listed)"}`,
    `Lesson text:\n${input.lessonContent.slice(0, 6000)}`,
  ];

  if (input.recentTurns && input.recentTurns.length > 0) {
    parts.push(
      `Already answered in this conversation (do not repeat these):\n${input.recentTurns
        .slice(-3)
        .map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`)
        .join("\n")}`,
    );
  }

  parts.push(`Student's question: ${input.question}`);
  if (repairReason) {
    parts.push(`Your previous answer could not be used because ${repairReason}. Return corrected JSON only.`);
  }
  return parts.join("\n\n");
}
