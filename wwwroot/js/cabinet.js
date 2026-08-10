import * as THREE from './lib/three.module.js';
import {
    FABRICATION_ASSEMBLY_IDS,
    FABRICATION_ASSEMBLY_PART_IDS,
    buildFabricationSourceFromCabinet,
    createCabinetAssemblyFabricationRecords,
    createFabricationManifest,
    runPreflight
} from './fabrication.js';
import {
    DEFAULT_SIDE_PROFILE_CUSTOMIZATION,
    normalizeSideProfileCustomization,
    resolveSideProfile,
    SIDE_PROFILE_SAMPLING_OPTIONS
} from './side-profile.js';

export const DEFAULT_PANEL_COLOR = '#fbfbf8';

const SERVICE_DOOR_CLEARANCE_PER_SIDE_MM = 2;

export const PANEL_COLOR_PALETTE = Object.freeze([
    '#fbfbf8', '#f2f2ee', '#d9d7cf', '#a8a7a0',
    '#1b1b18', '#4a4a45', '#7a332c', '#b5483c',
    '#d9863d', '#e5c24a', '#6f8f47', '#2f7d58',
    '#2f7b83', '#376f9f', '#263f7f', '#5a3f8f',
    '#7d4a86', '#b05884', '#d98fa3', '#ffffff',
    '#ece6d1', '#c9d7e8', '#cfe3d3', '#f2c66d'
]);

const NUMERIC_COMPONENT_OVERRIDE_KEYS = Object.freeze(['offset', 'lengthDelta', 'widthDelta', 'thicknessDelta']);
const FASTENER_OVERRIDE_KEYS = Object.freeze(['diameterMm', 'lengthMm', 'edgeClearanceMm', 'minCenterSpacingMm']);

const DEFAULT_COMPONENT_OVERRIDE = Object.freeze({
    offset: 0,
    lengthDelta: 0,
    widthDelta: 0,
    thicknessDelta: 0,
    color: DEFAULT_PANEL_COLOR
});

export const DEFAULT_CONTROL_SCHEMA = Object.freeze({
    deck: {
        enabled: true,
        players: 2,
        buttonsPerPlayer: 6,
        buttonRows: 2,
        buttonDiameter: 30,
        buttonSpacing: 42,
        buttonSpacingX: 42,
        buttonSpacingY: 42,
        groupSpacing: 275,
        groupOrientation: 'across',
        layoutStyle: 'staggered',
        groupRotation: 0,
        joystickGap: 90,
        deckX: 10,
        deckY: 0,
        buttonColor: '#ffffff',
        buttonDefinitionId: 'button-30-snap',
        joystickEnabled: true,
        joystickDiameter: 38,
        joystickColor: '#1b1b18',
        joystickDefinitionId: 'joystick-jlf-pattern',
        showLabels: true,
        labels: 'A,B,C,D,E,F',
        customLayout: []
    },
    apron: {
        enabled: true,
        buttons: 2,
        buttonDiameter: 24,
        buttonSpacing: 86,
        orientation: 'horizontal',
        apronX: 0,
        apronY: 0,
        buttonColor: '#ffffff',
        buttonDefinitionId: 'button-24-snap',
        showLabels: true,
        labels: '1P,2P'
    }
});

export const DEFAULT_FASTENER_SCHEMA = Object.freeze({
    screwDiameter: 4,
    screwLength: 42,
    screwEdgeClearance: 24,
    screwMinSpacing: 30
});

export const DEFAULT_STRUCTURE_SCHEMA = Object.freeze({
    screenFrameEnabled: true,
    screenFrameBezel: 34,
    screenFrameDepth: 12,
    screenFrameClearance: 8,
    controlSupportEnabled: true,
    controlSupportRearInset: 110,
    controlSupportDrop: 90,
    controlSupportFrontRise: 35,
    controlCablePortWidth: 80,
    controlCablePortHeight: 45,
    controlCablePortOffset: 0,
    controlRiserEnabled: true,
    controlRiserPosition: 55,
    controlRiserLateralPosition: 55,
    controlProfileSupportCount: 1,
    controlProfileSupportSpacing: 240,
    controlRiserCablePortWidth: 64,
    controlRiserCablePortHeight: 40,
    controlRiserCablePortOffset: 0,
    displaySupportEnabled: true,
    displayCablePortWidth: 90,
    displayCablePortHeight: 45,
    displayCablePortOffset: 0,
    headerSupportEnabled: true,
    headerSupportDrop: 52,
    monitorCablePortWidth: 90,
    monitorCablePortHeight: 55,
    monitorCablePortOffset: 0,
    backDoorEnabled: true,
    backDoorWidth: 300,
    backDoorHeight: 520,
    backDoorBottomOffset: 90,
    machineShelfEnabled: true,
    machineShelfHeight: 140,
    machineShelfDepth: 360,
    machineShelfInset: 45,
    machineCablePortWidth: 80,
    machineCablePortHeight: 45,
    machineCablePortOffset: 0
});

const BOOLEAN_PARAM_KEYS = Object.freeze([
    'screenFrameEnabled',
    'controlSupportEnabled',
    'controlRiserEnabled',
    'displaySupportEnabled',
    'headerSupportEnabled',
    'backDoorEnabled',
    'machineShelfEnabled'
]);

export const PARAMETER_DEFINITIONS = {
    width: { label: 'Cabinet Width', unit: 'mm', precision: 0 },
    height: { label: 'Total Height', unit: 'mm', precision: 0 },
    depth: { label: 'Base Depth', unit: 'mm', precision: 0 },
    thickness: { label: 'Sheet Thickness', unit: 'mm', precision: 0 },
    toeKickHeight: { label: 'Toe Kick Height', unit: 'mm', precision: 0 },
    toeKickInset: { label: 'Toe Kick Inset', unit: 'mm', precision: 0 },
    frontApronDrop: { label: 'Front Apron Drop', unit: 'mm', precision: 0 },
    cpHeight: { label: 'Control Panel Height', unit: 'mm', precision: 0 },
    cpDepth: { label: 'Control Deck Depth', unit: 'mm', precision: 0 },
    cpAngle: { label: 'Control Deck Angle', unit: 'deg', precision: 0 },
    cpOverhang: { label: 'Control Deck Overhang', unit: 'mm', precision: 0 },
    monitorAngle: { label: 'Monitor Tilt', unit: 'deg', precision: 0 },
    bezelDepth: { label: 'Bezel Recess', unit: 'mm', precision: 0 },
    screenWidth: { label: 'Screen Width', unit: 'mm', precision: 0 },
    screenHeight: { label: 'Screen Height', unit: 'mm', precision: 0 },
    screenBezelMargin: { label: 'Screen Margin', unit: 'mm', precision: 0 },
    marqueeHeight: { label: 'Marquee Height', unit: 'mm', precision: 0 },
    marqueeDepth: { label: 'Top Cap Depth', unit: 'mm', precision: 0 },
    marqueeFaceInset: { label: 'Marquee Face Inset', unit: 'mm', precision: 0 },
    marqueeLean: { label: 'Marquee Face Lean', unit: 'mm', precision: 0 },
    screenFrameEnabled: { label: 'Screen Frame', unit: '', precision: 0 },
    screenFrameBezel: { label: 'Screen Frame Bezel', unit: 'mm', precision: 0 },
    screenFrameDepth: { label: 'Screen Frame Depth', unit: 'mm', precision: 0 },
    screenFrameClearance: { label: 'Screen Frame Clearance', unit: 'mm', precision: 0 },
    controlSupportEnabled: { label: 'Control Support', unit: '', precision: 0 },
    controlSupportRearInset: { label: 'Control Support Rear Inset', unit: 'mm', precision: 0 },
    controlSupportDrop: { label: 'Control Support Drop', unit: 'mm', precision: 0 },
    controlSupportFrontRise: { label: 'Control Support Front Rise', unit: 'mm', precision: 0 },
    controlCablePortWidth: { label: 'Control Cable Port Width', unit: 'mm', precision: 0 },
    controlCablePortHeight: { label: 'Control Cable Port Height', unit: 'mm', precision: 0 },
    controlCablePortOffset: { label: 'Control Cable Port Offset', unit: 'mm', precision: 0 },
    controlRiserEnabled: { label: 'Control Profile Supports', unit: '', precision: 0 },
    controlRiserPosition: { label: 'Control Riser Position', unit: '%', precision: 0 },
    controlRiserLateralPosition: { label: 'Control Riser Lateral Position', unit: '%', precision: 0 },
    controlProfileSupportCount: { label: 'Control Profile Support Count', unit: '', precision: 0 },
    controlProfileSupportSpacing: { label: 'Control Profile Support Spacing', unit: 'mm', precision: 0 },
    controlRiserCablePortWidth: { label: 'Profile Support Cable Port Width', unit: 'mm', precision: 0 },
    controlRiserCablePortHeight: { label: 'Profile Support Cable Port Height', unit: 'mm', precision: 0 },
    controlRiserCablePortOffset: { label: 'Profile Support Cable Port Offset', unit: 'mm', precision: 0 },
    displaySupportEnabled: { label: 'Display Bottom Support', unit: '', precision: 0 },
    displayCablePortWidth: { label: 'Display Support Cable Port Width', unit: 'mm', precision: 0 },
    displayCablePortHeight: { label: 'Display Support Cable Port Height', unit: 'mm', precision: 0 },
    displayCablePortOffset: { label: 'Display Support Cable Port Offset', unit: 'mm', precision: 0 },
    headerSupportEnabled: { label: 'Header Support', unit: '', precision: 0 },
    headerSupportDrop: { label: 'Header Support Drop', unit: 'mm', precision: 0 },
    monitorCablePortWidth: { label: 'Monitor Cable Port Width', unit: 'mm', precision: 0 },
    monitorCablePortHeight: { label: 'Monitor Cable Port Height', unit: 'mm', precision: 0 },
    monitorCablePortOffset: { label: 'Monitor Cable Port Offset', unit: 'mm', precision: 0 },
    backDoorEnabled: { label: 'Rear Service Door', unit: '', precision: 0 },
    backDoorWidth: { label: 'Rear Door Width', unit: 'mm', precision: 0 },
    backDoorHeight: { label: 'Rear Door Height', unit: 'mm', precision: 0 },
    backDoorBottomOffset: { label: 'Rear Door Bottom Offset', unit: 'mm', precision: 0 },
    machineShelfEnabled: { label: 'Machine Shelf', unit: '', precision: 0 },
    machineShelfHeight: { label: 'Machine Shelf Height', unit: 'mm', precision: 0 },
    machineShelfDepth: { label: 'Machine Shelf Depth', unit: 'mm', precision: 0 },
    machineShelfInset: { label: 'Machine Shelf Rear Inset', unit: 'mm', precision: 0 },
    machineCablePortWidth: { label: 'Machine Cable Port Width', unit: 'mm', precision: 0 },
    machineCablePortHeight: { label: 'Machine Cable Port Height', unit: 'mm', precision: 0 },
    machineCablePortOffset: { label: 'Machine Cable Port Offset', unit: 'mm', precision: 0 },
    screwDiameter: { label: 'Screw Shaft Diameter', unit: 'mm', precision: 1 },
    screwLength: { label: 'Screw Length', unit: 'mm', precision: 0 },
    screwEdgeClearance: { label: 'Screw Edge Clearance', unit: 'mm', precision: 0 },
    screwMinSpacing: { label: 'Screw Centre Spacing', unit: 'mm', precision: 0 },
    exploded: { label: 'Exploded View', unit: '%', precision: 0 },
    dummyHeight: { label: 'Dummy Height', unit: 'mm', precision: 0 }
};

export const COMPONENT_OVERRIDE_DEFINITIONS = {
    offset: { label: 'Panel Offset', unit: 'mm', precision: 0 },
    lengthDelta: { label: 'Length Delta', unit: 'mm', precision: 0 },
    widthDelta: { label: 'Width Delta', unit: 'mm', precision: 0 },
    thicknessDelta: { label: 'Thickness Delta', unit: 'mm', precision: 0 },
    color: { label: 'Panel Color', unit: '', precision: 0 }
};

export const CONTROL_DEFINITIONS = {
    'deck.players': { label: 'Deck Players', unit: '', precision: 0 },
    'deck.buttonsPerPlayer': { label: 'Buttons Per Player', unit: '', precision: 0 },
    'deck.buttonRows': { label: 'Button Rows', unit: '', precision: 0 },
    'deck.buttonDiameter': { label: 'Button Diameter', unit: 'mm', precision: 0 },
    'deck.buttonSpacing': { label: 'Button Spacing', unit: 'mm', precision: 0 },
    'deck.buttonSpacingX': { label: 'Button X Spacing', unit: 'mm', precision: 0 },
    'deck.buttonSpacingY': { label: 'Button Y Spacing', unit: 'mm', precision: 0 },
    'deck.groupSpacing': { label: 'Player Spacing', unit: 'mm', precision: 0 },
    'deck.groupRotation': { label: 'Group Rotation', unit: 'deg', precision: 0 },
    'deck.joystickGap': { label: 'Joystick Gap', unit: 'mm', precision: 0 },
    'deck.deckX': { label: 'Deck X', unit: 'mm', precision: 0 },
    'deck.deckY': { label: 'Deck Y', unit: 'mm', precision: 0 },
    'deck.joystickDiameter': { label: 'Joystick Diameter', unit: 'mm', precision: 0 },
    'apron.buttons': { label: 'Start Buttons', unit: '', precision: 0 },
    'apron.buttonDiameter': { label: 'Start Diameter', unit: 'mm', precision: 0 },
    'apron.buttonSpacing': { label: 'Start Spacing', unit: 'mm', precision: 0 },
    'apron.apronX': { label: 'Apron X', unit: 'mm', precision: 0 },
    'apron.apronY': { label: 'Apron Y', unit: 'mm', precision: 0 }
};

export const PRESETS = {
    standard: {
        width: 650,
        height: 1700,
        depth: 600,
        thickness: 18,
        toeKickHeight: 55,
        toeKickInset: 70,
        frontApronDrop: 125,
        cpHeight: 950,
        cpDepth: 280,
        cpAngle: 5,
        cpOverhang: 0,
        monitorAngle: 15,
        bezelDepth: 100,
        screenWidth: 470,
        screenHeight: 270,
        screenBezelMargin: 35,
        marqueeHeight: 180,
        marqueeDepth: 220,
        marqueeFaceInset: 50,
        marqueeLean: 20,
        ...cloneParams(DEFAULT_FASTENER_SCHEMA),
        ...cloneParams(DEFAULT_STRUCTURE_SCHEMA),
        sideProfileCustomization: cloneParams(DEFAULT_SIDE_PROFILE_CUSTOMIZATION),
        exploded: 0,
        controls: cloneParams(DEFAULT_CONTROL_SCHEMA),
        componentOverrides: {
            panel_cp_support: { color: '#b5483c' },
            panel_control_riser: { color: '#b5483c' },
            panel_control_riser_2: { color: '#b5483c' },
            panel_display_support: { color: '#b5483c' },
            panel_header_support: { color: '#b5483c' },
            panel_machine_shelf: { color: '#6f8f47' }
        }
    },
    barstool: {
        width: 560,
        height: 760,
        depth: 470,
        thickness: 15,
        toeKickHeight: 35,
        toeKickInset: 45,
        frontApronDrop: 95,
        cpHeight: 250,
        cpDepth: 245,
        cpAngle: 8,
        cpOverhang: 35,
        monitorAngle: 18,
        bezelDepth: 75,
        screenWidth: 360,
        screenHeight: 210,
        screenBezelMargin: 28,
        marqueeHeight: 100,
        marqueeDepth: 150,
        marqueeFaceInset: 45,
        marqueeLean: 10,
        screwDiameter: 4,
        screwLength: 36,
        screwEdgeClearance: 14,
        screwMinSpacing: 28,
        ...cloneParams(DEFAULT_STRUCTURE_SCHEMA),
        sideProfileCustomization: cloneParams(DEFAULT_SIDE_PROFILE_CUSTOMIZATION),
        controlSupportRearInset: 70,
        controlSupportDrop: 55,
        headerSupportDrop: 34,
        monitorCablePortHeight: 36,
        machineShelfHeight: 90,
        machineShelfDepth: 280,
        exploded: 0,
        controls: {
            deck: {
                ...cloneParams(DEFAULT_CONTROL_SCHEMA.deck),
                players: 2,
                buttonsPerPlayer: 4,
                buttonRows: 2,
                buttonDiameter: 30,
                buttonSpacing: 42,
                buttonSpacingX: 42,
                buttonSpacingY: 42,
                groupSpacing: 240,
                joystickGap: 90,
                deckX: 0
            },
            apron: {
                ...cloneParams(DEFAULT_CONTROL_SCHEMA.apron),
                buttons: 2,
                buttonDiameter: 24,
                buttonSpacing: 72
            }
        },
        componentOverrides: {
            panel_cp_support: { color: '#b5483c' },
            panel_control_riser: { color: '#b5483c' },
            panel_control_riser_2: { color: '#b5483c' },
            panel_display_support: { color: '#b5483c' },
            panel_header_support: { color: '#b5483c' },
            panel_machine_shelf: { color: '#6f8f47' }
        }
    }
};

export function cloneParams(params) {
    return JSON.parse(JSON.stringify(params));
}

function normalizeControlSchema(controls = {}) {
    const deck = {
        ...cloneParams(DEFAULT_CONTROL_SCHEMA.deck),
        ...(controls.deck || {})
    };
    const apron = {
        ...cloneParams(DEFAULT_CONTROL_SCHEMA.apron),
        ...(controls.apron || {})
    };

    const legacySpacing = numberOr(deck.buttonSpacing, DEFAULT_CONTROL_SCHEMA.deck.buttonSpacing);
    deck.buttonSpacingX = numberOr(deck.buttonSpacingX, legacySpacing);
    deck.buttonSpacingY = numberOr(deck.buttonSpacingY, legacySpacing);
    deck.groupOrientation = sanitizeControlChoice(deck.groupOrientation, ['across', 'frontBack'], DEFAULT_CONTROL_SCHEMA.deck.groupOrientation);
    deck.layoutStyle = sanitizeControlChoice(deck.layoutStyle, ['grid', 'staggered', 'vee', 'custom'], DEFAULT_CONTROL_SCHEMA.deck.layoutStyle);
    deck.customLayout = normalizeCustomLayout(deck.customLayout);
    apron.orientation = sanitizeControlChoice(apron.orientation, ['horizontal', 'vertical'], DEFAULT_CONTROL_SCHEMA.apron.orientation);

    return {
        deck,
        apron
    };
}

function normalizeComponentOverrides(overrides = {}) {
    const normalized = {};
    Object.entries(overrides || {}).forEach(([panelId, override]) => {
        const next = { ...DEFAULT_COMPONENT_OVERRIDE, ...(override || {}) };
        NUMERIC_COMPONENT_OVERRIDE_KEYS.forEach(key => {
            next[key] = Number(next[key]) || 0;
        });
        next.color = sanitizePaletteColor(next.color);

        const isDefault = NUMERIC_COMPONENT_OVERRIDE_KEYS.every(key => next[key] === 0)
            && next.color === DEFAULT_PANEL_COLOR;
        if (!isDefault) {
            normalized[panelId] = next;
        }
    });
    return normalized;
}

function normalizeFastenerOverrideMap(overrides = {}) {
    const normalized = {};
    Object.entries(overrides || {}).forEach(([id, override]) => {
        const next = {};
        FASTENER_OVERRIDE_KEYS.forEach(key => {
            if (Number.isFinite(Number(override?.[key]))) next[key] = Number(override[key]);
        });
        if (Object.keys(next).length) normalized[String(id)] = next;
    });
    return normalized;
}

export function normalizeParams(params = {}) {
    const source = params || {};
    const normalized = {
        ...cloneParams(PRESETS.standard),
        ...source,
        controls: normalizeControlSchema(source.controls || {}),
        componentOverrides: normalizeComponentOverrides(source.componentOverrides || {}),
        fastenerGroupOverrides: normalizeFastenerOverrideMap(source.fastenerGroupOverrides || {}),
        fastenerOverrides: normalizeFastenerOverrideMap(source.fastenerOverrides || {}),
        sideProfileCustomization: normalizeSideProfileCustomization(source.sideProfileCustomization)
    };

    Object.keys(DEFAULT_FASTENER_SCHEMA).forEach(key => {
        normalized[key] = numberOr(normalized[key], DEFAULT_FASTENER_SCHEMA[key]);
    });
    Object.entries(DEFAULT_STRUCTURE_SCHEMA).forEach(([key, fallback]) => {
        normalized[key] = BOOLEAN_PARAM_KEYS.includes(key)
            ? boolParam(normalized[key], fallback)
            : numberOr(normalized[key], fallback);
    });
    normalized.controlProfileSupportCount = clamp(Math.round(numberOr(
        normalized.controlProfileSupportCount,
        DEFAULT_STRUCTURE_SCHEMA.controlProfileSupportCount
    )), 1, 2);
    normalized.controlProfileSupportSpacing = Math.max(0, numberOr(
        normalized.controlProfileSupportSpacing,
        DEFAULT_STRUCTURE_SCHEMA.controlProfileSupportSpacing
    ));

    return normalized;
}

export function formatParamValue(key, value) {
    const definition = PARAMETER_DEFINITIONS[key] || COMPONENT_OVERRIDE_DEFINITIONS[key] || {};
    const precision = definition.precision ?? 0;
    const numeric = Number(value) || 0;
    const formatted = precision > 0 ? numeric.toFixed(precision) : Math.round(numeric).toString();
    return definition.unit ? `${formatted} ${definition.unit}` : formatted;
}

export function formatControlValue(path, value) {
    const definition = CONTROL_DEFINITIONS[path] || {};
    if (typeof value === 'string' && value.trim() && Number.isNaN(Number(value))) {
        return value;
    }
    const numeric = Number(value) || 0;
    const precision = definition.precision ?? 0;
    const formatted = precision > 0 ? numeric.toFixed(precision) : Math.round(numeric).toString();
    return definition.unit ? `${formatted} ${definition.unit}` : formatted;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function numberOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function sanitizePaletteColor(color) {
    if (typeof color !== 'string') return DEFAULT_PANEL_COLOR;
    const normalized = color.trim().toLowerCase();
    return PANEL_COLOR_PALETTE.includes(normalized) ? normalized : DEFAULT_PANEL_COLOR;
}

function sanitizeControlChoice(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function boolParam(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value !== 'false' && value !== '0';
    return fallback;
}

function normalizeCustomLayout(layout = []) {
    if (!Array.isArray(layout)) return [];

    return layout
        .map((item, index) => {
            const kind = item?.kind === 'joystick' ? 'joystick' : 'button';
            return {
                id: typeof item?.id === 'string' && item.id ? item.id : `${kind}_${index}`,
                kind,
                buttonIndex: Math.max(0, Math.round(numberOr(item?.buttonIndex, index))),
                x: clamp(numberOr(item?.x, 0), -260, 260),
                y: clamp(numberOr(item?.y, 0), -130, 130)
            };
        })
        .slice(0, 16);
}

function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        const next = points[(i + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area / 2);
}

function interpolateSegmentYAtX(start, end, x) {
    const run = end.x - start.x;
    if (Math.abs(run) < 0.000001) return (start.y + end.y) / 2;
    const ratio = clamp((x - start.x) / run, 0, 1);
    return start.y + (end.y - start.y) * ratio;
}

function horizontalProfileSpan(profilePoints, y) {
    const intersections = [];
    const tolerance = 0.0001;

    for (let index = 0; index < profilePoints.length; index++) {
        const start = profilePoints[index];
        const end = profilePoints[(index + 1) % profilePoints.length];
        const dy = end.y - start.y;

        if (Math.abs(dy) <= tolerance) {
            if (Math.abs(y - start.y) <= tolerance) {
                intersections.push(start.x, end.x);
            }
            continue;
        }

        const minY = Math.min(start.y, end.y) - tolerance;
        const maxY = Math.max(start.y, end.y) + tolerance;
        if (y < minY || y > maxY) continue;

        const ratio = (y - start.y) / dy;
        if (ratio < -tolerance || ratio > 1 + tolerance) continue;
        intersections.push(start.x + (end.x - start.x) * ratio);
    }

    const unique = intersections
        .sort((a, b) => a - b)
        .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > tolerance);

    if (unique.length < 2) return null;
    return {
        minX: unique[0],
        maxX: unique[unique.length - 1]
    };
}

function verticalProfileSpan(profilePoints, x) {
    const intersections = [];
    const tolerance = 0.0001;

    for (let index = 0; index < profilePoints.length; index++) {
        const start = profilePoints[index];
        const end = profilePoints[(index + 1) % profilePoints.length];
        const dx = end.x - start.x;

        if (Math.abs(dx) <= tolerance) {
            if (Math.abs(x - start.x) <= tolerance) {
                intersections.push(start.y, end.y);
            }
            continue;
        }

        const minX = Math.min(start.x, end.x) - tolerance;
        const maxX = Math.max(start.x, end.x) + tolerance;
        if (x < minX || x > maxX) continue;

        const ratio = (x - start.x) / dx;
        if (ratio < -tolerance || ratio > 1 + tolerance) continue;
        intersections.push(start.y + (end.y - start.y) * ratio);
    }

    const unique = intersections
        .sort((a, b) => a - b)
        .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > tolerance);

    if (unique.length < 2) return null;
    return {
        minY: unique[0],
        maxY: unique[unique.length - 1]
    };
}

function parseLabels(labels) {
    if (typeof labels !== 'string') return [];
    return labels
        .split(',')
        .map(label => label.trim())
        .filter(Boolean)
        .slice(0, 12);
}

function rotateLocalPoint(x, y, degrees) {
    const radians = (Number(degrees) || 0) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: x * cos - y * sin,
        y: x * sin + y * cos
    };
}

function analyzeHardwareItemsFit(items, panelLength, panelWidth, margin = 10) {
    if (!items.length) {
        return { items, warnings: [], adjusted: false, fitSuggestion: null };
    }

    const maxRadius = Math.max(...items.map(item => item.radiusMm));
    const usableLength = Math.max(1, panelLength - margin * 2 - maxRadius * 2);
    const usableWidth = Math.max(1, panelWidth - margin * 2 - maxRadius * 2);
    const minX = Math.min(...items.map(item => item.xMm));
    const maxX = Math.max(...items.map(item => item.xMm));
    const minY = Math.min(...items.map(item => item.yMm));
    const maxY = Math.max(...items.map(item => item.yMm));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scaleX = Math.min(1, usableLength / spanX);
    const scaleY = Math.min(1, usableWidth / spanY);
    const centerX = panelLength / 2;
    const centerY = panelWidth / 2;
    const requestedBounds = {
        minX: Math.min(...items.map(item => item.xMm - item.radiusMm)),
        maxX: Math.max(...items.map(item => item.xMm + item.radiusMm)),
        minY: Math.min(...items.map(item => item.yMm - item.radiusMm)),
        maxY: Math.max(...items.map(item => item.yMm + item.radiusMm))
    };
    const outside = requestedBounds.minX < margin - 0.001
        || requestedBounds.maxX > panelLength - margin + 0.001
        || requestedBounds.minY < margin - 0.001
        || requestedBounds.maxY > panelWidth - margin + 0.001;
    const adjusted = scaleX < 0.999 || scaleY < 0.999 || outside;

    const fitted = items.map(item => {
        const xMm = centerX + (item.xMm - centerX) * scaleX;
        const yMm = centerY + (item.yMm - centerY) * scaleY;
        const clampedX = clamp(xMm, margin + item.radiusMm, panelLength - margin - item.radiusMm);
        const clampedY = clamp(yMm, margin + item.radiusMm, panelWidth - margin - item.radiusMm);
        return {
            ...item,
            xMm: clampedX,
            yMm: clampedY,
            adjusted: true
        };
    });

    if (!adjusted) {
        return { items, warnings: [], adjusted: false, fitSuggestion: null };
    }

    return {
        // Requested coordinates remain visible and are the only coordinates
        // considered for production.  Nothing is silently compressed.
        items,
        warnings: ['Control layout exceeds the usable panel area. Apply the fitted suggestion or adjust the controls.'],
        adjusted: true,
        fitSuggestion: {
            scaleX,
            scaleY,
            marginMm: margin,
            panelLengthMm: panelLength,
            panelWidthMm: panelWidth,
            requestedBounds,
            items: fitted.map(item => ({ ...item }))
        }
    };
}

function disposeObject3D(root, disposedGeometries = new Set(), disposedMaterials = new Set()) {
    root?.traverse?.(object => {
        if (object.geometry && !disposedGeometries.has(object.geometry)) {
            disposedGeometries.add(object.geometry);
            object.geometry.dispose?.();
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.filter(Boolean).forEach(material => {
            if (disposedMaterials.has(material)) return;
            disposedMaterials.add(material);
            material.dispose?.();
        });
    });
}

function controlFitSignature(config = {}) {
    const source = { ...config };
    delete source.fittedLayout;
    return JSON.stringify(source);
}

function panelRectPolygon(center, axisX, axisY, length, thickness) {
    const hx = length / 2;
    const hy = thickness / 2;
    return [
        { x: center.x - axisX.x * hx - axisY.x * hy, y: center.y - axisX.y * hx - axisY.y * hy },
        { x: center.x + axisX.x * hx - axisY.x * hy, y: center.y + axisX.y * hx - axisY.y * hy },
        { x: center.x + axisX.x * hx + axisY.x * hy, y: center.y + axisX.y * hx + axisY.y * hy },
        { x: center.x - axisX.x * hx + axisY.x * hy, y: center.y - axisX.y * hx + axisY.y * hy }
    ];
}

function projectPolygon(points, axis) {
    let min = Infinity;
    let max = -Infinity;
    points.forEach(point => {
        const value = point.x * axis.x + point.y * axis.y;
        min = Math.min(min, value);
        max = Math.max(max, value);
    });
    return { min, max };
}

function polygonPenetration(polyA, polyB) {
    let penetration = Infinity;
    const axes = [];
    [polyA, polyB].forEach(poly => {
        for (let i = 0; i < poly.length; i++) {
            const current = poly[i];
            const next = poly[(i + 1) % poly.length];
            const edge = { x: next.x - current.x, y: next.y - current.y };
            const length = Math.hypot(edge.x, edge.y) || 1;
            axes.push({ x: -edge.y / length, y: edge.x / length });
        }
    });

    for (const axis of axes) {
        const a = projectPolygon(polyA, axis);
        const b = projectPolygon(polyB, axis);
        const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
        if (overlap <= 0) return 0;
        penetration = Math.min(penetration, overlap);
    }

    return Number.isFinite(penetration) ? penetration : 0;
}

function polygonCenter(points) {
    const total = points.reduce((acc, point) => {
        acc.x += point.x;
        acc.y += point.y;
        return acc;
    }, { x: 0, y: 0 });
    return {
        x: total.x / points.length,
        y: total.y / points.length
    };
}

function desiredNormalForFace(faceDir) {
    if (faceDir === 'back') return { x: -1, y: 0 };
    if (faceDir === 'top') return { x: 0, y: 1 };
    if (faceDir === 'bottom') return { x: 0, y: -1 };
    return { x: 1, y: 0 };
}

function choosePanelOrientation(ux, uy, faceDir) {
    const localY = { x: -uy, y: ux };
    const desired = desiredNormalForFace(faceDir);
    const sign = (localY.x * desired.x + localY.y * desired.y) >= 0 ? 1 : -1;
    return {
        localY,
        outwardSign: sign,
        outward: {
            x: localY.x * sign,
            y: localY.y * sign
        }
    };
}

function dot2(a, b) {
    return a.x * b.x + a.y * b.y;
}

function subtract2(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}

function addScaled2(point, vector, scale) {
    return {
        x: point.x + vector.x * scale,
        y: point.y + vector.y * scale
    };
}

function lineIntersection2(lineA, lineB) {
    const cross = lineA.dir.x * lineB.dir.y - lineA.dir.y * lineB.dir.x;
    if (Math.abs(cross) < 0.00001) return null;

    const delta = subtract2(lineB.point, lineA.point);
    const t = (delta.x * lineB.dir.y - delta.y * lineB.dir.x) / cross;
    return addScaled2(lineA.point, lineA.dir, t);
}

function angleBetweenSegments(segA, segB) {
    const dot = clamp(dot2(segA.unit, segB.unit), -1, 1);
    return Math.acos(dot) * 180 / Math.PI;
}

function describeJointType(angle) {
    const rounded = Math.round(angle);
    if (Math.abs(rounded - 90) <= 2) return '90 deg mitre';
    if (rounded <= 12 || rounded >= 168) return 'butt seam';
    return `${rounded} deg mitre`;
}

function getPanelEdgeProfile(part, points) {
    const p1 = part.p1Name ? points[part.p1Name] : part.p1;
    const p2 = part.p2Name ? points[part.p2Name] : part.p2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const baseLength = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const ux = dx / baseLength;
    const uy = dy / baseLength;
    const orientation = choosePanelOrientation(ux, uy, part.faceDir);

    return {
        ...part,
        p1,
        p2,
        dx,
        dy,
        baseLength,
        angle: Math.atan2(dy, dx),
        unit: { x: ux, y: uy },
        orientation,
        localY: orientation.localY,
        outward: orientation.outward
    };
}

function computeMitrePoint(pointName, jointSegments, points) {
    const point = points[pointName];
    if (!point || jointSegments.length < 2) return point;

    const [a, b] = jointSegments;
    const lineA = {
        point: addScaled2(point, a.outward, a.panelThickness + a.overrideOffset),
        dir: a.unit
    };
    const lineB = {
        point: addScaled2(point, b.outward, b.panelThickness + b.overrideOffset),
        dir: b.unit
    };
    const intersection = lineIntersection2(lineA, lineB);
    if (intersection) return intersection;

    const avg = {
        x: a.outward.x * a.panelThickness + b.outward.x * b.panelThickness,
        y: a.outward.y * a.panelThickness + b.outward.y * b.panelThickness
    };
    const avgLength = Math.hypot(avg.x, avg.y) || 1;
    const fallbackDistance = Math.max(a.panelThickness, b.panelThickness);
    return {
        x: point.x + (avg.x / avgLength) * fallbackDistance,
        y: point.y + (avg.y / avgLength) * fallbackDistance
    };
}

function isBottomButtJoint(point) {
    return point && Math.abs(point.y) < 0.001;
}

function panelJointCutPoint(segment, pointName, points, mitrePoints) {
    const point = points[pointName];
    if (isBottomButtJoint(point)) {
        return addScaled2(point, segment.outward, segment.panelThickness + segment.overrideOffset);
    }
    return mitrePoints[pointName] || point;
}

function worldToPanelLocal(point, origin, unit, localY) {
    const delta = subtract2(point, origin);
    return {
        x: dot2(delta, unit),
        y: dot2(delta, localY)
    };
}

function polygonBounds(points) {
    return points.reduce((bounds, point) => {
        bounds.minX = Math.min(bounds.minX, point.x);
        bounds.maxX = Math.max(bounds.maxX, point.x);
        bounds.minY = Math.min(bounds.minY, point.y);
        bounds.maxY = Math.max(bounds.maxY, point.y);
        return bounds;
    }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function pointsNearlyEqual(a, b, tolerance = 0.01) {
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function pushUniqueProfilePoint(points, point) {
    if (!points.length || !pointsNearlyEqual(points[points.length - 1], point)) {
        points.push({ x: point.x, y: point.y });
    }
}

function createShapeFromPointList(pointList) {
    const shape = new THREE.Shape();
    shape.moveTo(pointList[0].x, pointList[0].y);
    pointList.slice(1).forEach(point => shape.lineTo(point.x, point.y));
    shape.closePath();
    return shape;
}

function buildSideWallProfilePointList(parts, panelProfiles, fallbackProfile) {
    const points = [];
    const signedAreaTwice = fallbackProfile.reduce((area, point, index) => {
        const next = fallbackProfile[(index + 1) % fallbackProfile.length];
        return area + point.x * next.y - next.x * point.y;
    }, 0);
    const exteriorSide = signedAreaTwice < 0 ? 1 : -1;

    parts.forEach(part => {
        const profile = panelProfiles[part.id];
        if (!profile?.outerEdge?.length || !profile?.innerEdge?.length) return;

        const dx = part.p2.x - part.p1.x;
        const dy = part.p2.y - part.p1.y;
        const length = Math.hypot(dx, dy) || 1;
        const exteriorNormal = {
            x: (-dy / length) * exteriorSide,
            y: (dx / length) * exteriorSide
        };
        const nominalMidpoint = {
            x: (part.p1.x + part.p2.x) / 2,
            y: (part.p1.y + part.p2.y) / 2
        };
        const edgeScore = edge => {
            const midpoint = {
                x: (edge[0].x + edge[edge.length - 1].x) / 2,
                y: (edge[0].y + edge[edge.length - 1].y) / 2
            };
            return dot2(subtract2(midpoint, nominalMidpoint), exteriorNormal);
        };
        const exteriorEdge = edgeScore(profile.outerEdge) >= edgeScore(profile.innerEdge)
            ? profile.outerEdge
            : profile.innerEdge;
        exteriorEdge.forEach(point => pushUniqueProfilePoint(points, point));
    });

    if (points.length > 1 && pointsNearlyEqual(points[0], points[points.length - 1])) {
        points.pop();
    }

    return points.length >= 3 && polygonArea(points) > 1
        ? points
        : fallbackProfile;
}

function createMitredPanelGeometry(crossSection, panelWidth) {
    const positions = [];
    const uvs = [];
    const groups = [];
    const halfWidth = panelWidth / 2;
    const bounds = polygonBounds(crossSection);
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanY = Math.max(1, bounds.maxY - bounds.minY);

    const pushVertex = (point, z) => {
        positions.push(point.x, point.y, z);
        uvs.push((point.x - bounds.minX) / spanX, (z + halfWidth) / Math.max(1, panelWidth));
    };

    const pushCapVertex = (point, z) => {
        positions.push(point.x, point.y, z);
        uvs.push((point.x - bounds.minX) / spanX, (point.y - bounds.minY) / spanY);
    };

    const addGroup = (start, materialIndex) => {
        groups.push({ start, count: positions.length / 3 - start, materialIndex });
    };

    const addQuad = (a, b, c, d, materialIndex) => {
        const start = positions.length / 3;
        pushVertex(a, -halfWidth);
        pushVertex(b, -halfWidth);
        pushVertex(b, halfWidth);
        pushVertex(a, -halfWidth);
        pushVertex(b, halfWidth);
        pushVertex(a, halfWidth);
        addGroup(start, materialIndex);
    };

    const addCap = (z, reverse = false) => {
        for (let i = 1; i < crossSection.length - 1; i++) {
            const start = positions.length / 3;
            const tri = reverse
                ? [crossSection[0], crossSection[i + 1], crossSection[i]]
                : [crossSection[0], crossSection[i], crossSection[i + 1]];
            tri.forEach(point => pushCapVertex(point, z));
            addGroup(start, 1);
        }
    };

    for (let i = 0; i < crossSection.length; i++) {
        const current = crossSection[i];
        const next = crossSection[(i + 1) % crossSection.length];
        const materialIndex = current.edgeAfter === 'inner' || current.edgeAfter === 'outer' ? 0 : 1;
        addQuad(current, next, null, null, materialIndex);
    }

    addCap(-halfWidth, true);
    addCap(halfWidth, false);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    return geometry;
}

function buildMitredPanelProfile(segment, startMitre, endMitre, panelThickness, lengthDelta = 0) {
    const sign = segment.orientation.outwardSign;
    const origin = {
        x: (segment.p1.x + segment.p2.x) / 2 + segment.outward.x * (panelThickness / 2 + segment.overrideOffset),
        y: (segment.p1.y + segment.p2.y) / 2 + segment.outward.y * (panelThickness / 2 + segment.overrideOffset)
    };
    const halfBase = segment.baseLength / 2;
    const extension = lengthDelta / 2;
    const innerY = -sign * panelThickness / 2;
    const outerY = sign * panelThickness / 2;
    const outerStart = worldToPanelLocal(startMitre, origin, segment.unit, segment.localY);
    const outerEnd = worldToPanelLocal(endMitre, origin, segment.unit, segment.localY);

    let points;
    if (sign >= 0) {
        points = [
            { x: -halfBase - extension, y: innerY, edgeAfter: 'inner' },
            { x: halfBase + extension, y: innerY, edgeAfter: 'endCut' },
            { x: outerEnd.x + extension, y: outerY, edgeAfter: 'outer' },
            { x: outerStart.x - extension, y: outerY, edgeAfter: 'startCut' }
        ];
    } else {
        points = [
            { x: -halfBase - extension, y: innerY, edgeAfter: 'startCut' },
            { x: outerStart.x - extension, y: outerY, edgeAfter: 'outer' },
            { x: outerEnd.x + extension, y: outerY, edgeAfter: 'endCut' },
            { x: halfBase + extension, y: innerY, edgeAfter: 'inner' }
        ];
    }

    const bounds = polygonBounds(points);
    const toWorld = point => ({
        x: origin.x + segment.unit.x * point.x + segment.localY.x * point.y,
        y: origin.y + segment.unit.y * point.x + segment.localY.y * point.y
    });
    const worldPolygon = points.map(toWorld);
    const innerEdge = sign >= 0
        ? [toWorld(points[0]), toWorld(points[1])]
        : [toWorld(points[0]), toWorld(points[3])];
    const outerEdge = sign >= 0
        ? [toWorld(points[3]), toWorld(points[2])]
        : [toWorld(points[1]), toWorld(points[2])];

    return {
        origin,
        points,
        innerEdge,
        outerEdge,
        worldPolygon,
        bounds,
        blankLength: bounds.maxX - bounds.minX
    };
}

function buildSquarePanelProfile(segment, panelThickness, lengthDelta = 0) {
    const sign = segment.orientation.outwardSign;
    const origin = {
        x: (segment.p1.x + segment.p2.x) / 2 + segment.outward.x * (panelThickness / 2 + segment.overrideOffset),
        y: (segment.p1.y + segment.p2.y) / 2 + segment.outward.y * (panelThickness / 2 + segment.overrideOffset)
    };
    const halfBase = segment.baseLength / 2;
    const extension = lengthDelta / 2;
    const innerY = -sign * panelThickness / 2;
    const outerY = sign * panelThickness / 2;
    const outerStart = segment.outerP1
        ? worldToPanelLocal(segment.outerP1, origin, segment.unit, segment.localY)
        : { x: -halfBase, y: outerY };
    const outerEnd = segment.outerP2
        ? worldToPanelLocal(segment.outerP2, origin, segment.unit, segment.localY)
        : { x: halfBase, y: outerY };
    const points = sign >= 0
        ? [
            { x: -halfBase - extension, y: innerY, edgeAfter: 'inner' },
            { x: halfBase + extension, y: innerY, edgeAfter: 'endCut' },
            { x: outerEnd.x + extension, y: outerY, edgeAfter: 'outer' },
            { x: outerStart.x - extension, y: outerY, edgeAfter: 'startCut' }
        ]
        : [
            { x: -halfBase - extension, y: innerY, edgeAfter: 'startCut' },
            { x: outerStart.x - extension, y: outerY, edgeAfter: 'outer' },
            { x: outerEnd.x + extension, y: outerY, edgeAfter: 'endCut' },
            { x: halfBase + extension, y: innerY, edgeAfter: 'inner' }
        ];
    const bounds = polygonBounds(points);
    const toWorld = point => ({
        x: origin.x + segment.unit.x * point.x + segment.localY.x * point.y,
        y: origin.y + segment.unit.y * point.x + segment.localY.y * point.y
    });
    const worldPolygon = points.map(toWorld);
    const innerEdge = sign >= 0
        ? [toWorld(points[0]), toWorld(points[1])]
        : [toWorld(points[0]), toWorld(points[3])];
    const outerEdge = sign >= 0
        ? [toWorld(points[3]), toWorld(points[2])]
        : [toWorld(points[1]), toWorld(points[2])];

    return {
        origin,
        points,
        innerEdge,
        outerEdge,
        worldPolygon,
        bounds,
        blankLength: bounds.maxX - bounds.minX
    };
}

function buildPanelMitreGuides(part, mitredProfile, panelThickness, joints = []) {
    const points = mitredProfile.points;
    const bounds = mitredProfile.bounds;
    const guideSources = [
        {
            edge: 'start',
            pointName: part.p1Name,
            inner: points[0],
            outer: points[points.length === 4 && points[1].edgeAfter === 'outer' ? 1 : 3]
        },
        {
            edge: 'end',
            pointName: part.p2Name,
            inner: points[points.length === 4 && points[3].edgeAfter === 'inner' ? 3 : 1],
            outer: points[2]
        }
    ];

    return guideSources
        .map(source => {
            const joint = joints.find(item => item.pointName === source.pointName);
            if (!joint) return null;

            const frontLineMm = source.outer.x - bounds.minX;
            const backLineMm = source.inner.x - bounds.minX;
            const longFace = source.edge === 'start'
                ? (frontLineMm <= backLineMm ? 'front' : 'back')
                : (frontLineMm >= backLineMm ? 'front' : 'back');
            const bevelAngleDeg = joint.type === 'butt seam'
                ? 0
                : Math.atan2(Math.abs(frontLineMm - backLineMm), Math.max(0.000001, panelThickness)) * 180 / Math.PI;

            return {
                edge: source.edge,
                pointName: source.pointName,
                type: joint.type === 'butt seam' ? 'butt' : 'mitre',
                // angleDeg remains as a compatibility alias for older UI code.
                angleDeg: joint.includedAngleDeg,
                includedAngleDeg: joint.includedAngleDeg,
                bevelAngleDeg,
                frontLineMm,
                backLineMm,
                longFace
            };
        })
        .filter(Boolean);
}

function getFastenerSpec(params, materialThickness) {
    const diameterMm = clamp(numberOr(params.screwDiameter, DEFAULT_FASTENER_SCHEMA.screwDiameter), 1.5, 12);
    const lengthMm = clamp(numberOr(params.screwLength, DEFAULT_FASTENER_SCHEMA.screwLength), 8, 180);
    const edgeClearanceMm = clamp(numberOr(params.screwEdgeClearance, DEFAULT_FASTENER_SCHEMA.screwEdgeClearance), 0, 180);
    const minCenterSpacingMm = clamp(numberOr(params.screwMinSpacing, DEFAULT_FASTENER_SCHEMA.screwMinSpacing), diameterMm, 420);
    const radiusMm = diameterMm / 2;

    return {
        diameterMm,
        radiusMm,
        lengthMm,
        edgeClearanceMm,
        minCenterSpacingMm,
        targetPenetrationMm: Math.max(6, diameterMm * 2, materialThickness * 0.45),
        headRadiusMm: clamp(diameterMm * 1.25, 3.5, 8),
        headThicknessMm: clamp(diameterMm * 0.38, 1.2, 3.2),
        targetMaxSpacingMm: Math.max(240, minCenterSpacingMm)
    };
}

function applyFastenerSpecOverride(base, override = {}, materialThickness = 18) {
    const diameterMm = clamp(numberOr(override.diameterMm, base.diameterMm), 1.5, 12);
    const lengthMm = clamp(numberOr(override.lengthMm, base.lengthMm), 8, 180);
    const edgeClearanceMm = clamp(numberOr(override.edgeClearanceMm, base.edgeClearanceMm), 0, 180);
    const minCenterSpacingMm = clamp(numberOr(override.minCenterSpacingMm, base.minCenterSpacingMm), diameterMm, 420);
    return {
        ...base,
        diameterMm,
        radiusMm: diameterMm / 2,
        lengthMm,
        edgeClearanceMm,
        minCenterSpacingMm,
        targetPenetrationMm: Math.max(6, diameterMm * 2, materialThickness * 0.45),
        headRadiusMm: clamp(diameterMm * 1.25, 3.5, 8),
        headThicknessMm: clamp(diameterMm * 0.38, 1.2, 3.2),
        targetMaxSpacingMm: Math.max(240, minCenterSpacingMm)
    };
}

function getFastenerLocalPositions(minX, maxX, spec) {
    const span = Math.max(0, maxX - minX);
    if (span <= 0) return [];

    const edge = Math.min(spec.edgeClearanceMm, span / 2);
    const usable = Math.max(0, span - edge * 2);

    if (usable < spec.minCenterSpacingMm) {
        return [minX + span / 2];
    }

    const intervalsForMaxSpacing = Math.max(1, Math.ceil(usable / spec.targetMaxSpacingMm));
    const intervalsForMinSpacing = Math.max(1, Math.floor(usable / spec.minCenterSpacingMm));
    const intervals = Math.max(1, Math.min(intervalsForMaxSpacing, intervalsForMinSpacing));

    const positions = [];
    for (let i = 0; i <= intervals; i++) {
        positions.push(minX + edge + (usable * i) / intervals);
    }

    return positions;
}

function zInterval(record) {
    return {
        min: Math.min(record.shaftStartZ, record.shaftEndZ),
        max: Math.max(record.shaftStartZ, record.shaftEndZ)
    };
}

function intervalOverlap(a, b) {
    return Math.min(a.max, b.max) - Math.max(a.min, b.min);
}

function makePanelObb(center, axisX, axisY, axisZ, halfSizes) {
    return { center, axes: [axisX, axisY, axisZ], halfSizes };
}

function obbProjectionRadius(obb, axis) {
    return obb.axes.reduce((sum, boxAxis, index) => {
        const dot = Math.abs(boxAxis.x * axis.x + boxAxis.y * axis.y + boxAxis.z * axis.z);
        return sum + obb.halfSizes[index] * dot;
    }, 0);
}

function obbPenetration(obbA, obbB) {
    let penetration = Infinity;
    const axes = [...obbA.axes, ...obbB.axes];
    const centerDelta = {
        x: obbB.center.x - obbA.center.x,
        y: obbB.center.y - obbA.center.y,
        z: obbB.center.z - obbA.center.z
    };

    for (const axis of axes) {
        const length = Math.hypot(axis.x, axis.y, axis.z);
        if (length < 0.0001) continue;
        const normalized = { x: axis.x / length, y: axis.y / length, z: axis.z / length };
        const distance = Math.abs(centerDelta.x * normalized.x + centerDelta.y * normalized.y + centerDelta.z * normalized.z);
        const radius = obbProjectionRadius(obbA, normalized) + obbProjectionRadius(obbB, normalized);
        const overlap = radius - distance;
        if (overlap <= 0) return 0;
        penetration = Math.min(penetration, overlap);
    }

    return Number.isFinite(penetration) ? penetration : 0;
}

export class Cabinet {
    constructor(scene, params) {
        this.scene = scene;
        this.params = normalizeParams(params);

        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.panelMeshes = [];
        this.panelMeshById = new Map();
        this.fabricationPartRecords = [];
        this.fabricationAssemblySchedules = [];
        this.selectedPanelId = null;
        this.hiddenPanelIds = new Set();

        this.decals = {};
        this.canvasElements = {};
        this.canvasTextures = {};
        this.canvasRenderSignatures = {};

        this.showEdges = true;
        this.edgeColor = 0x8d8d86;
        this.onChange = null;

        this.build();
    }

    updateParams(newParams) {
        const mergedControls = newParams.controls
            ? {
                deck: { ...(this.params.controls?.deck || {}), ...(newParams.controls.deck || {}) },
                apron: { ...(this.params.controls?.apron || {}), ...(newParams.controls.apron || {}) }
            }
            : this.params.controls;

        this.params = normalizeParams({
            ...this.params,
            ...newParams,
            controls: mergedControls,
            componentOverrides: newParams.componentOverrides ?? this.params.componentOverrides
        });
        this.build();
    }

    resolveComponentOverride(panelId) {
        const overrides = this.params.componentOverrides || {};
        return {
            ...DEFAULT_COMPONENT_OVERRIDE,
            ...(overrides[panelId] || {})
        };
    }

    updateComponentOverride(panelId, key, value) {
        if (!panelId || !NUMERIC_COMPONENT_OVERRIDE_KEYS.includes(key)) return;

        const overrides = cloneParams(this.params.componentOverrides || {});
        const next = {
            ...DEFAULT_COMPONENT_OVERRIDE,
            ...(overrides[panelId] || {}),
            [key]: Number(value) || 0
        };

        next.color = sanitizePaletteColor(next.color);
        const isZeroed = NUMERIC_COMPONENT_OVERRIDE_KEYS.every(k => Number(next[k]) === 0)
            && next.color === DEFAULT_PANEL_COLOR;
        if (isZeroed) {
            delete overrides[panelId];
        } else {
            overrides[panelId] = next;
        }

        this.params.componentOverrides = overrides;
        this.build();
    }

    updateComponentColor(panelId, color) {
        if (!panelId) return;

        const overrides = cloneParams(this.params.componentOverrides || {});
        const next = {
            ...DEFAULT_COMPONENT_OVERRIDE,
            ...(overrides[panelId] || {}),
            color: sanitizePaletteColor(color)
        };

        const isDefault = NUMERIC_COMPONENT_OVERRIDE_KEYS.every(k => Number(next[k]) === 0)
            && next.color === DEFAULT_PANEL_COLOR;
        if (isDefault) {
            delete overrides[panelId];
        } else {
            overrides[panelId] = next;
        }

        this.params.componentOverrides = overrides;
        this.build();
    }

    resetComponentOverride(panelId) {
        if (!panelId) return;
        const overrides = cloneParams(this.params.componentOverrides || {});
        delete overrides[panelId];
        this.params.componentOverrides = overrides;
        this.build();
    }

    updateFastenerGroupOverride(panelIds, patch = null) {
        const ids = Array.isArray(panelIds) ? panelIds : [panelIds];
        const overrides = cloneParams(this.params.fastenerGroupOverrides || {});
        ids.filter(Boolean).forEach(panelId => {
            if (!patch) {
                delete overrides[panelId];
                return;
            }
            const next = normalizeFastenerOverrideMap({
                [panelId]: { ...(overrides[panelId] || {}), ...patch }
            })[panelId];
            if (next && Object.keys(next).length) overrides[panelId] = next;
            else delete overrides[panelId];
        });
        this.params.fastenerGroupOverrides = overrides;
        this.build();
    }

    updateFastenerOverride(fastenerId, patch = null) {
        if (!fastenerId) return;
        const overrides = cloneParams(this.params.fastenerOverrides || {});
        if (!patch) {
            delete overrides[fastenerId];
        } else {
            const next = normalizeFastenerOverrideMap({
                [fastenerId]: { ...(overrides[fastenerId] || {}), ...patch }
            })[fastenerId];
            if (next && Object.keys(next).length) overrides[fastenerId] = next;
            else delete overrides[fastenerId];
        }
        this.params.fastenerOverrides = overrides;
        this.build();
    }

    resolveFastenerSpec(panelId, baseSpec, sourcePanelId = null, fastenerId = null) {
        let spec = applyFastenerSpecOverride(
            baseSpec,
            this.params.fastenerGroupOverrides?.[panelId] || {},
            this.getEffectiveThickness(panelId)
        );
        if (sourcePanelId && sourcePanelId !== panelId) {
            spec = applyFastenerSpecOverride(
                spec,
                this.params.fastenerGroupOverrides?.[sourcePanelId] || {},
                this.getEffectiveThickness(panelId)
            );
        }
        if (fastenerId) {
            spec = applyFastenerSpecOverride(
                spec,
                this.params.fastenerOverrides?.[fastenerId] || {},
                this.getEffectiveThickness(panelId)
            );
        }
        return spec;
    }

    getEffectiveThickness(panelId) {
        const override = this.resolveComponentOverride(panelId);
        return Math.max(3, numberOr(this.params.thickness, 18) + override.thicknessDelta);
    }

    getPanelById(panelId) {
        return this.panelMeshById.get(panelId) || null;
    }

    getBuildGeometry(key, factory) {
        const cached = this.buildGeometryCache?.get(key);
        if (cached) return cached;
        const geometry = factory();
        this.buildGeometryCache?.set(key, geometry);
        return geometry;
    }

    isPanelVisible(panelId) {
        return !this.hiddenPanelIds.has(panelId);
    }

    isPanelIncluded(panelId) {
        return this.params.fabricationInclusion?.[panelId] !== false;
    }

    setPanelIncluded(panelId, included) {
        if (!panelId) return;
        this.params.fabricationInclusion = {
            ...(this.params.fabricationInclusion || {}),
            [panelId]: included !== false
        };
    }

    togglePanelIncluded(panelId) {
        const included = !this.isPanelIncluded(panelId);
        this.setPanelIncluded(panelId, included);
        return included;
    }

    getFabricationManifest() {
        return createFabricationManifest(buildFabricationSourceFromCabinet(this));
    }

    getPreflightResults(options = {}) {
        return runPreflight(this.getFabricationManifest(), options);
    }

    setPanelVisibility(panelId, visible) {
        if (!panelId) return;

        const nextVisible = visible !== false;
        if (this.isPanelVisible(panelId) === nextVisible) return;

        if (nextVisible) {
            this.hiddenPanelIds.delete(panelId);
        } else {
            this.hiddenPanelIds.add(panelId);
        }

        const mesh = this.getPanelById(panelId);
        if (mesh) mesh.visible = nextVisible;
        this.onChange?.();
    }

    togglePanelVisibility(panelId) {
        const nextVisible = !this.isPanelVisible(panelId);
        this.setPanelVisibility(panelId, nextVisible);
        return nextVisible;
    }

    setEdgeVisibility(visible) {
        this.showEdges = visible;
        this.panelMeshes.forEach(mesh => {
            if (mesh.userData.edges) {
                mesh.userData.edges.visible = visible || mesh.userData.id === this.selectedPanelId;
            }
        });
        this.onChange?.();
    }

    getProfilePoints() {
        const H = numberOr(this.params.height, 1700);
        const D = numberOr(this.params.depth, 600);
        const CP_H = numberOr(this.params.cpHeight, 950);
        const CP_A = numberOr(this.params.cpAngle, 5) * Math.PI / 180;
        const M_H = numberOr(this.params.marqueeHeight, 180);
        const cpDepth = numberOr(this.params.cpDepth, 280);
        const cpOverhang = numberOr(this.params.cpOverhang, 0);
        const toeKickHeight = numberOr(this.params.toeKickHeight, 55);
        const toeKickInset = numberOr(this.params.toeKickInset, 70);
        const frontApronDrop = numberOr(this.params.frontApronDrop, 125);
        const monitorAngle = clamp(Math.abs(numberOr(this.params.monitorAngle, 15)), 0, 45) * Math.PI / 180;
        const bezelDepth = numberOr(this.params.bezelDepth, 100);
        const screenPanelHeight = numberOr(this.params.screenHeight, 270) + numberOr(this.params.screenBezelMargin, 35) * 2;
        const marqueeDepth = numberOr(this.params.marqueeDepth, 220);
        const marqueeFaceInset = numberOr(this.params.marqueeFaceInset, 50);
        const marqueeLean = numberOr(this.params.marqueeLean, 20);
        const T = numberOr(this.params.thickness, 18);
        const minJoint = Math.max(24, T * 2);

        const yBottom = 0;
        const yToe = clamp(toeKickHeight, minJoint, Math.max(minJoint + 10, H * 0.22));
        const yApron = Math.max(yToe + minJoint, CP_H - frontApronDrop);
        const yCpFront = Math.max(yApron + minJoint, CP_H);
        const yCpBack = yCpFront + cpDepth * Math.sin(CP_A);
        const yBezelTop = Math.max(yCpBack + screenPanelHeight, H - M_H - 70);
        const yMarqueeBottom = Math.max(yBezelTop + minJoint, H - M_H);
        const yMarqueeFront = Math.max(yMarqueeBottom + minJoint, H - minJoint);
        const yMarqueeTop = Math.max(yMarqueeFront + minJoint, H);

        const xBack = 0;
        const xToe = Math.max(minJoint, D - toeKickInset);
        const xCpFront = Math.max(120, D + cpOverhang);
        const xCpBack = Math.max(minJoint * 1.5, xCpFront - cpDepth * Math.cos(CP_A));
        const monitorRise = Math.max(1, yBezelTop - yCpBack);
        const monitorRun = monitorRise * Math.tan(monitorAngle);
        const xBezelTop = Math.max(minJoint, xCpBack - Math.max(bezelDepth, monitorRun));
        const xMarqueeBottom = Math.max(xBezelTop + minJoint, D - marqueeFaceInset);
        const xMarqueeFront = Math.max(xMarqueeBottom + minJoint, D - Math.max(0, marqueeFaceInset - marqueeLean));
        const xMarqueeTop = Math.max(minJoint, D - marqueeDepth);

        return {
            back_bottom: { x: xBack, y: yBottom },
            back_top: { x: xBack, y: yMarqueeTop },
            marquee_top: { x: xMarqueeTop, y: yMarqueeTop },
            marquee_front: { x: xMarqueeFront, y: yMarqueeFront },
            marquee_bottom: { x: xMarqueeBottom, y: yMarqueeBottom },
            bezel_top: { x: xBezelTop, y: yBezelTop },
            cp_back: { x: xCpBack, y: yCpBack },
            cp_front: { x: xCpFront, y: yCpFront },
            cp_apron: { x: xCpFront, y: yApron },
            toe_kick: { x: xToe, y: yToe },
            bottom_front: { x: xToe, y: yBottom }
        };
    }

    getProfilePointList(points = this.getProfilePoints()) {
        return [
            points.back_bottom,
            points.back_top,
            points.marquee_top,
            points.marquee_front,
            points.marquee_bottom,
            points.bezel_top,
            points.cp_back,
            points.cp_front,
            points.cp_apron,
            points.toe_kick,
            points.bottom_front
        ];
    }

    getStructuralParts(points) {
        const parts = [];
        const T = numberOr(this.params.thickness, 18);
        const profilePoints = this.getProfilePointList(points);
        let controlSupport = null;
        const controlSupportEnabled = boolParam(
            this.params.controlSupportEnabled,
            DEFAULT_STRUCTURE_SCHEMA.controlSupportEnabled
        );
        const profileSupportsEnabled = controlSupportEnabled && boolParam(
            this.params.controlRiserEnabled,
            DEFAULT_STRUCTURE_SCHEMA.controlRiserEnabled
        );
        const profileSupportCount = clamp(Math.round(numberOr(
            this.params.controlProfileSupportCount,
            DEFAULT_STRUCTURE_SCHEMA.controlProfileSupportCount
        )), 1, 2);
        const profileSupportIds = profileSupportsEnabled
            ? Array.from(
                { length: profileSupportCount },
                (_, index) => index === 0 ? 'panel_control_riser' : `panel_control_riser_${index + 1}`
            )
            : [];
        const displaySupportEnabled = boolParam(
            this.params.displaySupportEnabled,
            DEFAULT_STRUCTURE_SCHEMA.displaySupportEnabled
        );

        const createHorizontalProfileSupport = ({
            id,
            name,
            role,
            y,
            faceDir = 'top',
            thickness = T,
            matingPanelIds = []
        }) => {
            const innerSpan = horizontalProfileSpan(profilePoints, y);
            const outwardY = y + (faceDir === 'bottom' ? -thickness : thickness);
            const outerSpan = horizontalProfileSpan(profilePoints, outwardY);
            if (!innerSpan || innerSpan.maxX - innerSpan.minX < thickness * 1.1) return null;

            return {
                id,
                name,
                role,
                p1: { x: innerSpan.minX, y },
                p2: { x: innerSpan.maxX, y },
                outerP1: {
                    x: outerSpan?.minX ?? innerSpan.minX,
                    y: outwardY
                },
                outerP2: {
                    x: outerSpan?.maxX ?? innerSpan.maxX,
                    y: outwardY
                },
                faceDir,
                isStructural: true,
                profileFitted: true,
                matingPanelIds
            };
        };

        if (controlSupportEnabled) {
            const supportThickness = this.getEffectiveThickness('panel_cp_support');
            controlSupport = createHorizontalProfileSupport({
                id: 'panel_cp_support',
                name: 'Control Deck Support',
                role: 'Full-depth transverse brace seated flush below the control-panel apron',
                y: points.cp_apron.y,
                faceDir: 'bottom',
                thickness: supportThickness,
                matingPanelIds: [
                    'side_left',
                    'side_right',
                    'panel_back',
                    'panel_apron',
                    'panel_kick',
                    ...profileSupportIds
                ]
            });
            if (controlSupport) parts.push(controlSupport);
        }

        if (controlSupport && profileSupportsEnabled) {
            for (let index = 0; index < profileSupportCount; index++) {
                const id = index === 0 ? 'panel_control_riser' : `panel_control_riser_${index + 1}`;
                parts.push({
                    id,
                    name: profileSupportCount === 1 ? 'Control Profile Support' : `Control Profile Support ${index + 1}`,
                    role: 'Continuous full-height cabinet-profile spine with slots for transverse panels',
                    geometryKind: 'profile_rib',
                    ribIndex: index,
                    ribCount: profileSupportCount,
                    isStructural: true,
                    matingPanelIds: [
                        'panel_back',
                        'panel_bottom',
                        'panel_top',
                        'panel_marq_top',
                        'panel_marquee',
                        'panel_recess',
                        'panel_bezel',
                        'panel_cp',
                        'panel_apron',
                        'panel_kick',
                        'panel_toe',
                        'panel_cp_support',
                        ...(displaySupportEnabled ? ['panel_display_support'] : []),
                        ...(boolParam(this.params.headerSupportEnabled, DEFAULT_STRUCTURE_SCHEMA.headerSupportEnabled)
                            ? ['panel_header_support']
                            : []),
                        ...(boolParam(this.params.machineShelfEnabled, DEFAULT_STRUCTURE_SCHEMA.machineShelfEnabled)
                            ? ['panel_machine_shelf']
                            : [])
                    ]
                });
            }
        }

        if (displaySupportEnabled) {
            const displaySupport = createHorizontalProfileSupport({
                id: 'panel_display_support',
                name: 'Display Bottom Support',
                role: 'Rear ledge mitred flush to the bottom of the display panel and tied into the back panel',
                y: points.cp_back.y,
                faceDir: 'top',
                thickness: this.getEffectiveThickness('panel_display_support'),
                matingPanelIds: ['side_left', 'side_right', 'panel_back', 'panel_bezel', 'panel_cp', ...profileSupportIds]
            });
            if (displaySupport) parts.push(displaySupport);
        }

        if (boolParam(this.params.headerSupportEnabled, DEFAULT_STRUCTURE_SCHEMA.headerSupportEnabled)) {
            const supportThickness = this.getEffectiveThickness('panel_header_support');
            const headerSupport = createHorizontalProfileSupport({
                id: 'panel_header_support',
                name: 'Header Support',
                role: 'Profile-fitted wedge brace seated in the recess above the display',
                y: points.bezel_top.y,
                faceDir: 'top',
                thickness: supportThickness,
                matingPanelIds: ['side_left', 'side_right', 'panel_back', 'panel_recess', 'panel_bezel']
            });
            if (headerSupport) parts.push(headerSupport);
        }

        if (boolParam(this.params.machineShelfEnabled, DEFAULT_STRUCTURE_SCHEMA.machineShelfEnabled)) {
            const supportThickness = this.getEffectiveThickness('panel_machine_shelf');
            const shelfHeight = clamp(
                numberOr(this.params.machineShelfHeight, DEFAULT_STRUCTURE_SCHEMA.machineShelfHeight),
                T * 2,
                Math.max(T * 3, points.cp_apron.y - supportThickness * 2)
            );
            const machineShelf = createHorizontalProfileSupport({
                id: 'panel_machine_shelf',
                name: 'Raised Machine Shelf',
                role: 'Full-depth raised platform for PC or electronics tied into the cabinet shell',
                y: shelfHeight,
                faceDir: 'top',
                thickness: supportThickness,
                matingPanelIds: ['side_left', 'side_right', 'panel_back', 'panel_kick', 'panel_toe']
            });
            if (machineShelf) parts.push(machineShelf);
        }

        return parts;
    }

    getPanelMaterial(panelId, width, height, isSidePanel = false) {
        const canvasId = `${panelId}_canvas`;
        this.activeCanvasTextureIds?.add(canvasId);
        const canvasWidth = Math.max(256, Math.min(2048, Math.round(width)));
        const canvasHeight = Math.max(256, Math.min(2048, Math.round(height)));
        const selected = panelId === this.selectedPanelId;
        const baseColor = this.resolveComponentOverride(panelId).color || DEFAULT_PANEL_COLOR;
        const panelDecals = this.decals[panelId] || [];
        const renderSignature = JSON.stringify([
            canvasWidth,
            canvasHeight,
            baseColor,
            selected,
            isSidePanel && panelId === 'side_right',
            panelDecals.map(decal => [
                decal.id,
                decal.imageSrc,
                decal.x,
                decal.y,
                decal.scale,
                decal.rotation,
                decal.imageElement?.complete === true,
                decal.imageElement?.width || 0,
                decal.imageElement?.height || 0
            ])
        ]);

        let canvas = this.canvasElements[canvasId];
        let texture = this.canvasTextures[canvasId];
        let needsRender = this.canvasRenderSignatures[canvasId] !== renderSignature;

        if (!canvas) {
            canvas = document.createElement('canvas');
            this.canvasElements[canvasId] = canvas;
            needsRender = true;
        }

        if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            if (texture) texture.dispose();
            texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            this.canvasTextures[canvasId] = texture;
            needsRender = true;
        } else if (!texture) {
            texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            this.canvasTextures[canvasId] = texture;
            needsRender = true;
        }

        if (needsRender) {
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = baseColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (selected) {
                ctx.fillStyle = 'rgba(255,239,114,0.74)';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            ctx.strokeStyle = selected ? 'rgba(20,20,20,0.20)' : 'rgba(20,20,20,0.075)';
            ctx.lineWidth = selected ? 2 : 1;
            const gridSize = 40;
            for (let x = 0; x < canvas.width; x += gridSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
            for (let y = 0; y < canvas.height; y += gridSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }

            if (selected) {
                ctx.strokeStyle = 'rgba(20,20,20,0.16)';
                ctx.lineWidth = 1;
                for (let x = -canvas.height; x < canvas.width; x += 26) {
                    ctx.beginPath();
                    ctx.moveTo(x, canvas.height);
                    ctx.lineTo(x + canvas.height, 0);
                    ctx.stroke();
                }
            }

            panelDecals.forEach(decal => {
                if (decal.imageElement && decal.imageElement.complete) {
                    ctx.save();

                    const cx = canvas.width / 2 + (decal.x / 100) * (canvas.width / 2);
                    const cy = canvas.height / 2 + (decal.y / 100) * (canvas.height / 2);
                    const w = (decal.scale / 100) * canvas.width * 0.5;
                    const h = w * (decal.imageElement.height / decal.imageElement.width);

                    ctx.translate(cx, cy);
                    ctx.rotate(decal.rotation * Math.PI / 180);

                    if (isSidePanel && panelId === 'side_right') {
                        ctx.scale(-1, 1);
                    }

                    ctx.drawImage(decal.imageElement, -w / 2, -h / 2, w, h);
                    ctx.restore();
                }
            });

            texture.needsUpdate = true;
            this.canvasRenderSignatures[canvasId] = renderSignature;
        }

        const surfaceColor = selected ? 0xffef72 : new THREE.Color(baseColor).getHex();
        const mainMat = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xffffff,
            side: THREE.DoubleSide
        });

        const edgeMat = new THREE.MeshBasicMaterial({
            color: surfaceColor,
            side: THREE.DoubleSide
        });

        return { mainMat, edgeMat };
    }

    getHardwareLayout(panelId, panelLength, panelWidth) {
        return this.getHardwareLayoutInfo(panelId, panelLength, panelWidth).items;
    }

    getHardwareLayoutInfo(panelId, panelLength, panelWidth) {
        const controls = normalizeControlSchema(this.params.controls || {});
        if (panelId === 'panel_cp' && controls.deck.enabled) {
            return this.getDeckHardwareLayout(controls.deck, panelLength, panelWidth);
        }

        if (panelId === 'panel_apron' && controls.apron.enabled) {
            return this.getApronHardwareLayout(controls.apron, panelLength, panelWidth);
        }

        return { items: [], warnings: [], adjusted: false };
    }

    applyControlLayoutFitSuggestion(panelId = 'panel_cp') {
        const panel = this.getPanelById(panelId);
        if (!panel) return false;
        const panelLength = panel.userData.lengthMm ?? panel.userData.length;
        const panelWidth = panel.userData.widthMm ?? panel.userData.width;
        const info = this.getHardwareLayoutInfo(panelId, panelLength, panelWidth);
        if (!info.fitSuggestion?.items?.length) return false;

        const controlPath = panelId === 'panel_apron' ? 'apron' : 'deck';
        const controls = normalizeControlSchema(this.params.controls || {});
        const config = controls[controlPath];
        config.fittedLayout = {
            sourceSignature: controlFitSignature(config),
            panelLengthMm: panelLength,
            panelWidthMm: panelWidth,
            items: cloneParams(info.fitSuggestion.items)
        };
        this.params.controls = controls;
        this.build();
        return true;
    }

    getScreenLayout(panelLength, panelWidth) {
        const margin = numberOr(this.params.screenBezelMargin, 35);
        const screenW = Math.min(Math.max(40, panelWidth - margin * 2), numberOr(this.params.screenWidth, 470));
        const screenH = Math.min(Math.max(40, panelLength - margin * 2), numberOr(this.params.screenHeight, 270));
        return {
            xMm: panelLength / 2,
            yMm: panelWidth / 2,
            widthMm: screenW,
            heightMm: screenH
        };
    }

    getScreenFrameLayout(panelLength, panelWidth) {
        if (!boolParam(this.params.screenFrameEnabled, DEFAULT_STRUCTURE_SCHEMA.screenFrameEnabled)) return null;

        const screen = this.getScreenLayout(panelLength, panelWidth);
        const bezel = clamp(numberOr(this.params.screenFrameBezel, DEFAULT_STRUCTURE_SCHEMA.screenFrameBezel), 4, 120);
        const clearance = clamp(numberOr(this.params.screenFrameClearance, DEFAULT_STRUCTURE_SCHEMA.screenFrameClearance), 0, 60);
        const depth = clamp(numberOr(this.params.screenFrameDepth, DEFAULT_STRUCTURE_SCHEMA.screenFrameDepth), 1, 50);
        const outerWidth = Math.min(panelWidth - 4, screen.widthMm + (bezel + clearance) * 2);
        const outerHeight = Math.min(panelLength - 4, screen.heightMm + (bezel + clearance) * 2);
        const innerWidth = Math.max(20, outerWidth - bezel * 2);
        const innerHeight = Math.max(20, outerHeight - bezel * 2);

        return {
            ...screen,
            assemblyId: FABRICATION_ASSEMBLY_IDS.screenFrame,
            partIds: [
                FABRICATION_ASSEMBLY_PART_IDS.screenFrameTop,
                FABRICATION_ASSEMBLY_PART_IDS.screenFrameBottom,
                FABRICATION_ASSEMBLY_PART_IDS.screenFrameLeft,
                FABRICATION_ASSEMBLY_PART_IDS.screenFrameRight
            ],
            bezelMm: bezel,
            clearanceMm: clearance,
            depthMm: depth,
            outerWidthMm: outerWidth,
            outerHeightMm: outerHeight,
            innerWidthMm: innerWidth,
            innerHeightMm: innerHeight
        };
    }

    getPanelCutouts(panelId, panelLength, panelWidth) {
        const cutouts = [];
        const addCablePort = (label, widthValue, heightValue, offsetValue = 0, id = null) => {
            const widthMm = clamp(numberOr(widthValue, 80), 20, Math.max(20, panelWidth - 16));
            const heightMm = clamp(numberOr(heightValue, 40), 18, Math.max(18, panelLength - 16));
            const maxOffset = Math.max(0, (panelWidth - widthMm) / 2 - 8);
            cutouts.push({
                ...(id ? { id } : {}),
                kind: 'cable_port',
                label,
                xMm: panelLength / 2,
                yMm: panelWidth / 2 + clamp(numberOr(offsetValue, 0), -maxOffset, maxOffset),
                widthMm,
                heightMm,
                color: '#376f9f'
            });
        };

        if (panelId === 'panel_bezel') {
            const screen = this.getScreenLayout(panelLength, panelWidth);
            const widthMm = clamp(numberOr(this.params.monitorCablePortWidth, DEFAULT_STRUCTURE_SCHEMA.monitorCablePortWidth), 20, Math.max(20, panelWidth * 0.8));
            const heightMm = clamp(numberOr(this.params.monitorCablePortHeight, DEFAULT_STRUCTURE_SCHEMA.monitorCablePortHeight), 18, Math.max(18, panelLength * 0.35));
            const belowScreen = screen.xMm + screen.heightMm / 2 + heightMm / 2 + Math.max(12, numberOr(this.params.thickness, 18));
            cutouts.push({
                kind: 'cable_port',
                label: 'MONITOR CABLE',
                xMm: clamp(belowScreen, heightMm / 2 + 8, panelLength - heightMm / 2 - 8),
                yMm: panelWidth / 2,
                widthMm,
                heightMm,
                color: '#376f9f'
            });
        }

        if (panelId === 'panel_cp_support') {
            addCablePort(
                'CONTROL CABLE',
                this.params.controlCablePortWidth,
                this.params.controlCablePortHeight,
                this.params.controlCablePortOffset,
                'control-support-cable-port'
            );
        }

        if (panelId === 'panel_control_riser' || panelId.startsWith('panel_control_riser_')) {
            addCablePort(
                'PROFILE SUPPORT CABLE',
                this.params.controlRiserCablePortWidth,
                this.params.controlRiserCablePortHeight,
                this.params.controlRiserCablePortOffset,
                panelId === 'panel_control_riser'
                    ? 'control-riser-cable-port'
                    : `control-riser-cable-port-${panelId.slice('panel_control_riser_'.length)}`
            );
        }

        if (panelId === 'panel_display_support') {
            addCablePort(
                'DISPLAY CABLE',
                this.params.displayCablePortWidth,
                this.params.displayCablePortHeight,
                this.params.displayCablePortOffset,
                'display-support-cable-port'
            );
        }

        if (panelId === 'panel_header_support') {
            addCablePort(
                'DISPLAY CABLE',
                this.params.monitorCablePortWidth,
                this.params.monitorCablePortHeight,
                this.params.monitorCablePortOffset,
                'header-support-cable-port'
            );
        }

        if (panelId === 'panel_machine_shelf') {
            addCablePort(
                'MACHINE CABLE',
                this.params.machineCablePortWidth,
                this.params.machineCablePortHeight,
                this.params.machineCablePortOffset,
                'machine-shelf-cable-port'
            );
        }

        if (panelId === 'panel_back' && boolParam(this.params.backDoorEnabled, DEFAULT_STRUCTURE_SCHEMA.backDoorEnabled)) {
            const widthMm = clamp(numberOr(this.params.backDoorWidth, DEFAULT_STRUCTURE_SCHEMA.backDoorWidth), 80, Math.max(80, panelWidth - 24));
            const heightMm = clamp(numberOr(this.params.backDoorHeight, DEFAULT_STRUCTURE_SCHEMA.backDoorHeight), 120, Math.max(120, panelLength * 0.75));
            const bottomOffset = clamp(numberOr(this.params.backDoorBottomOffset, DEFAULT_STRUCTURE_SCHEMA.backDoorBottomOffset), 0, Math.max(0, panelLength - heightMm - 12));
            cutouts.push({
                id: 'rear-service-door-opening',
                kind: 'service_door',
                label: 'REAR DOOR',
                assemblyId: FABRICATION_ASSEMBLY_IDS.rearServiceDoor,
                matingPartId: FABRICATION_ASSEMBLY_PART_IDS.rearServiceDoor,
                clearancePerSideMm: SERVICE_DOOR_CLEARANCE_PER_SIDE_MM,
                xMm: bottomOffset + heightMm / 2,
                yMm: panelWidth / 2,
                widthMm,
                heightMm,
                color: '#55554f'
            });
        }

        return cutouts;
    }

    createFabricationAssemblyRecords() {
        return createCabinetAssemblyFabricationRecords({
            parts: this.fabricationPartRecords,
            defaultThicknessMm: numberOr(this.params.thickness, 18),
            isIncluded: partId => this.isPanelIncluded(partId),
            isVisible: partId => this.isPanelVisible(partId)
        });
    }

    getDeckHardwareLayout(config, panelLength, panelWidth) {
        const fittedLayout = config.fittedLayout;
        if (fittedLayout?.sourceSignature === controlFitSignature(config)
            && Math.abs(numberOr(fittedLayout.panelLengthMm, -1) - panelLength) < 0.01
            && Math.abs(numberOr(fittedLayout.panelWidthMm, -1) - panelWidth) < 0.01
            && Array.isArray(fittedLayout.items)) {
            return analyzeHardwareItemsFit(
                cloneParams(fittedLayout.items),
                panelLength,
                panelWidth,
                Math.max(8, numberOr(this.params.thickness, 18) * 0.75)
            );
        }

        const items = [];
        const players = clamp(Math.round(numberOr(config.players, 2)), 1, 4);
        const buttonsPerPlayer = clamp(Math.round(numberOr(config.buttonsPerPlayer, 6)), 1, 8);
        const rows = clamp(Math.round(numberOr(config.buttonRows, 2)), 1, 3);
        const legacySpacing = numberOr(config.buttonSpacing, 42);
        const spacingX = clamp(numberOr(config.buttonSpacingX, legacySpacing), 20, 90);
        const spacingY = clamp(numberOr(config.buttonSpacingY, legacySpacing), 20, 90);
        const groupSpacing = clamp(numberOr(config.groupSpacing, 235), 80, 420);
        const groupRotation = clamp(numberOr(config.groupRotation, 0), -35, 35);
        const joystickGap = clamp(numberOr(config.joystickGap, 72), 36, 150);
        const buttonRadius = clamp(numberOr(config.buttonDiameter, 30), 18, 44) / 2;
        const joystickRadius = clamp(numberOr(config.joystickDiameter, 38), 22, 58) / 2;
        const deckX = clamp(numberOr(config.deckX, 0), -panelLength * 0.34, panelLength * 0.34);
        const deckY = clamp(numberOr(config.deckY, 0), -panelWidth * 0.25, panelWidth * 0.25);
        const labelList = parseLabels(config.labels);
        const centerX = panelLength / 2 + deckX;
        const centerY = panelWidth / 2 + deckY;
        const layoutStyle = sanitizeControlChoice(config.layoutStyle, ['grid', 'staggered', 'vee', 'custom'], DEFAULT_CONTROL_SCHEMA.deck.layoutStyle);
        const groupOrientation = sanitizeControlChoice(config.groupOrientation, ['across', 'frontBack'], DEFAULT_CONTROL_SCHEMA.deck.groupOrientation);
        const customLayout = normalizeCustomLayout(config.customLayout);
        const cols = Math.ceil(buttonsPerPlayer / rows);
        const baseParts = [];

        const addGeneratedLayout = () => {
            if (config.joystickEnabled) {
                baseParts.push({
                    kind: 'joystick',
                    x: 0,
                    y: joystickGap,
                    radiusMm: joystickRadius,
                    color: sanitizePaletteColor(config.joystickColor),
                    hardwareDefinitionId: config.joystickDefinitionId || 'joystick-jlf-pattern',
                    labelBase: 'J'
                });
            }

            for (let button = 0; button < buttonsPerPlayer; button++) {
                const row = button % rows;
                const col = Math.floor(button / rows);
                let localX = (row - (rows - 1) / 2) * spacingY;
                let localY = -col * spacingX;

                if (layoutStyle === 'staggered') {
                    localY -= (row % 2) * spacingX * 0.35;
                } else if (layoutStyle === 'vee') {
                    const colBias = col - (cols - 1) / 2;
                    const rowDirection = rows === 1 ? 0 : (row < (rows - 1) / 2 ? 1 : -1);
                    localX += colBias * spacingY * 0.24 * rowDirection;
                }

                baseParts.push({
                    kind: 'button',
                    x: localX,
                    y: localY,
                    radiusMm: buttonRadius,
                    color: sanitizePaletteColor(config.buttonColor),
                    hardwareDefinitionId: config.buttonDefinitionId || 'button-30-snap',
                    labelBase: labelList[button] || `B${button + 1}`
                });
            }
        };

        if (layoutStyle === 'custom' && customLayout.length) {
            customLayout.forEach(item => {
                if (item.kind === 'joystick') {
                    if (!config.joystickEnabled) return;
                    baseParts.push({
                        kind: 'joystick',
                        x: item.y,
                        y: item.x,
                        radiusMm: joystickRadius,
                        color: sanitizePaletteColor(config.joystickColor),
                        hardwareDefinitionId: config.joystickDefinitionId || 'joystick-jlf-pattern',
                        labelBase: 'J'
                    });
                    return;
                }

                if (item.buttonIndex >= buttonsPerPlayer) return;
                baseParts.push({
                    kind: 'button',
                    x: item.y,
                    y: item.x,
                    radiusMm: buttonRadius,
                    color: sanitizePaletteColor(config.buttonColor),
                    hardwareDefinitionId: config.buttonDefinitionId || 'button-30-snap',
                    labelBase: labelList[item.buttonIndex] || `B${item.buttonIndex + 1}`
                });
            });
        }

        if (!baseParts.length) {
            addGeneratedLayout();
        }

        const minLocalX = Math.min(...baseParts.map(part => part.x - part.radiusMm));
        const maxLocalX = Math.max(...baseParts.map(part => part.x + part.radiusMm));
        const minLocalY = Math.min(...baseParts.map(part => part.y - part.radiusMm));
        const maxLocalY = Math.max(...baseParts.map(part => part.y + part.radiusMm));
        const localCenterX = (minLocalX + maxLocalX) / 2;
        const localCenterY = (minLocalY + maxLocalY) / 2;

        for (let player = 0; player < players; player++) {
            const playerOffset = (player - (players - 1) / 2) * groupSpacing;
            const groupX = centerX + (groupOrientation === 'frontBack' ? playerOffset : 0);
            const groupY = centerY + (groupOrientation === 'across' ? playerOffset : 0);

            baseParts.forEach(part => {
                const rotated = rotateLocalPoint(part.x - localCenterX, part.y - localCenterY, groupRotation);
                items.push({
                    kind: part.kind,
                    xMm: groupX + rotated.x,
                    yMm: groupY + rotated.y,
                    radiusMm: part.radiusMm,
                    color: part.color,
                    hardwareDefinitionId: part.hardwareDefinitionId,
                    label: config.showLabels ? `P${player + 1} ${part.labelBase}` : '',
                    panelId: 'panel_cp'
                });
            });
        }

        return analyzeHardwareItemsFit(items, panelLength, panelWidth, Math.max(8, numberOr(this.params.thickness, 18) * 0.75));
    }

    getApronHardwareLayout(config, panelLength, panelWidth) {
        const fittedLayout = config.fittedLayout;
        if (fittedLayout?.sourceSignature === controlFitSignature(config)
            && Math.abs(numberOr(fittedLayout.panelLengthMm, -1) - panelLength) < 0.01
            && Math.abs(numberOr(fittedLayout.panelWidthMm, -1) - panelWidth) < 0.01
            && Array.isArray(fittedLayout.items)) {
            return analyzeHardwareItemsFit(
                cloneParams(fittedLayout.items),
                panelLength,
                panelWidth,
                Math.max(8, numberOr(this.params.thickness, 18) * 0.75)
            );
        }

        const items = [];
        const buttons = clamp(Math.round(numberOr(config.buttons, 2)), 1, 4);
        const spacing = clamp(numberOr(config.buttonSpacing, 86), 36, 180);
        const radius = clamp(numberOr(config.buttonDiameter, 28), 16, 44) / 2;
        const xBase = panelLength / 2 + clamp(numberOr(config.apronX, 0), -panelLength * 0.35, panelLength * 0.35);
        const yBase = panelWidth / 2 + clamp(numberOr(config.apronY, 0), -panelWidth * 0.3, panelWidth * 0.3);
        const labelList = parseLabels(config.labels);
        const orientation = sanitizeControlChoice(config.orientation, ['horizontal', 'vertical'], DEFAULT_CONTROL_SCHEMA.apron.orientation);

        for (let index = 0; index < buttons; index++) {
            const offset = (index - (buttons - 1) / 2) * spacing;
            items.push({
                kind: 'start',
                xMm: xBase + (orientation === 'vertical' ? offset : 0),
                yMm: yBase + (orientation === 'horizontal' ? offset : 0),
                radiusMm: radius,
                color: sanitizePaletteColor(config.buttonColor),
                hardwareDefinitionId: config.buttonDefinitionId || 'button-24-snap',
                label: config.showLabels ? (labelList[index] || `S${index + 1}`) : '',
                panelId: 'panel_apron'
            });
        }

        return analyzeHardwareItemsFit(items, panelLength, panelWidth, Math.max(8, numberOr(this.params.thickness, 18) * 0.75));
    }

    addDecal(panelId, imageSrc, onLoaded = null) {
        if (!this.decals[panelId]) {
            this.decals[panelId] = [];
        }

        const img = new Image();
        img.src = imageSrc;

        const decalId = 'decal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const decal = {
            id: decalId,
            imageSrc,
            imageElement: img,
            x: 0,
            y: 0,
            scale: 50,
            rotation: 0
        };

        this.decals[panelId].push(decal);

        img.onload = () => {
            this.build();
            if (onLoaded) onLoaded(decalId);
        };
    }

    deleteDecal(panelId, decalId) {
        if (this.decals[panelId]) {
            this.decals[panelId] = this.decals[panelId].filter(d => d.id !== decalId);
            this.build();
        }
    }

    getDecal(panelId, decalId) {
        if (!this.decals[panelId]) return null;
        return this.decals[panelId].find(d => d.id === decalId);
    }

    build() {
        const disposedGeometries = new Set();
        const disposedMaterials = new Set();
        while (this.group.children.length > 0) {
            const child = this.group.children[0];
            this.group.remove(child);
            disposeObject3D(child, disposedGeometries, disposedMaterials);
        }
        this.panelMeshes = [];
        this.panelMeshById = new Map();
        this.fabricationPartRecords = [];
        this.fabricationAssemblySchedules = [];
        this.activeCanvasTextureIds = new Set();
        this.buildGeometryCache = new Map();

        const points = this.getProfilePoints();
        const profilePointList = this.getProfilePointList(points);
        const W = numberOr(this.params.width, 650);
        const structuralThickness = numberOr(this.params.thickness, 18);
        const exp = (numberOr(this.params.exploded, 0)) / 100;
        const explodeDist = Math.max(220, Math.min(480, numberOr(this.params.height, 1700) * 0.22));
        const leftThickness = this.getEffectiveThickness('side_left');
        const rightThickness = this.getEffectiveThickness('side_right');
        const innerWidth = Math.max(50, W - leftThickness - rightThickness);
        const innerLeftZ = -W / 2 + leftThickness;
        const innerRightZ = W / 2 - rightThickness;
        const innerCenterZ = (innerLeftZ + innerRightZ) / 2;
        const fastenerSpec = getFastenerSpec(this.params, numberOr(this.params.thickness, 18));
        this.fabricationDiagnostics = {
            status: innerWidth > 0 ? 'OK' : 'CHECK',
            materialThickness: numberOr(this.params.thickness, 18),
            innerWidth,
            intersections: [],
            invalidIntersections: [],
            fastenerIssues: [],
            profileIssues: [],
            warnings: [],
            fasteners: 0,
            screwDiameter: fastenerSpec.diameterMm,
            screwLength: fastenerSpec.lengthMm,
            screwEdgeClearance: fastenerSpec.edgeClearanceMm,
            screwMinSpacing: fastenerSpec.minCenterSpacingMm
        };

        if (W - leftThickness - rightThickness <= 0) {
            this.fabricationDiagnostics.warnings.push('Side panels consume the full cabinet width.');
        }

        if (fastenerSpec.edgeClearanceMm < fastenerSpec.radiusMm) {
            this.fabricationDiagnostics.warnings.push('Screw edge clearance is smaller than the screw shaft radius.');
        }

        const rectRecords = [];
        const panelWarningsById = {};

        const addPanelWarning = (panelId, message) => {
            if (!panelWarningsById[panelId]) panelWarningsById[panelId] = [];
            if (!panelWarningsById[panelId].includes(message)) {
                panelWarningsById[panelId].push(message);
            }
            if (!this.fabricationDiagnostics.warnings.includes(message)) {
                this.fabricationDiagnostics.warnings.push(message);
            }
        };

        const shellParts = [
            { id: 'panel_back', name: 'Back Access Panel', role: 'Rear closure and service access', p1Name: 'back_bottom', p2Name: 'back_top', p1: points.back_bottom, p2: points.back_top, faceDir: 'back' },
            { id: 'panel_top', name: 'Top Roof Panel', role: 'Upper horizontal roof', p1Name: 'back_top', p2Name: 'marquee_top', p1: points.back_top, p2: points.marquee_top, faceDir: 'top' },
            { id: 'panel_marq_top', name: 'Marquee Top Face', role: 'Upper marquee cap', p1Name: 'marquee_top', p2Name: 'marquee_front', p1: points.marquee_top, p2: points.marquee_front, faceDir: 'front' },
            { id: 'panel_marquee', name: 'Marquee Graphic Face', role: 'Backlit marquee face', p1Name: 'marquee_front', p2Name: 'marquee_bottom', p1: points.marquee_front, p2: points.marquee_bottom, faceDir: 'front', acceptsArtwork: true },
            { id: 'panel_recess', name: 'Upper Cabinet Recess', role: 'Transition from marquee to monitor area', p1Name: 'marquee_bottom', p2Name: 'bezel_top', p1: points.marquee_bottom, p2: points.bezel_top, faceDir: 'bottom' },
            { id: 'panel_bezel', name: 'Monitor Bezel', role: 'Display surround and monitor aperture', p1Name: 'bezel_top', p2Name: 'cp_back', p1: points.bezel_top, p2: points.cp_back, faceDir: 'front', isBezel: true, acceptsArtwork: true },
            { id: 'panel_cp', name: 'Control Panel Deck', role: 'Player controls mounting surface', p1Name: 'cp_back', p2Name: 'cp_front', p1: points.cp_back, p2: points.cp_front, faceDir: 'top', acceptsArtwork: true },
            { id: 'panel_apron', name: 'Control Panel Apron', role: 'Front face below controls', p1Name: 'cp_front', p2Name: 'cp_apron', p1: points.cp_front, p2: points.cp_apron, faceDir: 'front', acceptsArtwork: true },
            { id: 'panel_kick', name: 'Front Kick Plate', role: 'Lower front cabinet face', p1Name: 'cp_apron', p2Name: 'toe_kick', p1: points.cp_apron, p2: points.toe_kick, faceDir: 'front', acceptsArtwork: true },
            { id: 'panel_toe', name: 'Toe Kick Panel', role: 'Setback toe-kick face', p1Name: 'toe_kick', p2Name: 'bottom_front', p1: points.toe_kick, p2: points.bottom_front, faceDir: 'front' },
            { id: 'panel_bottom', name: 'Bottom Floor Panel', role: 'Base floor panel', p1Name: 'bottom_front', p2Name: 'back_bottom', p1: points.bottom_front, p2: points.back_bottom, faceDir: 'top' }
        ];
        const structuralParts = this.getStructuralParts(points);
        const profileWebParts = structuralParts.filter(part => part.geometryKind === 'profile_rib');
        const transverseStructuralParts = structuralParts.filter(part => part.geometryKind !== 'profile_rib');
        const internalParts = [...shellParts, ...transverseStructuralParts];

        const segmentByPanelId = {};
        const jointSegmentsByPoint = {};
        internalParts.forEach(part => {
            const override = this.resolveComponentOverride(part.id);
            const segment = getPanelEdgeProfile(part, points);
            segment.override = override;
            segment.overrideOffset = Number(override.offset) || 0;
            segment.panelThickness = this.getEffectiveThickness(part.id);
            segmentByPanelId[part.id] = segment;

            if (!part.p1Name || !part.p2Name) return;
            [part.p1Name, part.p2Name].forEach(pointName => {
                if (!jointSegmentsByPoint[pointName]) jointSegmentsByPoint[pointName] = [];
                jointSegmentsByPoint[pointName].push(segment);
            });
        });

        const mitrePoints = {};
        Object.keys(jointSegmentsByPoint).forEach(pointName => {
            mitrePoints[pointName] = computeMitrePoint(pointName, jointSegmentsByPoint[pointName], points);
        });

        const jointMap = {};
        shellParts.forEach(part => {
            [part.p1Name, part.p2Name].forEach(pointName => {
                if (!jointMap[pointName]) jointMap[pointName] = [];
                jointMap[pointName].push(part.id);
            });
        });

        const jointsByPanel = {};
        Object.entries(jointMap).forEach(([pointName, panelIds]) => {
            if (panelIds.length < 2) return;
            const jointSegments = jointSegmentsByPoint[pointName] || [];
            const jointAngle = jointSegments.length >= 2 ? angleBetweenSegments(jointSegments[0], jointSegments[1]) : 0;
            const bottomButt = isBottomButtJoint(points[pointName]);
            const joint = {
                id: `joint:${pointName}`,
                pointName,
                panels: panelIds,
                partIds: panelIds,
                type: bottomButt ? 'butt seam' : describeJointType(jointAngle),
                allowanceMm: numberOr(this.params.thickness, 18),
                includedAngleDeg: jointAngle,
                // Compatibility only. Per-panel bevels below are authoritative,
                // especially when the two material thicknesses differ.
                cutAngleDeg: bottomButt ? 0 : jointAngle / 2,
                cuts: [],
                location: { x: points[pointName].x, y: points[pointName].y }
            };
            this.fabricationDiagnostics.intersections.push(joint);
            panelIds.forEach(panelId => {
                if (!jointsByPanel[panelId]) jointsByPanel[panelId] = [];
                jointsByPanel[panelId].push(joint);
            });
        });

        const mitredProfilesByPanelId = {};
        internalParts.forEach(part => {
            const segment = segmentByPanelId[part.id];
            mitredProfilesByPanelId[part.id] = part.isStructural
                ? buildSquarePanelProfile(segment, segment.panelThickness, segment.override.lengthDelta)
                : buildMitredPanelProfile(
                    segment,
                    panelJointCutPoint(segment, part.p1Name, points, mitrePoints),
                    panelJointCutPoint(segment, part.p2Name, points, mitrePoints),
                    segment.panelThickness,
                    segment.override.lengthDelta
                );
        });

        internalParts.forEach(part => {
            if (part.isStructural) return;
            const segment = segmentByPanelId[part.id];
            const guides = buildPanelMitreGuides(
                part,
                mitredProfilesByPanelId[part.id],
                segment.panelThickness,
                jointsByPanel[part.id] || []
            );
            guides.forEach(guide => {
                const joint = (jointsByPanel[part.id] || []).find(item => item.pointName === guide.pointName);
                if (!joint) return;
                joint.cuts.push({
                    partId: part.id,
                    edge: guide.edge,
                    bevelAngleDeg: guide.bevelAngleDeg,
                    frontLineMm: guide.frontLineMm,
                    backLineMm: guide.backLineMm,
                    longFace: guide.longFace
                });
            });
        });
        this.fabricationDiagnostics.intersections.forEach(joint => {
            if (joint.type === 'butt seam' || joint.cuts.length < 2) return;
            const includedAngleDeg = joint.cuts.reduce((sum, cut) => sum + cut.bevelAngleDeg, 0);
            joint.includedAngleDeg = includedAngleDeg;
            joint.cutAngleDeg = includedAngleDeg / 2;
            joint.type = describeJointType(includedAngleDeg);
        });

        // The named profile points are panel joint centrelines. Side walls must
        // follow the assembled shell's outside faces so mitred transverse panels
        // and their side-entry screws remain covered in the viewport and export.
        // Full-profile internal supports retain the nominal internal contour so
        // they fit within the shell instead of intersecting its outer panels.
        const structuralSideProfilePointList = buildSideWallProfilePointList(
            shellParts,
            mitredProfilesByPanelId,
            profilePointList
        ).map(point => ({ x: point.x, y: point.y }));
        const structuralSideBounds = polygonBounds(structuralSideProfilePointList);
        const assemblyCenter = {
            x: (structuralSideBounds.minX + structuralSideBounds.maxX) / 2,
            y: (structuralSideBounds.minY + structuralSideBounds.maxY) / 2
        };

        const createSidePanel = (id, name, thickness, sideSign) => {
            const override = this.resolveComponentOverride(id);
            const sideKey = id === 'side_right' ? 'right' : 'left';
            const profileResolution = resolveSideProfile(
                this.params.sideProfileCustomization,
                sideKey,
                structuralSideProfilePointList,
                SIDE_PROFILE_SAMPLING_OPTIONS
            );
            const resolvedProfilePoints = profileResolution.points.map(point => ({ x: point.x, y: point.y }));
            const sideShape = createShapeFromPointList(resolvedProfilePoints);
            const sideBounds = polygonBounds(resolvedProfilePoints);
            const sideWidth = sideBounds.maxX - sideBounds.minX;
            const sideHeight = sideBounds.maxY - sideBounds.minY;
            const sideProfileArea = polygonArea(resolvedProfilePoints);
            const sideGeom = new THREE.ExtrudeGeometry(sideShape, {
                depth: thickness,
                bevelEnabled: false,
                steps: 1
            });
            sideGeom.translate(0, 0, -thickness / 2);
            const mats = this.getPanelMaterial(id, sideWidth, sideHeight, true);
            const mesh = new THREE.Mesh(sideGeom, [mats.mainMat, mats.edgeMat]);
            const zBase = sideSign < 0
                ? -W / 2 + thickness / 2 - exp * explodeDist - override.offset
                : W / 2 - thickness / 2 + exp * explodeDist + override.offset;

            mesh.position.set(0, 0, zBase);
            if (sideSign > 0) {
                mesh.scale.set(1, 1, -1);
            }

            mesh.userData = {
                id,
                name,
                role: 'Profile side wall',
                exportType: 'profile',
                thickness,
                thicknessMm: thickness,
                length: sideHeight,
                lengthMm: sideHeight,
                width: sideWidth,
                widthMm: sideWidth,
                areaMm2: sideProfileArea,
                includeInFabrication: this.isPanelIncluded(id),
                profilePoints: resolvedProfilePoints,
                structuralProfilePoints: structuralSideProfilePointList.map(point => ({ x: point.x, y: point.y })),
                profileCustomization: {
                    requested: this.params.sideProfileCustomization.enabled,
                    applied: profileResolution.customized,
                    source: profileResolution.source,
                    reason: profileResolution.reason,
                    validationErrors: (profileResolution.validation?.errors || []).map(issue => ({ ...issue }))
                },
                intersections: [],
                invalidIntersections: [],
                warnings: [],
                fastenerCount: 0,
                fasteners: [],
                fastenerIssues: [],
                override,
                isStructural: true,
                matingPanelIds: internalParts.map(part => part.id),
                explosionVector: { x: 0, y: 0, z: sideSign },
                edges: null
            };
            mesh.visible = this.isPanelVisible(id);

            this.group.add(mesh);
            this.panelMeshes.push(mesh);
            this.panelMeshById.set(id, mesh);
            this.fabricationPartRecords.push(mesh.userData);

            if (this.params.sideProfileCustomization.enabled && !profileResolution.customized) {
                const detail = profileResolution.validation?.errors?.[0]?.message;
                const message = `${name} decorative profile was not applied: ${detail || 'the saved curve is missing or invalid'}.`;
                this.fabricationDiagnostics.profileIssues.push({
                    code: profileResolution.reason === 'missing' ? 'SIDE_PROFILE_MISSING' : 'SIDE_PROFILE_INVALID',
                    severity: 'error',
                    partIds: [id],
                    message,
                    correctiveAction: 'Open the decorative side profile editor, repair or reset the curve, then apply it again.',
                    details: {
                        side: sideKey,
                        source: profileResolution.source,
                        validationErrors: profileResolution.validation?.errors || []
                    }
                });
                addPanelWarning(
                    id,
                    message
                );
            }
        };

        createSidePanel('side_left', 'Left Wall', leftThickness, -1);
        createSidePanel('side_right', 'Right Wall', rightThickness, 1);

        const profileRibPlacementPlan = (() => {
            if (!profileWebParts.length) return { entries: new Map(), requestedSpacingMm: 0, actualSpacingMm: 0, clamped: false };

            const ribInputs = profileWebParts.map(part => ({
                part,
                thicknessMm: this.getEffectiveThickness(part.id),
                offsetMm: numberOr(this.resolveComponentOverride(part.id).offset, 0)
            }));
            const requestedInput = Math.max(0, numberOr(
                this.params.controlProfileSupportSpacing,
                DEFAULT_STRUCTURE_SCHEMA.controlProfileSupportSpacing
            ));
            const entries = new Map();

            if (ribInputs.length === 1) {
                const input = ribInputs[0];
                entries.set(input.part.id, {
                    z: clamp(
                        innerCenterZ + input.offsetMm,
                        innerLeftZ + input.thicknessMm / 2,
                        innerRightZ - input.thicknessMm / 2
                    ),
                    thicknessMm: input.thicknessMm
                });
                return { entries, requestedSpacingMm: requestedInput, actualSpacingMm: 0, clamped: false };
            }

            const [first, second] = ribInputs;
            const minimumSpacing = (first.thicknessMm + second.thicknessMm) / 2
                + Math.max(6, Math.max(first.thicknessMm, second.thicknessMm) * 0.25);
            const solvedRequest = Math.max(requestedInput, minimumSpacing);
            const firstRoom = innerCenterZ + first.offsetMm - (innerLeftZ + first.thicknessMm / 2);
            const secondRoom = innerRightZ - second.thicknessMm / 2 - (innerCenterZ + second.offsetMm);
            const maximumSpacing = Math.max(0, Math.min(firstRoom, secondRoom) * 2);
            const solvedSpacingMm = Math.min(solvedRequest, maximumSpacing);
            const firstZ = innerCenterZ - solvedSpacingMm / 2 + first.offsetMm;
            const secondZ = innerCenterZ + solvedSpacingMm / 2 + second.offsetMm;
            const actualSpacingMm = Math.abs(secondZ - firstZ);

            entries.set(first.part.id, { z: firstZ, thicknessMm: first.thicknessMm });
            entries.set(second.part.id, { z: secondZ, thicknessMm: second.thicknessMm });
            return {
                entries,
                requestedSpacingMm: requestedInput,
                actualSpacingMm,
                clamped: Math.abs(actualSpacingMm - requestedInput) > 0.01
            };
        })();

        if (profileRibPlacementPlan.clamped) {
            const message = `Control profile support spacing was fitted from ${Math.round(profileRibPlacementPlan.requestedSpacingMm)} mm to ${Math.round(profileRibPlacementPlan.actualSpacingMm)} mm to remain inside the side walls.`;
            profileWebParts.forEach(part => addPanelWarning(part.id, message));
        }

        const horizontalJoineryPartIds = new Set([
            'panel_bottom',
            ...transverseStructuralParts.map(item => item.id)
        ]);
        const horizontalJoineryParts = internalParts.filter(item => horizontalJoineryPartIds.has(item.id));

        const createProfileWeb = part => {
            const override = this.resolveComponentOverride(part.id);
            const panelThickness = this.getEffectiveThickness(part.id);
            const placement = profileRibPlacementPlan.entries.get(part.id);
            if (!placement) return;

            const actualSpacing = profileRibPlacementPlan.actualSpacingMm;
            const baseZ = placement.z;
            const worldProfilePoints = profilePointList.map(point => ({ ...point }));
            const worldBounds = polygonBounds(worldProfilePoints);
            const localProfilePoints = worldProfilePoints.map(point => ({
                x: point.x - worldBounds.minX,
                y: point.y - worldBounds.minY
            }));
            const profileWidth = worldBounds.maxX - worldBounds.minX;
            const profileHeight = worldBounds.maxY - worldBounds.minY;
            const slotClearanceMm = 0.2;

            const createSlot = matingPart => {
                const segment = segmentByPanelId[matingPart.id];
                const profile = mitredProfilesByPanelId[matingPart.id];
                if (!segment || !profile?.worldPolygon?.length) return null;

                const panelThicknessMm = this.getEffectiveThickness(matingPart.id);
                const sourcePoints = profile.worldPolygon;
                const projectedLength = sourcePoints.map(point => dot2(point, segment.unit));
                const projectedNormal = sourcePoints.map(point => dot2(point, segment.localY));
                const bodyMinNormal = Math.min(...projectedNormal);
                const bodyMaxNormal = Math.max(...projectedNormal);
                const fullMinLength = Math.min(...projectedLength);
                const fullMaxLength = Math.max(...projectedLength);
                const splitLength = (fullMinLength + fullMaxLength) / 2;
                // An egg-crate/cross-lap joint divides the shared intersection
                // line between the two sheets.  The rib is open from one end to
                // the midpoint; the transverse panel is open from the opposite
                // end to that same midpoint.  Neither part is left with a thin
                // bridge around a full-length closed slot.
                const minNormal = bodyMinNormal - slotClearanceMm;
                const maxNormal = bodyMaxNormal + slotClearanceMm;
                const minLength = fullMinLength - slotClearanceMm;
                const maxLength = splitLength + slotClearanceMm;
                const fromAxes = (along, normal) => ({
                    x: segment.unit.x * along + segment.localY.x * normal,
                    y: segment.unit.y * along + segment.localY.y * normal
                });
                const worldPolygon = [
                    fromAxes(minLength, minNormal),
                    fromAxes(maxLength, minNormal),
                    fromAxes(maxLength, maxNormal),
                    fromAxes(minLength, maxNormal)
                ];
                const localPolygon = worldPolygon.map(point => ({
                    x: point.x - worldBounds.minX,
                    y: point.y - worldBounds.minY
                }));
                const viewportLocalPolygon = localPolygon.map(point => ({ ...point }));
                const slotCenterNormal = (minNormal + maxNormal) / 2;
                const edgeGeometry = {
                    coordinateSpace: 'panel-local',
                    hostPartId: part.id,
                    start: fromAxes(minLength, slotCenterNormal),
                    end: fromAxes(maxLength, slotCenterNormal)
                };
                edgeGeometry.start.x -= worldBounds.minX;
                edgeGeometry.start.y -= worldBounds.minY;
                edgeGeometry.end.x -= worldBounds.minX;
                edgeGeometry.end.y -= worldBounds.minY;

                const legacySuffix = matingPart.id === 'panel_cp_support'
                    ? 'to-support'
                    : matingPart.id === 'panel_display_support'
                        ? 'to-display-support'
                        : `to-${matingPart.id.replace(/^panel_/, '').replaceAll('_', '-')}`;
                const jointId = `joint:${part.id}-${legacySuffix}`;
                const matingPanelWidth = Math.max(40, innerWidth + segment.override.widthDelta);
                const matingSlotCenterX = baseZ - innerCenterZ + matingPanelWidth / 2;
                const matingSlotStartY = profile.blankLength / 2 - slotClearanceMm;
                const matingSlotEndY = profile.blankLength + slotClearanceMm;
                const matingSlotGeometry = {
                    id: `${matingPart.id}:slot:${part.id}`,
                    ownerPartId: matingPart.id,
                    matingPartId: part.id,
                    coordinateSpace: 'panel-local',
                    insertionAxis: 'panel-length',
                    machiningOperationId: `${jointId}:mating-slot:through-cut`,
                    start: { x: matingSlotCenterX, y: matingSlotStartY },
                    end: { x: matingSlotCenterX, y: matingSlotEndY },
                    geometry: {
                        kind: 'rect',
                        xMm: matingSlotCenterX,
                        yMm: (matingSlotStartY + matingSlotEndY) / 2,
                        widthMm: panelThickness + slotClearanceMm * 2,
                        heightMm: matingSlotEndY - matingSlotStartY,
                        rotationDeg: 0
                    }
                };
                return {
                    id: `${part.id}:slot:${matingPart.id}`,
                    jointId,
                    hostPartId: part.id,
                    matingPartId: matingPart.id,
                    panelThicknessMm,
                    clearanceMm: slotClearanceMm,
                    insertionAxis: 'panel-length',
                    worldPolygon,
                    localPolygon,
                    viewportLocalPolygon,
                    edgeGeometry,
                    matingSlotGeometry,
                    center: fromAxes(
                        (minLength + maxLength) / 2,
                        slotCenterNormal
                    )
                };
            };

            const joinerySlots = horizontalJoineryParts
                .map(createSlot)
                .filter(Boolean);
            const webJoints = joinerySlots.map(slot => ({
                id: slot.jointId,
                pointName: `${part.id}_${slot.matingPartId}_slot`,
                panels: [part.id, slot.matingPartId],
                partIds: [part.id, slot.matingPartId],
                type: 'dado seam',
                fit: 'paired open-ended cross-lap slots',
                strategy: 'dado',
                recommendedStrategy: 'dado',
                hostPartId: part.id,
                edgeGeometry: { ...slot.edgeGeometry },
                matingSlotGeometry: { ...slot.matingSlotGeometry },
                allowanceMm: panelThickness,
                includedAngleDeg: 90,
                cutAngleDeg: 0,
                cuts: [],
                location: {
                    x: slot.center.x,
                    y: slot.center.y,
                    z: baseZ
                }
            }));
            this.fabricationDiagnostics.intersections.push(...webJoints);

            const fittedCutouts = this.getPanelCutouts(part.id, profileHeight, profileWidth)
                .map(cutout => {
                    const margin = 6;
                    const widthMm = Math.min(cutout.widthMm, Math.max(8, profileWidth - margin * 2));
                    const preferredX = clamp(
                        cutout.yMm,
                        margin + widthMm / 2,
                        profileWidth - margin - widthMm / 2
                    );
                    const heightMm = Math.min(cutout.heightMm, Math.max(8, profileHeight - margin * 2));
                    const preferredY = clamp(
                        cutout.xMm,
                        margin + heightMm / 2,
                        profileHeight - margin - heightMm / 2
                    );
                    const minimumCenterY = margin + heightMm / 2;
                    const maximumCenterY = profileHeight - margin - heightMm / 2;
                    const candidateCount = 96;
                    let best = null;
                    for (let index = 0; index <= candidateCount; index++) {
                        const centerY = minimumCenterY
                            + (maximumCenterY - minimumCenterY) * index / candidateCount;
                        const lowerSpan = horizontalProfileSpan(
                            localProfilePoints,
                            centerY - heightMm / 2 - margin
                        );
                        const upperSpan = horizontalProfileSpan(
                            localProfilePoints,
                            centerY + heightMm / 2 + margin
                        );
                        if (!lowerSpan || !upperSpan) continue;
                        const minimumX = Math.max(lowerSpan.minX, upperSpan.minX) + margin + widthMm / 2;
                        const maximumX = Math.min(lowerSpan.maxX, upperSpan.maxX) - margin - widthMm / 2;
                        if (maximumX < minimumX) continue;
                        const centerX = clamp(preferredX, minimumX, maximumX);
                        const cutoutClearance = 2;
                        const candidatePolygon = [
                            {
                                x: centerX - widthMm / 2 - cutoutClearance,
                                y: centerY - heightMm / 2 - cutoutClearance
                            },
                            {
                                x: centerX + widthMm / 2 + cutoutClearance,
                                y: centerY - heightMm / 2 - cutoutClearance
                            },
                            {
                                x: centerX + widthMm / 2 + cutoutClearance,
                                y: centerY + heightMm / 2 + cutoutClearance
                            },
                            {
                                x: centerX - widthMm / 2 - cutoutClearance,
                                y: centerY + heightMm / 2 + cutoutClearance
                            }
                        ];
                        if (joinerySlots.some(slot => polygonPenetration(candidatePolygon, slot.localPolygon) > 0.001)) {
                            continue;
                        }
                        const displacement = Math.hypot(centerX - preferredX, centerY - preferredY);
                        if (!best || displacement < best.displacement) {
                            best = { centerX, centerY, displacement };
                        }
                    }
                    if (!best) return null;
                    return {
                        ...cutout,
                        xMm: best.centerY,
                        yMm: best.centerX,
                        widthMm,
                        heightMm
                    };
                })
                .filter(Boolean);

            const shape = createShapeFromPointList(localProfilePoints);
            fittedCutouts.forEach(cutout => {
                const left = cutout.yMm - cutout.widthMm / 2;
                const right = cutout.yMm + cutout.widthMm / 2;
                const bottom = cutout.xMm - cutout.heightMm / 2;
                const top = cutout.xMm + cutout.heightMm / 2;
                const hole = new THREE.Path();
                hole.moveTo(left, bottom);
                hole.lineTo(left, top);
                hole.lineTo(right, top);
                hole.lineTo(right, bottom);
                hole.closePath();
                shape.holes.push(hole);
            });

            const geometry = new THREE.ExtrudeGeometry(shape, {
                depth: panelThickness,
                bevelEnabled: false,
                steps: 1
            });
            geometry.translate(0, 0, -panelThickness / 2);
            const mats = this.getPanelMaterial(part.id, profileWidth, profileHeight, true);
            const mesh = new THREE.Mesh(geometry, [mats.mainMat, mats.edgeMat]);

            let radialX = 0;
            let radialY = 0;
            let radialZ = baseZ < innerCenterZ ? -1 : 1;
            let radialLength = Math.hypot(radialX, radialY, radialZ);
            const explosionVector = {
                x: radialX / radialLength,
                y: radialY / radialLength,
                z: radialZ / radialLength
            };
            mesh.position.set(
                worldBounds.minX + explosionVector.x * exp * explodeDist,
                worldBounds.minY + explosionVector.y * exp * explodeDist,
                baseZ + explosionVector.z * exp * explodeDist
            );

            mesh.userData = {
                id: part.id,
                name: part.name,
                role: part.role,
                exportType: 'profile',
                thickness: panelThickness,
                thicknessMm: panelThickness,
                length: profileHeight,
                lengthMm: profileHeight,
                width: profileWidth,
                widthMm: profileWidth,
                areaMm2: polygonArea(localProfilePoints),
                includeInFabrication: this.isPanelIncluded(part.id),
                viewportVisible: this.isPanelVisible(part.id),
                profilePoints: localProfilePoints.map(point => ({ ...point })),
                intersections: webJoints,
                invalidIntersections: [],
                warnings: [],
                fastenerCount: 0,
                fasteners: [],
                fastenerIssues: [],
                hardwareCutouts: 0,
                hardwareLayout: [],
                hardwareWarnings: [],
                cutoutCount: fittedCutouts.length,
                cutouts: fittedCutouts,
                finishedFace: 'left',
                grainDirection: 'none',
                override,
                isStructural: true,
                dadoTongues: [],
                joinerySlots: joinerySlots.map(slot => ({
                    ...slot,
                    worldPolygon: slot.worldPolygon.map(point => ({ ...point })),
                    localPolygon: slot.localPolygon.map(point => ({ ...point })),
                    viewportLocalPolygon: slot.viewportLocalPolygon.map(point => ({ ...point })),
                    edgeGeometry: {
                        ...slot.edgeGeometry,
                        start: { ...slot.edgeGeometry.start },
                        end: { ...slot.edgeGeometry.end }
                    },
                    matingSlotGeometry: {
                        ...slot.matingSlotGeometry,
                        start: { ...slot.matingSlotGeometry.start },
                        end: { ...slot.matingSlotGeometry.end },
                        geometry: { ...slot.matingSlotGeometry.geometry }
                    }
                })),
                matingPanelIds: [...part.matingPanelIds],
                metadata: {
                    isStructural: true,
                    matingPanelIds: [...part.matingPanelIds],
                    supportIndex: part.ribIndex + 1,
                    supportCount: part.ribCount,
                    supportSpacingMm: actualSpacing,
                    requestedSupportSpacingMm: profileRibPlacementPlan.requestedSpacingMm,
                    supportSpacingClamped: profileRibPlacementPlan.clamped,
                    lateralPositionMm: baseZ - innerCenterZ,
                    fullHeightProfile: true,
                    joineryDirection: 'horizontal-panels-into-profile-support',
                    horizontalJoineryPanelIds: joinerySlots.map(slot => slot.matingPartId),
                    joinerySlots: joinerySlots.map(slot => ({
                        id: slot.id,
                        jointId: slot.jointId,
                        matingPartId: slot.matingPartId,
                        insertionAxis: slot.insertionAxis,
                        clearanceMm: slot.clearanceMm,
                        matingSlotId: slot.matingSlotGeometry.id
                    })),
                    dadoTongues: []
                },
                localBounds: polygonBounds(localProfilePoints),
                crossSection: worldProfilePoints.map(point => ({ ...point })),
                p1: worldProfilePoints[0],
                p2: worldProfilePoints[worldProfilePoints.length - 1],
                sourceP1: worldProfilePoints[0],
                sourceP2: worldProfilePoints[worldProfilePoints.length - 1],
                normal: { x: 0, y: 0, z: 1 },
                explosionVector,
                edges: null
            };

            joinerySlots.forEach(slot => {
                [-1, 1].forEach(faceSign => {
                    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(
                        slot.viewportLocalPolygon.map(point => new THREE.Vector3(
                            point.x,
                            point.y,
                            faceSign * (panelThickness / 2 + 0.3)
                        ))
                    );
                    const outline = new THREE.LineLoop(
                        outlineGeometry,
                        new THREE.LineBasicMaterial({ color: 0x9f5b37, transparent: true, opacity: 0.95 })
                    );
                    outline.userData = {
                        selectable: false,
                        jointSlot: true,
                        panelId: part.id,
                        matingPartId: slot.matingPartId
                    };
                    mesh.add(outline);
                });
            });

            fittedCutouts.forEach(cutout => {
                const left = cutout.yMm - cutout.widthMm / 2;
                const right = cutout.yMm + cutout.widthMm / 2;
                const bottom = cutout.xMm - cutout.heightMm / 2;
                const top = cutout.xMm + cutout.heightMm / 2;
                [-1, 1].forEach(faceSign => {
                    const outlineGeometry = new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(left, bottom, faceSign * (panelThickness / 2 + 0.3)),
                        new THREE.Vector3(right, bottom, faceSign * (panelThickness / 2 + 0.3)),
                        new THREE.Vector3(right, top, faceSign * (panelThickness / 2 + 0.3)),
                        new THREE.Vector3(left, top, faceSign * (panelThickness / 2 + 0.3))
                    ]);
                    const outline = new THREE.LineLoop(
                        outlineGeometry,
                        new THREE.LineBasicMaterial({ color: 0x376f9f, transparent: true, opacity: 0.95 })
                    );
                    outline.userData = { selectable: false, cutout: cutout.kind, panelId: part.id };
                    mesh.add(outline);
                });
            });

            mesh.visible = this.isPanelVisible(part.id);
            this.group.add(mesh);
            this.panelMeshes.push(mesh);
            this.panelMeshById.set(part.id, mesh);
            this.fabricationPartRecords.push(mesh.userData);
        };

        profileWebParts.forEach(createProfileWeb);

        internalParts.forEach(part => {
            const segment = segmentByPanelId[part.id];
            const baseLength = segment.baseLength;
            const angle = segment.angle;
            const ux = segment.unit.x;
            const uy = segment.unit.y;
            const orientation = segment.orientation;
            const nx = orientation.outward.x;
            const ny = orientation.outward.y;
            const override = segment.override;
            const panelThickness = segment.panelThickness;
            const minPanelLength = Math.max(12, panelThickness * 1.1);
            const mitredProfile = mitredProfilesByPanelId[part.id];
            const panelLength = Math.max(minPanelLength, mitredProfile.blankLength);
            const panelWidth = Math.max(40, innerWidth + override.widthDelta);
            const geom = createMitredPanelGeometry(mitredProfile.points, panelWidth);
            const mats = this.getPanelMaterial(part.id, panelLength, panelWidth);
            const mesh = new THREE.Mesh(geom, [mats.mainMat, mats.edgeMat]);
            const posX = mitredProfile.origin.x;
            const posY = mitredProfile.origin.y;
            let radialX = posX - assemblyCenter.x;
            let radialY = posY - assemblyCenter.y;
            let radialLength = Math.hypot(radialX, radialY);
            if (radialLength < 1) {
                radialX = -nx;
                radialY = -ny;
                radialLength = Math.hypot(radialX, radialY) || 1;
            }
            const dispX = radialX / radialLength * exp * explodeDist;
            const dispY = radialY / radialLength * exp * explodeDist;
            const hardwareInfo = this.getHardwareLayoutInfo(part.id, panelLength, panelWidth);
            const cutouts = this.getPanelCutouts(part.id, panelLength, panelWidth);
            const screenFrame = part.isBezel ? this.getScreenFrameLayout(panelLength, panelWidth) : null;
            const fasteners = [];

            mesh.position.set(posX + dispX, posY + dispY, innerCenterZ);
            mesh.rotation.z = angle;
            mesh.userData = {
                id: part.id,
                name: part.name,
                role: part.role,
                exportType: 'rectangle',
                acceptsArtwork: Boolean(part.acceptsArtwork),
                thickness: panelThickness,
                thicknessMm: panelThickness,
                length: panelLength,
                lengthMm: panelLength,
                width: panelWidth,
                widthMm: panelWidth,
                baseLength,
                rawLength: baseLength,
                baseWidth: innerWidth,
                areaMm2: panelLength * panelWidth,
                includeInFabrication: this.isPanelIncluded(part.id),
                intersections: jointsByPanel[part.id] || [],
                invalidIntersections: [],
                warnings: [],
                mitreGuides: part.isStructural ? [] : buildPanelMitreGuides(part, mitredProfile, panelThickness, jointsByPanel[part.id] || []),
                hardwareCutouts: hardwareInfo.items.length,
                cutoutCount: cutouts.length,
                cutouts,
                screenLayout: part.isBezel ? this.getScreenLayout(panelLength, panelWidth) : null,
                screenFrame,
                hardwareLayout: hardwareInfo.items,
                hardwareWarnings: hardwareInfo.warnings,
                fastenerCount: fasteners.length,
                fasteners,
                fastenerIssues: [],
                layoutAdjusted: hardwareInfo.adjusted,
                layoutFitSuggestion: hardwareInfo.fitSuggestion || null,
                jointRelief: 0,
                outwardFaceSign: orientation.outwardSign,
                p1: part.p1,
                p2: part.p2,
                sourceP1: part.p1,
                sourceP2: part.p2,
                normal: { x: nx, y: ny },
                explosionVector: { x: radialX / radialLength, y: radialY / radialLength, z: 0 },
                isStructural: Boolean(part.isStructural),
                matingPanelIds: [...(part.matingPanelIds || [])],
                metadata: {
                    isStructural: Boolean(part.isStructural),
                    matingPanelIds: [...(part.matingPanelIds || [])]
                },
                localBounds: mitredProfile.bounds,
                crossSection: mitredProfile.worldPolygon,
                override,
                edges: null
            };

            this.group.add(mesh);
            this.panelMeshes.push(mesh);
            this.panelMeshById.set(part.id, mesh);
            this.fabricationPartRecords.push(mesh.userData);
            mesh.visible = this.isPanelVisible(part.id);
            this.addHardwareMeshes(mesh, hardwareInfo.items, panelLength, panelWidth, panelThickness, orientation.outwardSign, mitredProfile.bounds);
            this.addCutoutMarkers(mesh, cutouts, panelLength, panelWidth, panelThickness, orientation.outwardSign, mitredProfile.bounds);
            this.addScreenFrameMeshes(mesh, screenFrame, panelLength, panelWidth, panelThickness, orientation.outwardSign, mitredProfile.bounds);

            if (panelWidth > innerWidth + 0.5) {
                addPanelWarning(part.id, `${part.name} is ${Math.round(panelWidth - innerWidth)} mm wider than the clear side-wall span.`);
            }

            hardwareInfo.warnings.forEach(message => addPanelWarning(part.id, `${part.name}: ${message}`));

            if (!part.isStructural) {
                rectRecords.push({
                    panelId: part.id,
                    name: part.name,
                    polygon: mitredProfile.worldPolygon,
                    center: polygonCenter(mitredProfile.worldPolygon)
                });
            }

            if (part.isBezel) {
                this.addMonitorReference(part, panelLength, panelWidth, panelThickness, posX + dispX, posY + dispY, angle, nx, ny);
            }
        });

        this.fabricationDiagnostics.intersections
            .filter(joint => joint.type === 'dado seam' && joint.edgeGeometry?.start && joint.edgeGeometry?.end)
            .forEach(joint => {
                const host = this.panelMeshes.find(mesh => mesh.userData.id === joint.hostPartId);
                const mateId = joint.partIds.find(partId => partId !== joint.hostPartId);
                const mate = this.panelMeshes.find(mesh => mesh.userData.id === mateId);
                if (!host || !mate) return;

                const start = joint.edgeGeometry.start;
                const end = joint.edgeGeometry.end;
                const lengthMm = Math.hypot(end.x - start.x, end.y - start.y);
                if (lengthMm < 8) {
                    addPanelWarning(host.userData.id, `${host.userData.name} has insufficient length for the ${mate.userData.name} dado.`);
                    return;
                }

                const clearanceMm = 0.2;
                const operationId = `${joint.id}:dado:pocket`;
                const isPairedCrossLap = Boolean(joint.matingSlotGeometry?.geometry);
                const operation = {
                    id: operationId,
                    type: isPairedCrossLap ? 'throughCut' : 'pocket',
                    partId: host.userData.id,
                    depthMm: isPairedCrossLap
                        ? host.userData.thicknessMm
                        : joint.tongueGeometry?.depthMm
                            ?? Math.min(mate.userData.thicknessMm * 0.4, host.userData.thicknessMm * 0.75),
                    geometry: {
                        kind: 'rect',
                        xMm: (start.x + end.x) / 2,
                        yMm: (start.y + end.y) / 2,
                        widthMm: lengthMm,
                        heightMm: mate.userData.thicknessMm + clearanceMm * 2,
                        rotationDeg: Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
                    },
                    purpose: isPairedCrossLap
                        ? 'structural-cross-lap-rib-slot'
                        : 'structural-profile-support-dado',
                    jointId: joint.id,
                    matingPartId: mateId,
                    machiningFace: isPairedCrossLap
                        ? 'left'
                        : host.userData.id === 'panel_display_support' ? 'bottom' : 'top',
                    clearanceMm,
                    mandatory: true
                };
                host.userData.fabricationOperations ||= [];
                if (!host.userData.fabricationOperations.some(item => item.id === operationId)) {
                    host.userData.fabricationOperations.push(operation);
                }
                joint.machiningOperationId = operationId;
                if (isPairedCrossLap) {
                    const matingSlotOperationId = joint.matingSlotGeometry.machiningOperationId
                        || `${joint.id}:mating-slot:through-cut`;
                    const matingOperation = {
                        id: matingSlotOperationId,
                        type: 'throughCut',
                        partId: mate.userData.id,
                        depthMm: mate.userData.thicknessMm,
                        geometry: { ...joint.matingSlotGeometry.geometry },
                        purpose: 'structural-cross-lap-panel-slot',
                        jointId: joint.id,
                        matingPartId: host.userData.id,
                        machiningFace: 'top',
                        clearanceMm,
                        mandatory: true
                    };
                    mate.userData.fabricationOperations ||= [];
                    if (!mate.userData.fabricationOperations.some(item => item.id === matingSlotOperationId)) {
                        mate.userData.fabricationOperations.push(matingOperation);
                    }
                    mate.userData.horizontalJoinerySlots ||= [];
                    if (!mate.userData.horizontalJoinerySlots.some(item => item.id === joint.matingSlotGeometry.id)) {
                        mate.userData.horizontalJoinerySlots.push({
                            ...joint.matingSlotGeometry,
                            start: { ...joint.matingSlotGeometry.start },
                            end: { ...joint.matingSlotGeometry.end },
                            geometry: { ...joint.matingSlotGeometry.geometry },
                            jointId: joint.id,
                            matingOperationId: operationId
                        });
                    }
                    const bounds = mate.userData.localBounds;
                    const localSplitX = (bounds.minX + bounds.maxX) / 2;
                    const localEndX = bounds.maxX + 0.5;
                    const localCenterZ = joint.matingSlotGeometry.geometry.xMm - mate.userData.widthMm / 2;
                    const halfSlotWidth = joint.matingSlotGeometry.geometry.widthMm / 2;
                    const faceY = bounds.maxY + 0.3;
                    const outlineGeometry = new THREE.BufferGeometry().setFromPoints([
                        new THREE.Vector3(localSplitX, faceY, localCenterZ - halfSlotWidth),
                        new THREE.Vector3(localEndX, faceY, localCenterZ - halfSlotWidth),
                        new THREE.Vector3(localEndX, faceY, localCenterZ + halfSlotWidth),
                        new THREE.Vector3(localSplitX, faceY, localCenterZ + halfSlotWidth)
                    ]);
                    const outline = new THREE.LineLoop(
                        outlineGeometry,
                        new THREE.LineBasicMaterial({ color: 0x9f5b37, transparent: true, opacity: 0.95 })
                    );
                    outline.userData = {
                        selectable: false,
                        jointSlot: true,
                        panelId: mate.userData.id,
                        matingPartId: host.userData.id
                    };
                    mate.add(outline);
                    mate.userData.metadata ||= {};
                    mate.userData.metadata.horizontalJoinerySlots = mate.userData.horizontalJoinerySlots
                        .map(item => ({ ...item }));
                    if (!mate.userData.intersections.some(item => item.id === joint.id)) {
                        mate.userData.intersections.push(joint);
                    }
                    joint.matingMachiningOperationId = matingSlotOperationId;
                }
            });

        const displaySupport = this.panelMeshes.find(mesh => mesh.userData.id === 'panel_display_support');
        if (displaySupport) {
            const displaySupportJoints = [
                {
                    id: 'joint:display-support-to-back',
                    pointName: 'display_support_back',
                    panels: ['panel_display_support', 'panel_back'],
                    partIds: ['panel_display_support', 'panel_back'],
                    type: 'butt seam',
                    allowanceMm: displaySupport.userData.thicknessMm,
                    includedAngleDeg: 90,
                    cutAngleDeg: 0,
                    cuts: [],
                    location: { x: points.back_bottom.x, y: points.cp_back.y, z: innerCenterZ }
                },
                {
                    id: 'joint:display-support-to-bezel',
                    pointName: 'display_support_bezel',
                    panels: ['panel_display_support', 'panel_bezel'],
                    partIds: ['panel_display_support', 'panel_bezel'],
                    type: 'butt seam',
                    allowanceMm: displaySupport.userData.thicknessMm,
                    includedAngleDeg: 90,
                    cutAngleDeg: 0,
                    cuts: [],
                    location: { x: points.cp_back.x, y: points.cp_back.y, z: innerCenterZ }
                }
            ];
            this.fabricationDiagnostics.intersections.push(...displaySupportJoints);
            displaySupportJoints.forEach(joint => {
                joint.partIds.forEach(panelId => {
                    const mesh = this.panelMeshes.find(candidate => candidate.userData.id === panelId);
                    if (mesh && !mesh.userData.intersections.some(item => item.id === joint.id)) {
                        mesh.userData.intersections.push(joint);
                    }
                });
            });
        }

        const assemblyFabrication = this.createFabricationAssemblyRecords();
        this.fabricationPartRecords.push(...assemblyFabrication.parts);
        this.fabricationAssemblySchedules = assemblyFabrication.schedules;

        const sideFasteners = this.createSideFastenerRecords(
            Object.values(segmentByPanelId),
            mitredProfilesByPanelId,
            W,
            exp,
            explodeDist,
            fastenerSpec
        );
        const fastenerIssues = this.validateSideFasteners(sideFasteners);
        this.fabricationDiagnostics.fasteners += sideFasteners.length;
        this.fabricationDiagnostics.fastenerIssues.push(...fastenerIssues);
        fastenerIssues.forEach(issue => {
            issue.panels.forEach(panelId => addPanelWarning(panelId, issue.message));
        });

        const fastenersByPanelId = {};
        const fastenerIssuesByPanelId = {};
        sideFasteners.forEach(record => {
            [record.sourcePanelId, record.targetPanelId].forEach(panelId => {
                if (!fastenersByPanelId[panelId]) fastenersByPanelId[panelId] = [];
                fastenersByPanelId[panelId].push(record);
            });
        });
        fastenerIssues.forEach(issue => {
            issue.panels.forEach(panelId => {
                if (!fastenerIssuesByPanelId[panelId]) fastenerIssuesByPanelId[panelId] = [];
                fastenerIssuesByPanelId[panelId].push(issue);
            });
        });
        this.panelMeshes.forEach(mesh => {
            const panelId = mesh.userData.id;
            mesh.userData.fasteners = fastenersByPanelId[panelId] || mesh.userData.fasteners || [];
            mesh.userData.fastenerCount = mesh.userData.fasteners.length;
            mesh.userData.fastenerIssues = fastenerIssuesByPanelId[panelId] || [];
        });
        this.addSideFastenerMeshes(sideFasteners);

        const collisionTolerance = Math.max(0.8, numberOr(this.params.thickness, 18) * 0.08);
        for (let i = 0; i < rectRecords.length; i++) {
            for (let j = i + 1; j < rectRecords.length; j++) {
                const a = rectRecords[i];
                const b = rectRecords[j];
                const penetration = polygonPenetration(a.polygon, b.polygon);
                if (penetration <= collisionTolerance) continue;

                const center = {
                    x: (a.center.x + b.center.x) / 2,
                    y: (a.center.y + b.center.y) / 2,
                    z: 0
                };
                const displayPenetration = Math.round(penetration * 10) / 10;
                const message = `${a.name} intersects ${b.name} by ${displayPenetration} mm.`;
                const record = {
                    panels: [a.panelId, b.panelId],
                    names: [a.name, b.name],
                    penetrationMm: penetration,
                    center,
                    message
                };

                this.fabricationDiagnostics.invalidIntersections.push(record);
                addPanelWarning(a.panelId, message);
                addPanelWarning(b.panelId, message);
            }
        }

        this.panelMeshes.forEach(mesh => {
            const panelWarnings = panelWarningsById[mesh.userData.id] || [];
            mesh.userData.warnings = panelWarnings;
            mesh.userData.invalidIntersections = this.fabricationDiagnostics.invalidIntersections
                .filter(record => record.panels.includes(mesh.userData.id));
        });

        if (this.fabricationDiagnostics.warnings.length || this.fabricationDiagnostics.invalidIntersections.length) {
            this.fabricationDiagnostics.status = 'CHECK';
        }

        this.panelMeshes
            .filter(mesh => mesh.userData.id === 'side_left' || mesh.userData.id === 'side_right')
            .forEach(mesh => {
                mesh.userData.intersections = this.fabricationDiagnostics.intersections;
                mesh.userData.invalidIntersections = this.fabricationDiagnostics.invalidIntersections;
                mesh.userData.warnings = this.fabricationDiagnostics.warnings;
            });

        this.addJointMarkers(points, jointMap, innerWidth);
        this.addInvalidIntersectionMarkers(this.fabricationDiagnostics.invalidIntersections, innerWidth);

        Object.keys(this.canvasTextures).forEach(canvasId => {
            if (this.activeCanvasTextureIds.has(canvasId)) return;
            this.canvasTextures[canvasId]?.dispose?.();
            delete this.canvasTextures[canvasId];
            delete this.canvasElements[canvasId];
            delete this.canvasRenderSignatures[canvasId];
        });

        const centerX = numberOr(this.params.depth, 600) / 2;
        this.group.position.set(-centerX, 0, 0);
        this.applyHighlights();
        this.resolveExplodedPanelOverlaps(exp);
        this.onChange?.();
    }

    addHardwareMeshes(panelMesh, hardwareItems, panelLength, panelWidth, panelThickness, outwardFaceSign = -1, localBounds = null) {
        if (!hardwareItems.length) return;

        const surfaceY = outwardFaceSign * panelThickness / 2;
        const localMinX = localBounds ? localBounds.minX : -panelLength / 2;

        hardwareItems.forEach(item => {
            const localX = localMinX + item.xMm;
            const localZ = item.yMm - panelWidth / 2;
            const buttonHeight = Math.max(10, Math.min(22, item.radiusMm * 0.72));
            const washerHeight = Math.max(3, Math.min(6, item.radiusMm * 0.18));
            const lift = 1.5;
            const buttonMat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(item.color).getHex(),
                side: THREE.DoubleSide
            });
            const darkMat = new THREE.MeshBasicMaterial({
                color: 0x171717,
                side: THREE.DoubleSide
            });

            const washerGeom = this.getBuildGeometry(
                `hardware-washer:${item.radiusMm}:${washerHeight}`,
                () => new THREE.CylinderGeometry(item.radiusMm * 1.18, item.radiusMm * 1.18, washerHeight, 32)
            );
            const washer = new THREE.Mesh(washerGeom, darkMat);
            washer.position.set(localX, surfaceY + outwardFaceSign * (washerHeight / 2 + 0.7), localZ);
            washer.userData = { selectable: false, hardware: item.kind, panelId: panelMesh.userData.id };
            panelMesh.add(washer);

            const capGeom = this.getBuildGeometry(
                `hardware-cap:${item.radiusMm}:${buttonHeight}`,
                () => new THREE.CylinderGeometry(item.radiusMm, item.radiusMm * 0.92, buttonHeight, 32)
            );
            const cap = new THREE.Mesh(capGeom, buttonMat);
            cap.position.set(localX, surfaceY + outwardFaceSign * (washerHeight + buttonHeight / 2 + lift), localZ);
            cap.userData = { selectable: false, hardware: item.kind, panelId: panelMesh.userData.id };

            const capEdges = new THREE.LineSegments(
                this.getBuildGeometry(
                    `hardware-cap-edges:${item.radiusMm}:${buttonHeight}`,
                    () => new THREE.EdgesGeometry(capGeom, 18)
                ),
                new THREE.LineBasicMaterial({ color: 0x171717, transparent: true, opacity: 0.72 })
            );
            cap.add(capEdges);
            panelMesh.add(cap);

            if (item.kind === 'joystick') {
                const shaftRadius = Math.max(3, item.radiusMm * 0.16);
                const shaftLength = Math.max(46, item.radiusMm * 2.2);
                const shaftGeom = this.getBuildGeometry(
                    `hardware-shaft:${shaftRadius}:${shaftLength}`,
                    () => new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16)
                );
                const shaft = new THREE.Mesh(shaftGeom, darkMat);
                shaft.position.set(localX, surfaceY + outwardFaceSign * (washerHeight + buttonHeight + shaftLength / 2), localZ);
                shaft.userData = { selectable: false, hardware: item.kind, panelId: panelMesh.userData.id };
                panelMesh.add(shaft);

                const ballRadius = Math.max(9, item.radiusMm * 0.45);
                const ballGeom = this.getBuildGeometry(
                    `hardware-ball:${ballRadius}`,
                    () => new THREE.SphereGeometry(ballRadius, 18, 12)
                );
                const ball = new THREE.Mesh(ballGeom, darkMat);
                ball.position.set(localX, surfaceY + outwardFaceSign * (washerHeight + buttonHeight + shaftLength + ballRadius * 0.65), localZ);
                ball.userData = { selectable: false, hardware: item.kind, panelId: panelMesh.userData.id };
                const ballEdges = new THREE.LineSegments(
                    this.getBuildGeometry(
                        `hardware-ball-edges:${ballRadius}`,
                        () => new THREE.EdgesGeometry(ballGeom, 12)
                    ),
                    new THREE.LineBasicMaterial({ color: 0x171717, transparent: true, opacity: 0.55 })
                );
                ball.add(ballEdges);
                panelMesh.add(ball);
            }
        });
    }

    addCutoutMarkers(panelMesh, cutouts, panelLength, panelWidth, panelThickness, outwardFaceSign = -1, localBounds = null) {
        if (!cutouts.length) return;

        const surfaceY = outwardFaceSign * panelThickness / 2;
        const localMinX = localBounds ? localBounds.minX : -panelLength / 2;

        cutouts.forEach(item => {
            const localX = localMinX + item.xMm;
            const localZ = item.yMm - panelWidth / 2;
            const color = new THREE.Color(item.color || '#376f9f').getHex();
            const fillMat = new THREE.MeshBasicMaterial({
                color,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: item.kind === 'service_door' ? 0.14 : 0.28
            });
            const outlineMat = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.9
            });
            const markerGeom = new THREE.BoxGeometry(item.heightMm, 0.9, item.widthMm);
            const marker = new THREE.Mesh(markerGeom, fillMat);
            marker.position.set(localX, surfaceY + outwardFaceSign * 1.35, localZ);
            marker.userData = { selectable: false, cutout: item.kind, panelId: panelMesh.userData.id };

            const outline = new THREE.LineSegments(new THREE.EdgesGeometry(markerGeom, 5), outlineMat);
            outline.userData = marker.userData;
            marker.add(outline);
            panelMesh.add(marker);
        });
    }

    addScreenFrameMeshes(panelMesh, frame, panelLength, panelWidth, panelThickness, outwardFaceSign = -1, localBounds = null) {
        if (!frame) return;

        const localMinX = localBounds ? localBounds.minX : -panelLength / 2;
        const centerX = localMinX + frame.xMm;
        const centerZ = frame.yMm - panelWidth / 2;
        const surfaceY = outwardFaceSign * panelThickness / 2;
        const depth = frame.depthMm;
        const bezel = frame.bezelMm;
        const mat = new THREE.MeshBasicMaterial({
            color: 0x171717,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.88
        });
        const edgeMat = new THREE.LineBasicMaterial({ color: 0xfbfbf8, transparent: true, opacity: 0.42 });
        const addBar = (name, xOffset, zOffset, sizeX, sizeZ) => {
            const geom = new THREE.BoxGeometry(sizeX, depth, sizeZ);
            const bar = new THREE.Mesh(geom, mat);
            bar.position.set(centerX + xOffset, surfaceY + outwardFaceSign * (depth / 2 + 1.2), centerZ + zOffset);
            bar.userData = { selectable: false, hardware: 'screen_frame', panelId: panelMesh.userData.id, framePart: name };
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 5), edgeMat);
            edges.userData = bar.userData;
            bar.add(edges);
            panelMesh.add(bar);
        };

        addBar('top', -frame.outerHeightMm / 2 + bezel / 2, 0, bezel, frame.outerWidthMm);
        addBar('bottom', frame.outerHeightMm / 2 - bezel / 2, 0, bezel, frame.outerWidthMm);
        addBar('left', 0, -frame.outerWidthMm / 2 + bezel / 2, frame.innerHeightMm, bezel);
        addBar('right', 0, frame.outerWidthMm / 2 - bezel / 2, frame.innerHeightMm, bezel);
    }

    addMonitorReference(part, panelLength, panelWidth, panelThickness, posX, posY, angle, nx, ny) {
        const screen = this.getScreenLayout(panelLength, panelWidth);
        const monitorW = screen.widthMm;
        const monitorH = screen.heightMm;

        const monGeom = new THREE.BoxGeometry(monitorH, 5, monitorW);
        const screenMat = new THREE.MeshBasicMaterial({ color: 0x171717, side: THREE.DoubleSide });
        const bevelMat = new THREE.MeshBasicMaterial({ color: 0x34342f, side: THREE.DoubleSide });
        const monMesh = new THREE.Mesh(monGeom, [bevelMat, bevelMat, screenMat, screenMat, bevelMat, bevelMat]);
        monMesh.position.set(posX + nx * (panelThickness / 2 + 4), posY + ny * (panelThickness / 2 + 4), 0);
        monMesh.rotation.z = angle;
        monMesh.userData = {
            id: `${part.id}_screen_reference`,
            selectable: false
        };

        const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(monGeom, 5),
            new THREE.LineBasicMaterial({ color: 0xfbfbf8, transparent: true, opacity: 0.86 })
        );
        monMesh.add(outline);

        const glowGeom = new THREE.BoxGeometry(Math.max(10, monitorH - 18), 1.2, Math.max(10, monitorW - 18));
        const glow = new THREE.Mesh(
            glowGeom,
            new THREE.MeshBasicMaterial({ color: 0x2f7b83, transparent: true, opacity: 0.24, side: THREE.DoubleSide })
        );
        glow.position.set(0, 3.4, 0);
        glow.userData = { selectable: false };
        monMesh.add(glow);

        this.group.add(monMesh);
    }

    createSideFastenerRecords(segments, panelProfiles, cabinetWidth, exp, explodeDist, spec) {
        if (!segments.length) return [];

        const leftThickness = this.getEffectiveThickness('side_left');
        const rightThickness = this.getEffectiveThickness('side_right');
        const leftOffset = this.resolveComponentOverride('side_left').offset || 0;
        const rightOffset = this.resolveComponentOverride('side_right').offset || 0;
        const leftPhysicalCenterZ = -cabinetWidth / 2 + leftThickness / 2 - leftOffset;
        const rightPhysicalCenterZ = cabinetWidth / 2 - rightThickness / 2 + rightOffset;
        const leftCenterZ = -cabinetWidth / 2 + leftThickness / 2 - exp * explodeDist - leftOffset;
        const rightCenterZ = cabinetWidth / 2 - rightThickness / 2 + exp * explodeDist + rightOffset;
        const sides = [
            {
                side: 'left',
                sourcePanelId: 'side_left',
                direction: 1,
                sideThickness: leftThickness,
                outerZ: leftCenterZ - leftThickness / 2,
                innerZ: leftCenterZ + leftThickness / 2,
                physicalOuterZ: leftPhysicalCenterZ - leftThickness / 2
            },
            {
                side: 'right',
                sourcePanelId: 'side_right',
                direction: -1,
                sideThickness: rightThickness,
                outerZ: rightCenterZ + rightThickness / 2,
                innerZ: rightCenterZ - rightThickness / 2,
                physicalOuterZ: rightPhysicalCenterZ + rightThickness / 2
            }
        ];
        const records = [];

        segments.forEach(segment => {
            const profile = panelProfiles[segment.id];
            if (!profile?.bounds) return;

            const targetSpec = this.resolveFastenerSpec(segment.id, spec);
            const positions = getFastenerLocalPositions(profile.bounds.minX, profile.bounds.maxX, targetSpec);
            positions.forEach((localX, index) => {
                const centerline = {
                    x: profile.origin.x + segment.unit.x * localX,
                    y: profile.origin.y + segment.unit.y * localX
                };
                const edgeDistance = Math.min(localX - profile.bounds.minX, profile.bounds.maxX - localX);
                const distanceFromStart = localX - profile.bounds.minX;

                sides.forEach(side => {
                    const id = `${side.side}_${segment.id}_${index}`;
                    const recordSpec = this.resolveFastenerSpec(segment.id, targetSpec, side.sourcePanelId, id);
                    records.push({
                        id,
                        kind: 'side_screw',
                        side: side.side,
                        sourcePanelId: side.sourcePanelId,
                        targetPanelId: segment.id,
                        targetPanelName: segment.name,
                        x: centerline.x,
                        y: centerline.y,
                        z: side.outerZ,
                        localX,
                        xMm: distanceFromStart,
                        yMm: centerline.y,
                        edgeDistanceMm: edgeDistance,
                        diameterMm: recordSpec.diameterMm,
                        radiusMm: recordSpec.radiusMm,
                        headRadiusMm: recordSpec.headRadiusMm,
                        headThicknessMm: recordSpec.headThicknessMm,
                        lengthMm: recordSpec.lengthMm,
                        edgeClearanceMm: recordSpec.edgeClearanceMm,
                        minCenterSpacingMm: recordSpec.minCenterSpacingMm,
                        targetPenetrationMm: recordSpec.targetPenetrationMm,
                        sideThickness: side.sideThickness,
                        direction: side.direction,
                        outerZ: side.outerZ,
                        innerZ: side.innerZ,
                        shaftStartZ: side.physicalOuterZ,
                        shaftEndZ: side.physicalOuterZ + side.direction * recordSpec.lengthMm,
                        invalid: false,
                        issueMessages: []
                    });
                });
            });
        });

        return records;
    }

    validateSideFasteners(records) {
        const issues = [];

        const addIssue = (affectedRecords, message) => {
            const affected = Array.isArray(affectedRecords) ? affectedRecords : [affectedRecords];
            const panels = [...new Set(affected.flatMap(record => [record.sourcePanelId, record.targetPanelId]))];
            const center = affected.reduce((acc, record) => {
                acc.x += record.x;
                acc.y += record.y;
                acc.z += record.outerZ;
                return acc;
            }, { x: 0, y: 0, z: 0 });
            center.x /= affected.length;
            center.y /= affected.length;
            center.z /= affected.length;

            affected.forEach(record => {
                record.invalid = true;
                if (!record.issueMessages.includes(message)) {
                    record.issueMessages.push(message);
                }
            });

            if (!issues.some(issue => issue.message === message)) {
                issues.push({
                    panels,
                    fasteners: affected.map(record => record.id),
                    center,
                    message
                });
            }
        };

        records.forEach(record => {
            const roundedEdge = Math.round(record.edgeDistanceMm * 10) / 10;
            if (record.edgeDistanceMm + 0.001 < record.edgeClearanceMm) {
                addIssue(
                    record,
                    `${record.targetPanelName} ${record.side} screw is ${roundedEdge} mm from an edge; minimum is ${Math.round(record.edgeClearanceMm)} mm.`
                );
            }

            if (record.edgeDistanceMm + 0.001 < record.radiusMm) {
                addIssue(
                    record,
                    `${record.targetPanelName} ${record.side} screw shaft breaks out of the material edge.`
                );
            }

            const requiredLength = record.sideThickness + record.targetPenetrationMm;
            if (record.lengthMm + 0.001 < requiredLength) {
                const penetration = Math.max(0, record.lengthMm - record.sideThickness);
                addIssue(
                    record,
                    `${record.targetPanelName} ${record.side} screw only penetrates the target panel ${Math.round(penetration)} mm; ${Math.round(record.targetPenetrationMm)} mm required.`
                );
            }
        });

        for (let i = 0; i < records.length; i++) {
            for (let j = i + 1; j < records.length; j++) {
                const a = records[i];
                const b = records[j];
                const xyDistance = Math.hypot(a.x - b.x, a.y - b.y);

                const requiredSpacing = Math.max(a.minCenterSpacingMm, b.minCenterSpacingMm);
                if (a.side === b.side && a.targetPanelId === b.targetPanelId && xyDistance + 0.001 < requiredSpacing) {
                    addIssue(
                        [a, b],
                        `${a.targetPanelName} and ${b.targetPanelName} ${a.side} screw centrelines are ${Math.round(xyDistance)} mm apart; minimum is ${Math.round(requiredSpacing)} mm.`
                    );
                }

                const shaftOverlap = intervalOverlap(zInterval(a), zInterval(b));
                if (xyDistance + 0.001 < Math.max(a.diameterMm, b.diameterMm) && shaftOverlap > 0.001) {
                    addIssue(
                        [a, b],
                        `${a.targetPanelName} and ${b.targetPanelName} screw shafts intersect.`
                    );
                }
            }
        }

        return issues;
    }

    addSideFastenerMeshes(records) {
        if (!records.length) return;

        const shaftMaterial = new THREE.MeshBasicMaterial({
            color: 0x171717,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.26
        });
        const headMaterial = new THREE.MeshBasicMaterial({
            color: 0x171717,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.74
        });
        const issueShaftMaterial = new THREE.MeshBasicMaterial({
            color: 0x8c1d1d,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.36
        });
        const issueHeadMaterial = new THREE.MeshBasicMaterial({
            color: 0x8c1d1d,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9
        });

        records.forEach(record => {
            const shaftGeom = this.getBuildGeometry(
                `fastener-shaft:${record.radiusMm}:${record.lengthMm}`,
                () => new THREE.CylinderGeometry(record.radiusMm, record.radiusMm, record.lengthMm, 16)
            );
            const shaft = new THREE.Mesh(shaftGeom, record.invalid ? issueShaftMaterial : shaftMaterial);
            shaft.rotation.x = Math.PI / 2;
            shaft.position.set(record.x, record.y, record.outerZ + record.direction * record.lengthMm / 2);
            shaft.userData = {
                selectable: false,
                hardware: 'side_screw_shaft',
                panelId: record.sourcePanelId,
                targetPanelId: record.targetPanelId,
                issue: record.invalid
            };
            this.group.add(shaft);

            const headGeom = this.getBuildGeometry(
                `fastener-head:${record.headRadiusMm}:${record.headThicknessMm}`,
                () => new THREE.CylinderGeometry(record.headRadiusMm, record.headRadiusMm, record.headThicknessMm, 24)
            );
            const head = new THREE.Mesh(headGeom, record.invalid ? issueHeadMaterial : headMaterial);
            head.rotation.x = Math.PI / 2;
            head.position.set(record.x, record.y, record.outerZ - record.direction * record.headThicknessMm / 2);
            head.userData = {
                selectable: false,
                hardware: 'side_screw_head',
                panelId: record.sourcePanelId,
                targetPanelId: record.targetPanelId,
                issue: record.invalid
            };
            this.group.add(head);

            const slotGeom = this.getBuildGeometry(
                `fastener-slot:${record.headRadiusMm}`,
                () => new THREE.BoxGeometry(record.headRadiusMm * 1.45, record.headRadiusMm * 0.28, 0.75)
            );
            const slot = new THREE.Mesh(slotGeom, record.invalid ? issueHeadMaterial : headMaterial);
            slot.position.set(record.x, record.y, record.outerZ - record.direction * (record.headThicknessMm + 0.1));
            slot.userData = {
                selectable: false,
                hardware: 'side_screw_slot',
                panelId: record.sourcePanelId,
                targetPanelId: record.targetPanelId,
                issue: record.invalid
            };
            this.group.add(slot);
        });
    }

    addJointMarkers(points, jointMap, innerWidth) {
        const markerMaterial = new THREE.LineBasicMaterial({
            color: 0x171717,
            transparent: true,
            opacity: 0.36
        });
        const tickMaterial = new THREE.LineBasicMaterial({
            color: 0x171717,
            transparent: true,
            opacity: 0.52
        });
        const halfWidth = innerWidth / 2;
        const tick = Math.max(18, numberOr(this.params.thickness, 18) * 1.2);

        Object.entries(jointMap).forEach(([pointName, panelIds]) => {
            if (panelIds.length < 2 || !points[pointName]) return;
            const point = points[pointName];

            const seamGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(point.x, point.y, -halfWidth),
                new THREE.Vector3(point.x, point.y, halfWidth)
            ]);
            const seamLine = new THREE.Line(seamGeometry, markerMaterial);
            seamLine.userData = { selectable: false, jointPoint: pointName };
            this.group.add(seamLine);

            const tickGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(point.x - tick, point.y, -halfWidth),
                new THREE.Vector3(point.x + tick, point.y, -halfWidth),
                new THREE.Vector3(point.x - tick, point.y, halfWidth),
                new THREE.Vector3(point.x + tick, point.y, halfWidth)
            ]);
            const tickLine = new THREE.LineSegments(tickGeometry, tickMaterial);
            tickLine.userData = { selectable: false, jointPoint: pointName };
            this.group.add(tickLine);
        });
    }

    addInvalidIntersectionMarkers(records, innerWidth) {
        if (!records.length) return;

        const halfWidth = innerWidth / 2;
        const size = Math.max(28, numberOr(this.params.thickness, 18) * 2.2);
        const material = new THREE.LineBasicMaterial({
            color: 0x8c1d1d,
            transparent: true,
            opacity: 0.95
        });

        records.forEach(record => {
            const { x, y } = record.center;
            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(x - size, y - size, -halfWidth),
                new THREE.Vector3(x + size, y + size, -halfWidth),
                new THREE.Vector3(x + size, y - size, -halfWidth),
                new THREE.Vector3(x - size, y + size, -halfWidth),
                new THREE.Vector3(x - size, y - size, halfWidth),
                new THREE.Vector3(x + size, y + size, halfWidth),
                new THREE.Vector3(x + size, y - size, halfWidth),
                new THREE.Vector3(x - size, y + size, halfWidth)
            ]);
            const marker = new THREE.LineSegments(geometry, material);
            marker.userData = { selectable: false, warning: record.message };
            this.group.add(marker);
        });
    }

    applyHighlights() {
        const selectedId = this.selectedPanelId;

        this.panelMeshes.forEach(mesh => {
            if (mesh.userData.edges) {
                mesh.remove(mesh.userData.edges);
                mesh.userData.edges.geometry.dispose();
                mesh.userData.edges.material.dispose();
                mesh.userData.edges = null;
            }

            const isSelected = mesh.userData.id === selectedId;
            const hasWarning = Boolean(mesh.userData.warnings?.length || mesh.userData.invalidIntersections?.length);
            const edgesGeom = new THREE.EdgesGeometry(mesh.geometry, 5);
            const lineMat = new THREE.LineBasicMaterial({
                color: isSelected ? 0x111111 : (hasWarning ? 0x8c1d1d : this.edgeColor),
                transparent: true,
                opacity: isSelected ? 1 : (hasWarning ? 0.95 : 0.58)
            });
            const edgeLine = new THREE.LineSegments(edgesGeom, lineMat);
            edgeLine.visible = this.showEdges || isSelected;
            mesh.add(edgeLine);
            mesh.userData.edges = edgeLine;
        });
    }

    resolveExplodedPanelOverlaps(explodeRatio) {
        const ratio = clamp(Number(explodeRatio) || 0, 0, 1);
        if (ratio <= 0 || this.panelMeshes.length < 2) return;
        const clearance = 18 * ratio;
        const iterations = Math.max(1, Math.ceil(ratio * 16));

        for (let iteration = 0; iteration < iterations; iteration++) {
            let adjusted = false;
            this.group.updateMatrixWorld(true);
            const bounds = this.panelMeshes.map(mesh => (
                mesh.visible ? new THREE.Box3().setFromObject(mesh) : null
            ));
            for (let first = 0; first < this.panelMeshes.length; first++) {
                for (let second = first + 1; second < this.panelMeshes.length; second++) {
                    const a = this.panelMeshes[first];
                    const b = this.panelMeshes[second];
                    if (!a.visible || !b.visible) continue;
                    const boxA = bounds[first];
                    const boxB = bounds[second];
                    const overlap = {
                        x: Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x),
                        y: Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y),
                        z: Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z)
                    };
                    if (overlap.x <= 0.5 || overlap.y <= 0.5 || overlap.z <= 0.5) continue;
                    const axis = overlap.x <= overlap.y && overlap.x <= overlap.z
                        ? 'x'
                        : (overlap.y <= overlap.z ? 'y' : 'z');
                    const centerA = (boxA.min[axis] + boxA.max[axis]) / 2;
                    const centerB = (boxB.min[axis] + boxB.max[axis]) / 2;
                    let direction = Math.sign(centerB - centerA);
                    if (!direction) {
                        direction = Math.sign(
                            Number(b.userData.explosionVector?.[axis] || 0)
                            - Number(a.userData.explosionVector?.[axis] || 0)
                        ) || (String(a.userData.id).localeCompare(String(b.userData.id)) <= 0 ? 1 : -1);
                    }
                    const shift = (overlap[axis] * ratio + clearance) / 2;
                    a.position[axis] -= direction * shift;
                    b.position[axis] += direction * shift;
                    boxA.min[axis] -= direction * shift;
                    boxA.max[axis] -= direction * shift;
                    boxB.min[axis] += direction * shift;
                    boxB.max[axis] += direction * shift;
                    adjusted = true;
                }
            }
            if (!adjusted) break;
        }
    }

    selectPanel(panelId) {
        if (panelId === this.selectedPanelId) return;
        const previousPanelId = this.selectedPanelId;
        this.selectedPanelId = panelId;
        [previousPanelId, panelId].filter(Boolean).forEach(id => {
            const mesh = this.getPanelById(id);
            if (!mesh) return;
            const priorMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            const materials = this.getPanelMaterial(
                id,
                mesh.userData.lengthMm || mesh.userData.length || 1,
                mesh.userData.widthMm || mesh.userData.width || 1,
                id === 'side_left' || id === 'side_right'
            );
            mesh.material = [materials.mainMat, materials.edgeMat];
            priorMaterials.filter(Boolean).forEach(material => material.dispose?.());
        });
        this.panelMeshes.forEach(mesh => {
            const edges = mesh.userData.edges;
            if (!edges) return;
            const selected = mesh.userData.id === this.selectedPanelId;
            const hasWarning = Boolean(mesh.userData.warnings?.length || mesh.userData.invalidIntersections?.length);
            edges.material.color.setHex(selected ? 0x111111 : (hasWarning ? 0x8c1d1d : this.edgeColor));
            edges.material.opacity = selected ? 1 : (hasWarning ? 0.95 : 0.58);
            edges.visible = this.showEdges || selected;
            edges.material.needsUpdate = true;
        });
        this.onChange?.();
    }
}
