"""Extract individual assets from the NABTA AI-generated sheet.

The sheet is irregular, so this does NOT assume a grid. It:

  1. removes the near-white background to alpha, keeping a small tolerance so
     anti-aliased edges survive,
  2. groups pixels into connected components (8-connectivity) within a padded
     alpha mask, so a sprite's own shadow/leaves stay attached,
  3. merges components that overlap horizontally and sit close vertically, which
     keeps multi-row objects like the cabin roof + body together,
  4. writes each component as PNG plus a manifest entry,
  5. builds a labelled contact sheet for visual inspection.

Output goes to a STAGING directory, never into public/assets: nothing is
integrated until every sprite has been reviewed.
"""
from __future__ import annotations

import json
import os
import sys
from collections import deque

from PIL import Image, ImageDraw

SRC = sys.argv[1]
OUT = sys.argv[2]
WHITE_TOLERANCE = 18      # 0-255 distance from pure white treated as background
MIN_AREA = 260            # ignore stray speckles
PAD = 1                   # keep 1px of outline margin


def to_rgba(path: str) -> Image.Image:
    """Remove only the background that is connected to the image border.

    A blanket "every light pixel becomes transparent" pass also erases white
    *inside* sprites (eyes, gem highlights, tile rims) and leaves the objects
    touching each other. Flood filling from the edges removes the backdrop and
    nothing else.
    """
    img = Image.open(path).convert("RGBA")
    px = img.load()
    w, h = img.size

    def is_background(c) -> bool:
        r, g, b, a = c
        if a == 0:
            return True
        if r < 255 - WHITE_TOLERANCE or g < 255 - WHITE_TOLERANCE or b < 255 - WHITE_TOLERANCE:
            return False
        return (max(r, g, b) - min(r, g, b)) <= 10

    seen = bytearray(w * h)
    q: deque = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and is_background(px[x, y]):
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and is_background(px[x, y]):
                seen[y * w + x] = 1
                q.append((x, y))

    while q:
        cx, cy = q.popleft()
        px[cx, cy] = (px[cx, cy][0], px[cx, cy][1], px[cx, cy][2], 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if nx < 0 or ny < 0 or nx >= w or ny >= h or seen[ny * w + nx]:
                continue
            seen[ny * w + nx] = 1
            if is_background(px[nx, ny]):
                q.append((nx, ny))

    return img


def components(img: Image.Image):
    w, h = img.size
    px = img.load()
    seen = bytearray(w * h)
    boxes = []
    for y in range(h):
        for x in range(w):
            if seen[y * w + x]:
                continue
            if px[x, y][3] < 8:
                seen[y * w + x] = 1
                continue
            q = deque([(x, y)])
            seen[y * w + x] = 1
            minx = maxx = x
            miny = maxy = y
            area = 0
            while q:
                cx, cy = q.popleft()
                area += 1
                if cx < minx: minx = cx
                if cx > maxx: maxx = cx
                if cy < miny: miny = cy
                if cy > maxy: maxy = cy
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if nx < 0 or ny < 0 or nx >= w or ny >= h:
                            continue
                        idx = ny * w + nx
                        if seen[idx]:
                            continue
                        if px[nx, ny][3] >= 8:
                            seen[idx] = 1
                            q.append((nx, ny))
                        else:
                            seen[idx] = 1
            if area >= MIN_AREA:
                boxes.append([minx, miny, maxx, maxy, area])
    return boxes


def merge_near(boxes):
    """Merge boxes that clearly belong to one object (stacked rows of a building)."""
    boxes = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                ax1, ay1, ax2, ay2, aa = boxes[i]
                bx1, by1, bx2, by2, ba = boxes[j]
                h_overlap = min(ax2, bx2) - max(ax1, bx1)
                v_gap = max(ay1, by1) - min(ay2, by2)
                narrower = min(ax2 - ax1, bx2 - bx1)
                if h_overlap > narrower * 0.55 and -3 <= v_gap <= 3:
                    boxes[i] = [min(ax1, bx1), min(ay1, by1), max(ax2, bx2), max(ay2, by2), aa + ba]
                    boxes.pop(j)
                    changed = True
                    break
            if changed:
                break
    return boxes


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    img = to_rgba(SRC)
    W, H = img.size
    boxes = merge_near(components(img))
    boxes.sort(key=lambda b: (b[1] // 16, b[0]))

    entries = []
    for i, (x1, y1, x2, y2, area) in enumerate(boxes):
        cx1 = max(0, x1 - PAD)
        cy1 = max(0, y1 - PAD)
        cx2 = min(W - 1, x2 + PAD)
        cy2 = min(H - 1, y2 + PAD)
        crop = img.crop((cx1, cy1, cx2 + 1, cy2 + 1))
        name = f"asset_{i:03d}_{cx2 - cx1 + 1}x{cy2 - cy1 + 1}"
        crop.save(os.path.join(OUT, name + ".png"))
        entries.append({
            "name": name,
            "x": cx1, "y": cy1,
            "width": cx2 - cx1 + 1,
            "height": cy2 - cy1 + 1,
            "pixels": area,
            "source": "ai-generated-nabta-asset-sheet",
            "background": "transparent",
            "reviewed": False,
        })

    with open(os.path.join(OUT, "extraction-map.json"), "w", encoding="utf8") as fh:
        json.dump({"source": "ai-generated-nabta-asset-sheet", "sourceSize": [W, H], "assets": entries}, fh, indent=1)

    # Contact sheet with index labels so every crop can be checked by eye.
    cols = 12
    cell = 140
    rows = (len(entries) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (32, 40, 44, 255))
    draw = ImageDraw.Draw(sheet)
    for i, entry in enumerate(entries):
        sprite = Image.open(os.path.join(OUT, entry["name"] + ".png"))
        scale = min((cell - 24) / sprite.width, (cell - 24) / sprite.height, 4)
        if scale <= 0:
            scale = 1
        resized = sprite.resize((max(1, int(sprite.width * scale)), max(1, int(sprite.height * scale))), Image.NEAREST)
        cx = (i % cols) * cell
        cy = (i // cols) * cell
        sheet.alpha_composite(resized, (cx + (cell - resized.width) // 2, cy + 14 + (cell - 14 - resized.height) // 2))
        draw.text((cx + 4, cy + 2), f"{i} {sprite.width}x{sprite.height}", fill=(200, 220, 200, 255))
    sheet.save(os.path.join(OUT, "contact-sheet.png"))

    print(f"source {W}x{H}")
    print(f"components kept: {len(entries)}")
    sizes = sorted({(e['width'], e['height']) for e in entries})
    print(f"distinct sizes: {len(sizes)}")
    print("largest:", sorted(entries, key=lambda e: e['width'] * e['height'], reverse=True)[:5])


if __name__ == "__main__":
    main()
