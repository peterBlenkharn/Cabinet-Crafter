# Exports And Project Files

Status: canonical  
Last updated: 2026-08-10

## ProjectDocumentV2

New saves use a named, schema-versioned document rather than the former top-level v1.2 `{ params, decals }` object.

```json
{
  "schemaVersion": 2,
  "application": "Cabinet Crafter",
  "project": {
    "name": "My Cabinet",
    "createdAt": "2026-07-17T12:00:00.000Z",
    "modifiedAt": "2026-07-17T12:05:00.000Z",
    "basedOnPreset": "standard",
    "notes": ""
  },
  "units": { "internal": "mm", "display": "mm" },
  "design": { "params": {}, "decals": {} },
  "materials": [],
  "fabricationSettings": {},
  "inclusion": {},
  "viewState": {},
  "assets": {}
}
```

`migrateProjectDocument()` explicitly accepts legacy 1.x files, preserves parameter keys, component IDs, and decal records, and annotates the migrated document. Files with a newer schema or an unrecognized shape produce schema-aware errors rather than being silently interpreted. The suggested extension is `.cabinet.json`.

Material profiles, part assignments, selected nesting strategy, pinned placement overrides, imported hardware definitions, detected-hardware cost overrides, additional BOM components, project currency, and supported advanced package settings persist with the project. Material profiles retain uncut sheet width/height, measured thickness, price per sheet, supplier, SKU, and notes. In the desktop app, Open, Save, and Save As use native dialogs. Saves are atomic, failures are surfaced, and unsaved work is written to LocalAppData recovery records. Browser-mode development falls back to file input/download and local storage.

## FabricationManifestV1

`createManifestFromCabinet()` produces the production-facing contract:

- `schema: "CabinetCrafter.FabricationManifestV1"`, `version: "1.0"`, and `units: "mm"`;
- project and design parameters;
- material and material-assignment records;
- stable parts with quantity, material, exact dimensions, inclusion, viewport visibility, finished-face/grain metadata, and referenced record IDs;
- closed contours in unrounded millimetres;
- joints containing the included angle and per-panel bevel cuts;
- portable fastener records, hardware instances, and underside keepouts;
- typed operations: `profileCut`, `throughCut`, `drill`, `pocket`, `engrave`, and `reference`;
- service-door/screen-frame assembly schedules, control-layout fit suggestions, and source diagnostics.

The manifest is renderer-independent after construction. The current adapter still obtains upstream part geometry/metadata from the live Cabinet model; a fully extracted pure parametric geometry engine remains future work.

Viewport visibility and `includeInFabrication` are separate. Exporters filter by inclusion; hiding a part in the viewport does not remove it from production.

## Annotated Draft SVG

The draft is a human-readable reference drawing. It includes part outlines, operation/reference marks, dimensions/labels, joint notes, and a preflight banner. It is always available. When errors exist it is explicitly marked non-production.

Do not send a draft SVG directly to a machine: it intentionally contains mixed annotations and reference geometry.

## Production SVG

Production SVG is built from `FabricationManifestV1` and has these contracts:

- explicit `width="...mm"` and `height="...mm"` with a matching numeric `viewBox`;
- decimal millimetre coordinates (at least 0.01 mm precision) derived from unrounded manifest values;
- closed profile/cut vectors;
- stable operation groups for `profileCut`, `throughCut`, `drill`, `pocket`, and `engrave`;
- no background, text, legend, dimensions, `reference` operations, or duplicated annotation paths.

The production SVG is nominal geometry for downstream CAM. It does not contain feeds, speeds, tool ordering, post-processors, or G-code.

## Export Gate

`runPreflight()` returns stable `PreflightResult` records. The gate is fixed:

- any `error`: production SVG and fabrication ZIP are disabled; there is no override;
- one or more `warning` findings and no errors: explicit acknowledgement is required;
- `info` findings: do not block;
- draft SVG: remains available in every state.

The same gate is enforced in both the UI and exporter/package APIs, so bypassing a disabled button does not bypass validation. Package generation also recomputes nesting findings instead of trusting a supplied plan's cached findings. Overlap, spacing, stock bounds, quantity, and allowed rotation therefore fail closed even for a manually edited plan.

## Fabrication ZIP

`buildManufacturingPackage()` normalizes materials, consumes the selected validated Sheets plan when available, runs arcade build intelligence, and writes a store-mode ZIP. Without a supplied plan it generates a deterministic one. The exact sheet count and material directories depend on the project.

Representative default contents:

```text
manifest/
  fabrication-manifest.json
  package-manifest.json
  nesting-plan.json
  preflight-results.json
  package-findings.json
  arcade-intelligence.json
  procurement-bom.json
project/
  project-document.json
machine/
  calibration-100mm.svg
  <material>/sheet-<n>.svg
  <material>/sheet-<n>.dxf
reports/
  bom.csv
  total-bom.csv
  total-bom.json
  cut-list.csv
  material-summary.csv
  joint-schedule.csv
  fastener-schedule.csv
  operation-schedule.csv
  hardware-schedule.csv
  wiring-plan.csv
  ergonomics.csv
  t-moulding.csv
  preflight-report.html
assembly/
  assembly-guide.md
  part-labels.svg
  templates/<part>-drilling.svg
drawings/
  annotated-shop-layout.svg
```

Per-sheet machine SVG and DXF transform every supported operation into sheet coordinates, including 0, 90, 180, and 270 degree placements. Tests cover the transformed extents and gate safety for overlap and out-of-bounds edits. Drill templates are explicit-millimetre 1:1 outputs for parts that contain drill operations. The 100 x 100 mm calibration square provides an import-scale check. The annotated shop layout, labels, and drilling templates are human/workshop documents rather than machine toolpaths.

`reports/bom.csv` remains the fabricated-part list. `reports/material-summary.csv` records each used profile's measured thickness, uncut sheet dimensions, sheet count, cost per sheet, estimated material cost, supplier, and SKU. `reports/hardware-schedule.csv` records detected and additional hardware quantities, unit/line costs, supplier/SKU, and source.

`reports/total-bom.csv` is the purchasing view: it combines required stock-sheet lines with detected hardware and BOM-only additional components, then appends the project total. `reports/total-bom.json` and `manifest/procurement-bom.json` contain the same versioned rows plus material, hardware, combined-cost, priced-line, and unpriced-line summaries. A zero unit cost is counted as unpriced so that missing prices remain visible. Currency labels values but does not perform exchange-rate conversion. Batch packages scale detected and additional hardware quantities consistently with the batch material plan.

The fitted rear service door and four-piece screen frame enter the normal part/BOM/nesting path when enabled. Door hinge/latch marks are reference centres only; transfer the selected hardware's real mounting pattern before drilling.

Material, hardware, total-BOM, ergonomics, assembly, and T-moulding reports are planning aids: verify costs, stock availability, supplier dimensions, taxes/shipping, insertion/service space, and wiring lengths before purchase or cutting. An additional BOM component is not a placed hardware instance and does not generate machining geometry.

## Advanced Package Options

Persisted `fabricationSettings` or explicit API options can add:

```text
manifest/
  nominal-joinery-manifest.json
  joinery-assignments.json
  process/<profile>.json
  workshop-profile.json
  batch-plan.json
  design-variants.json
machine/derived/<process>/<material>/...
artwork/templates/...
artwork/masks/...
reports/process/...
reports/quote.json
reports/quote.csv
```

These options preserve the nominal source manifest and pass through the production warning/error gate. Joinery machining operations are generated only where panel-local mating-edge geometry exists; missing edge geometry produces a warning rather than invented vectors. Laser profiles can emit kerf-compensated closed geometry and router profiles can emit supported dogbone relief operations. Router holding-tab counts and dimensions remain guidance metadata: the package does not create interrupted tab vectors, open toolpaths, or machine instructions.

Production artwork, workshop/variant, batch, and quote options are tested package hooks but do not yet have rich desktop editors. See [Implementation Status](IMPLEMENTATION_STATUS.md) for the precise maturity boundary.
