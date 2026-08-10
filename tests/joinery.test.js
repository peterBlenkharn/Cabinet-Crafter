import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_PROCESS_PROFILES,
    JOINERY_STRATEGIES,
    applyJoineryStrategies,
    createProcessProfile,
    deriveProcessManifest
} from '../wwwroot/js/joinery.js';
import { createManifestFixture } from './helpers/fixtures.js';

test('per-joint strategies generate panel-local dado geometry with fit clearance', () => {
    const manifest = createManifestFixture();
    manifest.joints[0].edgeGeometry = { start: { x: 10, y: 20 }, end: { x: 310, y: 20 } };
    const result = applyJoineryStrategies(manifest, {
        'joint-cp-left': { strategy: 'dado', hostPartId: 'panel_cp', clearanceMm: 0.25 }
    });
    const joint = result.manifest.joints[0];
    const operation = result.manifest.operations.find(item => item.id === 'joint-cp-left:dado:pocket');
    assert.equal(joint.strategy, 'dado');
    assert.equal(joint.clearanceMm, 0.25);
    assert.equal(operation.type, 'pocket');
    assert.equal(operation.partId, 'panel_cp');
    assert.equal(operation.geometry.widthMm, 300);
    assert.equal(operation.geometry.heightMm, 18.5);
    assert.ok(result.manifest.parts.find(part => part.id === 'panel_cp').operationIds.includes(operation.id));
});

test('joinery reports missing edge geometry instead of inventing machining vectors', () => {
    const result = applyJoineryStrategies(createManifestFixture(), {
        'joint-cp-left': { strategy: 'cleat', hostPartId: 'panel_cp' }
    });
    assert.ok(result.findings.some(item => item.code === 'JOINERY_EDGE_GEOMETRY_MISSING' && item.severity === 'warning'));
    assert.deepEqual(result.manifest.joints[0].generatedOperationIds, []);
});

test('strategy and process profile contracts expose advanced construction choices', () => {
    assert.deepEqual(Object.keys(JOINERY_STRATEGIES), ['mitre', 'buttScrews', 'cleat', 'dado', 'rabbet', 'dowel', 'tabSlot']);
    const profile = createProcessProfile({
        id: 'Workshop Router', name: 'Workshop Router', kind: 'router',
        toolDiameterMm: 6, dogbones: true, holdingTabs: true,
        tabWidthMm: 10, tabHeightMm: 2.5, tabSpacingMm: 300, tabCountMinimum: 3
    });
    assert.equal(profile.id, 'workshop-router');
    assert.equal(profile.kind, 'router');
    assert.equal(profile.tabCountMinimum, 3);
});

test('laser process derives compensation without changing nominal geometry', () => {
    const manifest = createManifestFixture();
    const original = structuredClone(manifest.operations[0].geometry);
    const result = deriveProcessManifest(manifest, { ...DEFAULT_PROCESS_PROFILES.laser, kerfMm: 0.24 });
    const profile = result.manifest.operations.find(item => item.type === 'profileCut');
    const through = result.manifest.operations.find(item => item.type === 'throughCut');
    assert.deepEqual(profile.nominalGeometry, original);
    assert.equal(profile.process.kerfCompensationMm, 0.12);
    assert.equal(profile.process.compensationSide, 'outside');
    assert.equal(through.process.compensationSide, 'inside');
    assert.ok(result.findings.some(item => item.code === 'PROCESS_DERIVED_GEOMETRY'));
});

test('router process adds inside-corner relief and holding-tab metadata as derived operations', () => {
    const manifest = createManifestFixture();
    manifest.operations.push({
        id: 'panel_cp:slot', partId: 'panel_cp', type: 'throughCut',
        geometry: {
            kind: 'polygon',
            points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 50 }, { x: 0, y: 100 }]
        }
    });
    const result = deriveProcessManifest(manifest, DEFAULT_PROCESS_PROFILES.router6);
    assert.ok(result.manifest.operations.some(item => item.derivedFrom === 'panel_cp:slot' && item.process.purpose === 'inside-corner-relief'));
    assert.ok(result.manifest.operations.filter(item => item.type === 'profileCut').every(item => item.process.holdingTabs.count >= 4));
});
