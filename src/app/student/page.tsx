import { joinClassroom, saveStudentOnboarding } from "@/app/actions/learning";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StudentWorld } from "@/features/student-world/components/StudentWorld";
import type { QuestStatus, WorldQuest } from "@/features/student-world/types";

type SearchParams = Promise<{ error?: string; notice?: string }>;
type Membership = { classroom_id: string; classrooms: { name: string } | null };
type LessonRow = { title: string; learning_objective: string; content: string } | null;
type AssignmentRow = {
  id: string;
  classroom_id: string;
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
      .select("id, classroom_id, assigned_at, lessons(title, learning_objective, content), classrooms(name)")
      .order("assigned_at", { ascending: true })
    : { data: [] };
  const { data: studyRows } = user && supabase
    ? await supabase.from("lesson_study_progress").select("assignment_id").eq("student_id", user.id)
    : { data: [] };

  const studied = new Set((studyRows ?? []).map((row) => row.assignment_id as string));
  const assignments = ((assignmentRows ?? []) as AssignmentRow[]).map((assignment) => ({
    id: assignment.id,
    classroomId: assignment.classroom_id,
    lesson: firstRow<LessonRow>(assignment.lessons),
    classroom: firstRow<{ name: string }>(assignment.classrooms),
  }));

  // Quest states are derived server-side: the first unstudied lesson in a class is
  // available, later lessons in that class stay locked, studied lessons are done.
  const nextAvailable = new Set<string>();
  const classWithOpenQuest = new Set<string>();
  for (const assignment of assignments) {
    if (classWithOpenQuest.has(assignment.classroomId)) continue;
    if (!studied.has(assignment.id)) {
      nextAvailable.add(assignment.id);
      classWithOpenQuest.add(assignment.classroomId);
    }
  }

  const quests: WorldQuest[] = assignments.map((assignment, index) => {
    const status: QuestStatus = studied.has(assignment.id)
      ? "studied"
      : nextAvailable.has(assignment.id)
        ? "available"
        : "locked";
    return {
      id: assignment.id,
      slot: index,
      title: assignment.lesson?.title ?? "Lesson",
      objective: assignment.lesson?.learning_objective ?? "",
      classroomName: assignment.classroom?.name ?? "Class lesson",
      status,
      rewardXp: 0,
    };
  });

  const isOnboarded = Boolean(student?.onboarding_completed);
  const level = student?.level ?? 1;
  const xp = student?.xp ?? 0;
  const placeable = quests.slice(0, QUEST_SLOTS);
  const unplaced = quests.length - placeable.length;

  return <section className="max-w-5xl">
    <p className="text-sm font-bold uppercase tracking-wide text-[#b65e35]">My learning world</p>
    <h1 className="mt-3 text-4xl font-bold">Welcome{isOnboarded ? ` back, ${student?.display_name ?? profile.display_name}` : " to NABTA"}.</h1>
    <p className="mt-4 max-w-2xl text-base leading-7 text-[#62776d]">Your path grows from the lessons your teacher assigns—not from time spent clicking around.</p>
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
        <StudentWorld displayName={student?.display_name ?? profile.display_name} level={level} quests={placeable} xp={xp} xpToNext={100 * level} />
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
