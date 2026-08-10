export const DEFAULT_SIDE_PROFILE_CUSTOMIZATION = Object.freeze({
    enabled: false,
    linked: true,
    shared: null,
    left: null,
    right: null
});

export const SIDE_PROFILE_SAMPLING_OPTIONS = Object.freeze({
    toleranceMm: 0.35,
    maxDepth: 12,
    maxPoints: 2048
});

const PROFILE_VERSION = 1;
const MAX_NODES = 64;
export const SIDE_PROFILE_NORMALIZED_LIMIT = 8;
const MODES = new Set(['corner', 'smooth', 'symmetric']);
const EPSILON = 1e-8;

/**
 * Normalizes untrusted project data into the persisted side-profile contract.
 * Anchor and handle coordinates are absolute normalized coordinates relative to
 * the structural polygon bounds. Coordinates outside 0..1 deliberately remain
 * valid so a profile can add decorative material beyond that envelope.
 */
export function normalizeSideProfileCustomization(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        enabled: source.enabled === true,
        linked: source.linked !== false,
        shared: normalizeCurveProfile(source.shared ?? source.profile),
        left: normalizeCurveProfile(source.left),
        right: normalizeCurveProfile(source.right)
    };
}

/** Creates an exact, straight-segment cubic representation of a world-mm polygon. */
export function createCurveFromPolygon(structuralPolygon) {
    const points = cleanPolygon(structuralPolygon).slice(0, MAX_NODES);
    const bounds = polygonBounds(points);
    if (points.length < 3 || !bounds || bounds.width <= EPSILON || bounds.height <= EPSILON) return null;

    return {
        version: PROFILE_VERSION,
        closed: true,
        nodes: points.map((point, index) => {
            const normalized = {
                x: (point.x - bounds.minX) / bounds.width,
                y: (point.y - bounds.minY) / bounds.height
            };
            return {
                id: `node-${index + 1}`,
                x: normalized.x,
                y: normalized.y,
                in: { ...normalized },
                out: { ...normalized },
                mode: 'corner'
            };
        })
    };
}

/**
 * Adaptively flattens a normalized, closed cubic profile into world-mm points.
 * The returned polygon is implicitly closed and does not repeat its first point.
 */
export function sampleCurveProfile(profile, structuralPolygon, options = {}) {
    return sampleCurveProfileResult(profile, structuralPolygon, options).points;
}

function sampleCurveProfileResult(profile, structuralPolygon, options = {}) {
    const curve = normalizeCurveProfile(profile);
    const bounds = polygonBounds(structuralPolygon);
    if (!curve || !bounds || bounds.width <= EPSILON || bounds.height <= EPSILON) {
        return { points: [], truncated: false, depthExceeded: false };
    }

    const toleranceMm = positiveFinite(
        options.toleranceMm ?? options.flatnessMm,
        SIDE_PROFILE_SAMPLING_OPTIONS.toleranceMm
    );
    const maxDepth = integerInRange(options.maxDepth, 1, 16, SIDE_PROFILE_SAMPLING_OPTIONS.maxDepth);
    const maxPoints = integerInRange(options.maxPoints, 16, 8192, SIDE_PROFILE_SAMPLING_OPTIONS.maxPoints);
    const nodes = curve.nodes.map(node => worldNode(node, bounds));
    const sampled = [{ x: nodes[0].x, y: nodes[0].y }];
    const samplingState = { truncated: false, depthExceeded: false };

    for (let index = 0; index < nodes.length && !samplingState.truncated; index += 1) {
        const start = nodes[index];
        const end = nodes[(index + 1) % nodes.length];
        flattenCubic(
            point(start.x, start.y),
            start.out,
            end.in,
            point(end.x, end.y),
            toleranceMm,
            maxDepth,
            maxPoints,
            sampled,
            samplingState
        );
    }

    if (sampled.length > 1 && pointsEqual(sampled[0], sampled[sampled.length - 1])) sampled.pop();
    return {
        points: removeAdjacentDuplicates(sampled),
        truncated: samplingState.truncated,
        depthExceeded: samplingState.depthExceeded
    };
}

/**
 * Verifies that a sampled profile is a simple closed contour which contains the
 * complete structural polygon without allowing either boundary to cross.
 */
export function validateCurveProfile(profile, structuralPolygon, options = {}) {
    const curve = normalizeCurveProfile(profile);
    const structure = cleanPolygon(structuralPolygon);
    const errors = [];
    const warnings = [];

    if (!curve) errors.push(issue('PROFILE_INVALID', 'The profile needs at least three valid curve nodes.'));
    if (structure.length < 3 || !polygonBounds(structure)) {
        errors.push(issue('STRUCTURAL_ENVELOPE_INVALID', 'The structural side envelope is not a valid polygon.'));
    }

    const sampling = curve && structure.length >= 3
        ? sampleCurveProfileResult(curve, structure, options)
        : { points: [], truncated: false, depthExceeded: false };
    const points = sampling.points;

    if (curve && points.length < 3) {
        errors.push(issue('PROFILE_SAMPLING_FAILED', 'The curve could not be sampled into a closed contour.'));
    } else if (points.length >= 3) {
        if (sampling.truncated || sampling.depthExceeded) {
            errors.push(issue(
                'PROFILE_TOO_COMPLEX',
                'The curve is too complex to flatten safely. Reduce extreme handles or remove points.'
            ));
        }
        const areaMm2 = Math.abs(signedArea(points));
        if (areaMm2 <= EPSILON) {
            errors.push(issue('PROFILE_ZERO_AREA', 'The curve must enclose a non-zero area.'));
        }

        const intersection = firstSelfIntersection(points);
        if (intersection) {
            errors.push(issue(
                'PROFILE_SELF_INTERSECTION',
                'The decorative outline crosses itself.',
                { segments: intersection }
            ));
        }

        if (structure.length >= 3) {
            const excluded = structure.filter(candidate => !pointInPolygon(candidate, points));
            const crossing = firstBoundaryCrossing(structure, points);
            const intruding = profileContainmentChecks(points)
                .filter(candidate => pointStrictlyInsidePolygon(candidate, structure));
            if (excluded.length || crossing || intruding.length) {
                errors.push(issue(
                    'PROFILE_EXCLUDES_STRUCTURE',
                    'The decorative outline must contain the complete structural side envelope.',
                    { points: [...excluded, ...intruding], segments: crossing }
                ));
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        points,
        bounds: polygonBounds(points)
    };
}

/**
 * Resolves the profile for one cabinet side and always returns usable geometry.
 * Disabled, missing, or invalid customization falls back to the structural polygon.
 */
export function resolveSideProfile(customization, side, structuralPolygon, options = {}) {
    const normalized = normalizeSideProfileCustomization(customization);
    const structuralPoints = cleanPolygon(structuralPolygon);
    const sideKey = side === 'right' ? 'right' : 'left';

    if (!normalized.enabled) {
        return fallbackResolution(structuralPoints, 'disabled', null);
    }

    const source = normalized.linked ? 'shared' : sideKey;
    const profile = normalized[source];
    if (!profile) {
        return fallbackResolution(structuralPoints, 'missing', null, source);
    }

    const validation = validateCurveProfile(profile, structuralPoints, options);
    if (!validation.valid) {
        return fallbackResolution(structuralPoints, 'invalid', validation, source, profile);
    }

    return {
        points: validation.points,
        profile,
        source,
        customized: true,
        valid: true,
        reason: null,
        validation
    };
}

/** Splits one cubic segment using de Casteljau subdivision without changing it. */
export function splitCurveSegment(profile, segmentRef, t = 0.5) {
    const curve = normalizeCurveProfile(profile);
    if (!curve || curve.nodes.length >= MAX_NODES) return curve;
    const index = resolveNodeIndex(curve.nodes, segmentRef);
    if (index < 0) return curve;

    const ratio = clamp(finiteNumber(t, 0.5), 0.001, 0.999);
    const nextIndex = (index + 1) % curve.nodes.length;
    const start = curve.nodes[index];
    const end = curve.nodes[nextIndex];
    const p0 = point(start.x, start.y);
    const p1 = start.out;
    const p2 = end.in;
    const p3 = point(end.x, end.y);
    const q0 = lerpPoint(p0, p1, ratio);
    const q1 = lerpPoint(p1, p2, ratio);
    const q2 = lerpPoint(p2, p3, ratio);
    const r0 = lerpPoint(q0, q1, ratio);
    const r1 = lerpPoint(q1, q2, ratio);
    const anchor = lerpPoint(r0, r1, ratio);
    const nodes = curve.nodes.map(cloneNode);

    nodes[index].out = q0;
    nodes[nextIndex].in = q2;
    if (nodes[index].mode === 'symmetric') nodes[index].mode = 'smooth';
    if (nodes[nextIndex].mode === 'symmetric') nodes[nextIndex].mode = 'smooth';

    const inserted = {
        id: uniqueNodeId(nodes, `${start.id}-split`),
        x: anchor.x,
        y: anchor.y,
        in: r0,
        out: r1,
        mode: 'smooth'
    };
    nodes.splice(index + 1, 0, inserted);
    return { version: PROFILE_VERSION, closed: true, nodes };
}

/** Removes a node immutably, but never permits a closed profile below three nodes. */
export function deleteCurveNode(profile, nodeRef) {
    const curve = normalizeCurveProfile(profile);
    if (!curve || curve.nodes.length <= 3) return curve;
    const index = resolveNodeIndex(curve.nodes, nodeRef);
    if (index < 0) return curve;
    const nodes = curve.nodes.map(cloneNode);
    nodes.splice(index, 1);
    return { version: PROFILE_VERSION, closed: true, nodes };
}

/**
 * Sets an anchor mode and aligns its opposite handle for smooth/symmetric modes.
 * primaryHandle may be "in", "out", or { primaryHandle: "in" | "out" }.
 */
export function setCurveNodeMode(profile, nodeRef, mode, primaryHandle = 'out') {
    const curve = normalizeCurveProfile(profile);
    if (!curve) return null;
    const index = resolveNodeIndex(curve.nodes, nodeRef);
    if (index < 0 || !MODES.has(mode)) return curve;
    const nodes = curve.nodes.map(cloneNode);
    const node = nodes[index];
    node.mode = mode;
    if (mode === 'corner') return { version: PROFILE_VERSION, closed: true, nodes };

    const requested = typeof primaryHandle === 'object' ? primaryHandle?.primaryHandle : primaryHandle;
    let primaryKey = requested === 'in' ? 'in' : 'out';
    let secondaryKey = primaryKey === 'in' ? 'out' : 'in';
    let vector = subtract(node[primaryKey], node);
    if (vectorLength(vector) <= EPSILON) {
        const alternate = subtract(node[secondaryKey], node);
        if (vectorLength(alternate) > EPSILON) {
            [primaryKey, secondaryKey] = [secondaryKey, primaryKey];
            vector = alternate;
        }
    }

    const primaryLength = vectorLength(vector);
    if (primaryLength > EPSILON) {
        const currentSecondaryLength = vectorLength(subtract(node[secondaryKey], node));
        const secondaryLength = mode === 'symmetric' ? primaryLength : currentSecondaryLength;
        const scale = secondaryLength / primaryLength;
        node[secondaryKey] = {
            x: node.x - vector.x * scale,
            y: node.y - vector.y * scale
        };
    } else {
        const previous = nodes[(index - 1 + nodes.length) % nodes.length];
        const next = nodes[(index + 1) % nodes.length];
        const tangent = subtract(next, previous);
        const tangentLength = vectorLength(tangent);
        const handleLength = Math.min(distance(node, previous), distance(node, next)) / 3;
        if (tangentLength > EPSILON && handleLength > EPSILON) {
            const direction = { x: tangent.x / tangentLength, y: tangent.y / tangentLength };
            node.in = {
                x: node.x - direction.x * handleLength,
                y: node.y - direction.y * handleLength
            };
            node.out = {
                x: node.x + direction.x * handleLength,
                y: node.y + direction.y * handleLength
            };
        }
    }

    return { version: PROFILE_VERSION, closed: true, nodes };
}

export function polygonBounds(polygon) {
    const points = cleanPolygon(polygon);
    if (!points.length) return null;
    const xs = points.map(item => item.x);
    const ys = points.map(item => item.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function normalizeCurveProfile(value) {
    const rawNodes = Array.isArray(value) ? value : value?.nodes;
    if (!Array.isArray(rawNodes)) return null;
    if (rawNodes.length < 3 || rawNodes.length > MAX_NODES) return null;
    const nodes = [];
    const usedIds = new Set();

    for (let index = 0; index < rawNodes.length; index += 1) {
        const source = rawNodes[index];
        if (!source || typeof source !== 'object') return null;
        const anchorSource = source.anchor && typeof source.anchor === 'object' ? source.anchor : source;
        const x = Number(anchorSource.x);
        const y = Number(anchorSource.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (Math.abs(x) > SIDE_PROFILE_NORMALIZED_LIMIT || Math.abs(y) > SIDE_PROFILE_NORMALIZED_LIMIT) return null;
        const anchor = { x, y };
        const handleIn = normalizedPoint(source.in ?? source.handleIn, anchor, true);
        const handleOut = normalizedPoint(source.out ?? source.handleOut, anchor, true);
        if (!handleIn || !handleOut) return null;
        if (![handleIn.x, handleIn.y, handleOut.x, handleOut.y]
            .every(coordinate => Math.abs(coordinate) <= SIDE_PROFILE_NORMALIZED_LIMIT)) return null;
        let id = sanitizeId(source.id, `node-${nodes.length + 1}`);
        id = uniqueStringId(usedIds, id);
        usedIds.add(id);
        nodes.push({
            id,
            x,
            y,
            in: handleIn,
            out: handleOut,
            mode: MODES.has(source.mode) ? source.mode : 'corner'
        });
    }

    if (nodes.length < 3) return null;
    return { version: PROFILE_VERSION, closed: true, nodes };
}

function worldNode(node, bounds) {
    const map = candidate => ({
        x: bounds.minX + candidate.x * bounds.width,
        y: bounds.minY + candidate.y * bounds.height
    });
    return { ...map(node), in: map(node.in), out: map(node.out) };
}

function flattenCubic(p0, p1, p2, p3, tolerance, depth, maxPoints, output, state) {
    if (state.truncated) return;
    if (cubicIsFlat(p0, p1, p2, p3, tolerance)) {
        appendSample(output, p3, maxPoints, state);
        return;
    }
    if (depth <= 0) {
        state.depthExceeded = true;
        appendSample(output, p3, maxPoints, state);
        return;
    }

    const p01 = midpoint(p0, p1);
    const p12 = midpoint(p1, p2);
    const p23 = midpoint(p2, p3);
    const p012 = midpoint(p01, p12);
    const p123 = midpoint(p12, p23);
    const centre = midpoint(p012, p123);
    flattenCubic(p0, p01, p012, centre, tolerance, depth - 1, maxPoints, output, state);
    flattenCubic(centre, p123, p23, p3, tolerance, depth - 1, maxPoints, output, state);
}

function appendSample(output, candidate, maxPoints, state) {
    if (output.length && pointsEqual(output[output.length - 1], candidate)) return;
    if (output.length >= maxPoints) {
        state.truncated = true;
        return;
    }
    output.push({ x: candidate.x, y: candidate.y });
}

function cubicIsFlat(p0, p1, p2, p3, tolerance) {
    const chord = distance(p0, p3);
    if (chord <= EPSILON) {
        return Math.max(distance(p0, p1), distance(p0, p2), distance(p0, p3)) <= tolerance;
    }
    const perpendicularError = Math.max(distanceToLine(p1, p0, p3), distanceToLine(p2, p0, p3));
    const controlLength = distance(p0, p1) + distance(p1, p2) + distance(p2, p3);
    return perpendicularError <= tolerance && controlLength - chord <= tolerance * 2;
}

function firstSelfIntersection(points) {
    const count = points.length;
    for (let first = 0; first < count; first += 1) {
        const firstNext = (first + 1) % count;
        for (let second = first + 1; second < count; second += 1) {
            const secondNext = (second + 1) % count;
            if (first === second || firstNext === second || secondNext === first) continue;
            if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
                return [first, second];
            }
        }
    }
    return null;
}

function segmentsIntersect(a, b, c, d) {
    const o1 = cross(a, b, c);
    const o2 = cross(a, b, d);
    const o3 = cross(c, d, a);
    const o4 = cross(c, d, b);
    if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
        && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
    if (Math.abs(o1) <= EPSILON && pointOnSegment(c, a, b)) return true;
    if (Math.abs(o2) <= EPSILON && pointOnSegment(d, a, b)) return true;
    if (Math.abs(o3) <= EPSILON && pointOnSegment(a, c, d)) return true;
    if (Math.abs(o4) <= EPSILON && pointOnSegment(b, c, d)) return true;
    return false;
}

function segmentsProperlyCross(a, b, c, d) {
    const o1 = cross(a, b, c);
    const o2 = cross(a, b, d);
    const o3 = cross(c, d, a);
    const o4 = cross(c, d, b);
    return ((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
        && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON));
}

function firstBoundaryCrossing(structure, profile) {
    for (let structuralIndex = 0; structuralIndex < structure.length; structuralIndex += 1) {
        const structuralNext = (structuralIndex + 1) % structure.length;
        for (let profileIndex = 0; profileIndex < profile.length; profileIndex += 1) {
            const profileNext = (profileIndex + 1) % profile.length;
            if (segmentsProperlyCross(
                structure[structuralIndex],
                structure[structuralNext],
                profile[profileIndex],
                profile[profileNext]
            )) return [structuralIndex, profileIndex];
        }
    }
    return null;
}

function pointInPolygon(candidate, polygon) {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
        const a = polygon[previous];
        const b = polygon[current];
        if (pointOnSegment(candidate, a, b)) return true;
        const crosses = (a.y > candidate.y) !== (b.y > candidate.y)
            && candidate.x < ((b.x - a.x) * (candidate.y - a.y)) / (b.y - a.y) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

function pointStrictlyInsidePolygon(candidate, polygon) {
    return !pointOnPolygonBoundary(candidate, polygon) && pointInPolygon(candidate, polygon);
}

function pointOnPolygonBoundary(candidate, polygon) {
    for (let index = 0; index < polygon.length; index += 1) {
        if (pointOnSegment(candidate, polygon[index], polygon[(index + 1) % polygon.length])) return true;
    }
    return false;
}

function profileContainmentChecks(points) {
    const checks = [];
    for (let index = 0; index < points.length; index += 1) {
        checks.push(points[index]);
        checks.push(midpoint(points[index], points[(index + 1) % points.length]));
    }
    return checks;
}

function fallbackResolution(points, reason, validation, source = 'structural', profile = null) {
    return {
        points: points.map(pointValue => ({ ...pointValue })),
        profile,
        source,
        customized: false,
        valid: reason === 'disabled',
        reason,
        validation
    };
}

function cleanPolygon(value) {
    if (!Array.isArray(value)) return [];
    const points = [];
    for (const candidate of value) {
        const x = Number(candidate?.x);
        const y = Number(candidate?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const next = { x, y };
        if (!points.length || !pointsEqual(points[points.length - 1], next)) points.push(next);
    }
    if (points.length > 1 && pointsEqual(points[0], points[points.length - 1])) points.pop();
    return points;
}

function removeAdjacentDuplicates(points) {
    const result = [];
    for (const candidate of points) pushUnique(result, candidate);
    if (result.length > 1 && pointsEqual(result[0], result[result.length - 1])) result.pop();
    return result;
}

function pushUnique(points, candidate) {
    if (!points.length || !pointsEqual(points[points.length - 1], candidate)) {
        points.push({ x: candidate.x, y: candidate.y });
    }
}

function normalizedPoint(value, fallback, strict = false) {
    if (value == null) return { ...fallback };
    if (strict && typeof value !== 'object') return null;
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (strict && (!Number.isFinite(x) || !Number.isFinite(y))) return null;
    return {
        x: Number.isFinite(x) ? x : fallback.x,
        y: Number.isFinite(y) ? y : fallback.y
    };
}

function resolveNodeIndex(nodes, reference) {
    if (Number.isInteger(reference)) return reference >= 0 && reference < nodes.length ? reference : -1;
    if (typeof reference === 'string') return nodes.findIndex(node => node.id === reference);
    return -1;
}

function uniqueNodeId(nodes, preferred) {
    return uniqueStringId(new Set(nodes.map(node => node.id)), sanitizeId(preferred, 'node'));
}

function uniqueStringId(used, preferred) {
    if (!used.has(preferred)) return preferred;
    let suffix = 2;
    while (used.has(`${preferred}-${suffix}`)) suffix += 1;
    return `${preferred}-${suffix}`;
}

function sanitizeId(value, fallback) {
    const candidate = typeof value === 'string' ? value.trim().slice(0, 80) : '';
    return candidate || fallback;
}

function cloneNode(node) {
    return { ...node, in: { ...node.in }, out: { ...node.out } };
}

function issue(code, message, details = {}) {
    return { code, message, ...details };
}

function signedArea(points) {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        sum += current.x * next.y - next.x * current.y;
    }
    return sum / 2;
}

function point(x, y) {
    return { x, y };
}

function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function lerpPoint(a, b, ratio) {
    return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
}

function subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
}

function vectorLength(vector) {
    return Math.hypot(vector.x, vector.y);
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToLine(candidate, start, end) {
    return Math.abs(cross(start, end, candidate)) / Math.max(distance(start, end), EPSILON);
}

function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(candidate, start, end) {
    if (Math.abs(cross(start, end, candidate)) > EPSILON) return false;
    return candidate.x >= Math.min(start.x, end.x) - EPSILON
        && candidate.x <= Math.max(start.x, end.x) + EPSILON
        && candidate.y >= Math.min(start.y, end.y) - EPSILON
        && candidate.y <= Math.max(start.y, end.y) + EPSILON;
}

function pointsEqual(a, b) {
    return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function finiteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveFinite(value, fallback) {
    const parsed = finiteNumber(value, fallback);
    return parsed > 0 ? parsed : fallback;
}

function integerInRange(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? clamp(parsed, minimum, maximum) : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
