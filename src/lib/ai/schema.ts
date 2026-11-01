import { z } from "zod";

/**
 * The contract a model must satisfy before anything is stored or shown.
 * `safeAnalysis` is the only way results enter the application.
 */
export const objectiveSchema = z.object({
  statement: z.string().trim().min(5, "objective is too short").max(500, "objective is too long"),
  skills: z.array(z.string().trim().min(1).max(60)).min(1, "objective needs at least one skill").max(6),
  evidence: z.string().trim().max(300).default(""),
});

export const analysisSchema = z.object({
  summary: z.string().trim().min(10, "summary is too short").max(1200),
  concepts: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
  objectives: z.array(objectiveSchema).min(1, "no objectives were produced").max(8),
  uncertainties: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
});

export type ParsedAnalysis = z.infer<typeof analysisSchema>;

export type SafeParseResult =
  | { ok: true; value: ParsedAnalysis; repairedNeeded: false }
  | { ok: false; reason: string };

/**
 * Accepts either an object or the raw JSON text a model returned.
 * Strips a fenced code block if the model wrapped its JSON.
 */
export function parseAnalysis(raw: unknown): SafeParseResult {
  let candidate: unknown = raw;

  if (typeof raw === "string") {
    const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      candidate = JSON.parse(text);
    } catch {
      return { ok: false, reason: "the response was not valid JSON" };
    }
  }

  if (candidate === null || typeof candidate !== "object") {
    return { ok: false, reason: "the response was not a JSON object" };
  }

  // Tolerate the common {"analysis": {...}} wrapper without accepting junk.
  const record = candidate as Record<string, unknown>;
  const shape = record.analysis && typeof record.analysis === "object" ? record.analysis : record;

  const parsed = analysisSchema.safeParse(shape);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "response";
    return { ok: false, reason: `${where}: ${first?.message ?? "did not match the required schema"}` };
  }

  return { ok: true, value: parsed.data, repairedNeeded: false };
}
