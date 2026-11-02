import { z } from "zod";

/** A question as it will be stored. Note: no correctness flag — that is answer_keys only. */
export type Difficulty = "easy" | "medium" | "hard";

export type ChallengeRequirements = {
  /** Ask for exactly this many questions when possible. */
  questionCount?: number;
  /** Preferred spread of difficulty labels, e.g. { easy: 1, medium: 2 }. */
  difficultyMix?: Partial<Record<Difficulty, number>>;
  /** Prompts that must not be reused, so a follow-up is a fresh check. */
  avoidPrompts?: string[];
};

export type GeneratedQuestion = {
  prompt: string;
  kind: "multiple_choice" | "true_false";
  options: string[];
  correctIndex: number;
  explanation: string;
  objectiveId: string;
  difficulty: Difficulty;
};

export type GeneratedChallenge = { questions: GeneratedQuestion[] };

export type ChallengeObjective = { id: string; statement: string; skills: string[] };

export type ChallengeInput = {
  title: string;
  content: string;
  objectives: ChallengeObjective[];
  requirements?: ChallengeRequirements;
};

export type ChallengeRun = {
  challenge: GeneratedChallenge;
  provider: string;
  model: string;
  durationMs: number;
  repaired: boolean;
};

export interface ChallengeGenerator {
  readonly id: string;
  readonly label: string;
  readonly isMock: boolean;
  generate(input: ChallengeInput): Promise<ChallengeRun>;
}

const questionSchema = z
  .object({
    prompt: z.string().trim().min(10).max(600),
    kind: z.enum(["multiple_choice", "true_false"]),
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(6),
    correctIndex: z.number().int().min(0).max(5),
    explanation: z.string().trim().min(10).max(600),
    objectiveId: z.string().uuid(),
    difficulty: z.enum(["easy", "medium", "hard"]),
  })
  .superRefine((question, ctx) => {
    if (question.correctIndex >= question.options.length) {
      ctx.addIssue({ code: "custom", message: "correctIndex points past the last option" });
    }
    const normalised = question.options.map((option) => option.trim().toLowerCase());
    if (new Set(normalised).size !== normalised.length) {
      ctx.addIssue({ code: "custom", message: "options must be distinct" });
    }
    if (question.kind === "true_false" && question.options.length !== 2) {
      ctx.addIssue({ code: "custom", message: "a true/false question needs exactly two options" });
    }
  });

const challengeSchema = z.object({
  questions: z.array(questionSchema).min(1, "no questions were produced").max(8),
});

export type ParsedChallenge = z.infer<typeof challengeSchema>;

export type ChallengeParseResult =
  | { ok: true; value: GeneratedChallenge }
  | { ok: false; reason: string };

/**
 * Validates a generated challenge, including grounding: every question must point
 * at an objective the teacher actually approved for this lesson.
 */
export function parseChallenge(raw: unknown, allowedObjectiveIds: string[]): ChallengeParseResult {
  let candidate: unknown = raw;

  if (typeof raw === "string") {
    const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      candidate = JSON.parse(text);
    } catch {
      return { ok: false, reason: "the response was not valid JSON" };
    }
  }

  if (candidate === null || typeof candidate !== "object") {
    return { ok: false, reason: "the response was not a JSON object" };
  }

  const record = candidate as Record<string, unknown>;
  const shape = Array.isArray(record.questions) ? record : record.challenge;

  const parsed = challengeSchema.safeParse(shape);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "response";
    return { ok: false, reason: `${where}: ${first?.message ?? "did not match the required schema"}` };
  }

  const allowed = new Set(allowedObjectiveIds);
  const ungrounded = parsed.data.questions.find((question) => !allowed.has(question.objectiveId));
  if (ungrounded) {
    return { ok: false, reason: `a question referenced an objective that is not approved for this lesson` };
  }

  return { ok: true, value: { questions: parsed.data.questions } };
}
