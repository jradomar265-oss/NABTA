/* eslint-disable @typescript-eslint/no-require-imports -- Node check script loads the compiled CommonJS build */
/**
 * Live provider smoke test.
 *
 *   npm run check:live
 *
 * Reads .env.local (the same file the app uses), makes exactly ONE lesson
 * analysis and ONE challenge generation against the configured provider, prints
 * what came back, and stores nothing. It never touches Supabase.
 *
 * Use it to prove the provider works before a demo depends on it. It costs a few
 * thousand tokens; do not run it in a loop.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const { resolveLessonAnalyzer, resolveChallengeGenerator, geminiSurfaceInUse } = require("../../.check-build/ai/index.js");

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...readEnvFile(path.join(ROOT, ".env.local")), ...process.env };

const LESSON = [
  "A fraction describes equal parts of a whole. The denominator tells us how many equal parts the whole is split into,",
  "and the numerator tells us how many of those parts we have. Two fractions are equivalent when they name the same",
  "amount, for example 1/2 and 2/4. We can simplify a fraction by dividing the numerator and the denominator by a",
  "common factor. To compare fractions we can rewrite them with a common denominator.",
].join(" ");

const OBJECTIVES = [
  { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", statement: "Recognise and produce equivalent fractions.", skills: ["equivalent fractions"] },
  { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", statement: "Simplify a fraction using a common factor.", skills: ["common factors"] },
];

function show(label, value) {
  console.log(`${label}: ${value}`);
}

(async () => {
  const { analyzer, setup: analyzerSetup } = resolveLessonAnalyzer(env);
  const { generator, setup: challengeSetup } = resolveChallengeGenerator(env);

  show("provider", `${analyzerSetup.provider} (${analyzerSetup.isMock ? "mock" : "live"})`);
  show("model", env.AI_MODEL || "(unset)");

  if (analyzerSetup.isMock) {
    console.log(`\nNothing to test: ${analyzerSetup.note}`);
    console.log("To go live: set AI_PROVIDER (gemini or openai-compatible) plus the key and model in .env.local,");
    console.log("restart the dev server, then run this again.");
    process.exit(1);
  }

  let failures = 0;

  try {
    const started = Date.now();
    const run = await analyzer.analyze({ lessonId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", title: "Introduction to Fractions", learningObjectiveHint: "", content: LESSON });
    console.log(`\n✓ lesson analysis returned ${run.analysis.objectives.length} objectives in ${Date.now() - started}ms (provider ${run.provider}, repaired ${run.repaired})`);
    for (const objective of run.analysis.objectives.slice(0, 4)) {
      console.log(`   - ${objective.statement}  [${objective.skills.join(", ")}]`);
    }
    if (run.analysis.uncertainties.length) console.log(`   uncertainties: ${run.analysis.uncertainties.length}`);
  } catch (error) {
    failures += 1;
    console.log(`\n✗ lesson analysis failed: ${error.message}`);
    if (error.detail) console.log(`   detail: ${error.detail}`);
  }

  try {
    const started = Date.now();
    const run = await generator.generate({ title: "Introduction to Fractions", content: LESSON, objectives: OBJECTIVES });
    console.log(`\n✓ challenge generation returned ${run.challenge.questions.length} questions in ${Date.now() - started}ms (provider ${run.provider}, repaired ${run.repaired})`);
    for (const question of run.challenge.questions.slice(0, 3)) {
      const correct = question.options[question.correctIndex];
      console.log(`   - ${question.prompt}`);
      console.log(`     answer: ${correct}`);
    }
    const grounded = run.challenge.questions.every((question) => OBJECTIVES.some((objective) => objective.id === question.objectiveId));
    if (!grounded) {
      failures += 1;
      console.log("   ✗ a question referenced an objective that was not supplied");
    }
  } catch (error) {
    failures += 1;
    console.log(`\n✗ challenge generation failed: ${error.message}`);
    if (error.detail) console.log(`   detail: ${error.detail}`);
  }

  console.log(`\n${failures === 0 ? "LIVE PROVIDER OK" : "LIVE PROVIDER FAILED"} — ${challengeSetup.isMock ? "challenge generator fell back to mock" : challengeSetup.provider}`);
  if (geminiSurfaceInUse()) console.log(`Gemini REST surface: ${geminiSurfaceInUse()}`);
  process.exit(failures === 0 ? 0 : 1);
})();
