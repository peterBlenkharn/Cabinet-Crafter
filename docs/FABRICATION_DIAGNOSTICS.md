# Fabrication Manifest And Preflight

Status: canonical
Last updated: 2026-07-17

## Purpose

Cabinet Crafter treats manufacturability as a gated data pipeline, not only a collection of viewport warnings. `Cabinet.getFabricationManifest()` creates a `CabinetCrafter.FabricationManifestV1`; `runPreflight(manifest)` checks that immutable-style plain-data snapshot without reading the DOM or Three.js scene.

Legacy `fabricationDiagnostics` and viewport markers remain useful while editing. The manifest and `PreflightResult` records are the source of truth for production export, reports, automated tests, and package generation.

## Manifest Contract

The manifest is version `1.0` and uses millimetres. Its main collections are:

- `materials`: assigned sheet material and optional stock information;
- `parts`: stable IDs, quantities, material/thickness, dimensions, inclusion/visibility, face/grain data, and record references;
- `contours`: closed outer/inner/reference polygons using `{ xMm, yMm }` points;
- `operations`: `profileCut`, `throughCut`, `drill`, `pocket`, `engrave`, or `reference` geometry;
- `joints`: included angle plus each panel's actual bevel cut;
- `fasteners`: positions, dimensions, direction, and target metadata;
- `hardwareInstances`: portable definition-backed instances whose operations and underside bodies enter validation;
- `keepouts`: underside hardware body/service regions;
- `assemblySchedules`: fitted service-door and four-piece screen-frame identity, clearance, mating, and hardware-reference records;
- `layoutFitSuggestions`: proposed control coordinates that fit without silently changing project state;
- `sourceDiagnostics`: structural intersections and fastener findings collected during cabinet construction.

`includeInFabrication` is explicit on every part. `viewportVisible` is informational and independent. Preflight and exports ignore excluded parts but do not infer exclusion from viewport hiding.

## PreflightResult

Every finding is normalized by `createPreflightResult()`:

```json
{
  "id": "CUTOUT_EDGE_CLEARANCE:panel_cp:op-1:controls.deck",
  "code": "CUTOUT_EDGE_CLEARANCE",
  "severity": "error",
  "partIds": ["panel_cp"],
  "parameter": "controls.deck",
  "operationId": "op-1",
  "location": { "xMm": 100, "yMm": 40 },
  "message": "Control Panel Deck has a cutout too close to an edge.",
  "correctiveAction": "Move or resize the cutout to restore edge clearance.",
  "details": null
}
```

Codes are stable integration keys; prose may evolve. Duplicate affected part IDs are removed. UI cards use `partIds`, `parameter`, and `location` to select/frame a part and direct the user toward the responsible setting.

## Checks Implemented

`runPreflight()` currently covers:

- manifest schema/version and millimetre units;
- no included fabrication parts;
- finite, positive part thickness/length/width;
- missing, open, degenerate, non-finite, or self-intersecting contours;
- through-cut containment and configurable cutout-to-edge clearance;
- cutout overlap/configurable cutout-to-cutout spacing;
- drill/screw-to-cutout conflicts;
- overlapping underside hardware keepouts;
- hardware host, edge, supported-thickness, body/movement, and service-clearance conflicts;
- missing material profiles and basic stock-bounds fit;
- invalid or unsupported operation geometry/types;
- reference operations that will be omitted from production output;
- overflowing control layouts with an explicit fitted suggestion;
- source structural-panel collisions and fastener conflicts;
- invalid joint angles and disagreement between included angle and summed per-panel bevels.

The nesting layer adds per-sheet unplaced-part, stock-boundary, overlap, spacing, stock-quantity, and allowed-rotation findings. Material profiles restrict allowed rotations; grain-bearing defaults permit 0/180-degree rotations only. Package generation recomputes these findings for a supplied/manual plan, and sheet serializers/tests cover quarter-turn operation transforms so cached findings or rotation edits cannot bypass the production gate.

## Severity And Export Rules

| Severity | Meaning | Production behavior |
| --- | --- | --- |
| `error` | Geometry or data is unsafe/unsupported for production. | Blocks production SVG and fabrication ZIP with no override. |
| `warning` | Production can proceed after informed review. | Requires explicit acknowledgement. |
| `info` | Non-blocking context. | Does not block. |

Annotated draft export remains available regardless of findings and is marked non-production when errors exist.

## UI And Viewport Feedback

The Fabrication sidebar groups totals and issue cards by severity. Selecting a card selects and frames its affected panel where possible and exposes the corrective action. `LAYOUT_DOES_NOT_FIT` cards can apply the generated layout suggestion, which writes the fitted positions into project state and reruns preflight.

The viewport retains seam lines, screw references, red overlap/collision markers, and warning outlines. The selected-component readout shows panel-scoped joints, fasteners, cutouts, inclusion, and visibility. These visual aids explain findings; the data record remains authoritative for the gate.

## Thickness, Joints, And Screws

`Cabinet.getProfilePoints()` uses material thickness as a minimum transition/clearance unit. Internal clear width is the overall width minus effective left/right wall thickness. Rectangular panels are solved against neighbouring profile endpoints; angled transitions use mitred end geometry and bottom-line base joints use square butt seams.

Joint records no longer rely on parsing descriptive labels. They report the geometric included angle and the actual bevel assigned to each panel, including unequal-thickness cases. A nominal 90-degree symmetric mitre therefore reports 90 degrees included and 45 degrees on each panel.

Side-entry screw references use configured shaft diameter, length, edge clearance, and minimum centre spacing. Source checks cover target penetration, edge clearance, spacing, and opposing-shaft intersection; manifest preflight also checks drill geometry against through-cut geometry.

## Limits And Required Maker Checks

- Structural collision diagnostics use oriented panel solids/cross-section checks, not arbitrary constructive-solid-geometry booleans.
- A circular keepout is a conservative placement model, not a supplier-certified swept-volume simulation.
- The service-door opening and the fitted door/frame pieces are real fabrication geometry. Hinge/latch centres and screen-frame placement guides remain reference operations and are intentionally omitted from machine output.
- Stock fit in preflight and the automatic nesting result do not replace inspection of grain face, defects, clamping, tool access, tabs, or workholding.
- Use the calibration SVG and a physical test cut before committing full stock.

Joinery strategies and router/laser process derivation can be enabled through persisted advanced package settings or the API. Complete panel-local edge geometry is not available for every joint, and router holding tabs are metadata rather than emitted interrupted vectors. See [Implementation Status](IMPLEMENTATION_STATUS.md).
