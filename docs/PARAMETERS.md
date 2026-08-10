# Parameter Reference

Status: canonical
Last updated: 2026-07-31

All dimensions are millimetres unless otherwise stated. Parameter names are persisted as stable API keys in JSON project files.

## Presets

Canonical presets are exported from `wwwroot/js/cabinet.js` as `PRESETS`.

| Preset ID | Display Name | Intent |
| --- | --- | --- |
| `standard` | Standard | Full-height upright arcade cabinet. |
| `barstool` | Bar-top | Squat cabinet intended to sit on a bar or counter. The persisted ID remains `barstool` for compatibility. |

Removed presets:

| Removed ID | Reason |
| --- | --- |
| `sitdown` | Outside current upright-only scope. |
| `pinball` | Different body type and fabrication model from upright cabinets. |

## Global Cabinet Parameters

| Key | Unit | Meaning | Geometry Consumer |
| --- | --- | --- | --- |
| `width` | mm | Overall cabinet width across left/right side panels. | Side panel Z positions, internal panel span, SVG internal panel width. |
| `height` | mm | Nominal total cabinet height. | Side profile vertical envelope. |
| `depth` | mm | Nominal base depth from rear to front. | Side profile horizontal envelope and dummy placement. |
| `thickness` | mm | Default sheet material thickness. | Side panel extrusion, internal panel thickness, SVG labels. |
| `screwDiameter` | mm | Screw shaft diameter for generated side-entry cabinet screws. | Viewport screw shafts, side-wall SVG pilot holes, spacing/intersection checks. |
| `screwLength` | mm | Physical screw length measured from the side-wall outside face into the cabinet. | Target-panel penetration checks and shaft-intersection checks. |
| `screwEdgeClearance` | mm | Minimum screw centreline distance from the target panel end grain/edge. | Generated screw placement and edge-clearance diagnostics. |
| `screwMinSpacing` | mm | Minimum allowed distance between screw centrelines on the same side wall. | Generated screw placement and centreline spacing diagnostics. |
| `exploded` | percent | Assembly separation amount. | Mesh displacement during exploded view. |
| `fabricationInclusion` | record | Optional map of stable panel IDs to booleans. `false` excludes that part from fabrication without hiding it in the viewport. | Manifest construction and all fabrication exports. |
| `materials` | array | Portable material/stock profiles edited in Sheets and retained with the design. | Part assignment, nesting, weight/cost, and package services. |
| `fabricationSettings` | object | Material assignments, nesting strategy/pinned overrides, and supported advanced package options retained with the design. | Sheets workspace, package gate, and manufacturing services. |
| `hardwareDefinitions` | array | Portable imported hardware definitions added to the bundled library. | Hardware search/review and definition-backed instances. |

## Side Profile Parameters

| Key | Unit | Meaning | Geometry Consumer |
| --- | --- | --- | --- |
| `toeKickHeight` | mm | Height of toe-kick break above floor. | `toe_kick` point Y coordinate. |
| `toeKickInset` | mm | Front setback of the toe kick. | `toe_kick` and `bottom_front` X coordinates. |
| `frontApronDrop` | mm | Vertical drop from control-panel height to apron top. | `cp_apron` Y coordinate. |
| `sideProfileCustomization` | object | Optional linked or per-wall cubic Bézier contours for decorative outer-wall material. | Final `side_left` and `side_right` meshes and fabrication contours only. |
| `cpHeight` | mm | Front control-panel deck height. | `cp_front` Y coordinate. |
| `cpDepth` | mm | Control-panel deck depth along the deck plane. | `cp_back` X/Y coordinates. |
| `cpAngle` | deg | Control-panel deck angle. | `cp_back` X/Y coordinates and `panel_cp` rotation. |
| `cpOverhang` | mm | Forward extension beyond nominal cabinet depth. | `cp_front` X coordinate. |

`sideProfileCustomization` stores `enabled`, `linked`, and `shared`/`left`/`right` curve records. Each closed version-1 curve contains 3 to 64 nodes with a stable `id`, normalized anchor `x`/`y`, normalized `in`/`out` handle coordinates, and a `corner`, `smooth`, or `symmetric` mode. Coordinates are relative to the current structural side-envelope bounds and may extend outside 0 to 1 to add material. The application rejects non-finite, out-of-range, over-capacity, self-intersecting, inward, or unsafe-to-flatten contours rather than repairing their topology silently.

## Display And Marquee Parameters

| Key | Unit | Meaning | Geometry Consumer |
| --- | --- | --- | --- |
| `monitorAngle` | deg | Backward tilt of the monitor/bezel panel. | `bezel_top` X coordinate. |
| `bezelDepth` | mm | Minimum recess from control-panel back to bezel top. | `bezel_top` X coordinate. |
| `screenWidth` | mm | Visible monitor/cutout width across the cabinet. | 3D monitor mesh and SVG cutout. |
| `screenHeight` | mm | Visible monitor/cutout height along the bezel panel. | 3D monitor mesh and SVG cutout. |
| `screenBezelMargin` | mm | Margin around the screen cutout. | Bezel panel minimum height and SVG cutout bounds. |
| `screenFrameEnabled` | boolean | Includes the raised monitor screen-frame assembly. | 3D frame bars plus four fabricated rail/stile records. |
| `screenFrameBezel` | mm | Width of each frame rail/stile around the screen. | 3D frame and fabricated piece widths. |
| `screenFrameDepth` | mm | Raised depth/material thickness of the screen frame above the bezel panel. | 3D frame and fabricated piece thickness. |
| `screenFrameClearance` | mm | Gap between visible screen and inner frame edge. | Frame opening, parent placement references, and piece lengths. |
| `monitorCablePortWidth` | mm | Width of the monitor cable routing port. | `panel_bezel` and `panel_header_support` cable through-cuts. |
| `monitorCablePortHeight` | mm | Height of the monitor cable routing port. | `panel_bezel` and `panel_header_support` cable through-cuts. |
| `marqueeHeight` | mm | Vertical height reserved for marquee assembly. | Upper side-profile Y coordinates. |
| `marqueeDepth` | mm | Rearward depth of the top cap. | `marquee_top` X coordinate. |
| `marqueeFaceInset` | mm | Inset of the marquee face from the nominal cabinet front. | `marquee_bottom` and `marquee_front` X coordinates. |
| `marqueeLean` | mm | Forward lean/offset between marquee bottom and face. | `marquee_front` X coordinate. |

## Internal Structure Parameters

| Key | Unit | Meaning | Geometry Consumer |
| --- | --- | --- | --- |
| `controlSupportEnabled` | boolean | Includes the full-profile horizontal support seated directly below the control-panel apron. | `panel_cp_support`. |
| `controlSupportDrop` | mm | Legacy value retained when older projects are opened. The current support is anchored to the apron bottom. | Project compatibility only. |
| `controlCablePortWidth` | mm | Width of the controls cable through-cut. | `panel_cp_support` typed through-cut and fabrication geometry. |
| `controlCablePortHeight` | mm | Height of the controls cable through-cut. | `panel_cp_support` typed through-cut and fabrication geometry. |
| `controlCablePortOffset` | mm | Signed cross-panel offset of the controls cable through-cut. | `panel_cp_support` operation placement. |
| `controlRiserEnabled` | boolean | Compatibility key that enables the full side-profile control support ribs. | `panel_control_riser` and, when requested, `panel_control_riser_2`. |
| `controlProfileSupportCount` | count | Number of control support ribs. One is centred; two are mirrored around the centreline. | Control profile support generation. |
| `controlProfileSupportSpacing` | mm | Centre-to-centre distance when two ribs are used. The solver clamps both ribs inside the clear side-wall span. | Control profile support Z placement. |
| `controlRiserLateralPosition` | percent | Legacy single-riser position retained when older projects are opened. Current profile supports are centred as a set. | Project compatibility only. |
| `controlRiserCablePortWidth` | mm | Width of each profile-support cable through-cut. | Control profile support typed through-cuts and fabrication geometry. |
| `controlRiserCablePortHeight` | mm | Height of each profile-support cable through-cut. | Control profile support typed through-cuts and fabrication geometry. |
| `controlRiserCablePortOffset` | mm | Signed offset of the cable through-cut along each profile support. | Control profile support operation placement. |
| `displaySupportEnabled` | boolean | Includes the horizontal support from the cabinet back to the bottom of the display panel, with its front end cut to the live display angle. | `panel_display_support`. |
| `displayCablePortWidth` | mm | Width of the display-support cable through-cut. | `panel_display_support` typed through-cut and fabrication geometry. |
| `displayCablePortHeight` | mm | Height of the display-support cable through-cut. | `panel_display_support` typed through-cut and fabrication geometry. |
| `displayCablePortOffset` | mm | Signed cross-panel offset of the display-support cable through-cut. | `panel_display_support` operation placement. |
| `headerSupportEnabled` | boolean | Includes the profile-fitted wedge support seated at the display-to-recess junction. | `panel_header_support`. |
| `headerSupportDrop` | mm | Legacy value retained when older projects are opened. The current support is anchored to the display-to-recess junction. | Project compatibility only. |
| `monitorCablePortOffset` | mm | Signed cross-panel offset used by the header support's display cable through-cut. | `panel_header_support` operation placement. |
| `backDoorEnabled` | boolean | Includes the rear service opening and fitted door part. | `panel_back` through-cut, `panel_back_service_door`, and assembly schedule. |
| `backDoorWidth` | mm | Width of the rear service opening. | Parent-panel cutout and fitted door width after clearance. |
| `backDoorHeight` | mm | Height of the rear service opening. | Parent-panel cutout and fitted door length after clearance. |
| `backDoorBottomOffset` | mm | Door-opening bottom offset from the bottom of the rear panel. | Parent-panel cutout placement. |
| `machineShelfEnabled` | boolean | Includes the raised full-profile PC/electronics platform. | `panel_machine_shelf`. |
| `machineShelfHeight` | mm | Height of the shelf above the floor. The shelf remains profile-fitted from the cabinet back to the live front shell. | `panel_machine_shelf` height solving. |
| `machineCablePortWidth` | mm | Width of the machine-shelf cable through-cut. | `panel_machine_shelf` typed through-cut and fabrication geometry. |
| `machineCablePortHeight` | mm | Height of the machine-shelf cable through-cut. | `panel_machine_shelf` typed through-cut and fabrication geometry. |
| `machineCablePortOffset` | mm | Signed cross-panel offset of the machine-shelf cable through-cut. | `panel_machine_shelf` operation placement. |

Compatibility keys `controlSupportRearInset`, `controlSupportDrop`, `controlSupportFrontRise`, `controlRiserPosition`, `controlRiserLateralPosition`, `headerSupportDrop`, `machineShelfDepth`, and `machineShelfInset` can remain in older project files, but they no longer shape these supports. Legacy keys may round-trip so older projects retain their data. Missing `controlProfileSupportCount` and `controlProfileSupportSpacing` values normalize to one centred support and 240 mm spacing.

## Component Overrides

Fine-grain per-component controls are stored under:

```json
{
  "componentOverrides": {
    "panel_cp": {
      "offset": 0,
      "lengthDelta": 0,
      "widthDelta": 0,
      "thicknessDelta": 0,
      "color": "#fbfbf8"
    }
  }
}
```

| Override Key | Unit | Meaning |
| --- | --- | --- |
| `offset` | mm | Moves a component along its local normal. For side panels this shifts left/right along cabinet width. |
| `lengthDelta` | mm | Adds or removes length from rectangular internal panels. Ignored for side-profile panels. |
| `widthDelta` | mm | Adds or removes cross-cabinet width from rectangular internal panels. Ignored for side-profile panels. |
| `thicknessDelta` | mm | Adds or removes thickness from a component relative to global `thickness`. |
| `color` | hex | Panel face colour selected from `PANEL_COLOR_PALETTE`. Defaults to `#fbfbf8`. |

Override values are additive. A zeroed override may be removed from persistence.

## Control Hardware Schema

Control hardware is stored under `params.controls`. Missing fields are filled from `DEFAULT_CONTROL_SCHEMA` during `normalizeParams`.

```json
{
  "controls": {
    "deck": {
      "enabled": true,
      "players": 2,
      "buttonsPerPlayer": 6,
      "buttonRows": 2,
      "buttonDiameter": 30,
      "buttonSpacing": 36,
      "buttonSpacingX": 36,
      "buttonSpacingY": 34,
      "groupSpacing": 235,
      "groupOrientation": "across",
      "layoutStyle": "staggered",
      "groupRotation": 0,
      "joystickGap": 60,
      "deckX": 10,
      "deckY": 0,
      "buttonColor": "#ffffff",
      "buttonDefinitionId": "button-30-snap",
      "joystickEnabled": true,
      "joystickDiameter": 38,
      "joystickColor": "#1b1b18",
      "joystickDefinitionId": "joystick-jlf-pattern",
      "labels": "A,B,C,D,E,F",
      "showLabels": true
    },
    "apron": {
      "enabled": true,
      "buttons": 2,
      "buttonDiameter": 28,
      "buttonSpacing": 86,
      "orientation": "horizontal",
      "apronX": 0,
      "apronY": 0,
      "buttonColor": "#ffffff",
      "buttonDefinitionId": "button-24-snap",
      "labels": "1P,2P",
      "showLabels": true
    }
  }
}
```

| Control Key | Unit | Meaning |
| --- | --- | --- |
| `deck.enabled` | boolean | Includes or suppresses control-deck hardware. |
| `deck.players` | count | Number of mirrored player control groups. |
| `deck.buttonsPerPlayer` | count | Number of button cutouts per player group. |
| `deck.buttonRows` | count | Button row count used to arrange each player group. |
| `deck.buttonDiameter` | mm | Diameter of deck button cutouts. |
| `deck.buttonSpacing` | mm | Legacy centre-to-centre spacing fallback for older project files. |
| `deck.buttonSpacingX` | mm | Column spacing inside a button group. |
| `deck.buttonSpacingY` | mm | Row spacing inside a button group. |
| `deck.groupSpacing` | mm | Centre-to-centre spacing between player groups. |
| `deck.groupOrientation` | enum | Player group axis: `across` or `frontBack`. |
| `deck.layoutStyle` | enum | Button layout style: `grid`, `staggered`, or `vee`. |
| `deck.groupRotation` | deg | Rotation of each player group in panel-local space. |
| `deck.joystickGap` | mm | Distance between joystick and button cluster before fitting. |
| `deck.deckX` | mm | Front/back offset on the control deck panel. |
| `deck.deckY` | mm | Cross-cabinet offset for the whole deck hardware layout. |
| `deck.buttonColor` | hex | Button colour selected from `PANEL_COLOR_PALETTE`. |
| `deck.buttonDefinitionId` | ID | Portable hardware definition associated with deck button operations. Defaults to `button-30-snap`. |
| `deck.joystickEnabled` | boolean | Includes or suppresses joysticks. |
| `deck.joystickDiameter` | mm | Diameter of joystick cutout/marker. |
| `deck.joystickColor` | hex | Joystick colour selected from `PANEL_COLOR_PALETTE`. |
| `deck.joystickDefinitionId` | ID | Portable hardware definition associated with joystick operations. Defaults to `joystick-jlf-pattern`. |
| `deck.labels` | CSV text | Labels assigned to button positions in row-major order. |
| `deck.showLabels` | boolean | Shows labels in the viewport and SVG/export metadata. |
| `apron.enabled` | boolean | Includes or suppresses front-apron start buttons. |
| `apron.buttons` | count | Number of apron button cutouts. |
| `apron.buttonDiameter` | mm | Diameter of apron button cutouts. |
| `apron.buttonSpacing` | mm | Centre-to-centre apron button spacing. |
| `apron.orientation` | enum | Start-button axis: `horizontal` across width or `vertical` along panel height. |
| `apron.apronX` | mm | Vertical/lengthwise offset on the apron panel. |
| `apron.apronY` | mm | Cross-cabinet offset for apron hardware. |
| `apron.buttonColor` | hex | Apron button colour selected from `PANEL_COLOR_PALETTE`. |
| `apron.buttonDefinitionId` | ID | Portable hardware definition associated with apron button operations. Defaults to `button-24-snap`. |
| `apron.labels` | CSV text | Labels assigned to apron buttons. |
| `apron.showLabels` | boolean | Shows apron labels in the viewport and SVG/export metadata. |

## Material And Fabrication Settings

Sheets stores portable material records under `materials`. Common fields are `id`, `name`, `nominalThicknessMm`, `measuredThicknessMm`, `sheetWidthMm`, `sheetHeightMm`, `grainDirection`, `finishedFaces`, `densityKgM3`, `pricePerSheet`, `quantityAvailable`, `trimMarginMm`, `partSpacingMm`, and `allowedRotations`.

`fabricationSettings.materialAssignments` maps stable part IDs to material IDs. `fabricationSettings.nesting.selectedStrategy` selects a ranked candidate strategy, and `fabricationSettings.nesting.placementOverrides` stores pinned `xMm`, `yMm`, `rotationDeg`, and `sheetIndex` values by part-instance ID. Exclusion from the build is still expressed by `fabricationInclusion`, not by hiding a nesting shape.

Advanced package keys can retain joinery assignments/settings, process profile, artwork template requests, workshop profile, batch quantity, quote settings, and design variants. These records are schema-portable but do not all have desktop editors. See [Exports](EXPORTS.md) and [Implementation Status](IMPLEMENTATION_STATUS.md).

## Colour Palette

`PANEL_COLOR_PALETTE` is the canonical 24-colour square-chip palette used for panel faces and hardware controls. The default panel colour is `DEFAULT_PANEL_COLOR`, currently `#fbfbf8`.

Colour selection uses square chips from this palette and does not accept arbitrary freeform colours.

## View And Mannequin State

| Key | Unit | Meaning |
| --- | --- | --- |
| `dummyHeight` | mm | Human mannequin height. It is UI/view state rather than fabrication geometry and participates in history/recovery. |
| `mannequinPreset` | enum | UI-selected mannequin profile. It is stored in the `ProjectDocumentV2.viewState.mannequin` contract rather than treated as a manufactured parameter. |
| `hiddenPanelIds` | array | Viewport-only hidden components. This is distinct from `fabricationInclusion`. |
| `cameraMode`, `cameraPosition`, `cameraTarget` | view state | Saved camera context for the editing workspace. |

## Persistence Notes

Current saves use `ProjectDocumentV2` (`schemaVersion: 2`). Its `design.params` preserves these parameter keys; `design.decals`, materials, fabrication settings, inclusion, units, view/mannequin state, and assets have separate top-level sections.

`migrateProjectDocument()` accepts the former v1.x top-level `params`/`decals` shape without renaming component IDs or parameter keys. After migration, missing parameters are filled from the `standard` preset by `normalizeParams`, including controls, per-component colours, and missing nested control fields. Newer or unrecognized schemas fail with explicit errors.
