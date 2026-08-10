# Mannequin Presets

Status: canonical
Last updated: 2026-07-25

## Purpose

The mannequin provides ergonomic scale reference across a broader cross section of users. It is rendered as an opaque pale body with dark wireframe edges, matching the app's drafting style.

## Presets

Mannequin presets are exported from `wwwroot/js/dummy.js` as `MANNEQUIN_PRESETS`.

| ID | Display Name | Height | Intent |
| --- | --- | ---: | --- |
| `child_12` | Child 12 | 1500 mm | Approximate 12-year-old scale reference. |
| `adult_woman_small` | Adult Woman S | 1580 mm | Smaller adult woman reference. |
| `adult_woman_average` | Adult Woman M | 1650 mm | Average adult woman reference. |
| `adult_average` | Adult Average | 1750 mm | General adult reference. |
| `adult_man_average` | Adult Man M | 1800 mm | Average adult man reference. |
| `tall_adult` | Tall Adult | 1930 mm | Tall adult reference. |

The height slider can create a `custom` mannequin height while retaining the active body's proportions.

Mannequin visibility, profile, and height are persisted in `ProjectDocumentV2.viewState.mannequin` and autosave recovery. Mannequin values are view state, not fabrication dimensions.

## Proportions

Each preset stores proportional ratios for:

- shoulder width
- torso depth
- pelvis width
- arm length
- leg length

These ratios are not medical anthropometry data. They are practical design references for checking cabinet scale, control reach, and approximate sight line.

## Connected Layout Contract

`wwwroot/js/dummy-layout.js` converts the selected height and proportion ratios into one renderer-independent body layout. It supplies the torso and pelvis envelopes plus shared endpoints for every connected limb segment.

The renderer in `wwwroot/js/dummy.js` consumes those coordinates directly. An upper arm and forearm share the same elbow coordinate, each leg shares its hip, knee, and ankle coordinates, and the torso, pelvis, neck, and head are calculated from the same vertical chain. This prevents gaps, detached joints, distorted segment lengths, and stale geometry after a preset or height change.

The layout module also exposes finite dimensions and segment-length invariants for headless regression tests. It does not affect cabinet geometry, ergonomic fabrication findings, or exported manufacturing dimensions.

## Ergonomic Analysis Service

`wwwroot/js/ergonomics.js` adds a renderer-independent reference analysis for small, average, and tall users. It estimates eye line, viewing distance/angle, reach, and control-height findings and is consumed by the fabrication package's ergonomics CSV.

This service is not yet an interactive mannequin workbench: the viewport does not draw reach envelopes or compare profiles side by side, and the results are not medical or accessibility certification. See [Implementation Status](IMPLEMENTATION_STATUS.md).
