export type WorldPoint = { x: number; y: number };

export type WorldObject = {
  id: string;
  sprite: string;
  x: number;
  y: number;
  w: number;
  h: number;
  flipX: boolean;
  scale: number;
  sortY: number;
  shadow: boolean;
  layer: string;
};

export type WorldNodeSlot = {
  slot: number;
  t: number;
  x: number;
  y: number;
};

export type WorldLayout = {
  region: string;
  width: number;
  height: number;
  tile: number;
  terrain: string;
  path: WorldPoint[];
  pathHalfWidth: number;
  nodes: WorldNodeSlot[];
  spawn: WorldPoint;
  objects: WorldObject[];
  bridge: { x: number; y: number; w: number; h: number };
  spriteCatalogue: Record<string, { file: string; w: number; h: number }>;
  generated: string;
};

/**
 * `locked` and `available` are derived from classroom sequence order, `studied`
 * comes from a persisted `lesson_study_progress` row. Mastery completion is not
 * represented yet because no graded evidence exists in this stage.
 */
export type QuestStatus = "locked" | "available" | "studied";

export type WorldQuest = {
  id: string;
  slot: number;
  title: string;
  objective: string;
  classroomName: string;
  status: QuestStatus;
  rewardXp: number;
  /** Published challenge questions for this lesson. Answering arrives in Stage 6. */
  challengeQuestions: number;
};

export const SPRITE_BASE = "/assets/nabta/world/sprites/approved/forest_demo_objects";
export const NODE_SHEET = "/assets/nabta/world/generated/structures/quest-node-sheet.png";
export const PLAYER_SHEET = "/assets/nabta/world/characters/player/player-sheet.png";
export const LAYOUT_URL = "/assets/nabta/world/regions/forest-clearing/decor.json";
