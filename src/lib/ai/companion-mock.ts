import {
  parseCompanionAnswer,
  type Companion,
  type CompanionAnswer,
  type CompanionInput,
  type CompanionRun,
} from "./companion";
import { AiAnalysisError } from "./types";

/**
 * Deterministic stand-in for the learning companion.
 *
 * It answers by finding the lesson sentence that shares the most words with the
 * question, then restating it plainly and offering a hint. When nothing overlaps it
 * refuses, which is the same behaviour a live model must show. It never touches an
 * answer key because it is never given one.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "of", "to", "in", "on", "for", "and", "or",
  "how", "what", "why", "when", "does", "do", "did", "can", "could", "i", "my", "me", "you",
  "it", "this", "that", "these", "those", "with", "at", "be", "have", "has", "not", "but",
  "if", "so", "then", "there", "they", "them", "we", "our", "please", "help", "explain",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9/\s.]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export const mockCompanion: Companion = {
  id: "mock",
  label: "Mock companion (deterministic, no model call)",
  isMock: true,

  async answer(input: CompanionInput): Promise<CompanionRun> {
    const started = Date.now();
    const lesson = input.lessonContent.trim();

    // Too little lesson text means there is nothing to ground an answer in. Say so
    // rather than producing a plausible-sounding guess.
    if (lesson.length < 80) {
      const result: CompanionAnswer = {
        answer: "I cannot explain this one yet because your lesson text is too short for me to work from. Ask your teacher to add more detail.",
        refused: true,
        groundedIn: [],
        nextStep: "",
      };
      const parsed = parseCompanionAnswer(result, lesson || "x");
      if (!parsed.ok) throw new AiAnalysisError("The companion produced invalid output.", `mock:invalid: ${parsed.reason}`);
      return { result: parsed.value, provider: "mock", model: "deterministic-rules", durationMs: Date.now() - started, repaired: false, contextMissing: true };
    }

    const questionWords = new Set(words(input.question));
    const candidates = sentences(lesson)
      .map((sentence) => {
        const overlap = words(sentence).filter((word) => questionWords.has(word));
        return { sentence, score: overlap.length };
      })
      .sort((left, right) => right.score - left.score);

    const best = candidates[0];

    if (!best || best.score === 0) {
      const refusal: CompanionAnswer = {
        answer: "That is not covered in this lesson, so I would only be guessing. Try asking about the ideas in the lesson text, or ask your teacher.",
        refused: true,
        groundedIn: [],
        nextStep: "",
      };
      const parsed = parseCompanionAnswer(refusal, lesson);
      if (!parsed.ok) throw new AiAnalysisError("The companion produced invalid output.", `mock:invalid: ${parsed.reason}`);
      return { result: parsed.value, provider: "mock", model: "deterministic-rules", durationMs: Date.now() - started, repaired: false, contextMissing: false };
    }

    // Restate the best-matching lesson sentence, then hand the thinking back.
    const source = best.sentence.replace(/\s+/g, " ").trim();
    const quote = source.length > 160 ? `${source.slice(0, 157)}...` : source;

    const objective = input.objectives[0] ? ` The lesson goal is: ${input.objectives[0]}` : "";
    const answer: CompanionAnswer = {
      answer: `Your lesson says: "${quote}"${objective} Read that sentence again and find the part that answers your question.`,
      refused: false,
      groundedIn: [quote],
      nextStep: "Try one example yourself, then check it against the sentence above.",
    };

    const parsed = parseCompanionAnswer(answer, lesson);
    if (!parsed.ok) {
      throw new AiAnalysisError("The companion produced invalid output.", `mock:invalid: ${parsed.reason}`);
    }

    return { result: parsed.value, provider: "mock", model: "deterministic-rules", durationMs: Date.now() - started, repaired: false, contextMissing: false };
  },
};
