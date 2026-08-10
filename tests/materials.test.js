import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_MATERIAL_PROFILES,
    createMaterialProfile,
    normalizeMaterialProfiles,
    resolvePartMaterial,
    summarizeMaterials,
    validateMaterialProfile
} from '../wwwroot/js/materials.js';

test('material profiles retain measured stock and process constraints in millimetres', () => {
    const profile = createMaterialProfile({
        id: 'Birch 18', name: 'Birch ply', nominalThicknessMm: 18,
        measuredThicknessMm: 17.7, sheetWidthMm: 2440, sheetHeightMm: 1220,
        grainDirection: 'length', finishedFaces: 'two', allowedRotations: [0, 180],
        densityKgM3: 680, pricePerSheet: 81.5, trimMarginMm: 10, partSpacingMm: 6
    });
    assert.equal(profile.id, 'birch-18');
    assert.equal(profile.measuredThicknessMm, 17.7);
    assert.deepEqual(profile.allowedRotations, [0, 180]);
    assert.equal(profile.grainDirection, 'length');
});

test('material validation reports thickness variance, consumed margins, and missing rotations', () => {
    const { findings } = validateMaterialProfile({
        nominalThicknessMm: 18, measuredThicknessMm: 10,
        sheetWidthMm: 20, sheetHeightMm: 20, trimMarginMm: 11,
        allowedRotations: []
    });
    const codes = new Set(findings.map(item => item.code));
    assert.ok(codes.has('MATERIAL_THICKNESS_VARIANCE'));
    assert.ok(codes.has('MATERIAL_STOCK_MARGIN'));
    assert.ok(codes.has('MATERIAL_ROTATIONS'));
});

test('normalization supplies defaults, unique IDs, and closest-thickness resolution', () => {
    assert.ok(DEFAULT_MATERIAL_PROFILES.length >= 4);
    const profiles = normalizeMaterialProfiles([
        { id: 'sheet', thickness: 12 },
        { id: 'sheet', thickness: 18 }
    ]);
    assert.deepEqual(profiles.map(item => item.id), ['sheet', 'sheet-2']);
    assert.equal(resolvePartMaterial({ id: 'part', thicknessMm: 17.8 }, profiles).id, 'sheet-2');
    assert.equal(resolvePartMaterial({ id: 'part', materialId: 'sheet' }, profiles).id, 'sheet');
});

test('material summary reconciles quantity, area, weight, sheet count, and cost', () => {
    const profiles = [createMaterialProfile({
        id: 'mdf', name: 'MDF', measuredThicknessMm: 18,
        densityKgM3: 750, pricePerSheet: 40
    })];
    const summary = summarizeMaterials([
        { id: 'a', materialId: 'mdf', quantity: 2, areaMm2: 500000, thicknessMm: 18 },
        { id: 'b', materialId: 'mdf', quantity: 1, widthMm: 500, lengthMm: 500, thicknessMm: 18 }
    ], profiles, {}, [{ materialId: 'mdf' }, { materialId: 'mdf' }]);
    assert.equal(summary[0].partCount, 3);
    assert.equal(summary[0].areaMm2, 1250000);
    assert.equal(summary[0].areaM2, 1.25);
    assert.equal(summary[0].weightKg, 16.88);
    assert.equal(summary[0].sheets, 2);
    assert.equal(summary[0].estimatedCost, 80);
    assert.equal(summary[0].sheetWidthMm, 2440);
    assert.equal(summary[0].sheetHeightMm, 1220);
});
