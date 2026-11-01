# Pixel Art Asset Pipeline

This pipeline turns the founder-supplied art into the assets the student world renders. The `Pixel Art/` originals are never modified.

## Inputs

| Source | Location | Notes |
| --- | --- | --- |
| `free_pixel_16_woods.png` | `Pixel Art/` → `public/assets/nabta/world/source/` | 352x192 RGBA |
| `forest_demo_objects.png` | `Pixel Art/` → `public/assets/nabta/world/source/` | 256x256 RGBA, 37 founder-approved crops |
| `forest_demo_terrain.png` | `Pixel Art/` → `public/assets/nabta/world/source/` | 256x256 RGBA, 16px grid candidates |
| `nabta_plains_16x16_individual_tiles.zip` | supplier download → `public/assets/nabta/world/source/plains-tileset.png` | 176x256 RGBA, exact 16x16 grid, 151 non-empty tiles |

`plains-tileset.png` is a byte-for-byte copy of the supplier's `cleaned_tileset_no_trees.png`; `plains-tileset.manifest.json` is their original tile manifest. Two large trees had already been removed by the supplier (`removed_regions`), so the sheet is not the full original pack.

## Run

```powershell
python -m pip install -r scripts/pixel-art/requirements.txt

# 1. analyze the three original sheets (object crops, terrain candidates, previews)
python scripts/pixel-art/analyze_sheets.py
python -m unittest discover -s scripts/pixel-art -p "test_*.py"
python scripts/pixel-art/validate_assets.py

# 2. import the plains tileset + harmonize its palette to the approved sprites
python scripts/pixel-art/import_plains_tileset.py

# 3. quest-node medallions (the only generated art that ships)
python scripts/pixel-art/generate_decor.py

# 4. stamp the world region (terrain, layout data, review render)
python scripts/pixel-art/build_world.py
python scripts/pixel-art/validate_world.py
```

## Scene checks

```powershell
node --experimental-strip-types scripts/pixel-art/../student-world/check_systems.mjs
```

Verifies quest nodes sit on the authored path, path sampling and camera stay in bounds, and node medallions match the real quest status.

## Object extraction

The analyzer writes source dimensions and alpha statistics to `manifests/asset-analysis.json`, numbered component previews to `previews/`, diagnostic RGBA crops to `sprites/candidates/`, founder-approved manual crops to `sprites/approved/`, and terrain tile candidates to `terrain/candidates/grid-16/`.

Object crops are 8-connected alpha regions, not reliable object boundaries; one connected region may contain multiple objects. Open `http://localhost:3001/assets/nabta/world/tools/region-editor.html`, choose the source PNG, and draw a separate box around each desired object. Name each region, download `manual-regions.json`, and merge its `sheets` entries into `scripts/pixel-art/manual-regions.json`. List reviewed region IDs under `approved_regions` for that sheet and re-run the analyzer: approved regions export to `sprites/approved/`, everything else stays a candidate.

## Palette harmonization

The plains pack is noticeably brighter and redder than the approved forest sprites. `import_plains_tileset.py` writes two copies of the atlas:

- `terrain/plains/plains-atlas.png` — untouched copy.
- `terrain/plains/plains-atlas-harmonized.png` — greens shifted +10° hue, x0.92 saturation, x0.92 value toward `#5ab644`/`#37994b`/`#205d41`/`#13383a`, near-black outlines pulled to `#13383a`, and every soil colour mapped onto the `#3c1c1e`–`#a86a3c` brown ramp.

Every mapping is recorded in `manifests/plains.json` (`harmonization.soil_color_map`), so the transform is reproducible and reviewable. Stone and water are untouched. Compare with `previews/plains-harmonized-compare.png`.

## World composition

`build_world.py` composes `regions/forest-clearing/` deterministically:

- `terrain.png` — 960x640 static ground layer: flat grass tile plus authored grass tufts lifted from the atlas, a full-width terrace band (grass lip, one soil row, grass fringe), the river with foam banks stamped on the water side, a bridge deck built from the approved plank colours, and the dithered dirt path.
- `decor.json` — path waypoints, quest node slots, and 208 object placements with `sortY` for depth sorting. The renderer sorts objects, nodes and the character together by `sortY`, so the student walks behind trees above them and in front of trees below them.

Tile rotation/flip is used to reuse the single-orientation shoreline for the other three banks. That keeps the shoreline consistent but does flip the light direction slightly on rotated edges — a known limitation of a one-orientation tileset.

## Generated art

`generate_decor.py` produces only the quest-node medallion sheet (4 states). Generated trees were attempted and **rejected**: the procedural canopies did not reach the quality of the approved sprites, so no generated trees ship. See `previews/quest-node-preview.png`.

## Licensing

The original asset licence/attribution information was not present in the workspace, and the plains pack arrived without a licence. Verify every source licence before public or commercial distribution.
