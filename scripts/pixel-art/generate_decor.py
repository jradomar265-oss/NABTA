"""Generate the NABTA quest-node medallion sheet.

Outputs (candidates for founder review):
    public/assets/nabta/world/generated/structures/quest-node-sheet.png
    public/assets/nabta/world/previews/quest-node-preview.png

Sheet layout: four 32x36 cells in the order available, active, completed, locked.
The anchor is the bottom-centre of each cell so a node sits on the learning path.

Tree/foliage generation was attempted and rejected: procedural canopies did not
reach the quality of the founder-approved forest sprites, so no generated trees
ship with the world.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
WORLD = REPO / "public" / "assets" / "nabta" / "world"
GENERATED = WORLD / "generated" / "structures"
PREVIEWS = WORLD / "previews"

CELL_W, CELL_H = 32, 36
STATES = ["available", "active", "completed", "locked"]

RING_LIGHT = {
    "available": (0xE8, 0xDF, 0xB8, 255),
    "active": (0xFF, 0xF4, 0xC4, 255),
    "completed": (0xDA, 0xE9, 0xD2, 255),
    "locked": (0xB9, 0xBE, 0xB6, 255),
}
RING_DARK = {
    "available": (0x93, 0x6B, 0x42, 255),
    "active": (0xD1, 0x8B, 0x33, 255),
    "completed": (0x3F, 0x7A, 0x4A, 255),
    "locked": (0x4E, 0x56, 0x52, 255),
}
FILL = {
    "available": (0x3F, 0x8A, 0x4E, 255),
    "active": (0x4F, 0xA8, 0x57, 255),
    "completed": (0x2F, 0x6E, 0x48, 255),
    "locked": (0x6A, 0x71, 0x6C, 255),
}
GLYPH = (0xF2, 0xFA, 0xE8, 255)


def node(state: str) -> Image.Image:
    im = Image.new("RGBA", (CELL_W, CELL_H))
    d = ImageDraw.Draw(im)
    cx, cy = CELL_W // 2, 15

    d.ellipse([cx - 12, cy + 10, cx + 12, cy + 16], fill=(0x11, 0x24, 0x1C, 110))
    d.ellipse([cx - 13, cy - 13, cx + 13, cy + 13], fill=RING_DARK[state])
    d.ellipse([cx - 13, cy - 14, cx + 12, cy + 12], fill=RING_LIGHT[state])
    d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=FILL[state])
    d.arc([cx - 10, cy - 10, cx + 10, cy + 10], 190, 350, fill=(0xFF, 0xFF, 0xFF, 70))

    if state in ("available", "active"):
        stem = [(0, -6), (0, -5), (0, -4), (0, -3), (0, -2), (0, -1), (0, 0)]
        left = [(-1, -1), (-2, -2), (-3, -3), (-3, -4), (-2, -4), (-1, -3), (-2, -1)]
        right = [(1, -1), (2, -2), (3, -3), (3, -4), (2, -4), (1, -3), (2, -1)]
        for dx, dy in stem + left + right:
            im.putpixel((cx + dx, cy + dy), GLYPH)
        im.putpixel((cx, cy - 7), GLYPH)
    elif state == "completed":
        for dx, dy in [(-4, 0), (-3, 1), (-2, 2), (-1, 1), (0, 0), (1, -1),
                       (2, -2), (3, -3), (4, -4), (-4, -1), (5, -5), (5, -4), (4, -3), (0, 1), (1, 0)]:
            im.putpixel((cx + dx, cy + dy), GLYPH)
    else:
        d.rectangle([cx - 5, cy - 1, cx + 5, cy + 6], fill=(0xE3, 0xE7, 0xDF, 255))
        d.arc([cx - 4, cy - 7, cx + 4, cy + 1], 180, 360, fill=(0xE3, 0xE7, 0xDF, 255), width=2)
        for y in (3, 4):
            im.putpixel((cx, cy + y), (0x3A, 0x42, 0x3E, 255))
    return im


def main() -> None:
    GENERATED.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    sheet = Image.new("RGBA", (CELL_W * len(STATES), CELL_H))
    for index, state in enumerate(STATES):
        sheet.alpha_composite(node(state), (index * CELL_W, 0))
    sheet.save(GENERATED / "quest-node-sheet.png")

    atlas = Image.open(WORLD / "terrain" / "plains" / "plains-atlas-harmonized.png").convert("RGBA")
    grass = atlas.crop((16, 16, 32, 32))
    scale = 5
    width = CELL_W * len(STATES) * scale
    preview = Image.new("RGBA", (width, CELL_H * scale), (26, 30, 28, 255))
    field = Image.new("RGBA", (width, CELL_H * scale))
    for y in range(0, field.height, 16 * 1):
        for x in range(0, field.width, 16 * 1):
            field.alpha_composite(grass, (x, y))
    field = field.resize((width, CELL_H * scale), Image.NEAREST)
    field.alpha_composite(sheet.resize((width, CELL_H * scale), Image.NEAREST))
    preview.alpha_composite(field)
    preview.save(PREVIEWS / "quest-node-preview.png")
    print("wrote quest node sheet and preview")


if __name__ == "__main__":
    main()
