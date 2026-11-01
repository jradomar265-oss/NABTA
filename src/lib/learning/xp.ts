/**
 * Display mirror of the database XP rules.
 *
 * The authoritative implementation is `public.xp_for_questions` /
 * `public.level_for_xp` in `202611010006_stage6_study_quests.sql`. These copies
 * exist only so the UI can label rewards before a submission exists; they are
 * asserted against the same expected values by `npm run check:world`.
 */

export function xpForQuestions(correct: number, total: number): number {
  if (total <= 0 || correct <= 0) return 0;
  if (correct >= total) return total * 6 + 10;
  return correct * 6;
}

export function levelForXp(xp: number): number {
  return Math.max(1, 1 + Math.floor(Math.max(0, xp) / 100));
}

/** XP remaining before the next level, for the HUD progress bar. */
export function xpIntoLevel(xp: number): { current: number; needed: number } {
  const safe = Math.max(0, xp);
  const level = levelForXp(safe);
  const floor = (level - 1) * 100;
  return { current: safe - floor, needed: 100 };
}
