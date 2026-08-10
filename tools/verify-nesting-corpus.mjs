import { createHash } from 'node:crypto';
import { createNestingPlan, validateNestingPlan } from '../wwwroot/js/nesting.js';
import { createNestingCorpusCases } from '../tests/helpers/nesting-corpus.js';

const results = [];
for (const fixture of createNestingCorpusCases()) {
    const options = { ...fixture.options, includeCandidates: true };
    const startedAt = performance.now();
    const first = createNestingPlan(fixture.manifest, fixture.manifest.materials, options);
    const elapsedMs = performance.now() - startedAt;
    const second = createNestingPlan(fixture.manifest, fixture.manifest.materials, options);
    const firstSignature = qualitySignature(first);
    const secondSignature = qualitySignature(second);
    const validationErrors = validateNestingPlan(first, fixture.manifest.materials)
        .filter(finding => finding.severity === 'error');
    if (firstSignature !== secondSignature) throw new Error(`${fixture.name} was not deterministic.`);
    if (validationErrors.length) throw new Error(`${fixture.name} produced ${validationErrors.length} validation errors.`);
    verifyExpectedInvariants(fixture, first);
    results.push({
        name: fixture.name,
        elapsedMs: round(elapsedMs),
        qualitySignature: firstSignature,
        selectedStrategy: first.selectedStrategy,
        sheetCount: first.sheets.length,
        placementCount: first.sheets.reduce((sum, sheet) => sum + sheet.placements.length, 0),
        materialIds: [...new Set(first.sheets.map(sheet => sheet.materialId))].sort(),
        utilizationPercent: first.totals.utilizationPercent,
        validationErrors: 0
    });
}

process.stdout.write(`${JSON.stringify({
    schema: 'cabinet-crafter-nesting-corpus-v1',
    cases: results.length,
    deterministic: true,
    validationErrors: 0,
    results
}, null, 2)}\n`);

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
    if (fixture.expectedSheetCount !== undefined && plan.sheets.length !== fixture.expectedSheetCount) {
        throw new Error(`${fixture.name} expected ${fixture.expectedSheetCount} sheets but received ${plan.sheets.length}.`);
    }
    if (fixture.expectedSelectedStrategy && plan.selectedStrategy !== fixture.expectedSelectedStrategy) {
        throw new Error(`${fixture.name} expected ${fixture.expectedSelectedStrategy} but received ${plan.selectedStrategy}.`);
    }
    if (fixture.expectedMaterialIds) {
        const actual = [...new Set(plan.sheets.map(sheet => sheet.materialId))].sort().join(':');
        const expected = [...fixture.expectedMaterialIds].sort().join(':');
        if (actual !== expected) throw new Error(`${fixture.name} material groups did not match.`);
    }
    if (fixture.expectedPinnedInstanceId) {
        const pinned = plan.sheets.flatMap(sheet => sheet.placements)
            .find(placement => placement.instanceId === fixture.expectedPinnedInstanceId);
        if (!pinned?.pinned) throw new Error(`${fixture.name} did not preserve its pinned placement.`);
    }
    if (fixture.expectedRotations) {
        const allowed = new Set(fixture.expectedRotations);
        const invalid = plan.sheets.flatMap(sheet => sheet.placements)
            .some(placement => !allowed.has(placement.rotationDeg));
        if (invalid) throw new Error(`${fixture.name} used a disallowed rotation.`);
    }
    if (fixture.expectedSpacingMm !== undefined && plan.sheets.some(sheet => sheet.partSpacingMm !== fixture.expectedSpacingMm)) {
        throw new Error(`${fixture.name} did not retain its requested spacing.`);
    }
    if (fixture.expectedExcludedInstanceId && !plan.excluded.some(item => item.instanceId === fixture.expectedExcludedInstanceId)) {
        throw new Error(`${fixture.name} did not retain its exclusion.`);
    }
    if (fixture.expectedVoidFillPlacementCount !== undefined) {
        const voidFill = plan.candidates.find(candidate => candidate.strategy === 'voidfill');
        const count = voidFill?.sheets.reduce((sum, sheet) => sum + sheet.placements.length, 0);
        if (voidFill?.sheets.length !== 1 || count !== fixture.expectedVoidFillPlacementCount) {
            throw new Error(`${fixture.name} did not retain the expected void-fill consolidation.`);
        }
    }
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}
