Analyze the two pixel-art sprite sheets in the assets folder.

Requirements:

1. Inspect the PNG dimensions and alpha channels.
2. Automatically detect individual sprites using connected-component analysis on transparent backgrounds.
3. Calculate accurate bounding boxes (x, y, width, height) for every detected sprite.
4. Do not assume every sprite has the same dimensions.
5. Generate a visual preview of the original sprite sheets with colored bounding boxes and numbered labels.
6. Export each detected sprite as an individual transparent PNG.
7. Generate a JSON manifest containing each sprite's name, source coordinates, width, height, and exported file path.
8. Preserve the original pixel-art colors and transparency.
9. Never resize, blur, anti-alias, or smooth pixel-art assets.
10. Keep the original sprite sheets unchanged.

Important:
- Some sprites may touch or overlap. Do not blindly treat every connected component as a separate object.
- If automatic detection is ambiguous, flag it for manual review rather than incorrectly cutting the sprites.
- For terrain tiles, investigate the tile grid separately. Do not use object-detection cropping as a substitute for terrain slicing.
- Document all detected dimensions and any uncertain boundaries.