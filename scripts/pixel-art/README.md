# Pixel Art Asset Pipeline

This pipeline inspects the three original source sheets copied to `public/assets/nabta/world/source/`. The `Pixel Art/` originals are never modified.

## Run

Install the optional script dependency with `python -m pip install -r scripts/pixel-art/requirements.txt`, then run:

```powershell
python scripts/pixel-art/analyze_sheets.py
python -m unittest discover -s scripts/pixel-art -p "test_*.py"
python scripts/pixel-art/validate_assets.py
```

The analyzer writes source dimensions and alpha statistics to `public/assets/nabta/world/manifests/asset-analysis.json`, numbered component previews to `previews/`, and RGBA candidate crops to `sprites/candidates/`.

Object crops are 8-connected alpha regions, not approved sprites. A connected region may contain several visible objects. Open `http://localhost:3001/assets/nabta/world/tools/region-editor.html`, choose the source PNG, and draw a separate box around each desired object, including objects that touch or share a connected frame. Name each region, download `manual-regions.json`, and replace `scripts/pixel-art/manual-regions.json` with the downloaded file. Re-run the analyzer to export these as magenta `M`-labeled crops under `sprites/manual-candidates/`; they remain unapproved until reviewed. The analyzer also retains connected-component results as diagnostic candidates.

Terrain is not connected-component cropped. The analyzer generates 8, 16, 32, and 64 pixel grid overlays as unconfirmed candidates; confirm the actual grid manually before extracting tiles.

Preview images use nearest-neighbor enlargement and a checkerboard background. Component PNGs retain source pixel dimensions, colors, and alpha. The JSON manifest records source SHA-256 values to make provenance checks repeatable.

The original asset license/attribution information was not present in the workspace. Verify the source licenses before public or commercial distribution.