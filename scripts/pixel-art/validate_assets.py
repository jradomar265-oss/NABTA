import json
import hashlib
from pathlib import Path

from PIL import Image


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORLD_ROOT = REPOSITORY_ROOT / "public/assets/nabta/world"
MANIFEST_PATH = WORLD_ROOT / "manifests/asset-analysis.json"


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    seen_ids: set[str] = set()
    candidate_count = 0

    for sheet in manifest["sheets"]:
        source_path = REPOSITORY_ROOT / sheet["source_path"]
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
        if source_hash != sheet["source_sha256"]:
            raise ValueError(f"Source hash changed: {source_path}")
        with Image.open(source_path) as source:
            if source.mode != "RGBA":
                raise ValueError(f"Source mode changed: {source_path}")
            source_rgba = source.convert("RGBA")
            if list(source_rgba.size) != [sheet["dimensions"]["width"], sheet["dimensions"]["height"]]:
                raise ValueError(f"Source dimensions changed: {source_path}")

        preview = REPOSITORY_ROOT / sheet["preview_file"] if "preview_file" in sheet else None
        if sheet["category"] == "objects":
            if preview is None or not preview.is_file():
                raise FileNotFoundError(preview)
            if len(sheet["components"]) != sheet["component_count"]:
                raise ValueError(f"Component count mismatch: {sheet['source_file']}")
            for component in sheet["components"]:
                component_id = component["id"]
                if component_id in seen_ids:
                    raise ValueError(f"Duplicate component id: {component_id}")
                seen_ids.add(component_id)
                if component["review_status"] != "pending_manual_review":
                    raise ValueError(f"Unexpected review state: {component_id}")
                if component["is_approved_asset"]:
                    raise ValueError(f"Unreviewed asset marked approved: {component_id}")
                crop_path = REPOSITORY_ROOT / component["exported_file"]
                if not crop_path.is_file():
                    raise FileNotFoundError(crop_path)
                with Image.open(crop_path) as crop:
                    if crop.mode != "RGBA":
                        raise ValueError(f"Crop lost alpha channel: {crop_path}")
                    if list(crop.size) != [component["width"], component["height"]]:
                        raise ValueError(f"Crop dimensions mismatch: {crop_path}")
                    x, y = component["x"], component["y"]
                    expected = source_rgba.crop(
                        (x, y, x + component["width"], y + component["height"])
                    )
                    if crop.tobytes() != expected.tobytes():
                        raise ValueError(f"Crop pixels differ from source: {crop_path}")
                candidate_count += 1
            if sheet.get("manual_region_count") != len(sheet.get("manual_regions", [])):
                raise ValueError(f"Manual region count mismatch: {sheet['source_file']}")
            for region in sheet.get("manual_regions", []):
                region_id = region["id"]
                if region_id in seen_ids:
                    raise ValueError(f"Duplicate region id: {region_id}")
                seen_ids.add(region_id)
                if region["review_status"] != "manual_bounds_pending_review":
                    raise ValueError(f"Unexpected manual review state: {region_id}")
                if region["is_approved_asset"]:
                    raise ValueError(f"Unreviewed manual region marked approved: {region_id}")
                crop_path = REPOSITORY_ROOT / region["exported_file"]
                if not crop_path.is_file():
                    raise FileNotFoundError(crop_path)
                with Image.open(crop_path) as crop:
                    if crop.mode != "RGBA":
                        raise ValueError(f"Manual crop lost alpha channel: {crop_path}")
                    if list(crop.size) != [region["width"], region["height"]]:
                        raise ValueError(f"Manual crop dimensions mismatch: {crop_path}")
                    x, y = region["x"], region["y"]
                    expected = source_rgba.crop((x, y, x + region["width"], y + region["height"]))
                    if crop.tobytes() != expected.tobytes():
                        raise ValueError(f"Manual crop pixels differ from source: {crop_path}")
                candidate_count += 1
        else:
            if "components" in sheet or sheet.get("component_extraction") != "not_performed_for_terrain":
                raise ValueError("Terrain sheets must not be object-cropped")
            for grid in sheet["tile_grid_candidates"]:
                grid_preview = REPOSITORY_ROOT / grid["preview_file"]
                if not grid_preview.is_file():
                    raise FileNotFoundError(grid_preview)
                if grid["review_status"] != "candidate_not_confirmed":
                    raise ValueError("Terrain tile grid was marked confirmed without review")

    print(f"Validated {len(manifest['sheets'])} source sheets and {candidate_count} unapproved object crops.")


if __name__ == "__main__":
    main()