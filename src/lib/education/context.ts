/**
 * Educational context: grade, subject and curriculum.
 *
 * NABTA is not a Grade 6 mathematics product; Grade 6 fractions is the reference
 * fixture used to build and test it. Everything that generates language — prompts,
 * difficulty, hints, feedback — takes this context so it can adapt to the student
 * rather than assume one year group.
 *
 * Every field is optional. A class with no context still works; the prompts then use
 * neutral wording rather than quietly pretending to be Grade 6.
 */

export type EducationContext = {
  gradeLevel: number | null;
  subject: string | null;
  curriculum: string | null;
};

export const EMPTY_CONTEXT: EducationContext = { gradeLevel: null, subject: null, curriculum: null };

/**
 * Age bands bound how the AI may speak. These are safeguards, not preferences:
 * a band decides how complex an explanation may get and what examples are acceptable.
 */
export type AgeBand = "early-primary" | "primary" | "middle" | "senior" | "unspecified";

export const AGE_BAND_GUIDANCE: Record<AgeBand, { reader: string; examples: string; caution: string }> = {
  "early-primary": {
    reader: "very short sentences, everyday words, one idea per sentence",
    examples: "shared, familiar objects and play",
    caution: "avoid abstraction, avoid competition, never mention grades or scores as judgement",
  },
  primary: {
    reader: "short sentences, concrete vocabulary, define any new term",
    examples: "things the student can picture or hold",
    caution: "keep tone encouraging; never imply the student is behind",
  },
  middle: {
    reader: "clear sentences, subject vocabulary introduced with a definition",
    examples: "situations a young teenager recognises",
    caution: "no sarcasm, no pressure framing, no comparisons with classmates",
  },
  senior: {
    reader: "precise academic language appropriate to the subject",
    examples: "exam-style and real-world applications",
    caution: "no predictions about future results or ability",
  },
  unspecified: {
    reader: "clear, plain sentences that define any subject-specific term",
    examples: "neutral, generally familiar situations",
    caution: "do not assume an age; keep language plain and non-judgemental",
  },
};

export function ageBandFor(gradeLevel: number | null): AgeBand {
  if (gradeLevel === null || !Number.isFinite(gradeLevel)) return "unspecified";
  if (gradeLevel <= 3) return "early-primary";
  if (gradeLevel <= 5) return "primary";
  if (gradeLevel <= 8) return "middle";
  if (gradeLevel <= 12) return "senior";
  return "unspecified";
}

export function isContextSet(context: EducationContext | null | undefined): boolean {
  if (!context) return false;
  return context.gradeLevel !== null || Boolean(context.subject) || Boolean(context.curriculum);
}

/** Reads the context off a `classrooms` row without leaking Supabase types into callers. */
export function contextFromClassroom(
  row: { grade_level?: number | null; subject?: string | null; curriculum?: string | null } | null | undefined,
): EducationContext {
  if (!row) return EMPTY_CONTEXT;
  return {
    gradeLevel: typeof row.grade_level === "number" ? row.grade_level : null,
    subject: row.subject ?? null,
    curriculum: row.curriculum ?? null,
  };
}

/** One-line label for the UI, e.g. "Grade 6 · Mathematics · UAE MOE". */
export function describeContext(context: EducationContext | null | undefined): string {
  if (!isContextSet(context)) return "No grade or subject set";
  const parts: string[] = [];
  if (context!.gradeLevel !== null) parts.push(`Grade ${context!.gradeLevel}`);
  if (context!.subject) parts.push(context!.subject!);
  if (context!.curriculum) parts.push(context!.curriculum!);
  return parts.join(" · ");
}

/**
 * The block injected into a system prompt.
 *
 * Deliberately explicit about what is unknown, so a model cannot fill the gap by
 * assuming Grade 6 from the surrounding text.
 */
export function promptContextBlock(context: EducationContext | null | undefined): string {
  const safe = context ?? EMPTY_CONTEXT;
  const band = ageBandFor(safe.gradeLevel);
  const guidance = AGE_BAND_GUIDANCE[band];

  const lines = [
    "EDUCATIONAL CONTEXT",
    safe.gradeLevel !== null
      ? `- Grade / year level: ${safe.gradeLevel}`
      : "- Grade / year level: not specified. Do not assume one; aim at no particular year group.",
    safe.subject ? `- Subject: ${safe.subject}` : "- Subject: not specified. Infer it only from the lesson text.",
    safe.curriculum ? `- Curriculum: ${safe.curriculum}` : "- Curriculum: not specified. Do not cite a specific national standard.",
    `- Writing level: ${guidance.reader}`,
    `- Examples: ${guidance.examples}`,
    `- Care: ${guidance.caution}`,
    "- Difficulty labels are relative to this grade, not absolute. \"Medium\" means medium for this year group.",
  ];
  return lines.join("\n");
}
