"""Phase 1 for the four-sheet library: inventory, sample crops, validation.

    python four_sheets_phase1.py <workdir> <boxes.json>

Checks each source for *real* alpha before importing anything: the previews show a
checkerboard, which can mean genuine transparency OR a checkerboard painted into the
pixels by the generator. Those two cases need completely different handling, so it is
measured, not assumed.
"""
from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

CATEGORIES = ["terrain", "water", "paths", "buildings", "bridges", "vegetation",
              "characters", "props", "quest-nodes", "ui", "effects"]


def analyse(path: str) -> dict:
    img = Image.open(path)
    mode = img.mode
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    # corner + interior alpha sample
    corners = [px[1, 1][3], px[w - 2, 1][3], px[1, h - 2][3], px[w - 2, h - 2][3]]
    transparent = sum(1 for y in range(0, h, 7) for x in range(0, w, 7) if px[x, y][3] == 0)
    samples = sum(1 for y in range(0, h, 7) for x in range(0, w, 7))
    # checkerboard detection: two alternating light greys in a regular pattern
    light = [(x, y) for y in range(0, 64, 8) for x in range(0, 64, 8) if px[x, y][3] > 0]
    shades = {px[x, y][:3] for x, y in light}
    return {
        "mode": mode,
        "size": [w, h],
        "corner_alpha": corners,
        "transparent_fraction": round(transparent / samples, 3) if samples else 0,
        "background_shades_in_corner": len(shades),
        "corner_shades": sorted(shades)[:4],
    }


def main() -> None:
    workdir, boxfile = sys.argv[1], sys.argv[2]
    with open(boxfile, encoding="utf-8-sig") as fh:
        spec = json.load(fh)

    for folder in ["raw", "cleaned", "contact-sheets", "metadata"] + CATEGORIES:
        os.makedirs(os.path.join(workdir, folder), exist_ok=True)

    inventory = {}
    for entry in spec["images"]:
        inventory[entry["file"]] = analyse(entry["path"])

    rows = []
    report = []
    for entry in spec["images"]:
        img = Image.open(entry["path"]).convert("RGBA")
        for asset in entry["assets"]:
            x, y, w, h = asset["x"], asset["y"], asset["width"], asset["height"]
            crop = img.crop((x, y, x + w, y + h))
            out = os.path.join(workdir, "raw", asset["output"])
            crop.save(out)

            px = crop.load()
            border = sum(1 for cx in range(crop.width) for cy in (0, crop.height - 1) if px[cx, cy][3] > 8)
            border += sum(1 for cy in range(crop.height) for cx in (0, crop.width - 1) if px[cy and 0 or 0, 0][3] > 8) * 0
            border += sum(1 for cy in range(crop.height) for cx in (0, crop.width - 1) if px[cx, cy][3] > 8)
            opaque = sum(1 for cy in range(0, crop.height, 3) for cx in range(0, crop.width, 3) if px[cx, cy][3] > 8)

            verdict = "PASS" if border == 0 else "REVIEW"
            report.append({**asset, "source": entry["file"], "extracted": [crop.width, crop.height], "border_pixels": border, "verdict": verdict})
            rows.append((asset["output"], crop, verdict, border))

    with open(os.path.join(workdir, "metadata", "sample-map.json"), "w", encoding="utf8") as fh:
        json.dump({"inventory": inventory, "samples": report}, fh, indent=1)

    cols = 6
    cw, ch = 250, 240
    sheet_rows = (len(rows) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cw, sheet_rows * ch), (24, 30, 34, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (name, crop, verdict, border) in enumerate(rows):
        scale = min((cw - 20) / crop.width, (ch - 46) / crop.height, 3)
        scale = max(scale, 0.15)
        r = crop.resize((max(1, int(crop.width * scale)), max(1, int(crop.height * scale))), Image.NEAREST)
        cx, cy = (i % cols) * cw, (i // cols) * ch
        sheet.alpha_composite(r, (cx + (cw - r.width) // 2, cy + 34 + (ch - 34 - r.height) // 2))
        draw.text((cx + 5, cy + 4), name[:30], fill=(200, 225, 200, 255))
        colour = (120, 220, 120, 255) if verdict == "PASS" else (240, 190, 90, 255)
        draw.text((cx + 5, cy + 17), f"{verdict} {crop.width}x{crop.height} b={border}", fill=colour)
        draw.rectangle([cx + 1, cy + 1, cx + cw - 2, cy + ch - 2], outline=(60, 80, 70, 255))
    sheet.save(os.path.join(workdir, "contact-sheets", "phase1-samples.png"))

    print(json.dumps(inventory, indent=1))
    print("samples:", len(rows))
    print("PASS:", sum(1 for r in rows if r[2] == "PASS"), "REVIEW:", sum(1 for r in rows if r[2] == "REVIEW"))


if __name__ == "__main__":
    main()
