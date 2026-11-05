import { joinClassroom, saveStudentOnboarding } from "@/app/actions/learning";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StudentWorld } from "@/features/student-world/components/StudentWorld";
import { buildWorldQuests } from "@/lib/world/loader";

type SearchParams = Promise<{ error?: string; notice?: string }>;
type Membership = { classroom_id: string; classrooms: { name: string } | null };
type LessonRow = { title: string; learning_objective: string; content: string } | null;
type AssignmentRow = {
  id: string;
  classroom_id: string;
  lesson_id: string;
  lessons: LessonRow | LessonRow[] | null;
  classrooms: { name: string } | null | { name: string }[];
};

/** How many quest medallions the authored region has room for. */
const QUEST_SLOTS = 6;

/** Supabase embeds arrive as an object or a one-element array; normalise. */
function firstRow<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function StudentHomePage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole("student");
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const { data: student } = user && supabase
    ? await supabase.from("profiles").select("display_name, xp, level, avatar_key, onboarding_completed").eq("id", user.id).maybeSingle()
    : { data: null };
  const { data: memberships } = user && supabase
    ? await supabase.from("classroom_memberships").select("classroom_id, classrooms(name)").eq("student_id", user.id)
    : { data: [] };
  const { data: assignmentRows } = user && supabase
    ? await supabase
      .from("lesson_assignments")
      .select("id, classroom_id, lesson_id, assigned_at, lessons(title, learning_objective, content), classrooms(name)")
      .order("assigned_at", { ascending: true })
    : { data: [] };
  const { data: studyRows } = user && supabase
    ? await supabase.from("lesson_study_progress").select("assignment_id").eq("student_id", user.id)
    : { data: [] };
  // Only teacher-approved objectives are visible here; RLS enforces the same rule.
  const { data: objectiveRows } = user && supabase
    ? await supabase.from("lesson_objectives").select("id, lesson_id, statement").eq("approved", true).order("position", { ascending: true })
    : { data: [] };
  // Only published challenges count here; targeted practice and follow-up checks are
  // separate assessments with their own kind (Stage 8).
  const { data: assessmentRows } = user && supabase
    ? await supabase.from("assessments").select("id, lesson_id").eq("status", "published").eq("kind", "challenge")
    : { data: [] };
  const { data: questionRows } = user && supabase
    ? await supabase.from("questions").select("assessment_id")
    : { data: [] };
  const { data: submissionRows } = user && supabase
    ? await supabase.from("submissions").select("id, assessment_id, score, total").eq("student_id", user.id)
    : { data: [] };
  const { data: achievementRows } = user && supabase
    ? await supabase.from("achievements").select("code, earned_at").eq("student_id", user.id).order("earned_at", { ascending: true })
    : { data: [] };

  // Their own answers, per objective. Facts only: no model is involved in this summary.
  const submissionIds = ((submissionRows ?? []) as { id: string }[]).map((row) => row.id);
  const { data: ownAnswerRows } = submissionIds.length && supabase
    ? await supabase.from("student_answers").select("question_id, is_correct").in("submission_id", submissionIds)
    : { data: [] };
  const ownQuestionIds = Array.from(new Set(((ownAnswerRows ?? []) as { question_id: string }[]).map((row) => row.question_id)));
  const { data: ownQuestionRows } = ownQuestionIds.length && supabase
    ? await supabase.from("questions").select("id, objective_id").in("id", ownQuestionIds)
    : { data: [] };
  const objectiveIdByQuestion = new Map(((ownQuestionRows ?? []) as { id: string; objective_id: string | null }[]).map((row) => [row.id, row.objective_id]));
  const statementByObjectiveId = new Map(((objectiveRows ?? []) as { id: string; statement: string }[]).map((row) => [row.id, row.statement]));

  const objectiveProgress = new Map<string, { correct: number; total: number }>();
  for (const answer of (ownAnswerRows ?? []) as { question_id: string; is_correct: boolean }[]) {
    const objectiveId = objectiveIdByQuestion.get(answer.question_id);
    if (!objectiveId) continue;
    const bucket = objectiveProgress.get(objectiveId) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (answer.is_correct) bucket.correct += 1;
    objectiveProgress.set(objectiveId, bucket);
  }
  const objectiveSummary = Array.from(objectiveProgress.entries())
    .map(([objectiveId, counts]) => ({ statement: statementByObjectiveId.get(objectiveId) ?? "", ...counts }))
    .filter((entry) => entry.statement && entry.total > 0)
    .slice(0, 6);

  const challengeCountByLesson = new Map<string, number>();
  {
    const questionsPerAssessment = new Map<string, number>();
    for (const row of (questionRows ?? []) as { assessment_id: string }[]) {
      questionsPerAssessment.set(row.assessment_id, (questionsPerAssessment.get(row.assessment_id) ?? 0) + 1);
    }
    for (const row of (assessmentRows ?? []) as { id: string; lesson_id: string }[]) {
      challengeCountByLesson.set(row.lesson_id, questionsPerAssessment.get(row.id) ?? 0);
    }
  }

  // A lesson is completed once the student has a graded submission for its challenge.
  const completedLessonIds = new Set<string>();
  {
    const submittedAssessments = new Set(((submissionRows ?? []) as { assessment_id: string }[]).map((row) => row.assessment_id));
    for (const row of (assessmentRows ?? []) as { id: string; lesson_id: string }[]) {
      if (submittedAssessments.has(row.id)) completedLessonIds.add(row.lesson_id);
    }
  }

  const approvedObjectiveByLesson = new Map<string, string>();
  for (const row of (objectiveRows ?? []) as { lesson_id: string; statement: string }[]) {
    if (!approvedObjectiveByLesson.has(row.lesson_id)) approvedObjectiveByLesson.set(row.lesson_id, row.statement);
  }

  const studied = new Set((studyRows ?? []).map((row) => row.assignment_id as string));
  const assignments = ((assignmentRows ?? []) as AssignmentRow[]).map((assignment) => ({
    id: assignment.id,
    classroomId: assignment.classroom_id,
    lessonId: assignment.lesson_id,
    lesson: firstRow<LessonRow>(assignment.lessons),
    classroom: firstRow<{ name: string }>(assignment.classrooms),
    objective: approvedObjectiveByLesson.get(assignment.lesson_id) ?? "",
  }));

  // World slots come from world_locations.sort_order. The whole progression derivation
  // now lives in the loader, so the page only supplies facts. A failed or empty
  // locations query degrades to array order rather than an empty world.
  const { data: locationRows } = supabase
    ? await supabase.from("world_locations").select("sort_order").order("sort_order", { ascending: true })
    : { data: null };

  const quests = buildWorldQuests({
    locationOrder: ((locationRows ?? []) as { sort_order: number }[]).map((row) => row.sort_order),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      classroomId: assignment.classroomId,
      lessonId: assignment.lessonId,
      title: assignment.lesson?.title ?? "Lesson",
      objective: assignment.objective || assignment.lesson?.learning_objective || "",
      classroomName: assignment.classroom?.name ?? "Class lesson",
      questions: challengeCountByLesson.get(assignment.lessonId) ?? 0,
      studied: studied.has(assignment.id),
      completed: completedLessonIds.has(assignment.lessonId),
    })),
  });

  const isOnboarded = Boolean(student?.onboarding_completed);
  const level = student?.level ?? 1;
  const xp = student?.xp ?? 0;
  const placeable = quests.slice(0, QUEST_SLOTS);
  const unplaced = quests.length - placeable.length;

  return <section className="max-w-5xl">
    <p className="text-sm font-bold uppercase tracking-wide text-[#b65e35]">My learning world</p>
    <h1 className="mt-3 text-4xl font-bold">Welcome{isOnboarded ? ` back, ${student?.display_name ?? profile.display_name}` : " to NABTA"}.</h1>
    <p className="mt-4 max-w-2xl text-base leading-7 text-[#62776d]">Your path grows from the lessons your teacher assigns — not from time spent clicking around.</p>
    {params.error && <p className="mt-6 rounded-lg bg-[#fff1e9] px-4 py-3 text-sm text-[#9a4324]" role="alert">{params.error}</p>}
    {params.notice && <p className="mt-6 rounded-lg bg-[#edf3e9] px-4 py-3 text-sm text-[#496451]" role="status">{params.notice === "class-joined" ? "Class joined. Your assigned lessons will appear below." : "Your learning profile is saved."}</p>}
    {!isOnboarded
      ? <form action={saveStudentOnboarding} className="mt-8 max-w-xl rounded-2xl border border-[#dce4d8] bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">Set up your learner profile</h2>
        <p className="mt-2 text-sm leading-6 text-[#62776d]">Choose a saved learner marker before entering your world.</p>
        <label className="mt-5 block text-sm font-semibold">What should we call you?
          <input className="mt-2 min-h-11 w-full rounded-lg border border-[#d5dfd4] px-3 font-normal" defaultValue={profile.display_name} maxLength={80} name="displayName" required />
        </label>
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold">Choose a marker</legend>
          <div className="mt-3 flex gap-3">
            {[{ value: "sprout", label: "Sprout", icon: "♣" }, { value: "sun", label: "Sun", icon: "☀" }, { value: "leaf", label: "Leaf", icon: "◆" }].map((avatar) => (
              <label className="cursor-pointer rounded-lg border border-[#d5dfd4] px-4 py-3 text-center has-[:checked]:border-[#1f674a] has-[:checked]:bg-[#edf3e9]" key={avatar.value}>
                <input className="sr-only" defaultChecked={avatar.value === "sprout"} name="avatarKey" type="radio" value={avatar.value} />
                <span aria-hidden="true" className="block text-xl">{avatar.icon}</span>
                <span className="mt-1 block text-xs font-bold">{avatar.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="mt-6 min-h-11 rounded-lg bg-[#1f674a] px-5 text-sm font-bold text-white hover:bg-[#174f39]" type="submit">Enter my learning space</button>
      </form>
      : <>
        <StudentWorld displayName={student?.display_name ?? profile.display_name} fullBleed level={level} quests={placeable} xp={xp} />
        <ProgressSummary
          achievements={(achievementRows ?? []) as { code: string; earned_at: string }[]}
          completed={quests.filter((quest) => quest.status === "completed").length}
          level={level}
          objectiveSummary={objectiveSummary}
          studied={quests.filter((quest) => quest.status === "studied" || quest.status === "completed").length}
          total={quests.length}
          xp={xp}
        />
        {unplaced > 0 && <p className="mt-4 rounded-xl border border-dashed border-[#cfdacd] px-4 py-3 text-sm text-[#62776d]">{unplaced} more assigned lesson{unplaced === 1 ? "" : "s"} {unplaced === 1 ? "does" : "do"} not fit the current region’s {QUEST_SLOTS} quest landmarks yet; {unplaced === 1 ? "it stays" : "they stay"} reachable from the quest list under the map.</p>}
      </>}
    <div className="mt-10 grid gap-8 lg:grid-cols-[0.7fr_1.3fr]">
      <aside className="rounded-2xl border border-[#dce4d8] bg-white p-6">
        <h2 className="text-lg font-bold">Your classes</h2>
        {memberships && memberships.length > 0
          ? <ul className="mt-4 space-y-2 text-sm text-[#496451]">{(memberships as Membership[]).map((membership) => <li className="rounded-lg bg-[#f3f6ef] px-3 py-2" key={membership.classroom_id}>{membership.classrooms?.name}</li>)}</ul>
          : <>
            <p className="mt-2 text-sm leading-6 text-[#62776d]">Join your teacher’s class to receive lessons.</p>
            <form action={joinClassroom} className="mt-4">
              <label className="text-sm font-semibold">Class code
                <input className="mt-2 min-h-11 w-full rounded-lg border border-[#d5dfd4] px-3 uppercase" maxLength={6} name="code" placeholder="ABC123" required />
              </label>
              <button className="mt-3 min-h-10 rounded-lg border border-[#1f674a] px-4 text-sm font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">Join class</button>
            </form>
          </>}
      </aside>
      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-bold">Your lessons</h2>
          <span className="text-sm text-[#62776d]">{assignments.length} assigned</span>
        </div>
        {assignments.length > 0
          ? <div className="mt-4 space-y-4">
            {assignments.map((assignment) => (
              <article className="rounded-2xl border border-[#dce4d8] bg-white p-6" key={assignment.id}>
                <p className="text-xs font-bold uppercase tracking-wide text-[#b65e35]">{assignment.classroom?.name ?? "Class lesson"}</p>
                <h3 className="mt-2 text-xl font-bold">{assignment.lesson?.title}</h3>
                {assignment.lesson?.learning_objective && <p className="mt-2 text-sm font-semibold text-[#496451]">Goal: {assignment.lesson.learning_objective}</p>}
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#62776d]">{assignment.lesson?.content}</p>
              </article>
            ))}
          </div>
          : <div className="mt-4 rounded-2xl border border-dashed border-[#cfdacd] p-6 text-sm leading-6 text-[#62776d]">No lessons assigned yet. Once your teacher assigns a lesson it appears on your path as a quest.</div>}
      </div>
    </div>
  </section>;
}

const ACHIEVEMENTS: Record<string, { title: string; description: string }> = {
  first_quest: { title: "First Quest", description: "Submitted your first challenge." },
  perfect_score: { title: "Perfect Score", description: "Every answer correct on a challenge." },
  steady_learner: { title: "Steady Learner", description: "Completed three different challenges." },
};

/** Student Home summary: real counts and server-recorded achievements only. */
function ProgressSummary({
  level,
  xp,
  studied,
  completed,
  total,
  achievements,
  objectiveSummary,
}: {
  level: number;
  xp: number;
  studied: number;
  completed: number;
  total: number;
  achievements: { code: string; earned_at: string }[];
  objectiveSummary: { statement: string; correct: number; total: number }[];
}) {
  const intoLevel = Math.max(0, xp) % 100;
  return <div className="mt-4 grid gap-4 lg:grid-cols-2">
    <section className="rounded-2xl border border-[#dce4d8] bg-white p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[#b65e35]">Your progress</h2>
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-[#f3f6ef] px-2 py-3">
          <p className="text-xl font-bold text-[#29483c]">{level}</p>
          <p className="text-[11px] font-semibold text-[#6a7d72]">Level</p>
        </div>
        <div className="rounded-lg bg-[#f3f6ef] px-2 py-3">
          <p className="text-xl font-bold text-[#29483c]">{xp}</p>
          <p className="text-[11px] font-semibold text-[#6a7d72]">Total XP</p>
        </div>
        <div className="rounded-lg bg-[#f3f6ef] px-2 py-3">
          <p className="text-xl font-bold text-[#29483c]">{completed}</p>
          <p className="text-[11px] font-semibold text-[#6a7d72]">Challenges done</p>
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#6a7d72]">
          <span>{intoLevel} / 100 XP to level {level + 1}</span>
          <span>{studied} of {total} lessons started</span>
        </div>
        <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-[#e8eee3]">
          <span className="block h-full rounded-full bg-[#7cbf5a]" style={{ width: `${intoLevel}%` }} />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#62776d]">XP is awarded once per challenge and is calculated on the server. Understanding earns more than speed.</p>
      {objectiveSummary.length > 0 && (
        <div className="mt-4 border-t border-[#eef2ea] pt-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#6a7d72]">What your answers show</h3>
          <ul className="mt-2 space-y-1 text-xs text-[#496451]">
            {objectiveSummary.map((entry) => (
              <li className="flex items-start justify-between gap-3" key={entry.statement}>
                <span>{entry.statement}</span>
                <span className="shrink-0 font-bold text-[#29483c]">{entry.correct}/{entry.total}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-4 text-[#7b8c81]">Counted from your own submitted answers. A few answers describe practice, not ability.</p>
        </div>
      )}
    </section>

    <section className="rounded-2xl border border-[#dce4d8] bg-white p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[#b65e35]">Achievements</h2>
      {achievements.length === 0
        ? <p className="mt-3 text-sm text-[#62776d]">Nothing yet. Complete a challenge to earn your first badge.</p>
        : <ul className="mt-3 space-y-2">
          {achievements.map((achievement) => {
            const meta = ACHIEVEMENTS[achievement.code] ?? { title: achievement.code, description: "" };
            return <li className="rounded-lg border border-[#e3eadf] px-3 py-2" key={achievement.code}>
              <p className="text-sm font-bold text-[#29483c]">{meta.title}</p>
              <p className="text-xs text-[#6a7d72]">{meta.description}</p>
            </li>;
          })}
        </ul>}
    </section>
  </div>;
}
