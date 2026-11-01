import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f8f2] text-[#18372e]">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
        <Link aria-label="NABTA home" className="flex items-center gap-3" href="/">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-[#1f674a] text-lg font-bold text-white">N</span>
          <span className="text-xl font-bold">NABTA</span>
        </Link>
        <Link className="text-sm font-semibold text-[#1f674a] underline-offset-4 hover:underline" href="/login">
          Sign in
        </Link>
      </header>
      <section className="mx-auto grid min-h-[calc(100vh-88px)] max-w-6xl content-center gap-12 px-6 pb-16 pt-8 sm:px-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="max-w-xl">
          <p className="mb-5 text-sm font-bold uppercase text-[#b65e35]">Learn. Play. Grow.</p>
          <h1 className="max-w-lg text-5xl font-bold leading-[1.05] sm:text-6xl">A little progress grows into a lot.</h1>
          <p className="mt-6 max-w-md text-lg leading-8 text-[#4c655b]">
            A student-first place to learn with purpose, build confidence, and see how far you have come.
          </p>
          <Link className="mt-9 inline-flex min-h-12 items-center justify-center rounded-lg bg-[#1f674a] px-6 text-sm font-bold text-white transition-colors hover:bg-[#174f39]" href="/login">
            Enter NABTA
          </Link>
        </div>
        <div className="relative min-h-64 overflow-hidden rounded-2xl border border-[#dce4d8] bg-white p-7 shadow-[0_20px_60px_-40px_rgba(24,55,46,0.5)] sm:p-9">
          <div className="absolute -right-8 -top-8 size-36 rounded-full bg-[#e7f0d9]" aria-hidden="true" />
          <div className="relative">
            <p className="text-sm font-semibold text-[#4c655b]">Your learning journey</p>
            <div className="mt-8 flex items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#f4d7a4] text-sm font-bold" aria-hidden="true">01</span>
              <div>
                <p className="font-bold">One step at a time</p>
                <p className="mt-1 text-sm text-[#62776d]">Lessons, practice, and meaningful progress.</p>
              </div>
            </div>
            <div className="mt-7 border-t border-[#e5ebe1] pt-5">
              <p className="text-sm font-bold">Progress follows what you learn.</p>
              <p className="mt-2 text-sm text-[#62776d]">Every step is meant to build understanding.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
