"""Phase 2 — background removal + band-constrained terrain extraction.

    python phase2_terrain.py validate <workdir> <sheet1>
    python phase2_terrain.py terrain  <workdir> <sheet1>

Background: the sheets are opaque RGB with a two-tone grey checkerboard painted in.
Removal is a flood fill from the borders with a tight tolerance, so interior whites
(eyes, gems, highlights, pale stone) survive untouched.

Extraction: full-image connected components fail on these sheets because objects are
adjacent. Rows, however, are reliably separated by background gutters, so each row is
processed as a band and the columns inside it are segmented by vertical gutters.
"""
from __future__ import annotations

import json
import os
import sys
from collections import deque

from PIL import Image, ImageDraw

CHECKER_TOL = 6          # per-channel tolerance around the checkerboard greys
GUTTER = 6               # min background columns between two tiles in a band
MIN_RUN = 24             # ignore slivers
PAD = 2


def load_rgba(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


def _is_checker(c) -> bool:
    """Checkerboard greys sit around 226-234 and are near-neutral."""
    r, g, b, a = c
    if a == 0:
        return True
    if max(abs(r - 230), abs(g - 230), abs(b - 230)) > 12:
        return False
    return (max(r, g, b) - min(r, g, b)) <= 6


def strip_checker(img: Image.Image) -> Image.Image:
    out = img.copy()
    px = out.load()
    w, h = out.size
    seen = bytearray(w * h)
    q: deque = deque()

    def seed(x: int, y: int) -> None:
        if seen[y * w + x]:
            return
        seen[y * w + x] = 1
        if _is_checker(px[x, y]):
            q.append((x, y))

    for x in range(w):
        seed(x, 0)
        seed(x, h - 1)
    for y in range(h):
        seed(0, y)
        seed(w - 1, y)

    while q:
        cx, cy = q.popleft()
        px[cx, cy] = (px[cx, cy][0], px[cx, cy][1], px[cx, cy][2], 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx]:
                seen[ny * w + nx] = 1
                if _is_checker(px[nx, ny]):
                    q.append((nx, ny))
    return out


def opaque_columns(img: Image.Image, y0: int, y1: int) -> list[int]:
    px = img.load()
    counts = []
    for x in range(img.width):
        c = 0
        for y in range(y0, y1):
            if px[x, y][3] > 8:
                c += 1
        counts.append(c)
    return counts


def runs_from(counts: list[int]) -> list[tuple[int, int]]:
    runs, start, gap = [], None, 0
    for x, c in enumerate(counts):
        if c > 0:
            if start is None:
                start = x
            gap = 0
        else:
            if start is not None:
                gap += 1
                if gap >= GUTTER:
                    if x - gap - start >= MIN_RUN:
                        runs.append((start, x - gap - 1))
                    start, gap = None, 0
    if start is not None and len(counts) - start >= MIN_RUN:
        runs.append((start, len(counts) - 1))
    return runs


def tight_y(img: Image.Image, x0: int, x1: int, y0: int, y1: int) -> tuple[int, int]:
    px = img.load()
    top, bottom = None, None
    for y in range(y0, y1):
        for x in range(x0, x1 + 1):
            if px[x, y][3] > 8:
                if top is None:
                    top = y
                bottom = y
                break
    if top is None:
        return y0, y1
    return top, bottom


def comparison(workdir: str, samples: list[tuple[str, Image.Image, Image.Image]]) -> None:
    cw, ch = 420, 300
    sheet = Image.new("RGBA", (cw * len(samples), ch * 2), (18, 22, 26, 255))
    draw = ImageDraw.Draw(sheet)
    for i, (name, before, after) in enumerate(samples):
        for row, (img, label) in enumerate(((before, "BEFORE"), (after, "AFTER"))):
            scale = min((cw - 20) / img.width, (ch - 40) / img.height, 3)
            r = img.resize((int(img.width * scale), int(img.height * scale)), Image.NEAREST)
            bg = (60, 60, 60, 255) if row == 0 else (24, 26, 30, 255)
            tile = Image.new("RGBA", (cw, ch), bg)
            # checker for row 0, dark for row 1, so both backgrounds are judged
            d2 = ImageDraw.Draw(tile)
            for cy in range(0, ch, 16):
                for cx in range(0, cw, 16):
                    if (cx // 16 + cy // 16) % 2 == 0:
                        d2.rectangle([cx, cy, cx + 15, cy + 15], fill=(210, 214, 218, 255))
            if row == 1:
                d2.rectangle([0, 0, cw, ch], fill=(22, 24, 28, 255))
            tile.alpha_composite(r, ((cw - r.width) // 2, 26 + (ch - 26 - r.height) // 2))
            draw.text((8, 6), f"{label} {name} {img.width}x{img.height}", fill=(230, 240, 230, 255))
            sheet.alpha_composite(tile, (i * cw, row * ch))
    sheet.save(os.path.join(workdir, "contact-sheets", "bg-removal-validation.png"))


def main() -> None:
    mode, workdir, sheet1 = sys.argv[1], sys.argv[2], sys.argv[3]
    for d in ["raw", "cleaned", "terrain", "contact-sheets", "metadata"]:
        os.makedirs(os.path.join(workdir, d), exist_ok=True)

    src = load_rgba(sheet1)
    cleaned = strip_checker(src)

    if mode == "validate":
        boxes = [
            ("cliff_lip_original", 25, 330, 145, 145),
            ("lily_pads_original", 25, 790, 130, 95),
            ("crate_barrel_original", 20, 590, 230, 110),
        ]
        samples = []
        for name, x, y, w, h in boxes:
            a = src.crop((x, y, x + w, y + h))
            b = cleaned.crop((x, y, x + w, y + h))
            a.save(os.path.join(workdir, "raw", f"{name}.png"))
            b.save(os.path.join(workdir, "cleaned", f"{name}_clean.png"))
            samples.append((name, a, b))
        comparison(workdir, samples)
        # report interior white preservation: count opaque near-white pixels in each
        report = []
        for name, _, b in samples:
            px = b.load()
            whites = sum(1 for yy in range(b.height) for xx in range(b.width)
                         if px[xx, yy][3] > 8 and min(px[xx, yy][:3]) > 240)
            report.append({"sample": name, "interior_near_white_px": whites,
                           "opaque_px": sum(1 for yy in range(b.height) for xx in range(b.width) if px[xx, yy][3] > 8)})
        json.dump(report, open(os.path.join(workdir, "metadata", "bg-validation.json"), "w"), indent=1)
        print(json.dumps(report, indent=1))
        return

    # --- terrain extraction: band-constrained column segmentation ---
    BANDS = [
        ("grass", 10, 172),
        ("transition", 176, 326),
        ("cliff_lip_a", 330, 470),
        ("cliff_lip_b", 468, 610),
        ("cliff_tall", 600, 740),
        ("plateau", 750, 975),
    ]
    manifest = []
    for band_name, y0, y1 in BANDS:
        counts = opaque_columns(cleaned, y0, y1)
        for idx, (x0, x1) in enumerate(runs_from(counts)):
            top, bottom = tight_y(cleaned, x0, x1, y0, y1)
            cx0, cy0 = max(0, x0 - PAD), max(0, top - PAD)
            cx1, cy1 = min(cleaned.width - 1, x1 + PAD), min(cleaned.height - 1, bottom + PAD)
            crop = cleaned.crop((cx0, cy0, cx1 + 1, cy1 + 1))
            name = f"terrain_{band_name}_{idx + 1:02d}"
            out = os.path.join(workdir, "terrain", name + ".png")
            crop.save(out)
            crop.save(os.path.join(workdir, "cleaned", name + ".png"))

            px = crop.load()
            border = sum(1 for cx in range(crop.width) for cy in (0, crop.height - 1) if px[cx, cy][3] > 8)
            border += sum(1 for cy in range(crop.height) for cx in (0, crop.width - 1) if px[cx, cy][3] > 8)
            transparent = sum(1 for cy in range(0, crop.height, 3) for cx in range(0, crop.width, 3) if px[cx, cy][3] == 0)
            total = len(range(0, crop.height, 3)) * len(range(0, crop.width, 3))
            manifest.append({
                "id": name, "file": f"terrain/{name}.png", "category": "terrain",
                "source": "sheet-1-terrain.png", "source_size": [src.width, src.height],
                "bbox": [cx0, cy0, crop.width, crop.height], "dimensions": [crop.width, crop.height],
                "transparent_fraction": round(transparent / total, 3) if total else 0,
                "border_pixels": border, "padding": PAD,
                "status": "PASS" if border == 0 else "REVIEW",
            })

    json.dump({"source": "sheet-1-terrain.png", "assets": manifest},
              open(os.path.join(workdir, "metadata", "terrain-manifest.json"), "w"), indent=1)

    # contact sheet
    cols = 6
    cw, ch = 230, 210
    rows = (len(manifest) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cw, rows * ch), (22, 26, 30, 255))
    draw = ImageDraw.Draw(sheet)
    for cy in range(0, sheet.height, 16):
        for cx in range(0, sheet.width, 16):
            if (cx // 16 + cy // 16) % 2 == 0:
                draw.rectangle([cx, cy, cx + 15, cy + 15], fill=(40, 46, 52, 255))
    for i, entry in enumerate(manifest):
        sprite = Image.open(os.path.join(workdir, entry["file"]))
        scale = min((cw - 16) / sprite.width, (ch - 34) / sprite.height, 2)
        r = sprite.resize((max(1, int(sprite.width * scale)), max(1, int(sprite.height * scale))), Image.NEAREST)
        cx, cy = (i % cols) * cw, (i // cols) * ch
        sheet.alpha_composite(r, (cx + (cw - r.width) // 2, cy + 28 + (ch - 28 - r.height) // 2))
        draw.text((cx + 4, cy + 3), entry["id"].replace("terrain_", ""), fill=(210, 230, 210, 255))
        draw.text((cx + 4, cy + 14), f"{entry['dimensions'][0]}x{entry['dimensions'][1]} {entry['status']}", fill=(170, 200, 170, 255))
    sheet.save(os.path.join(workdir, "contact-sheets", "terrain.png"))

    print("terrain assets:", len(manifest))
    print("PASS:", sum(1 for m in manifest if m["status"] == "PASS"),
          "REVIEW:", sum(1 for m in manifest if m["status"] == "REVIEW"))


if __name__ == "__main__":
    main()
