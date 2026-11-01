# Pixel Art Asset Pipeline

This pipeline inspects the three original source sheets copied to `public/assets/nabta/world/source/`. The `Pixel Art/` originals are never modified.

## Run

Install the optional script dependency with `python -m pip install -r scripts/pixel-art/requirements.txt`, then run:

```powershell
python scripts/pixel-art/analyze_sheets.py
python -m unittest discover -s scripts/pixel-art -p "test_*.py"
python scripts/pixel-art/validate_assets.py
```

The analyzer writes source dimensions and alpha statistics to `public/assets/nabta/world/manifests/asset-analysis.json`, numbered component previews to `previews/`, diagnostic RGBA crops to `sprites/candidates/`, founder-approved manual crops to `sprites/approved/`, and terrain tile candidates to `terrain/candidates/grid-16/`.

Object crops are 8-connected alpha regions, not reliable object boundaries; one connected region may contain multiple objects. Open `http://localhost:3001/assets/nabta/world/tools/region-editor.html`, choose the source PNG, and draw a separate box around each desired object, including objects that touch or share a connected frame. Name each region, download `manual-regions.json`, and merge its `sheets` entries into `scripts/pixel-art/manual-regions.json`. After the founder reviews a set, list its region IDs under `approved_regions` for that sheet. Re-run the analyzer: approved regions export to `sprites/approved/` with green `A` labels; unapproved manual regions export under `sprites/manual-candidates/` with magenta `M` labels. Automatic components remain diagnostic candidates, and a component fully covered by manual crops is marked superseded.

Terrain is not connected-component cropped. The analyzer generates 8, 16, 32, and 64 pixel grid overlays and extracts nonempty 16x16 cells as `candidate_not_confirmed`. The 16px grid best fits the occupied 176x112 alpha bounds and visible seams, but remains unconfirmed. Review the grid and candidate tiles before using them in the world.

Preview images use nearest-neighbor enlargement and a checkerboard background. Component PNGs retain source pixel dimensions, colors, and alpha. The JSON manifest records source SHA-256 values to make provenance checks repeatable.

The original asset license/attribution information was not present in the workspace. Verify the source licenses before public or commercial distribution.