# Changelog

Status: canonical
Last updated: 2026-08-17

## 2026-08-17

- Made official Windows distribution explicitly unsigned and removed the dormant certificate-secret path from release automation and documentation.
- Split tagged releases into a read-only build and verification job followed by a protected publication job, with exact payload and checksum verification on both sides of the approval gate.
- Required annotated version tags to belong to `main`, pinned GitHub Actions to reviewed commits, and switched publication to GitHub's immutable-ready release command.

## 2026-08-11

- Rebuilt the repository landing page around an immediate product view, a short captioned tour, a clear five-stage Mermaid workflow, focused feature and safety guidance, and task-based documentation routes.
- Added the complete Workshop Upright sample with costed hardware, three-sheet MDF plan, confirmed workflow state and fabrication-ready export data, plus an illustrated first-project guide.
- Added curated light, dark, stage and settings visuals, a social-preview asset, GitHub issue forms, a pull-request template and a public support guide.
- Added documentation and sample-project contracts that verify the landing-page media, support routes, project readiness, purchasing totals and persisted sheet plan.

## 2026-08-10

- Reorganised the public README around the Windows download, one-minute portable start, five-stage product workflow, safety guidance, source build, and contributor routes.
- Added a canonical repository/build-folder guide distinguishing source, `bin`, `obj`, raw publish output, staged candidates, final ZIPs, checksums, SBOMs, and short-lived Actions artifacts.
- Clarified the roles of the external ZIP checksum, internal complete-file release manifest, component SBOM, unsigned Windows distribution, and GitHub's automatic source archives.
- Added inbound MIT contribution terms while making the boundary between original Cabinet Crafter work and third-party licence terms explicit.
- Strengthened release licensing by deriving WebView2 and .NET runtime-pack versions from locked/published metadata and packaging the exact Three.js, .NET Core runtime, Windows Desktop runtime, and WebView2 upstream terms.

## 2026-07-25

- Rebuilt the internal support system with an apron-flush transverse support, a mitred display-bottom support, a recess-mounted header wedge, and one centred or two symmetrically spaced full-height cabinet-profile spines. Horizontal panels now pass through matching full-depth spine slots without protruding rib tabs.
- Added configurable fabrication cable ports and offsets for the control support, profile supports, display support, header support, and machine shelf.
- Corrected the generated **vee** control layout so its two rows converge exactly as shown by the preview.
- Changed exploded-view displacement to radial assembly-centre vectors and retained those vectors as panel metadata.
- Rebuilt the scale mannequin around a shared renderer-independent body layout so connected limbs retain common joint endpoints and stable proportions after preset, height, depth, and visibility changes.
- Added scoped per-panel material/thickness assignment, per-panel screw-group overrides, and deterministic individual screw overrides with downstream preflight/export metadata.
- Strengthened true-shape nesting with polygon-vertex/void candidate searches, a void-fill candidate, deterministic compact search for small groups, and a concave-profile consolidation regression.
- Converted Hardware, Review, and Sheets into full-viewport maker stages with persistent completion checkmarks, dedicated Review findings, and explicit continue actions.
- Added integrated light/dark themes, an automatic and replayable 11-step first-user walkthrough, and a deterministic Cabinet Crafter icon for the Windows executable, taskbar, window, and web surface.
- Added focused geometry, layout, explode, screw, and nesting regression coverage and verified the packaged Windows web assets.
- Added MIT release metadata, exact third-party notice packaging, locked .NET dependency restore, versioned rooted portable ZIPs, SHA-256 checksums, clean-package tests, end-user privacy/release/safety guidance, and a tag-driven GitHub Release workflow with SPDX SBOM generation.

## 2026-07-17

- Added `ProjectDocumentV2` with named projects, units, design/artwork, materials, fabrication settings, inclusion, view/mannequin, and asset sections; added explicit v1.x migration, validation, safe naming, and schema-aware failures.
- Added native Windows Open, Save, Save As, text-export, binary-export, recent-project, and autosave bridge operations with atomic project writes and surfaced failures.
- Added project dirty state, undo/redo, autosave recovery, preset/open confirmations, keyboard shortcuts, exact numeric inputs, mm/in display conversion, inline validation, and field/section resets.
- Added the visible **Design -> Hardware -> Review -> Sheets -> Export** maker workflow while retaining the detailed design panels as the advanced workspace.
- Added a Project dialog with native recent-file opening and device-local reusable user presets.
- Separated viewport visibility from fabrication inclusion and added orthographic views, fit/reset, frame-selected, isolate/show-all, keyboard panel navigation, visible focus, and live status/preflight regions.
- Introduced renderer-independent `CabinetCrafter.FabricationManifestV1` records for materials, parts, contours, joints, fasteners, keepouts, typed operations, and control fit suggestions.
- Connected bundled control hardware definitions as the authoritative source for button/joystick machining operations, supported thickness, underside bodies, keepouts, and hardware preflight. Added searchable hardware review and portable JSON definition import; arbitrary non-control placement remains future work.
- Replaced silent control-layout compression with blocking `LAYOUT_DOES_NOT_FIT` preflight plus an explicit **Apply fitted suggestion** action.
- Added stable error/warning/info `PreflightResult` records and checks for dimensions, contours, self-intersection, cutout clearances/collisions, screw conflicts, hardware keepouts, materials/stock, operation geometry/types, structural collisions, fasteners, and joint bevel agreement.
- Split export into an always-available annotated draft SVG and a gated, annotation-free, explicit-millimetre production SVG. Errors cannot be overridden and warnings require acknowledgement.
- Added fabrication ZIP generation with versioned manifests, true-shape material-grouped sheet plans, per-sheet SVG/DXF, a 100 mm calibration file, BOM/cut-list/material/joint/fastener/operation/hardware/wiring/ergonomics/T-moulding reports, preflight HTML, part labels, annotated shop layout, and assembly Markdown.
- Added an interactive material/stock editor, per-part material assignments, ranked multi-candidate Sheets workspace, numeric manual placement, allowed rotation, pinning, exclusion, stock/grain/quantity validation, utilisation/waste/offcut/weight/cost summaries, and handoff of the validated selected plan to package export.
- Added safe quarter-turn transforms for per-sheet machine operations and fail-closed revalidation of supplied nesting plans so overlap or stock-bound edits cannot bypass the package gate.
- Converted the rear service opening into a stable fitted door part with hinge/latch reference centres and converted the monitor frame into four stable fabricated rail/stile parts with assembly/mating schedules.
- Added automatic explicit-millimetre 1:1 drilling templates for parts with drill operations.
- Added portable material profiles, built-in arcade hardware definitions, arcade-intelligence aggregation, ergonomic analysis, assembly/T-moulding planning, joinery/process derivation, production-artwork templates, and workshop/variant/batch/quote modules.
- Connected advanced manufacturing-package hooks for optional joinery records, laser/router-derived files, production artwork, workshop profiles, design variants, batch quantities, and quote reports while retaining the nominal manifest and production gate. Missing joint-edge geometry warns instead of inventing cuts; router holding tabs remain CAM metadata rather than emitted tab vectors.
- Added disposal of replaced Three.js geometry, materials, edge resources, and generated textures during rebuilds.
- Renamed the user-facing `barstool` preset to **Bar-top** while retaining the stored ID.
- Added and expanded dependency-free headless contract/golden coverage for projects, geometry/manifest/preflight, hardware, service assemblies, nesting transforms/gates, advanced packages, and exporters. Windows CI covers tests, .NET build/publish, runtime assets, packaged-app startup smoke, and publish artifact upload.
- Updated the desktop project so all `wwwroot` assets copy to build and publish output.
- Added [Implementation Status](IMPLEMENTATION_STATUS.md) to distinguish integrated desktop features, automatic package services, API-only capabilities, and remaining roadmap work.

## 2026-07-15

- Replaced gap-producing rectangular panel end relief with joint-aware mitred and butt-cut panel solids.
- Corrected side-wall extrusion centring so internal panels finish flush with the inside faces of the side walls.
- Added pilot screw references on rectangular panels and mirrored side-wall fixing markers.
- Updated fabrication diagnostics, component readouts, and SVG exports with joint types and fastener counts.
- Corrected control-deck layout axes so joystick/button groups sit across cabinet width, added visual layout-style selectors, and added a custom drag layout editor.
- Made the monitor reference visible as a dark screen on the outward bezel face.

## 2026-06-25

- Added canonical modular documentation set under `docs/`.
- Added root `README.md` pointing to the documentation index.
- Documented the current architecture, parameter API, geometry pipeline, UI workflows, and export behaviour.
- Narrowed canonical preset scope to `standard` and `barstool`.
- Established ultra-minimal opaque wireframe as the canonical visual direction.
- Replaced neon/glass UI styling with monochrome drafting-style panels, controls, and viewport rendering.
- Added richer global parameters for toe kick, control deck, display aperture, marquee shape, and material thickness.
- Added `componentOverrides` for per-component offset, length delta, width delta, and thickness delta.
- Added a compact component inspector with component ID, role, size, area, thickness, and override state.
- Made selected components visible through a high-contrast pale hatch highlight plus dark wireframe edges.
- Updated SVG export styling and dimensions to reflect current component metadata and per-component overrides.
- Verified desktop and narrow viewport rendering through Edge CDP screenshots and canvas-pixel checks.
- Changed the mannequin from hollow wireframe to opaque wireframe and added multiple age/height/proportion presets.
- Reworked the `barstool` preset into a squat bar-top cabinet.
- Added material-thickness-aware joint/intersection diagnostics in the viewport, component readout, and fabrication summary.
- Added configurable control-deck and front-apron hardware schemas with positions, inclusion toggles, colours, labels, and cutout metadata.
- Added 24 square colour chips for per-component colour selection, defaulting to off-white.
- Updated JSON/SVG export behaviour to include control hardware metadata and cutout markers.
- Replaced texture-only controls with physical 3D buttons, start buttons, and joystick assemblies.
- Added fitted control layouts with separate X/Y spacing, layout style, player-group axis, group rotation, joystick gap, and apron axis controls.
- Added full-thickness panel end relief so canonical presets do not self-intersect by default.
- Added invalid overlap detection with red viewport markers, red panel inventory state, component warnings, and fabrication-summary warnings.
- Fixed rectangular panel material assignment so image decals render on broad front-facing panels such as `panel_kick`.
- Replaced the remaining 2D panel-intersection test with 3D oriented-box collision checks using panel length, width, and material thickness.
- Corrected panel outward normals from `faceDir` so apron/start controls protrude toward the player instead of being drawn sideways on the panel texture.
- Removed texture-drawn hardware circles from panel materials; buttons, start buttons, and joysticks are represented by 3D meshes only in the viewport.
