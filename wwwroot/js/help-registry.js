/**
 * Cabinet Crafter user help registry.
 *
 * This module is intentionally independent of the DOM. Interface controls,
 * finding cards, documentation views, and tests can all resolve the same
 * user-facing content without duplicating copy.
 */

const asArray = value => Array.isArray(value) ? value : value == null ? [] : [value];

function freezeTopic(value) {
    if (Array.isArray(value)) {
        value.forEach(freezeTopic);
        return Object.freeze(value);
    }
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freezeTopic);
        Object.freeze(value);
    }
    return value;
}

function normaliseLookup(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[_\s]+/g, '-')
        .replace(/[^a-z0-9.-]+/g, '');
}

function wordsFromKey(value) {
    return String(value || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function makeTopic({
    id,
    kind,
    domain,
    title,
    tooltip,
    explanation,
    synonyms = [],
    aliases = [],
    unit = null,
    origin = null,
    effects = [],
    dependencies = [],
    downstream = [],
    safety = null,
    related = []
}) {
    if (!id || !kind || !domain || !title || !tooltip || !explanation) {
        throw new TypeError('Help topics require id, kind, domain, title, tooltip, and explanation.');
    }
    return freezeTopic({
        id,
        kind,
        domain,
        title,
        tooltip,
        explanation,
        synonyms: [...new Set(asArray(synonyms).map(String).filter(Boolean))],
        aliases: [...new Set(asArray(aliases).map(String).filter(Boolean))],
        unit,
        origin,
        effects: asArray(effects).map(String).filter(Boolean),
        dependencies: asArray(dependencies).map(String).filter(Boolean),
        downstream: asArray(downstream).map(String).filter(Boolean),
        safety,
        related: [...new Set(asArray(related).map(String).filter(Boolean))]
    });
}

function parameterTopic(key, {
    title = wordsFromKey(key),
    tooltip,
    explanation,
    domain = 'design',
    unit = null,
    origin = null,
    effects = [],
    dependencies = [],
    downstream = ['review', 'sheets', 'export'],
    safety = null,
    synonyms = [],
    related = []
}) {
    return makeTopic({
        id: `parameter.${key}`,
        kind: 'parameter',
        domain,
        title,
        tooltip,
        explanation,
        aliases: [key],
        synonyms,
        unit,
        origin,
        effects,
        dependencies,
        downstream,
        safety,
        related
    });
}

function controlTopic(key, options) {
    const path = key.startsWith('deck.') ? 'control deck' : 'front apron';
    return makeTopic({
        id: `control.${key}`,
        kind: 'parameter',
        domain: 'controls',
        title: options.title || wordsFromKey(key.split('.').at(-1)),
        tooltip: options.tooltip,
        explanation: options.explanation,
        aliases: [key, `controls.${key}`],
        synonyms: options.synonyms || [],
        unit: options.unit ?? null,
        origin: options.origin || `Measured in the local coordinate system of the ${path}.`,
        effects: options.effects || ['Control placement', 'Hardware cutouts and keepouts'],
        dependencies: options.dependencies || [],
        downstream: options.downstream || ['hardware', 'review', 'sheets', 'export'],
        safety: options.safety || 'Confirm the real hardware dimensions and clearances before cutting.',
        related: options.related || []
    });
}

function componentTopic(key, options) {
    return makeTopic({
        id: `component.${key}`,
        kind: 'parameter',
        domain: 'component',
        title: options.title || wordsFromKey(key),
        tooltip: options.tooltip,
        explanation: options.explanation,
        aliases: [key, `componentOverrides.${key}`],
        synonyms: options.synonyms || [],
        unit: options.unit ?? 'mm',
        origin: options.origin || 'Applied relative to the selected component and its generated geometry.',
        effects: options.effects || ['Selected component geometry'],
        dependencies: ['A component must be selected.'],
        downstream: ['review', 'sheets', 'export'],
        safety: options.safety || 'Review joints, clearances, stock assignments, and fasteners after changing a component.',
        related: options.related || []
    });
}

const cabinetParameters = [
    parameterTopic('width', {
        title: 'Cabinet width',
        tooltip: 'Sets the overall outside width of the cabinet.',
        explanation: 'Changes the distance between the outside faces of the left and right walls. Internal panels and control layouts are recalculated to fit the new clear span.',
        unit: 'mm',
        origin: 'Measured across the cabinet from the outside of the left wall to the outside of the right wall.',
        effects: ['Side-wall position', 'Internal panel span', 'Control spacing', 'Sheet geometry'],
        safety: 'Check doorway access, stability, internal hardware clearance, and available stock width.'
    }),
    parameterTopic('height', {
        title: 'Cabinet height',
        tooltip: 'Sets the nominal total cabinet height.',
        explanation: 'Scales the vertical envelope used to solve the cabinet side profile and the connected panels.',
        unit: 'mm',
        origin: 'Measured vertically from the cabinet floor line to its highest roof point.',
        effects: ['Side profile', 'Display and marquee position', 'Rear panel height'],
        safety: 'Check room clearance, tipping stability, and player sight lines.'
    }),
    parameterTopic('depth', {
        title: 'Cabinet depth',
        tooltip: 'Sets the nominal front-to-back base depth.',
        explanation: 'Changes the horizontal envelope used by the side profile, floor, rear panel, and mannequin placement.',
        unit: 'mm',
        origin: 'Measured from the cabinet rear to the nominal front edge at floor level.',
        effects: ['Side profile', 'Floor panel', 'Internal volume', 'Mannequin position'],
        safety: 'Check floor space, stability, service access, and available stock size.'
    }),
    parameterTopic('thickness', {
        title: 'Default sheet thickness',
        tooltip: 'Sets the modelled thickness used by panels without an override.',
        explanation: 'Controls panel solids, internal clear width, joints, fastener penetration, and default stock matching. Use the material profile measured thickness for real stock planning.',
        unit: 'mm',
        origin: 'Measured through the sheet.',
        effects: ['Panel solids', 'Joints', 'Internal clearances', 'Fasteners', 'Material matching'],
        safety: 'Measure real stock with callipers. Nominal and measured thickness often differ.',
        synonyms: ['material thickness', 'sheet gauge'],
        related: ['dynamic.material.measuredThicknessMm']
    }),
    parameterTopic('toeKickHeight', {
        title: 'Toe-kick height',
        tooltip: 'Sets the height of the recessed front break above the floor.',
        explanation: 'Moves the toe-kick profile point vertically and changes the lower front side shape.',
        unit: 'mm',
        origin: 'Measured upward from the cabinet floor line.',
        effects: ['Lower side profile', 'Toe-kick panel'],
        safety: 'Retain enough material around the lower front corner for strength.',
        synonyms: ['plinth height', 'foot recess height']
    }),
    parameterTopic('toeKickInset', {
        title: 'Toe-kick inset',
        tooltip: 'Sets how far the toe kick is recessed from the cabinet front.',
        explanation: 'Moves the lower front profile point rearward or forward to define foot clearance.',
        unit: 'mm',
        origin: 'Measured horizontally back from the nominal cabinet front.',
        effects: ['Lower side profile', 'Floor and toe-kick relationship'],
        safety: 'Large insets reduce the base footprint and can affect stability.',
        synonyms: ['plinth inset', 'foot recess depth']
    }),
    parameterTopic('cpHeight', {
        title: 'Control deck height',
        tooltip: 'Sets the front height of the control surface.',
        explanation: 'Moves the front edge of the control deck vertically. This also changes the apron, display transition, and ergonomic reference.',
        unit: 'mm',
        origin: 'Measured upward from the cabinet floor line to the front deck edge.',
        effects: ['Control deck', 'Front apron', 'Display transition', 'Ergonomic checks'],
        safety: 'Check standing or seated reach for the intended players.',
        synonyms: ['control panel height', 'deck height']
    }),
    parameterTopic('cpDepth', {
        title: 'Control deck depth',
        tooltip: 'Sets the front-to-back length of the control surface.',
        explanation: 'Changes the available panel area for joysticks and buttons along the deck plane.',
        unit: 'mm',
        origin: 'Measured along the control deck from its front edge to its rear edge.',
        effects: ['Control deck outline', 'Hardware fitting', 'Display transition'],
        safety: 'Allow underside space for hardware bodies, wiring, and player hand clearance.',
        synonyms: ['control panel depth', 'deck length']
    }),
    parameterTopic('cpAngle', {
        title: 'Control deck angle',
        tooltip: 'Tilts the control surface.',
        explanation: 'Rotates the control deck around its front edge and recalculates its rear connection and supporting structure.',
        unit: 'degrees',
        origin: 'Measured from horizontal. Positive values raise the rear edge.',
        effects: ['Control deck rotation', 'Rear deck position', 'Support joints'],
        safety: 'Review control ergonomics and liquid run-off risk after changing the angle.',
        synonyms: ['control panel slope', 'deck tilt']
    }),
    parameterTopic('cpOverhang', {
        title: 'Control deck overhang',
        tooltip: 'Moves the front edge of the control deck beyond or behind the nominal cabinet front.',
        explanation: 'Changes the forward extension of the control surface without changing its depth along the deck plane.',
        unit: 'mm',
        origin: 'Measured horizontally from the nominal cabinet front. Positive values extend forward.',
        effects: ['Control deck front position', 'Apron shape', 'Player reach'],
        safety: 'Large overhangs increase leverage on the cabinet and need a sound load path.',
        synonyms: ['control panel projection']
    }),
    parameterTopic('frontApronDrop', {
        title: 'Front apron drop',
        tooltip: 'Sets the vertical depth of the panel below the control deck.',
        explanation: 'Moves the apron lower edge relative to the control deck and changes the front transition into the lower cabinet.',
        unit: 'mm',
        origin: 'Measured downward from the front control deck height.',
        effects: ['Front apron', 'Lower front transition', 'Start-button area'],
        safety: 'Check button bodies, wiring, and structural support behind the apron.',
        synonyms: ['apron depth', 'control fascia height']
    }),
    parameterTopic('monitorAngle', {
        title: 'Display panel angle',
        tooltip: 'Sets the backward tilt of the display panel.',
        explanation: 'Rotates the monitor and bezel surface, recalculating its upper intersection, support mitres, and sight-line checks.',
        unit: 'degrees',
        origin: 'Measured as backward tilt from vertical.',
        effects: ['Display panel', 'Monitor orientation', 'Display supports', 'Sight-line checks'],
        safety: 'Confirm the real monitor depth, mount, cooling, cable bend radius, and viewing angle.',
        synonyms: ['monitor tilt', 'screen angle', 'bezel angle']
    }),
    parameterTopic('bezelDepth', {
        title: 'Display recess depth',
        tooltip: 'Sets the minimum rearward recess of the display panel.',
        explanation: 'Moves the upper display point rearward to make room for the monitor, bezel, and related hardware.',
        unit: 'mm',
        origin: 'Measured rearward from the control deck back edge.',
        effects: ['Display position', 'Monitor volume', 'Upper side profile'],
        safety: 'Use the supplier drawing and connector clearance for the selected monitor.',
        synonyms: ['bezel depth', 'monitor recess']
    }),
    parameterTopic('screenWidth', {
        title: 'Visible screen width',
        tooltip: 'Sets the width of the visible monitor opening.',
        explanation: 'Sizes the screen opening and viewport monitor across the cabinet. It does not certify a particular monitor model.',
        unit: 'mm',
        origin: 'Measured across the display panel opening.',
        effects: ['Screen opening', 'Frame rails', 'Display clearance'],
        safety: 'Verify the real active area, bezel, mount, and cutout against the manufacturer drawing.',
        synonyms: ['monitor opening width', 'display cutout width']
    }),
    parameterTopic('screenHeight', {
        title: 'Visible screen height',
        tooltip: 'Sets the height of the visible monitor opening.',
        explanation: 'Sizes the screen opening along the sloped display panel.',
        unit: 'mm',
        origin: 'Measured along the display panel.',
        effects: ['Screen opening', 'Frame stiles', 'Display clearance'],
        safety: 'Verify the real active area and bezel before cutting.',
        synonyms: ['monitor opening height', 'display cutout height']
    }),
    parameterTopic('screenBezelMargin', {
        title: 'Screen bezel margin',
        tooltip: 'Sets the panel margin around the visible screen opening.',
        explanation: 'Reserves material between the screen opening and the display panel boundary.',
        unit: 'mm',
        origin: 'Measured outward from each edge of the visible screen opening.',
        effects: ['Minimum display panel size', 'Screen edge clearance'],
        safety: 'Too little margin can weaken the panel or conflict with the monitor body and fixings.',
        synonyms: ['screen border', 'monitor margin']
    }),
    parameterTopic('screenFrameEnabled', {
        title: 'Include screen frame',
        tooltip: 'Adds the raised four-piece frame around the screen.',
        explanation: 'Includes the frame rails and stiles in the model, fabrication manifest, material assignment, and sheet plan.',
        unit: 'on or off',
        effects: ['Viewport frame', 'Four fabricated frame parts', 'Material and nesting'],
        safety: 'Check frame clearance against the visible display and monitor servicing.',
        synonyms: ['monitor frame', 'screen trim']
    }),
    parameterTopic('screenFrameBezel', {
        title: 'Screen frame width',
        tooltip: 'Sets the face width of each screen-frame rail and stile.',
        explanation: 'Changes the visible border and the fabricated width of all four frame pieces.',
        unit: 'mm',
        origin: 'Measured from the frame opening outward across each piece.',
        effects: ['Frame opening', 'Rail and stile width', 'Stock usage'],
        dependencies: ['Include screen frame must be on.'],
        safety: 'Keep sufficient width for the chosen joints and fixings.'
    }),
    parameterTopic('screenFrameDepth', {
        title: 'Screen frame depth',
        tooltip: 'Sets how far the raised frame projects above the display panel.',
        explanation: 'Changes the frame piece thickness in the model and fabrication records.',
        unit: 'mm',
        origin: 'Measured normal to the display panel face.',
        effects: ['Frame projection', 'Frame material thickness', 'Display clearance'],
        dependencies: ['Include screen frame must be on.'],
        safety: 'Check player sight lines and clearance from the monitor face.'
    }),
    parameterTopic('screenFrameClearance', {
        title: 'Screen frame clearance',
        tooltip: 'Sets the gap between the visible screen and the inside of the frame.',
        explanation: 'Expands the frame opening around the visible screen and changes the rail and stile lengths.',
        unit: 'mm',
        origin: 'Measured outward from each edge of the visible screen.',
        effects: ['Frame opening', 'Rail and stile length'],
        dependencies: ['Include screen frame must be on.'],
        safety: 'Allow for assembly tolerance and access without exposing unwanted gaps.'
    }),
    parameterTopic('monitorCablePortWidth', {
        title: 'Monitor cable-port width',
        tooltip: 'Sets the width of the display cable opening.',
        explanation: 'Changes the through-cut used to route display power and signal cables through the bezel and header support.',
        domain: 'internals',
        unit: 'mm',
        origin: 'Measured across the local width of the host panel.',
        effects: ['Display-panel through-cut', 'Header-support through-cut'],
        safety: 'Allow for connector size, bend radius, edge clearance, and a protective grommet.',
        synonyms: ['display wiring slot width', 'screen cable hole width']
    }),
    parameterTopic('monitorCablePortHeight', {
        title: 'Monitor cable-port height',
        tooltip: 'Sets the height of the display cable opening.',
        explanation: 'Changes the through-cut used to route display power and signal cables through the bezel and header support.',
        domain: 'internals',
        unit: 'mm',
        origin: 'Measured along the local height of the host panel.',
        effects: ['Display-panel through-cut', 'Header-support through-cut'],
        safety: 'Allow for connector size, bend radius, edge clearance, and a protective grommet.',
        synonyms: ['display wiring slot height', 'screen cable hole height']
    }),
    parameterTopic('marqueeHeight', {
        title: 'Marquee height',
        tooltip: 'Sets the vertical space reserved for the marquee.',
        explanation: 'Moves the upper cabinet profile points that define the marquee face and roof assembly.',
        unit: 'mm',
        origin: 'Measured vertically through the marquee region.',
        effects: ['Upper side profile', 'Marquee face', 'Roof position'],
        safety: 'Check lighting, speaker, wiring, and service clearances.'
    }),
    parameterTopic('marqueeDepth', {
        title: 'Marquee depth',
        tooltip: 'Sets the front-to-back depth of the marquee top.',
        explanation: 'Moves the upper rear profile point and changes the roof and marquee enclosure volume.',
        unit: 'mm',
        origin: 'Measured rearward from the marquee front region.',
        effects: ['Upper side profile', 'Roof panel', 'Marquee volume'],
        safety: 'Check overall stability and available stock size.'
    }),
    parameterTopic('marqueeFaceInset', {
        title: 'Marquee face inset',
        tooltip: 'Recesses the marquee face from the nominal cabinet front.',
        explanation: 'Moves the marquee face rearward or forward while retaining its relationship with the surrounding profile.',
        unit: 'mm',
        origin: 'Measured rearward from the nominal cabinet front.',
        effects: ['Marquee face position', 'Upper profile transitions'],
        safety: 'Check visibility, lighting clearance, and edge strength.',
        synonyms: ['marquee recess']
    }),
    parameterTopic('marqueeLean', {
        title: 'Marquee face lean',
        tooltip: 'Offsets the top and bottom of the marquee face.',
        explanation: 'Changes the slope of the marquee face by moving its upper point relative to its lower point.',
        unit: 'mm',
        origin: 'Measured horizontally between the marquee face endpoints.',
        effects: ['Marquee face angle', 'Upper profile joints'],
        safety: 'Review mitres, lighting depth, and artwork presentation.'
    })
];

function cablePortTopics(prefix, label, host, enabledKey = null) {
    const dependency = enabledKey ? [`${wordsFromKey(enabledKey)} must be on.`] : [];
    const synonyms = [`${label.toLowerCase()} wiring slot`, `${label.toLowerCase()} cable hole`];
    return [
        parameterTopic(`${prefix}Width`, {
            title: `${label} width`,
            tooltip: `Sets the width of the ${label.toLowerCase()}.`,
            explanation: `Changes the typed through-cut used to route wiring through ${host}.`,
            domain: 'internals',
            unit: 'mm',
            origin: 'Measured across the local width of the host panel.',
            effects: [`${host} through-cut`, 'Cable routing'],
            dependencies: dependency,
            safety: 'Check connector size, cable bend radius, edge clearance, and grommet space.',
            synonyms
        }),
        parameterTopic(`${prefix}Height`, {
            title: `${label} height`,
            tooltip: `Sets the height of the ${label.toLowerCase()}.`,
            explanation: `Changes the typed through-cut used to route wiring through ${host}.`,
            domain: 'internals',
            unit: 'mm',
            origin: 'Measured along the local height of the host panel.',
            effects: [`${host} through-cut`, 'Cable routing'],
            dependencies: dependency,
            safety: 'Check connector size, cable bend radius, edge clearance, and grommet space.',
            synonyms
        }),
        parameterTopic(`${prefix}Offset`, {
            title: `${label} offset`,
            tooltip: `Moves the ${label.toLowerCase()} across its host panel.`,
            explanation: `Changes the signed local position of the typed through-cut in ${host}.`,
            domain: 'internals',
            unit: 'mm',
            origin: 'Measured from the centre of the host panel. Positive and negative directions follow its local axis.',
            effects: [`${host} through-cut position`, 'Cable routing'],
            dependencies: dependency,
            safety: 'Keep the opening clear of panel edges, joints, fasteners, and other cutouts.',
            synonyms
        })
    ];
}

const internalParameters = [
    parameterTopic('controlSupportEnabled', {
        title: 'Include control deck support',
        tooltip: 'Adds the horizontal support directly below the control-panel apron.',
        explanation: 'Includes the full-width structural panel that carries the control deck load into the cabinet shell and profile supports.',
        domain: 'internals',
        unit: 'on or off',
        effects: ['Control deck load path', 'Fabricated support panel', 'Fasteners and nesting'],
        safety: 'Removing a load-bearing support requires an independently verified replacement structure.',
        synonyms: ['control panel support', 'deck brace', 'apron support']
    }),
    ...cablePortTopics('controlCablePort', 'Control-support cable port', 'the control deck support', 'controlSupportEnabled'),
    parameterTopic('controlRiserEnabled', {
        title: 'Include profile supports',
        tooltip: 'Adds the full cabinet-profile support rib or ribs.',
        explanation: 'Includes one centred profile support or two mirrored supports. Horizontal structural panels and ribs use complementary open-ended cross-lap slots so they slide together without weakening the rib edge.',
        domain: 'internals',
        unit: 'on or off',
        effects: ['Control load path', 'Profile support parts', 'Horizontal-panel joints', 'Nesting'],
        safety: 'These supports form part of the cabinet load path. Confirm the slot joints and material before cutting.',
        synonyms: ['vertical support', 'control riser', 'full profile rib']
    }),
    parameterTopic('controlProfileSupportCount', {
        title: 'Profile support count',
        tooltip: 'Chooses one centred support or two mirrored supports.',
        explanation: 'Sets the number of full-profile internal ribs. A single rib is centred; two ribs are spaced symmetrically about the cabinet centreline.',
        domain: 'internals',
        unit: 'count',
        origin: 'Placed across the clear internal width of the cabinet.',
        effects: ['Number of support parts', 'Support spacing', 'Horizontal-panel joints', 'Stock usage'],
        dependencies: ['Include profile supports must be on.'],
        safety: 'Support count is not a substitute for structural calculation where high loads are expected.',
        synonyms: ['riser count', 'rib count']
    }),
    parameterTopic('controlProfileSupportSpacing', {
        title: 'Profile support spacing',
        tooltip: 'Sets the centre-to-centre spacing when two supports are used.',
        explanation: 'Moves the two full-profile ribs symmetrically within the cabinet clear width. The solver limits positions to keep the supports inside the side walls.',
        domain: 'internals',
        unit: 'mm',
        origin: 'Measured centre to centre across the cabinet.',
        effects: ['Support rib position', 'Load distribution', 'Slot-joint position'],
        dependencies: ['Include profile supports must be on.', 'Profile support count must be two.'],
        safety: 'Choose spacing that supports the control loads and avoids hardware bodies and cable routes.',
        synonyms: ['riser spacing', 'rib spacing']
    }),
    ...cablePortTopics('controlRiserCablePort', 'Profile-support cable port', 'each profile support', 'controlRiserEnabled'),
    parameterTopic('displaySupportEnabled', {
        title: 'Include display bottom support',
        tooltip: 'Adds the horizontal support beneath the display panel.',
        explanation: 'Includes the panel running from the cabinet rear to the lower display edge, with its front end angle-matched to the live display panel.',
        domain: 'internals',
        unit: 'on or off',
        effects: ['Display load path', 'Display-panel mitre', 'Fabricated support panel'],
        safety: 'Verify the mitred contact and monitor load before assembly.',
        synonyms: ['monitor shelf', 'display brace', 'screen bottom support']
    }),
    ...cablePortTopics('displayCablePort', 'Display-support cable port', 'the display bottom support', 'displaySupportEnabled'),
    parameterTopic('headerSupportEnabled', {
        title: 'Include header support',
        tooltip: 'Adds the wedge support at the display-to-recess junction.',
        explanation: 'Includes the profile-fitted brace seated at the upper display transition.',
        domain: 'internals',
        unit: 'on or off',
        effects: ['Upper display load path', 'Fabricated header support', 'Nesting'],
        safety: 'Confirm both mating faces are supported and cut to the generated angles.',
        synonyms: ['header brace', 'display top support']
    }),
    parameterTopic('monitorCablePortOffset', {
        title: 'Header display cable-port offset',
        tooltip: 'Moves the display cable opening across the header support.',
        explanation: 'Changes the signed position of the header support through-cut used by monitor wiring.',
        domain: 'internals',
        unit: 'mm',
        origin: 'Measured from the centre of the header support.',
        effects: ['Header-support through-cut position', 'Monitor cable route'],
        dependencies: ['Include header support must be on.'],
        safety: 'Keep the opening clear of edges, joints, and fasteners.',
        synonyms: ['monitor wiring slot offset']
    }),
    parameterTopic('backDoorEnabled', {
        title: 'Include rear service door',
        tooltip: 'Adds a fitted rear access door and its opening.',
        explanation: 'Creates a real through-cut in the rear panel and includes the fitted service door in the part and assembly schedules.',
        domain: 'internals',
        unit: 'on or off',
        effects: ['Rear-panel cutout', 'Service door part', 'Assembly schedule', 'Nesting'],
        safety: 'Plan hinges, latches, ventilation, finger clearance, and safe access to mains wiring.',
        synonyms: ['back access panel', 'maintenance door']
    }),
    parameterTopic('backDoorWidth', {
        title: 'Rear door width',
        tooltip: 'Sets the width of the rear service opening.',
        explanation: 'Changes the rear-panel through-cut and the fitted door width after assembly clearance.',
        domain: 'internals',
        unit: 'mm',
        origin: 'Measured across the rear panel.',
        effects: ['Rear opening', 'Service door size', 'Rear-panel strength'],
        dependencies: ['Include rear service door must be on.'],
        safety: 'Retain enough material around the opening for stiffness, hinges, and latches.'
    }),
    parameterTopic('backDoorHeight', {
        title: 'Rear door height',
        tooltip: 'Sets the height of the rear service opening.',
        explanation: 'Changes the rear-panel through-cut and the fitted door height after assembly clearance.',
        domain: 'internals',
        unit: 'mm',
        origin: 'Measured vertically along the rear panel.',
        effects: ['Rear opening', 'Service door size', 'Rear-panel strength'],
        dependencies: ['Include rear service door must be on.'],
        safety: 'Retain enough material around the opening for stiffness, hinges, and latches.'
    }),
    parameterTopic('backDoorBottomOffset', {
        title: 'Rear door bottom offset',
        tooltip: 'Moves the rear service opening up from the panel bottom.',
        explanation: 'Sets the vertical position of the service opening and fitted door.',
        domain: 'internals',
        unit: 'mm',
        origin: 'Measured upward from the bottom of the rear panel to the opening.',
        effects: ['Rear opening position', 'Access height'],
        dependencies: ['Include rear service door must be on.'],
        safety: 'Keep the opening clear of the floor, shelf, braces, wiring, and power hardware.'
    }),
    parameterTopic('machineShelfEnabled', {
        title: 'Include machine shelf',
        tooltip: 'Adds the raised full-profile shelf for a PC or electronics.',
        explanation: 'Includes a profile-fitted internal platform spanning from the cabinet rear to the live front shell.',
        domain: 'internals',
        unit: 'on or off',
        effects: ['Electronics platform', 'Internal load path', 'Fabricated shelf', 'Nesting'],
        safety: 'Check equipment mass, ventilation, cable routes, fixing method, and service access.',
        synonyms: ['PC shelf', 'electronics shelf']
    }),
    parameterTopic('machineShelfHeight', {
        title: 'Machine shelf height',
        tooltip: 'Sets the shelf height above the cabinet floor.',
        explanation: 'Moves the profile-fitted electronics platform vertically while preserving its rear and front shell contacts.',
        domain: 'internals',
        unit: 'mm',
        origin: 'Measured upward from the cabinet floor line.',
        effects: ['Machine shelf position', 'Equipment clearance', 'Cable routing'],
        dependencies: ['Include machine shelf must be on.'],
        safety: 'Keep heavy equipment low where practical and maintain ventilation and service clearance.'
    }),
    ...cablePortTopics('machineCablePort', 'Machine-shelf cable port', 'the machine shelf', 'machineShelfEnabled')
];

const fastenerAndViewParameters = [
    parameterTopic('screwDiameter', {
        title: 'Screw shaft diameter',
        tooltip: 'Sets the shaft diameter used by generated cabinet fasteners.',
        explanation: 'Changes screw reference geometry and the checks for edge clearance, cutout conflicts, and opposing shafts.',
        domain: 'fasteners',
        unit: 'mm',
        origin: 'Measured across the screw shaft.',
        effects: ['Fastener geometry', 'Pilot references', 'Clearance checks'],
        safety: 'Choose the pilot, thread, and head from the real fastener and material supplier guidance.',
        synonyms: ['fastener diameter', 'pilot size']
    }),
    parameterTopic('screwLength', {
        title: 'Screw length',
        tooltip: 'Sets the physical length of generated side-entry screws.',
        explanation: 'Controls how far each screw travels from the outside wall into its target panel and informs penetration and shaft-intersection checks.',
        domain: 'fasteners',
        unit: 'mm',
        origin: 'Measured from the outside wall face into the cabinet.',
        effects: ['Target penetration', 'Opposing-shaft checks', 'Viewport fasteners'],
        safety: 'Confirm effective thread engagement without breaking through the target or striking hardware.'
    }),
    parameterTopic('screwEdgeClearance', {
        title: 'Screw edge clearance',
        tooltip: 'Sets the minimum distance from a screw centreline to a target-panel edge.',
        explanation: 'Moves generated screw positions away from end grain and nearby edges where possible.',
        domain: 'fasteners',
        unit: 'mm',
        origin: 'Measured from the screw centreline to the nearest relevant target edge.',
        effects: ['Fastener placement', 'Edge-clearance findings'],
        safety: 'Use material and fastener guidance to reduce splitting or breakout.'
    }),
    parameterTopic('screwMinSpacing', {
        title: 'Screw centre spacing',
        tooltip: 'Sets the minimum distance between generated screw centrelines.',
        explanation: 'Constrains fastener placement along the same wall and informs spacing conflict checks.',
        domain: 'fasteners',
        unit: 'mm',
        origin: 'Measured centre to centre between screws.',
        effects: ['Fastener count and placement', 'Spacing findings'],
        safety: 'Very close fasteners can split sheet material or weaken an edge.'
    }),
    parameterTopic('dummyHeight', {
        title: 'Mannequin height',
        tooltip: 'Sets the reference person height shown beside the cabinet.',
        explanation: 'Changes only the scale and ergonomic reference mannequin. It does not change manufactured cabinet geometry.',
        domain: 'view',
        unit: 'mm',
        origin: 'Measured from the mannequin floor line to the top of the head.',
        effects: ['Viewport mannequin', 'Ergonomic reference'],
        downstream: [],
        safety: 'A mannequin is a visual guide, not an ergonomic certification.',
        synonyms: ['person height', 'human scale', 'dummy height']
    }),
    parameterTopic('exploded', {
        title: 'Exploded view',
        tooltip: 'Separates components to make the assembly easier to inspect.',
        explanation: 'Moves viewport components away from the cabinet centre for inspection. It does not alter fabrication geometry or saved part dimensions.',
        domain: 'view',
        unit: 'percent',
        origin: 'Zero is assembled; higher values increase viewport separation.',
        effects: ['Viewport component separation'],
        downstream: [],
        safety: null,
        synonyms: ['assembly separation', 'explode amount']
    })
];

const controls = [
    controlTopic('deck.enabled', {
        title: 'Include control-deck hardware',
        tooltip: 'Shows or suppresses the player controls on the deck.',
        explanation: 'Controls whether deck buttons and joysticks become modelled hardware, operations, keepouts, and schedule entries.',
        unit: 'on or off'
    }),
    controlTopic('deck.joystickEnabled', {
        title: 'Include joysticks',
        tooltip: 'Adds one joystick to each player group.',
        explanation: 'Includes the configured joystick hardware and its operation and underside keepout for every player.',
        unit: 'on or off',
        dependencies: ['Include control-deck hardware must be on.']
    }),
    controlTopic('deck.showLabels', {
        title: 'Show deck labels',
        tooltip: 'Shows button labels in the viewport and draft metadata.',
        explanation: 'Controls visual labels only. It does not remove the related hardware or machining operations.',
        unit: 'on or off',
        effects: ['Viewport labels', 'Annotated draft metadata'],
        downstream: ['export']
    }),
    controlTopic('deck.players', {
        title: 'Players',
        tooltip: 'Sets the number of player control groups.',
        explanation: 'Repeats the configured joystick and button group across the deck according to the selected player axis and spacing.',
        unit: 'count',
        dependencies: ['Include control-deck hardware must be on.'],
        synonyms: ['player stations']
    }),
    controlTopic('deck.buttonsPerPlayer', {
        title: 'Buttons per player',
        tooltip: 'Sets the number of action buttons in each player group.',
        explanation: 'Adds or removes button hardware and operations from every player group.',
        unit: 'count',
        dependencies: ['Include control-deck hardware must be on.']
    }),
    controlTopic('deck.buttonRows', {
        title: 'Button rows',
        tooltip: 'Sets how many rows arrange each player button group.',
        explanation: 'Distributes the action buttons across the chosen number of rows before applying the layout style.',
        unit: 'count',
        dependencies: ['Include control-deck hardware must be on.']
    }),
    controlTopic('deck.layoutStyle', {
        title: 'Button layout style',
        tooltip: 'Chooses grid, staggered, vee, or custom button placement.',
        explanation: 'Selects the placement algorithm for one player group. Custom stores explicit panel-local coordinates.',
        unit: 'choice',
        dependencies: ['Include control-deck hardware must be on.'],
        synonyms: ['button pattern', 'vee layout', 'staggered layout']
    }),
    controlTopic('deck.groupOrientation', {
        title: 'Player axis',
        tooltip: 'Chooses how multiple player groups repeat across the panel.',
        explanation: 'Places player groups across cabinet width or along the front-to-back direction of the deck.',
        unit: 'choice',
        dependencies: ['Include control-deck hardware must be on.', 'More than one player is required to see the full effect.'],
        synonyms: ['group orientation', 'player direction']
    }),
    controlTopic('deck.buttonDiameter', {
        title: 'Deck button diameter',
        tooltip: 'Sets the requested deck button cutout diameter.',
        explanation: 'Changes the visible control and requested operation size before definition-backed hardware validation.',
        unit: 'mm',
        dependencies: ['Include control-deck hardware must be on.']
    }),
    controlTopic('deck.buttonSpacingX', {
        title: 'Button column spacing',
        tooltip: 'Sets horizontal centre spacing inside each button group.',
        explanation: 'Changes the centre-to-centre distance between button columns in panel-local space.',
        unit: 'mm',
        dependencies: ['Include control-deck hardware must be on.']
    }),
    controlTopic('deck.buttonSpacingY', {
        title: 'Button row spacing',
        tooltip: 'Sets row centre spacing inside each button group.',
        explanation: 'Changes the centre-to-centre distance between button rows along the deck.',
        unit: 'mm',
        dependencies: ['Include control-deck hardware must be on.']
    }),
    controlTopic('deck.groupSpacing', {
        title: 'Player group spacing',
        tooltip: 'Sets the centre spacing between player groups.',
        explanation: 'Moves the player stations apart along the selected player axis.',
        unit: 'mm',
        dependencies: ['Include control-deck hardware must be on.', 'More than one player is required to see the full effect.']
    }),
    controlTopic('deck.groupRotation', {
        title: 'Player group rotation',
        tooltip: 'Rotates each player control group on the deck.',
        explanation: 'Applies the same panel-local rotation to every player group around its centre.',
        unit: 'degrees',
        dependencies: ['Include control-deck hardware must be on.']
    }),
    controlTopic('deck.deckX', {
        title: 'Deck front-to-back offset',
        tooltip: 'Moves the complete deck layout front or back.',
        explanation: 'Offsets all deck hardware along the local front-to-back axis without changing spacing.',
        unit: 'mm',
        dependencies: ['Include control-deck hardware must be on.'],
        synonyms: ['deck x', 'control layout depth offset']
    }),
    controlTopic('deck.deckY', {
        title: 'Deck cross-cabinet offset',
        tooltip: 'Moves the complete deck layout left or right.',
        explanation: 'Offsets all deck hardware across cabinet width without changing spacing.',
        unit: 'mm',
        dependencies: ['Include control-deck hardware must be on.'],
        synonyms: ['deck y', 'control layout width offset']
    }),
    controlTopic('deck.joystickDiameter', {
        title: 'Joystick opening diameter',
        tooltip: 'Sets the requested joystick opening diameter.',
        explanation: 'Changes the joystick operation marker before definition-backed hardware validation.',
        unit: 'mm',
        dependencies: ['Include control-deck hardware and Include joysticks must be on.']
    }),
    controlTopic('deck.joystickGap', {
        title: 'Joystick to buttons gap',
        tooltip: 'Sets the distance between the joystick and button cluster.',
        explanation: 'Moves the joystick relative to the action buttons within every player group.',
        unit: 'mm',
        dependencies: ['Include control-deck hardware and Include joysticks must be on.'],
        synonyms: ['stick gap', 'joystick spacing']
    }),
    controlTopic('deck.labels', {
        title: 'Deck button labels',
        tooltip: 'Sets comma-separated labels for deck button positions.',
        explanation: 'Assigns labels in row-major button order. Extra labels are ignored and missing labels leave positions blank.',
        unit: 'text',
        dependencies: ['Show deck labels must be on to display them.'],
        effects: ['Viewport labels', 'Annotated draft metadata'],
        downstream: ['export'],
        safety: null
    }),
    controlTopic('apron.enabled', {
        title: 'Include apron controls',
        tooltip: 'Shows or suppresses buttons on the front apron.',
        explanation: 'Controls whether apron buttons become modelled hardware, operations, keepouts, and schedule entries.',
        unit: 'on or off'
    }),
    controlTopic('apron.showLabels', {
        title: 'Show apron labels',
        tooltip: 'Shows front-apron button labels in the viewport and draft metadata.',
        explanation: 'Controls visual labels only. It does not remove the related hardware or machining operations.',
        unit: 'on or off',
        effects: ['Viewport labels', 'Annotated draft metadata'],
        downstream: ['export'],
        safety: null
    }),
    controlTopic('apron.buttons', {
        title: 'Apron button count',
        tooltip: 'Sets the number of buttons on the front apron.',
        explanation: 'Adds or removes apron button hardware and operations.',
        unit: 'count',
        dependencies: ['Include apron controls must be on.']
    }),
    controlTopic('apron.buttonDiameter', {
        title: 'Apron button diameter',
        tooltip: 'Sets the requested apron button cutout diameter.',
        explanation: 'Changes the visible start control and requested operation size before definition-backed hardware validation.',
        unit: 'mm',
        dependencies: ['Include apron controls must be on.']
    }),
    controlTopic('apron.buttonSpacing', {
        title: 'Apron button spacing',
        tooltip: 'Sets centre spacing between apron buttons.',
        explanation: 'Moves the apron controls apart along their selected orientation.',
        unit: 'mm',
        dependencies: ['Include apron controls must be on.']
    }),
    controlTopic('apron.orientation', {
        title: 'Apron button orientation',
        tooltip: 'Arranges apron buttons horizontally or vertically.',
        explanation: 'Chooses whether the button group runs across cabinet width or along the apron panel.',
        unit: 'choice',
        dependencies: ['Include apron controls must be on.']
    }),
    controlTopic('apron.apronX', {
        title: 'Apron lengthwise offset',
        tooltip: 'Moves the apron control group along the panel.',
        explanation: 'Offsets all apron buttons along the panel length without changing their spacing.',
        unit: 'mm',
        dependencies: ['Include apron controls must be on.'],
        synonyms: ['apron x', 'apron vertical offset']
    }),
    controlTopic('apron.apronY', {
        title: 'Apron cross-cabinet offset',
        tooltip: 'Moves the apron control group left or right.',
        explanation: 'Offsets all apron buttons across cabinet width without changing their spacing.',
        unit: 'mm',
        dependencies: ['Include apron controls must be on.'],
        synonyms: ['apron y', 'apron width offset']
    }),
    controlTopic('apron.labels', {
        title: 'Apron button labels',
        tooltip: 'Sets comma-separated labels for apron buttons.',
        explanation: 'Assigns labels in button order. Extra labels are ignored and missing labels leave positions blank.',
        unit: 'text',
        dependencies: ['Show apron labels must be on to display them.'],
        effects: ['Viewport labels', 'Annotated draft metadata'],
        downstream: ['export'],
        safety: null
    })
];

const components = [
    componentTopic('offset', {
        title: 'Component offset',
        tooltip: 'Moves the selected component along its local normal.',
        explanation: 'Offsets the selected panel without changing its generated outline. For side walls this moves the panel left or right across cabinet width.',
        synonyms: ['panel position', 'normal offset']
    }),
    componentTopic('lengthDelta', {
        title: 'Component length adjustment',
        tooltip: 'Adds to or subtracts from the selected rectangular panel length.',
        explanation: 'Changes the selected internal rectangular panel along its local length. Side-profile panels ignore this adjustment.',
        synonyms: ['length delta', 'panel length override']
    }),
    componentTopic('widthDelta', {
        title: 'Component width adjustment',
        tooltip: 'Adds to or subtracts from the selected rectangular panel width.',
        explanation: 'Changes how far the selected rectangular internal panel spans across the cabinet. Side-profile panels ignore this adjustment.',
        synonyms: ['width delta', 'panel width override']
    }),
    componentTopic('thicknessDelta', {
        title: 'Component thickness adjustment',
        tooltip: 'Changes selected-panel thickness relative to the project default.',
        explanation: 'Adds to or subtracts from the default sheet thickness for the selected component.',
        synonyms: ['thickness delta', 'panel thickness override'],
        related: ['parameter.thickness', 'dynamic.material.measuredThicknessMm']
    })
];

const dynamicDefinitions = [
    ['material.name', 'Material name', 'Names this portable material and stock profile.', 'text', 'Shown in assignments, sheet plans, summaries, and exports.'],
    ['material.nominalThicknessMm', 'Nominal thickness', 'Records the supplier or category thickness used to identify the stock.', 'mm', 'Used for material grouping and selection.'],
    ['material.measuredThicknessMm', 'Measured thickness', 'Records the actual sheet thickness used for fit and assignment checks.', 'mm', 'Compared with modelled part thickness and used by manufacturing calculations.'],
    ['material.sheetWidthMm', 'Sheet width', 'Sets the available stock width.', 'mm', 'Defines the nesting boundary after trim margins.'],
    ['material.sheetHeightMm', 'Sheet height', 'Sets the available stock height.', 'mm', 'Defines the nesting boundary after trim margins.'],
    ['material.grainDirection', 'Grain direction', 'States whether grain runs along sheet length, sheet width, or has no required direction.', 'choice', 'Restricts valid part rotation and records face orientation.'],
    ['material.finishedFaces', 'Finished faces', 'Records whether neither, one, or both sheet faces are finished.', 'choice', 'Supports stock selection and maker review.'],
    ['material.densityKgM3', 'Material density', 'Sets density for estimated sheet and part weight.', 'kg/m3', 'Changes weight estimates only.'],
    ['material.pricePerSheet', 'Price per sheet', 'Sets the estimated cost of one stock sheet in the project currency.', 'currency', 'Changes stock cost estimates.'],
    ['material.quantityAvailable', 'Sheets available', 'Limits how many sheets of this profile nesting may use. Zero means unlimited.', 'count', 'Can block plans that need more stock than is available.'],
    ['material.trimMarginMm', 'Trim margin', 'Reserves an unusable strip around every stock-sheet edge.', 'mm', 'Shrinks the usable nesting area.'],
    ['material.partSpacingMm', 'Part spacing', 'Sets the minimum clear gap between nested part outlines.', 'mm', 'Changes nesting density and tool clearance.'],
    ['material.allowedRotations', 'Allowed rotations', 'Chooses the quarter-turn orientations permitted during nesting.', 'degrees', 'Restricts placement to protect grain or manufacturing requirements.'],
    ['material.assignment', 'Part material assignment', 'Assigns one material and stock profile to a fabricated part.', 'choice', 'Controls thickness checks, nesting, weight, cost, and package grouping.'],
    ['material.currencyCode', 'Project currency', 'Sets the three-letter currency code used for estimates.', 'ISO code', 'Labels cost estimates without converting values.'],
    ['nesting.strategy', 'Nesting strategy', 'Chooses the optimisation objective used to rank sheet layouts.', 'choice', 'Changes candidate order and may change sheet count, waste, or reusable offcut.'],
    ['nesting.candidate', 'Ranked sheet candidate', 'Selects one validated layout from the generated alternatives.', 'choice', 'The confirmed candidate becomes the fabrication package sheet plan.'],
    ['nesting.pinned', 'Pinned placement', 'Keeps a part instance at an explicitly chosen sheet position during regeneration.', 'on or off', 'Constrains optimisation and can reduce packing efficiency.'],
    ['nesting.xMm', 'Pinned X position', 'Sets a pinned part position across its stock sheet.', 'mm', 'Moves the part within the validated nesting boundary.'],
    ['nesting.yMm', 'Pinned Y position', 'Sets a pinned part position along its stock sheet.', 'mm', 'Moves the part within the validated nesting boundary.'],
    ['nesting.rotationDeg', 'Pinned rotation', 'Sets the rotation of a pinned part instance.', 'degrees', 'Must be allowed by the assigned material profile.'],
    ['nesting.sheetIndex', 'Pinned sheet', 'Chooses which stock sheet receives a pinned part instance.', 'index', 'Moves the part between sheets in the same material group.'],
    ['hardware.search', 'Hardware search', 'Filters bundled and imported hardware definitions by name, ID, category, or supplier metadata.', 'text', 'Changes only the visible library results.'],
    ['hardware.definitionImport', 'Import hardware definition', 'Adds a validated portable hardware definition from JSON.', 'JSON file', 'Makes the definition available to this project without placing it automatically.'],
    ['hardware.supportedThickness', 'Supported panel thickness', 'Shows the panel-thickness range declared by a hardware definition.', 'mm', 'Used to report hardware fit conflicts.'],
    ['hardware.body', 'Hardware body', 'Describes the physical volume behind the host panel.', 'mm', 'Used for underside collision checks.'],
    ['hardware.keepout', 'Hardware keepout', 'Reserves movement, service, or connector space around hardware.', 'mm', 'Used for placement and clearance findings.'],
    ['hardware.unitPrice', 'Hardware unit cost', 'Records the purchase cost of one detected hardware item in the project currency.', 'currency', 'Feeds the hardware subtotal, quote data, and total BOM.'],
    ['hardware.additionalItem', 'Additional BOM component', 'Adds a purchased item that does not create a machining operation or physical placement.', 'component line', 'Includes electronics, computers, cables, and other purchased parts in the total BOM.'],
    ['hardware.supplier', 'Hardware supplier', 'Records the preferred supplier for a detected or additional component.', 'text', 'Appears in hardware and total BOM reports.'],
    ['hardware.sku', 'Hardware SKU', 'Records the supplier stock code for a detected or additional component.', 'text', 'Appears in hardware and total BOM reports.'],
    ['procurement.totalBom', 'Total procurement BOM', 'Combines required stock sheets with detected and additional purchased components.', 'CSV and JSON', 'Reports material cost, hardware cost, overall estimate, and unpriced lines.'],
    ['fastener.groupOverride', 'Screw group override', 'Applies fastener values to screws attached to a selected panel group.', 'mixed', 'Overrides project defaults for the group.'],
    ['fastener.individualOverride', 'Individual screw override', 'Changes diameter or length for one generated screw.', 'mm', 'Takes precedence over group and project defaults.'],
    ['artwork.upload', 'Panel artwork', 'Attaches PNG or JPEG artwork to the selected panel.', 'image file', 'Appears in previews and artwork production records.'],
    ['artwork.dpi', 'Artwork resolution', 'Reports effective print resolution at the requested physical size.', 'dpi', 'Low values can reduce printed detail.'],
    ['artwork.bleed', 'Artwork bleed', 'Extends printed artwork beyond the finished cut boundary.', 'mm', 'Allows trimming without an unprinted edge.'],
    ['export.annotatedDraft', 'Annotated draft SVG', 'Exports a labelled reference drawing even when production checks are blocked.', 'SVG file', 'Intended for review, not direct machining.'],
    ['export.productionSvg', 'Production SVG', 'Exports checked machine geometry without reference-only marks.', 'SVG file', 'Blocked by fabrication errors and unacknowledged warnings.'],
    ['export.fabricationPackage', 'Fabrication package', 'Exports the checked design, sheet plan, schedules, reports, and manufacturing files.', 'ZIP file', 'Requires valid preflight and a current confirmed nesting plan.'],
    ['workflow.confirm', 'Confirm current stage', 'Records that the current stage has been deliberately reviewed.', 'action', 'Enables later confirmations when prerequisites are satisfied.'],
    ['workflow.stale', 'Needs reconfirmation', 'Marks a previously confirmed stage as changed by later editing.', 'status', 'Requires the affected stage and its dependants to be reviewed again.'],
    ['visibility.viewport', 'Show in viewport', 'Shows or hides a part only in the 3D editing view.', 'on or off', 'Does not change manufacturing inclusion.'],
    ['visibility.fabrication', 'Include in fabrication', 'Includes or excludes a part from the manufacturing manifest and outputs.', 'on or off', 'Changes review, sheets, schedules, and exports.'],
    ['visibility.screws', 'Show screws', 'Shows or hides generated screw references in the viewport.', 'on or off', 'Does not remove fasteners from fabrication data.'],
    ['view.camera', '3D camera controls', 'Orbits, pans, zooms, fits, and restores the cabinet view.', 'keyboard or pointer', 'Changes only the editing view.']
];

const dynamicTopics = dynamicDefinitions.map(([key, title, tooltip, unit, explanation]) => {
    const domain = key.split('.')[0];
    const safety = ['material', 'nesting', 'hardware', 'fastener', 'artwork', 'export'].includes(domain)
        ? 'Validate real stock, hardware, tooling, workholding, and supplier information before production.'
        : null;
    return makeTopic({
        id: `dynamic.${key}`,
        kind: 'dynamic-setting',
        domain,
        title,
        tooltip,
        explanation: `${explanation} ${tooltip}`,
        aliases: [key],
        synonyms: dynamicSynonyms(key),
        unit,
        origin: dynamicOrigin(key),
        effects: [explanation],
        dependencies: dynamicDependencies(key),
        downstream: dynamicDownstream(key),
        safety,
        related: []
    });
});

function dynamicSynonyms(key) {
    const table = {
        'material.measuredThicknessMm': ['actual thickness', 'calliper measurement'],
        'material.trimMarginMm': ['sheet trim', 'edge margin'],
        'material.partSpacingMm': ['nesting gap', 'tool spacing'],
        'nesting.strategy': ['optimisation method', 'packing strategy'],
        'nesting.pinned': ['lock placement', 'fixed part'],
        'hardware.keepout': ['clearance envelope', 'service space'],
        'artwork.dpi': ['print resolution', 'pixels per inch'],
        'visibility.fabrication': ['exclude from build', 'manufacturing inclusion'],
        'visibility.viewport': ['hide panel', 'scene visibility']
    };
    return table[key] || [];
}

function dynamicOrigin(key) {
    if (key.startsWith('nesting.')) return 'Measured in sheet-local coordinates from the stock origin.';
    if (key.startsWith('material.')) return 'Defined by the selected stock profile or measured from the real sheet.';
    if (key.startsWith('hardware.')) return 'Defined by the portable hardware record and its host-panel placement.';
    return null;
}

function dynamicDependencies(key) {
    if (key.startsWith('nesting.')) return ['Valid material assignments and generated sheet layouts are required.'];
    if (key.startsWith('artwork.')) return ['A target panel and artwork source are required.'];
    if (key.startsWith('export.')) return ['Availability depends on the selected output and current validation state.'];
    return [];
}

function dynamicDownstream(key) {
    if (key.startsWith('material.') || key.startsWith('nesting.')) return ['sheets', 'export'];
    if (key.startsWith('hardware.') || key.startsWith('fastener.')) return ['review', 'sheets', 'export'];
    if (key.startsWith('artwork.')) return ['review', 'export'];
    if (key.startsWith('visibility.fabrication')) return ['review', 'sheets', 'export'];
    return [];
}

const findingGroups = freezeTopic({
    fabrication: [
        'MANIFEST_INVALID', 'INVALID_UNITS', 'NO_FABRICATION_PARTS', 'PART_INVALID_DIMENSIONS',
        'CONTOUR_MISSING', 'CONTOUR_OPEN', 'CONTOUR_INVALID', 'CONTOUR_SELF_INTERSECTION',
        'CUTOUT_EDGE_CLEARANCE', 'CUTOUT_COLLISION', 'SCREW_CUTOUT_CONFLICT',
        'HARDWARE_KEEPOUT_COLLISION', 'MATERIAL_MISSING', 'STOCK_BOUNDS_EXCEEDED',
        'OPERATION_GEOMETRY_INVALID', 'UNSUPPORTED_OPERATION', 'REFERENCE_OPERATION_OMITTED',
        'LAYOUT_DOES_NOT_FIT', 'STRUCTURAL_PANEL_COLLISION', 'FASTENER_CONFLICT',
        'JOINT_ANGLE_INVALID', 'JOINT_BEVEL_MISMATCH',
        'SIDE_PROFILE_MISSING', 'SIDE_PROFILE_INVALID'
    ],
    hardware: [
        'HARDWARE_DEFINITION_MISSING', 'HARDWARE_BODY_COLLISION', 'HARDWARE_CUTOUT_OUTSIDE',
        'HARDWARE_HOST_MISSING', 'HARDWARE_PANEL_THICKNESS', 'HARDWARE_SERVICE_CLEARANCE',
        'HARDWARE_ANALYSIS_FAILED', 'HARDWARE_MOVEMENT_CONFLICT', 'HARDWARE_SERVICE_ACCESS',
        'MONITOR_CABLE_CLEARANCE', 'MONITOR_DEPTH_COLLISION', 'PLAYER_CONTROL_SPACING',
        'VENTILATION_NOT_DEFINED', 'ENCODER_INPUT_UNASSIGNED'
    ],
    materials: [
        'MATERIAL_VALUE', 'MATERIAL_ROTATIONS', 'MATERIAL_STOCK_MARGIN',
        'MATERIAL_THICKNESS', 'MATERIAL_THICKNESS_VARIANCE', 'MATERIAL_ASSIGNMENT_MISSING',
        'MATERIAL_PART_THICKNESS_MISMATCH', 'MATERIAL_PART_THICKNESS_VARIANCE',
        'MATERIAL_ASSIGNMENT_EXCLUDED', 'MATERIAL_ASSIGNMENT_PART_UNKNOWN',
        'MATERIAL_ASSIGNMENT_THICKNESS', 'MATERIAL_ASSIGNMENT_UNKNOWN'
    ],
    nesting: [
        'NESTING_PLAN_MISSING', 'NESTING_PLAN_STALE', 'NEST_BOUNDS_MISMATCH',
        'NEST_OUT_OF_BOUNDS', 'NEST_PART_OVERLAP', 'NEST_PART_UNPLACED',
        'NEST_ROTATION_NOT_ALLOWED', 'NEST_STOCK_QUANTITY', 'NEST_TRANSFORM_MISMATCH'
    ],
    artwork: [
        'ARTWORK_BLEED', 'ARTWORK_CUTOUT_GEOMETRY', 'ARTWORK_DPI_LOW',
        'ARTWORK_DPI_REVIEW', 'ARTWORK_OUTLINE', 'ARTWORK_SOURCE_MISSING',
        'ARTWORK_PART_NOT_FOUND', 'ARTWORK_TEMPLATE_DUPLICATE'
    ],
    ergonomics: [
        'ERGO_CONTROL_TOO_HIGH', 'ERGO_CONTROL_TOO_LOW', 'ERGO_MONITOR_TILT',
        'ERGO_REACH', 'ERGO_REFERENCE_OK', 'ERGO_SCREEN_ABOVE_EYE', 'ERGO_SCREEN_TOO_LOW'
    ],
    joinery: [
        'JOINERY_EDGE_GEOMETRY_MISSING', 'PROCESS_COMPENSATION_UNSUPPORTED',
        'PROCESS_DERIVED_GEOMETRY', 'PROCESS_DOGBONE_GUIDANCE',
        'PROCESS_HOLDING_TABS_CAM_REQUIRED'
    ],
    export: [
        'PREFLIGHT_BLOCKED', 'NESTING_BLOCKED', 'WARNING_ACKNOWLEDGEMENT_REQUIRED'
    ],
    project: [
        'DESKTOP_UNAVAILABLE', 'DOCUMENT_TOO_LARGE', 'PROJECT_DECAL_LIST',
        'PROJECT_DECAL_SOURCE', 'PROJECT_DECALS_TYPE', 'PROJECT_DISPLAY_UNITS',
        'PROJECT_INTERNAL_UNITS', 'PROJECT_INVALID', 'PROJECT_MATERIALS_TYPE',
        'PROJECT_NAME_MISSING', 'PROJECT_NOT_OBJECT', 'PROJECT_PARAMS_MISSING',
        'PROJECT_SCHEMA_VERSION', 'PROJECT_UNRECOGNIZED', 'PROJECT_VERSION_NEWER',
        'RECENT_PROJECTS'
    ]
});

const findingExplanations = freezeTopic({
    CUTOUT_EDGE_CLEARANCE: 'A through-cut is too close to a panel edge for the configured safety clearance.',
    CUTOUT_COLLISION: 'Two panel operations overlap or are closer than the permitted operation spacing.',
    SCREW_CUTOUT_CONFLICT: 'A generated screw or drill path conflicts with a through-cut.',
    HARDWARE_KEEPOUT_COLLISION: 'The reserved underside or service space of two hardware items overlaps.',
    LAYOUT_DOES_NOT_FIT: 'The requested control arrangement does not fit its usable host-panel area.',
    STRUCTURAL_PANEL_COLLISION: 'Two structural panel solids intersect where no joint is defined.',
    FASTENER_CONFLICT: 'A generated fastener has an unsafe penetration, edge, spacing, or opposing-shaft relationship.',
    SIDE_PROFILE_MISSING: 'Decorative side shaping is enabled but its saved curve is missing.',
    SIDE_PROFILE_INVALID: 'A decorative side curve crosses itself, removes required structure, or cannot be flattened safely.',
    JOINT_BEVEL_MISMATCH: 'The generated bevels do not add up to the joint included angle.',
    REFERENCE_OPERATION_OMITTED: 'Reference marks remain in annotated output but are intentionally omitted from production machine geometry.',
    HARDWARE_PANEL_THICKNESS: 'The host panel thickness is outside the range declared by the hardware definition.',
    HARDWARE_SERVICE_CLEARANCE: 'The hardware does not have its declared maintenance or connector access space.',
    MONITOR_CABLE_CLEARANCE: 'The display cable route does not have enough connector or bend clearance.',
    MONITOR_DEPTH_COLLISION: 'The monitor body or rear connections conflict with cabinet geometry.',
    PLAYER_CONTROL_SPACING: 'Player stations or their operating envelopes are too close together.',
    VENTILATION_NOT_DEFINED: 'Heat-producing hardware has no declared ventilation provision.',
    MATERIAL_PART_THICKNESS_MISMATCH: 'The assigned measured stock is substantially different from the modelled part thickness.',
    MATERIAL_PART_THICKNESS_VARIANCE: 'The assigned measured stock differs enough from the model to require review.',
    MATERIAL_ROTATIONS: 'The material profile does not allow any valid part orientation.',
    MATERIAL_STOCK_MARGIN: 'The trim margins leave no usable stock area.',
    NESTING_PLAN_MISSING: 'No validated sheet plan is available for the fabrication package.',
    NESTING_PLAN_STALE: 'The saved sheet plan no longer matches the current design, stock, or assignments.',
    NEST_PART_OVERLAP: 'Two placed part outlines or their required spacing regions overlap.',
    NEST_PART_UNPLACED: 'At least one required part instance has not been assigned a valid sheet position.',
    NEST_ROTATION_NOT_ALLOWED: 'A part orientation is not permitted by its material profile.',
    NEST_STOCK_QUANTITY: 'The sheet plan requires more stock than the available quantity.',
    ARTWORK_DPI_LOW: 'Artwork resolution is too low at the requested physical print size.',
    ARTWORK_DPI_REVIEW: 'Artwork resolution is usable but should be reviewed at final print size.',
    ARTWORK_BLEED: 'Artwork does not provide the requested print extension beyond the cut edge.',
    ERGO_REACH: 'A control position may be outside the comfortable reach envelope of the reference mannequin.',
    ERGO_MONITOR_TILT: 'The display angle may be uncomfortable or reflective for the reference viewing position.',
    PREFLIGHT_BLOCKED: 'Fabrication errors prevent production output.',
    NESTING_BLOCKED: 'The fabrication package cannot be produced until the sheet plan is valid and current.',
    WARNING_ACKNOWLEDGEMENT_REQUIRED: 'Production warnings must be read and acknowledged before export.',
    PROJECT_VERSION_NEWER: 'The project was saved by a newer application version and cannot be opened safely.',
    DOCUMENT_TOO_LARGE: 'The selected project exceeds the safe document-size limit.'
});

function findingTopic(domain, code) {
    const title = wordsFromKey(code);
    const explanation = findingExplanations[code] || genericFindingExplanation(code, domain);
    return makeTopic({
        id: `finding.${code}`,
        kind: 'finding',
        domain,
        title,
        tooltip: explanation,
        explanation: `${explanation} Open the affected item when available, review the corrective action, and run the relevant check again after editing.`,
        aliases: [code],
        synonyms: findingSynonyms(code),
        unit: null,
        origin: `Reported by the ${wordsFromKey(domain).toLowerCase()} checks.`,
        effects: findingEffects(code, domain),
        dependencies: [],
        downstream: findingDownstream(domain),
        safety: findingSafety(code, domain),
        related: findingRelated(code)
    });
}

function genericFindingExplanation(code, domain) {
    const readable = wordsFromKey(code).toLowerCase();
    if (code.includes('MISSING') || code.includes('UNASSIGNED')) {
        return `Required ${readable.replace(/\bmissing\b|\bunassigned\b/g, '').trim()} information is absent.`;
    }
    if (/(COLLISION|CONFLICT|OVERLAP)/.test(code)) {
        return `The ${wordsFromKey(domain).toLowerCase()} check found geometry or reserved space that overlaps.`;
    }
    if (/(INVALID|UNSUPPORTED|UNKNOWN|UNRECOGNIZED)/.test(code)) {
        return `The project contains ${readable} data that cannot be used safely.`;
    }
    if (/(OUTSIDE|OUT_OF_BOUNDS|BOUNDS)/.test(code)) {
        return `Geometry extends outside its permitted boundary.`;
    }
    if (/(CLEARANCE|SPACING)/.test(code)) {
        return `The requested placement does not meet its required clearance or spacing.`;
    }
    if (code.includes('STALE')) {
        return `Previously generated data no longer matches the current project.`;
    }
    if (code.includes('BLOCKED')) {
        return `A required validation or prerequisite has not passed.`;
    }
    return `The ${wordsFromKey(domain).toLowerCase()} check reported ${readable}.`;
}

function findingSynonyms(code) {
    const synonyms = [wordsFromKey(code)];
    if (code.includes('KEEPOUT')) synonyms.push('clearance envelope', 'reserved space');
    if (code.includes('NEST')) synonyms.push('sheet layout', 'packing');
    if (code.includes('ERGO')) synonyms.push('ergonomics', 'human fit');
    if (code.includes('DPI')) synonyms.push('print resolution', 'pixels per inch');
    if (code.includes('MATERIAL')) synonyms.push('stock', 'sheet material');
    if (code.includes('PROJECT')) synonyms.push('open project', 'project file');
    return synonyms;
}

function findingEffects(code, domain) {
    if (code === 'REFERENCE_OPERATION_OMITTED' || code === 'ERGO_REFERENCE_OK') {
        return ['Provides non-blocking context.'];
    }
    if (domain === 'project') return ['Can prevent the project from loading or restoring.'];
    if (domain === 'export') return ['Can prevent one or more production outputs.'];
    if (domain === 'nesting') return ['Can prevent confirmation of the sheet plan and fabrication package export.'];
    return ['Can affect review readiness and production output.'];
}

function findingDownstream(domain) {
    if (domain === 'project') return [];
    if (domain === 'nesting') return ['sheets', 'export'];
    if (domain === 'artwork') return ['review', 'export'];
    return ['review', 'sheets', 'export'];
}

function findingSafety(code, domain) {
    if (code === 'REFERENCE_OPERATION_OMITTED' || code === 'ERGO_REFERENCE_OK') return null;
    if (domain === 'project') return 'Keep the original file and open an incompatible project only with a supported application version.';
    return 'Do not use production output until the finding is resolved or, for a warning, deliberately reviewed and acknowledged.';
}

function findingRelated(code) {
    if (code.includes('SIDE_PROFILE')) return ['guide.decorative-side-profile'];
    if (code.includes('NEST')) return ['dynamic.nesting.strategy', 'dynamic.nesting.candidate'];
    if (code.includes('MATERIAL')) return ['dynamic.material.assignment', 'dynamic.material.measuredThicknessMm'];
    if (code.includes('HARDWARE')) return ['dynamic.hardware.keepout', 'dynamic.hardware.supportedThickness'];
    if (code.includes('ARTWORK')) return ['dynamic.artwork.upload', 'dynamic.artwork.dpi'];
    return [];
}

const findingTopics = Object.entries(findingGroups)
    .flatMap(([domain, codes]) => codes.map(code => findingTopic(domain, code)));

const domainTopics = [
    makeTopic({
        id: 'guide.getting-started',
        kind: 'guide',
        domain: 'learning',
        title: 'Getting started',
        tooltip: 'Follow the five-stage path from design to checked output.',
        explanation: 'Choose a cabinet preset, set the main geometry, inspect hardware, review findings, generate a sheet plan, and select the output appropriate to your checks.',
        synonyms: ['quick start', 'first cabinet', 'workflow'],
        aliases: ['getting-started'],
        effects: [],
        downstream: [],
        related: ['guide.workflow-status', 'guide.before-you-cut']
    }),
    makeTopic({
        id: 'guide.workflow-status',
        kind: 'guide',
        domain: 'workflow',
        title: 'Workflow confirmation',
        tooltip: 'Opening a stage is different from confirming it.',
        explanation: 'A stage is confirmed only when you deliberately use its confirmation action. Editing relevant project data later marks that stage and dependent stages as needing reconfirmation.',
        synonyms: ['confirmed', 'stale', 'needs reconfirmation', 'stage progress'],
        aliases: ['workflow-status'],
        effects: ['Controls which later stages can be confirmed.'],
        downstream: ['hardware', 'review', 'sheets', 'export'],
        related: ['dynamic.workflow.confirm', 'dynamic.workflow.stale']
    }),
    makeTopic({
        id: 'guide.visibility',
        kind: 'guide',
        domain: 'visibility',
        title: 'Visibility and fabrication inclusion',
        tooltip: 'Hiding a part does not exclude it from manufacturing.',
        explanation: 'Show in viewport controls only the 3D scene. Include in fabrication controls the manifest, checks, sheet plan, schedules, and production outputs.',
        synonyms: ['hidden panel', 'exclude part', 'scene tree'],
        aliases: ['visibility'],
        effects: ['Viewport or manufacturing scope, depending on the chosen setting.'],
        downstream: ['review', 'sheets', 'export'],
        safety: 'Review every excluded structural part before production.',
        related: ['dynamic.visibility.viewport', 'dynamic.visibility.fabrication']
    }),
    makeTopic({
        id: 'guide.findings',
        kind: 'guide',
        domain: 'review',
        title: 'Understanding findings',
        tooltip: 'Errors block production, warnings need acknowledgement, and information adds context.',
        explanation: 'Open an affected panel when available, read the corrective action, change the responsible setting, and run the check again. Keep the stable code when reporting a problem.',
        synonyms: ['error code', 'warning', 'preflight', 'diagnostic'],
        aliases: ['findings'],
        effects: ['Determines readiness for production output.'],
        downstream: ['review', 'export'],
        safety: 'An empty automated finding list does not replace inspection of real materials, hardware, tooling, and workholding.'
    }),
    makeTopic({
        id: 'guide.before-you-cut',
        kind: 'guide',
        domain: 'safety',
        title: 'Before you cut',
        tooltip: 'Complete physical, stock, tool, and output checks before machining.',
        explanation: 'Verify dimensions against real hardware, measure stock, inspect sheet orientation and workholding, test the calibration output, make a physical prototype where appropriate, and review every production file.',
        synonyms: ['safety', 'maker checks', 'test cut', 'calibration'],
        aliases: ['before-you-cut'],
        effects: [],
        downstream: [],
        safety: 'You remain responsible for the finished design, machine setup, fabrication process, and safe use.'
    }),
    makeTopic({
        id: 'guide.keyboard',
        kind: 'guide',
        domain: 'accessibility',
        title: 'Keyboard controls',
        tooltip: 'Use the keyboard to operate the interface and inspect the model.',
        explanation: 'Tab and Shift+Tab move between controls. Arrow keys operate sliders and lists. The 3D viewport exposes keyboard camera controls and the Parts list provides a non-canvas route to component selection.',
        synonyms: ['shortcuts', 'keyboard navigation', 'no mouse'],
        aliases: ['keyboard'],
        effects: [],
        downstream: []
    }),
    makeTopic({
        id: 'guide.units',
        kind: 'guide',
        domain: 'design',
        title: 'Units',
        tooltip: 'Projects store manufacturing geometry in millimetres.',
        explanation: 'The interface can display millimetres or inches, but project geometry and manufacturing records remain millimetre-based. Exact values are converted without changing the underlying design intent.',
        synonyms: ['mm', 'inches', 'conversion', 'measurement'],
        aliases: ['units'],
        effects: ['Changes displayed values, not the physical project.'],
        downstream: []
    }),
    makeTopic({
        id: 'guide.decorative-side-profile',
        kind: 'guide',
        domain: 'design',
        title: 'Decorative side profile',
        tooltip: 'Add material to the two outer walls without changing the cabinet structure.',
        explanation: 'Open the advanced profile editor from the Profile tab. Edit linked walls together or unlink them, then move anchors and curve handles outside the hatched structural envelope. Apply is blocked if either final contour crosses itself, removes structural material, or is too complex to manufacture safely.',
        synonyms: ['curve editor', 'side flourish', 'custom wall outline', 'bezier profile'],
        aliases: ['decorative-side-profile', 'profile-editor'],
        effects: ['Outer side-wall contours', 'Side-wall area and stock fit'],
        dependencies: ['The structural envelope remains locked.'],
        downstream: ['review', 'sheets', 'export'],
        safety: 'Review minimum feature size, cutter radius, edge treatment, stock fit, and real material strength before cutting.',
        related: ['guide.findings', 'guide.before-you-cut']
    })
];

export const STATIC_PARAMETER_KEYS = freezeTopic(cabinetParameters
    .concat(internalParameters, fastenerAndViewParameters)
    .map(topic => topic.id.slice('parameter.'.length)));

export const STATIC_CONTROL_KEYS = freezeTopic(controls
    .map(topic => topic.id.slice('control.'.length)));

export const STATIC_COMPONENT_KEYS = freezeTopic(components
    .map(topic => topic.id.slice('component.'.length)));

export const DYNAMIC_HELP_KEYS = freezeTopic(dynamicTopics
    .map(topic => topic.id.slice('dynamic.'.length)));

export const EMITTED_FINDING_CODES = freezeTopic(findingTopics
    .map(topic => topic.id.slice('finding.'.length)));

export const HELP_TOPICS = freezeTopic([
    ...cabinetParameters,
    ...internalParameters,
    ...fastenerAndViewParameters,
    ...controls,
    ...components,
    ...dynamicTopics,
    ...findingTopics,
    ...domainTopics
]);

const topicById = new Map();
const topicByAlias = new Map();

for (const topic of HELP_TOPICS) {
    if (topicById.has(topic.id)) throw new Error(`Duplicate help topic id: ${topic.id}`);
    topicById.set(topic.id, topic);
    [topic.id, ...topic.aliases].forEach(alias => {
        const key = normaliseLookup(alias);
        if (!key) return;
        const existing = topicByAlias.get(key);
        if (existing && existing.id !== topic.id) {
            throw new Error(`Duplicate help topic alias: ${alias}`);
        }
        topicByAlias.set(key, topic);
    });
}

/**
 * Resolve a topic by canonical ID or a registered raw key, such as `width`,
 * `deck.players`, `material.trimMarginMm`, or `CUTOUT_EDGE_CLEARANCE`.
 */
export function getHelpTopic(idOrAlias) {
    if (!idOrAlias) return null;
    return topicById.get(String(idOrAlias)) || topicByAlias.get(normaliseLookup(idOrAlias)) || null;
}

export function getParameterHelp(key, scope = 'parameter') {
    const prefixes = scope === 'any'
        ? ['parameter', 'control', 'component', 'dynamic']
        : [scope];
    for (const prefix of prefixes) {
        const topic = getHelpTopic(`${prefix}.${key}`);
        if (topic) return topic;
    }
    return getHelpTopic(key);
}

export function getFindingHelp(code) {
    return getHelpTopic(`finding.${String(code || '').toUpperCase()}`)
        || getHelpTopic(String(code || '').toUpperCase());
}

export function listHelpTopics({ kind = null, domain = null } = {}) {
    return HELP_TOPICS.filter(topic =>
        (!kind || topic.kind === kind)
        && (!domain || topic.domain === domain)
    );
}

/**
 * Search all user-facing topic content. Exact IDs and aliases rank above
 * titles, synonyms, and explanatory prose.
 */
export function searchHelpTopics(query, { kind = null, domain = null, limit = 20 } = {}) {
    const terms = String(query || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const candidates = listHelpTopics({ kind, domain });
    if (!terms.length) return candidates.slice(0, Math.max(0, limit));

    return candidates
        .map((topic, index) => ({
            topic,
            index,
            score: searchScore(topic, terms)
        }))
        .filter(item => item.score > 0)
        .sort((left, right) =>
            right.score - left.score
            || left.topic.title.localeCompare(right.topic.title)
            || left.index - right.index
        )
        .slice(0, Math.max(0, limit))
        .map(item => item.topic);
}

function searchScore(topic, terms) {
    const id = topic.id.toLowerCase();
    const aliases = topic.aliases.map(item => item.toLowerCase());
    const title = topic.title.toLowerCase();
    const synonyms = topic.synonyms.map(item => item.toLowerCase());
    const prose = [
        topic.tooltip,
        topic.explanation,
        topic.origin,
        topic.safety,
        ...topic.effects,
        ...topic.dependencies
    ].filter(Boolean).join(' ').toLowerCase();

    let score = 0;
    for (const term of terms) {
        let termScore = 0;
        if (id === term || aliases.includes(term)) termScore = 100;
        else if (id.includes(term) || aliases.some(alias => alias.includes(term))) termScore = 60;
        else if (title === term) termScore = 50;
        else if (title.includes(term)) termScore = 35;
        else if (synonyms.some(synonym => synonym.includes(term))) termScore = 25;
        else if (prose.includes(term)) termScore = 10;
        if (!termScore) return 0;
        score += termScore;
    }
    return score;
}

/**
 * Validate registry coverage against caller-supplied live keys. This is useful
 * for automated checks whenever new controls or finding codes are introduced.
 */
export function validateHelpRegistry({
    parameterKeys = STATIC_PARAMETER_KEYS,
    controlKeys = STATIC_CONTROL_KEYS,
    componentKeys = STATIC_COMPONENT_KEYS,
    dynamicKeys = DYNAMIC_HELP_KEYS,
    findingCodes = EMITTED_FINDING_CODES
} = {}) {
    const missing = {
        parameters: parameterKeys.filter(key => !getHelpTopic(`parameter.${key}`)),
        controls: controlKeys.filter(key => !getHelpTopic(`control.${key}`)),
        components: componentKeys.filter(key => !getHelpTopic(`component.${key}`)),
        dynamic: dynamicKeys.filter(key => !getHelpTopic(`dynamic.${key}`)),
        findings: findingCodes.filter(code => !getHelpTopic(`finding.${code}`))
    };
    const duplicateIds = HELP_TOPICS
        .map(topic => topic.id)
        .filter((id, index, all) => all.indexOf(id) !== index);
    const invalidTopics = HELP_TOPICS
        .filter(topic =>
            !topic.id
            || !topic.title
            || !topic.tooltip
            || !topic.explanation
            || !Array.isArray(topic.synonyms)
            || !Array.isArray(topic.effects)
            || !Array.isArray(topic.dependencies)
            || !Array.isArray(topic.downstream)
        )
        .map(topic => topic.id || '(missing id)');
    const ok = Object.values(missing).every(items => items.length === 0)
        && duplicateIds.length === 0
        && invalidTopics.length === 0;
    return freezeTopic({ ok, missing, duplicateIds, invalidTopics, topicCount: HELP_TOPICS.length });
}
