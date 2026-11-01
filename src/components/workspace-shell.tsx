import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import type { AppRole } from "@/lib/auth/require-role";

export function WorkspaceShell({
  role,
  displayName,
  children,
}: {
  role: AppRole;
  displayName: string;
  children: React.ReactNode;
}) {
  const title = role === "teacher" ? "Teacher workspace" : "My learning world";

  return (
    <div className="min-h-screen bg-[#f7f8f2] text-[#18372e]">
      <header className="border-b border-[#e1e8dd] bg-white">
        <div className="mx-auto flex min-h-18 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link aria-label="NABTA home" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#1f674a] text-lg font-bold text-white" href="/">
              N
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{title}</p>
              <p className="truncate text-xs text-[#6a7d72]">{displayName}</p>
            </div>
          </div>
          <form action={signOut}>
            <button className="min-h-10 rounded-lg border border-[#d5dfd4] px-4 text-sm font-semibold text-[#29483c] transition-colors hover:bg-[#f3f6ef]" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">{children}</main>
    </div>
  );
}
