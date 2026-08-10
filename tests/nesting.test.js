import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialProfile } from '../wwwroot/js/materials.js';
import { createNestingPlan, transformPartPoint, validateNestingPlan } from '../wwwroot/js/nesting.js';
import { createManifestFixture, createSourceFixture } from './helpers/fixtures.js';
import { createFabricationManifest } from '../wwwroot/js/fabrication.js';

test('true-shape nesting produces bounded, spaced, deterministic candidates', () => {
    const manifest = createManifestFixture();
    const first = createNestingPlan(manifest, manifest.materials);
    const second = createNestingPlan(manifest, manifest.materials);
    assert.ok(first.sheets.length >= 1);
    assert.equal(first.unplaced.length, 0);
    assert.equal(first.findings.length, 0);
    assert.ok(first.alternatives.length >= 1);
    assert.deepEqual(
        first.sheets.map(sheet => sheet.placements.map(item => [item.instanceId, item.xMm, item.yMm, item.rotationDeg])),
        second.sheets.map(sheet => sheet.placements.map(item => [item.instanceId, item.xMm, item.yMm, item.rotationDeg]))
    );
    assert.equal(first.sheets.flatMap(sheet => sheet.placements).find(item => item.partId === 'side_left').polygon.length, 5);
    assert.ok(first.sheets.every(sheet => Array.isArray(sheet.reusableOffcuts)));
    assert.equal(first.totals.reusableOffcutAreaMm2, first.sheets.reduce((sum, sheet) => sum + sheet.reusableOffcutAreaMm2, 0));
});

test('nesting validates available sheet quantity', () => {
    const manifest = createManifestFixture();
    manifest.materials[0].quantityAvailable = 1;
    manifest.parts.find(part => part.id === 'side_left').quantity = 5;
    const plan = createNestingPlan(manifest, manifest.materials);
    assert.ok(plan.sheets.length > 1);
    assert.ok(plan.findings.some(item => item.code === 'NEST_STOCK_QUANTITY' && item.severity === 'error'));
});

test('sheet workspace can inspect ranked geometry and select a named strategy', () => {
    const manifest = createManifestFixture();
    const ranked = createNestingPlan(manifest, manifest.materials, { includeCandidates: true });
    assert.equal(ranked.candidates.length, ranked.candidateSummaries.length);
    assert.ok(ranked.candidates.every(candidate => candidate.sheets.every(sheet => Array.isArray(sheet.placements))));

    const requested = ranked.candidateSummaries.at(-1).strategy;
    const selected = createNestingPlan(manifest, manifest.materials, { strategy: requested });
    assert.equal(selected.selectedStrategy, requested);
    assert.equal(selected.candidateSummaries.find(item => item.selected).strategy, requested);
    assert.ok(selected.alternatives.every(item => item.strategy !== requested));
});

test('sheet workspace preserves pinned edits, exclusions, and rotation rules', () => {
    const manifest = createManifestFixture('barstool');
    manifest.materials[0].allowedRotations = [0, 180];
    const plan = createNestingPlan(manifest, manifest.materials, {
        pinnedPlacements: [{ instanceId: 'panel_cp:1', sheetIndex: 1, xMm: 20, yMm: 30, rotationDeg: 90 }],
        excludedInstanceIds: ['panel_back:1']
    });
    const pinned = plan.sheets.flatMap(sheet => sheet.placements).find(item => item.instanceId === 'panel_cp:1');
    assert.equal(pinned.pinned, true);
    assert.equal(pinned.xMm, 20);
    assert.equal(pinned.yMm, 30);
    assert.equal(pinned.rotationDeg, 90);
    assert.ok(plan.excluded.some(item => item.instanceId === 'panel_back:1'));
    assert.ok(plan.findings.some(item => item.code === 'NEST_ROTATION_NOT_ALLOWED' && item.partIds.includes('panel_cp')));
});

test('mixed material assignments create separate sheet groups and preserve quantities', () => {
    const manifest = createManifestFixture('barstool');
    manifest.materials.push(createMaterialProfile({ id: 'ply-12', name: 'Ply 12', measuredThicknessMm: 12 }));
    const control = manifest.parts.find(part => part.id === 'panel_cp');
    control.materialId = 'ply-12';
    control.quantity = 2;
    const plan = createNestingPlan(manifest, manifest.materials);
    assert.deepEqual(new Set(plan.sheets.map(sheet => sheet.materialId)), new Set(['mdf-18', 'ply-12']));
    assert.equal(plan.sheets.flatMap(sheet => sheet.placements).filter(item => item.partId === 'panel_cp').length, 2);
});

test('oversized parts remain unplaced with a stable blocking diagnostic', () => {
    const source = createSourceFixture();
    const back = source.parts.find(part => part.id === 'panel_back');
    back.widthMm = 3000;
    back.lengthMm = 2000;
    back.profilePoints = [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }, { x: 0, y: 2000 }];
    back.exportType = 'profile';
    const manifest = createFabricationManifest(source);
    const plan = createNestingPlan(manifest, manifest.materials);
    assert.ok(plan.unplaced.some(item => item.partId === 'panel_back'));
    assert.ok(plan.findings.some(item => item.code === 'NEST_PART_UNPLACED' && item.severity === 'error'));
});

test('nest validation detects out-of-bounds and overlapping placements', () => {
    const profile = createMaterialProfile({ id: 'stock', sheetWidthMm: 500, sheetHeightMm: 500, trimMarginMm: 10, partSpacingMm: 8 });
    const polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const plan = {
        unplaced: [],
        sheets: [{
            index: 1, materialId: 'stock', widthMm: 500, heightMm: 500,
            trimMarginMm: 10, partSpacingMm: 8,
            placements: [
                { partId: 'a', name: 'A', polygon, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
                { partId: 'b', name: 'B', polygon, bounds: { minX: 20, minY: 20, maxX: 120, maxY: 120 } }
            ]
        }]
    };
    const codes = new Set(validateNestingPlan(plan, [profile]).map(item => item.code));
    assert.ok(codes.has('NEST_OUT_OF_BOUNDS'));
    assert.ok(codes.has('NEST_PART_OVERLAP'));
});

test('part point transforms honor sheet position and quarter-turn rotation', () => {
    const point = transformPartPoint({ x: 10, y: 20 }, { xMm: 100, yMm: 50, rotationDeg: 90 });
    assert.ok(Math.abs(point.x - 80) < 1e-9);
    assert.ok(Math.abs(point.y - 60) < 1e-9);
});

test('concave profile voids are searched so small parts consolidate onto one sheet', () => {
    const profile = createMaterialProfile({
        id: 'compact-stock',
        name: 'Compact stock',
        sheetWidthMm: 1000,
        sheetHeightMm: 600,
        trimMarginMm: 10,
        partSpacingMm: 8,
        allowedRotations: [0]
    });
    const contours = [
        {
            id: 'side:outer', partId: 'side', role: 'outer', closed: true,
            points: [
                { xMm: 0, yMm: 0 }, { xMm: 600, yMm: 0 }, { xMm: 600, yMm: 200 },
                { xMm: 200, yMm: 200 }, { xMm: 200, yMm: 500 }, { xMm: 0, yMm: 500 }
            ]
        },
        {
            id: 'bar-a:outer', partId: 'bar-a', role: 'outer', closed: true,
            points: [{ xMm: 0, yMm: 0 }, { xMm: 380, yMm: 0 }, { xMm: 380, yMm: 120 }, { xMm: 0, yMm: 120 }]
        },
        {
            id: 'bar-b:outer', partId: 'bar-b', role: 'outer', closed: true,
            points: [{ xMm: 0, yMm: 0 }, { xMm: 380, yMm: 0 }, { xMm: 380, yMm: 120 }, { xMm: 0, yMm: 120 }]
        }
    ];
    const manifest = {
        materialThicknessMm: 18,
        materials: [profile],
        materialAssignments: {},
        contours,
        operations: [],
        parts: [
            { id: 'side', name: 'Concave side', thicknessMm: 18, contourIds: ['side:outer'], includeInFabrication: true },
            { id: 'bar-a', name: 'Bar A', thicknessMm: 18, contourIds: ['bar-a:outer'], includeInFabrication: true },
            { id: 'bar-b', name: 'Bar B', thicknessMm: 18, contourIds: ['bar-b:outer'], includeInFabrication: true }
        ]
    };
    const plan = createNestingPlan(manifest, [profile]);
    assert.equal(plan.sheets.length, 1);
    assert.equal(plan.sheets[0].placements.length, 3);
    assert.equal(plan.unplaced.length, 0);
    assert.deepEqual(plan.findings, []);
});
