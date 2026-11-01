"""Generate the NABTA student character sprite sheet.

This is a *generated candidate*, not approved artwork. It is written to
`public/assets/nabta/world/characters/player/` together with a zoomed preview so
the founder can accept or reject it. The renderer only loads it through the asset
manifest, so it can be swapped for a hand-drawn sheet without code changes.

Sheet layout: 6 columns x 3 rows, one row per facing (down, side, up).
Columns 0-1 idle, columns 2-5 walking. Frames are 16x24 px, transparent.
The side row faces LEFT; the renderer mirrors it for rightward movement.
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "public" / "assets" / "nabta" / "world" / "characters" / "player"
PREVIEWS = REPO / "public" / "assets" / "nabta" / "world" / "previews"

W, H = 16, 24

PALETTE = {
    "K": (35, 30, 29, 255),      # outline
    "H": (52, 42, 37, 255),      # hair
    "h": (94, 77, 66, 255),      # hair highlight
    "S": (235, 189, 143, 255),   # skin
    "s": (203, 148, 104, 255),   # skin shade
    "E": (43, 34, 31, 255),      # eyes
    "C": (228, 219, 194, 255),   # shirt
    "c": (188, 177, 148, 255),   # shirt shade
    "P": (47, 74, 92, 255),      # trousers
    "p": (34, 55, 71, 255),      # trousers shade
    "O": (78, 60, 47, 255),      # boots
    "o": (53, 41, 33, 255),      # boots shade
    "B": (139, 90, 50, 255),     # satchel leather
    "b": (105, 65, 35, 255),     # satchel shade
    "G": (111, 160, 106, 255),   # satchel clasp
}


class Sprite:
    def __init__(self) -> None:
        self.rows = [["." for _ in range(W)] for _ in range(H)]

    def put(self, x: int, y: int, key: str) -> None:
        if 0 <= x < W and 0 <= y < H:
            self.rows[y][x] = key

    def rect(self, x0: int, y0: int, x1: int, y1: int, key: str) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, key)

    def image(self) -> Image.Image:
        im = Image.new("RGBA", (W, H))
        px = im.load()
        for y, row in enumerate(self.rows):
            for x, key in enumerate(row):
                if key != ".":
                    px[x, y] = PALETTE[key]
        return im


def outline(sprite: Sprite) -> None:
    """Add a 1px dark outline around every opaque pixel."""
    source = [row[:] for row in sprite.rows]
    for y in range(H):
        for x in range(W):
            if source[y][x] != ".":
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and source[ny][nx] not in (".", "K"):
                    sprite.rows[y][x] = "K"
                    break


def head_down(s: Sprite, dy: int = 0) -> None:
    """Facing the camera: round cap of hair, bangs, two eyes."""
    s.rect(5, 2 + dy, 10, 5 + dy, "H")          # cap
    s.rect(4, 4 + dy, 4, 9 + dy, "H")           # left side
    s.rect(11, 4 + dy, 11, 9 + dy, "H")         # right side
    s.put(6, 2 + dy, "h")
    s.put(7, 2 + dy, "h")
    s.put(5, 3 + dy, "h")
    s.rect(5, 6 + dy, 10, 11 + dy, "S")         # face
    s.rect(5, 6 + dy, 10, 7 + dy, "H")          # bangs
    s.put(6, 7 + dy, "S")
    s.put(9, 7 + dy, "S")
    s.rect(4, 10 + dy, 4, 11 + dy, "S")         # cheeks
    s.rect(11, 10 + dy, 11, 11 + dy, "S")
    s.put(6, 9 + dy, "E")                       # eyes
    s.put(9, 9 + dy, "E")
    s.put(5, 10 + dy, "s")
    s.put(10, 10 + dy, "s")
    s.rect(7, 11 + dy, 8, 11 + dy, "s")         # mouth


def head_up(s: Sprite, dy: int = 0) -> None:
    """Walking away from the camera: hair only, no face."""
    s.rect(5, 2 + dy, 10, 11 + dy, "H")
    s.rect(4, 4 + dy, 4, 9 + dy, "H")
    s.rect(11, 4 + dy, 11, 9 + dy, "H")
    s.put(6, 2 + dy, "h")
    s.put(7, 2 + dy, "h")
    s.put(7, 5 + dy, "h")
    s.put(7, 6 + dy, "h")
    s.put(8, 7 + dy, "h")
    s.put(6, 8 + dy, "h")
    s.rect(4, 10 + dy, 4, 11 + dy, "S")         # ears
    s.rect(11, 10 + dy, 11, 11 + dy, "S")


def head_side(s: Sprite, dy: int = 0) -> None:
    """Facing left: hair mass behind, profile with nose and one eye."""
    s.rect(5, 2 + dy, 10, 5 + dy, "H")
    s.rect(4, 4 + dy, 4, 8 + dy, "H")
    s.rect(9, 4 + dy, 11, 10 + dy, "H")
    s.put(6, 2 + dy, "h")
    s.put(7, 2 + dy, "h")
    s.put(10, 4 + dy, "h")
    s.rect(4, 6 + dy, 9, 11 + dy, "S")          # profile
    s.rect(7, 6 + dy, 9, 7 + dy, "H")           # fringe over the temple
    s.put(4, 6 + dy, "H")
    s.put(3, 9 + dy, "S")                       # nose
    s.put(4, 9 + dy, "S")
    s.put(6, 9 + dy, "E")                       # eye
    s.put(4, 11 + dy, "s")
    s.put(6, 11 + dy, "s")


def torso_down(s: Sprite, dy: int = 0, arms: str = "neutral") -> None:
    s.rect(5, 13 + dy, 10, 17 + dy, "C")
    s.rect(6, 12 + dy, 9, 12 + dy, "C")         # shoulders
    s.rect(5, 17 + dy, 10, 17 + dy, "c")        # hem
    s.put(7, 13 + dy, "G")                      # collar accent
    s.put(8, 13 + dy, "G")
    # satchel at the right hip
    s.rect(11, 15 + dy, 12, 17 + dy, "B")
    s.put(11, 16 + dy, "b")
    s.put(12, 17 + dy, "G")
    if arms == "neutral":
        s.rect(4, 14 + dy, 4, 16 + dy, "C")
        s.rect(13, 14 + dy, 13, 16 + dy, "C")
        s.put(4, 17 + dy, "S")
        s.put(13, 17 + dy, "S")
    elif arms == "swing_a":
        s.rect(4, 13 + dy, 4, 15 + dy, "C")
        s.put(4, 16 + dy, "S")
        s.rect(13, 14 + dy, 13, 17 + dy, "C")
        s.put(13, 18 + dy, "S")
    else:
        s.rect(4, 14 + dy, 4, 17 + dy, "C")
        s.put(4, 18 + dy, "S")
        s.rect(13, 13 + dy, 13, 15 + dy, "C")
        s.put(13, 16 + dy, "S")


def torso_side(s: Sprite, dy: int = 0, arms: str = "neutral") -> None:
    s.rect(4, 13 + dy, 9, 17 + dy, "C")
    s.rect(5, 12 + dy, 8, 12 + dy, "C")
    s.rect(4, 17 + dy, 9, 17 + dy, "c")
    s.put(5, 13 + dy, "G")
    # satchel on the back
    s.rect(9, 14 + dy, 10, 16 + dy, "B")
    s.put(10, 15 + dy, "b")
    s.put(9, 16 + dy, "G")
    if arms == "neutral":
        s.rect(7, 14 + dy, 7, 16 + dy, "C")
        s.put(7, 17 + dy, "S")
    elif arms == "swing_a":
        s.rect(4, 14 + dy, 4, 15 + dy, "C")
        s.put(4, 16 + dy, "S")
    else:
        s.rect(8, 14 + dy, 8, 15 + dy, "C")
        s.put(8, 16 + dy, "S")


def legs_down(s: Sprite, phase: int = 0) -> None:
    if phase == 0:
        s.rect(5, 18, 7, 20, "P")
        s.rect(8, 18, 10, 20, "P")
        s.rect(5, 21, 7, 23, "O")
        s.rect(8, 21, 10, 23, "O")
        s.put(6, 22, "o")
        s.put(9, 22, "o")
        s.put(7, 18, "p")
        s.put(9, 18, "p")
    elif phase == 1:  # left leg forward, right leg trailing
        s.rect(4, 18, 7, 20, "P")
        s.rect(8, 18, 10, 19, "P")
        s.rect(4, 21, 6, 22, "O")
        s.rect(8, 20, 10, 21, "O")
        s.put(5, 22, "o")
        s.put(9, 21, "o")
        s.put(9, 18, "p")
    else:  # right leg forward
        s.rect(5, 18, 7, 19, "P")
        s.rect(8, 18, 11, 20, "P")
        s.rect(5, 20, 7, 21, "O")
        s.rect(8, 21, 10, 22, "O")
        s.put(6, 21, "o")
        s.put(9, 22, "o")
        s.put(7, 18, "p")


def legs_side(s: Sprite, phase: int = 0) -> None:
    if phase == 0:
        s.rect(5, 18, 8, 20, "P")
        s.rect(5, 21, 8, 23, "O")
        s.put(6, 22, "o")
        s.put(8, 18, "p")
    elif phase == 1:  # near leg forward
        s.rect(4, 18, 6, 20, "P")
        s.rect(7, 18, 9, 19, "p")
        s.rect(3, 21, 5, 22, "O")
        s.rect(7, 20, 9, 21, "O")
        s.put(4, 22, "o")
        s.put(8, 21, "o")
    else:  # near leg back
        s.rect(6, 18, 8, 19, "p")
        s.rect(4, 18, 6, 20, "P")
        s.rect(4, 21, 6, 23, "O")
        s.rect(8, 19, 9, 20, "O")
        s.put(5, 22, "o")


def build_frames() -> list[tuple[str, int, Image.Image]]:
    frames: list[tuple[str, int, Image.Image]] = []

    def add(facing: str, index: int, sprite: Sprite) -> None:
        outline(sprite)
        frames.append((facing, index, sprite.image()))

    for i in range(2):  # down idle
        s = Sprite()
        head_down(s, 1 if i else 0)
        torso_down(s, 1 if i else 0, "neutral")
        legs_down(s, 0)
        add("down", i, s)
    for i, phase in enumerate([0, 1, 0, 2]):  # down walk
        s = Sprite()
        bob = 1 if phase == 1 else 0
        head_down(s, bob)
        torso_down(s, bob, "swing_a" if phase == 1 else "swing_b" if phase == 2 else "neutral")
        legs_down(s, phase)
        add("down", 2 + i, s)

    for i in range(2):  # side idle
        s = Sprite()
        head_side(s, 1 if i else 0)
        torso_side(s, 1 if i else 0, "neutral")
        legs_side(s, 0)
        add("side", i, s)
    for i, phase in enumerate([0, 1, 0, 2]):  # side walk
        s = Sprite()
        head_side(s, 1 if phase == 1 else 0)
        torso_side(s, 1 if phase == 1 else 0, "swing_a" if phase in (1, 2) else "neutral")
        legs_side(s, phase)
        add("side", 2 + i, s)

    for i in range(2):  # up idle
        s = Sprite()
        head_up(s, 1 if i else 0)
        torso_down(s, 1 if i else 0, "neutral")
        legs_down(s, 0)
        add("up", i, s)
    for i, phase in enumerate([0, 1, 0, 2]):  # up walk
        s = Sprite()
        bob = 1 if phase == 1 else 0
        head_up(s, bob)
        torso_down(s, bob, "swing_a" if phase == 1 else "swing_b" if phase == 2 else "neutral")
        legs_down(s, phase)
        add("up", 2 + i, s)

    return frames


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    frames = build_frames()

    sheet = Image.new("RGBA", (W * 6, H * 3))
    row_of = {"down": 0, "side": 1, "up": 2}
    meta: dict[str, list[dict[str, int]]] = {"down": [], "side": [], "up": []}
    for facing, index, image in frames:
        sheet.alpha_composite(image, (index * W, row_of[facing] * H))
        meta[facing].append({"x": index * W, "y": row_of[facing] * H})

    sheet.save(OUT / "player-sheet.png")

    (OUT / "player-animation.json").write_text(json.dumps({
        "image": "/assets/nabta/world/characters/player/player-sheet.png",
        "frameWidth": W,
        "frameHeight": H,
        "anchor": {"x": W // 2, "y": H - 1},
        "status": "generated_candidate_pending_founder_approval",
        "rows": meta,
        "idleFrameMs": 460,
        "walkFrameMs": 130,
        "note": "row 'side' faces left; mirror horizontally for rightward movement",
    }, indent=2) + "\n", encoding="utf-8")

    scale, pad = 8, 12
    bg = Image.open(REPO / "public/assets/nabta/world/terrain/plains/plains-atlas-harmonized.png").convert("RGBA")
    grass = bg.crop((16, 16, 32, 32)).resize((16 * scale, 16 * scale), Image.NEAREST)
    out = Image.new("RGBA", (6 * (W * scale + pad) + pad, 3 * (H * scale + pad) + pad), (26, 30, 28, 255))
    d = ImageDraw.Draw(out)
    for r in range(3):
        for c in range(6):
            box = Image.new("RGBA", (W * scale, H * scale))
            for ty in range(0, H * scale, 16 * scale):
                for tx in range(0, W * scale, 16 * scale):
                    box.alpha_composite(grass, (tx, ty))
            box.alpha_composite(sheet.crop((c * W, r * H, c * W + W, r * H + H)).resize((W * scale, H * scale), Image.NEAREST))
            out.alpha_composite(box, (pad + c * (W * scale + pad), pad + r * (H * scale + pad)))
    out.save(PREVIEWS / "player-sheet-preview.png")
    print("frames:", len(frames), "sheet:", sheet.size)
    print("wrote", OUT / "player-sheet.png")
    print("wrote", PREVIEWS / "player-sheet-preview.png")


if __name__ == "__main__":
    main()
