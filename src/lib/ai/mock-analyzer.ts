import { analysisSchema } from "./schema";
import { AiAnalysisError, type AnalyzerRun, type LessonAnalysisInput, type LessonAnalyzer } from "./types";

/**
 * Deterministic stand-in for a real model.
 *
 * It exists so the full teacher workflow (analyse -> review -> edit -> approve ->
 * shown to students) can be built and tested with no API spend. Its output is
 * derived from the lesson text with fixed rules, so the same lesson always yields
 * the same objectives, and it is labelled as mock in every surface that shows it.
 */

type Rule = {
  match: RegExp;
  concept: string;
  objective: string;
  skills: string[];
};

const RULES: Rule[] = [
  {
    match: /fraction/i,
    concept: "A fraction describes equal parts of a whole",
    objective: "Explain that a fraction describes equal parts of a whole and name the whole being divided.",
    skills: ["fraction meaning", "equal parts", "vocabulary"],
  },
  {
    match: /numerator|denominator/i,
    concept: "Numerator and denominator carry different meanings",
    objective: "Identify the numerator and the denominator and state what each one counts.",
    skills: ["fraction notation", "vocabulary"],
  },
  {
    match: /equivalent/i,
    concept: "Equivalent fractions name the same amount",
    objective: "Recognise and produce equivalent fractions for a given fraction.",
    skills: ["equivalent fractions", "reasoning"],
  },
  {
    match: /simplif|lowest term|reduce/i,
    concept: "Fractions can be simplified by common factors",
    objective: "Simplify a fraction by dividing the numerator and denominator by a common factor.",
    skills: ["common factors", "procedure"],
  },
  {
    match: /mixed number|improper/i,
    concept: "Mixed numbers and improper fractions are interchangeable",
    objective: "Convert between improper fractions and mixed numbers.",
    skills: ["mixed numbers", "conversion"],
  },
  {
    match: /decimal|percentage|percent/i,
    concept: "Fractions relate to decimals and percentages",
    objective: "Convert between fractions, decimals and percentages for the same quantity.",
    skills: ["conversion", "representations"],
  },
  {
    match: /compare|order|greater than|less than/i,
    concept: "Fractions are ordered by size, not by denominator",
    objective: "Compare and order fractions with different denominators and justify the order.",
    skills: ["comparing", "reasoning"],
  },
  {
    match: /add|subtract|sum|difference/i,
    concept: "Adding and subtracting fractions needs a common denominator",
    objective: "Add and subtract fractions with unlike denominators.",
    skills: ["common denominator", "procedure"],
  },
  {
    match: /multipl|times|divide|division/i,
    concept: "Multiplying a fraction by a whole number",
    objective: "Multiply a fraction by a whole number and explain the result.",
    skills: ["multiplication", "reasoning"],
  },
  {
    match: /number line/i,
    concept: "Fractions have a position on the number line",
    objective: "Place fractions on a number line and use it to compare them.",
    skills: ["number line", "representation"],
  },
  {
    match: /word problem|real life|real-world|story/i,
    concept: "Fraction operations model real situations",
    objective: "Choose the correct fraction operation to solve a word problem and justify the choice.",
    skills: ["problem solving", "modelling"],
  },
];

const CORE_UNCERTAINTIES: { match: RegExp; note: string }[] = [
  { match: /denominator/i, note: "The lesson never names the denominator, so the notation objective may need a worked example." },
  { match: /equivalent/i, note: "Equivalent fractions are not mentioned; confirm whether they are in scope for this lesson." },
  { match: /model|diagram|picture/i, note: "No visual model is described; consider adding a diagram for the concrete step." },
];

function excerpt(content: string, match: RegExp): string {
  const sentences = content.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((sentence) => match.test(sentence));
  const text = (hit ?? sentences[0] ?? content).trim().replace(/\s+/g, " ");
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export const mockLessonAnalyzer: LessonAnalyzer = {
  id: "mock",
  label: "Mock analyser (deterministic, no model call)",
  isMock: true,

  async analyze(input: LessonAnalysisInput): Promise<AnalyzerRun> {
    const started = Date.now();
    const content = input.content.trim();

    // An honest failure path: too little text cannot produce useful objectives.
    if (content.length < 120) {
      throw new AiAnalysisError(
        "The lesson text is too short to analyse. Add at least a short paragraph, then try again.",
        "mock:content-too-short",
      );
    }

    const matched = RULES.filter((rule) => rule.match.test(content) || rule.match.test(input.title));
    const rules = matched.length >= 2 ? matched : RULES.slice(0, 3);

    const objectives = rules.slice(0, 6).map((rule) => ({
      statement: rule.objective,
      skills: rule.skills,
      evidence: excerpt(content, rule.match),
    }));

    const concepts = Array.from(new Set([...rules.map((rule) => rule.concept), ...(input.learningObjectiveHint ? [input.learningObjectiveHint] : [])]));

    const uncertainties = CORE_UNCERTAINTIES.filter((item) => !item.match.test(content)).map((item) => item.note);

    // Run the canned output through the same validator a real model must pass, so
    // mock mode cannot drift into shapes the UI would never accept.
    const parsed = analysisSchema.safeParse({
      summary: `This lesson covers ${concepts.length} idea${concepts.length === 1 ? "" : "s"} about ${input.title.trim() || "the topic"}. Objectives below are derived from the wording of the lesson text.`,
      concepts,
      objectives,
      uncertainties,
    });

    if (!parsed.success) {
      throw new AiAnalysisError("The analyser produced output that failed validation.", "mock:invalid-output");
    }

    return {
      analysis: parsed.data,
      provider: "mock",
      model: "deterministic-rules",
      durationMs: Date.now() - started,
      repaired: false,
    };
  },
};
