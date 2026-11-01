/** Prompt text shared by every transport, so a provider swap cannot change the pedagogy. */

export const ANALYSIS_SYSTEM_PROMPT = [
  "You analyse a teacher's lesson text and return learning objectives.",
  "Rules:",
  "- Use only the supplied lesson text. Never add facts the lesson does not contain.",
  "- One objective per testable skill; start each with an observable verb.",
  "- Keep statements under 240 characters.",
  "- `skills` holds 1-6 short skill labels.",
  "- `evidence` is a short quote (max 160 characters) copied from the lesson that supports the objective.",
  "- If something needed for an objective is missing from the lesson, list it in `uncertainties` instead of inventing it.",
  'Return JSON only: {"summary": string, "concepts": string[], "objectives": [{"statement": string, "skills": string[], "evidence": string}], "uncertainties": string[]}',
].join("\n");

export function analysisUserPrompt(
  input: { title: string; learningObjectiveHint: string; content: string },
  repairReason?: string,
): string {
  const parts = [
    `Lesson title: ${input.title}`,
    input.learningObjectiveHint ? `Teacher's current objective note: ${input.learningObjectiveHint}` : "",
    "Lesson text:",
    input.content.slice(0, 12_000),
  ].filter(Boolean);
  if (repairReason) {
    parts.push(`Your previous answer could not be used because ${repairReason}. Return corrected JSON only, with no commentary.`);
  }
  return parts.join("\n\n");
}

export const CHALLENGE_SYSTEM_PROMPT = [
  "You write short assessment questions for a Grade 6 lesson the teacher supplied.",
  "Rules:",
  "- Use only the lesson text and the approved objectives. Never introduce facts they do not contain.",
  "- Every question must reference one of the supplied objective ids exactly as given in `objectiveId`.",
  '- `multiple_choice` needs 3-4 distinct options; `true_false` needs exactly ["True", "False"].',
  "- Exactly one option is correct and `correctIndex` is its zero-based position.",
  "- Include a short `explanation` that says why the correct answer is right.",
  "- Questions must be answerable from the lesson alone; no trick questions.",
  'Return JSON only: {"questions": [{"prompt": string, "kind": "multiple_choice"|"true_false", "options": string[], "correctIndex": number, "explanation": string, "objectiveId": string}]}',
].join("\n");

export function challengeUserPrompt(
  input: { title: string; content: string; objectives: { id: string; statement: string; skills: string[] }[] },
  repairReason?: string,
): string {
  const objectives = input.objectives
    .map((objective) => `- id: ${objective.id} | ${objective.statement} | skills: ${objective.skills.join(", ")}`)
    .join("\n");
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
