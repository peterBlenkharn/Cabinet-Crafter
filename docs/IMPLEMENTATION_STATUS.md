# Implementation Status

Status: canonical snapshot  
Last updated: 2026-08-10

This document separates capabilities available in the desktop UI from automatic package behavior and optional service APIs.

## Integrated In The Desktop Workflow

| Area | Current behavior |
| --- | --- |
| Guided workflow | A visible **Design -> Hardware -> Review -> Sheets -> Export** navigation guides the main maker journey. Guided and Detailed modes switch the density of the Structure/Profile/Display/Internals/Controls workspace. |
| Cabinet design | Standard upright and Bar-top presets, parametric profile/display/internal/control settings, stable panel identities, per-component offsets/dimensions/thickness/colour, artwork preview, mannequin scale, and exploded view. Internal structure includes an apron-flush transverse control support, one centred or two symmetrically spaced full-height cabinet-profile spines, a mitred rear-to-display support, a recess-mounted header wedge, a raised machine support, configurable cable through-cuts, and paired open-ended cross-lap slots for crossing horizontal panels. The persisted Bar-top ID remains `barstool`. |
| Decorative side shaping | A transactional Bézier editor customizes linked or independent outer walls with anchors, handles, exact mm/in values, snap, Fit/zoom, and local undo/redo. The structural envelope is immutable; validation blocks inward, self-intersecting, malformed, or over-complex curves. Valid contours enter viewport, project history, fabrication, nesting, and export without changing ribs, joints, or fasteners. |
| Precision editing | Sliders have exact numeric companions, inline range validation, keyboard number increments, field and section reset, and optional inch display. Geometry and persisted fabrication values remain millimetres. |
| Project handling | Project name, dirty indicator, undo/redo, preset/open confirmation, autosave recovery, and `ProjectDocumentV2` save/load are connected. Native Windows Open, Save, Save As, text-export, and binary-export dialogs are used in the desktop host; browser downloads/local storage are fallbacks for browser development. A Project dialog exposes desktop recent files and reusable user presets stored on the device. |
| Inspection | Perspective plus orthographic front/side/top views, fit/reset, frame selected, isolate/show all, keyboard panel selection, separate **Show in viewport** and **Include in fabrication** state, and an accessible live status region. |
| Controls and hardware | Generic deck/apron controls use bundled button and joystick definitions as the authoritative source for machining operations, mounting/body geometry, underside keepouts, and hardware preflight. Overflowing layouts produce a blocking error and an explicit fitted suggestion. The Hardware step includes a read-only control-layout reference, searchable/importable definitions, detected schedules/findings, per-definition unit cost/supplier/SKU editing, and additional BOM-only component lines with quantity and notes. Arbitrary placement of imported or non-control hardware is not yet available; adding a BOM line does not create geometry. |
| Review | `FabricationManifestV1` is a renderer-independent downstream contract; the current adapter still snapshots live Cabinet/panel metadata produced by the Three.js-era geometry path. Preflight findings use stable codes and `error`, `warning`, or `info` severity. Issue cards can select/frame an affected part and expose corrective actions. |
| Materials and sheets | The component inspector visibly assigns a material/measured thickness to the selected or scoped panel group and links to stock management or the relevant sheet placement. The Sheets step edits material/stock name, nominal and measured thickness, uncut sheet width/height, grain, finished faces, density, price per sheet, supplier/SKU/notes, available quantity, trim margin, spacing, and allowed rotations. Parts can be assigned to profiles. The workspace generates ranked true-shape candidates, previews each sheet, supports validated X/Y moves, rotations, exclusions, and pinned placements, and reports per-material sheet costs plus actionable findings. |
| Export | Annotated draft SVG is always available. Production SVG uses explicit `mm` dimensions, a matching `viewBox`, decimal source measurements, closed operation groups, and no annotations/reference geometry. Errors cannot be overridden; warnings require acknowledgement. |
| Fabrication package | The Export dialog creates a ZIP containing versioned project/fabrication/package/nesting/preflight/intelligence/procurement records, per-sheet SVG/DXF, calibration geometry, the fabricated-part BOM, CSV/JSON total procurement BOM, cut list and schedules, labels, reports, an assembly guide, and 1:1 drilling templates for parts that contain drill operations. Material, hardware, and combined estimated costs are summarized in project currency. The currently validated Sheets plan is passed to the package and revalidated before production files are written. |
| Service assemblies | The rear service opening produces a stable fitted door part with per-side clearance plus hinge/latch reference centres and a schedule. The monitor screen frame produces four stable rail/stile parts with mating metadata. The references do not replace selected-hardware drilling patterns or a detailed hinge/latch editor. |
| Desktop distribution | A locked, self-contained win-x64 build is packaged as a versioned rooted portable ZIP with SHA-256, end-user guidance, MIT licence, exact WebView2/.NET notices, and clean-package checks. Windows CI runs the headless suite, builds the release, verifies runtime assets, and runs packaged startup smoke. Matching `v<version>` tags publish a GitHub Release with an SPDX JSON SBOM and optional fail-safe Authenticode signing. |

## Service Layer And Optional Package Capabilities

These modules are implemented and covered by headless tests. **Automatic** means normal package generation consumes the capability; **persisted/API option** means `fabricationSettings` or an explicit caller can enable it, but the desktop has no rich editor for it.

| Module | Maturity | What is available now |
| --- | --- | --- |
| `project-document.js` | Integrated | Versioned document creation, validation, explicit v1.x migration, serialization, file naming, desktop bridge helper, and reusable history support. |
| `fabrication.js` | Integrated downstream | Plain-data manifest generation, typed operations, exact millimetre contours, assembly parts, joints, portable fastener metadata, hardware instances/keepouts, fit suggestions, and deterministic preflight. Upstream parametric geometry has not yet been fully extracted from `cabinet.js`/Three.js metadata. |
| `materials.js` | Integrated | Portable material profiles, validation, assignment, cost/weight summaries, and defaults feed the Sheets editor and package. |
| `procurement.js` | Integrated | Normalizes detected-hardware cost overrides and additional BOM-only items, builds costed hardware schedules, and combines required stock sheets and hardware into a versioned procurement BOM with material/hardware/total costs. |
| `nesting.js` | Integrated | Deterministic multi-candidate, multi-material, multi-sheet true-shape packing; rotations/grain, quantity, spacing, overlap, bounds, pin, move, exclude, and offcut behavior are validated. The UI supports numeric/manual positioning rather than freehand drag-and-drop. |
| `hardware-library.js` | Partly integrated | Bundled definitions cover controls, monitor, audio, cooling, service, I/O, electronics, computer, handle, and caster categories. Generic controls are authoritative manifest hardware. Search/import, schedules, purchasing metadata, and BOM-only additions are visible, but arbitrary instance placement and full supplier-catalogue management are incomplete. |
| `arcade-intelligence.js` | Automatic/advisory | Aggregates hardware, wiring, ergonomics, assembly, T-moulding, player-spacing, trackball-path, monitor-depth, ventilation, encoder, and service-access findings for package reports. Relationship findings are advisory and do not replace supplier drawings or physical checking. |
| `ergonomics.js` | Automatic/API | Small/average/tall eye-line, viewing distance/angle, reach, and control-height analyses are exported as CSV. There is no interactive comparison workbench. |
| `assembly.js` | Automatic/API | Deterministic numbered stages, joint/fastener summaries, labels, Markdown guide, T-moulding calculations, and automatic 1:1 drill templates. Rendered orthographic step diagrams are not implemented. |
| `joinery.js` | Persisted/API option | Mitre, butt screws, cleat, dado, rabbet, dowel, and tab-slot strategies can add optional nominal joinery records. Generation fails safely with a warning when panel-local mating-edge geometry is absent; complete edge geometry is not yet available for every joint. |
| Router/laser derivation | Persisted/API option | Derived package folders can contain laser kerf-compensated vectors and router dogbone operations while retaining the nominal source manifest. Router holding-tab count/dimensions are CAM guidance metadata only; actual interrupted tab vectors/toolpaths are not emitted. |
| `artwork-production.js` | Persisted/API option | Full-scale template records, bleed/safe areas, DPI checks, cutout masks, mirroring, and 1:1 SVGs can be included in an advanced package. The desktop artwork UI remains preview/decal oriented. |
| `workshop.js` | Persisted/API option | Workshop profiles, named design variants, batch quantities, batch hardware/labels, and quote JSON/CSV can be included in an advanced package. Focused stock/hardware purchasing fields are integrated, but there is no rich variants, batch, labour/overhead, tax/shipping, or quote editor. |

## Not Yet Complete End To End

- A full renderer-independent upstream geometry engine; manifest consumers are decoupled, but Cabinet construction still supplies part metadata from the live model path.
- Guided mode still needs beginner-friendly decorative-profile presets; Detailed mode provides the full curve editor. Freehand sheet dragging, an offcut inventory/editor, and cross-sheet drag interaction remain incomplete. Numeric placement, rotation, pinning, exclusion, regeneration, and validation are present.
- A full arbitrary hardware placement editor for trackballs, spinners, monitors, speakers, fans, doors, encoders, computers, inlets, handles, feet, and casters.
- Selected-hardware hinge/latch hole patterns, interactive cable routing, maintenance-envelope editing, and exact routed harness lengths.
- An interactive ergonomic comparison workbench and rendered orthographic assembly-step diagrams. Full-size drill templates are present.
- Complete per-edge joint geometry and a desktop joint-strategy editor. Optional strategies refuse to invent machining vectors when required mating-edge data is missing.
- True router holding-tab vectors, G-code, post-processors, feeds/speeds, or direct machine control. Holding tabs remain downstream-CAM metadata.
- A rich print-production editor, even though advanced packages can include production artwork records/templates.
- Rich design-variant, batch, supplier-catalogue/order, tax/shipping, and quote editors, even though focused material/hardware cost fields and the underlying advanced package hooks are persisted and tested.
- Cocktail, sit-down, pinball, generalized cabinet families, structural simulation, cloud accounts, or collaboration.

## Release Interpretation

The repository includes manufacturing-trust contracts, deterministic headless coverage and golden fixtures, a 100 x 100 mm calibration SVG, rotated-sheet export checks, fail-closed gate tests, Windows CI, publish-asset checks, and a packaged-app startup smoke test. These safeguards do not replace validation in the intended CAM package and on representative workshop hardware. Treat the calibration contour, preflight report, material assignment, tool/kerf choices, supplier drawings, and a physical test cut as required maker checks.
