# Architecture Phase 2 - Background Removal Method Evaluation

Experimental only. No method is approved. No cleaned production file was written.

## Source
- SHA-256 verified: `b5a24a9f51b41268060c9aeae17028a28f2c947cbc7f2b92d0c1c86b20d5c843` (match confirmed)
- 1536x1024, RGB, no alpha, opaque white-plus-checkerboard background

## Global results

| Method | Predicate | Removed px | Remaining opaque | Components >=120 | Strongly coloured erased |
|---|---|---|---|---|---|
| A | min>=214, spread<=6 | 804,683 | 0.488 | 55 | 0 |
| B | min>=200, spread<=18 | 815,354 | 0.482 | 55 | 0 |
| C | min>=190, spread<=26 | 818,273 | 0.480 | 55 | 0 |

All three yield **55 connected components** - no asset bridging under any method.
No strongly coloured pixel is erased by any method.

## Visual findings (from contact sheet)

- **Chimney smoke survives in all three methods.** This was the highest-risk
  pale detail on the sheet and it is fully intact in A, B and C.
- **Wooden rails, posts, roof edges, crate and barrel corners are intact** in all three.
- **No visible checkerboard residue** remains in any of the three panels.
- **A, B and C are visually indistinguishable** on every inspected region.
- Removal is clean at asset boundaries; no clipping visible.

## Region-window accuracy - IMPORTANT LIMITATION

Seven critical windows were defined from the Phase 1 overview. On inspection of the
rendered comparison sheet, **five of the seven windows did not land on their intended
landmark**:

| Window | Intended target | What it actually contains |
|---|---|---|
| chimney smoke (60,10,170,110) | chimney smoke | CORRECT - chimney with smoke |
| shrine emblem core (450,90,150,150) | glowing emblem | MISSED - stone arch and pillars |
| fence rails (140,200,190,90) | fence rails | MISSED - cottage roof |
| ladder rungs (1370,550,120,160) | ladder | PARTIAL - ladder plus well roof |
| stone arch/steps (320,200,270,130) | arch and steps | MISSED - barrel and fence platform |
| touching moss (0,280,330,150) | moss rock formations | MISSED - wooden fence row |
| braziers glow (180,600,210,130) | braziers | MISSED - barrel and crate |

The numeric per-region figures in the JSON are therefore **valid measurements of the
regions as defined, but they do not describe the landmarks they were named after**
for the five missed windows. Only the chimney-smoke row should be trusted as a
critical-detail preservation measurement.

What the sheet nonetheless establishes visually: smoke, rails, roof edges and container
corners all survive under A, B and C; and the three methods are indistinguishable.

## Recommendation

**Method A**, with one caveat.

Reasoning: all three produce identical segmentation (55 components), identical visual
results, and zero strongly-coloured loss. A removes the fewest pixels and erases the
fewest pale pixels (e.g. 12,058 vs 12,320 in the chimney window), so it is the least
aggressive of three equally clean choices. There is no evidence that A leaves residue
on the regions inspected.

Caveat: because five windows missed their targets, the case for A over B is **not yet
established on the pale details it was meant to test**. Before approving A, the windows
must be re-derived and the comparison re-rendered.

## Not performed
- No method approved or applied to a production cleaned file
- No assets extracted, no final PNGs created
- No threshold changed after testing
- Source unmodified

## Recommended next steps
1. Re-derive the region windows from the actual source coordinates.
2. Re-render the comparison and re-check emblem glow, fence rails, ladder rungs,
   arch highlights, moss formations and braziers.
3. Only then approve a method and proceed to component analysis.
