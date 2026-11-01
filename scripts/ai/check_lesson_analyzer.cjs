/* eslint-disable @typescript-eslint/no-require-imports -- Node check script loads the compiled CommonJS build */
/**
 * Checks for the AI lesson-understanding layer.
 *
 *   npm run check:ai
 *
 * Runs against the CommonJS build in `.check-build/ai` (produced by the same
 * command), because Node cannot resolve the extensionless relative imports that
 * the Next.js bundler accepts. Covers the parts that must be trustworthy before
 * any model is trusted: structured-output validation, honest failure,
 * deterministic mock output, and provider resolution.
 */
const { resolveLessonAnalyzer } = require("../../.check-build/ai/index.js");
const { mockLessonAnalyzer } = require("../../.check-build/ai/mock-analyzer.js");
const { parseAnalysis } = require("../../.check-build/ai/schema.js");
const { AiAnalysisError } = require("../../.check-build/ai/types.js");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const valid = {
  summary: "Students learn that a fraction describes equal parts of a whole.",
  concepts: ["fractions", "equal parts"],
  objectives: [
    {
      statement: "Explain that a fraction describes equal parts of a whole.",
      skills: ["fraction meaning"],
      evidence: "A fraction shows equal parts.",
    },
  ],
  uncertainties: [],
};

check(parseAnalysis(valid).ok, "a valid object must parse");
check(parseAnalysis("```json\n" + JSON.stringify(valid) + "\n```").ok, "a fenced JSON response must parse");
check(parseAnalysis(JSON.stringify({ analysis: valid })).ok, "an {analysis: ...} wrapper must parse");

const notJson = parseAnalysis("Sure! Here are your objectives: ...");
check(!notJson.ok, "prose without JSON must be rejected");
if (!notJson.ok) check(/JSON/i.test(notJson.reason), `rejection reason should mention JSON, got: ${notJson.reason}`);

check(!parseAnalysis({ summary: valid.summary, concepts: ["fractions"], objectives: [] }).ok, "an empty objective list must be rejected");
check(
  !parseAnalysis({ summary: valid.summary, concepts: ["fractions"], objectives: [{ statement: "Explain fractions clearly.", skills: [], evidence: "" }] }).ok,
  "an objective without skills must be rejected",
);
check(
  !parseAnalysis({ summary: valid.summary, concepts: ["fractions"], objectives: [{ statement: "Ok.", skills: ["x"], evidence: "" }] }).ok,
  "a too-short statement must be rejected",
);

const LESSON =
  "Fractions describe equal parts of a whole. The denominator tells us how many equal parts the whole is split into, and the numerator tells us how many parts we have. Two fractions are equivalent when they name the same amount, for example 1/2 and 2/4. We can simplify a fraction by dividing the numerator and denominator by a common factor.";

(async () => {
  const input = { lessonId: "11111111-1111-1111-1111-111111111111", title: "Introduction to Fractions", learningObjectiveHint: "", content: LESSON };
  const first = await mockLessonAnalyzer.analyze(input);
  const second = await mockLessonAnalyzer.analyze(input);

  check(JSON.stringify(first.analysis) === JSON.stringify(second.analysis), "mock output must be deterministic");
  check(first.analysis.objectives.length >= 2, "mock output should produce several objectives for a real lesson");
  check(first.provider === "mock" && mockLessonAnalyzer.isMock === true, "mock runs must identify themselves as mock");
  check(first.analysis.objectives.every((objective) => objective.evidence.length > 0), "each mock objective should quote the lesson");

  let shortFailed = false;
  try {
    await mockLessonAnalyzer.analyze({ ...input, title: "Too short", content: "Fractions are parts." });
  } catch (error) {
    shortFailed = error instanceof AiAnalysisError;
  }
  check(shortFailed, "a too-short lesson must raise a teacher-readable AiAnalysisError");

  const mockByDefault = resolveLessonAnalyzer({});
  check(mockByDefault.setup.isMock, "no configuration must resolve to the mock analyser");
  check(mockByDefault.setup.note.length > 20, "the default setup note must explain the mode");
  // The UI already renders a "Mock mode" / "Live AI" badge, so the note must not repeat the label.
  check(!/^mock\b/i.test(mockByDefault.setup.note), `the note must not repeat the badge label: "${mockByDefault.setup.note}"`);
  check(!/mock mode:/i.test(mockByDefault.setup.note), "the note must not contain a second 'Mock mode:' prefix");

  const halfConfigured = resolveLessonAnalyzer({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://example.invalid/v1" });
  check(halfConfigured.setup.isMock, "a half-configured provider must fall back to mock");
  check(/AI_API_KEY/.test(halfConfigured.setup.note), "the fallback note must name the missing variable");
  check(!/^mock\b/i.test(halfConfigured.setup.note), "the fallback note must not repeat the badge label");

  const live = resolveLessonAnalyzer({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://example.invalid/v1", AI_API_KEY: "test", AI_MODEL: "test-model" });
  check(live.setup.isMock === false, "a fully configured provider must resolve to live");
  check(live.setup.provider === "openai-compatible", "live provider id must be reported");

  if (failures.length) {
    console.log("FAILED");
    for (const failure of failures) console.log(" -", failure);
    process.exit(1);
  }
  console.log(`PASSED: ${first.analysis.objectives.length} mock objectives; validation, failure and provider-resolution checks ok`);
})();
