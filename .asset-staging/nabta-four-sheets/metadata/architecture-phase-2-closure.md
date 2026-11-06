# Architecture Phase 2 - Closure Report

**Status: CLOSED. Method A selected for the upcoming production-cleaning phase.
This closure does NOT authorize production cleaning, extraction or final assets.**

## Selected method

| Field | Value |
|---|---|
| Method | **A** |
| Predicate | `min(R,G,B) >= 214` and channel spread `<= 6` |
| Flood fill | border-seeded, 4-connectivity |
| Scope of approval | method selection only |

Rejected: **B** (min>=200/spread<=18) - removes 10,671 px more than A but the nature
of that removal is unverified. **C** (min>=190/spread<=26) - no demonstrated advantage
over B.

## Source verified at closure

- SHA-256: `b5a24a9f51b41268060c9aeae17028a28f2c947cbc7f2b92d0c1c86b20d5c843`
- Verified: **True**
- Dimensions: 1536x1024, mode RGB, 2799303 bytes
- Original source unmodified

## Evidence accepted

1. Seven critical regions passed visual inspection under Method A - chimney smoke,
   shrine emblem sprout, fence rails, ladder rungs, stone steps, moss formations,
   braziers.
2. The 55 components >=120 px are visually distinct, recognisable assets.
3. Of the 40 components larger than 3 px: 34 BACKGROUND_RESIDUE, 6 REVIEW,
   0 PASS_ARTWORK.
4. The 261 single-pixel components were statistically analysed: all neutral
   (spread <=10), 251 of 261 within 3 px of major artwork, none isolated beyond 20 px.

## Limitations - preserved deliberately

1. **Method A leaves approximately 19 small residue specks in region R4** (<=20 px each).
2. The 6 REVIEW small components are **not resolved**.
3. The 261 single pixels are **statistically characterised, not individually proven**
   to be background residue.
4. The claim that **Method B erodes artwork edges is UNVERIFIED** - it remains an
   inference from region-size distribution.
5. **It is NOT established that every artwork pixel across the full source is preserved.**

## Review register (carried forward)

| Item | Issue | Action |
|---|---|---|
| C12 (258,417,186,165, 23,960px) | two pillars joined by a base wall; single or pair undetermined | do not split, do not modify, REVIEW |
| SMALL_6 | 6 sub-120px components not confidently classifiable | REVIEW |
| SINGLE_261 | classified by statistics only | accepted with stated uncertainty |
| AVB_EDGE | A vs B difference nature unconfirmed | recorded as inference |

## Not authorized

Production cleaning - asset extraction - final PNG creation - `public/assets/` changes -
application/database/XP/quest/student-data/UI changes - commits or pushes - purchases -
starting Phase 3.

## Next phase prerequisites

Before production cleaning can begin, separate explicit approval is required, and the
following should be decided: how the ~19 R4 specks are handled, whether C12 is one asset
or two, and whether the 261 neutral specks are accepted as residue.

## Historical evidence preserved

Phase 2 original report, original comparison JSON and sheet, corrected comparison,
coordinate audit, A-vs-B difference audit, stone formation audit, component audit and
final evidence audit are all retained alongside this closure.
