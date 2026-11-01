import { completeJson } from "./chat";
import { parseChallenge, type ChallengeGenerator, type ChallengeInput, type ChallengeRun } from "./challenge";
import { AiAnalysisError } from "./types";

const SYSTEM_PROMPT = [
  "You write short assessment questions for a Grade 6 lesson the teacher supplied.",
  "Rules:",
  "- Use only the lesson text and the approved objectives. Never introduce facts they do not contain.",
  "- Every question must reference one of the supplied objective ids exactly as given in `objectiveId`.",
  "- `multiple_choice` needs 3-4 distinct options; `true_false` needs exactly [\"True\", \"False\"].",
  "- Exactly one option is correct and `correctIndex` is its zero-based position.",
  "- Include a short `explanation` that says why the correct answer is right.",
  "- Questions must be answerable from the lesson alone; no trick questions.",
  'Return JSON only: {"questions": [{"prompt": string, "kind": "multiple_choice"|"true_false", "options": string[], "correctIndex": number, "explanation": string, "objectiveId": string}]}',
].join("\n");

function userPrompt(input: ChallengeInput, repairReason?: string): string {
  const objectives = input.objectives.map((objective) => `- id: ${objective.id} | ${objective.statement} | skills: ${objective.skills.join(", ")}`).join("\n");
  const parts = [
    `Lesson title: ${input.title}`,
    "Approved objectives:",
    objectives,
    "Lesson text:",
    input.content.slice(0, 12_000),
    "Produce 4 to 6 questions spread across the objectives.",
  ];
  if (repairReason) {
    parts.push(`Your previous answer could not be used because ${repairReason}. Return corrected JSON only.`);
  }
  return parts.join("\n\n");
}

export function createHttpChallengeGenerator(config: { baseUrl: string; apiKey: string; model: string }): ChallengeGenerator {
  if (typeof window !== "undefined") {
    throw new Error("The HTTP challenge generator must run on the server only.");
  }

  const ask = (input: ChallengeInput, repairReason?: string) =>
    completeJson(config, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(input, repairReason) },
    ]);

  return {
    id: "openai-compatible",
    label: `Live generator (${config.model})`,
    isMock: false,

    async generate(input: ChallengeInput): Promise<ChallengeRun> {
      const started = Date.now();
      const allowed = input.objectives.map((objective) => objective.id);

      const first = parseChallenge(await ask(input), allowed);
      if (first.ok) {
        return { challenge: first.value, provider: "openai-compatible", model: config.model, durationMs: Date.now() - started, repaired: false };
      }

      const second = parseChallenge(await ask(input, first.reason), allowed);
      if (second.ok) {
        return { challenge: second.value, provider: "openai-compatible", model: config.model, durationMs: Date.now() - started, repaired: true };
      }

      throw new AiAnalysisError(
        "The AI returned questions that did not match the required structure, twice. Nothing was saved.",
        `invalid-output: ${second.reason}`,
      );
    },
  };
}
