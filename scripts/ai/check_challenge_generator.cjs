/* eslint-disable @typescript-eslint/no-require-imports -- Node check script loads the compiled CommonJS build */
/**
 * Checks for the AI challenge generator.
 *
 *   npm run check:ai
 *
 * Focus: the answer key must never be wrong in mock mode, every question must be
 * grounded in an objective the teacher approved, and malformed generations must be
 * rejected rather than stored.
 */
const { parseChallenge } = require("../../.check-build/ai/challenge.js");
const { mockChallengeGenerator } = require("../../.check-build/ai/challenge-mock.js");
const { resolveChallengeGenerator } = require("../../.check-build/ai/index.js");
const { AiAnalysisError } = require("../../.check-build/ai/types.js");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const OBJECTIVE_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OBJECTIVE_B = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const allowed = [OBJECTIVE_A, OBJECTIVE_B];

const good = {
  questions: [
    {
      prompt: "Which fraction is equivalent to 1/2?",
      kind: "multiple_choice",
      options: ["2/4", "1/3", "3/5", "2/5"],
      correctIndex: 0,
      explanation: "Multiplying numerator and denominator by 2 gives 2/4, the same amount as 1/2.",
      objectiveId: OBJECTIVE_A,
      difficulty: "medium",
    },
  ],
};

check(parseChallenge(good, allowed).ok, "a well-formed challenge must parse");

const outOfRange = JSON.parse(JSON.stringify(good));
outOfRange.questions[0].correctIndex = 9;
check(!parseChallenge(outOfRange, allowed).ok, "an out-of-range correctIndex must be rejected");

const duplicate = JSON.parse(JSON.stringify(good));
duplicate.questions[0].options = ["2/4", "2/4", "3/5"];
check(!parseChallenge(duplicate, allowed).ok, "duplicate options must be rejected");

const noDifficulty = JSON.parse(JSON.stringify(good));
delete noDifficulty.questions[0].difficulty;
check(!parseChallenge(noDifficulty, allowed).ok, "a question without a difficulty label must be rejected");

const badTrueFalse = JSON.parse(JSON.stringify(good));
badTrueFalse.questions[0].kind = "true_false";
badTrueFalse.questions[0].options = ["True", "False", "Maybe"];
check(!parseChallenge(badTrueFalse, allowed).ok, "true/false with three options must be rejected");

const ungrounded = JSON.parse(JSON.stringify(good));
ungrounded.questions[0].objectiveId = "3f2504e0-4f89-41d3-9a0c-0305e82c3399";
check(!parseChallenge(ungrounded, allowed).ok, "a question tied to an unapproved objective must be rejected");

check(!parseChallenge({ questions: [] }, allowed).ok, "an empty question list must be rejected");
check(!parseChallenge("not json at all", allowed).ok, "prose must be rejected");

const LESSON =
  "Fractions describe equal parts of a whole. The denominator tells us how many equal parts the whole is split into, and the numerator tells us how many parts we have. Two fractions are equivalent when they name the same amount, for example 1/2 and 2/4. We can simplify a fraction by dividing the numerator and denominator by a common factor. To compare fractions we can rewrite them with a common denominator.";

const objectives = [
  { id: OBJECTIVE_A, statement: "Recognise and produce equivalent fractions for a given fraction.", skills: ["equivalent fractions"] },
  { id: OBJECTIVE_B, statement: "Simplify a fraction by dividing by a common factor.", skills: ["common factors"] },
];

(async () => {
  const input = { title: "Introduction to Fractions", content: LESSON, objectives };
  const first = await mockChallengeGenerator.generate(input);
  const second = await mockChallengeGenerator.generate(input);

  check(JSON.stringify(first.challenge) === JSON.stringify(second.challenge), "mock generation must be deterministic");
  check(first.challenge.questions.length >= 2, "mock should produce several questions for a supported lesson");
  check(first.provider === "mock" && mockChallengeGenerator.isMock === true, "mock generation must identify itself");

  const questions = first.challenge.questions;
  check(questions.every((q) => allowed.includes(q.objectiveId)), "every question must reference an approved objective");
  check(questions.every((q) => q.correctIndex >= 0 && q.correctIndex < q.options.length), "every correctIndex must be in range");
  check(questions.every((q) => new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length), "options must be distinct");
  check(questions.every((q) => q.explanation.length >= 10), "every question needs an explanation");
  check(questions.every((q) => ["easy", "medium", "hard"].includes(q.difficulty)), "every question needs a difficulty label");

  // Hand-checked answers: these specific values must not drift.
  const equivalent = questions.find((q) => /equivalent to 1\/2/i.test(q.prompt));
  check(Boolean(equivalent), "the equivalent-fractions question should be generated for this lesson");
  if (equivalent) {
    check(equivalent.options[equivalent.correctIndex] === "2/4", `equivalent-fractions answer should be 2/4, got ${equivalent.options[equivalent.correctIndex]}`);
  }

  const simplify = questions.find((q) => /Simplify 6\/8/i.test(q.prompt));
  if (simplify) {
    check(simplify.options[simplify.correctIndex] === "3/4", `6/8 should simplify to 3/4, got ${simplify.options[simplify.correctIndex]}`);
  }

  const compare = questions.find((q) => /3\/4 or 5\/8/i.test(q.prompt));
  if (compare) {
    check(compare.options[compare.correctIndex] === "3/4", `3/4 > 5/8, got answer ${compare.options[compare.correctIndex]}`);
  }

  let noObjectives = false;
  try {
    await mockChallengeGenerator.generate({ ...input, objectives: [] });
  } catch (error) {
    noObjectives = error instanceof AiAnalysisError && /objective/i.test(error.message);
  }
  check(noObjectives, "generating without approved objectives must fail with a teacher-readable error");

  let unsupported = false;
  try {
    await mockChallengeGenerator.generate({
      title: "The Water Cycle",
      content: "Water evaporates from the sea, condenses into clouds, and falls as rain or snow. This cycle repeats and moves water around the planet.",
      objectives,
    });
  } catch (error) {
    unsupported = error instanceof AiAnalysisError;
  }
  check(unsupported, "the mock generator must refuse topics it cannot ground instead of inventing questions");

  const mockByDefault = resolveChallengeGenerator({});
  check(mockByDefault.setup.isMock, "no configuration must resolve to the mock generator");
  check(!/^mock\b/i.test(mockByDefault.setup.note), `the challenge note must not repeat the badge label: "${mockByDefault.setup.note}"`);

  const live = resolveChallengeGenerator({ AI_PROVIDER: "openai-compatible", AI_BASE_URL: "https://example.invalid/v1", AI_API_KEY: "k", AI_MODEL: "m" });
  check(live.setup.isMock === false, "a fully configured provider must resolve to live generation");

  if (failures.length) {
    console.log("FAILED");
    for (const failure of failures) console.log(" -", failure);
    process.exit(1);
  }
  console.log(`PASSED: ${questions.length} mock questions, hand-checked answers, grounding and rejection checks ok`);
})();
