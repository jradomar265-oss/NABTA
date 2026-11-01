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

Object crops are 8-connected alpha regions, not approved sprites. All are marked `pending_manual_review`; touching sprites and grouped props can be one connected region, so review the numbered previews before promoting any crop into the app. Terrain is not connected-component cropped. The analyzer generates 8, 16, 32, and 64 pixel grid overlays as unconfirmed candidates; confirm the actual grid manually before extracting tiles.

Preview images use nearest-neighbor enlargement and a checkerboard background. Component PNGs retain source pixel dimensions, colors, and alpha. The JSON manifest records source SHA-256 values to make provenance checks repeatable.

The original asset license/attribution information was not present in the workspace. Verify the source licenses before public or commercial distribution.