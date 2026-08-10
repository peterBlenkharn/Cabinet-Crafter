# Controls And Hardware

Status: canonical  
Last updated: 2026-08-10

## Desktop Control Schema

The connected Controls tab edits generic control-deck and front-apron hardware stored under `params.controls`. This schema drives viewport meshes, authoritative fabrication operations/keepouts, preflight, and package-time schedules.

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
      "showLabels": true,
      "labels": "A,B,C,D,E,F",
      "customLayout": []
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
      "showLabels": true,
      "labels": "1P,2P"
    }
  }
}
```

Missing nested keys are filled by `normalizeParams()` from `DEFAULT_CONTROL_SCHEMA`, preserving compatibility with older projects.

## Coordinate Meaning

For `panel_cp`, `deckX` moves groups along deck depth and `deckY` moves them across cabinet width. Within each player group, button X spacing runs across the width and rows run along panel depth. `groupOrientation` controls how multiple player groups are repeated.

When `layoutStyle` is `custom`, `deck.customLayout` stores one player group's panel-local millimetre coordinates:

```json
[
  { "id": "joystick", "kind": "joystick", "buttonIndex": 0, "x": 60, "y": 0 },
  { "id": "button_0", "kind": "button", "buttonIndex": 0, "x": -35, "y": -18 }
]
```

For `panel_apron`, `apronX` moves controls along the panel and `apronY` moves them across cabinet width. All geometry remains millimetre-based even when the UI displays inches.

## Explicit Layout Fitting

`Cabinet.getHardwareLayoutInfo(panelId, panelLength, panelWidth)` returns the requested hardware items plus fit analysis. It does **not** silently use compressed coordinates when the layout exceeds the usable panel area.

Instead it returns:

- the unchanged requested `items`;
- `adjusted: false`;
- a warning explaining the overflow;
- a `fitSuggestion` containing proposed coordinates that fit.

The manifest records that suggestion and preflight emits blocking `LAYOUT_DOES_NOT_FIT`. The Review UI provides **Apply fitted suggestion**; accepting it writes the proposed custom layout into project state and reruns the cabinet/preflight. Users can alternatively change count, spacing, rotation, or offsets themselves.

## Authoritative Control Hardware

Generic deck/apron items carry `hardwareDefinitionId`. During manifest construction the selected bundled or imported definition is instantiated at the panel-local control coordinate. Its declared operation and body data, not only the viewport circle, becomes authoritative for:

- through cuts, mounting drills, pockets, engraves, or references;
- supported panel-thickness validation;
- underside body, movement/service keepout, and cable-exit metadata;
- edge and hardware-to-hardware clearance checks;
- hardware and wiring schedules.

The viewport still renders physical button caps, joystick bases/shafts/balls, and start controls. Button/joystick circles are not baked into artwork textures. Production SVG contains operation vectors without visual labels; draft output can include references.

## Portable Hardware Definitions

`hardware-library.js` implements `HardwareDefinitionV1`-style records with:

- stable ID, category, name, supplier/SKU and optional unit-cost metadata;
- supported panel-thickness range;
- cut, drill, pocket, engrave, or reference operations;
- underside body depth/radius, service/movement keepout, and cable exit;
- visible-geometry metadata and connector information.

Bundled definitions currently cover:

- 30 mm and 24 mm arcade buttons;
- a JLF-pattern joystick, 3-inch trackball, and spinner;
- 24-inch/VESA 100 monitor, 4-inch speaker, and 120 mm fan;
- compact coin door, IEC C14 inlet, and dual USB panel connector;
- four-player encoder and mini-PC footprint;
- recessed handle and 50 mm caster.

The module can normalize custom JSON definitions, instantiate them, produce operations, validate host/edge/thickness/keepout placement, build a hardware schedule, and estimate wiring connections/harness lengths.

## Hardware Step

The top-level Hardware step exposes:

- a read-only deck/apron control-layout reference and a direct route back to the Controls editor;
- searchable bundled and imported definition cards;
- portable JSON definition import persisted with the project;
- the inferred hardware schedule for the current cabinet, with editable unit cost, supplier, SKU, and line total;
- manually added BOM-only components with name, category, quantity, cost, supplier, SKU, and notes;
- component-cost and unpriced-line summaries in the project currency;
- hardware and arcade-relationship findings;
- contextual actions back to the affected control layout or panel.

Detected schedule rows come from actual hardware instances inferred from design operations. Their project-specific purchasing overrides are stored by definition ID under `fabricationSettings.hardwareCosts`; changing a price, supplier, or SKU does not alter machining or fit analysis.

**Add BOM component** creates a purchasing-only record under `fabricationSettings.additionalHardware`. **Add to BOM** on a definition starts that record with the definition's name/category/price/supplier/SKU. These additional quantities enter the costed hardware schedule, total BOM, batch scaling, and optional quote, but they do not enter the fabrication manifest as placed hardware and do not create cuts, keepouts, wiring, or fit checks.

This remains a library/review and purchasing surface, not an arbitrary-placement editor. Imported definitions appear in machining output only when a project record references an instance; adding one to the BOM affects purchasing reports only. Non-control hardware such as trackballs, monitors, speakers, fans, computers, inlets, handles, feet, and casters still lacks a general point-and-place panel workflow.

Fabrication packages preserve the existing fabricated-part `bom.csv` and also emit costed `hardware-schedule.csv`, `total-bom.csv`, `total-bom.json`, and `manifest/procurement-bom.json`. The total BOM combines required stock sheets with detected and additional components and reports material, hardware, and combined estimated cost. Zero-cost required lines are counted as unpriced for follow-up.

Package-time arcade intelligence can infer and report additional relationships such as player spacing, trackball swing, monitor depth/cable needs, ventilation, service access, and encoder assignments. Those relationship findings are advisory; they are not proof that a selected real-world part fits.

Always check supplier drawings, mounting pattern, connector orientation, panel-thickness limits, moving envelope, service access, and cable bend radius. See [Implementation Status](IMPLEMENTATION_STATUS.md) for current capabilities and limitations.
