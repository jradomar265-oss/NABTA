import { parseChallenge, type ChallengeGenerator, type ChallengeInput, type ChallengeRun, type GeneratedQuestion } from "./challenge";
import { AiAnalysisError } from "./types";

/**
 * Deterministic stand-in for a real challenge generator.
 *
 * Every template has a mathematically correct answer that was checked by hand, so
 * mock mode never produces a wrong answer key. It refuses to run on content it
 * does not understand instead of inventing questions, and it always attaches each
 * question to one of the teacher's approved objectives.
 */

type Template = {
  keywords: RegExp;
  objectiveKeywords: RegExp;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  kind: "multiple_choice" | "true_false";
};

const TEMPLATES: Template[] = [
  {
    keywords: /equivalent|same amount|equal fraction/i,
    objectiveKeywords: /equivalent/i,
    prompt: "Which fraction is equivalent to 1/2?",
    options: ["2/4", "1/3", "3/5", "2/5"],
    correctIndex: 0,
    explanation: "Multiply the numerator and denominator of 1/2 by 2 to get 2/4. Both name the same amount.",
    kind: "multiple_choice",
  },
  {
    keywords: /simplif|lowest term|common factor/i,
    objectiveKeywords: /simplif|common factor/i,
    prompt: "Simplify 6/8 to its lowest terms.",
    options: ["3/4", "2/3", "6/8", "1/2"],
    correctIndex: 0,
    explanation: "6 and 8 share the factor 2. Dividing both by 2 gives 3/4, and 3 and 4 share no further factor.",
    kind: "multiple_choice",
  },
  {
    keywords: /compare|order|greater|larger|less than/i,
    objectiveKeywords: /compare|order/i,
    prompt: "Which is greater: 3/4 or 5/8?",
    options: ["3/4", "5/8", "They are equal", "It cannot be decided"],
    correctIndex: 0,
    explanation: "Rewrite 3/4 as 6/8. Since 6/8 is greater than 5/8, 3/4 is greater.",
    kind: "multiple_choice",
  },
  {
    keywords: /numerator|denominator/i,
    objectiveKeywords: /numerator|denominator|notation/i,
    prompt: "In the fraction 5/8, what does the 8 tell you?",
    options: ["How many equal parts make up the whole", "How many parts we have", "The size of the whole", "How many wholes there are"],
    correctIndex: 0,
    explanation: "The denominator counts the equal parts the whole is divided into; the numerator (5) counts the parts taken.",
    kind: "multiple_choice",
  },
  {
    keywords: /mixed number|improper/i,
    objectiveKeywords: /mixed|improper/i,
    prompt: "Write 7/4 as a mixed number.",
    options: ["1 3/4", "1 1/2", "2 1/4", "1 3/5"],
    correctIndex: 0,
    explanation: "7/4 is one whole (4/4) plus 3/4, so it is 1 3/4.",
    kind: "multiple_choice",
  },
  {
    keywords: /numerator|denominator|fraction/i,
    objectiveKeywords: /fraction|notation/i,
    prompt: "In the fraction 3/5, the numerator is 3.",
    options: ["True", "False"],
    correctIndex: 0,
    explanation: "The top number of a fraction is the numerator, so in 3/5 the numerator is indeed 3.",
    kind: "true_false",
  },
  {
    keywords: /compare|order|greater/i,
    objectiveKeywords: /compare|order/i,
    prompt: "1/2 is greater than 3/4.",
    options: ["True", "False"],
    correctIndex: 1,
    explanation: "3/4 equals 0.75 and 1/2 equals 0.5, so 1/2 is smaller than 3/4.",
    kind: "true_false",
  },
  {
    keywords: /decimal|percentage|percent/i,
    objectiveKeywords: /decimal|percent/i,
    prompt: "Which decimal is equal to 3/4?",
    options: ["0.75", "0.34", "0.43", "0.7"],
    correctIndex: 0,
    explanation: "3 divided by 4 is 0.75, so 3/4 = 0.75 = 75%.",
    kind: "multiple_choice",
  },
];

function pickObjective(input: ChallengeInput, template: Template): string {
  const scored = input.objectives.map((objective) => {
    const haystack = `${objective.statement} ${objective.skills.join(" ")}`;
    const score = template.objectiveKeywords.test(haystack) ? 2 : 0;
    return { id: objective.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id ?? input.objectives[0].id;
}

export const mockChallengeGenerator: ChallengeGenerator = {
  id: "mock",
  label: "Mock generator (deterministic, no model call)",
  isMock: true,

  async generate(input: ChallengeInput): Promise<ChallengeRun> {
    const started = Date.now();
    const content = input.content.trim();

    if (input.objectives.length === 0) {
      throw new AiAnalysisError(
        "Approve at least one learning objective first — every challenge question has to be tied to an objective.",
        "mock:no-objectives",
      );
    }

    if (content.length < 120) {
      throw new AiAnalysisError(
        "The lesson text is too short to build challenges from. Add at least a short paragraph.",
        "mock:content-too-short",
      );
    }

    const readable = `${content} ${input.title}`;
    const matched = TEMPLATES.filter((template) => template.keywords.test(readable));

    if (matched.length < 2) {
      throw new AiAnalysisError(
        "The mock generator only understands fraction lessons. Configure a live AI provider to generate challenges for other topics.",
        "mock:unsupported-topic",
      );
    }

    const chosen = matched.slice(0, 5);
    const questions: GeneratedQuestion[] = chosen.map((template) => ({
      prompt: template.prompt,
      kind: template.kind,
      options: template.options,
      correctIndex: template.correctIndex,
      explanation: template.explanation,
      objectiveId: pickObjective(input, template),
    }));

    // Same validator a live model must pass, including the objective grounding check.
    const parsed = parseChallenge({ questions }, input.objectives.map((objective) => objective.id));
    if (!parsed.ok) {
      throw new AiAnalysisError("The generated challenge failed validation.", `mock:invalid-output: ${parsed.reason}`);
    }

    return {
      challenge: parsed.value,
      provider: "mock",
      model: "deterministic-templates",
      durationMs: Date.now() - started,
      repaired: false,
    };
  },
};
