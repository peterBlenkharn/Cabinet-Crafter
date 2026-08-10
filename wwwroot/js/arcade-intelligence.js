import {
    BUILT_IN_HARDWARE_DEFINITIONS,
    instantiateHardware,
    normalizeHardwareLibrary,
    validateHardwareInstances,
    buildHardwareSchedule,
    buildWiringPlan
} from './hardware-library.js';
import { enrichManifestParts } from './manifest-utils.js';
import { analyzeErgonomics, compareErgonomicProfiles } from './ergonomics.js';
import { generateAssemblyPlan, calculateTMoulding } from './assembly.js';

export const ARCADE_INTELLIGENCE_VERSION = 1;

export function analyzeArcadeBuild(manifest, params = manifest?.parameters || {}, options = {}) {
    const parts = enrichManifestParts(manifest);
    const hardwareLibrary = options.hardwareLibrary
        || normalizeHardwareLibrary(params?.hardwareDefinitions || manifest?.parameters?.hardwareDefinitions || []);
    const hardwareInstances = options.hardwareInstances || mergeHardwareInstances(
        manifest?.hardwareInstances || [],
        inferHardwareInstances(manifest, hardwareLibrary)
    );
    const hardwareFindings = validateHardwareInstances(hardwareInstances, parts, hardwareLibrary);
    const relationshipFindings = validateArcadeRelationships(hardwareInstances, hardwareLibrary, params, options);
    const hardwareSchedule = buildHardwareSchedule(hardwareInstances, hardwareLibrary);
    const wiring = buildWiringPlan(hardwareInstances, hardwareLibrary);
    const ergonomics = analyzeErgonomics(params, {
        profilePoints: options.profilePoints,
        viewerDistanceMm: options.viewerDistanceMm,
        profiles: options.ergonomicProfiles
    });
    const ergonomicComparison = compareErgonomicProfiles(ergonomics);
    const assembly = generateAssemblyPlan(manifest, { projectName: manifest?.project?.name });
    const tMoulding = calculateTMoulding(manifest, options.edgeAssignments || defaultTMouldingAssignments(manifest), options.tMoulding);
    const findings = [
        ...hardwareFindings,
        ...relationshipFindings,
        ...ergonomics.findings
    ];

    return {
        version: ARCADE_INTELLIGENCE_VERSION,
        hardwareInstances,
        hardwareSchedule,
        wiring,
        ergonomics,
        ergonomicComparison,
        assembly,
        tMoulding,
        findings,
        summary: {
            hardwareItems: hardwareInstances.length,
            wiringConnections: wiring.connections.length,
            harnessLengthM: wiring.estimatedHarnessLengthM,
            assemblySteps: assembly.steps.length,
            tMouldingLengthM: Math.ceil(tMoulding.totalOrderLengthMm / 100) / 10,
            errors: findings.filter(item => item.severity === 'error').length,
            warnings: findings.filter(item => item.severity === 'warning').length
        }
    };
}

function mergeHardwareInstances(authoritative = [], inferred = []) {
    const instances = new Map();
    [...authoritative, ...inferred].forEach(instance => {
        if (instance?.id && !instances.has(instance.id)) instances.set(instance.id, { ...instance });
    });
    return [...instances.values()];
}

export function validateArcadeRelationships(instances = [], library = BUILT_IN_HARDWARE_DEFINITIONS, params = {}, options = {}) {
    const definitions = new Map(library.map(item => [item.id, item]));
    const findings = [];
    const resolved = instances
        .map(instance => ({ instance, definition: definitions.get(instance.definitionId) }))
        .filter(item => item.definition);

    const joysticksByPanel = groupBy(
        resolved.filter(item => item.definition.category === 'joystick'),
        item => item.instance.partId
    );
    const minimumPlayerSpacingMm = Math.max(0, Number(options.minimumPlayerSpacingMm) || 260);
    joysticksByPanel.forEach(items => {
        for (let first = 0; first < items.length; first++) {
            for (let second = first + 1; second < items.length; second++) {
                const distance = instanceDistance(items[first].instance, items[second].instance);
                if (distance < minimumPlayerSpacingMm) findings.push(relationshipFinding(
                    'PLAYER_CONTROL_SPACING', 'warning', [items[first].instance.partId],
                    `${items[first].instance.label} and ${items[second].instance.label} are ${round(distance, 1)} mm apart; the configured player-spacing target is ${minimumPlayerSpacingMm} mm.`,
                    'Increase player spacing or validate the control panel with a full-size mock-up.'
                ));
            }
        }
    });

    for (let first = 0; first < resolved.length; first++) {
        for (let second = first + 1; second < resolved.length; second++) {
            const a = resolved[first];
            const b = resolved[second];
            if (a.instance.partId !== b.instance.partId) continue;
            const aMovement = a.definition.movementEnvelope;
            const bMovement = b.definition.movementEnvelope;
            const swingSensitive = a.definition.category === 'trackball' || b.definition.category === 'trackball';
            if (swingSensitive && (aMovement || bMovement) && envelopesOverlap(
                a.instance, aMovement || a.definition.keepout,
                b.instance, bMovement || b.definition.keepout
            )) {
                findings.push(relationshipFinding(
                    'HARDWARE_MOVEMENT_CONFLICT', 'error', [a.instance.partId],
                    `${a.instance.label} and ${b.instance.label} have overlapping movement or swing envelopes.`,
                    'Move the controls apart and verify underside movement with the actual hardware.'
                ));
            }
            const aService = a.definition.serviceEnvelope;
            const bService = b.definition.serviceEnvelope;
            if ((aService || bService) && envelopesOverlap(
                a.instance, aService || a.definition.keepout,
                b.instance, bService || b.definition.keepout
            )) {
                findings.push(relationshipFinding(
                    'HARDWARE_SERVICE_ACCESS', 'warning', [a.instance.partId],
                    `${a.instance.label} and ${b.instance.label} have overlapping maintenance envelopes.`,
                    'Confirm the service sequence and leave room for tools, connectors, and removal.'
                ));
            }
        }
    }

    resolved.filter(item => item.definition.category === 'monitor').forEach(({ instance, definition }) => {
        const availableDepthMm = Number(options.monitorDepthMm ?? params.bezelDepth ?? params.monitorDepth);
        if (!Number.isFinite(availableDepthMm) || availableDepthMm <= 0) return;
        const bodyDepthMm = Number(definition.body?.depthMm) || 0;
        const recommendedDepthMm = Math.max(bodyDepthMm, Number(definition.cableExit?.clearanceMm) || 0);
        if (availableDepthMm + 0.01 < bodyDepthMm) findings.push(relationshipFinding(
            'MONITOR_DEPTH_COLLISION', 'error', [instance.partId],
            `${definition.name} is ${bodyDepthMm} mm deep but only ${availableDepthMm} mm is available.`,
            'Increase the monitor recess or choose a shallower display.',
            'bezelDepth'
        ));
        else if (availableDepthMm + 0.01 < recommendedDepthMm) findings.push(relationshipFinding(
            'MONITOR_CABLE_CLEARANCE', 'warning', [instance.partId],
            `${definition.name} fits physically, but ${recommendedDepthMm} mm is recommended for its cable exit and ${availableDepthMm} mm is available.`,
            'Use a low-profile connector or increase rear clearance.',
            'bezelDepth'
        ));
    });

    const heatSources = resolved.filter(item => ['computer', 'electronics', 'power'].includes(item.definition.category));
    const ventilation = resolved.filter(item => item.definition.category === 'ventilation');
    if (heatSources.length && !ventilation.length) findings.push(relationshipFinding(
        'VENTILATION_NOT_DEFINED', 'warning', [...new Set(heatSources.map(item => item.instance.partId))],
        `${heatSources.length} powered internal item${heatSources.length === 1 ? '' : 's'} are defined without a fan or airflow component.`,
        'Add intake/exhaust hardware and confirm a clear airflow path.'
    ));

    const encoders = resolved.filter(item => item.definition.category === 'electronics' && item.definition.id.includes('encoder'));
    if (encoders.length) {
        const unassigned = resolved.filter(item => ['button', 'joystick'].includes(item.definition.category) && !item.instance.encoderInput);
        if (unassigned.length) findings.push(relationshipFinding(
            'ENCODER_INPUT_UNASSIGNED', 'warning', [...new Set(unassigned.map(item => item.instance.partId))],
            `${unassigned.length} control${unassigned.length === 1 ? '' : 's'} have no encoder-input assignment.`,
            'Assign each switch/direction to an encoder input before wiring.'
        ));
    }

    return dedupeRelationshipFindings(findings);
}

export function augmentManifestWithArcadeIntelligence(manifest, params, options = {}) {
    const result = typeof structuredClone === 'function' ? structuredClone(manifest) : JSON.parse(JSON.stringify(manifest));
    const intelligence = analyzeArcadeBuild(result, params, options);
    result.arcade = {
        version: intelligence.version,
        hardwareInstances: intelligence.hardwareInstances,
        hardwareSchedule: intelligence.hardwareSchedule,
        wiring: intelligence.wiring,
        ergonomics: intelligence.ergonomics,
        assembly: intelligence.assembly,
        tMoulding: intelligence.tMoulding,
        findings: intelligence.findings
    };
    // FabricationManifestV1 deliberately keeps renderer/source diagnostics as
    // a structured object. Preserve its typed source collections and append a
    // separate portable findings list for derived arcade checks.
    const sourceDiagnostics = result.sourceDiagnostics && !Array.isArray(result.sourceDiagnostics)
        ? result.sourceDiagnostics
        : {};
    result.sourceDiagnostics = {
        ...sourceDiagnostics,
        findings: [...(Array.isArray(sourceDiagnostics.findings) ? sourceDiagnostics.findings : []), ...intelligence.findings]
    };
    const existingDiagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
    result.diagnostics = [...existingDiagnostics, ...intelligence.findings];
    return { manifest: result, intelligence };
}

export function inferHardwareInstances(manifest, library = BUILT_IN_HARDWARE_DEFINITIONS) {
    const available = new Set(library.map(item => item.id));
    const instances = new Map();
    (manifest?.operations || []).filter(operation => {
        const purpose = String(operation.purpose || '').toLowerCase();
        return purpose.includes('button') || purpose.includes('joystick') || purpose === 'monitor' || operation.hardwareDefinitionId;
    }).map((operation, index) => {
        const definitionId = resolveDefinitionId(operation, available);
        const center = operation.geometry?.center || contourCentre(manifest, operation.geometry?.contourId);
        return instantiateHardware(definitionId, {
            id: operation.hardwareInstanceId || `inferred-${operation.id || index + 1}`,
            partId: operation.partId,
            xMm: Number(center?.xMm) || 0,
            yMm: Number(center?.yMm) || 0,
            label: operation.label || readablePurpose(operation.purpose),
            encoderInput: operation.encoderInput || null
        }, library);
    }).forEach(instance => {
        if (!instances.has(instance.id)) instances.set(instance.id, instance);
    });
    return [...instances.values()];
}

function resolveDefinitionId(operation, available) {
    if (operation.hardwareDefinitionId && available.has(operation.hardwareDefinitionId)) return operation.hardwareDefinitionId;
    const purpose = String(operation.purpose || '').toLowerCase();
    if (purpose.includes('joystick')) return 'joystick-jlf-pattern';
    if (purpose === 'monitor') return 'monitor-24-vesa100';
    const radius = Number(operation.geometry?.radiusMm) || 15;
    return radius <= 13 ? 'button-24-snap' : 'button-30-snap';
}

function contourCentre(manifest, contourId) {
    const contour = (manifest?.contours || []).find(item => item.id === contourId);
    if (!contour?.points?.length) return { xMm: 0, yMm: 0 };
    return contour.points.reduce((sum, point) => ({
        xMm: sum.xMm + Number(point.xMm || 0) / contour.points.length,
        yMm: sum.yMm + Number(point.yMm || 0) / contour.points.length
    }), { xMm: 0, yMm: 0 });
}

function defaultTMouldingAssignments(manifest) {
    const assignments = {};
    (manifest?.parts || []).filter(part => ['side_left', 'side_right'].includes(part.id)).forEach(part => {
        const contour = (manifest.contours || []).find(item => item.id === part.contourIds?.[0]);
        assignments[part.id] = [{
            edgeId: 'perimeter',
            lengthMm: contourPerimeter(contour),
            widthMm: part.thicknessMm,
            slotWidthMm: 1.6
        }];
    });
    return assignments;
}

function contourPerimeter(contour) {
    const points = contour?.points || [];
    return points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + Math.hypot(Number(next.xMm) - Number(point.xMm), Number(next.yMm) - Number(point.yMm));
    }, 0);
}

function readablePurpose(value) {
    return String(value || 'hardware').replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function groupBy(items, keySelector) {
    const groups = new Map();
    items.forEach(item => {
        const key = keySelector(item);
        const group = groups.get(key) || [];
        group.push(item);
        groups.set(key, group);
    });
    return groups;
}

function instanceDistance(a, b) {
    return Math.hypot(Number(a.xMm) - Number(b.xMm), Number(a.yMm) - Number(b.yMm));
}

function envelopesOverlap(instanceA, envelopeA, instanceB, envelopeB) {
    const halfAw = Number(envelopeA?.widthMm) / 2 || 0;
    const halfAh = Number(envelopeA?.heightMm) / 2 || 0;
    const halfBw = Number(envelopeB?.widthMm) / 2 || 0;
    const halfBh = Number(envelopeB?.heightMm) / 2 || 0;
    return Math.abs(Number(instanceA.xMm) - Number(instanceB.xMm)) < halfAw + halfBw
        && Math.abs(Number(instanceA.yMm) - Number(instanceB.yMm)) < halfAh + halfBh;
}

function relationshipFinding(code, severity, partIds, message, remedy, field = null) {
    return {
        code,
        severity,
        partIds: [...new Set((partIds || []).filter(Boolean))],
        message,
        remedy,
        ...(field ? { field } : {})
    };
}

function dedupeRelationshipFindings(findings) {
    const seen = new Set();
    return findings.filter(item => {
        const key = `${item.code}|${item.partIds.join('|')}|${item.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function round(value, precision = 1) {
    const factor = 10 ** precision;
    return Math.round((Number(value) || 0) * factor) / factor;
}
