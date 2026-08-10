import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FABRICATION_MANIFEST_SCHEMA,
    FABRICATION_MANIFEST_VERSION,
    OPERATION_TYPES,
    buildFabricationSourceFromCabinet,
    createFabricationManifest,
    createPreflightResult,
    geometryInternals,
    getLayoutFitSuggestion,
    runPreflight,
    summarizePreflight
} from '../wwwroot/js/fabrication.js';
import { createManifestFixture, createSourceFixture } from './helpers/fixtures.js';

test('FabricationManifestV1 is renderer-independent, millimetre based, and unrounded', () => {
    const source = createSourceFixture();
    source.parts[0].widthMm = 600.125;
    source.parts[0].lengthMm = 1000.375;
    source.parts[0].profilePoints[1].x = 600.125;
    source.parts[0].profilePoints[2].x = 600.125;
    const manifest = createFabricationManifest(source);

    assert.equal(manifest.schema, FABRICATION_MANIFEST_SCHEMA);
    assert.equal(manifest.version, FABRICATION_MANIFEST_VERSION);
    assert.equal(manifest.units, 'mm');
    assert.equal(manifest.parts[0].dimensions.widthMm, 600.125);
    assert.equal(manifest.parts[0].dimensions.lengthMm, 1000.375);
    assert.deepEqual(OPERATION_TYPES, ['profileCut', 'throughCut', 'drill', 'pocket', 'engrave', 'reference']);
    assert.equal(JSON.stringify(manifest).includes('userData'), false);
});

test('material assignments flow into the manifest and flat stock profiles gate oversized parts', () => {
    const source = createSourceFixture();
    source.materials.push({
        id: 'small-stock', name: 'Small stock', nominalThicknessMm: 18, measuredThicknessMm: 18,
        sheetWidthMm: 500, sheetHeightMm: 500, allowedRotations: [0, 180]
    });
    source.materialAssignments = { side_left: 'small-stock' };

    const manifest = createFabricationManifest(source);
    assert.equal(manifest.parts.find(part => part.id === 'side_left').materialId, 'small-stock');
    assert.ok(runPreflight(manifest).some(item => item.code === 'STOCK_BOUNDS_EXCEEDED' && item.partIds.includes('side_left')));
});

test('viewport visibility never changes fabrication inclusion', () => {
    const manifest = createManifestFixture();
    const hidden = manifest.parts.find(part => part.id === 'side_right');
    assert.equal(hidden.viewportVisible, false);
    assert.equal(hidden.includeInFabrication, true);
    assert.equal(runPreflight(manifest).some(item => item.code === 'NO_FABRICATION_PARTS'), false);
});

test('renderer boundary snapshots plain panel records and explicit inclusion state', () => {
    const cabinet = {
        params: {
            projectName: 'Boundary', thickness: 18,
            materials: [{ id: 'boundary-stock', sheetWidthMm: 1200, sheetHeightMm: 600 }],
            fabricationSettings: { materialAssignments: { panel: 'boundary-stock' } }
        },
        fabricationPartRecords: [{ userData: { id: 'panel', name: 'Panel', lengthMm: 100, widthMm: 80, thicknessMm: 18 } }],
        isPanelIncluded: id => id === 'panel',
        isPanelVisible: () => false,
        fabricationDiagnostics: {}
    };
    const source = buildFabricationSourceFromCabinet(cabinet);
    assert.equal(source.parts[0].includeInFabrication, true);
    assert.equal(source.parts[0].viewportVisible, false);
    assert.equal(source.materialAssignments.panel, 'boundary-stock');
    assert.doesNotThrow(() => structuredClone(source));
});

test('clean fixture passes manufacturing preflight and reports a 90/45 degree joint', () => {
    const manifest = createManifestFixture();
    const findings = runPreflight(manifest);
    assert.deepEqual(findings, []);
    assert.equal(manifest.joints[0].includedAngleDeg, 90);
    assert.deepEqual(manifest.joints[0].cuts.map(cut => cut.bevelAngleDeg), [45, 45]);
    assert.deepEqual(summarizePreflight(findings), {
        errors: 0, warnings: 0, info: 0, canExportProduction: true, requiresWarningAcknowledgement: false
    });
});

test('preflight emits stable blocking codes for malformed contours and dimensions', () => {
    const manifest = createManifestFixture();
    manifest.parts[0].dimensions.widthMm = 0;
    manifest.contours[0].closed = false;
    manifest.contours[0].points = [
        { xMm: 0, yMm: 0 }, { xMm: 100, yMm: 100 },
        { xMm: 0, yMm: 100 }, { xMm: 100, yMm: 0 }
    ];
    const codes = runPreflight(manifest).map(item => item.code);
    assert.ok(codes.includes('PART_INVALID_DIMENSIONS'));
    assert.ok(codes.includes('CONTOUR_OPEN'));
    assert.ok(codes.includes('CONTOUR_SELF_INTERSECTION'));
});

test('cutout edge, joint bevel, and layout fit failures block production', () => {
    const source = createSourceFixture();
    source.parts.find(part => part.id === 'panel_back').cutouts = [
        { kind: 'service', xMm: 8, yMm: 8, widthMm: 50, heightMm: 50 }
    ];
    source.parts.find(part => part.id === 'panel_cp').layoutDoesNotFit = true;
    source.parts.find(part => part.id === 'panel_cp').layoutFitSuggestion = { spacingMm: 62, count: 6 };
    source.joints[0].cuts[1].bevelAngleDeg = 40;
    const findings = runPreflight(createFabricationManifest(source));
    const codes = new Set(findings.map(item => item.code));
    assert.ok(codes.has('CUTOUT_EDGE_CLEARANCE'));
    assert.ok(codes.has('LAYOUT_DOES_NOT_FIT'));
    assert.ok(codes.has('JOINT_BEVEL_MISMATCH'));
    assert.equal(summarizePreflight(findings).canExportProduction, false);
});

test('real hardware definitions generate machining operations and body collisions block production', () => {
    const source = createSourceFixture();
    const panel = source.parts.find(part => part.id === 'panel_cp');
    panel.hardware = [
        { kind: 'joystick', label: 'P1 stick', hardwareDefinitionId: 'joystick-jlf-pattern', xMm: 120, yMm: 220, radiusMm: 12 },
        { kind: 'button', label: 'P1 action', hardwareDefinitionId: 'button-30-snap', xMm: 120, yMm: 245, radiusMm: 15 }
    ];
    const manifest = createFabricationManifest(source);
    const joystick = manifest.hardwareInstances.find(instance => instance.definitionId === 'joystick-jlf-pattern');
    const joystickOperations = manifest.operations.filter(operation => operation.hardwareInstanceId === joystick.id);

    assert.equal(joystickOperations.filter(operation => operation.type === 'throughCut').length, 1);
    assert.equal(joystickOperations.filter(operation => operation.type === 'drill').length, 4);
    assert.ok(runPreflight(manifest).some(item => item.code === 'HARDWARE_BODY_COLLISION' && item.severity === 'error'));
});

test('layout fit suggestion lookup keeps the corrective action explicit', () => {
    const source = createSourceFixture();
    source.parts[2].layoutDoesNotFit = true;
    source.parts[2].layoutFitSuggestion = { spacingMm: 55, playerCount: 2 };
    const manifest = createFabricationManifest(source);
    assert.deepEqual(getLayoutFitSuggestion(manifest, 'panel_cp'), {
        id: 'panel_cp:layout-fit', partId: 'panel_cp', controlPath: 'deck', spacingMm: 55, playerCount: 2
    });
});

test('PreflightResult validates its contract and de-duplicates affected parts', () => {
    const result = createPreflightResult({
        code: 'TEST_CODE', severity: 'warning', partIds: ['panel_cp', 'panel_cp'],
        parameter: 'controls.deck', operationId: 'op-1', message: 'Review this.', correctiveAction: 'Inspect it.'
    });
    assert.equal(result.id, 'TEST_CODE:panel_cp:op-1:controls.deck');
    assert.deepEqual(result.partIds, ['panel_cp']);
    assert.throws(() => createPreflightResult({ code: '', severity: 'error', message: '' }), TypeError);
});

test('pure geometry helpers calculate area and detect self-intersection', () => {
    const square = [
        { xMm: 0, yMm: 0 }, { xMm: 100, yMm: 0 },
        { xMm: 100, yMm: 100 }, { xMm: 0, yMm: 100 }
    ];
    assert.equal(geometryInternals.polygonArea(square), 10000);
    assert.equal(geometryInternals.contourSelfIntersects(square), false);
    assert.equal(geometryInternals.pointInPolygon({ xMm: 50, yMm: 50 }, square), true);
});

test('bounded parameter sweep always yields finite closed geometry or a stable blocking result', () => {
    for (let index = 0; index < 30; index++) {
        const source = createSourceFixture(index % 2 ? 'standard' : 'barstool');
        const width = 420 + index * 11.125;
        const length = 500 + index * 17.25;
        source.parts[3].widthMm = width;
        source.parts[3].lengthMm = length;
        const manifest = createFabricationManifest(source);
        const outer = manifest.contours.find(contour => contour.partId === 'panel_back' && contour.role === 'outer');
        const finite = outer.points.every(point => Number.isFinite(point.xMm) && Number.isFinite(point.yMm));
        const blockers = runPreflight(manifest).filter(item => item.severity === 'error');
        assert.ok((outer.closed && finite && outer.points.length >= 3) || blockers.length > 0);
    }
});
