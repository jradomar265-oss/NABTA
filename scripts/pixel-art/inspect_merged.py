"""Inspection montage: source regions for the 7 suspected merged terrain runs.

    python inspect_merged.py <workdir> <sheet1>

For each candidate it crops the SOURCE around the current bbox, draws the bbox in red,
and prints x-coordinate ticks every 50 px so any proposed split can be stated exactly.
Nothing is modified; this is evidence only.
"""
from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from phase2_terrain import load_rgba, strip_checker  # noqa: E402

CANDIDATES = [
    "terrain_cliff_lip_a_01",
    "terrain_cliff_lip_a_02",
    "terrain_cliff_lip_b_02",
    "terrain_cliff_lip_b_03",
    "terrain_cliff_lip_b_04",
    "terrain_transition_03",
    "terrain_transition_05",
]


def main() -> None:
    workdir, sheet1 = sys.argv[1], sys.argv[2]
    man = json.load(open(os.path.join(workdir, "metadata", "terrain-manifest.json"), encoding="utf8"))
    by_id = {a["id"]: a for a in man["assets"]}

    src = strip_checker(load_rgba(sheet1))
    try:
        font = ImageFont.truetype("arial.ttf", 13)
    except Exception:
        font = ImageFont.load_default()

    panels = []
    for cid in CANDIDATES:
        a = by_id.get(cid)
        if not a:
            continue
        x, y, w, h = a["bbox"]
        pad = 16
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(src.width, x + w + pad), min(src.height, y + h + pad)
        region = src.crop((x0, y0, x1, y1)).convert("RGBA")

        # dark backing so transparency reads clearly
        back = Image.new("RGBA", region.size, (26, 30, 34, 255))
        for cy in range(0, back.height, 12):
            for cx in range(0, back.width, 12):
                if (cx // 12 + cy // 12) % 2 == 0:
                    back.paste((44, 50, 56, 255), (cx, cy, min(cx + 12, back.width), min(cy + 12, back.height)))
        back.alpha_composite(region)

        d = ImageDraw.Draw(back)
        # current bbox in red
        d.rectangle([x - x0, y - y0, x - x0 + w - 1, y - y0 + h - 1], outline=(255, 70, 70, 255), width=2)
        # x ticks every 50 px of SOURCE coordinates
        for sx in range(x - x0 - (x - x0) % 50, back.width, 50):
            abs_x = x0 + sx
            d.line([(sx, 0), (sx, 8)], fill=(255, 220, 90, 255), width=1)
            d.text((sx + 2, 8), str(abs_x), fill=(255, 220, 90, 255), font=font)

        header = Image.new("RGBA", (back.width, 22), (18, 20, 24, 255))
        hd = ImageDraw.Draw(header)
        hd.text((4, 4), f"{cid}  bbox=({x},{y},{w},{h})  {w}x{h}", fill=(220, 235, 220, 255), font=font)
        panel = Image.new("RGBA", (back.width, back.height + 22), (18, 20, 24, 255))
        panel.alpha_composite(header, (0, 0))
        panel.alpha_composite(back, (0, 22))
        panels.append(panel)

    width = max(p.width for p in panels)
    height = sum(p.height for p in panels) + 10 * len(panels)
    sheet = Image.new("RGBA", (width, height), (14, 16, 20, 255))
    yoff = 0
    for p in panels:
        sheet.alpha_composite(p, (0, yoff))
        yoff += p.height + 10

    out = os.path.join(workdir, "contact-sheets", "merged-candidates-inspection.png")
    sheet.save(out)
    print("panels:", len(panels), "->", out, sheet.size)


if __name__ == "__main__":
    main()
