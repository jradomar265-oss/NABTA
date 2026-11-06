# Architecture Source Sheet Audit (Phase 1)

## Source identity
- File: `architecture-source-sheet.png` (attachment object b5a24a9f...)
- SHA-256: `b5a24a9f51b41268060c9aeae17028a28f2c947cbc7f2b92d0c1c86b20d5c843`
- Size: 2799303 bytes
- Dimensions: 1536x1024
- Mode: RGB, format PNG
- Alpha channel: **absent**

## Background
Opaque, baked in. White base with a faint checkerboard fill. No transparency to preserve,
so background removal must flood-fill from the borders. Dominant colours are recorded in the JSON.

## Asset families observed
| Family | Region | Approx count | Boundaries |
|---|---|---|---|
| Buildings / cabins | R1 (20,20)-(320,300) | 1 | clear |
| Shrines / stone gateways | R1 (320,20)-(560,300) | 1 | clear |
| Bridges | R2 (610,20)-(1050,150) | 2 | clear |
| Fences / rails | R2-R5 (600,150)-(1536,900) | 8 | clear but thin (2-4px rails) |
| Banners / signs | R2,R5 (650,290)-(1536,760) | 6 | clear |
| Ladders | R5 (860,760)-(940,900) | 1 | thin rails |
| Lighting (lanterns, braziers) | R2,R4,R6 | 6 | clear |
| Stone formations / pillars | R3 (10,290)-(560,520) | 8 | ambiguous - moss bridges gaps |
| Stairs | R3,R4 (400,290)-(560,420) | 2 | clear |
| Chests / containers | R4,R6 | 5 | clear |
| Wheeled props | R3 (230,420)-(370,520) | 1 | clear |
| Campfire / braziers | R3,R6 | 3 | clear |
| Crystal / monument | R3,R4 | 2 | clear |
| Garden props | R3,R4 | 4 | clear |
| Wood / ground props | R3,R6 | 6 | clear |
| Clay pots / urns | R3 (770,500)-(870,600) | 3 | clear |
| Well | R5 (350,900)-(430,1024) | 1 | clear |

Estimated distinguishable assets: **~62**.

## Extraction risks
- Chimney smoke is pale white and sits directly against a white background - highest removal risk on the sheet
- Glowing green shrine emblem has a near-white core that a neutral predicate may erase
- Fence rails and ladder rungs are 2-4 px thick - aggressive tolerance will erase them
- The background is a faint checkerboard, so residual pixels can bridge separate assets (observed on Water)
- Several mossy stone formations touch each other and may merge into single components
- Pale stone highlights on the arch and steps are close to background white

## Not performed
- Background removal, mask generation, cropping or extraction
- Component analysis or counting
- Any modification of the source

## Recommended next steps
1. Test background predicates on this sheet independently; do not inherit the Vegetation choice.
2. Pay specific attention to chimney smoke, shrine glow, fence rails and ladder rungs.
3. Run component analysis and compare counts against the ~62 visual estimate.
4. Inspect touching stone formations before any split decision.
