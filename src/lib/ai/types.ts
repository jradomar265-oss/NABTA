/** Shared contracts for the provider-independent AI layer. */

export type LessonAnalysisInput = {
  lessonId: string;
  title: string;
  learningObjectiveHint: string;
  content: string;
};

export type AnalyzedObjective = {
  statement: string;
  skills: string[];
  evidence: string;
};

/** The validated result of a lesson analysis. */
export type LessonAnalysis = {
  summary: string;
  concepts: string[];
  objectives: AnalyzedObjective[];
  uncertainties: string[];
};

export type AnalyzerRun = {
  analysis: LessonAnalysis;
  provider: string;
  model: string;
  durationMs: number;
  repaired: boolean;
};

export interface LessonAnalyzer {
  readonly id: string;
  readonly label: string;
  /** True when the output is canned. Mock output must be labelled everywhere it appears. */
  readonly isMock: boolean;
  analyze(input: LessonAnalysisInput): Promise<AnalyzerRun>;
}

/**
 * Raised for anything the teacher needs to act on: missing credentials, a timeout,
 * unusable model output. The message is written for a teacher, not a developer.
 */
export class AiAnalysisError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = "AiAnalysisError";
    this.detail = detail;
  }
}

export type AiSetup = {
  isMock: boolean;
  provider: string;
  label: string;
  /** Teacher-facing explanation of what will happen when they press Analyse. */
  note: string;
};
