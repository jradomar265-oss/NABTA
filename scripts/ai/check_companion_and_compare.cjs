/* eslint-disable @typescript-eslint/no-require-imports -- Node check script loads the compiled CommonJS build */
/**
 * Checks for the Stage 8 part shipped so far: the learning companion and the
 * before/after comparison.
 *
 *   npm run check:ai
 *
 * The companion checks are mostly about refusal and grounding: it must not answer
 * from outside the lesson, and every explanation must quote it.
 */
const { parseCompanionAnswer } = require("../../.check-build/ai/companion.js");
const { mockCompanion } = require("../../.check-build/ai/companion-mock.js");
const { resolveCompanion } = require("../../.check-build/ai/index.js");
const { buildAnalysisFacts } = require("../../.check-build/learning/analysis.js");
const { compareEvidence, checkCompatibility } = require("../../.check-build/learning/compare.js");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const LESSON =
  "A fraction describes equal parts of a whole. The denominator tells us how many equal parts the whole is split into. " +
  "The numerator tells us how many of those parts we have. Two fractions are equivalent when they name the same amount, " +
  "for example 1/2 and 2/4. We can simplify a fraction by dividing the numerator and the denominator by a common factor.";

// --- companion grounding and refusal ----------------------------------------
const grounded = {
  answer: "The denominator is how many equal parts the whole is split into.",
  refused: false,
  groundedIn: ["The denominator tells us how many equal parts the whole is split into."],
  nextStep: "Find the denominator in 3/5.",
};
check(parseCompanionAnswer(grounded, LESSON).ok, "a grounded answer must parse");

const noQuote = { ...grounded, groundedIn: [] };
check(!parseCompanionAnswer(noQuote, LESSON).ok, "an explanation with no lesson quote must be rejected");

const inventedQuote = { ...grounded, groundedIn: ["Fractions are also used in advanced calculus."] };
check(!parseCompanionAnswer(inventedQuote, LESSON).ok, "a quote that is not in the lesson must be rejected");

const refusedWithQuote = {
  answer: "That is not covered in this lesson.",
  refused: true,
  groundedIn: ["The numerator tells us how many of those parts we have."],
  nextStep: "",
};
check(!parseCompanionAnswer(refusedWithQuote, LESSON).ok, "a refusal must not cite the lesson");

check(
  parseCompanionAnswer({ answer: "That is not covered in this lesson.", refused: true, groundedIn: [], nextStep: "" }, LESSON).ok,
  "a clean refusal must parse",
);
check(!parseCompanionAnswer("I think the answer is 2/4.", LESSON).ok, "prose instead of JSON must be rejected");

(async () => {
  const onTopic = await mockCompanion.answer({
    lessonTitle: "Fractions",
    lessonContent: LESSON,
    objectives: ["Identify the numerator and denominator."],
    question: "What does the denominator mean?",
  });
  check(onTopic.result.refused === false, "an on-topic question must be answered, not refused");
  check(onTopic.result.groundedIn.length >= 1, "a mock answer must quote the lesson");
  check(LESSON.toLowerCase().includes(onTopic.result.groundedIn[0].toLowerCase().replace(/\.\.\.$/, "").slice(0, 30)), "the mock quote must come from the lesson");

  const offTopic = await mockCompanion.answer({
    lessonTitle: "Fractions",
    lessonContent: LESSON,
    objectives: [],
    question: "Who won the football match yesterday?",
  });
  check(offTopic.result.refused === true, "an off-topic question must be refused");
  check(offTopic.result.groundedIn.length === 0, "a refusal must not quote the lesson");

  const thin = await mockCompanion.answer({
    lessonTitle: "Fractions",
    lessonContent: "Fractions are parts.",
    objectives: [],
    question: "What is a fraction?",
  });
  check(thin.contextMissing === true, "a lesson too short to ground an answer must be flagged");
  check(thin.result.refused === true, "a lesson too short to ground an answer must be refused");

  const deterministicA = await mockCompanion.answer({ lessonTitle: "F", lessonContent: LESSON, objectives: [], question: "What does the denominator mean?" });
  const deterministicB = await mockCompanion.answer({ lessonTitle: "F", lessonContent: LESSON, objectives: [], question: "What does the denominator mean?" });
  check(JSON.stringify(deterministicA.result) === JSON.stringify(deterministicB.result), "the mock companion must be deterministic");
  check(deterministicA.provider === "mock", "the mock companion must identify itself");

  check(resolveCompanion({}).setup.isMock, "no configuration must resolve the companion to mock");
  const live = resolveCompanion({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", AI_MODEL: "m" });
  check(live.setup.isMock === false && live.setup.provider === "gemini", "a configured key must resolve the companion to live");

  // --- before/after comparison ------------------------------------------------
  const OBJ = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const objective = { id: OBJ, statement: "Recognise equivalent fractions." };
  const question = { id: "q1", objectiveId: OBJ, options: ["2/4", "1/3"], prompt: "Equivalent to 1/2?" };

  function factsWith(correctCount, total) {
    const answers = Array.from({ length: total }, (_, index) => ({
      questionId: "q1",
      objectiveId: OBJ,
      choiceIndex: index < correctCount ? 0 : 1,
      correctIndex: 0,
      isCorrect: index < correctCount,
      options: question.options,
      studentId: `s${index}`,
      submittedAt: "",
    }));
    return buildAnalysisFacts({
      classroom: { id: "c1", name: "Class" },
      lessons: [],
      objectives: [objective],
      questions: [question],
      answers,
      students: [],
    });
  }

  const before = factsWith(2, 5);
  const after = factsWith(4, 5);
  const comparison = compareEvidence(before, after);

  check(comparison.rows.length === 1, "comparison should have one row");
  check(comparison.rows[0].deltaPoints === 40, `2/5 to 4/5 is +40 points, got ${comparison.rows[0].deltaPoints}`);
  check(comparison.rows[0].verdict === "improved", "a 40 point rise must read as improved");
  check(comparison.improved === 1 && comparison.lower === 0, "tallies must match the rows");
  check(comparison.causalClaim === false, "a comparison must never claim causation");
  check(/not proof of what caused it/i.test(comparison.statement), "the summary must disclaim causation in plain words");

  const tooThin = compareEvidence(factsWith(1, 2), factsWith(2, 2));
  check(tooThin.rows[0].verdict === "not-comparable", "two answers is not a comparable sample");
  check(tooThin.rows[0].reason !== null, "a non-comparable row must explain why");
  check(tooThin.comparable === 0, "comparable count must be zero when both sides are thin");
  check(/no comparison can be made/i.test(tooThin.statement), "the summary must say no comparison is possible");

  const dropped = compareEvidence(factsWith(4, 5), factsWith(2, 5));
  check(dropped.rows[0].verdict === "lower" && dropped.rows[0].deltaPoints === -40, "a 40 point fall must read as lower");

  const flat = compareEvidence(factsWith(3, 5), factsWith(3, 5));
  check(flat.rows[0].verdict === "unchanged" && flat.rows[0].deltaPoints === 0, "identical results must read as unchanged");

  // --- compatibility: only challenge vs follow_up may be compared -------------
  check(checkCompatibility("challenge", "follow_up").compatible === true, "challenge vs follow-up must be comparable");
  check(checkCompatibility("challenge", "challenge").compatible === false, "a challenge compared with itself must be refused");
  check(checkCompatibility("challenge", "practice").compatible === false, "a challenge cannot be compared with targeted practice");
  check(checkCompatibility("practice", "follow_up").compatible === false, "practice cannot be compared with follow-up");

  const refused = compareEvidence(before, after, { before: "challenge", after: "practice" });
  check(refused.incompatibleReason !== null, "an incompatible pair must produce a reason");
  check(refused.rows.length === 0, "an incompatible pair must produce no rows");
  check(refused.causalClaim === false, "even a refused comparison must not claim causation");

  if (failures.length) {
    console.log("FAILED");
    for (const failure of failures) console.log(" -", failure);
    process.exit(1);
  }
  console.log(`PASSED: companion grounding/refusal, determinism, and comparison maths (${comparison.rows[0].deltaPoints} point rise, no causal claim)`);
})();
