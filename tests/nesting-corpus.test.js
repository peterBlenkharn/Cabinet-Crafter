import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createNestingPlan, validateNestingPlan } from '../wwwroot/js/nesting.js';
import { createNestingCorpusCases } from './helpers/nesting-corpus.js';

const EXPECTED_SIGNATURES = {
    standard: 'e681530c4c6a997741a93aa8757c8163f5ed56401c2cbf40207af7ab5af5e57d',
    'bar-top': '1427cb614d4e8b2cc2ef466e2421456f25acbee8087c43b7cb4f5e509548f44b',
    'mixed-material-thickness': '5d754d233efc585aee5154b9a0b836ef052cf07357e4d60233ac59a92bc9b48e',
    'concave-profile': 'd41b8054ac43a47919607a55bbd4c49601c4aac42ff9fcc1d12459ab82e57ed1',
    'pinned-placement': '3b4c2df168eebd405d7400296b9b1cd6f1a0f83726c2b0a3d2892c6f4041147c',
    'grain-rotation-constraint': 'd335301ba06ed606be3637db6aa88494ce4d314e9fa74c67c72e078352b0fb44',
    'tight-spacing': '580f62a3ec967009e3fc222412eff9a24a3d56d7b66233b4a6b08ec55febd67d',
    'excluded-part': '81be5805acb714a09ced615e830f90f1dbe88cbb6178c1082b9c985a35ea85fa',
    'known-void-fill': 'a0bb95801a588cec6bdda5130240dff1ffc412e867d4e2578bcb242f433a54b8'
};

for (const fixture of createNestingCorpusCases()) {
    test(`nesting quality corpus preserves ${fixture.name}`, () => {
        const options = { ...fixture.options, includeCandidates: true };
        const first = createNestingPlan(fixture.manifest, fixture.manifest.materials, options);
        const second = createNestingPlan(fixture.manifest, fixture.manifest.materials, options);
        assert.equal(qualitySignature(first), EXPECTED_SIGNATURES[fixture.name]);
        assert.equal(qualitySignature(second), EXPECTED_SIGNATURES[fixture.name]);
        assert.deepEqual(
            validateNestingPlan(first, fixture.manifest.materials).filter(finding => finding.severity === 'error'),
            []
        );
        assert.deepEqual(first.findings.filter(finding => finding.severity === 'error'), []);
        verifyExpectedInvariants(fixture, first);
    });
}

function qualitySignature(plan) {
    const payload = plan.candidates.map(candidate => ({
        strategy: candidate.strategy,
        sheets: candidate.sheets.map(sheet => sheet.placements.map(placement => [
            placement.instanceId,
            placement.xMm,
            placement.yMm,
            placement.rotationDeg
        ])),
        totals: candidate.totals
    }));
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function verifyExpectedInvariants(fixture, plan) {
    if (fixture.expectedSheetCount !== undefined) assert.equal(plan.sheets.length, fixture.expectedSheetCount);
    if (fixture.expectedSelectedStrategy) assert.equal(plan.selectedStrategy, fixture.expectedSelectedStrategy);
    if (fixture.expectedMaterialIds) {
        assert.deepEqual(
            [...new Set(plan.sheets.map(sheet => sheet.materialId))].sort(),
            [...fixture.expectedMaterialIds].sort()
        );
    }
    if (fixture.expectedPinnedInstanceId) {
        const pinned = plan.sheets.flatMap(sheet => sheet.placements)
            .find(placement => placement.instanceId === fixture.expectedPinnedInstanceId);
        assert.equal(pinned?.pinned, true);
    }
    if (fixture.expectedRotations) {
        const allowed = new Set(fixture.expectedRotations);
        assert.ok(plan.sheets.flatMap(sheet => sheet.placements).every(placement => allowed.has(placement.rotationDeg)));
    }
    if (fixture.expectedSpacingMm !== undefined) {
        assert.ok(plan.sheets.every(sheet => sheet.partSpacingMm === fixture.expectedSpacingMm));
    }
    if (fixture.expectedExcludedInstanceId) {
        assert.ok(plan.excluded.some(item => item.instanceId === fixture.expectedExcludedInstanceId));
    }
    if (fixture.expectedVoidFillPlacementCount !== undefined) {
        const voidFill = plan.candidates.find(candidate => candidate.strategy === 'voidfill');
        assert.equal(voidFill.sheets.length, 1);
        assert.equal(
            voidFill.sheets.reduce((sum, sheet) => sum + sheet.placements.length, 0),
            fixture.expectedVoidFillPlacementCount
        );
    }
}
