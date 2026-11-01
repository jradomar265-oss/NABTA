import type { Camera } from "./camera";
import type { QuestStatus, WorldLayout, WorldQuest } from "../types";

export type PlayerState = {
  x: number;
  y: number;
  facing: "down" | "side" | "up";
  mirrored: boolean;
  walking: boolean;
  /** animation clock in ms */
  clock: number;
};

export type FrameInput = {
  layout: WorldLayout;
  camera: Camera;
  view: { w: number; h: number };
  terrain: HTMLImageElement | null;
  sprites: Map<string, HTMLImageElement>;
  nodeSheet: HTMLImageElement | null;
  playerSheet: HTMLImageElement | null;
  quests: WorldQuest[];
  selectedSlot: number | null;
  player: PlayerState;
  time: number;
  reducedMotion: boolean;
};

const NODE_CELL_W = 32;
const NODE_CELL_H = 36;
const PLAYER_W = 16;
const PLAYER_H = 24;
const NODE_STATUS_CELL: Record<QuestStatus, number> = { available: 0, studied: 2, locked: 3 };

export function nodeFrame(quest: WorldQuest | undefined, selected: boolean): number {
  if (!quest) return 3;
  if (quest.status === "locked") return 3;
  if (selected && quest.status === "available") return 1;
  return NODE_STATUS_CELL[quest.status];
}
export function playerFrame(player: PlayerState): { sx: number; sy: number; flip: boolean } {
  const row = player.facing === "down" ? 0 : player.facing === "side" ? 1 : 2;
  const step = Math.floor(player.clock / 130) % 4;
  const column = player.walking ? 2 + step : Math.floor(player.clock / 460) % 2;
  return { sx: column * PLAYER_W, sy: row * PLAYER_H, flip: player.facing === "side" && player.mirrored };
}

export function drawFrame(ctx: CanvasRenderingContext2D, input: FrameInput) {
  const { layout, camera, view, terrain, sprites, nodeSheet, playerSheet, quests, selectedSlot, time, reducedMotion } = input;
  const dpr = view.w > 0 ? ctx.canvas.width / view.w : 1;
  const cssW = view.w;
  const cssH = view.h;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingEnabled = false;

  const scale = dpr * camera.zoom;
  const offsetX = (cssW / 2 - camera.x * camera.zoom) * dpr;
  const offsetY = (cssH / 2 - camera.y * camera.zoom) * dpr;
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  if (terrain) {
    ctx.drawImage(terrain, 0, 0);
  } else {
    ctx.fillStyle = "#2f7a45";
    ctx.fillRect(0, 0, layout.width, layout.height);
  }

  type Drawable = { sortY: number; draw: () => void };
  const drawables: Drawable[] = [];

  for (const object of layout.objects) {
    const image = sprites.get(object.sprite);
    if (!image) continue;
    drawables.push({
      sortY: object.sortY,
      draw: () => {
        const x = object.x;
        const y = object.y;
        const dx = Math.round(x - object.w / 2);
        const dy = Math.round(y - object.h + 2);
        if (object.flipX) {
          ctx.save();
          ctx.translate(x, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(image, Math.round(-object.w / 2), dy, object.w, object.h);
          ctx.restore();
        } else {
          ctx.drawImage(image, dx, dy, object.w, object.h);
        }
      },
    });
  }

  layout.nodes.forEach((slot) => {
    const quest = quests.find((candidate) => candidate.slot === slot.slot);
    // A slot with no assigned lesson draws nothing: an empty world should not
    // advertise padlocks for quests that do not exist.
    if (!quest) return;
    const selected = selectedSlot === slot.slot;
    const cell = nodeFrame(quest, selected);
    drawables.push({
      sortY: slot.y + 2,
      draw: () => {
        if (selected && !reducedMotion) {
          const pulse = 1 + Math.sin(time / 320) * 0.12;
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = "#fdf3c8";
          ctx.beginPath();
          ctx.ellipse(slot.x, slot.y - 6, 24 * pulse, 9 * pulse, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        if (nodeSheet) {
          ctx.drawImage(
            nodeSheet,
            cell * NODE_CELL_W,
            0,
            NODE_CELL_W,
            NODE_CELL_H,
            Math.round(slot.x - NODE_CELL_W / 2),
            Math.round(slot.y - NODE_CELL_H + 4),
            NODE_CELL_W,
            NODE_CELL_H,
          );
        }
      },
    });
  });

  const player = input.player;
  drawables.push({
    sortY: player.y,
    draw: () => {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#12301f";
      ctx.beginPath();
      ctx.ellipse(player.x, player.y - 1, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (!playerSheet) return;
      const frame = playerFrame(player);
      ctx.save();
      if (frame.flip) {
        ctx.translate(player.x, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(playerSheet, frame.sx, frame.sy, PLAYER_W, PLAYER_H, Math.round(-PLAYER_W / 2), Math.round(player.y - PLAYER_H + 1), PLAYER_W, PLAYER_H);
      } else {
        ctx.drawImage(playerSheet, frame.sx, frame.sy, PLAYER_W, PLAYER_H, Math.round(player.x - PLAYER_W / 2), Math.round(player.y - PLAYER_H + 1), PLAYER_W, PLAYER_H);
      }
      ctx.restore();
    },
  });

  drawables.sort((a, b) => a.sortY - b.sortY);
  for (const drawable of drawables) drawable.draw();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
