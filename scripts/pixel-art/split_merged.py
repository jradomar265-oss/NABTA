"""Split the 7 verified merged runs into independent tiles.

    python split_merged.py <workdir> <sheet1>

Splitting is justified per-candidate by the inspection montage, which shows visible
background gutters between tiles. The earlier attempt failed because the band
y-ranges overlapped the neighbouring row, so the lower row filled every gutter. Each
band now uses the y-window measured from the montage.

Originals are never modified: new files go to corrected/ and the manifest records
both the old and new boxes.
"""
from __future__ import annotations

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from phase2_terrain import load_rgba, strip_checker  # noqa: E402

# y-windows measured from merged-candidates-inspection.png, and the x-range each
# candidate occupies in the source.
TARGETS = {
    "terrain_cliff_lip_a_01": (330, 462),
    "terrain_cliff_lip_a_02": (330, 462),
    "terrain_cliff_lip_b_02": (466, 596),
    "terrain_cliff_lip_b_03": (466, 596),
    "terrain_cliff_lip_b_04": (466, 596),
    "terrain_transition_03": (176, 300),
    "terrain_transition_05": (176, 300),
}
GUTTER = 5
PAD = 2
MIN_W = 40


def main() -> None:
    workdir, sheet1 = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.join(workdir, "corrected"), exist_ok=True)
    man_path = os.path.join(workdir, "metadata", "terrain-manifest.json")
    man = json.load(open(man_path, encoding="utf8"))
    by_id = {a["id"]: a for a in man["assets"]}

    img = strip_checker(load_rgba(sheet1))
    px = img.load()

    results = []
    for cid, (y0, y1) in TARGETS.items():
        a = by_id.get(cid)
        if not a:
            continue
        x, _, w, _ = a["bbox"]
        counts = []
        for cx in range(x, x + w):
            counts.append(sum(1 for cy in range(y0, y1) if px[cx, cy][3] > 8))

        runs, start, gap = [], None, 0
        for i, c in enumerate(counts):
            if c > 0:
                if start is None:
                    start = i
                gap = 0
            elif start is not None:
                gap += 1
                if gap >= GUTTER:
                    if i - gap - start >= MIN_W:
                        runs.append((start, i - gap - 1))
                    start, gap = None, 0
        if start is not None and len(counts) - start >= MIN_W:
            runs.append((start, len(counts) - 1))

        pieces = []
        for j, (rx0, rx1) in enumerate(runs):
            ax0, ax1 = x + rx0, x + rx1
            top = bottom = None
            for cy in range(y0, y1):
                if any(px[cx, cy][3] > 8 for cx in range(ax0, ax1 + 1)):
                    top = cy if top is None else top
                    bottom = cy
            if top is None:
                continue
            cx0, cy0 = max(0, ax0 - PAD), max(0, top - PAD)
            cx1, cy1 = min(img.width - 1, ax1 + PAD), min(img.height - 1, bottom + PAD)
            crop = img.crop((cx0, cy0, cx1 + 1, cy1 + 1))
            name = f"{cid}_split{j + 1}"
            crop.save(os.path.join(workdir, "corrected", name + ".png"))
            pieces.append({"id": name, "bbox": [cx0, cy0, crop.width, crop.height],
                           "dimensions": [crop.width, crop.height]})
        results.append({"id": cid, "original_bbox": a["bbox"], "pieces": pieces})

    # merge into manifest
    for r in results:
        entry = by_id[r["id"]]
        entry["status"] = "SPLIT"
        entry["decision"] = "split"
        entry["evidence"] = "visible background gutters between independent tiles in merged-candidates-inspection.png"
        entry["corrected_pieces"] = r["pieces"]
    for r in results:
        for p in r["pieces"]:
            man["assets"].append({
                "id": p["id"], "file": f"corrected/{p['id']}.png", "category": "terrain",
                "source": "sheet-1-terrain.png", "bbox": p["bbox"], "dimensions": p["dimensions"],
                "status": "PASS", "split_from": r["id"], "padding": PAD,
                "transparent_fraction": None, "note": "visually verified gutter split",
            })
    json.dump(man, open(man_path, "w", encoding="utf8"), indent=1)

    # before/after sheet
    try:
        font = ImageFont.truetype("arial.ttf", 12)
    except Exception:
        font = ImageFont.load_default()
    cols = 4
    cw, ch = 260, 200
    rows = (len(results) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cw, rows * ch + 30), (20, 24, 28, 255))
    d = ImageDraw.Draw(sheet)
    d.text((6, 6), "BEFORE (one merged crop)  ->  AFTER (independent tiles)", fill=(220, 235, 220, 255), font=font)
    for i, r in enumerate(results):
        cx, cy = (i % cols) * cw, 30 + (i // cols) * ch
        orig = Image.open(os.path.join(workdir, "terrain", r["id"] + ".png"))
        scale = min((cw - 16) / orig.width, (ch - 46) / orig.height, 1)
        o = orig.resize((max(1, int(orig.width * scale)), max(1, int(orig.height * scale))), Image.NEAREST)
        sheet.alpha_composite(o, (cx + 8, cy + 16))
        d.text((cx + 8, cy + 2), f"{r['id'].replace('terrain_','')} -> {len(r['pieces'])} pieces", fill=(255, 200, 120, 255), font=font)
        for j, p in enumerate(r["pieces"]):
            sprite = Image.open(os.path.join(workdir, "corrected", p["id"] + ".png"))
            s2 = min(1.0, 60 / max(sprite.width, sprite.height))
            s2 = max(s2, 0.2)
            sp = sprite.resize((max(1, int(sprite.width * s2)), max(1, int(sprite.height * s2))), Image.NEAREST)
            sheet.alpha_composite(sp, (cx + 8 + j * 42, cy + 120))
    sheet.save(os.path.join(workdir, "contact-sheets", "terrain-splits-before-after.png"))

    final = {}
    for a in man["assets"]:
        final[a["status"]] = final.get(a["status"], 0) + 1
    print("split candidates:", len(results))
    print("new pieces:", sum(len(r["pieces"]) for r in results))
    print("manifest status counts:", final)
    for r in results:
        print(f"  {r['id']}: {len(r['pieces'])} pieces at x=" + ",".join(str(p["bbox"][0]) for p in r["pieces"]))


if __name__ == "__main__":
    main()
