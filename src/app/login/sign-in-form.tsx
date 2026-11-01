"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/actions/auth";

const initialState: SignInState = {};

export function SignInForm({ configured }: { configured: boolean }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="mt-7 space-y-5">
      <label className="block text-sm font-semibold text-[#29483c]">
        Email address
        <input
          autoComplete="username"
          className="mt-2 min-h-12 w-full rounded-lg border border-[#d5dfd4] bg-white px-4 font-normal outline-none transition focus:border-[#1f674a] focus:ring-4 focus:ring-[#1f674a]/10"
          name="email"
          required
          type="email"
        />
      </label>
      <label className="block text-sm font-semibold text-[#29483c]">
        Password
        <input
          autoComplete="current-password"
          className="mt-2 min-h-12 w-full rounded-lg border border-[#d5dfd4] bg-white px-4 font-normal outline-none transition focus:border-[#1f674a] focus:ring-4 focus:ring-[#1f674a]/10"
          name="password"
          required
          type="password"
        />
      </label>
      {state.error && (
        <p aria-live="polite" className="rounded-lg bg-[#fff1e9] px-4 py-3 text-sm text-[#9a4324]">
          {state.error}
        </p>
      )}
      {!configured && (
        <p className="rounded-lg bg-[#edf3e9] px-4 py-3 text-sm leading-6 text-[#496451]">
          Sign-in is not connected yet. Add the Supabase values from your project settings to the local environment file.
        </p>
      )}
      <button
        className="min-h-12 w-full rounded-lg bg-[#1f674a] px-5 text-sm font-bold text-white transition-colors hover:bg-[#174f39] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!configured || pending}
        type="submit"
      >
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
