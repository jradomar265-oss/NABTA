from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


SHEETS = {
    "free_pixel_16_woods.png": "objects",
    "forest_demo_objects.png": "objects",
    "forest_demo_terrain.png": "terrain",
}
GRID_CANDIDATES = (8, 16, 32, 64)
PREVIEW_SCALE = 3


def repository_path(path: Path, repository_root: Path) -> str:
    return path.resolve().relative_to(repository_root.resolve()).as_posix()


def find_components(image: Image.Image) -> list[dict[str, int]]:
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    visited = bytearray(width * height)
    components: list[dict[str, int]] = []

    for start, value in enumerate(alpha):
        if value == 0 or visited[start]:
            continue

        visited[start] = 1
        pending = [start]
        left = right = start % width
        top = bottom = start // width
        area = 0

        while pending:
            index = pending.pop()
            x, y = index % width, index // width
            area += 1
            left, right = min(left, x), max(right, x)
            top, bottom = min(top, y), max(bottom, y)

            for offset_y in (-1, 0, 1):
                for offset_x in (-1, 0, 1):
                    if offset_x == 0 and offset_y == 0:
                        continue
                    neighbor_x = x + offset_x
                    neighbor_y = y + offset_y
                    if 0 <= neighbor_x < width and 0 <= neighbor_y < height:
                        neighbor = neighbor_y * width + neighbor_x
                        if alpha[neighbor] and not visited[neighbor]:
                            visited[neighbor] = 1
                            pending.append(neighbor)

        components.append(
            {
                "x": left,
                "y": top,
                "width": right - left + 1,
                "height": bottom - top + 1,
                "alpha_pixel_count": area,
            }
        )

    return sorted(components, key=lambda component: (component["y"], component["x"]))


def composite_checkerboard(image: Image.Image) -> Image.Image:
    width, height = image.size
    background = Image.new("RGBA", image.size, (226, 231, 226, 255))
    draw = ImageDraw.Draw(background)
    cell_size = 8
    alternate = (194, 203, 195, 255)

    for y in range(0, height, cell_size):
        for x in range(0, width, cell_size):
            if (x // cell_size + y // cell_size) % 2:
                draw.rectangle(
                    (x, y, min(x + cell_size - 1, width - 1), min(y + cell_size - 1, height - 1)),
                    fill=alternate,
                )

    return Image.alpha_composite(background, image.convert("RGBA")).convert("RGB")


def save_component_preview(
    image: Image.Image,
    components: list[dict[str, Any]],
    output_path: Path,
) -> None:
    width, height = image.size
    preview = composite_checkerboard(image).resize(
        (width * PREVIEW_SCALE, height * PREVIEW_SCALE),
        resample=Image.Resampling.NEAREST,
    )
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default()
    colors = ((220, 57, 48), (22, 111, 190), (119, 68, 160), (0, 129, 99), (201, 111, 0))

    for index, component in enumerate(components, start=1):
        x = component["x"] * PREVIEW_SCALE
        y = component["y"] * PREVIEW_SCALE
        right = (component["x"] + component["width"] - 1) * PREVIEW_SCALE
        bottom = (component["y"] + component["height"] - 1) * PREVIEW_SCALE
        color = colors[(index - 1) % len(colors)]
        draw.rectangle((x, y, right, bottom), outline=color, width=2)
        label = f"C{index:02}"
        text_bounds = draw.textbbox((0, 0), label, font=font)
        text_width = text_bounds[2] - text_bounds[0]
        text_height = text_bounds[3] - text_bounds[1]
        label_x = min(x, max(0, preview.width - text_width - 4))
        label_y = max(0, y - text_height - 4)
        draw.rectangle(
            (label_x, label_y, label_x + text_width + 4, label_y + text_height + 3),
            fill=color,
        )
        draw.text((label_x + 2, label_y + 1), label, fill="white", font=font)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output_path)


def save_grid_preview(image: Image.Image, tile_size: int, output_path: Path) -> None:
    width, height = image.size
    preview = composite_checkerboard(image).resize(
        (width * PREVIEW_SCALE, height * PREVIEW_SCALE),
        resample=Image.Resampling.NEAREST,
    )
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default()
    line_color = (212, 48, 48)

    for x in range(0, width + 1, tile_size):
        position = min(x * PREVIEW_SCALE, preview.width - 1)
        draw.line((position, 0, position, preview.height - 1), fill=line_color, width=1)
    for y in range(0, height + 1, tile_size):
        position = min(y * PREVIEW_SCALE, preview.height - 1)
        draw.line((0, position, preview.width - 1, position), fill=line_color, width=1)

    for y in range(0, height, tile_size):
        for x in range(0, width, tile_size):
            label = f"{x},{y}"
            draw.text(
                (x * PREVIEW_SCALE + 2, y * PREVIEW_SCALE + 2),
                label,
                fill=(20, 32, 26),
                font=font,
                stroke_width=1,
                stroke_fill=(255, 255, 255),
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output_path)


def inspect_sheet(
    filename: str,
    category: str,
    source_dir: Path,
    output_dir: Path,
    repository_root: Path,
) -> dict[str, Any]:
    source_path = source_dir / filename
    if not source_path.is_file():
        raise FileNotFoundError(f"Required source sheet is missing: {source_path}")

    image = Image.open(source_path).convert("RGBA")
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    alpha_counts = Counter(alpha)
    sheet_id = source_path.stem

    result: dict[str, Any] = {
        "id": sheet_id,
        "source_file": filename,
        "source_path": repository_path(source_path, repository_root),
        "source_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "category": category,
        "dimensions": {"width": width, "height": height},
        "mode": "RGBA",
        "alpha": {
            "minimum": min(alpha),
            "maximum": max(alpha),
            "transparent_pixel_count": alpha_counts[0],
            "opaque_pixel_count": alpha_counts[255],
            "partial_alpha_pixel_count": sum(
                count for value, count in alpha_counts.items() if value not in (0, 255)
            ),
            "partial_alpha_values": sorted(
                value for value in alpha_counts if value not in (0, 255)
            ),
        },
    }

    preview_dir = output_dir / "previews"
    if category == "objects":
        candidates = find_components(image)
        component_dir = output_dir / "sprites" / "candidates" / sheet_id
        component_dir.mkdir(parents=True, exist_ok=True)
        for index, component in enumerate(candidates, start=1):
            component_id = f"{sheet_id}_component_{index:03d}"
            export_path = component_dir / f"{component_id}.png"
            x, y = component["x"], component["y"]
            crop = image.crop((x, y, x + component["width"], y + component["height"]))
            crop.save(export_path)
            component.update(
                {
                    "id": component_id,
                    "exported_file": repository_path(export_path, repository_root),
                    "review_status": "pending_manual_review",
                    "is_approved_asset": False,
                }
            )

        preview_path = preview_dir / f"{sheet_id}-components.png"
        save_component_preview(image, candidates, preview_path)
        result["component_count"] = len(candidates)
        result["components"] = candidates
        result["preview_file"] = repository_path(preview_path, repository_root)
        result["review_note"] = (
            "8-connected alpha regions are candidate crops only. Check the numbered preview "
            "for touching sprites, grouped props, or detached shadows before approval."
        )
    else:
        grid_candidates = []
        for tile_size in GRID_CANDIDATES:
            grid_path = preview_dir / f"{sheet_id}-grid-{tile_size}.png"
            save_grid_preview(image, tile_size, grid_path)
            grid_candidates.append(
                {
                    "tile_size_candidate": tile_size,
                    "columns": (width + tile_size - 1) // tile_size,
                    "rows": (height + tile_size - 1) // tile_size,
                    "preview_file": repository_path(grid_path, repository_root),
                    "review_status": "candidate_not_confirmed",
                }
            )
        result["tile_grid_candidates"] = grid_candidates
        result["component_extraction"] = "not_performed_for_terrain"
        result["review_note"] = "Confirm the actual terrain grid visually before slicing any tiles."

    return result


def main() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description="Inspect NABTA Pixel Art source sheets.")
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=repository_root / "public/assets/nabta/world/source",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=repository_root / "public/assets/nabta/world",
    )
    args = parser.parse_args()

    manifest = {
        "schema_version": 1,
        "pixel_scaling": "nearest-neighbor previews only; source pixels are unchanged",
        "sheets": [
            inspect_sheet(
                filename,
                category,
                args.source_dir,
                args.output_dir,
                repository_root,
            )
            for filename, category in SHEETS.items()
        ],
    }
    manifest_path = args.output_dir / "manifests" / "asset-analysis.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    for sheet in manifest["sheets"]:
        summary = f"{sheet['source_file']}: {sheet['dimensions']['width']}x{sheet['dimensions']['height']}"
        if sheet["category"] == "objects":
            summary += f", {sheet['component_count']} candidate components"
        else:
            summary += f", {len(sheet['tile_grid_candidates'])} unconfirmed grid previews"
        print(summary)
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()