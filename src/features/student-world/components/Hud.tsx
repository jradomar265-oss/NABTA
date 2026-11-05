type LevelProgress = { current: number; needed: number };

/**
 * In-world HUD.
 *
 * Extracted from StudentWorld unchanged so screen composition can evolve without
 * touching canvas or camera code. Panels use safe-area insets: on a notched phone the
 * identity panel must clear the notch, and the reference puts it flush to the corner.
 */
export function WorldHud({
  displayName,
  level,
  xp,
  levelProgress,
  completed,
  total,
}: {
  displayName: string;
  level: number;
  xp: number;
  levelProgress: LevelProgress;
  completed: number;
  total: number;
}) {
  const percent = levelProgress.needed > 0 ? Math.round((levelProgress.current / levelProgress.needed) * 100) : 0;

  return (
    <>
      {/* Identity: safe-area aware, top-left in both the reference and here. */}
      <div
        className="pointer-events-none absolute left-3 rounded-xl border-2 border-[#6d8578] bg-[#22343a]/95 px-3 py-2 text-white shadow-lg sm:left-4"
        style={{ top: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
      >
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-lg border border-[#a0d86c] bg-[#376342] text-base">
            🌱
          </span>
          <div>
            <p className="text-sm font-bold tracking-wide">NABTA</p>
            <p className="text-[11px] text-[#cfe3d2]">
              {displayName} · Lv. {level}
            </p>
            <span
              aria-label={`Level progress: ${percent}%`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={percent}
              className="mt-1 block h-2 w-28 overflow-hidden rounded-full bg-black/45"
              role="progressbar"
            >
              <span className="block h-full rounded-full bg-[#91d956]" style={{ width: `${percent}%` }} />
            </span>
            <p className="mt-0.5 text-[10px] text-[#b9d3bd]">{xp} XP</p>
          </div>
        </div>
      </div>

      {/* Progress summary: top-right, mirroring the reference's currency slot. */}
      <div
        className="absolute right-3 flex items-center gap-2 sm:right-4"
        style={{ top: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
      >
        <span className="rounded-xl border-2 border-[#6d8578] bg-[#22343a]/95 px-3 py-2 text-xs font-bold text-white">
          {completed}/{total} completed
        </span>
      </div>
    </>
  );
}
