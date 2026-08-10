export const JOINERY_SCHEMA_VERSION = 1;

export const JOINERY_STRATEGIES = Object.freeze({
    mitre: Object.freeze({ id: 'mitre', name: 'Mitre', generatedOperations: [] }),
    buttScrews: Object.freeze({ id: 'buttScrews', name: 'Butt joint with screws', generatedOperations: ['drill', 'pocket'] }),
    cleat: Object.freeze({ id: 'cleat', name: 'Screw cleat', generatedOperations: ['drill', 'reference'] }),
    dado: Object.freeze({ id: 'dado', name: 'Dado', generatedOperations: ['pocket'] }),
    rabbet: Object.freeze({ id: 'rabbet', name: 'Rabbet', generatedOperations: ['pocket'] }),
    dowel: Object.freeze({ id: 'dowel', name: 'Dowel', generatedOperations: ['drill'] }),
    tabSlot: Object.freeze({ id: 'tabSlot', name: 'Tab and slot', generatedOperations: ['throughCut'] })
});

export const DEFAULT_PROCESS_PROFILES = Object.freeze({
    nominal: processProfile({ id: 'nominal', name: 'Nominal geometry', kind: 'nominal', kerfMm: 0, toolDiameterMm: 0 }),
    router6: processProfile({ id: 'router-6mm', name: '6 mm router', kind: 'router', toolDiameterMm: 6, dogbones: true, holdingTabs: true }),
    laser: processProfile({ id: 'laser-generic', name: 'Generic laser', kind: 'laser', kerfMm: 0.2, toolDiameterMm: 0, dogbones: false, holdingTabs: false })
});

export function applyJoineryStrategies(manifest, assignments = {}, settings = {}) {
    const result = clone(manifest);
    const parts = new Map((result.parts || []).map(part => [part.id, part]));
    const findings = [];
    result.operations ||= [];
    result.joints = (result.joints || []).map((joint, index) => {
        const assignment = assignments[joint.id] || assignments[joint.pointName] || {};
        const strategyId = assignment.strategy || joint.strategy || inferStrategy(joint);
        const strategy = JOINERY_STRATEGIES[strategyId] || JOINERY_STRATEGIES.mitre;
        const normalized = { ...joint, id: joint.id || `joint-${index + 1}`, strategy: strategy.id, clearanceMm: finite(assignment.clearanceMm, settings.clearanceMm ?? 0.2) };
        const operations = generateJointOperations(normalized, parts, assignment, settings);
        if (operations.length === 0 && strategy.generatedOperations.length && !resolveJointGeometry(normalized)) {
            findings.push(finding(
                'JOINERY_EDGE_GEOMETRY_MISSING', 'warning', normalized.partIds || [],
                `${strategy.name} at ${normalized.pointName || normalized.id} needs panel-local edge geometry before machining operations can be generated.`,
                'Use the annotated joint schedule or define the mating edge geometry.'
            ));
        }
        operations.forEach(operation => {
            const part = parts.get(operation.partId);
            if (part && !result.operations.some(existing => existing.id === operation.id)) {
                result.operations.push(operation);
                if (!(part.operationIds ||= []).includes(operation.id)) part.operationIds.push(operation.id);
            }
        });
        normalized.generatedOperationIds = operations.map(operation => operation.id);
        return normalized;
    });
    result.joinery = { version: JOINERY_SCHEMA_VERSION, assignments: clone(assignments), settings: clone(settings) };
    result.diagnostics = [...(result.diagnostics || []), ...findings];
    return { manifest: result, findings };
}

export function createProcessProfile(input = {}) {
    return processProfile(input);
}

export function deriveProcessManifest(manifest, processInput = DEFAULT_PROCESS_PROFILES.nominal) {
    const process = processProfile(processInput);
    const result = clone(manifest);
    const findings = [];
    result.processProfile = process;

    const derivedOperations = [];
    let dogboneOperationCount = 0;
    let holdingTabProfileCount = 0;
    (result.operations || []).forEach(operation => {
            const sourceGeometry = process.kind === 'laser' ? resolveOperationGeometry(result, operation) : operation.geometry;
            const copy = { ...operation, geometry: clone(sourceGeometry), nominalGeometry: clone(operation.geometry), process: { profileId: process.id } };
            if (process.kind === 'laser' && process.kerfMm > 0 && ['profileCut', 'throughCut'].includes(operation.type)) {
                copy.process.kerfCompensationMm = process.kerfMm / 2;
                copy.process.compensationSide = operation.type === 'profileCut' ? 'outside' : 'inside';
                const compensation = operation.type === 'profileCut' ? process.kerfMm / 2 : -process.kerfMm / 2;
                const compensated = compensateGeometry(copy.geometry, compensation);
                if (compensated) {
                    copy.geometry = compensated;
                    copy.process.vectorCompensated = true;
                } else {
                    findings.push(finding(
                        'PROCESS_COMPENSATION_UNSUPPORTED', 'warning', [operation.partId].filter(Boolean),
                        `${operation.id} cannot be vector-compensated from its current geometry.`,
                        'Apply kerf compensation in the destination CAM package or use an explicit closed contour.'
                    ));
                }
            }
            if (process.kind === 'router' && process.dogbones && operation.type === 'throughCut') {
                const dogboneGeometry = resolveOperationGeometry(result, operation);
                const dogbonePoints = dogboneGeometry.kind === 'rect'
                    ? rectangleGeometryPoints(dogboneGeometry)
                    : dogboneGeometry.points;
                const dogbones = generateDogbones(dogbonePoints || [], process.toolDiameterMm);
                dogboneOperationCount += dogbones.length;
                derivedOperations.push(...dogbones.map((geometry, index) => ({
                    id: `${operation.id}:dogbone:${index + 1}`,
                    type: 'throughCut',
                    partId: operation.partId,
                    geometry,
                    derivedFrom: operation.id,
                    process: { profileId: process.id, purpose: 'inside-corner-relief' }
                })));
            }
            if (process.holdingTabs && operation.type === 'profileCut') {
                holdingTabProfileCount += 1;
                copy.process.holdingTabs = {
                    count: Math.max(process.tabCountMinimum, Math.ceil(inferPerimeter(operation.geometry) / process.tabSpacingMm)),
                    widthMm: process.tabWidthMm,
                    heightMm: process.tabHeightMm
                };
            }
            derivedOperations.push(copy);
    });
    result.operations = derivedOperations;
    (result.parts || []).forEach(part => {
        part.operationIds = result.operations.filter(operation => operation.partId === part.id).map(operation => operation.id);
    });

    if (process.kind !== 'nominal') {
        findings.push(finding(
            'PROCESS_DERIVED_GEOMETRY', 'info', [],
            `${process.name} settings have been applied to the manufacturing guidance without changing the original part geometry.`,
            'Verify compensation and holding choices in the destination CAM package.'
        ));
    }
    if (process.kind === 'router' && process.dogbones) {
        findings.push(finding(
            'PROCESS_DOGBONE_GUIDANCE', 'info', [],
            `${dogboneOperationCount} dogbone relief operation${dogboneOperationCount === 1 ? '' : 's'} were derived for convex corners in closed polygonal or rectangular through-cuts.`,
            'Verify relief direction and fit in downstream CAM; circles, open paths, and unsupported primitives are left unchanged.'
        ));
    }
    if (process.holdingTabs && holdingTabProfileCount) {
        findings.push(finding(
            'PROCESS_HOLDING_TABS_CAM_REQUIRED', 'info', [],
            `Holding-tab counts and dimensions were recorded for ${holdingTabProfileCount} profile operation${holdingTabProfileCount === 1 ? '' : 's'}, but SVG/DXF profiles remain closed nominal vectors.`,
            'Place and verify tab spans in downstream CAM; this package does not emit open toolpaths or machine instructions.'
        ));
    }
    result.diagnostics = [...(result.diagnostics || []), ...findings];
    return { manifest: result, findings };
}

function resolveOperationGeometry(manifest, operation) {
    const geometry = operation.geometry || {};
    if (geometry.kind !== 'contour' || Array.isArray(geometry.points)) return geometry;
    const contour = (manifest.contours || []).find(item => item.id === geometry.contourId);
    return contour ? { ...geometry, points: clone(contour.points || []) } : geometry;
}

function compensateGeometry(geometry, offsetMm) {
    if (!geometry || !Number.isFinite(offsetMm)) return null;
    if (geometry.kind === 'circle') {
        const radius = finite(geometry.radiusMm ?? Number(geometry.diameterMm) / 2, 0) + offsetMm;
        if (radius <= 0.01) return null;
        const result = { ...geometry, radiusMm: radius };
        if ('diameterMm' in result) result.diameterMm = radius * 2;
        return result;
    }
    if (geometry.kind === 'rect') {
        const widthMm = finite(geometry.widthMm, 0) + offsetMm * 2;
        const heightMm = finite(geometry.heightMm, 0) + offsetMm * 2;
        if (widthMm <= 0.01 || heightMm <= 0.01) return null;
        const result = { ...geometry, widthMm, heightMm };
        if (geometry.cornerRadiusMm !== undefined) result.cornerRadiusMm = Math.max(0, finite(geometry.cornerRadiusMm, 0) + offsetMm);
        return result;
    }
    if (Array.isArray(geometry.points) && geometry.points.length >= 3) {
        const points = offsetPolygon(geometry.points.map(point), offsetMm);
        return points ? { ...geometry, points } : null;
    }
    return null;
}

function offsetPolygon(points, distance) {
    if (Math.abs(distance) < 1e-9) return points.map(value => ({ xMm: value.x, yMm: value.y }));
    const signedArea = points.reduce((sum, value, index) => {
        const next = points[(index + 1) % points.length];
        return sum + value.x * next.y - next.x * value.y;
    }, 0) / 2;
    if (Math.abs(signedArea) < 1e-8) return null;
    const winding = signedArea > 0 ? 1 : -1;
    const lines = points.map((start, index) => {
        const end = points[(index + 1) % points.length];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1e-8) return null;
        const normal = winding > 0 ? { x: dy / length, y: -dx / length } : { x: -dy / length, y: dx / length };
        return {
            start: { x: start.x + normal.x * distance, y: start.y + normal.y * distance },
            direction: { x: dx, y: dy }
        };
    });
    if (lines.some(line => !line)) return null;
    return lines.map((line, index) => {
        const previous = lines[(index - 1 + lines.length) % lines.length];
        const intersection = lineIntersection(previous, line);
        const fallback = points[index];
        const value = intersection && Math.hypot(intersection.x - fallback.x, intersection.y - fallback.y) <= Math.max(50, Math.abs(distance) * 20)
            ? intersection
            : { x: fallback.x, y: fallback.y };
        return { xMm: value.x, yMm: value.y };
    });
}

function lineIntersection(first, second) {
    const denominator = first.direction.x * second.direction.y - first.direction.y * second.direction.x;
    if (Math.abs(denominator) < 1e-10) return null;
    const dx = second.start.x - first.start.x;
    const dy = second.start.y - first.start.y;
    const t = (dx * second.direction.y - dy * second.direction.x) / denominator;
    return { x: first.start.x + first.direction.x * t, y: first.start.y + first.direction.y * t };
}

function generateJointOperations(joint, parts, assignment, settings) {
    const geometry = resolveJointGeometry(joint);
    if (!geometry) return [];
    const partIds = joint.partIds || [joint.partAId, joint.partBId].filter(Boolean);
    const hostId = assignment.hostPartId || partIds[0];
    const mateId = partIds.find(id => id !== hostId) || partIds[1];
    const host = parts.get(hostId);
    const mate = parts.get(mateId);
    if (!host) return [];
    const mateThickness = finite(mate?.thicknessMm ?? mate?.thickness, finite(host.thicknessMm ?? host.thickness, 18));
    const clearance = finite(joint.clearanceMm, 0.2);
    const depth = finite(assignment.depthMm, mateThickness * 0.4);
    const length = Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y);
    const centre = { xMm: (geometry.start.x + geometry.end.x) / 2, yMm: (geometry.start.y + geometry.end.y) / 2 };
    const rotationDeg = Math.atan2(geometry.end.y - geometry.start.y, geometry.end.x - geometry.start.x) * 180 / Math.PI;
    const prefix = `${joint.id}:${joint.strategy}`;

    if (joint.strategy === 'dado' || joint.strategy === 'rabbet') {
        return [{
            id: `${prefix}:pocket`, type: 'pocket', partId: hostId, depthMm: Math.min(depth, finite(host.thicknessMm ?? host.thickness, 18) * 0.75),
            geometry: { kind: 'rect', ...centre, widthMm: length, heightMm: mateThickness + clearance * 2, rotationDeg }
        }];
    }
    if (joint.strategy === 'dowel') {
        const spacing = Math.max(60, finite(assignment.spacingMm, 120));
        const count = Math.max(2, Math.floor(length / spacing) + 1);
        return Array.from({ length: count }, (_, index) => {
            const t = count === 1 ? 0.5 : index / (count - 1);
            return {
                id: `${prefix}:dowel:${index + 1}`, type: 'drill', partId: hostId, depthMm: finite(assignment.dowelDepthMm, 12),
                geometry: { kind: 'circle', xMm: geometry.start.x + (geometry.end.x - geometry.start.x) * t, yMm: geometry.start.y + (geometry.end.y - geometry.start.y) * t, diameterMm: finite(assignment.dowelDiameterMm, 8) }
            };
        });
    }
    if (joint.strategy === 'buttScrews' || joint.strategy === 'cleat') {
        const spacing = Math.max(80, finite(assignment.spacingMm, settings.screwSpacingMm ?? 150));
        const count = Math.max(2, Math.floor(length / spacing) + 1);
        return Array.from({ length: count }, (_, index) => {
            const t = (index + 1) / (count + 1);
            return {
                id: `${prefix}:pilot:${index + 1}`, type: 'drill', partId: hostId, depthMm: finite(assignment.pilotDepthMm, 12),
                geometry: { kind: 'circle', xMm: geometry.start.x + (geometry.end.x - geometry.start.x) * t, yMm: geometry.start.y + (geometry.end.y - geometry.start.y) * t, diameterMm: finite(assignment.pilotDiameterMm, 3) }
            };
        });
    }
    if (joint.strategy === 'tabSlot') {
        const tabWidth = Math.max(20, finite(assignment.tabWidthMm, 50));
        const count = Math.max(1, Math.floor(length / (tabWidth * 2)));
        return Array.from({ length: count }, (_, index) => {
            const t = (index + 0.5) / count;
            return {
                id: `${prefix}:slot:${index + 1}`, type: 'throughCut', partId: hostId,
                geometry: { kind: 'rect', xMm: geometry.start.x + (geometry.end.x - geometry.start.x) * t, yMm: geometry.start.y + (geometry.end.y - geometry.start.y) * t, widthMm: tabWidth + clearance * 2, heightMm: mateThickness + clearance * 2, rotationDeg }
            };
        });
    }
    return [];
}

function resolveJointGeometry(joint) {
    const geometry = joint.edgeGeometry || joint.geometry;
    if (geometry?.start && geometry?.end) return { start: point(geometry.start), end: point(geometry.end) };
    if (Array.isArray(geometry?.points) && geometry.points.length >= 2) return { start: point(geometry.points[0]), end: point(geometry.points.at(-1)) };
    return null;
}

function generateDogbones(points, toolDiameterMm) {
    if (!Array.isArray(points) || points.length < 3 || toolDiameterMm <= 0) return [];
    const radius = toolDiameterMm / 2;
    const result = [];
    const normalized = points.map(point);
    const winding = normalized.reduce((sum, current, index) => {
        const next = normalized[(index + 1) % normalized.length];
        return sum + current.x * next.y - next.x * current.y;
    }, 0) >= 0 ? 1 : -1;
    for (let index = 0; index < points.length; index++) {
        const previous = normalized[(index - 1 + normalized.length) % normalized.length];
        const current = normalized[index];
        const next = normalized[(index + 1) % normalized.length];
        const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x);
        if (cross * winding <= 1e-8) continue;
        const first = unit({ x: previous.x - current.x, y: previous.y - current.y });
        const second = unit({ x: next.x - current.x, y: next.y - current.y });
        const bisector = unit({ x: first.x + second.x, y: first.y + second.y });
        result.push({ kind: 'circle', xMm: current.x - bisector.x * radius, yMm: current.y - bisector.y * radius, diameterMm: toolDiameterMm });
    }
    return result;
}

function rectangleGeometryPoints(geometry) {
    const center = point(geometry.center || geometry);
    const halfWidth = finite(geometry.widthMm, 0) / 2;
    const halfHeight = finite(geometry.heightMm, 0) / 2;
    const radians = finite(geometry.rotationDeg, 0) * Math.PI / 180;
    return [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight }
    ].map(value => ({
        x: center.x + value.x * Math.cos(radians) - value.y * Math.sin(radians),
        y: center.y + value.x * Math.sin(radians) + value.y * Math.cos(radians)
    }));
}

function processProfile(input) {
    return Object.freeze({
        id: safeId(input.id || input.name || 'process'),
        name: String(input.name || 'Process profile'),
        kind: ['nominal', 'router', 'laser'].includes(input.kind) ? input.kind : 'nominal',
        toolDiameterMm: Math.max(0, finite(input.toolDiameterMm, 0)),
        kerfMm: Math.max(0, finite(input.kerfMm, 0)),
        dogbones: Boolean(input.dogbones),
        holdingTabs: Boolean(input.holdingTabs),
        tabWidthMm: Math.max(1, finite(input.tabWidthMm, 8)),
        tabHeightMm: Math.max(0.1, finite(input.tabHeightMm, 2)),
        tabSpacingMm: Math.max(100, finite(input.tabSpacingMm, 450)),
        tabCountMinimum: Math.max(2, Math.round(finite(input.tabCountMinimum, 4)))
    });
}

function inferStrategy(joint) {
    const type = String(joint.type || '').toLowerCase();
    if (type.includes('dado')) return 'dado';
    if (type.includes('tab') || type.includes('slot')) return 'tabSlot';
    if (type.includes('rabbet')) return 'rabbet';
    return type.includes('butt') ? 'buttScrews' : type.includes('mitre') ? 'mitre' : 'cleat';
}

function inferPerimeter(geometry) {
    if (geometry?.kind === 'circle') return Math.PI * Number(geometry.diameterMm || 0);
    const points = geometry?.points;
    if (Array.isArray(points) && points.length > 1) return points.reduce((sum, value, index) => {
        const a = point(value);
        const b = point(points[(index + 1) % points.length]);
        return sum + Math.hypot(b.x - a.x, b.y - a.y);
    }, 0);
    return 2 * (Number(geometry?.widthMm || 0) + Number(geometry?.heightMm || 0));
}

function point(value) {
    if (Array.isArray(value)) return { x: Number(value[0]) || 0, y: Number(value[1]) || 0 };
    return { x: Number(value?.x ?? value?.xMm) || 0, y: Number(value?.y ?? value?.yMm) || 0 };
}

function unit(vector) {
    const length = Math.hypot(vector.x, vector.y) || 1;
    return { x: vector.x / length, y: vector.y / length };
}

function finding(code, severity, partIds, message, remedy) {
    return { code, severity, partIds, message, remedy };
}

function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function safeId(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'profile';
}

function clone(value) {
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
