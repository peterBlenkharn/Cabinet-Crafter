# Cabinet Crafter Documentation Index

Status: canonical
Audience: users, makers, and open-source contributors
Last updated: 2026-08-17

This directory contains the product, workflow, fabrication, and technical reference documentation for Cabinet Crafter.

## Fast Navigation

- [Build Your First Cabinet](FIRST_PROJECT.md): a short, illustrated route through the complete workflow using the Workshop Upright sample.
- [Project Brief](PROJECT_BRIEF.md): product intent, current scope, user-facing capabilities, and design direction.
- [Implementation Status](IMPLEMENTATION_STATUS.md): shipped UI, automatic export services, API-only capabilities, and remaining end-to-end gaps.
- [Architecture](ARCHITECTURE.md): desktop shell, web app modules, data ownership, and runtime flow.
- [Repository And Build Folder Guide](REPOSITORY_STRUCTURE.md): source versus generated output, build configurations, staging, checksums, and public release assets.
- [Parameter Reference](PARAMETERS.md): canonical parameter names, units, presets, and persistence behaviour.
- [Geometry Pipeline](GEOMETRY_PIPELINE.md): side-profile construction, flat-panel generation, component IDs, and metadata.
- [Controls And Hardware](CONTROLS_AND_HARDWARE.md): control deck/apron schema, explicit layout fitting, hardware definitions, keepouts, and integration status.
- [Fabrication Diagnostics](FABRICATION_DIAGNOSTICS.md): `FabricationManifestV1`, preflight contracts, material-thickness handling, and export gates.
- [Mannequin Presets](MANNEQUINS.md): ergonomic reference body presets and rendering style.
- [UI Workflows](UI_WORKFLOWS.md): presets, parameter editing, selection, component tuning, decals, scale reference, and assembly controls.
- [Exports](EXPORTS.md): `ProjectDocumentV2`, draft/production SVG, fabrication ZIP, and native delivery behaviour.
- [Windows Release Guide](RELEASE_GUIDE.md): verify, extract, start, update, uninstall, and troubleshoot the portable Windows application.
- [Privacy And Offline Use](PRIVACY_AND_OFFLINE.md): local data, network behaviour, shared-computer considerations, and data removal.
- [Before You Cut](BEFORE_YOU_CUT.md): design, sheet, CAM, machine, workshop, and assembly safety checks.
- [Maintainer Release Process](RELEASING.md): locked restore, package verification, protected tag releases, SBOM generation, and intentional unsigned distribution.
- [Changelog](CHANGELOG.md): project documentation and implementation change history.
- [Contributing](../CONTRIBUTING.md): development checks, generated-file hygiene, and inbound MIT licensing.
- [Support](../SUPPORT.md): where to ask for help, report faults, suggest improvements, and disclose vulnerabilities safely.

Repository licensing and security information is in the root [MIT Licence](../LICENSE), [Third-Party Notices](../THIRD_PARTY_NOTICES.md), and [Security Policy](../SECURITY.md).

## Repository Map

See [Repository And Build Folder Guide](REPOSITORY_STRUCTURE.md) for the complete directory lifecycle, including `bin`, `obj`, `artifacts`, `Debug`, `Release`, and `staging`.

- `CabinetCrafter.csproj`: WPF desktop project targeting `net9.0-windows`.
- `MainWindow.xaml` and `MainWindow.xaml.cs`: WebView2 host window and local `wwwroot` mapping.
- `wwwroot/index.html`: application markup and control layout.
- `wwwroot/style.css`: visual system and responsive layout.
- `wwwroot/js/app.js`: Three.js scene, camera, renderer, raycasting, application lifecycle.
- `wwwroot/js/cabinet.js`: parametric cabinet model, presets, component metadata, panel overrides.
- `wwwroot/js/ui.js`: DOM binding, parameter controls, selection inspector, component tuning.
- `wwwroot/js/workspace-shell.js`: responsive workspace modes, sidebar state, inspector tabs, settings search, and viewport context.
- `wwwroot/js/status-service.js`: persistent and transient user status, progress, history, and recovery actions.
- `wwwroot/js/help-registry.js` and `wwwroot/js/help-system.js`: canonical user explanations, searchable help, contextual tooltips, and learning entry points.
- `wwwroot/js/maker-workflow.js`: guided navigation, hardware review/import, material/stock editor, Sheets workspace, recent projects, and user presets.
- `wwwroot/js/project-document.js`: `ProjectDocumentV2`, validation, migration, serialization, and reusable history support.
- `wwwroot/js/fabrication.js`: renderer-independent `FabricationManifestV1` generation and preflight.
- `wwwroot/js/export.js`: project orchestration plus annotated draft and production SVG generation.
- `wwwroot/js/materials.js` and `wwwroot/js/nesting.js`: stock profiles, material summaries, and automatic true-shape sheet planning.
- `wwwroot/js/manufacturing-pack.js`: fabrication ZIP, validated/rotated per-sheet SVG/DXF, reports, labels, drilling templates, drawings, and advanced package hooks.
- `wwwroot/js/hardware-library.js`, `wwwroot/js/arcade-intelligence.js`, `wwwroot/js/ergonomics.js`, and `wwwroot/js/assembly.js`: arcade hardware and maker guidance services.
- `wwwroot/js/joinery.js`, `wwwroot/js/artwork-production.js`, and `wwwroot/js/workshop.js`: advanced API-layer construction, artwork, and workshop planning services.
- `wwwroot/js/dummy.js` and `wwwroot/js/dummy-layout.js`: mannequin rendering plus the shared connected-body layout contract.
- `wwwroot/js/lib/`: vendored Three.js modules.
- `tools/build-release.cmd` and `tools/build-release.ps1`: versioned, rooted Windows ZIP packaging with clean-package and notice checks.
- `.github/workflows/release.yml`: tag-driven unsigned GitHub Release with protected publication, SBOM, checksums, and immutable-ready asset upload.
