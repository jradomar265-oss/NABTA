import { assignLesson, createClassroom, createLesson } from "@/app/actions/learning";
import { requireRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveLessonAnalyzer } from "@/lib/ai";
import { LessonObjectivesPanel, type LastRun, type LessonObjective } from "@/features/teacher-studio/components/LessonObjectivesPanel";

type SearchParams = Promise<{ error?: string; notice?: string; detail?: string }>;
type Classroom = { id: string; name: string; join_code: string; classroom_memberships: { count: number }[] };
type Lesson = { id: string; title: string; learning_objective: string; content: string };

const NOTICES: Record<string, string> = {
  "class-created": "Class created.",
  "lesson-saved": "Lesson saved as a teacher draft.",
  "lesson-assigned": "Lesson assigned to the selected class.",
  "objective-generated": "One objective was generated. Review it before students see it.",
  "objectives-generated": "Objectives were generated. Review and approve them before students see them.",
  "objective-saved": "Objective saved.",
  "objective-removed": "Objective removed.",
  "objective-added": "Your objective was added as a draft.",
  "objectives-approved": "All objectives for this lesson are approved.",
};

export default async function TeacherHomePage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("teacher");
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const { data: classrooms } = user && supabase ? await supabase.from("classrooms").select("id, name, join_code, classroom_memberships(count)").eq("teacher_id", user.id).order("created_at", { ascending: false }) : { data: [] };
  const { data: lessons } = user && supabase ? await supabase.from("lessons").select("id, title, learning_objective, content").eq("teacher_id", user.id).order("created_at", { ascending: false }) : { data: [] };
  const { data: objectiveRows } = user && supabase
    ? await supabase
      .from("lesson_objectives")
      .select("id, lesson_id, position, statement, skills, evidence, source, approved")
      .eq("teacher_id", user.id)
      .order("position", { ascending: true })
    : { data: [] };
  const { data: runRows } = user && supabase
    ? await supabase
      .from("agent_runs")
      .select("lesson_id, status, provider, model, duration_ms, objective_count, repaired, error_message, created_at")
      .eq("teacher_id", user.id)
      .eq("kind", "lesson_analysis")
      .order("created_at", { ascending: false })
      .limit(40)
    : { data: [] };

  const objectivesByLesson = new Map<string, LessonObjective[]>();
  for (const row of (objectiveRows ?? []) as (LessonObjective & { lesson_id: string })[]) {
    const list = objectivesByLesson.get(row.lesson_id) ?? [];
    list.push({ id: row.id, position: row.position, statement: row.statement, skills: row.skills ?? [], evidence: row.evidence ?? "", source: row.source, approved: row.approved });
    objectivesByLesson.set(row.lesson_id, list);
  }

  const lastRunByLesson = new Map<string, LastRun>();
  for (const row of (runRows ?? []) as (LastRun & { lesson_id: string | null })[]) {
    if (!row.lesson_id || lastRunByLesson.has(row.lesson_id)) continue;
    lastRunByLesson.set(row.lesson_id, row);
  }

  const { setup } = resolveLessonAnalyzer();
  const notice = params.notice ? NOTICES[params.notice] : undefined;

  return <section className="max-w-6xl">
    <p className="text-sm font-bold uppercase tracking-wide text-[#b65e35]">Teacher studio</p>
    <h1 className="mt-3 text-4xl font-bold">Plan learning with clarity.</h1>
    <p className="mt-4 max-w-2xl text-base leading-7 text-[#62776d]">Create classes, save lesson material, let NABTA propose learning objectives, then approve what students will actually see. Assessments are a later stage.</p>
    {params.error && <p className="mt-6 rounded-lg bg-[#fff1e9] px-4 py-3 text-sm text-[#9a4324]" role="alert">{params.error}{params.detail && <span className="mt-1 block text-xs opacity-80">{params.detail}</span>}</p>}
    {notice && <p className="mt-6 rounded-lg bg-[#edf3e9] px-4 py-3 text-sm text-[#496451]" role="status">{notice}</p>}

    <div className="mt-8 grid gap-6 lg:grid-cols-2">
      <form action={createClassroom} className="rounded-2xl border border-[#dce4d8] bg-white p-6">
        <h2 className="text-xl font-bold">Create a class</h2>
        <p className="mt-2 text-sm leading-6 text-[#62776d]">Students join with the generated code. You will see their membership once they enrol.</p>
        <label className="mt-5 block text-sm font-semibold">Class name
          <input className="mt-2 min-h-11 w-full rounded-lg border border-[#d5dfd4] px-3 font-normal" maxLength={80} name="name" placeholder="Grade 6 Maths — Fractions" required />
        </label>
        <button className="mt-5 min-h-11 rounded-lg bg-[#1f674a] px-5 text-sm font-bold text-white hover:bg-[#174f39]" type="submit">Create class</button>
      </form>

      <form action={createLesson} className="rounded-2xl border border-[#dce4d8] bg-white p-6">
        <h2 className="text-xl font-bold">Create a lesson</h2>
        <label className="mt-4 block text-sm font-semibold">Lesson title
          <input className="mt-2 min-h-11 w-full rounded-lg border border-[#d5dfd4] px-3 font-normal" maxLength={160} name="title" required />
        </label>
        <label className="mt-4 block text-sm font-semibold">Learning objective <span className="font-normal text-[#62776d]">(optional note for the analyser)</span>
          <input className="mt-2 min-h-11 w-full rounded-lg border border-[#d5dfd4] px-3 font-normal" maxLength={500} name="learningObjective" />
        </label>
        <label className="mt-4 block text-sm font-semibold">Lesson content
          <textarea className="mt-2 min-h-32 w-full rounded-lg border border-[#d5dfd4] px-3 py-2 font-normal" maxLength={20000} name="content" placeholder="Paste the lesson material here…" required />
        </label>
        <button className="mt-5 min-h-11 rounded-lg bg-[#1f674a] px-5 text-sm font-bold text-white hover:bg-[#174f39]" type="submit">Save lesson</button>
      </form>
    </div>

    <div className="mt-10 grid gap-8 lg:grid-cols-[0.7fr_1.3fr]">
      <div>
        <h2 className="text-2xl font-bold">Classes</h2>
        {classrooms && classrooms.length > 0
          ? <div className="mt-4 space-y-3">{(classrooms as Classroom[]).map((classroom) => <article className="rounded-xl border border-[#dce4d8] bg-white p-5" key={classroom.id}><h3 className="font-bold">{classroom.name}</h3><p className="mt-2 text-sm text-[#62776d]">Join code: <code className="rounded bg-[#edf3e9] px-2 py-1 font-bold text-[#29483c]">{classroom.join_code}</code></p><p className="mt-3 text-sm text-[#62776d]">{classroom.classroom_memberships?.[0]?.count ?? 0} students joined</p></article>)}</div>
          : <p className="mt-4 rounded-xl border border-dashed border-[#cfdacd] p-5 text-sm text-[#62776d]">Create your first class to generate a student join code.</p>}
      </div>

      <div>
        <h2 className="text-2xl font-bold">Lesson library</h2>
        {lessons && lessons.length > 0
          ? <div className="mt-4 space-y-4">
            {(lessons as Lesson[]).map((lesson) => {
              const objectives = objectivesByLesson.get(lesson.id) ?? [];
              const approved = objectives.filter((objective) => objective.approved).length;
              return <article className="rounded-xl border border-[#dce4d8] bg-white p-5" key={lesson.id}>
                <h3 className="font-bold">{lesson.title}</h3>
                {lesson.learning_objective && <p className="mt-1 text-sm text-[#496451]">Teacher note: {lesson.learning_objective}</p>}
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[#62776d]">{lesson.content}</p>

                {classrooms && classrooms.length > 0 && (
                  <form action={assignLesson} className="mt-4 flex flex-wrap items-center gap-3">
                    <input name="lessonId" type="hidden" value={lesson.id} />
                    <label className="sr-only" htmlFor={`class-${lesson.id}`}>Assign to class</label>
                    <select className="min-h-10 rounded-lg border border-[#d5dfd4] bg-white px-3 text-sm" defaultValue="" id={`class-${lesson.id}`} name="classroomId" required>
                      <option disabled value="">Select a class</option>
                      {(classrooms as Classroom[]).map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}
                    </select>
                    <button className="min-h-10 rounded-lg border border-[#1f674a] px-4 text-sm font-bold text-[#1f674a] hover:bg-[#edf3e9]" type="submit">Assign to class</button>
                  </form>
                )}

                <details className="mt-4 rounded-xl border border-[#e3eadf] bg-white">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-[#29483c]">
                    Learning objectives <span className="font-normal text-[#62776d]">({objectives.length === 0 ? "none yet" : `${approved}/${objectives.length} approved`})</span>
                  </summary>
                  <div className="px-3 pb-3">
                    <LessonObjectivesPanel lessonId={lesson.id} lastRun={lastRunByLesson.get(lesson.id) ?? null} objectives={objectives} setup={setup} />
                  </div>
                </details>
              </article>;
            })}
          </div>
          : <p className="mt-4 rounded-xl border border-dashed border-[#cfdacd] p-5 text-sm text-[#62776d]">Save a lesson, then let NABTA propose learning objectives for you to review.</p>}
      </div>
    </div>
  </section>;
}
