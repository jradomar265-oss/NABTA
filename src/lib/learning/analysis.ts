/**
 * Facts about student performance, computed from stored answers.
 *
 * Everything here is arithmetic over rows the server already recorded. No model
 * touches this file, and nothing in it may be produced by one: the whole point of
 * Stage 7 is that a teacher can tell a measurement from an interpretation.
 *
 * Pure functions only, so the maths is testable without a database.
 */

export type EvidenceState = "none" | "insufficient" | "usable";

export type AnswerRow = {
  questionId: string;
  objectiveId: string | null;
  choiceIndex: number;
  correctIndex: number;
  isCorrect: boolean;
  options: string[];
  studentId: string;
  submittedAt: string;
};

export type QuestionRow = {
  id: string;
  objectiveId: string | null;
  options: string[];
  prompt: string;
};

/**
 * Thresholds are policy, not magic numbers: they exist so the UI can refuse to
 * draw a conclusion from one answer.
 */
export const THRESHOLDS = {
  /** Below this many answers an objective gets no hypothesis at all. */
  minAttemptsForHypothesis: 3,
  /** The class as a whole needs this many students before "the class struggles". */
  minStudentsForClassJudgement: 2,
  /** A strength needs a stronger record than a weakness, because praise is a claim too. */
  minAttemptsForStrength: 4,
  strengthAccuracy: 0.8,
  gapAccuracy: 0.6,
} as const;

export type ObjectiveFact = {
  objectiveId: string | null;
  statement: string;
  questions: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
  studentsAttempted: number;
  evidenceState: EvidenceState;
  /** The distractor chosen most often when the answer was wrong. */
  topDistractor: { index: number; text: string; count: number } | null;
  status: "strength" | "gap" | "on-track" | "not-assessed" | "needs-more-evidence";
};

export type StudentFact = {
  studentId: string;
  displayName: string;
  attempts: number;
  correct: number;
  accuracy: number | null;
  objectivesAttempted: number;
};

export type AnalysisFacts = {
  classroom: { id: string; name: string };
  lessons: { id: string; title: string }[];
  totals: {
    answers: number;
    correct: number;
    accuracy: number | null;
    studentsWithAnswers: number;
    questionsAnswered: number;
  };
  objectives: ObjectiveFact[];
  students: StudentFact[];
  evidenceState: EvidenceState;
  insufficientReasons: string[];
  thresholds: typeof THRESHOLDS;
};

export function accuracyOf(correct: number, attempts: number): number | null {
  if (attempts <= 0) return null;
  return Math.round((correct / attempts) * 1000) / 1000;
}

export function evidenceStateFor(attempts: number): EvidenceState {
  if (attempts <= 0) return "none";
  if (attempts < THRESHOLDS.minAttemptsForHypothesis) return "insufficient";
  return "usable";
}

export function objectiveStatus(
  attempts: number,
  accuracy: number | null,
): ObjectiveFact["status"] {
  if (attempts === 0) return "not-assessed";
  if (attempts < THRESHOLDS.minAttemptsForHypothesis) return "needs-more-evidence";
  if (accuracy === null) return "not-assessed";
  if (attempts >= THRESHOLDS.minAttemptsForStrength && accuracy >= THRESHOLDS.strengthAccuracy) return "strength";
  if (accuracy <= THRESHOLDS.gapAccuracy) return "gap";
  return "on-track";
}

function summariseEvidenceState(states: EvidenceState[]): EvidenceState {
  if (states.every((state) => state === "none")) return "none";
  if (states.some((state) => state === "usable")) return "usable";
  return "insufficient";
}

/**
 * Builds the fact sheet for one classroom.
 *
 * `objectives` should already be the approved objectives for the lessons involved;
 * unapproved drafts are never part of a report.
 */
export function buildAnalysisFacts(input: {
  classroom: { id: string; name: string };
  lessons: { id: string; title: string }[];
  objectives: { id: string; statement: string }[];
  questions: QuestionRow[];
  answers: AnswerRow[];
  students: { id: string; displayName: string }[];
}): AnalysisFacts {
  const questionById = new Map(input.questions.map((question) => [question.id, question]));
  const objectiveById = new Map(input.objectives.map((objective) => [objective.id, objective]));

  const perObjective = new Map<string, { attempts: number; correct: number; students: Set<string>; wrongChoices: Map<number, number>; questions: Set<string> }>();
  for (const objective of input.objectives) {
    perObjective.set(objective.id, { attempts: 0, correct: 0, students: new Set(), wrongChoices: new Map(), questions: new Set() });
  }

  const perStudent = new Map<string, { attempts: number; correct: number; objectives: Set<string> }>();
  for (const student of input.students) {
    perStudent.set(student.id, { attempts: 0, correct: 0, objectives: new Set() });
  }

  let totalAnswers = 0;
  let totalCorrect = 0;
  const answeredQuestions = new Set<string>();

  for (const answer of input.answers) {
    const question = questionById.get(answer.questionId);
    const objectiveId = answer.objectiveId ?? question?.objectiveId ?? null;
    totalAnswers += 1;
    answeredQuestions.add(answer.questionId);
    if (answer.isCorrect) totalCorrect += 1;

    const bucket = objectiveId ? perObjective.get(objectiveId) : undefined;
    if (bucket) {
      bucket.attempts += 1;
      bucket.questions.add(answer.questionId);
      if (answer.isCorrect) bucket.correct += 1;
      else bucket.wrongChoices.set(answer.choiceIndex, (bucket.wrongChoices.get(answer.choiceIndex) ?? 0) + 1);
      bucket.students.add(answer.studentId);
    }

    const student = perStudent.get(answer.studentId);
    if (student) {
      student.attempts += 1;
      if (answer.isCorrect) student.correct += 1;
      if (objectiveId) student.objectives.add(objectiveId);
    }
  }

  const objectives: ObjectiveFact[] = input.objectives.map((objective) => {
    const bucket = perObjective.get(objective.id)!;
    const accuracy = accuracyOf(bucket.correct, bucket.attempts);

    let topDistractor: ObjectiveFact["topDistractor"] = null;
    let best = 0;
    for (const [index, count] of bucket.wrongChoices.entries()) {
      if (count > best) {
        best = count;
        const options = input.questions.find((question) => question.objectiveId === objective.id)?.options ?? [];
        topDistractor = { index, text: options[index] ?? "", count };
      }
    }

    return {
      objectiveId: objective.id,
      statement: objectiveById.get(objective.id)?.statement ?? objective.statement,
      questions: bucket.questions.size,
      attempts: bucket.attempts,
      correct: bucket.correct,
      accuracy,
      studentsAttempted: bucket.students.size,
      evidenceState: evidenceStateFor(bucket.attempts),
      topDistractor,
      status: objectiveStatus(bucket.attempts, accuracy),
    };
  });

  const students: StudentFact[] = input.students.map((student) => {
    const bucket = perStudent.get(student.id)!;
    return {
      studentId: student.id,
      displayName: student.displayName,
      attempts: bucket.attempts,
      correct: bucket.correct,
      accuracy: accuracyOf(bucket.correct, bucket.attempts),
      objectivesAttempted: bucket.objectives.size,
    };
  });

  if (students.length === 0) {
    // Fall back to whoever actually answered, so a report is never silently empty.
    students.push(
      ...Array.from(perStudent.entries())
        .filter(([id, bucket]) => bucket.attempts > 0 && !input.students.some((student) => student.id === id))
        .map(([id, bucket]) => ({
          studentId: id,
          displayName: "Student",
          attempts: bucket.attempts,
          correct: bucket.correct,
          accuracy: accuracyOf(bucket.correct, bucket.attempts),
          objectivesAttempted: bucket.objectives.size,
        })),
    );
  }

  const studentsWithAnswers = students.filter((student) => student.attempts > 0).length;
  const evidenceState = summariseEvidenceState(objectives.map((objective) => objective.evidenceState));

  const insufficientReasons: string[] = [];
  if (totalAnswers === 0) {
    insufficientReasons.push("No student has submitted this challenge yet, so there is nothing to analyse.");
  } else {
    if (studentsWithAnswers < THRESHOLDS.minStudentsForClassJudgement) {
      insufficientReasons.push(
        `Only ${studentsWithAnswers} student has answered. Conclusions about the class need at least ${THRESHOLDS.minStudentsForClassJudgement}.`,
      );
    }
    const thin = objectives.filter((objective) => objective.evidenceState === "insufficient");
    if (thin.length > 0) {
      insufficientReasons.push(
        `${thin.length} of ${objectives.length} objectives have fewer than ${THRESHOLDS.minAttemptsForHypothesis} answers, so they can only be reported as needing more evidence.`,
      );
    }
    const untouched = objectives.filter((objective) => objective.evidenceState === "none");
    if (untouched.length > 0) {
      insufficientReasons.push(`${untouched.length} objective${untouched.length === 1 ? " has" : "s have"} no questions answered at all.`);
    }
  }

  return {
    classroom: input.classroom,
    lessons: input.lessons,
    totals: {
      answers: totalAnswers,
      correct: totalCorrect,
      accuracy: accuracyOf(totalCorrect, totalAnswers),
      studentsWithAnswers,
      questionsAnswered: answeredQuestions.size,
    },
    objectives,
    students,
    evidenceState,
    insufficientReasons,
    thresholds: THRESHOLDS,
  };
}
