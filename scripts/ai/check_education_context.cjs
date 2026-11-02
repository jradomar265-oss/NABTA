/* eslint-disable @typescript-eslint/no-require-imports -- Node check script loads the compiled CommonJS build */
/**
 * Checks for education context: grade, subject, curriculum.
 *
 *   npm run check:ai
 *
 * The requirement is that NABTA is not a Grade 6 product. So these assertions are
 * mostly negative: no prompt may claim a grade that was not supplied, and a class with
 * no context must still produce usable, neutral instructions.
 */
const {
  ageBandFor,
  contextFromClassroom,
  describeContext,
  EMPTY_CONTEXT,
  isContextSet,
  promptContextBlock,
} = require("../../.check-build/education/context.js");
const { challengeSystemPrompt } = require("../../.check-build/ai/prompts.js");
const { companionSystemPrompt } = require("../../.check-build/ai/companion.js");
const { analysisSystemPrompt } = require("../../.check-build/ai/analysis.js");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// --- age bands ---------------------------------------------------------------
check(ageBandFor(2) === "early-primary", "grade 2 should be early-primary");
check(ageBandFor(5) === "primary", "grade 5 should be primary");
check(ageBandFor(6) === "middle", "grade 6 should be middle");
check(ageBandFor(8) === "middle", "grade 8 should be middle");
check(ageBandFor(9) === "senior", "grade 9 should be senior");
check(ageBandFor(12) === "senior", "grade 12 should be senior");
check(ageBandFor(null) === "unspecified", "no grade must be unspecified");
check(ageBandFor(40) === "unspecified", "an out-of-range grade must not invent a band");

// --- context helpers ---------------------------------------------------------
check(isContextSet(EMPTY_CONTEXT) === false, "an empty context is not set");
check(isContextSet({ gradeLevel: 6, subject: null, curriculum: null }) === true, "a grade alone counts as set");
check(describeContext(EMPTY_CONTEXT) === "No grade or subject set", `empty label was: ${describeContext(EMPTY_CONTEXT)}`);
check(describeContext({ gradeLevel: 8, subject: "Science", curriculum: "UAE MOE" }) === "Grade 8 · Science · UAE MOE", "label should join the parts");

check(contextFromClassroom(null).gradeLevel === null, "a null row must produce an empty context");
check(contextFromClassroom({ grade_level: 4, subject: "English", curriculum: null }).gradeLevel === 4, "grade must be read off the row");
check(contextFromClassroom({ grade_level: null, subject: "English", curriculum: null }).gradeLevel === null, "a null grade stays null");

// --- the middle band must not claim Grade 6 when nothing was supplied ---------
const none = promptContextBlock(EMPTY_CONTEXT);
check(/not specified/i.test(none), "an unset context must say the grade is not specified");
check(/do not assume/i.test(none), "an unset context must tell the model not to assume a grade");
check(!/grade 6/i.test(none), "an unset context must not mention Grade 6 at all");
check(/relative to this grade/i.test(none), "difficulty must be stated as relative to the grade");

const g8 = promptContextBlock({ gradeLevel: 8, subject: "Science", curriculum: "UAE MOE" });
check(/Grade \/ year level: 8/.test(g8), "a supplied grade must appear");
check(/Subject: Science/.test(g8), "a supplied subject must appear");
check(/Curriculum: UAE MOE/.test(g8), "a supplied curriculum must appear");

// --- every prompt surface carries the context --------------------------------
for (const [label, prompt, context] of [
  ["challenge", challengeSystemPrompt({ gradeLevel: 3, subject: "Mathematics", curriculum: null }), "Grade / year level: 3"],
  ["companion", companionSystemPrompt({ gradeLevel: 10, subject: "Physics", curriculum: null }), "Grade / year level: 10"],
  ["analysis", analysisSystemPrompt({ gradeLevel: 4, subject: "English", curriculum: null }), "Grade / year level: 4"],
]) {
  check(prompt.includes(context), `${label} prompt must include the supplied grade`);
  check(prompt.includes("EDUCATIONAL CONTEXT"), `${label} prompt must include the context block`);
  check(!/Grade 6/i.test(prompt), `${label} prompt must not hardcode Grade 6`);
}

// --- and they stay sane with no context --------------------------------------
for (const [label, prompt] of [
  ["challenge", challengeSystemPrompt(null)],
  ["companion", companionSystemPrompt(undefined)],
  ["analysis", analysisSystemPrompt(EMPTY_CONTEXT)],
]) {
  check(!/Grade 6/i.test(prompt), `${label} prompt with no context must not mention Grade 6`);
  check(prompt.includes("EDUCATIONAL CONTEXT"), `${label} prompt with no context must still describe the context gap`);
}

if (failures.length) {
  console.log("FAILED");
  for (const failure of failures) console.log(" -", failure);
  process.exit(1);
}
console.log(`PASSED: age bands, context helpers, and no prompt hardcodes Grade 6 (with or without context)`);
