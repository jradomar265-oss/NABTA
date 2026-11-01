import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/require-role";
import { WorkspaceShell } from "@/components/workspace-shell";

export const dynamic = "force-dynamic";

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const profile = await requireRole("student");

  return (
    <WorkspaceShell role="student" displayName={profile.display_name}>
      {children}
    </WorkspaceShell>
  );
}
