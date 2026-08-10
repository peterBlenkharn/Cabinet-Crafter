import test from 'node:test';
import assert from 'node:assert/strict';
import { createFabricationManifest, runPreflight } from '../wwwroot/js/fabrication.js';
import { createSourceFixture } from './helpers/fixtures.js';

test('fastener normalization preserves legacy fields and carries portable drilling metadata', () => {
    const source = createSourceFixture();
    const panel = source.parts.find(part => part.id === 'panel_cp');
    panel.fasteners = [{
        id: 'cp-countersunk-1',
        kind: 'wood-screw',
        xMm: 100,
        yMm: 50,
        diameterMm: 4,
        pilotDiameterMm: 3,
        coreDiameterMm: 2.5,
        clearanceDiameterMm: 4.5,
        headDiameterMm: 10,
        headType: 'flat-countersunk',
        lengthMm: 35,
        insertionDirection: 'finished-to-underside',
        countersink: { diameterMm: 12, depthMm: 2, angleDeg: 90 },
        counterboreDiameterMm: 8,
        counterboreDepthMm: 1
    }];

    const manifest = createFabricationManifest(source);
    const fastener = manifest.fasteners.find(item => item.id === 'cp-countersunk-1');
    assert.equal(fastener.diameterMm, 4);
    assert.equal(fastener.lengthMm, 35);
    assert.equal(fastener.pilotDiameterMm, 3);
    assert.equal(fastener.coreDiameterMm, 2.5);
    assert.equal(fastener.clearanceDiameterMm, 4.5);
    assert.equal(fastener.headDiameterMm, 10);
    assert.equal(fastener.headType, 'flat-countersunk');
    assert.equal(fastener.insertionDirection, 'finished-to-underside');
    assert.deepEqual(fastener.countersink, { diameterMm: 12, depthMm: 2, angleDeg: 90 });
    assert.deepEqual(fastener.counterbore, { diameterMm: 8, depthMm: 1, angleDeg: null });

    const drill = manifest.operations.find(operation => operation.fastenerId === fastener.id);
    assert.equal(drill.type, 'drill');
    assert.equal(drill.geometry.radiusMm, 1.5);
    assert.equal(drill.pilotDiameterMm, 3);
    assert.equal(drill.collisionDiameterMm, 12);
    assert.equal(drill.headType, 'flat-countersunk');
    assert.deepEqual(drill.countersink, fastener.countersink);
    assert.deepEqual(drill.counterbore, fastener.counterbore);
});

test('fastener collision checks use an explicitly supplied recess envelope without changing pilot geometry', () => {
    const source = createSourceFixture();
    const panel = source.parts.find(part => part.id === 'panel_cp');
    panel.fasteners = [{
        id: 'cp-large-recess',
        xMm: 100,
        yMm: 50,
        diameterMm: 4,
        pilotDiameterMm: 3,
        countersinkDiameterMm: 24,
        countersinkDepthMm: 2,
        countersinkAngleDeg: 90,
        lengthMm: 35
    }];
    panel.cutouts = [{
        id: 'near-fastener-cutout',
        kind: 'service',
        xMm: 100,
        yMm: 65,
        widthMm: 10,
        heightMm: 10
    }];

    const manifest = createFabricationManifest(source);
    const drill = manifest.operations.find(operation => operation.fastenerId === 'cp-large-recess');
    assert.equal(drill.geometry.radiusMm, 1.5);
    assert.equal(drill.collisionDiameterMm, 24);

    const conflict = runPreflight(manifest).find(finding =>
        finding.code === 'SCREW_CUTOUT_CONFLICT' && finding.operationId === drill.id
    );
    assert.ok(conflict);
    assert.deepEqual(conflict.partIds, ['panel_cp']);
});

test('legacy fasteners default the existing drill diameter without inventing recess machining', () => {
    const manifest = createFabricationManifest(createSourceFixture());
    const fastener = manifest.fasteners.find(item => item.id === 'cp-fastener-1');
    const drill = manifest.operations.find(operation => operation.fastenerId === fastener.id);
    assert.equal(fastener.diameterMm, 3);
    assert.equal(fastener.pilotDiameterMm, 3);
    assert.equal(fastener.countersink, null);
    assert.equal(fastener.counterbore, null);
    assert.equal(fastener.headType, null);
    assert.equal(drill.geometry.radiusMm, 1.5);
});
