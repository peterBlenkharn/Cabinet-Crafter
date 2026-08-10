# Project Brief

Status: canonical
Last updated: 2026-07-17

## Product Purpose

Cabinet Crafter is an arcade build-confidence system for maker-builders. It combines guided parametric design with fabrication preflight, clean machine geometry, stock planning, arcade-specific hardware knowledge, and workshop hand-off files. The goal is not merely to draw a cabinet; it is to expose likely problems before sheet material is cut.

Primary user outcomes:

- choose a proven upright posture and adjust dimensions precisely;
- identify, include/exclude, inspect, and tune every flat component;
- understand joints, bevels, screws, cutouts, and hardware clearances;
- keep reference drawings separate from production machine vectors;
- block unsafe production exports while retaining an annotated draft;
- receive sheets, BOM/cut lists, schedules, labels, reports, and assembly guidance in one package.

## Product Scope

Two canonical presets are supported:

- `standard`: full-height upright arcade cabinet;
- `barstool`: squat counter/bar-top cabinet, displayed in the UI as **Bar-top** while retaining the persisted ID for compatibility.

Cocktail, sit-down, pinball, and generalized cabinet families are not currently supported.

The active model is a sheet-material cabinet generated from side-profile contours and rectangular panels spanning between the walls. Internal supports, controls, fasteners, cutouts, and reference features attach to stable panel IDs.

## Current User-Facing Capability

- WPF/WebView2 Windows desktop application with bundled local assets.
- Visible **Design -> Hardware -> Review -> Sheets -> Export** maker workflow, with the dense parametric panels retained for detailed design.
- Parametric Three.js cabinet, stable component inventory, selection, overrides, panel colours, decals, mannequin, and exploded view.
- Exact numeric entry, optional inch display, field/section resets, orthographic inspection, framing/isolation, keyboard navigation, and accessible status/preflight feedback.
- Generic arcade deck/apron layouts with authoritative bundled hardware operations/body keepouts and explicit fit suggestions rather than silent compression. A searchable/importable hardware library supports review, but arbitrary placement is not yet available.
- Named `ProjectDocumentV2` files with explicit legacy migration, dirty state, undo/redo, autosave recovery, recent projects, user presets, and native dialogs.
- Renderer-independent downstream manufacturing manifest plus error/warning/info preflight; upstream Cabinet geometry remains coupled to the current model adapter.
- Always-available annotated draft SVG and preflight-gated millimetre production SVG.
- Editable material/stock profiles and part assignments plus ranked, validated sheet plans with manual position/rotation, pin, and exclusion controls.
- Fabrication ZIP with the selected material-grouped sheet plan, safely transformed SVG/DXF, calibration file, versioned manifests, BOM/cut list and schedules, labels, preflight report, shop layout, assembly guide, service-door/frame parts, and 1:1 drilling templates.
- Dependency-free manufacturing tests and Windows build/publish smoke CI.

## Implemented Service Foundation

The repository also includes portable arcade hardware definitions, wiring estimates, ergonomic reference analysis, assembly/T-moulding planning, joinery/process derivation, full-scale artwork templates, variants, batches, and quote services.

Not every service has a desktop editor. Joinery, derived router/laser output, production artwork, workshop profiles, variants, batches, and quotes are persisted/API package options rather than rich user workflows. Complete mating-edge geometry and actual router holding-tab vectors are still missing. [Implementation Status](IMPLEMENTATION_STATUS.md) is the definitive maturity map.

## Visual Direction

The canonical interface is a restrained technical drafting workspace:

- light background and pale opaque parts;
- fine grey construction grid and dark wireframe edges;
- clear selected/error states and visible keyboard focus;
- compact monochrome controls with severity labels that do not rely on colour alone.

Avoid neon game-room decoration, glassmorphism, glossy materials, glow effects, and ornamental animation that competes with fabrication information.

## Non-Goals

- G-code, post-processors, direct machine control, feeds/speeds, or tool libraries.
- Structural simulation or certification.
- Cloud accounts, online collaboration, or shared project hosting.
- Curved plastic/metal shell design.
- Assuming inferred hardware dimensions replace supplier drawings or a physical test fit.

The output is nominal geometry and maker documentation for downstream CAM. Router/laser process profiles may derive optional geometry, but the nominal manifest must remain available and the user remains responsible for machine/tool compensation and safe workholding.
