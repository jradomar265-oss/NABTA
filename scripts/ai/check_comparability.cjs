/* eslint-disable @typescript-eslint/no-require-imports -- Node check script loads the compiled CommonJS build */
/**
 * Checks for the comparability guard.
 *
 *   npm run check:ai
 *
 * The point of these assertions is restraint: a pair that looks different in any
 * material way must be reported as "not directly comparable", and the limitation
 * wording must always be present so a reader cannot mistake a label match for
 * statistical equivalence.
 */
const { checkComparability, COMPARABILITY_LIMITATION, profileAssessment } = require("../../.check-build/learning/comparability.js");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const OBJ = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function question(index, overrides = {}) {
  return {
    id: `q${index}`,
    objectiveId: OBJ,
    kind: "multiple_choice",
    prompt: `Distinct question number ${index} about fractions?`,
    difficulty: "medium",
    ...overrides,
  };
}

const base = [question(1), question(2), question(3), question(4)];

// --- identical shape, different wording: comparable --------------------------
const distinct = [question(11), question(12), question(13), question(14)];
const sameShape = checkComparability(base, distinct);
check(sameShape.comparable === true, `a matched pair should be comparable, mismatches: ${JSON.stringify(sameShape.mismatches)}`);
check(sameShape.limitations.includes(COMPARABILITY_LIMITATION), "the statistical-equivalence disclaimer must always be present");
check(/does not prove/i.test(sameShape.headline + sameShape.limitations.join(" ")), "text must say that matching labels does not prove equivalence");

// --- count drift -------------------------------------------------------------
const fewer = checkComparability(base, distinct.slice(0, 2));
check(fewer.comparable === false, "2 questions against 4 must not be comparable");
check(fewer.mismatches.some((mismatch) => mismatch.area === "count"), "the count mismatch must be named");
check(/Not directly comparable/i.test(fewer.headline), "the headline must say not directly comparable");

// --- identical questions are practice, not a fresh check ---------------------
const repeated = checkComparability(base, base);
check(repeated.comparable === false, "identical question sets must not be comparable");
check(repeated.mismatches.some((mismatch) => mismatch.area === "distinctness"), "repeated questions must be reported as not distinct");

// --- type mix drift ----------------------------------------------------------
const mixedTypes = checkComparability(base, [question(21), question(22), question(23), question(24, { kind: "true_false" })]);
check(mixedTypes.comparable === true || mixedTypes.mismatches.every((mismatch) => mismatch.area === "kinds"), "a type change must only be reported under kinds");
const typeShift = checkComparability(
  base,
  [question(31, { kind: "true_false" }), question(32, { kind: "true_false" }), question(33, { kind: "true_false" }), question(34)],
);
check(typeShift.comparable === false, "a majority type flip must not be comparable");

// --- objective coverage ------------------------------------------------------
// A follow-up that introduces a different objective is not measuring the same thing.
const OTHER = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const missingObjective = checkComparability(base, [question(41), question(42), question(43), question(44, { objectiveId: OTHER })]);
check(missingObjective.comparable === false, "losing an objective on the follow-up must break comparability");
check(missingObjective.mismatches.some((mismatch) => mismatch.area === "objectives"), "the objective mismatch must be named");

// --- difficulty --------------------------------------------------------------
// No difficulty recorded on the follow-up at all: disclosed as a note, not a false mismatch.
const unlabelled = checkComparability(base, [question(51, { difficulty: null }), question(52, { difficulty: null }), question(53, { difficulty: null }), question(54, { difficulty: null })]);
check(unlabelled.comparable === true, "an unlabelled difficulty is a note, not a mismatch");
check(unlabelled.notes.some((note) => /difficulty was not recorded/i.test(note)), "missing difficulty labels must be disclosed");

const hardShift = checkComparability(
  base,
  [question(61, { difficulty: "hard" }), question(62, { difficulty: "hard" }), question(63, { difficulty: "hard" }), question(64)],
);
check(hardShift.comparable === false, "a majority difficulty shift must not be comparable");
check(hardShift.mismatches.some((mismatch) => mismatch.area === "difficulty"), "the difficulty mismatch must be named");

// --- degenerate input --------------------------------------------------------
const empty = checkComparability(base, []);
check(empty.comparable === false, "an empty follow-up must not be comparable");
check(/no questions/i.test(empty.headline), "an empty follow-up must say why");

// --- profile helper ----------------------------------------------------------
const profile = profileAssessment(base);
check(profile.questionCount === 4, "profile must count questions");
check(profile.difficultyRecorded === true, "profile must notice recorded difficulty");
check(profile.unattributed === 0, "profile must count unattributed questions");

if (failures.length) {
  console.log("FAILED");
  for (const failure of failures) console.log(" -", failure);
  process.exit(1);
}
console.log(`PASSED: comparability refuses count/type/objective/difficulty/distinctness drift and always shows the limitation`);
