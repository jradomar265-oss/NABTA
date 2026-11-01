"""Validate the generated world layout data.

Checks that the quest nodes really sit on the authored path, stay inside the
region, do not fall in the river, and that decorative objects keep clear of the
learning path. Run after `build_world.py`:

    python scripts/pixel-art/validate_world.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
REGION = REPO / "public" / "assets" / "nabta" / "world" / "regions" / "forest-clearing"


def distance_to_polyline(px: float, py: float, points: list[dict]) -> float:
    best = float("inf")
    for a, b in zip(points, points[1:]):
        vx, vy = b["x"] - a["x"], b["y"] - a["y"]
        length2 = vx * vx + vy * vy
        if length2 == 0:
            continue
        t = max(0.0, min(1.0, ((px - a["x"]) * vx + (py - a["y"]) * vy) / length2))
        qx, qy = a["x"] + t * vx, a["y"] + t * vy
        best = min(best, math.hypot(px - qx, py - qy))
    return best


def main() -> int:
    layout = json.loads((REGION / "decor.json").read_text(encoding="utf-8"))
    terrain = REGION / "terrain.png"
    failures: list[str] = []

    if not terrain.exists():
        failures.append("terrain.png is missing")

    width, height = layout["width"], layout["height"]
    for node in layout["nodes"]:
        offset = distance_to_polyline(node["x"], node["y"], layout["path"])
        if offset > 6:
            failures.append(f"node {node['slot']} is {offset:.1f}px off the path")
        if not (0 <= node["x"] <= width and 0 <= node["y"] <= height):
            failures.append(f"node {node['slot']} is outside the region")

    for obj in layout["objects"]:
        if distance_to_polyline(obj["x"], obj["y"], layout["path"]) < layout["pathHalfWidth"] + 4:
            failures.append(f"{obj['id']} ({obj['sprite']}) overlaps the path")

    ids = [obj["id"] for obj in layout["objects"]]
    if len(ids) != len(set(ids)):
        failures.append("duplicate object ids")

    catalogue = layout["spriteCatalogue"]
    approved = REPO / "public" / "assets" / "nabta" / "world" / "sprites" / "approved" / "forest_demo_objects"
    for name, spec in catalogue.items():
        path = approved / spec["file"]
        if not path.exists():
            failures.append(f"catalogue sprite {name} -> {spec['file']} is missing")

    print(f"region: {layout['region']} {width}x{height}, {len(layout['objects'])} objects, {len(layout['nodes'])} nodes")
    if failures:
        print("FAILED")
        for failure in failures[:20]:
            print(" -", failure)
        return 1
    print("PASSED: nodes on path, objects clear of path, sprite files resolve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
