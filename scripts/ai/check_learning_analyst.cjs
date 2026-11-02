/* eslint-disable @typescript-eslint/no-require-imports -- Node check script loads the compiled CommonJS build */
/**
 * Checks for Stage 7: computed facts and the learning analyst.
 *
 *   npm run check:ai
 *
 * The most important assertions here are about restraint: an objective with too
 * few answers must be reported as needing more evidence, and an analyst may not
 * describe a class confidently when the facts are thin.
 */
const { buildAnalysisFacts, THRESHOLDS, objectiveStatus, accuracyOf } = require("../../.check-build/learning/analysis.js");
const { parseObservations } = require("../../.check-build/ai/analysis.js");
const { mockLearningAnalyst } = require("../../.check-build/ai/analysis-mock.js");
const { resolveLearningAnalyst } = require("../../.check-build/ai/index.js");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const OBJ_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OBJ_B = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";

const objectives = [
  { id: OBJ_A, statement: "Recognise equivalent fractions." },
  { id: OBJ_B, statement: "Simplify a fraction using a common factor." },
];

const questions = [
  { id: "q1", objectiveId: OBJ_A, options: ["2/4", "1/3", "3/5", "2/5"], prompt: "Equivalent to 1/2?" },
  { id: "q2", objectiveId: OBJ_A, options: ["3/6", "1/4", "2/5", "4/6"], prompt: "Equivalent to 1/2 again?" },
  { id: "q3", objectiveId: OBJ_B, options: ["3/4", "2/3", "6/8", "1/2"], prompt: "Simplify 6/8." },
];

/** Only objective A is answered, by two students, three answers in total. */
function answers() {
  return [
    { questionId: "q1", objectiveId: OBJ_A, choiceIndex: 0, correctIndex: 0, isCorrect: true, options: questions[0].options, studentId: "s1", submittedAt: "" },
    { questionId: "q2", objectiveId: OBJ_A, choiceIndex: 2, correctIndex: 0, isCorrect: false, options: questions[1].options, studentId: "s1", submittedAt: "" },
    { questionId: "q1", objectiveId: OBJ_A, choiceIndex: 0, correctIndex: 0, isCorrect: true, options: questions[0].options, studentId: "s2", submittedAt: "" },
  ];
}

const facts = buildAnalysisFacts({
  classroom: { id: "c1", name: "Grade 6 Maths" },
  lessons: [{ id: "l1", title: "Fractions" }],
  objectives,
  questions,
  answers: answers(),
  students: [
    { id: "s1", displayName: "Aisha" },
    { id: "s2", displayName: "Omar" },
    { id: "s3", displayName: "Layla" },
  ],
});

// --- facts are arithmetic, so they must be exactly right ---------------------
check(facts.totals.answers === 3, `expected 3 answers, got ${facts.totals.answers}`);
check(facts.totals.correct === 2, `expected 2 correct, got ${facts.totals.correct}`);
check(accuracyOf(2, 3) === 0.667, `accuracy should be 0.667, got ${accuracyOf(2, 3)}`);
check(facts.totals.studentsWithAnswers === 2, `expected 2 students with answers, got ${facts.totals.studentsWithAnswers}`);

const a = facts.objectives.find((objective) => objective.objectiveId === OBJ_A);
const b = facts.objectives.find((objective) => objective.objectiveId === OBJ_B);

check(a.attempts === 3 && a.correct === 2, `objective A should be 2/3, got ${a.correct}/${a.attempts}`);
check(a.evidenceState === "usable", `objective A should be usable evidence, got ${a.evidenceState}`);
check(a.status === "on-track", `2/3 is neither a strength nor a gap, got ${a.status}`);
check(a.topDistractor && a.topDistractor.index === 2 && a.topDistractor.count === 1, "objective A should record the wrong option that was chosen");

check(b.attempts === 0, "objective B has no answers");
check(b.status === "not-assessed", `an unanswered objective must be not-assessed, got ${b.status}`);
check(b.accuracy === null, "an unanswered objective has no accuracy, not zero");

check(facts.insufficientReasons.some((reason) => /no questions answered at all/i.test(reason)), "an objective with no answers must be called out as unassessed");

// --- evidence thresholds -----------------------------------------------------
check(objectiveStatus(2, 1) === "needs-more-evidence", "2 answers must not be enough for a conclusion");
check(objectiveStatus(THRESHOLDS.minAttemptsForHypothesis, 1) === "strength" ? false : true, "3 answers at 100% must not yet count as a strength");
check(objectiveStatus(4, 1) === "strength", "4 answers at 100% should count as a strength");
check(objectiveStatus(5, 0.4) === "gap", "40% over 5 answers should be a gap");

// --- validation: an analyst may not overclaim ---------------------------------
const good = {
  summary: "The class answered three questions across two objectives.",
  observations: [
    { kind: "on-track" === "on-track" ? "strength" : "strength", objectiveId: OBJ_A, statement: "Equivalent fractions are secure for this pair.", evidence: "2 of 3 answers correct (67%) from 2 students.", confidence: "low" },
  ],
  limitations: ["Based on one assessment of one class."],
  insufficientEvidence: false,
};
check(parseObservations(good, facts).ok, "a well-formed observation must parse");

// --- question-level reporting -----------------------------------------------
const questionId = facts.questions[0].questionId;
const withItem = { ...good, challengeItems: [{ questionId, statement: "Very few students answered this correctly.", evidence: "0 of 4 correct (0%).", confidence: "moderate" }], difficultyRecommendation: { direction: "easier", reason: "Accuracy is low." } };
$withItemResult = parseObservations(withItem, facts);
check($withItemResult.ok, `a challenge-item comment with a real question id must parse: ${$withItemResult.ok ? "" : $withItemResult.reason}`);
const strayItem = { ...good, challengeItems: [{ questionId: "3f2504e0-4f89-41d3-9a0c-0305e82c99ff", statement: "A question that is not in the fact sheet.", evidence: "0 of 4 correct.", confidence: "low" }] };
check(!parseObservations(strayItem, facts).ok, "a challenge-item comment about an unknown question must be rejected");
const badDirection = { ...good, difficultyRecommendation: { direction: "sideways", reason: "Anything." } };
check(!parseObservations(badDirection, facts).ok, "an unknown difficulty direction must be rejected");
check(facts.questions.length > 0, "the fact sheet must carry per-question facts");
check(facts.questions.every((q) => Array.isArray(q.optionCounts)), "every question fact must carry option counts");

const strayObjective = JSON.parse(JSON.stringify(good));
strayObjective.observations[0].objectiveId = "3f2504e0-4f89-41d3-9a0c-0305e82c3399";
check(!parseObservations(strayObjective, facts).ok, "an observation about an objective outside the fact sheet must be rejected");

const noEvidence = JSON.parse(JSON.stringify(good));
noEvidence.observations[0].evidence = "";
check(!parseObservations(noEvidence, facts).ok, "an observation without cited numbers must be rejected");

const overclaims = JSON.parse(JSON.stringify(good));
overclaims.insufficientEvidence = false;
const thinFacts = { objectives: facts.objectives, questions: facts.questions, evidenceState: "insufficient" };
check(!parseObservations(overclaims, thinFacts).ok, "thin facts must not be reported as sufficient evidence");

(async () => {
  const first = await mockLearningAnalyst.analyse(facts);
  const second = await mockLearningAnalyst.analyse(facts);
  check(JSON.stringify(first.observations) === JSON.stringify(second.observations), "mock analysis must be deterministic");
  check(first.provider === "mock", "mock analysis must identify itself");

  const forB = first.observations.observations.filter((observation) => observation.objectiveId === OBJ_B);
  check(forB.length > 0 && forB.every((observation) => observation.kind === "insufficient"), "an unassessed objective may only be reported as needing evidence");

  const emptyFacts = buildAnalysisFacts({
    classroom: { id: "c2", name: "Empty class" },
    lessons: [],
    objectives: [],
    questions: [],
    answers: [],
    students: [],
  });
  const empty = await mockLearningAnalyst.analyse(emptyFacts);
  check(empty.observations.insufficientEvidence === true, "a class with no answers must be reported as insufficient evidence");
  check(empty.observations.observations.length === 0, "a class with no answers must produce no observations");

  const mockByDefault = resolveLearningAnalyst({});
  check(mockByDefault.setup.isMock, "no configuration must resolve the learning analyst to mock");

  const gemini = resolveLearningAnalyst({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", AI_MODEL: "m" });
  check(gemini.setup.isMock === false && gemini.setup.provider === "gemini", "a configured Gemini key must resolve the analyst to live Gemini");

  if (failures.length) {
    console.log("FAILED");
    for (const failure of failures) console.log(" -", failure);
    process.exit(1);
  }
  console.log(`PASSED: facts arithmetic, evidence thresholds, overclaim rejection and ${first.observations.observations.length} deterministic mock observations`);
})();
