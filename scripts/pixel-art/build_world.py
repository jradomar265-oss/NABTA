"""Compose the NABTA learning-world region from the approved pixel art.

Everything here is deterministic: the same inputs always produce the same PNG and
JSON, so the world can be reviewed, diffed and rebuilt.

Outputs:
    public/assets/nabta/world/regions/forest-clearing/terrain.png   static ground layer
    public/assets/nabta/world/regions/forest-clearing/decor.json     object + node layout
    public/assets/nabta/world/previews/world-preview.png             review render

Terrain layers, bottom to top: grass, cliff band, water, banks, bridge, learning
path. Objects, quest nodes and the character stay separate so the renderer can
depth-sort them against the character at run time.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
WORLD = REPO / "public" / "assets" / "nabta" / "world"
PLAINS = WORLD / "terrain" / "plains"
APPROVED = WORLD / "sprites" / "approved" / "forest_demo_objects"
REGION = WORLD / "regions" / "forest-clearing"
PREVIEWS = WORLD / "previews"

TILE = 16
W, H = 960, 640

# --- approved sprite catalogue ------------------------------------------------
SPRITES = {
    "tree":      {"file": "region_018.png", "w": 61, "h": 85},
    "stump":     {"file": "region_017.png", "w": 33, "h": 17},
    "planks":    {"file": "region_019.png", "w": 45, "h": 17},
    "bush_a":    {"file": "region_009.png", "w": 16, "h": 17},
    "bush_berry": {"file": "region_010.png", "w": 17, "h": 16},
    "bush_red":  {"file": "region_011.png", "w": 15, "h": 17},
    "bush_b":    {"file": "region_012.png", "w": 15, "h": 16},
    "rock_a":    {"file": "region_001.png", "w": 16, "h": 16},
    "rock_b":    {"file": "region_002.png", "w": 16, "h": 16},
    "rock_big":  {"file": "region_006.png", "w": 31, "h": 30},
    "rock_flat": {"file": "region_005.png", "w": 19, "h": 10},
    "pebble":    {"file": "region_013.png", "w": 11, "h": 9},
    "stones":    {"file": "region_016.png", "w": 17, "h": 12},
    "rock_med":  {"file": "region_021.png", "w": 14, "h": 13},
    "sprout":    {"file": "region_008.png", "w": 17, "h": 14},
    "tufts":     {"file": "region_015.png", "w": 15, "h": 16},
    "leaves":    {"file": "region_022.png", "w": 17, "h": 14},
    "clover":    {"file": "region_031.png", "w": 15, "h": 14},
    "sunflower": {"file": "region_030.png", "w": 14, "h": 17},
    "flower_y":  {"file": "region_034.png", "w": 15, "h": 17},
    "flower_p":  {"file": "region_035.png", "w": 15, "h": 16},
    "mushroom_p": {"file": "region_023.png", "w": 15, "h": 17},
    "mushroom_t": {"file": "region_024.png", "w": 15, "h": 16},
    "berries":   {"file": "region_033.png", "w": 14, "h": 16},
    "fence":     {"file": "region_028.png", "w": 41, "h": 18},
    "post":      {"file": "region_029.png", "w": 10, "h": 16},
    "crystal":   {"file": "region_032.png", "w": 14, "h": 14},
}

# --- authored geometry -------------------------------------------------------
# The learning path: forward progress with controlled zigzags, one bridge crossing.
PATH_POINTS = [
    (296, 622), (404, 556), (516, 522), (628, 474), (744, 438),
    (806, 356), (788, 268), (862, 196), (898, 124),
]
PATH_HALF_WIDTH = 17.0

# The river: enters at the top edge, flows down and exits bottom-right.
RIVER_POINTS = [(752, -30), (742, 110), (706, 240), (706, 372), (736, 470), (800, 596), (818, 670)]
RIVER_HALF_WIDTH = 38.0

BRIDGE = {"x": 664, "y": 420, "w": 104, "h": 34}

# Quest node slots as fractions along the path.
NODE_SLOTS = [0.055, 0.245, 0.45, 0.655, 0.86, 0.965]

# Plateau: the top of the map sits one terrace higher. The cliff lip follows a
# gentle wave so the boundary reads as natural ground, not a straight ruler.
PLATEAU_EDGE = 112          # terrace lip near the top edge: the band leaves the frame on both sides


def tile(r: int, c: int, transform: str = "id") -> Image.Image:
    atlas = Image.open(PLAINS / "plains-atlas-harmonized.png").convert("RGBA")
    t = atlas.crop((c * TILE, r * TILE, c * TILE + TILE, r * TILE + TILE))
    if transform == "fx":
        t = t.transpose(Image.FLIP_LEFT_RIGHT)
    elif transform == "fy":
        t = t.transpose(Image.FLIP_TOP_BOTTOM)
    elif transform == "fxy":
        t = t.transpose(Image.ROTATE_180)
    elif transform == "east":
        t = t.transpose(Image.ROTATE_90)    # lower edge faces right
    elif transform == "west":
        t = t.transpose(Image.ROTATE_270)   # lower edge faces left
    return t


# The grass field is one flat tile plus sparse procedural tufts. The atlas grass
# variants belong to a bordered "grass island" design, so using them as a
# repeating field draws their lime rim inside the tile and produces a visible
# checkerboard. One flat tile with painted detail keeps the field quiet.
GRASS_FLAT = (1, 1)
LIP = [(4, 0), (4, 1), (4, 2), (4, 3), (4, 4)]
FACE = [(5, 0), (5, 1), (5, 2), (5, 3), (5, 4)]
BASE = [(6, 0), (6, 1), (6, 2), (6, 3), (6, 4)]
WATER = [(12, 5), (13, 5), (12, 6), (13, 6)]
BANK = [(13, 0), (13, 1), (13, 2), (13, 3), (13, 4)]


def polyline_distance(points, sx: float = 1.0, sy: float = 1.0) -> np.ndarray:
    """Distance from every pixel centre to the polyline."""
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    xs = xs * sx
    ys = ys * sy
    best = np.full((H, W), 1e9, dtype=np.float32)
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        vx, vy = x1 - x0, y1 - y0
        length2 = vx * vx + vy * vy
        if length2 == 0:
            continue
        t = ((xs - x0) * vx + (ys - y0) * vy) / length2
        t = np.clip(t, 0.0, 1.0)
        px = x0 + t * vx
        py = y0 + t * vy
        d = np.sqrt((xs - px) ** 2 + (ys - py) ** 2)
        best = np.minimum(best, d)
    return best


def plateau_edge(x: int) -> int:
    return PLATEAU_EDGE


def sample_path(t: float) -> tuple[float, float]:
    """Point at fraction t of the path length (arc-length parameterised)."""
    lengths = []
    total = 0.0
    for (x0, y0), (x1, y1) in zip(PATH_POINTS, PATH_POINTS[1:]):
        d = math.hypot(x1 - x0, y1 - y0)
        lengths.append(d)
        total += d
    target = t * total
    for i, d in enumerate(lengths):
        if target <= d or i == len(lengths) - 1:
            (x0, y0), (x1, y1) = PATH_POINTS[i], PATH_POINTS[i + 1]
            f = 0.0 if d == 0 else target / d
            f = max(0.0, min(1.0, f))
            return x0 + (x1 - x0) * f, y0 + (y1 - y0) * f
        target -= d
    return PATH_POINTS[-1]


def wood_palette() -> tuple[tuple[int, int, int, int], ...]:
    """Use the approved plank sprite's own colours for the bridge."""
    planks = Image.open(APPROVED / "region_019.png").convert("RGBA")
    colours = [c for count, c in sorted(
        ((n, c) for c, n in sorted(_count(planks).items(), key=lambda kv: -kv[1])),
        key=lambda nc: sum(nc[1][:3]),
    ) if c[3] > 200]
    if len(colours) >= 4:
        return colours[0], colours[len(colours) // 3], colours[(2 * len(colours)) // 3], colours[-1]
    return ((94, 60, 34, 255), (126, 82, 46, 255), (160, 110, 62, 255), (196, 148, 96, 255))


def _count(image: Image.Image) -> dict:
    out: dict = {}
    for px in image.getdata():
        if px[3] > 200:
            out[px] = out.get(px, 0) + 1
    return out


def build_terrain() -> tuple[Image.Image, np.ndarray, np.ndarray]:
    terrain = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # 1. grass field: one flat tile, then painted detail
    flat = tile(*GRASS_FLAT)
    for ty in range(0, H, TILE):
        for tx in range(0, W, TILE):
            terrain.paste(flat, (tx, ty))
    paint_grass_detail(terrain)

    # 2. plateau cliff band: grass lip, one soil row, grass fringe
    for column in range(0, W // TILE):
        x0 = column * TILE
        lip_y = (plateau_edge(x0) // TILE) * TILE
        terrain.paste(tile(*LIP[column % len(LIP)]), (x0, lip_y))
        terrain.paste(tile(*FACE[(column * 2) % len(FACE)]), (x0, lip_y + TILE))
        terrain.paste(tile(*BASE[(column * 3 + 2) % len(BASE)]), (x0, lip_y + 2 * TILE))

    # 3. river
    river_d = polyline_distance(RIVER_POINTS)
    water_mask = river_d <= RIVER_HALF_WIDTH
    for ty in range(0, H, TILE):
        for tx in range(0, W, TILE):
            if water_mask[ty:ty + TILE, tx:tx + TILE].mean() < 0.5:
                continue
            terrain.paste(tile(*WATER[(tx // TILE + ty // TILE) % len(WATER)]), (tx, ty))

    # 4. banks: the foam edge lives on the water tile and faces the land, so the
    #    shoreline covers the whole land/water seam without turning land to water.
    for ty in range(0, H, TILE):
        for tx in range(0, W, TILE):
            if water_mask[ty:ty + TILE, tx:tx + TILE].mean() < 0.5:
                continue
            coverage = {
                "north": water_mask[max(ty - TILE, 0):ty, tx:tx + TILE].mean() if ty >= TILE else 1.0,
                "south": water_mask[min(ty + TILE, H - 1):min(ty + 2 * TILE, H), tx:tx + TILE].mean() if ty + TILE < H else 1.0,
                "west": water_mask[ty:ty + TILE, max(tx - TILE, 0):tx].mean() if tx >= TILE else 1.0,
                "east": water_mask[ty:ty + TILE, min(tx + TILE, W - 1):min(tx + 2 * TILE, W)].mean() if tx + TILE < W else 1.0,
            }
            land_side = min(coverage, key=lambda k: coverage[k])
            if coverage[land_side] > 0.35:
                continue
            variant = BANK[(tx // TILE * 2 + ty // TILE) % len(BANK)]
            transform = {"north": "id", "south": "fy", "west": "west", "east": "east"}[land_side]
            terrain.paste(tile(*variant, transform), (tx, ty))

    # 5. bridge deck over the crossing
    terrain.alpha_composite(build_bridge(), (BRIDGE["x"], BRIDGE["y"]))

    # 6. learning path (kept clear of the bridge deck so its planks stay readable)
    path_d = polyline_distance(PATH_POINTS)
    dirt = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dpx = dirt.load()
    base = (201, 160, 108, 255)
    light = (224, 190, 140, 255)
    dark = (168, 129, 78, 255)
    rim = (138, 104, 62, 255)
    bridge_box = (BRIDGE["x"] - 2, BRIDGE["y"] - 2, BRIDGE["x"] + BRIDGE["w"] + 2, BRIDGE["y"] + BRIDGE["h"] + 2)
    for y in range(H):
        for x in range(W):
            d = path_d[y, x]
            if d > PATH_HALF_WIDTH + 3:
                continue
            if water_mask[y, x]:
                continue
            if bridge_box[0] <= x <= bridge_box[2] and bridge_box[1] <= y <= bridge_box[3]:
                continue
            noise = ((x * 37 + y * 61) % 11) / 11.0
            width = PATH_HALF_WIDTH + math.sin(y / 26.0 + x / 41.0) * 2.4 + noise * 1.6
            if d > width:
                continue
            checker = ((x + y) % 2 == 0)
            if d > width - 1.6:
                colour = rim
            elif noise < 0.22:
                colour = light if checker else base
            elif noise > 0.86:
                colour = dark
            else:
                colour = base
            dpx[x, y] = colour
    for i in range(260):
        px = int((i * 379) % W)
        py = int((i * 673) % H)
        if path_d[py, px] < PATH_HALF_WIDTH - 4 and not water_mask[py, px]:
            dpx[px, py] = dark if i % 3 else light
    terrain.alpha_composite(dirt)
    return terrain, water_mask, path_d


def grass_detail_shapes():
    """Pull authored tuft pixels out of the atlas grass tiles.

    The atlas grass tiles belong to a bordered design, so only pixels inset from
    the tile edge are used; those are genuine hand-drawn tufts in the exact
    palette, which is far better than inventing noise.
    """
    from collections import Counter

    atlas = Image.open(PLAINS / "plains-atlas-harmonized.png").convert("RGBA")
    shapes = []
    for r, c in [(0, 1), (0, 2), (1, 3), (2, 3), (3, 0), (3, 3), (7, 1), (9, 3), (10, 2), (10, 3), (11, 3)]:
        cell = atlas.crop((c * TILE, r * TILE, c * TILE + TILE, r * TILE + TILE))
        px = cell.load()
        interior = [px[x, y] for y in range(1, 15) for x in range(1, 15) if px[x, y][3] > 0]
        if not interior:
            continue
        base = Counter(interior).most_common(1)[0][0]
        points = [
            (x, y, px[x, y])
            for y in range(2, 14)
            for x in range(2, 14)
            if px[x, y][3] > 0 and px[x, y] != base
        ]
        if 2 <= len(points) <= 70:
            shapes.append(points)
    return shapes


def paint_grass_detail(terrain: Image.Image) -> None:
    """Stamp authored tufts across the field so open ground has real texture."""
    shapes = grass_detail_shapes()
    if not shapes:
        return
    px = terrain.load()
    for i in range(9000):
        x = (i * 7919 + (i // 7) * 131) % W
        y = (i * 104729 + (i // 11) * 37) % H
        shape = shapes[(i * 3) % len(shapes)]
        for dx, dy, colour in shape:
            tx, ty = x + dx - 6, y + dy - 6
            if 0 <= tx < W and 0 <= ty < H:
                px[tx, ty] = colour
    # broad, very low-contrast patches so open areas are not perfectly even
    wash = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(wash)
    for i in range(30):
        cx = (i * 397 + 61) % W
        cy = (i * 719 + 113) % H
        rw = 70 + (i * 37) % 110
        rh = 45 + (i * 53) % 80
        tone = (0x4C, 0xA8, 0x52, 38) if i % 2 else (0x2C, 0x73, 0x3C, 30)
        d.ellipse([cx - rw, cy - rh, cx + rw, cy + rh], fill=tone)
    terrain.alpha_composite(wash)


def build_bridge() -> Image.Image:
    w, h = BRIDGE["w"], BRIDGE["h"]
    bridge = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(bridge)
    darkest, dark, mid, light = wood_palette()
    d.rectangle([0, 0, w - 1, h - 1], fill=dark)
    # deck planks
    plank_w = 13
    for i, x in enumerate(range(3, w - 6, plank_w)):
        d.rectangle([x, 3, x + plank_w - 2, h - 4], fill=mid if i % 2 else light)
        d.line([(x + 1, 4), (x + 1, h - 5)], fill=dark if i % 2 else mid)
    # side beams and rails
    d.rectangle([0, 0, w - 1, 2], fill=darkest)
    d.rectangle([0, h - 3, w - 1, h - 1], fill=darkest)
    d.line([(2, 1), (w - 3, 1)], fill=mid)
    for x in (2, w - 6):
        d.rectangle([x, -6, x + 3, h - 1], fill=dark)
        d.line([(x + 1, -5), (x + 1, h - 2)], fill=mid)
    return bridge


def build_objects(water_mask: np.ndarray, path_d: np.ndarray, plateau_mask: np.ndarray, nodes):
    objects = []

    def blocked(x: float, y: float, pad: float = 0.0) -> bool:
        xi, yi = int(x), int(y)
        if not (0 <= xi < W and 0 <= yi < H):
            return True
        if 100 <= y <= 196:          # keep the terrace band clear
            return True
        if path_d[yi, xi] < PATH_HALF_WIDTH + 12 + pad:
            return True
        if water_mask[yi, xi]:
            return True
        for node in nodes:
            if math.hypot(x - node["x"], y - node["y"]) < 64 + pad:
                return True
        return False

    def add(kind: str, x: float, y: float, flip: bool = False, scale: float = 1.0, layer: str = "auto"):
        spec = SPRITES[kind]
        objects.append({
            "id": f"{kind}-{len(objects)}",
            "sprite": kind,
            "x": round(x, 1),
            "y": round(y, 1),
            "w": spec["w"],
            "h": spec["h"],
            "flipX": flip,
            "scale": scale,
            "sortY": round(y, 1),
            "shadow": kind not in ("post", "fence"),
            "layer": layer,
        })

    # hero trees: frame the meadow, mask the terrace band and gather near the landmark
    tree_spots = [
        (74, 266, False), (120, 486, True), (58, 600, False), (196, 320, True),
        (338, 232, False), (452, 258, True), (566, 320, False), (612, 234, True),
        (868, 320, True), (902, 470, False), (852, 606, True), (676, 580, False),
        (250, 60, True), (430, 44, False), (596, 66, True), (150, 44, False),
        (742, 46, True), (900, 52, False), (60, 210, True), (452, 614, True),
        (500, 402, False), (826, 520, True), (240, 440, False), (654, 350, True),
        (300, 132, False), (520, 116, True), (700, 128, False), (930, 96, True),
    ]
    for x, y, flip in tree_spots:
        add("tree", x, y, flip)

    # undergrowth: bushes and rocks, kept clear of the path and the water
    bushes = ["bush_a", "bush_berry", "bush_red", "bush_b", "clover", "leaves", "sprout"]
    rocks = ["rock_a", "rock_b", "rock_med", "pebble", "stones", "rock_flat"]
    placed = 0
    for i in range(320):
        x = (i * 149 + 41) % (W - 24) + 12
        y = (i * 313 + 97) % (H - 24) + 12
        if blocked(x, y):
            continue
        if placed % 6 == 0:
            add("rock_big", x, y, i % 2 == 1)
        elif placed % 2 == 0:
            add(bushes[i % len(bushes)], x, y, i % 3 == 0)
        else:
            add(rocks[i % len(rocks)], x, y, i % 4 == 0)
        placed += 1
        if placed >= 150:
            break

    # flowers, mostly near the path so the route feels tended
    flowers = ["flower_p", "flower_y", "sunflower", "mushroom_p", "mushroom_t", "berries", "tufts"]
    for i in range(150):
        x = (i * 233 + 67) % (W - 30) + 15
        y = (i * 419 + 131) % (H - 30) + 15
        if blocked(x, y, pad=-6):
            continue
        if path_d[int(y), int(x)] > 90:
            continue
        add(flowers[i % len(flowers)], x, y, i % 3 == 0)

    # stumps and posts along the trail as landmarks
    for x, y, flip in [(470, 604, False), (712, 300, True), (300, 366, False), (860, 424, True)]:
        add("stump", x, y, flip)
    for x, y in [(250, 576), (250, 556), (512, 486)]:
        add("post", x, y)

    # fence run beside the destination clearing
    for i, x in enumerate(range(862, 956, 30)):
        add("fence", x, 272 + (i % 2) * 3, i % 2 == 1)

    add("crystal", 690, 688 - 620)
    add("crystal", 880, 268)
    return objects


def build_nodes():
    nodes = []
    for index, t in enumerate(NODE_SLOTS):
        x, y = sample_path(t)
        nodes.append({
            "slot": index,
            "t": round(t, 4),
            "x": round(x, 1),
            "y": round(y - 4, 1),
        })
    return nodes


def render_preview(terrain: Image.Image, objects, nodes, spawn) -> Image.Image:
    preview = terrain.copy()
    for obj in sorted(objects, key=lambda o: o["sortY"]):
        sprite = Image.open(APPROVED / SPRITES[obj["sprite"]]["file"]).convert("RGBA")
        if obj.get("flipX"):
            sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
        preview.alpha_composite(
            sprite,
            (int(obj["x"] - sprite.width / 2), int(obj["y"] - sprite.height + 2)),
        )
    node_sheet = Image.open(WORLD / "generated" / "structures" / "quest-node-sheet.png").convert("RGBA")
    for node in nodes:
        cell = node_sheet.crop((0, 0, 32, 36))
        preview.alpha_composite(cell, (int(node["x"] - 16), int(node["y"] - 34)))
    player = Image.open(WORLD / "characters" / "player" / "player-sheet.png").convert("RGBA")
    frame = player.crop((0, 0, 16, 24))
    preview.alpha_composite(frame, (int(spawn[0] - 8), int(spawn[1] - 23)))
    return preview


def main() -> None:
    REGION.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    terrain, water_mask, path_d = build_terrain()
    nodes = build_nodes()
    objects = build_objects(water_mask, path_d, None, nodes)
    spawn = sample_path(0.01)

    terrain.save(REGION / "terrain.png")
    layout = {
        "region": "forest-clearing",
        "width": W,
        "height": H,
        "tile": TILE,
        "terrain": "/assets/nabta/world/regions/forest-clearing/terrain.png",
        "path": [{"x": x, "y": y} for x, y in PATH_POINTS],
        "pathHalfWidth": PATH_HALF_WIDTH,
        "nodes": nodes,
        "spawn": {"x": round(spawn[0], 1), "y": round(spawn[1], 1)},
        "objects": objects,
        "bridge": BRIDGE,
        "spriteCatalogue": SPRITES,
        "generated": "scripts/pixel-art/build_world.py (deterministic)",
    }
    (REGION / "decor.json").write_text(json.dumps(layout, indent=2) + "\n", encoding="utf-8")

    preview = render_preview(terrain, objects, nodes, spawn)
    preview.save(PREVIEWS / "world-preview.png")
    print("objects:", len(objects), "nodes:", len(nodes))
    print("wrote", REGION / "terrain.png", terrain.size)
    print("wrote", REGION / "decor.json")
    print("wrote", PREVIEWS / "world-preview.png")


if __name__ == "__main__":
    main()
