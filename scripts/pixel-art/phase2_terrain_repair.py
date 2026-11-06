"""Terrain repair pass: reconcile, split merged runs by measured pitch, validate
interior whites on a gem sample.

    python phase2_terrain_repair.py <workdir> <sheet1> <sheet4>
"""
from __future__ import annotations

import json
import os
import statistics
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from phase2_terrain import load_rgba, strip_checker, comparison  # noqa: E402

PAD = 2


def opaque(px, x, y) -> bool:
    return px[x, y][3] > 8


def tighten(img, x0, x1, y0, y1):
    px = img.load()
    left = right = top = bottom = None
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            if opaque(px, x, y):
                left = x if left is None else left
                right = x
                top = y if top is None else top
                bottom = y if bottom is None else bottom
                break
    if left is None:
        return None
    return left, top, right, bottom


def main() -> None:
    workdir, sheet1, sheet4 = sys.argv[1], sys.argv[2], sys.argv[3]
    man_path = os.path.join(workdir, "metadata", "terrain-manifest.json")
    man = json.load(open(man_path, encoding="utf8"))
    assets = man["assets"]

    # ---------- 1. reconcile exactly ----------
    by_status: dict[str, list[str]] = {}
    for a in assets:
        by_status.setdefault(a["status"], []).append(a["id"])
    print("RECONCILE total:", len(assets))
    for status, ids in by_status.items():
        print(f"  {status}: {len(ids)}")
    print("  REVIEW ids:", ", ".join(sorted(by_status.get("REVIEW", []))))

    # ---------- 2. measured pitch per band ----------
    bands: dict[str, list[dict]] = {}
    for a in assets:
        band = a["id"].split("_")[1] if a["id"].startswith("terrain_") else "?"
        # ids look like terrain_<band>_<nn>; band may contain underscores
        parts = a["id"].replace("terrain_", "").rsplit("_", 1)[0]
        bands.setdefault(parts, []).append(a)

    pitch_evidence = {}
    pitches: dict[str, float] = {}
    for band, items in bands.items():
        xs = sorted(i["bbox"][0] for i in items)
        gaps = [b - a for a, b in zip(xs, xs[1:]) if b - a > 20]
        clean = [i["dimensions"][0] for i in items if i["status"] == "PASS"]
        if gaps:
            pitches[band] = statistics.median(gaps)
            pitch_evidence[band] = {
                "pitch": pitches[band],
                "evidence": f"median gap between {len(gaps)} consecutive run x-origins",
                "clean_tile_widths": clean,
            }
    print("PITCH:", json.dumps(pitch_evidence, indent=1))

    # ---------- 3. split over-wide runs ----------
    src = load_rgba(sheet1)
    cleaned = strip_checker(src)
    repaired, dropped = [], []
    for a in assets:
        band = a["id"].replace("terrain_", "").rsplit("_", 1)[0]
        pitch = pitches.get(band)
        x, y, w, h = a["bbox"]
        if not pitch or w < pitch * 1.55:
            repaired.append(a)
            continue
        k = round(w / pitch)
        if k < 2:
            repaired.append(a)
            continue
        # only split when the width is close to a whole number of pitches
        if abs(w / pitch - k) > 0.12:
            a["status"] = "REVIEW"
            a["note"] = f"width {w} is {w / pitch:.2f} pitches — not a supported split"
            repaired.append(a)
            continue
        dropped.append(a["id"])
        step = w / k
        for j in range(k):
            sx = int(round(x + j * step))
            ex = int(round(x + (j + 1) * step)) - 1
            box = tighten(cleaned, sx, ex, y, y + h - 1)
            if not box:
                continue
            l, t, r, b = box
            cx0, cy0 = max(0, l - PAD), max(0, t - PAD)
            cx1, cy1 = min(cleaned.width - 1, r + PAD), min(cleaned.height - 1, b + PAD)
            crop = cleaned.crop((cx0, cy0, cx1 + 1, cy1 + 1))
            name = f"{a['id']}_s{j + 1}"
            crop.save(os.path.join(workdir, "terrain", name + ".png"))
            crop.save(os.path.join(workdir, "cleaned", name + ".png"))
            px = crop.load()
            border = sum(1 for ccx in range(crop.width) for ccy in (0, crop.height - 1) if opaque(px, ccx, ccy))
            border += sum(1 for ccy in range(crop.height) for ccx in (0, crop.width - 1) if opaque(px, ccx, ccy))
            repaired.append({
                "id": name, "file": f"terrain/{name}.png", "category": "terrain",
                "source": "sheet-1-terrain.png", "source_size": [src.width, src.height],
                "bbox": [cx0, cy0, crop.width, crop.height], "dimensions": [crop.width, crop.height],
                "transparent_fraction": 0.0, "border_pixels": border, "padding": PAD,
                "status": "PASS" if border == 0 else "REVIEW",
                "split_from": a["id"], "pitch": pitch,
            })

    # drop the old merged files that were replaced
    for old in set(dropped):
        for folder in ("terrain", "cleaned"):
            p = os.path.join(workdir, folder, old + ".png")
            if os.path.exists(p):
                os.remove(p)

    json.dump({"source": "sheet-1-terrain.png", "repaired": True,
               "pitch_evidence": pitch_evidence, "assets": repaired},
              open(man_path, "w", encoding="utf8"), indent=1)

    final = {}
    for a in repaired:
        final.setdefault(a["status"], []).append(a["id"])
    print("AFTER total:", len(repaired), {k: len(v) for k, v in final.items()})
    print("split runs:", sorted(set(dropped)))

    # ---------- 4. contact sheet ----------
    cols, cw, ch = 6, 230, 210
    rows = (len(repaired) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cw, rows * ch), (22, 26, 30, 255))
    draw = ImageDraw.Draw(sheet)
    for cy in range(0, sheet.height, 16):
        for cx in range(0, sheet.width, 16):
            if (cx // 16 + cy // 16) % 2 == 0:
                draw.rectangle([cx, cy, cx + 15, cy + 15], fill=(40, 46, 52, 255))
    for i, a in enumerate(repaired):
        sprite = Image.open(os.path.join(workdir, a["file"]))
        scale = min((cw - 16) / sprite.width, (ch - 34) / sprite.height, 2)
        r = sprite.resize((max(1, int(sprite.width * scale)), max(1, int(sprite.height * scale))), Image.NEAREST)
        cx, cy = (i % cols) * cw, (i // cols) * ch
        sheet.alpha_composite(r, (cx + (cw - r.width) // 2, cy + 28 + (ch - 28 - r.height) // 2))
        draw.text((cx + 4, cy + 3), a["id"].replace("terrain_", "")[:26], fill=(210, 230, 210, 255))
        draw.text((cx + 4, cy + 14), f"{a['dimensions'][0]}x{a['dimensions'][1]} {a['status']}", fill=(170, 200, 170, 255))
    sheet.save(os.path.join(workdir, "contact-sheets", "terrain-repaired.png"))

    # ---------- 5. interior white validation on the shrine gem ----------
    s4 = strip_checker(load_rgba(sheet4))
    raw4 = load_rgba(sheet4)
    gem_box = (700, 60, 90, 110)   # gem inside the gateway shrine
    before = raw4.crop((gem_box[0], gem_box[1], gem_box[0] + gem_box[2], gem_box[1] + gem_box[3]))
    after = s4.crop((gem_box[0], gem_box[1], gem_box[0] + gem_box[2], gem_box[1] + gem_box[3]))
    before.save(os.path.join(workdir, "raw", "gem_sample.png"))
    after.save(os.path.join(workdir, "cleaned", "gem_sample.png"))
    px = after.load()
    bright = sum(1 for y in range(after.height) for x in range(after.width)
                 if px[x, y][3] > 8 and min(px[x, y][:3]) > 200)
    white = sum(1 for y in range(after.height) for x in range(after.width)
                if px[x, y][3] > 8 and min(px[x, y][:3]) > 240)
    comparison(workdir, [("gem_sample", before, after)])
    print("GEM interior bright(>200):", bright, "near-white(>240):", white)
    json.dump({"gem_sample": {"bright_gt200": bright, "near_white_gt240": white}},
              open(os.path.join(workdir, "metadata", "interior-white-validation.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
