import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AppRole = "student" | "teacher";

type Profile = {
  display_name: string;
  role: AppRole;
};

export async function requireRole(role: AppRole): Promise<Profile> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/login?setup=required");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) {
    redirect("/login?profile=missing");
  }

  if (profile.role !== role) {
    redirect(profile.role === "teacher" ? "/teacher" : "/student");
  }

  return profile as Profile;
}