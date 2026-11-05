"use client";

import Link from "next/link";
import { WorldHud } from "./Hud";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { markLessonStudied } from "@/app/actions/learning";
import { xpIntoLevel } from "@/lib/learning/xp";
import { clampCamera, fitCamera, screenToWorld, zoomAtPoint, type Camera } from "../systems/camera";
import { createPathSampler } from "../systems/path";
import { drawFrame, type PlayerState } from "../systems/renderer";
import { LAYOUT_URL, NODE_SHEET, PLAYER_SHEET, SPRITE_BASE, type WorldLayout, type WorldQuest } from "../types";

const WALK_SPEED = 0.00022; // path fraction per millisecond

export function StudentWorld({
  level,
  xp,
  quests,
  fullBleed = false,
  displayName,
}: {
  level: number;
  xp: number;
  quests: WorldQuest[];
  displayName: string;
  /** Fill the viewport instead of sitting inside page chrome. */
  fullBleed?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [layout, setLayout] = useState<WorldLayout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const imagesRef = useRef<{
    terrain: HTMLImageElement | null;
    sprites: Map<string, HTMLImageElement>;
    nodeSheet: HTMLImageElement | null;
    playerSheet: HTMLImageElement | null;
  }>({ terrain: null, sprites: new Map(), nodeSheet: null, playerSheet: null });

  const cameraRef = useRef<Camera>({ x: 480, y: 320, zoom: 1.6 });
  const viewRef = useRef({ w: 960, h: 640 });
  const playerRef = useRef<PlayerState>({ x: 296, y: 622, facing: "down", mirrored: false, walking: false, clock: 0 });
  const pathTRef = useRef(0.01);
  const targetTRef = useRef(0.01);
  const reducedMotionRef = useRef(false);
  const draggingRef = useRef(false);
  const dragRef = useRef({ x: 0, y: 0, pointerId: -1 });

  const activeQuest = useMemo(() => {
    const available = quests.find((quest) => quest.status === "available");
    return available ?? quests.find((quest) => quest.status === "studied") ?? quests[0];
  }, [quests]);

  const [selectedSlot, setSelectedSlot] = useState<number | null>(activeQuest?.slot ?? null);
  const [pending, startTransition] = useTransition();

  const sampler = useMemo(() => (layout ? createPathSampler(layout.path) : null), [layout]);

  // Load the authored region and its artwork once.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(LAYOUT_URL, { cache: "force-cache" });
        if (!response.ok) throw new Error(`layout ${response.status}`);
        const body = (await response.json()) as WorldLayout;
        if (cancelled) return;

        const uniqueSprites = Array.from(new Set(body.objects.map((object) => object.sprite)));
        const [terrain, nodeSheet, playerSheet, ...sprites] = await Promise.all([
          loadImage(body.terrain),
          loadImage(NODE_SHEET),
          loadImage(PLAYER_SHEET),
          ...uniqueSprites.map((name) => loadImage(`${SPRITE_BASE}/${body.spriteCatalogue[name].file}`)),
        ]);
        if (cancelled) return;

        const spriteMap = new Map<string, HTMLImageElement>();
        uniqueSprites.forEach((name, index) => spriteMap.set(name, sprites[index]));

        imagesRef.current = { terrain, sprites: spriteMap, nodeSheet, playerSheet };
        setLayout(body);
        setReady(true);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "unknown error");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Place the character and camera once, centred on the current quest.
  const placedRef = useRef(false);
  useEffect(() => {
    if (!layout || !sampler || placedRef.current) return;
    const slot = activeQuest?.slot ?? layout.nodes[0]?.slot ?? 0;
    const node = layout.nodes.find((candidate) => candidate.slot === slot) ?? layout.nodes[0];
    if (!node) return;
    placedRef.current = true;
    pathTRef.current = node.t;
    targetTRef.current = node.t;
    const at = sampler.sample(node.t);
    playerRef.current = { x: at.x, y: at.y, facing: "down", mirrored: false, walking: false, clock: 0 };
    cameraRef.current = fitCamera(viewRef.current.w, viewRef.current.h, layout.width, layout.height, { x: at.x, y: at.y - 40 });
  }, [layout, sampler, activeQuest]);

  // When the next quest opens, walk there instead of jumping.
  useEffect(() => {
    if (!layout || !placedRef.current) return;
    const slot = activeQuest?.slot;
    if (slot === undefined || slot === null) return;
    const node = layout.nodes.find((candidate) => candidate.slot === slot);
    if (node) targetTRef.current = node.t;
  }, [layout, activeQuest]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = media.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Keep the backing store in sync with the CSS box.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      viewRef.current = { w: rect.width, h: rect.height };
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Single animation loop; cleaned up on unmount.
  useEffect(() => {
    if (!ready || !layout) return;
    let frame = 0;
    let previous = performance.now();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const loop = (now: number) => {
      const delta = Math.min(64, now - previous);
      previous = now;

      const player = playerRef.current;
      player.clock += delta;

      const targetT = targetTRef.current;
      const currentT = pathTRef.current;
      if (Math.abs(targetT - currentT) > 0.0004 && sampler) {
        const step = WALK_SPEED * delta * (targetT > currentT ? 1 : -1);
        pathTRef.current = Math.abs(targetT - currentT) < Math.abs(step) ? targetT : currentT + step;
        const at = sampler.sample(pathTRef.current);
        const dx = at.x - player.x;
        const dy = at.y - player.y;
        player.x = at.x;
        player.y = at.y;
        player.walking = true;
        if (Math.abs(dx) > Math.abs(dy) * 1.1) {
          player.facing = "side";
          player.mirrored = dx > 0;
        } else {
          player.facing = dy > 0 ? "down" : "up";
        }
      } else {
        player.walking = false;
      }

      const camera = clampCamera(cameraRef.current, viewRef.current.w, viewRef.current.h, layout.width, layout.height);
      cameraRef.current = camera;

      drawFrame(ctx, {
        layout,
        camera,
        view: viewRef.current,
        terrain: imagesRef.current.terrain,
        sprites: imagesRef.current.sprites,
        nodeSheet: imagesRef.current.nodeSheet,
        playerSheet: imagesRef.current.playerSheet,
        quests,
        selectedSlot,
        player: playerRef.current,
        time: now,
        reducedMotion: reducedMotionRef.current,
      });

      frame = requestAnimationFrame(loop);
    };

    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [ready, layout, quests, selectedSlot, sampler]);

  const selectSlot = useCallback(
    (slot: number) => {
      if (!layout) return;
      setSelectedSlot(slot);
      const node = layout.nodes.find((candidate) => candidate.slot === slot);
      if (node) targetTRef.current = node.t;
    },
    [layout],
  );

  const centerOn = useCallback(
    (x: number, y: number) => {
      cameraRef.current = clampCamera(
        { x, y, zoom: Math.max(1.6, cameraRef.current.zoom) },
        viewRef.current.w,
        viewRef.current.h,
        layout?.width ?? 960,
        layout?.height ?? 640,
      );
    },
    [layout],
  );

  // Pointer pan, click-to-select and pinch zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;

    const onPointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        draggingRef.current = true;
        dragRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
        canvas.setPointerCapture(event.pointerId);
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0) {
          const rect = canvas.getBoundingClientRect();
          const ratio = distance / pinchDistance;
          cameraRef.current = zoomAtPoint(
            cameraRef.current,
            cameraRef.current.zoom * ratio,
            (a.x + b.x) / 2 - rect.left,
            (a.y + b.y) / 2 - rect.top,
            viewRef.current.w,
            viewRef.current.h,
            layout.width,
            layout.height,
          );
        }
        pinchDistance = distance;
        return;
      }

      if (!draggingRef.current) return;
      const dx = event.clientX - dragRef.current.x;
      const dy = event.clientY - dragRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      cameraRef.current = clampCamera(
        { x: cameraRef.current.x - dx / cameraRef.current.zoom, y: cameraRef.current.y - dy / cameraRef.current.zoom, zoom: cameraRef.current.zoom },
        viewRef.current.w,
        viewRef.current.h,
        layout.width,
        layout.height,
      );
      dragRef.current = { ...dragRef.current, x: event.clientX, y: event.clientY };
    };

    const onPointerUp = (event: PointerEvent) => {
      const moved = Math.abs(event.clientX - dragRef.current.x) + Math.abs(event.clientY - dragRef.current.y);
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 0) {
        draggingRef.current = false;
        dragRef.current.pointerId = -1;
        if (moved < 8) {
          const rect = canvas.getBoundingClientRect();
          const point = screenToWorld(cameraRef.current, event.clientX - rect.left, event.clientY - rect.top, viewRef.current.w, viewRef.current.h);
          let closest: { slot: number; distance: number } | null = null;
          for (const node of layout.nodes) {
            const distance = Math.hypot(node.x - point.x, node.y - point.y - 10);
            if (distance < 30 && (!closest || distance < closest.distance)) closest = { slot: node.slot, distance };
          }
          if (closest) selectSlot(closest.slot);
        }
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      cameraRef.current = zoomAtPoint(
        cameraRef.current,
        cameraRef.current.zoom * factor,
        event.clientX - rect.left,
        event.clientY - rect.top,
        viewRef.current.w,
        viewRef.current.h,
        layout.width,
        layout.height,
      );
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [layout, selectSlot]);

  const zoomBy = (factor: number) => {
    if (!layout) return;
    cameraRef.current = zoomAtPoint(
      cameraRef.current,
      cameraRef.current.zoom * factor,
      viewRef.current.w / 2,
      viewRef.current.h / 2,
      viewRef.current.w,
      viewRef.current.h,
      layout.width,
      layout.height,
    );
  };

  const study = (quest: WorldQuest) => {
    startTransition(async () => {
      await markLessonStudied(quest.id);
    });
  };

  const studied = quests.filter((quest) => quest.status === "studied" || quest.status === "completed").length;
  const completed = quests.filter((quest) => quest.status === "completed").length;
  const levelProgress = xpIntoLevel(xp);
  const selected = quests.find((quest) => quest.slot === selectedSlot) ?? null;

  return (
    <div className={fullBleed ? "h-[100dvh] w-full" : "mt-8"}>
      <div className={fullBleed ? "relative h-full w-full overflow-hidden bg-[#1d3b33]" : "relative overflow-hidden rounded-3xl border-4 border-[#284c42] bg-[#1d3b33] shadow-[0_24px_70px_-32px_rgba(15,45,37,0.85)]"}>
        <canvas
          aria-label="NABTA learning world. Use the quest list below the map to move between lessons."
          className={fullBleed ? "block h-full w-full touch-none select-none" : "block aspect-[3/2] w-full touch-none select-none"}
          ref={canvasRef}
          role="img"
        />

        <WorldHud
          completed={completed}
          displayName={displayName}
          level={level}
          levelProgress={levelProgress}
          total={quests.length}
          xp={xp}
        />

        {/* Zoom + recenter controls */}
        <div className="absolute bottom-3 right-3 flex overflow-hidden rounded-lg border-2 border-[#6d8578] bg-[#22343a]/95 text-white sm:bottom-4 sm:right-4">
          <button aria-label="Zoom out" className="size-9 text-lg hover:bg-white/10" onClick={() => zoomBy(1 / 1.15)} type="button">
            −
          </button>
          <button aria-label="Zoom in" className="size-9 border-l border-[#6d8578] text-lg hover:bg-white/10" onClick={() => zoomBy(1.15)} type="button">
            +
          </button>
          <button
            aria-label="Recentre on my current quest"
            className="size-9 border-l border-[#6d8578] text-sm hover:bg-white/10"
            onClick={() => {
              const slot = activeQuest?.slot ?? 0;
              const node = layout?.nodes.find((candidate) => candidate.slot === slot);
              if (node) {
                selectSlot(slot);
                centerOn(node.x, node.y - 30);
              }
            }}
            type="button"
          >
            ◎
          </button>
        </div>

        {!ready && !loadError && (
          <div className="absolute inset-0 grid place-items-center bg-[#1d3b33]/80 text-sm font-semibold text-white">Growing your world…</div>
        )}
        {loadError && (
          <div className="absolute inset-0 grid place-items-center bg-[#1d3b33]/90 px-6 text-center text-sm font-semibold text-white">
            The world could not be loaded ({loadError}). Your lessons are still listed below.
          </div>
        )}
      </div>

      {/* Selected quest */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-[#dce4d8] bg-white p-5">
          {selected ? (
            <>
              <p className="text-xs font-bold uppercase tracking-wide text-[#b65e35]">
                {selected.classroomName} ·{" "}
                {selected.status === "completed"
                  ? "Challenge completed"
                  : selected.status === "studied"
                    ? "Studied"
                    : selected.status === "locked"
                      ? "Locked"
                      : "Ready to study"}
              </p>
              <h2 className="mt-2 text-xl font-bold">{selected.title}</h2>
              {selected.objective && <p className="mt-2 text-sm font-semibold text-[#496451]">Goal: {selected.objective}</p>}
              {selected.challengeQuestions > 0 && (
                <p className="mt-3 rounded-lg bg-[#f3f6ef] px-3 py-2 text-xs font-semibold text-[#3f6249]">
                  {selected.challengeQuestions} challenge question{selected.challengeQuestions === 1 ? "" : "s"} · up to {selected.challengeMaxXp} XP
                </p>
              )}
              <p className="mt-3 text-sm leading-6 text-[#62776d]">
                {selected.status === "locked"
                  ? "Finish the lesson before this one to open this quest."
                  : selected.status === "completed"
                    ? "You have submitted this challenge. You can review your answers and explanations any time."
                    : selected.status === "studied"
                      ? "Studied. Open the challenge to earn XP for what you understood."
                      : "Read the lesson with your teacher, then open the challenge when you are ready."}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  className="min-h-11 rounded-lg bg-[#1f674a] px-5 py-3 text-sm font-bold text-white hover:bg-[#174f39]"
                  href={`/student/quest/${selected.id}`}
                >
                  {selected.status === "completed" ? "Review my results" : selected.challengeQuestions > 0 ? "Open the challenge" : "Open this quest"}
                </Link>
                {selected.status === "available" && (
                  <button
                    className="min-h-11 rounded-lg border border-[#1f674a] px-4 text-sm font-bold text-[#1f674a] hover:bg-[#edf3e9] disabled:opacity-60"
                    disabled={pending}
                    onClick={() => study(selected)}
                    type="button"
                  >
                    {pending ? "Saving…" : "Mark studied only"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-[#62776d]">Select a quest medallion on the map, or pick one from the list.</p>
          )}
        </section>

        <section className="rounded-2xl border border-[#dce4d8] bg-white p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#b65e35]">Your quest path</h2>
          <p className="mt-1 text-xs text-[#62776d]">{studied} studied · {completed} completed</p>
          <ol className="mt-3 space-y-2">
            {quests.map((quest) => (
              <li key={quest.id}>
                <button
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm ${
                    quest.slot === selectedSlot ? "border-[#1f674a] bg-[#edf3e9]" : "border-[#e3eadf] hover:bg-[#f6f8f2]"
                  }`}
                  onClick={() => {
                    selectSlot(quest.slot);
                    const node = layout?.nodes.find((candidate) => candidate.slot === quest.slot);
                    if (node) centerOn(node.x, node.y - 30);
                  }}
                  type="button"
                >
                  <span className="font-semibold text-[#29483c]">{quest.title}</span>
                  <span className="shrink-0 text-xs font-bold text-[#6a7d72]">
                    {quest.status === "completed"
                      ? "Completed"
                      : quest.status === "studied"
                        ? "Studied"
                        : quest.status === "locked"
                          ? "Locked"
                          : "Available"}
                  </span>
                </button>
              </li>
            ))}
            {quests.length === 0 && <li className="text-sm text-[#62776d]">No lessons assigned yet.</li>}
          </ol>
        </section>
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`image failed: ${src}`));
    image.src = src;
  });
}
