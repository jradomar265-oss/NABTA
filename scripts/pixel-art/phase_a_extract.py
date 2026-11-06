"""Phase A helpers: coordinate grid, then box-map cropping.

    python phase_a_extract.py grid  <source> <outdir>
    python phase_a_extract.py crop  <source> <outdir> <boxes.json>

The grid exists because manual bounding boxes must be measured, not estimated.
"""
from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

STEP = 50
LABEL_STEP = 100


def grid(source: str, outdir: str) -> None:
    os.makedirs(outdir, exist_ok=True)
    img = Image.open(source).convert("RGBA")
    W, H = img.size
    # Scale up 1x is fine; grid lines are drawn on a copy only.
    canvas = img.copy()
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("arial.ttf", 16)
    except Exception:
        font = ImageFont.load_default()

    for x in range(0, W, STEP):
        colour = (255, 0, 0, 160) if x % LABEL_STEP == 0 else (255, 120, 120, 90)
        draw.line([(x, 0), (x, H)], fill=colour, width=1)
        if x % LABEL_STEP == 0:
            draw.text((x + 2, 2), str(x), fill=(200, 0, 0, 255), font=font)
    for y in range(0, H, STEP):
        colour = (0, 0, 255, 160) if y % LABEL_STEP == 0 else (120, 120, 255, 90)
        draw.line([(0, y), (W, y)], fill=colour, width=1)
        if y % LABEL_STEP == 0:
            draw.text((2, y + 1), str(y), fill=(0, 0, 200, 255), font=font)

    canvas.save(os.path.join(outdir, "source-grid.png"))
    print("grid written", canvas.size)


def crop(source: str, outdir: str, boxfile: str) -> None:
    os.makedirs(outdir, exist_ok=True)
    img = Image.open(source).convert("RGBA")
    with open(boxfile, encoding="utf-8-sig") as fh:
        spec = json.load(fh)

    entries = []
    for item in spec["assets"]:
        x, y, w, h = item["x"], item["y"], item["width"], item["height"]
        crop_img = img.crop((x, y, x + w, y + h))

        # Report contamination risk: opaque pixels touching the crop border means the
        # object very likely continues past the box.
        px = crop_img.load()
        touching = 0
        for cx in range(w):
            for cy in (0, h - 1):
                if px[cx, cy][3] > 8:
                    touching += 1
        for cy in range(h):
            for cx in (0, w - 1):
                if px[cx, cy][3] > 8:
                    touching += 1

        name = item["output"]
        crop_img.save(os.path.join(outdir, name))
        entries.append({**item, "border_pixels": touching})

    with open(os.path.join(outdir, "extraction-map.json"), "w", encoding="utf8") as fh:
        json.dump({"source": spec.get("source", ""), "assets": entries}, fh, indent=1)

    # Contact sheet: each crop on a checker so transparency is obvious.
    cols = 5
    cell_w, cell_h = 260, 220
    rows = (len(entries) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell_w, rows * cell_h), (26, 32, 36, 255))
    draw = ImageDraw.Draw(sheet)
    for i, entry in enumerate(entries):
        sprite = Image.open(os.path.join(outdir, entry["output"]))
        scale = min((cell_w - 24) / sprite.width, (cell_h - 40) / sprite.height, 3)
        scale = max(scale, 0.2)
        resized = sprite.resize((max(1, int(sprite.width * scale)), max(1, int(sprite.height * scale))), Image.NEAREST)
        cx = (i % cols) * cell_w
        cy = (i // cols) * cell_h
        sheet.alpha_composite(resized, (cx + (cell_w - resized.width) // 2, cy + 30 + (cell_h - 30 - resized.height) // 2))
        draw.text((cx + 6, cy + 6), f"{entry['output'][:28]}", fill=(190, 220, 190, 255))
        draw.text((cx + 6, cy + 18), f"{entry['x']},{entry['y']} {sprite.width}x{sprite.height} b={entry['border_pixels']}", fill=(150, 180, 150, 255))
        draw.rectangle([cx + 2, cy + 2, cx + cell_w - 3, cy + cell_h - 3], outline=(70, 90, 80, 255))
    sheet.save(os.path.join(outdir, "phase-a-contact-sheet.png"))
    print(f"cropped {len(entries)} assets -> {outdir}")


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "grid":
        grid(sys.argv[2], sys.argv[3])
    else:
        crop(sys.argv[2], sys.argv[3], sys.argv[4])
