# UI Workflows

Status: canonical  
Last updated: 2026-08-10

## Current Layout

The desktop presents a five-step maker path across the top:

1. **Design** returns to the parametric editing workspace.
2. **Hardware** opens the real-hardware library and inferred build schedule.
3. **Review** focuses the severity-grouped fabrication findings.
4. **Sheets** opens material assignment and stock-layout planning.
5. **Export** opens the gated output dialog.

The detailed design workspace remains dense and maker-oriented:

- header: project name/dirty state, units, undo/redo, Project, Open/Save/Save As, and Export;
- viewport toolbar: perspective/front/side/top, fit/frame/reset, isolate/show all;
- left sidebar: Standard and Bar-top presets plus Structure/Profile/Display/Internals/Controls tabs;
- right sidebar: component inspection/tuning, visible material/stock assignment, severity-grouped fabrication review, screw settings, panel inventory, and artwork;
- footer: scale mannequin, exploded view, grid, and edges;
- export dialog: draft SVG, gated production SVG, and gated fabrication ZIP.

The visible Guided/Detailed switch controls information density. Guided retains the main dimensions and staged maker path; Detailed exposes advanced structure, shaping, hardware, and component controls.

## Projects, History, And Recovery

The header project name participates in dirty-state tracking. Design, component, inclusion/visibility, artwork, mannequin, material, nesting, and view mutations enter bounded UI history where appropriate.

- `Ctrl+S`: Save; `Ctrl+Shift+S`: Save As; `Ctrl+O`: Open.
- `Ctrl+Z`: Undo; `Ctrl+Y` or `Ctrl+Shift+Z`: Redo.
- Preset replacement and opening over unsaved work require confirmation.
- Dirty projects autosave after a short debounce. The desktop host uses LocalAppData; browser development uses local storage.
- On startup, a recovery banner offers Restore or Discard.
- Native file/write errors are shown in the live status message rather than silently ignored.
- The **Project** dialog lists recent desktop files and device-local user presets. A user preset captures reusable project parameters; applying one observes the unsaved-work safeguards.

Saves use `ProjectDocumentV2`; legacy v1.x JSON is migrated explicitly on load. The user-facing Bar-top preset retains the persisted `barstool` identifier.

## Parameter Editing

`UIManager` discovers `data-param` and `data-control-param` fields. Every numeric range receives an exact number input, unit label, and field-reset button. Control sections receive a reset action.

The mm/in toggle changes display and input conversion only. Values are converted back to millimetres before entering `Cabinet.params`; inch exact inputs use 0.001-inch steps. Invalid/out-of-range values receive inline validity styling and do not commit as geometry. Native number-input arrow keys provide keyboard increments.

Preset application replaces the active design params, updates the reset baseline, clears active selection, and enters undo history. Decals are not automatically discarded.

## Decorative Side Profile Editor

The Profile tab opens a transactional advanced editor for the two outer side walls. It starts from the current assembled structural envelope and does not alter internal panels, full-height supports, joints, slots, or fasteners.

- **Use decorative profile** enables the saved curve without discarding it when switched off.
- **Keep left and right linked** edits one shared curve. Unlinking copies the visible shared result to both walls before independent edits begin.
- The hatched structural envelope is locked. The solid final outline may add material but cannot cross inside it.
- Anchors can be selected in the drawing or in the accessible anchor list, moved by pointer or keyboard, and entered exactly in the current display unit. Corner, smooth, and symmetric modes expose cubic handles with exact coordinates.
- Pointer snapping, Fit/zoom, local undo/redo, add/delete midpoint, and reset controls stay inside the editor transaction. Cancel discards the session; closing a changed session asks before discarding.
- Apply validates both sides using the production sampling tolerance. Self-intersection, inward notches, malformed, or over-complex curves disable Apply.

Applied curves enter project history, autosave, ordinary project files, the 3D wall meshes, stock calculations, nesting, and exported wall contours. An invalid saved curve opens as the safe structural outline and produces a blocking profile finding instead of silently exporting different geometry.

## Control Layouts And Hardware

The Controls tab edits player/button counts, rows, layout style, group axis/rotation/spacing, button/joystick dimensions and offsets, colours, labels, apron controls, and a custom drag layout.

Dragging writes `params.controls.deck.customLayout` and switches the layout style to `custom`. If a requested layout does not fit, the viewport keeps the requested design and preflight blocks production. The Fabrication issue card offers **Apply fitted suggestion**, which commits the proposed coordinates as a custom layout. No fitting occurs without that user action.

Bundled button and joystick definitions are authoritative for the generic control layout: their cut/drill operations, supported thickness, underside bodies, and keepouts enter the manifest and preflight. The Hardware step provides a read-only deck/apron control-layout reference, searchable definition cards, JSON definition import, the currently inferred schedule, and arcade-fit findings. **Back to Controls editor** returns to the editable layout.

Detected schedule lines can record unit cost, supplier, and SKU in the project currency. **Add BOM component** creates a manually named purchasing line, while **Add to BOM** on a reference definition starts one from that definition; additional lines also record category, quantity, notes, unit cost, supplier, and SKU. The Hardware summary reports detected items, total BOM lines, component cost, and zero-cost lines that still need pricing review.

Detected items remain tied to authoritative design operations. Additional BOM components are purchasing records only: adding a monitor, computer, cable, or other item to the BOM does not place it on a panel, create a cutout, or prove that it fits. The app does not yet place arbitrary trackballs, displays, fans, doors, computers, or other library hardware onto panels.

## Materials And Sheets

The selected-component inspector exposes **Material and stock** without hiding it under the screw editor. A material can be applied to the selected panel, all structural panels, all shell panels, or all panels; its measured thickness becomes the scoped panel thickness. **Manage stock** opens Sheets, while **Find on sheet** opens the current layout at the selected part when a current placement exists and otherwise focuses that part's material assignment.

The Sheets step edits portable stock profiles and assigns included parts to them. Editable fields cover material name, nominal/measured thickness, uncut sheet width and height, grain direction, finished faces, density, price per sheet, available quantity, trim margin, part spacing, supplier, supplier SKU, stock notes, and allowed quarter-turn rotations.

After validation, **Regenerate layouts** creates ranked true-shape candidates. Candidate ranking prefers fewer sheets and then lower waste. The workspace reports sheet count, utilisation, waste, reusable-offcut area, unplaced/excluded parts, estimated weight, and sheet cost. A per-material breakdown shows required sheet count, cost per sheet, and line total. Actionable stock, assignment, and placement findings link to the relevant material field, part assignment, or sheet placement.

Selecting a placed part exposes exact X/Y entry, the next allowed rotation, exclusion, and **Pin through regeneration**. Every edit is rechecked for trim/stock bounds, spacing, overlap, allowed rotation, quantity, and grain restrictions. Manual editing is numeric/select-based rather than freehand dragging. The validated selected plan is passed to the fabrication ZIP; package generation recomputes gate findings so a stale or modified plan cannot bypass validation.

## Selection, Inclusion, And Visibility

Users select a panel by clicking the 3D model or its panel-inventory row. The inventory is a keyboard listbox: Arrow Up/Down and Home/End move selection.

Selection synchronizes the viewport highlight, inventory, inspector, component controls, and issue navigation. The inspector shows identity, role, dimensions, area, thickness, joints, collisions/warnings, cutouts/ports, fasteners, colour, override state, viewport visibility, and fabrication inclusion.

Two independent toggles are intentional:

- **Show in viewport** changes `Cabinet.hiddenPanelIds` and never removes the part from output.
- **Include in fabrication** changes `params.fabricationInclusion[partId]` and controls manifest/export inclusion.

Isolate is a temporary viewport aid. Show All clears hidden/isolation state; it does not re-include deliberately excluded fabrication parts.

## Fabrication Review

The Fabrication section renders `PreflightResult` cards grouped as error, warning, and info, with totals and Ready/Review required/Blocked status. A card displays its stable code, message, and corrective action. Activating it selects/frames the affected panel and focuses a responsible parameter/control where one is recorded.

The Export badge counts errors plus warnings. Opening Export repeats the preflight summary. Draft remains enabled; production/package controls enforce errors and warning acknowledgement.

## Camera And Keyboard Inspection

- `3D`, Front, Side, and Top switch perspective/orthographic cameras.
- Fit, Frame selected, Isolate, and Show all provide explicit viewport actions.
- With the 3D preview focused, the arrow keys orbit and Page Up/Page Down zoom.
- With the 3D preview focused, `Home` fits the cabinet and `Escape` clears selection.

Toolbar buttons expose `aria-pressed` state. Semantic buttons/labels, visible focus styles, listbox navigation, status/preflight `aria-live` regions, and non-colour-only finding labels support keyboard and assistive-technology use.

## Internal Structure And Artwork

The Internals tab controls the apron-flush control support, continuous full-height cabinet-profile supports, display-bottom support, recess-mounted header support, rear service door, machine shelf, cable slots, and monitor screen frame. One profile support is centred by default; selecting two places them symmetrically with configurable spacing. The display support runs from the back panel to an angle-matched end at the display bottom. Each horizontal structural panel and full-height support use complementary open-ended cross-lap slots: the shared intersection is divided at its midpoint so the parts slide together without a weak bridge around a closed full-length rib slot. Each structural cable slot exposes width, height, and offset controls and enters fabrication as a real through-cut. These supports and the shelf are selectable fabricated panels.

The service-door opening creates a stable fitted door part with per-side clearance plus hinge/latch reference centres and a hardware schedule. The screen frame creates four stable rail/stile parts with mating records. Hinge/latch centres remain references: the app does not generate the selected hardware's full mounting pattern or provide a rich hinge/latch editor.

Artwork remains selected-panel oriented: upload PNG/JPEG, select a decal, adjust X/Y/scale/rotation, or delete. Decals are embedded/persisted in the project and previewed on broad faces. Production bleed/safe-area/DPI/mirroring templates can be requested through persisted advanced package settings or `artwork-production.js`; they do not yet have desktop controls.

## Export Workflow

1. Open Export and review stable preflight findings.
2. Export the annotated draft at any time for human review.
3. Resolve every error. There is no production override.
4. If warnings remain, review them and tick the acknowledgement.
5. In Hardware, review detected quantities and complete costs/supplier references for required purchased items; add BOM-only components where needed.
6. In Sheets, validate material assignments, stock sizes/prices, and the selected layout if creating a package.
7. Export either a clean single-file production SVG or the multi-sheet fabrication ZIP. The package includes the fabricated-part BOM plus a costed total procurement BOM for stock sheets and hardware.

Native desktop dialogs deliver the files. Browser-mode development uses downloads. See [Exports And Project Files](EXPORTS.md) for file contracts and [Implementation Status](IMPLEMENTATION_STATUS.md) for optional and incomplete features.
