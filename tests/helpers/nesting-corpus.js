import { createMaterialProfile } from '../../wwwroot/js/materials.js';
import { createManifestFixture } from './fixtures.js';

export function createNestingCorpusCases() {
    return [
        fixtureCase('standard', 'standard'),
        fixtureCase('bar-top', 'barstool'),
        mixedMaterialCase(),
        concaveProfileCase(),
        pinnedPlacementCase(),
        grainRotationCase(),
        tightSpacingCase(),
        excludedPartCase(),
        voidFillCase()
    ];
}

function fixtureCase(name, preset) {
    return { name, manifest: createManifestFixture(preset), options: {} };
}

function mixedMaterialCase() {
    const manifest = createManifestFixture('barstool');
    manifest.materials.push(createMaterialProfile({
        id: 'ply-12',
        name: 'Plywood 12 mm',
        measuredThicknessMm: 12,
        grainDirection: 'length',
        allowedRotations: [0, 180]
    }));
    const control = manifest.parts.find(part => part.id === 'panel_cp');
    control.materialId = 'ply-12';
    control.thicknessMm = 12;
    control.quantity = 2;
    return {
        name: 'mixed-material-thickness',
        manifest,
        options: {},
        expectedMaterialIds: ['mdf-18', 'ply-12']
    };
}

function concaveProfileCase() {
    const profile = compactProfile('concave-stock', 900, 700);
    const manifest = contourManifest(profile, [
        contourPart('concave-side', [
            [0, 0], [500, 0], [500, 180], [180, 180], [180, 500], [0, 500]
        ]),
        contourPart('cross-rail', [[0, 0], [300, 0], [300, 90], [0, 90]])
    ]);
    return { name: 'concave-profile', manifest, options: {}, expectedSheetCount: 1 };
}

function pinnedPlacementCase() {
    const manifest = createManifestFixture('barstool');
    return {
        name: 'pinned-placement',
        manifest,
        options: {
            pinnedPlacements: [{ instanceId: 'panel_cp:1', sheetIndex: 1, xMm: 20, yMm: 20, rotationDeg: 0 }]
        },
        expectedPinnedInstanceId: 'panel_cp:1'
    };
}

function grainRotationCase() {
    const manifest = createManifestFixture();
    manifest.materials[0].grainDirection = 'length';
    manifest.materials[0].allowedRotations = [0, 180];
    return {
        name: 'grain-rotation-constraint',
        manifest,
        options: {},
        expectedRotations: [0, 180]
    };
}

function tightSpacingCase() {
    const manifest = createManifestFixture('barstool');
    return {
        name: 'tight-spacing',
        manifest,
        options: { spacingMm: 1.5 },
        expectedSpacingMm: 1.5
    };
}

function excludedPartCase() {
    const manifest = createManifestFixture();
    return {
        name: 'excluded-part',
        manifest,
        options: { excludedInstanceIds: ['panel_back:1'] },
        expectedExcludedInstanceId: 'panel_back:1'
    };
}

function voidFillCase() {
    const profile = compactProfile('void-stock', 1000, 600);
    const manifest = contourManifest(profile, [
        contourPart('side', [
            [0, 0], [600, 0], [600, 200], [200, 200], [200, 500], [0, 500]
        ]),
        contourPart('bar-a', [[0, 0], [380, 0], [380, 120], [0, 120]]),
        contourPart('bar-b', [[0, 0], [380, 0], [380, 120], [0, 120]])
    ]);
    return {
        name: 'known-void-fill',
        manifest,
        options: {},
        expectedSheetCount: 1,
        expectedVoidFillPlacementCount: 3
    };
}

function compactProfile(id, sheetWidthMm, sheetHeightMm) {
    return createMaterialProfile({
        id,
        name: id,
        sheetWidthMm,
        sheetHeightMm,
        trimMarginMm: 10,
        partSpacingMm: 8,
        allowedRotations: [0]
    });
}

function contourPart(id, coordinates) {
    return {
        id,
        name: id,
        points: coordinates.map(([xMm, yMm]) => ({ xMm, yMm }))
    };
}

function contourManifest(profile, parts) {
    return {
        materialThicknessMm: profile.measuredThicknessMm,
        materials: [profile],
        materialAssignments: {},
        contours: parts.map(part => ({
            id: `${part.id}:outer`,
            partId: part.id,
            role: 'outer',
            closed: true,
            points: part.points
        })),
        operations: [],
        parts: parts.map(part => ({
            id: part.id,
            name: part.name,
            thicknessMm: profile.measuredThicknessMm,
            materialId: profile.id,
            contourIds: [`${part.id}:outer`],
            includeInFabrication: true
        }))
    };
}
