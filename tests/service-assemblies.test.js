import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../wwwroot/js/lib/three.module.js';
import { Cabinet, PRESETS, cloneParams } from '../wwwroot/js/cabinet.js';
import {
    FABRICATION_ASSEMBLY_IDS,
    FABRICATION_ASSEMBLY_PART_IDS,
    buildFabricationSourceFromCabinet,
    createCabinetAssemblyFabricationRecords,
    createFabricationManifest,
    runPreflight
} from '../wwwroot/js/fabrication.js';

function parentRecords(preset = 'standard') {
    const barTop = preset === 'barstool' || preset === 'bar-top';
    const backLengthMm = barTop ? 500 : 800;
    const panelWidthMm = barTop ? 530 : 600;
    const doorHeightMm = barTop ? 360 : 520;
    const bezelLengthMm = barTop ? 280 : 400;
    const screenWidthMm = barTop ? 360 : 470;
    const screenHeightMm = barTop ? 210 : 270;
    const frameOuterWidthMm = Math.min(panelWidthMm - 4, screenWidthMm + 84);
    const frameOuterHeightMm = Math.min(bezelLengthMm - 4, screenHeightMm + 84);

    return [
        {
            id: 'panel_back',
            name: 'Back Access Panel',
            role: 'Rear closure and service access',
            exportType: 'rectangle',
            lengthMm: backLengthMm,
            widthMm: panelWidthMm,
            thicknessMm: barTop ? 15 : 18,
            materialId: barTop ? 'mdf-15' : 'mdf-18',
            cutouts: [{
                id: 'rear-service-door-opening',
                kind: 'service_door',
                label: 'REAR DOOR',
                assemblyId: FABRICATION_ASSEMBLY_IDS.rearServiceDoor,
                matingPartId: FABRICATION_ASSEMBLY_PART_IDS.rearServiceDoor,
                clearancePerSideMm: 2,
                xMm: 30 + doorHeightMm / 2,
                yMm: panelWidthMm / 2,
                widthMm: 300,
                heightMm: doorHeightMm
            }]
        },
        {
            id: 'panel_bezel',
            name: 'Monitor Bezel',
            role: 'Display surround and monitor aperture',
            exportType: 'rectangle',
            lengthMm: bezelLengthMm,
            widthMm: panelWidthMm,
            thicknessMm: barTop ? 15 : 18,
            materialId: barTop ? 'mdf-15' : 'mdf-18',
            screenLayout: {
                xMm: bezelLengthMm / 2,
                yMm: panelWidthMm / 2,
                widthMm: screenWidthMm,
                heightMm: screenHeightMm
            },
            screenFrame: {
                assemblyId: FABRICATION_ASSEMBLY_IDS.screenFrame,
                partIds: [
                    FABRICATION_ASSEMBLY_PART_IDS.screenFrameTop,
                    FABRICATION_ASSEMBLY_PART_IDS.screenFrameBottom,
                    FABRICATION_ASSEMBLY_PART_IDS.screenFrameLeft,
                    FABRICATION_ASSEMBLY_PART_IDS.screenFrameRight
                ],
                xMm: bezelLengthMm / 2,
                yMm: panelWidthMm / 2,
                bezelMm: 34,
                clearanceMm: 8,
                depthMm: 12,
                outerWidthMm: frameOuterWidthMm,
                outerHeightMm: frameOuterHeightMm,
                innerWidthMm: frameOuterWidthMm - 68,
                innerHeightMm: frameOuterHeightMm - 68
            }
        }
    ];
}

function createAssemblyManifest(preset = 'standard', {
    excludedPartIds = [],
    hiddenPartIds = []
} = {}) {
    const baseParts = parentRecords(preset);
    const excluded = new Set(excludedPartIds);
    const hidden = new Set(hiddenPartIds);
    const assemblies = createCabinetAssemblyFabricationRecords({
        parts: baseParts,
        defaultThicknessMm: preset === 'standard' ? 18 : 15,
        isIncluded: partId => !excluded.has(partId),
        isVisible: partId => !hidden.has(partId)
    });
    const records = [...baseParts, ...assemblies.parts];
    const cabinet = {
        params: {
            projectName: preset === 'standard' ? 'Standard assemblies' : 'Bar-top assemblies',
            presetId: preset,
            thickness: preset === 'standard' ? 18 : 15,
            materials: [{
                id: preset === 'standard' ? 'mdf-18' : 'mdf-15',
                name: preset === 'standard' ? 'MDF 18 mm' : 'MDF 15 mm',
                nominalThicknessMm: preset === 'standard' ? 18 : 15,
                measuredThicknessMm: preset === 'standard' ? 18 : 15
            }]
        },
        fabricationPartRecords: records,
        fabricationAssemblySchedules: assemblies.schedules,
        isPanelIncluded: partId => !excluded.has(partId),
        isPanelVisible: partId => !hidden.has(partId),
        fabricationDiagnostics: {
            intersections: [],
            invalidIntersections: [],
            fastenerIssues: [],
            warnings: []
        }
    };
    const source = buildFabricationSourceFromCabinet(cabinet);
    return { assemblies, source, manifest: createFabricationManifest(source) };
}

test('rear service door is a stable fitted part with one parent opening and hardware references', () => {
    const { manifest } = createAssemblyManifest('standard', {
        hiddenPartIds: [FABRICATION_ASSEMBLY_PART_IDS.rearServiceDoor]
    });
    const door = manifest.parts.find(part => part.id === FABRICATION_ASSEMBLY_PART_IDS.rearServiceDoor);

    assert.ok(door);
    assert.equal(door.includeInFabrication, true);
    assert.equal(door.viewportVisible, false);
    assert.equal(door.materialId, 'mdf-18');
    assert.equal(door.thicknessMm, 18);
    assert.deepEqual(door.dimensions, { lengthMm: 516, widthMm: 296 });
    assert.equal(door.metadata.assemblyId, FABRICATION_ASSEMBLY_IDS.rearServiceDoor);
    assert.equal(door.metadata.parentPartId, 'panel_back');
    assert.equal(door.metadata.clearancePerSideMm, 2);

    const outer = manifest.contours.find(contour => contour.id === `${door.id}:outer`);
    assert.equal(outer.closed, true);
    assert.equal(outer.points.length, 4);
    assert.ok(outer.points.every(point => Number.isFinite(point.xMm) && Number.isFinite(point.yMm)));

    const doorOperations = manifest.operations.filter(operation => operation.partId === door.id);
    assert.equal(doorOperations.filter(operation => operation.type === 'profileCut').length, 1);
    assert.deepEqual(
        doorOperations.filter(operation => operation.type === 'reference').map(operation => operation.purpose).sort(),
        ['hinge-location', 'hinge-location', 'latch-location']
    );

    const openingOperations = manifest.operations.filter(operation =>
        operation.partId === 'panel_back' && operation.purpose === 'service_door'
    );
    assert.equal(openingOperations.length, 1);
    assert.equal(openingOperations[0].id, 'panel_back:rear-service-door-opening:throughCut');
    assert.equal(openingOperations[0].matingPartId, door.id);
    assert.equal(openingOperations[0].clearancePerSideMm, 2);
});

test('screen frame emits four unique closed fabrication pieces and a mating schedule', () => {
    const { manifest } = createAssemblyManifest();
    const framePartIds = [
        FABRICATION_ASSEMBLY_PART_IDS.screenFrameTop,
        FABRICATION_ASSEMBLY_PART_IDS.screenFrameBottom,
        FABRICATION_ASSEMBLY_PART_IDS.screenFrameLeft,
        FABRICATION_ASSEMBLY_PART_IDS.screenFrameRight
    ];
    const allIds = manifest.parts.map(part => part.id);
    assert.equal(new Set(allIds).size, allIds.length);

    framePartIds.forEach(partId => {
        const part = manifest.parts.find(item => item.id === partId);
        assert.ok(part, `${partId} should be present`);
        assert.equal(part.includeInFabrication, true);
        assert.equal(part.thicknessMm, 12);
        assert.equal(part.materialId, 'sheet-12mm');
        assert.equal(part.metadata.assemblyId, FABRICATION_ASSEMBLY_IDS.screenFrame);
        assert.equal(part.metadata.jointTreatment, 'square-butt');

        const outer = manifest.contours.find(contour => contour.id === `${partId}:outer`);
        assert.equal(outer.closed, true);
        assert.equal(outer.points.length, 4);
        assert.ok(outer.points.every(point => Number.isFinite(point.xMm) && Number.isFinite(point.yMm)));
        const operations = manifest.operations.filter(operation => operation.partId === partId);
        assert.equal(operations.filter(operation => operation.type === 'profileCut').length, 1);
    });

    const schedule = manifest.assemblySchedules.find(item => item.id === FABRICATION_ASSEMBLY_IDS.screenFrame);
    assert.deepEqual(schedule.partIds, framePartIds);
    assert.deepEqual(schedule.includedPartIds, framePartIds);
    assert.equal(schedule.pieces.length, 4);
    assert.ok(schedule.pieces.every(piece => piece.quantity === 1 && piece.jointTreatment === 'square-butt'));
    schedule.placementReferenceOperationIds.forEach(operationId => {
        assert.ok(manifest.operations.some(operation => operation.id === operationId));
    });
});

test('fabrication inclusion is independent per assembly part and helper generation is idempotent', () => {
    const excludedId = FABRICATION_ASSEMBLY_PART_IDS.screenFrameRight;
    const { assemblies, manifest } = createAssemblyManifest('standard', {
        excludedPartIds: [excludedId],
        hiddenPartIds: [FABRICATION_ASSEMBLY_PART_IDS.screenFrameLeft]
    });
    const excluded = manifest.parts.find(part => part.id === excludedId);
    const hidden = manifest.parts.find(part => part.id === FABRICATION_ASSEMBLY_PART_IDS.screenFrameLeft);
    assert.equal(excluded.includeInFabrication, false);
    assert.equal(hidden.includeInFabrication, true);
    assert.equal(hidden.viewportVisible, false);

    const schedule = manifest.assemblySchedules.find(item => item.id === FABRICATION_ASSEMBLY_IDS.screenFrame);
    assert.equal(schedule.includedPartIds.includes(excludedId), false);
    assert.equal(schedule.includedPartIds.includes(hidden.id), true);

    const secondPass = createCabinetAssemblyFabricationRecords({
        parts: [...parentRecords(), ...assemblies.parts]
    });
    assert.deepEqual(secondPass.parts, []);
});

test('enabled Standard and Bar-top assemblies have finite contours and zero blocking preflight errors', () => {
    for (const preset of ['standard', 'barstool']) {
        const { manifest } = createAssemblyManifest(preset);
        const errors = runPreflight(manifest).filter(finding => finding.severity === 'error');
        assert.deepEqual(errors, [], `${preset} should have no assembly-related preflight errors`);
        assert.ok(manifest.contours.every(contour =>
            contour.closed === true
            && contour.points.length >= 3
            && contour.points.every(point => Number.isFinite(point.xMm) && Number.isFinite(point.yMm))
        ));
    }
});

test('the built-in Standard and Bar-top cabinet models export the assemblies with zero preflight errors', () => {
    const previousDocument = globalThis.document;
    const noop = () => {};
    const context = new Proxy({}, {
        get: (target, property) => target[property] ?? noop,
        set: (target, property, value) => {
            target[property] = value;
            return true;
        }
    });
    globalThis.document = {
        createElement: () => ({ width: 0, height: 0, getContext: () => context })
    };

    try {
        for (const presetId of ['standard', 'barstool']) {
            const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS[presetId]));
            const manifest = cabinet.getFabricationManifest();
            const errors = cabinet.getPreflightResults().filter(finding => finding.severity === 'error');
            assert.deepEqual(errors, [], `${presetId} should pass production preflight`);
            const joystickInstances = manifest.hardwareInstances.filter(instance => instance.definitionId === 'joystick-jlf-pattern');
            assert.equal(joystickInstances.length, 2, `${presetId} should carry two authoritative joystick instances`);
            joystickInstances.forEach(instance => {
                const operations = manifest.operations.filter(operation => operation.hardwareInstanceId === instance.id);
                assert.equal(operations.filter(operation => operation.type === 'throughCut').length, 1);
                assert.equal(operations.filter(operation => operation.type === 'drill').length, 4);
                const keepout = manifest.keepouts.find(item => item.hardwareInstanceId === instance.id);
                assert.equal(keepout.kind, 'box');
                assert.ok(keepout.widthMm > 0 && keepout.heightMm > 0 && keepout.serviceEnvelope.widthMm > keepout.widthMm);
            });
            assert.ok(manifest.parts.some(part => part.id === FABRICATION_ASSEMBLY_PART_IDS.rearServiceDoor));
            assert.ok(manifest.parts.some(part => part.id === FABRICATION_ASSEMBLY_PART_IDS.screenFrameTop));
            assert.equal(manifest.assemblySchedules.length, 2);
        }
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

test('disabled parent features produce no detachable service parts or schedules', () => {
    const parents = parentRecords();
    parents[0].cutouts = [];
    parents[1].screenFrame = null;
    const result = createCabinetAssemblyFabricationRecords({ parts: parents });
    assert.deepEqual(result, { parts: [], schedules: [] });
});
