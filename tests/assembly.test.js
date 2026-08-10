import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateTMoulding,
    generateAssemblyPlan,
    generatePartLabels,
    serializeAssemblyMarkdown
} from '../wwwroot/js/assembly.js';
import { createManifestFixture } from './helpers/fixtures.js';

test('assembly plan turns stable part IDs into numbered build steps', () => {
    const manifest = createManifestFixture();
    const plan = generateAssemblyPlan(manifest);
    assert.equal(plan.projectName, 'Golden Standard');
    assert.equal(plan.summary.parts, 4);
    assert.deepEqual(plan.steps.map(step => step.number), plan.steps.map((_, index) => index + 1));
    assert.equal(plan.steps[0].id, 'prepare');
    assert.ok(plan.steps.some(step => step.id === 'datum-side'));
    assert.ok(plan.steps.some(step => step.id === 'close-cabinet'));
    assert.ok(plan.steps.some(step => step.id === 'fit-hardware'));
    assert.equal(plan.steps.at(-1).id, 'final-inspection');
});

test('assembly labels carry material, thickness, face, grain, and joint identity', () => {
    const manifest = createManifestFixture();
    const labels = generatePartLabels(manifest);
    const control = labels.find(label => label.partId === 'panel_cp');
    assert.equal(control.material, 'MDF 18 mm');
    assert.equal(control.thicknessMm, 18);
    assert.equal(control.finishedFace, 'front');
    assert.ok(control.joints.some(joint => joint.includes('mitre')));

    manifest.parts.find(part => part.id === 'panel_back').includeInFabrication = false;
    assert.equal(generatePartLabels(manifest).some(label => label.partId === 'panel_back'), false);
});

test('T-moulding calculator applies width, slot, and waste allowance per edge', () => {
    const result = calculateTMoulding(createManifestFixture(), {
        side_left: [{ edgeId: 'outer', lengthMm: 1000, widthMm: 18, slotWidthMm: 1.6 }],
        side_right: [{ edgeId: 'outer', lengthMm: 1000, widthMm: 18, slotWidthMm: 1.6 }]
    }, { wastePercent: 10 });
    assert.equal(result.records.length, 2);
    assert.equal(result.records[0].orderLengthMm, 1100);
    assert.equal(result.totalOrderLengthMm, 2200);
    assert.equal(result.byWidth['18mm / 1.6mm slot'].length, 2);
});

test('assembly Markdown is a printable, checkable handoff', () => {
    const markdown = serializeAssemblyMarkdown(generateAssemblyPlan(createManifestFixture('barstool')));
    assert.match(markdown, /^# Golden Bar-top assembly guide/m);
    assert.match(markdown, /## 1\. Prepare and identify parts/);
    assert.match(markdown, /- \[ \] Part count matches the BOM/);
});
