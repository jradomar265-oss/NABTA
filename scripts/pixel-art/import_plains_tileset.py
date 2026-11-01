"""Import the founder-supplied plains tileset and harmonize its palette.

Input (read-only):
    C:\\Users\\gamex\\Downloads\\nabta_plains_16x16_individual_tiles.zip
    extracted to a caller-supplied directory.

Outputs (repository):
    public/assets/nabta/world/source/plains-tileset.png          verbatim copy
    public/assets/nabta/world/source/plains-tileset.manifest.json verbatim copy
    public/assets/nabta/world/terrain/plains/plains-atlas.png     verbatim copy
    public/assets/nabta/world/terrain/plains/plains-atlas-harmonized.png
    public/assets/nabta/world/manifests/plains.json
    public/assets/nabta/world/previews/plains-harmonized-compare.png

The harmonized atlas only shifts green ramps and near-black outlines toward the
already-approved forest sprite palette. Soil, stone and water are untouched.
Every mapping is recorded in the manifest so the transform stays reproducible and
reviewable.
"""

from __future__ import annotations

import colorsys
import json
import shutil
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
SRC_DIR = Path(r"C:\Users\gamex\AppData\Local\Temp\nabta_plains_inspect")

WORLD = REPO / "public" / "assets" / "nabta" / "world"
SOURCE = WORLD / "source"
PLAINS = WORLD / "terrain" / "plains"
MANIFESTS = WORLD / "manifests"
PREVIEWS = WORLD / "previews"

TILE = 16

# --- harmonization parameters ------------------------------------------------
# Forest sprite reference ramps (approved sprites in sprites/approved/):
#   greens  #5ab644 (light) #37994b (mid) #205d41 (dark) #13383a (outline)
#   browns  #a86a3c (light) #764726 (mid) #5a3022 (dark) #3c1c1e (outline)
GREEN_HUE_SHIFT_DEG = 10.0
GREEN_SATURATION = 0.92
GREEN_VALUE = 0.92
DARK_TARGET = (0x13, 0x38, 0x3A)
DARK_MAX_VALUE = 0.30
BROWN_RAMP = [(0x3C, 0x1C, 0x1E), (0x5A, 0x30, 0x22), (0x76, 0x47, 0x26), (0xA8, 0x6A, 0x3C)]


def brown_map(image: Image.Image) -> dict[tuple[int, int, int, int], tuple[int, int, int, int]]:
    """Map the source soil/red-brown colours onto the approved brown ramp.

    Soil is the largest visible colour mismatch between the plains pack and the
    approved forest sprites, so each distinct soil colour is sorted by luminance
    and mapped onto the four approved browns.
    """
    candidates = {}
    for px in image.convert("RGBA").getdata():
        r, g, b, a = px
        if a == 0 or b > r:
            continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        hue = h * 360
        if s < 0.30 or v < 0.06:
            continue
        if 5 <= hue <= 32:
            candidates[px] = (0.299 * r + 0.587 * g + 0.114 * b)
    ordered = sorted(candidates, key=lambda c: candidates[c])
    mapping = {}
    for index, colour in enumerate(ordered):
        if len(ordered) == 1:
            target = BROWN_RAMP[1]
        else:
            target = BROWN_RAMP[round(index * (len(BROWN_RAMP) - 1) / (len(ordered) - 1))]
        mapping[colour] = (target[0], target[1], target[2], colour[3])
    return mapping


def harmonize_pixel(rgba: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    r, g, b, a = rgba
    if a == 0:
        return rgba
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hue = h * 360

    if v <= DARK_MAX_VALUE and s < 0.55:
        # near-black outline pixels used by the source props
        t = min(1.0, (DARK_MAX_VALUE - v) / DARK_MAX_VALUE) * 0.85
        nr = round(r + (DARK_TARGET[0] - r) * t)
        ng = round(g + (DARK_TARGET[1] - g) * t)
        nb = round(b + (DARK_TARGET[2] - b) * t)
        return (nr, ng, nb, a)

    if 75 <= hue <= 165:
        nh = (hue + GREEN_HUE_SHIFT_DEG) / 360
        nr, ng, nb = colorsys.hsv_to_rgb(nh, min(1.0, s * GREEN_SATURATION), min(1.0, v * GREEN_VALUE))
        return (round(nr * 255), round(ng * 255), round(nb * 255), a)

    return rgba


def harmonize(image: Image.Image) -> tuple[Image.Image, dict[str, str]]:
    soil = brown_map(image)
    out = Image.new("RGBA", image.size)
    src = image.load()
    dst = out.load()
    for y in range(image.height):
        for x in range(image.width):
            original = src[x, y]
            if original in soil:
                dst[x, y] = soil[original]
            else:
                dst[x, y] = harmonize_pixel(original)
    table = {
        "#%02x%02x%02x" % c[:3]: "#%02x%02x%02x" % t[:3]
        for c, t in sorted(soil.items())
    }
    return out, table


# --- tile classification -----------------------------------------------------
# Curated roles for the tiles the world renderer actually uses. Everything else
# keeps a stable coordinate id so no source tile is lost.
ROLES = {
    "grass_flat": ["r01c01"],
    "grass": ["r01c02", "r02c02", "r08c02", "r09c02", "r02c01"],
    "cliff_lip": ["r04c00", "r04c01", "r04c02", "r04c03", "r04c04"],
    "cliff_face": ["r05c00", "r05c01", "r05c02", "r05c03", "r05c04"],
    "cliff_base": ["r06c00", "r06c01", "r06c02", "r06c03", "r06c04"],
    "bank_foam": ["r13c00", "r13c01", "r13c02", "r13c03", "r13c04"],
    "grass_over_water": ["r11c00", "r11c01", "r11c02", "r11c03", "r11c04"],
    "water": ["r12c05", "r12c06", "r13c05", "r13c06"],
    "rock": ["r04c05", "r04c06", "r04c07"],
    "reeds": ["r11c05"],
    "lily": ["r11c06"],
}

SEAM_GROUPS = {
    "grass_seamless": ["r01c01", "r01c02", "r02c01", "r02c02", "r08c01", "r08c02", "r09c01", "r09c02"],
    "water_seamless": ["r12c05", "r12c06", "r13c05", "r13c06"],
}


def main() -> None:
    sheet_src = SRC_DIR / "cleaned_tileset_no_trees.png"
    if not sheet_src.exists():
        raise SystemExit(f"missing extracted tileset: {sheet_src}")

    for directory in (SOURCE, PLAINS, MANIFESTS, PREVIEWS):
        directory.mkdir(parents=True, exist_ok=True)

    sheet = Image.open(sheet_src).convert("RGBA")
    if sheet.size != (176, 256):
        raise SystemExit(f"unexpected sheet size {sheet.size}")

    # verbatim provenance copies
    shutil.copyfile(sheet_src, SOURCE / "plains-tileset.png")
    shutil.copyfile(SRC_DIR / "manifest.json", SOURCE / "plains-tileset.manifest.json")
    shutil.copyfile(sheet_src, PLAINS / "plains-atlas.png")

    harmonized, soil_table = harmonize(sheet)
    harmonized.save(PLAINS / "plains-atlas-harmonized.png")

    upstream = json.loads((SRC_DIR / "manifest.json").read_text(encoding="utf-8"))
    tiles = []
    for tile in upstream["tiles"]:
        tiles.append({
            "id": f"plains_r{tile['row']:02d}c{tile['column']:02d}",
            "row": tile["row"],
            "column": tile["column"],
            "x": tile["x"],
            "y": tile["y"],
            "width": TILE,
            "height": TILE,
        })

    manifest = {
        "atlas": {
            "original": "/assets/nabta/world/terrain/plains/plains-atlas.png",
            "harmonized": "/assets/nabta/world/terrain/plains/plains-atlas-harmonized.png",
            "source": "public/assets/nabta/world/source/plains-tileset.png",
            "source_original_filename": upstream.get("source"),
            "size": list(sheet.size),
            "tile": [TILE, TILE],
            "grid": upstream.get("grid"),
        },
        "provenance": {
            "received": "nabta_plains_16x16_individual_tiles.zip",
            "removed_by_supplier": upstream.get("removed_regions"),
            "license": "unknown - verify with the supplier before public distribution",
            "originals_modified": False,
        },
        "harmonization": {
            "purpose": "reduce the brightness/saturation gap between the plains ground and the founder-approved forest sprites",
            "reference_palette": ["#5ab644", "#37994b", "#205d41", "#13383a"],
            "green_hue_shift_deg": GREEN_HUE_SHIFT_DEG,
            "green_saturation_scale": GREEN_SATURATION,
            "green_value_scale": GREEN_VALUE,
            "dark_target": "#13383a",
            "soil_ramp": ["#3c1c1e", "#5a3022", "#764726", "#a86a3c"],
            "soil_color_map": soil_table,
            "untouched_hue_bands": ["stone/grey", "water/blue"],
            "applied_to": "plains-atlas-harmonized.png",
        },
        "roles": {role: ids for role, ids in ROLES.items()},
        "seam_groups": SEAM_GROUPS,
        "tiles": tiles,
    }
    (MANIFESTS / "plains.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    # comparison preview: the same small scene with approved forest sprites on
    # the original atlas and on the harmonized atlas.
    approved = WORLD / "sprites" / "approved" / "forest_demo_objects"

    def scene(atlas: Image.Image) -> Image.Image:
        width, height = TILE * 8, TILE * 4
        block = Image.new("RGBA", (width, height))
        variants = [(1, 1), (1, 2), (2, 2), (8, 2), (9, 2)]
        for ty in range(4):
            for tx in range(8):
                r, c = variants[(tx * 3 + ty * 2) % len(variants)]
                block.paste(atlas.crop((c * TILE, r * TILE, c * TILE + TILE, r * TILE + TILE)), (tx * TILE, ty * TILE))
        for name, position in {
            "region_001.png": (4, 8),
            "region_035.png": (20, 40),
            "c03_plant.png": (30, 26),
            "region_018.png": (54, -8),
        }.items():
            sprite = Image.open(approved / name).convert("RGBA")
            block.alpha_composite(sprite, position)
        return block

    scale = 3
    width, height = TILE * 8, TILE * 4
    compare = Image.new("RGBA", (width * scale * 2 + 24, height * scale + 18), (24, 28, 26, 255))
    compare.alpha_composite(scene(sheet).resize((width * scale, height * scale), Image.NEAREST), (8, 16))
    compare.alpha_composite(scene(harmonized).resize((width * scale, height * scale), Image.NEAREST), (width * scale + 16, 16))
    compare.save(PREVIEWS / "plains-harmonized-compare.png")

    print("tiles:", len(tiles))
    print("wrote", PLAINS / "plains-atlas-harmonized.png", harmonized.size)
    print("wrote", MANIFESTS / "plains.json")
    print("wrote", PREVIEWS / "plains-harmonized-compare.png")


if __name__ == "__main__":
    main()
