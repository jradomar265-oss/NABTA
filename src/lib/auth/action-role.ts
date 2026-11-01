import { redirect } from "next/navigation";

import type { AppRole } from "@/lib/auth/require-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server-side role gate for server actions.
 *
 * Route layouts are not enough on their own: every mutating action re-checks the
 * signed-in user and their database role before touching data.
 */
export async function requireActionRole(role: AppRole) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?setup=required");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role !== role) redirect(role === "teacher" ? "/student" : "/teacher");

  return { supabase, user };
}
