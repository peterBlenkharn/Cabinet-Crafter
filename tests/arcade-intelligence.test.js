import test from 'node:test';
import assert from 'node:assert/strict';
import {
    analyzeArcadeBuild,
    augmentManifestWithArcadeIntelligence,
    inferHardwareInstances,
    validateArcadeRelationships
} from '../wwwroot/js/arcade-intelligence.js';
import { BUILT_IN_HARDWARE_DEFINITIONS, instantiateHardware } from '../wwwroot/js/hardware-library.js';
import { createManifestFixture } from './helpers/fixtures.js';

test('arcade intelligence infers real hardware from typed fabrication operations', () => {
    const manifest = createManifestFixture();
    const instances = inferHardwareInstances(manifest);
    assert.equal(instances.length, 1);
    assert.equal(instances[0].definitionId, 'button-30-snap');
    assert.equal(instances[0].partId, 'panel_cp');
    assert.equal(instances[0].xMm, 325);
    assert.equal(instances[0].yMm, 150);
});

test('arcade build analysis aggregates hardware, wiring, ergonomics, assembly, and T-moulding', () => {
    const manifest = createManifestFixture();
    const analysis = analyzeArcadeBuild(manifest, manifest.parameters);
    assert.equal(analysis.version, 1);
    assert.equal(analysis.summary.hardwareItems, 1);
    assert.equal(analysis.summary.wiringConnections, 1);
    assert.ok(analysis.summary.harnessLengthM > 0);
    assert.equal(analysis.summary.assemblySteps, analysis.assembly.steps.length);
    assert.ok(analysis.summary.tMouldingLengthM > 0);
    assert.equal(analysis.findings.length, analysis.ergonomics.findings.length);
    assert.equal(analysis.summary.errors, analysis.findings.filter(item => item.severity === 'error').length);
});

test('manifest augmentation keeps the fabrication source intact and attaches portable intelligence', () => {
    const manifest = createManifestFixture('barstool');
    const before = structuredClone(manifest);
    const result = augmentManifestWithArcadeIntelligence(manifest, manifest.parameters);
    assert.deepEqual(manifest, before);
    assert.equal(result.manifest.arcade.version, 1);
    assert.equal(result.manifest.arcade.hardwareSchedule[0].quantity, 1);
    assert.equal(result.intelligence.assembly.projectName, 'Golden Bar-top');
    assert.deepEqual(result.manifest.sourceDiagnostics.invalidIntersections, before.sourceDiagnostics.invalidIntersections);
    assert.deepEqual(result.manifest.sourceDiagnostics.fastenerIssues, before.sourceDiagnostics.fastenerIssues);
    assert.equal(result.manifest.sourceDiagnostics.findings.length, result.intelligence.findings.length);
    assert.equal(result.manifest.arcade.findings.length, result.intelligence.findings.length);
    assert.equal(result.manifest.diagnostics.length, result.intelligence.findings.length);
});

test('arcade relationship checks cover player spacing, movement, monitor depth, ventilation, and encoder assignment', () => {
    const instances = [
        instantiateHardware('joystick-jlf-pattern', { id: 'p1', partId: 'panel_cp', xMm: 100, yMm: 100, label: 'P1 stick' }),
        instantiateHardware('joystick-jlf-pattern', { id: 'p2', partId: 'panel_cp', xMm: 230, yMm: 100, label: 'P2 stick' }),
        instantiateHardware('trackball-3in', { id: 'ball', partId: 'panel_cp', xMm: 300, yMm: 100, label: 'Trackball' }),
        instantiateHardware('button-30-snap', { id: 'fire', partId: 'panel_cp', xMm: 420, yMm: 100, label: 'Fire' }),
        instantiateHardware('encoder-4player', { id: 'encoder', partId: 'panel_shelf', xMm: 200, yMm: 150 }),
        instantiateHardware('mini-pc-180', { id: 'pc', partId: 'panel_shelf', xMm: 500, yMm: 150 }),
        instantiateHardware('monitor-24-vesa100', { id: 'display', partId: 'panel_bezel', xMm: 300, yMm: 220 })
    ];
    const findings = validateArcadeRelationships(instances, BUILT_IN_HARDWARE_DEFINITIONS, { bezelDepth: 40 });
    const codes = new Set(findings.map(item => item.code));
    assert.ok(codes.has('PLAYER_CONTROL_SPACING'));
    assert.ok(codes.has('HARDWARE_MOVEMENT_CONFLICT'));
    assert.ok(codes.has('MONITOR_DEPTH_COLLISION'));
    assert.equal(findings.find(item => item.code === 'MONITOR_DEPTH_COLLISION').field, 'bezelDepth');
    assert.ok(codes.has('VENTILATION_NOT_DEFINED'));
    assert.ok(codes.has('ENCODER_INPUT_UNASSIGNED'));
});
