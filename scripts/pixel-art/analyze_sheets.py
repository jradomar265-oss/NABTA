from __future__ import annotations

import argparse
import hashlib
import json
import re
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
BEST_FIT_TERRAIN_TILE_SIZE = 16
PREVIEW_SCALE = 3


def repository_path(path: Path, repository_root: Path) -> str:
    return path.resolve().relative_to(repository_root.resolve()).as_posix()


def validate_manual_regions(
    image_size: tuple[int, int], regions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    image_width, image_height = image_size
    validated: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    if not isinstance(regions, list):
        raise ValueError("Manual regions for each sheet must be a list.")

    for region in regions:
        if not isinstance(region, dict):
            raise ValueError("Each manual region must be a JSON object.")
        region_id = region.get("id")
        if not isinstance(region_id, str) or not region_id.strip():
            raise ValueError("Each manual region must have a non-empty id.")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", region_id):
            raise ValueError(f"Manual region id is not a safe filename: {region_id}")
        if region_id in seen_ids:
            raise ValueError(f"Duplicate manual region id: {region_id}")
        seen_ids.add(region_id)

        coordinates: dict[str, int] = {}
        for field in ("x", "y", "width", "height"):
            value = region.get(field)
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"Manual region {region_id} has invalid {field}.")
            coordinates[field] = value

        x, y = coordinates["x"], coordinates["y"]
        width, height = coordinates["width"], coordinates["height"]
        if x < 0 or y < 0 or width <= 0 or height <= 0:
            raise ValueError(f"Manual region {region_id} has non-positive bounds.")
        if x + width > image_width or y + height > image_height:
            raise ValueError(f"Manual region {region_id} extends beyond the source sheet.")

        validated.append({"id": region_id, **coordinates})

    for index, region in enumerate(validated):
        overlaps = []
        for other_index, other in enumerate(validated):
            if index == other_index:
                continue
            x_overlap = region["x"] < other["x"] + other["width"] and other["x"] < region["x"] + region["width"]
            y_overlap = region["y"] < other["y"] + other["height"] and other["y"] < region["y"] + region["height"]
            if x_overlap and y_overlap:
                overlaps.append(other["id"])

        review_flags = []
        if overlaps:
            review_flags.append("overlaps_other_manual_region")
        if region["width"] >= 40 or region["height"] >= 40:
            review_flags.append("large_manual_region")
        region["overlaps_with"] = overlaps
        region["review_flags"] = review_flags

    return validated


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


def find_manual_coverage(
    image: Image.Image,
    component: dict[str, Any],
    manual_regions: list[dict[str, Any]],
) -> tuple[bool, list[str]]:
    alpha = image.getchannel("A").tobytes()
    image_width = image.width
    intersecting_ids: set[str] = set()
    uncovered_pixel_found = False
    component_x, component_y = component["x"], component["y"]

    for local_y in range(component["height"]):
        for local_x in range(component["width"]):
            source_x = component_x + local_x
            source_y = component_y + local_y
            if alpha[source_y * image_width + source_x] == 0:
                continue

            covering_regions = [
                region
                for region in manual_regions
                if region["x"] <= source_x < region["x"] + region["width"]
                and region["y"] <= source_y < region["y"] + region["height"]
            ]
            if not covering_regions:
                uncovered_pixel_found = True
            else:
                intersecting_ids.update(region["id"] for region in covering_regions)

    is_fully_covered = bool(intersecting_ids) and not uncovered_pixel_found
    return is_fully_covered, sorted(intersecting_ids)


def find_nonempty_tile_regions(image: Image.Image, tile_size: int) -> list[dict[str, int | str]]:
    alpha = image.getchannel("A")
    regions: list[dict[str, int | str]] = []
    rows = (image.height + tile_size - 1) // tile_size
    columns = (image.width + tile_size - 1) // tile_size

    for row in range(rows):
        for column in range(columns):
            x, y = column * tile_size, row * tile_size
            width = min(tile_size, image.width - x)
            height = min(tile_size, image.height - y)
            tile_alpha = alpha.crop((x, y, x + width, y + height)).tobytes()
            alpha_pixel_count = sum(value > 0 for value in tile_alpha)
            if alpha_pixel_count == 0:
                continue
            regions.append(
                {
                    "id": f"terrain16_r{row:02d}_c{column:02d}",
                    "row": row,
                    "column": column,
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                    "alpha_pixel_count": alpha_pixel_count,
                }
            )

    return regions


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
    manual_regions: list[dict[str, Any]],
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
        if component.get("review_status") == "superseded_by_manual_regions":
            continue
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

    for index, region in enumerate(manual_regions, start=1):
        x = region["x"] * PREVIEW_SCALE
        y = region["y"] * PREVIEW_SCALE
        right = (region["x"] + region["width"] - 1) * PREVIEW_SCALE
        bottom = (region["y"] + region["height"] - 1) * PREVIEW_SCALE
        approved = region.get("is_approved_asset", False)
        color = (37, 127, 79) if approved else (207, 32, 132)
        draw.rectangle((x, y, right, bottom), outline=color, width=3)
        label = f"A{index:02}" if approved else f"M{index:02}"
        text_bounds = draw.textbbox((0, 0), label, font=font)
        text_width = text_bounds[2] - text_bounds[0]
        text_height = text_bounds[3] - text_bounds[1]
        label_x = min(x, max(0, preview.width - text_width - 4))
        label_y = min(preview.height - text_height - 3, y + 2)
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
    configured_manual_regions: dict[str, list[dict[str, Any]]],
    approved_region_ids: set[str] | None = None,
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
        manual_regions = validate_manual_regions(
            (width, height), configured_manual_regions.get(filename, [])
        )
        approved_region_ids = approved_region_ids or set()
        known_region_ids = {region["id"] for region in manual_regions}
        unknown_approved_ids = approved_region_ids - known_region_ids
        if unknown_approved_ids:
            raise ValueError(
                f"Approved regions are not defined for {filename}: {sorted(unknown_approved_ids)}"
            )
        component_dir = output_dir / "sprites" / "candidates" / sheet_id
        component_dir.mkdir(parents=True, exist_ok=True)
        for index, component in enumerate(candidates, start=1):
            component_id = f"{sheet_id}_component_{index:03d}"
            export_path = component_dir / f"{component_id}.png"
            x, y = component["x"], component["y"]
            crop = image.crop((x, y, x + component["width"], y + component["height"]))
            crop.save(export_path)
            is_superseded, covering_region_ids = find_manual_coverage(
                image, component, manual_regions
            )
            component.update(
                {
                    "id": component_id,
                    "exported_file": repository_path(export_path, repository_root),
                    "review_status": (
                        "superseded_by_manual_regions"
                        if is_superseded
                        else "pending_manual_review"
                    ),
                    "is_approved_asset": False,
                    "review_flags": (
                        ["superseded_by_manual_regions"] if is_superseded else []
                    ),
                    "superseded_by_manual_regions": covering_region_ids
                    if is_superseded
                    else [],
                }
            )

        for region in manual_regions:
            is_approved = region["id"] in approved_region_ids
            output_group = "approved" if is_approved else "manual-candidates"
            manual_dir = output_dir / "sprites" / output_group / sheet_id
            export_path = manual_dir / f"{region['id']}.png"
            export_path.parent.mkdir(parents=True, exist_ok=True)
            x, y = region["x"], region["y"]
            crop = image.crop((x, y, x + region["width"], y + region["height"]))
            crop.save(export_path)
            region.update(
                {
                    "exported_file": repository_path(export_path, repository_root),
                    "alpha_pixel_count": sum(1 for value in crop.getchannel("A").tobytes() if value),
                    "review_status": (
                        "founder_approved_manual_crop"
                        if is_approved
                        else "manual_bounds_pending_review"
                    ),
                    "is_approved_asset": is_approved,
                }
            )

        preview_path = preview_dir / f"{sheet_id}-components.png"
        save_component_preview(image, candidates, manual_regions, preview_path)
        result["component_count"] = len(candidates)
        result["components"] = candidates
        result["manual_region_count"] = len(manual_regions)
        result["manual_regions"] = manual_regions
        result["preview_file"] = repository_path(preview_path, repository_root)
        result["review_note"] = (
            "8-connected alpha regions are candidate crops only. Check the numbered preview "
            "for touching sprites, grouped props, or detached shadows. Magenta M-label boxes "
            "come from manual-regions.json and are separate crop candidates. Nothing is approved."
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
        tile_size = BEST_FIT_TERRAIN_TILE_SIZE
        tile_regions = find_nonempty_tile_regions(image, tile_size)
        tile_dir = output_dir / "terrain" / "candidates" / f"grid-{tile_size}"
        tile_dir.mkdir(parents=True, exist_ok=True)
        for tile in tile_regions:
            x, y = tile["x"], tile["y"]
            crop = image.crop((x, y, x + tile["width"], y + tile["height"]))
            tile_path = tile_dir / f"{tile['id']}.png"
            crop.save(tile_path)
            tile.update(
                {
                    "exported_file": repository_path(tile_path, repository_root),
                    "review_status": "candidate_not_confirmed",
                    "is_approved_asset": False,
                }
            )
        result["best_fit_tile_size_candidate"] = tile_size
        result["tile_candidate_count"] = len(tile_regions)
        result["tile_candidates"] = tile_regions
        result["tile_grid_status"] = "best_fit_unconfirmed"
        result["review_note"] = (
            "16x16 best fits the occupied 176x112 alpha bounds and visible seams, "
            "but the grid remains unconfirmed. Candidate tiles must be reviewed before integration."
        )

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
    parser.add_argument(
        "--manual-regions",
        type=Path,
        default=repository_root / "scripts/pixel-art/manual-regions.json",
    )
    args = parser.parse_args()

    if args.manual_regions.is_file():
        manual_data = json.loads(args.manual_regions.read_text(encoding="utf-8"))
        if manual_data.get("schema_version") != 1 or not isinstance(manual_data.get("sheets"), dict):
            raise ValueError(f"Invalid manual region file: {args.manual_regions}")
        configured_manual_regions = manual_data["sheets"]
        approval_config = manual_data.get("approved_regions", {})
        if not isinstance(approval_config, dict):
            raise ValueError("approved_regions must map source filenames to lists of ids.")
        approved_regions_by_sheet: dict[str, set[str]] = {}
        for source_filename, region_ids in approval_config.items():
            if source_filename not in SHEETS:
                raise ValueError(f"Approvals reference an unknown source sheet: {source_filename}")
            if not isinstance(region_ids, list) or not all(isinstance(item, str) for item in region_ids):
                raise ValueError(f"Approvals for {source_filename} must be a list of region ids.")
            approved_regions_by_sheet[source_filename] = set(region_ids)
    else:
        configured_manual_regions = {}
        approved_regions_by_sheet = {}
    unknown_sheets = set(configured_manual_regions) - set(SHEETS)
    if unknown_sheets:
        raise ValueError(f"Manual regions reference unknown sheets: {sorted(unknown_sheets)}")

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
                configured_manual_regions,
                approved_regions_by_sheet.get(filename, set()),
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
            if sheet["manual_region_count"]:
                summary += f", {sheet['manual_region_count']} manual regions"
        else:
            summary += f", {len(sheet['tile_grid_candidates'])} unconfirmed grid previews"
        print(summary)
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()