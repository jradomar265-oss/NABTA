import Link from "next/link";
import { SignInForm } from "@/app/login/sign-in-form";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-[#f7f8f2] text-[#18372e] lg:grid-cols-[1fr_1fr]">
      <section className="flex flex-col justify-between bg-[#1f674a] px-7 py-8 text-white sm:px-12 lg:px-16">
        <Link aria-label="NABTA home" className="flex w-fit items-center gap-3" href="/">
          <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-white/15 text-lg font-bold">N</span>
          <span className="text-xl font-bold">NABTA</span>
        </Link>
        <div className="max-w-lg py-16 lg:py-0">
          <p className="mb-5 text-sm font-bold uppercase text-[#f2c879]">Learn. Play. Grow.</p>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">Good to have you back.</h1>
          <p className="mt-5 max-w-md leading-7 text-white/80">Continue your learning journey, one meaningful step at a time.</p>
        </div>
        <p className="text-xs text-white/65">A student-first learning platform</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <p className="text-sm font-semibold text-[#b65e35]">WELCOME TO NABTA</p>
          <h2 className="mt-3 text-3xl font-bold">Sign in to continue</h2>
          <p className="mt-3 text-sm leading-6 text-[#62776d]">Use the account provided by your school or classroom.</p>
          <SignInForm configured={isSupabaseConfigured()} />
          <p className="mt-6 text-xs leading-5 text-[#73847b]">Need access? Ask your teacher or school administrator.</p>
        </div>
      </section>
    </main>
  );
}