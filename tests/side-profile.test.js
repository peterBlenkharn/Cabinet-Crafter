import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_SIDE_PROFILE_CUSTOMIZATION,
    createCurveFromPolygon,
    deleteCurveNode,
    normalizeSideProfileCustomization,
    polygonBounds,
    resolveSideProfile,
    sampleCurveProfile,
    setCurveNodeMode,
    splitCurveSegment,
    validateCurveProfile
} from '../wwwroot/js/side-profile.js';

const STRUCTURE = Object.freeze([
    { x: 100, y: 200 },
    { x: 700, y: 200 },
    { x: 700, y: 1000 },
    { x: 100, y: 1000 }
]);

test('side profile defaults and untrusted project data normalize predictably', () => {
    assert.deepEqual(normalizeSideProfileCustomization(), DEFAULT_SIDE_PROFILE_CUSTOMIZATION);
    const nodes = Array.from({ length: 64 }, (_, index) => ({
        id: index < 2 ? 'duplicate' : `n${index}`,
        x: index / 70,
        y: index % 2,
        mode: 'unknown'
    }));
    const normalized = normalizeSideProfileCustomization({ enabled: 1, linked: false, left: { nodes } });
    assert.equal(normalized.enabled, false);
    assert.equal(normalized.linked, false);
    assert.equal(normalized.left.nodes.length, 64);
    assert.equal(new Set(normalized.left.nodes.map(node => node.id)).size, 64);
    assert.deepEqual(normalized.left.nodes[0].in, { x: 0, y: 0 });
    assert.equal(normalized.left.nodes[0].mode, 'corner');

    const oversized = normalizeSideProfileCustomization({
        left: { nodes: [...nodes, { id: 'too-many', x: 0, y: 0 }] }
    });
    assert.equal(oversized.left, null);
    const malformed = normalizeSideProfileCustomization({
        left: { nodes: nodes.map((node, index) => index === 5 ? { ...node, out: { x: Infinity, y: 0 } } : node) }
    });
    assert.equal(malformed.left, null);
});

test('a structural polygon becomes a normalized exact corner curve', () => {
    const curve = createCurveFromPolygon(STRUCTURE);
    assert.deepEqual(curve.nodes.map(({ x, y }) => ({ x, y })), [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
    ]);
    assert.deepEqual(sampleCurveProfile(curve, STRUCTURE), STRUCTURE);
    assert.deepEqual(polygonBounds(STRUCTURE), {
        minX: 100, maxX: 700, minY: 200, maxY: 1000, width: 600, height: 800
    });
    assert.equal(validateCurveProfile(curve, STRUCTURE).valid, true);
});

test('adaptive sampling evaluates curved handles in world millimetres', () => {
    const curve = createCurveFromPolygon(STRUCTURE);
    curve.nodes[0].out = { x: 0.25, y: -0.25 };
    curve.nodes[1].in = { x: 0.75, y: -0.25 };
    const coarse = sampleCurveProfile(curve, STRUCTURE, { toleranceMm: 20 });
    const fine = sampleCurveProfile(curve, STRUCTURE, { toleranceMm: 0.1 });
    assert.ok(fine.length > coarse.length);
    assert.ok(fine.some(point => point.y < 200));
});

test('validation rejects self-intersections and profiles that remove structure', () => {
    const bowTie = createCurveFromPolygon(STRUCTURE);
    [bowTie.nodes[1], bowTie.nodes[2]] = [bowTie.nodes[2], bowTie.nodes[1]];
    const crossed = validateCurveProfile(bowTie, STRUCTURE);
    assert.equal(crossed.valid, false);
    assert.ok(crossed.errors.some(error => error.code === 'PROFILE_SELF_INTERSECTION'));

    const inset = createCurveFromPolygon(STRUCTURE);
    for (const node of inset.nodes) {
        node.x = 0.1 + node.x * 0.8;
        node.y = 0.1 + node.y * 0.8;
        node.in = { x: node.x, y: node.y };
        node.out = { x: node.x, y: node.y };
    }
    const excluded = validateCurveProfile(inset, STRUCTURE);
    assert.equal(excluded.valid, false);
    assert.ok(excluded.errors.some(error => error.code === 'PROFILE_EXCLUDES_STRUCTURE'));
});

test('validation rejects an inward notch that leaves structural vertices on the boundary', () => {
    const structure = [
        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }
    ];
    const notch = straightProfile([
        { x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.2 },
        { x: 0.3, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }
    ]);
    const validation = validateCurveProfile(notch, structure);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(error => error.code === 'PROFILE_EXCLUDES_STRUCTURE'));
});

test('validation blocks a contour when adaptive sampling reaches its safety cap', () => {
    const curve = createCurveFromPolygon(STRUCTURE);
    curve.nodes[0].out = { x: 0.25, y: -0.8 };
    curve.nodes[1].in = { x: 0.75, y: -0.8 };
    const validation = validateCurveProfile(curve, STRUCTURE, { toleranceMm: 0.000001, maxPoints: 16 });
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(error => error.code === 'PROFILE_TOO_COMPLEX'));
});

test('resolution uses linked and independent profiles with structural fallback', () => {
    const valid = createCurveFromPolygon(STRUCTURE);
    const disabled = resolveSideProfile(DEFAULT_SIDE_PROFILE_CUSTOMIZATION, 'left', STRUCTURE);
    assert.equal(disabled.customized, false);
    assert.equal(disabled.reason, 'disabled');
    assert.deepEqual(disabled.points, STRUCTURE);

    const linked = resolveSideProfile({ enabled: true, linked: true, shared: valid }, 'right', STRUCTURE);
    assert.equal(linked.customized, true);
    assert.equal(linked.source, 'shared');

    const invalid = structuredClone(valid);
    invalid.nodes[0].x = 0.5;
    invalid.nodes[0].y = 0.5;
    invalid.nodes[0].in = { x: 0.5, y: 0.5 };
    invalid.nodes[0].out = { x: 0.5, y: 0.5 };
    const fallback = resolveSideProfile({ enabled: true, linked: false, left: invalid }, 'left', STRUCTURE);
    assert.equal(fallback.customized, false);
    assert.equal(fallback.reason, 'invalid');
    assert.deepEqual(fallback.points, STRUCTURE);
});

test('normalization rejects an out-of-range node instead of changing imported topology', () => {
    const outerRectangle = straightProfile([
        { x: -0.1, y: -0.1 }, { x: 1.1, y: -0.1 }, { x: 9, y: 0.5 },
        { x: 1.1, y: 1.1 }, { x: -0.1, y: 1.1 }
    ]);
    const resolution = resolveSideProfile({ enabled: true, linked: true, shared: outerRectangle }, 'left', STRUCTURE);
    assert.equal(resolution.customized, false);
    assert.notEqual(resolution.reason, 'disabled');
    assert.deepEqual(resolution.points, STRUCTURE);
});

test('segment splitting preserves the cubic and respects the node cap', () => {
    const curve = createCurveFromPolygon(STRUCTURE);
    curve.nodes[0].out = { x: 0.2, y: -0.3 };
    curve.nodes[1].in = { x: 0.8, y: -0.3 };
    const before = sampleCurveProfile(curve, STRUCTURE, { toleranceMm: 0.01 });
    const split = splitCurveSegment(curve, 0, 0.37);
    const after = sampleCurveProfile(split, STRUCTURE, { toleranceMm: 0.01 });
    assert.equal(split.nodes.length, 5);
    assert.equal(split.nodes[1].mode, 'smooth');
    assert.ok(Math.abs(polylinePerimeter(before) - polylinePerimeter(after)) < 0.02);

    const oversized = normalizeSideProfileCustomization({
        left: { nodes: Array.from({ length: 64 }, (_, index) => squareLoopNode(index, 64)) }
    }).left;
    assert.equal(splitCurveSegment(oversized, 0).nodes.length, 64);
});

test('node deletion is immutable and cannot break the minimum closed contour', () => {
    const original = createCurveFromPolygon(STRUCTURE);
    const withExtra = splitCurveSegment(original, 0);
    const reduced = deleteCurveNode(withExtra, withExtra.nodes[1].id);
    assert.equal(reduced.nodes.length, 4);
    assert.equal(withExtra.nodes.length, 5);
    const triangle = deleteCurveNode(original, 0);
    assert.equal(triangle.nodes.length, 3);
    assert.equal(deleteCurveNode(triangle, 0).nodes.length, 3);
});

test('smooth and symmetric modes align handles around their anchor', () => {
    const curve = createCurveFromPolygon(STRUCTURE);
    curve.nodes[0].in = { x: -0.1, y: 0.2 };
    curve.nodes[0].out = { x: 0.3, y: 0 };
    const smooth = setCurveNodeMode(curve, 0, 'smooth');
    assert.equal(smooth.nodes[0].mode, 'smooth');
    assert.ok(Math.abs(crossVectors(handleVector(smooth.nodes[0], 'in'), handleVector(smooth.nodes[0], 'out'))) < 1e-10);
    assert.ok(dotVectors(handleVector(smooth.nodes[0], 'in'), handleVector(smooth.nodes[0], 'out')) <= 0);

    const symmetric = setCurveNodeMode(curve, 0, 'symmetric');
    assert.equal(symmetric.nodes[0].mode, 'symmetric');
    assert.ok(Math.abs(handleLength(symmetric.nodes[0], 'in') - handleLength(symmetric.nodes[0], 'out')) < 1e-10);
    assert.notDeepEqual(curve.nodes[0].in, symmetric.nodes[0].in);
});

function polylinePerimeter(points) {
    return points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + Math.hypot(next.x - point.x, next.y - point.y);
    }, 0);
}

function squareLoopNode(index, count) {
    const angle = index / count * Math.PI * 2;
    const anchor = { x: 0.5 + Math.cos(angle) * 0.5, y: 0.5 + Math.sin(angle) * 0.5 };
    return { id: `n${index}`, ...anchor, in: anchor, out: anchor, mode: 'corner' };
}

function straightProfile(points) {
    return {
        version: 1,
        closed: true,
        nodes: points.map((anchor, index) => ({
            id: `n${index + 1}`,
            ...anchor,
            in: { ...anchor },
            out: { ...anchor },
            mode: 'corner'
        }))
    };
}

function handleVector(node, key) {
    return { x: node[key].x - node.x, y: node[key].y - node.y };
}

function handleLength(node, key) {
    const vector = handleVector(node, key);
    return Math.hypot(vector.x, vector.y);
}

function crossVectors(a, b) {
    return a.x * b.y - a.y * b.x;
}

function dotVectors(a, b) {
    return a.x * b.x + a.y * b.y;
}
