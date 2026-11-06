# Architecture Phase 2 - Final Outstanding Evidence Audit

Experimental. Method A remains preferred but is NOT approved.

## 1. Sub-120px components >3px (40 inspected)

All 40 rendered at 4x from the Method A output (architecture-final-evidence-audit.png).
Sizes range 4-22 px; bounding boxes 1-7 px per side.

Visual result: every one appears as a **small pale/white speck or thin sliver at an
asset edge** - none shows a closed silhouette, internal structure or hue.

Classification assigned:
- BACKGROUND_RESIDUE: 34 (pale specks, no structure)
- REVIEW: 6 (small slivers closer to artwork edges; size precludes a confident call)
- PASS_ARTWORK: 0

Limitation: at 4x on a 1-7px object the render is at the limit of legibility. The 6
REVIEW items are those where I could not rule out that they are fragments of a nearby
detail (fence rail tip, lamp bracket, banner fringe).

## 2. C12 (258,417,186,165, 23,960px)

Visual result stands from the previous pass: **two distinct tall pillars** with separate
shafts and separate moss caps, joined only by a low horizontal base wall.

Verdict: **REVIEW** - retained. It reads as two independent pillars that touch at the
base, but "pillar pair" is also a plausible intended single asset, and there is no
external reference to settle it. Not split, not edited.

## 3. The 261 single-pixel components

Measured distribution:

| Metric | Result |
|---|---|
| Total | 261 |
| Within 3px of an asset >=120px | **251 (96.2%)** |
| 3-20px from artwork | 10 (3.8%) |
| More than 20px from artwork | **0** |
| min channel >=200 (near-white) | 258 (98.9%) |
| Channel spread <=10 (fully neutral) | **261 (100%)** |

**Analysis:** every single-pixel component is a neutral, near-white pixel lying on or
adjacent to the outline of a major asset. Not one carries hue; not one is isolated in
open background. This is the spatial signature of anti-aliased edge pixels and residual
checkerboard contact, not of drawn artwork.

Remaining uncertainty: a 1px detail could in principle be a legitimate highlight, and
the analysis establishes likelihood, not impossibility. No single pixel was individually
inspected.

## 4. A vs B difference interpretation

Ten difference regions were sampled (largest plus spatially distributed), rendered as
A | B | DIFF at 12x-equivalent scale.

**Result: not resolved.** The difference pixels are so few (26-70 px spread over regions
up to 47x30) that the magenta mask does not read clearly at render scale, and the A and
B panels are visually identical to the eye.

The "B shaves edge fringe" interpretation therefore remains an **inference from the
3,772-region / 2.8px-average distribution**, not a confirmed visual finding. I am
retracting the confident framing used in the previous report: it was evidence-based
reasoning, but it was presented more strongly than the imagery supports.

What is established: B removes 10,671 px more than A, in 3,772 regions, max 70 px,
and the difference causes no visible change at asset level.

## 5. Recommendation

**Method A**, on these grounds:
- preserves every pixel of artwork, including all three ladder rungs
- preserves all seven critical landmarks
- its cost is ~19 specks <=20px in R4
- B's benefit (10,671 px removed) is small and NOT visually confirmable as either
  residue-only or artwork-eroding

Limitations carried forward:
- 6 of 40 small components retain REVIEW
- 261 single pixels analysed statistically, not individually
- C12 merge status unresolved
- A vs B difference nature unconfirmed visually

## Not performed
No method approved. No production clean. No extraction. No PNGs. No threshold change.
Source unmodified.
