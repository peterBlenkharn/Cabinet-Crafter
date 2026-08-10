import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectDocument } from '../wwwroot/js/project-document.js';
import {
    buildBatchPlan,
    buildQuote,
    compareDesignVariants,
    createDesignVariant,
    createWorkshopProfile,
    serializeQuoteCsv
} from '../wwwroot/js/workshop.js';
import { createManifestFixture } from './helpers/fixtures.js';

test('portable workshop profile normalizes costing, process, materials, and batch defaults', () => {
    const profile = createWorkshopProfile({
        id: 'My Shop', name: 'My Shop', currency: 'usd',
        labourRatePerHour: 45, machineRatePerHour: 30,
        materialWastePercent: 12, defaultBatchQuantity: 3,
        processProfileId: 'router-6mm', materialProfileIds: ['mdf-18', 'mdf-18', 'ply-12']
    });
    assert.equal(profile.id, 'my-shop');
    assert.equal(profile.currency, 'USD');
    assert.equal(profile.defaultBatchQuantity, 3);
    assert.equal(profile.processProfileId, 'router-6mm');
    assert.deepEqual(profile.materialProfileIds, ['mdf-18', 'ply-12']);
});

test('named variants are deep copies and comparison isolates changed parameters and metrics', () => {
    const standard = createProjectDocument({ name: 'Standard', params: { width: 600, height: 1800, grid: true } });
    const wide = structuredClone(standard);
    wide.design.params.width = 700;
    const variants = [
        createDesignVariant(standard, 'Standard', { id: 'standard', metrics: { sheets: 2, cost: 100 } }),
        createDesignVariant(wide, 'Wide', { id: 'wide', basedOnVariantId: 'standard', metrics: { sheets: 3, cost: 125 } })
    ];
    standard.design.params.width = 999;
    assert.equal(variants[0].project.design.params.width, 600);

    const comparison = compareDesignVariants(variants);
    assert.deepEqual(comparison.parameterDifferences.map(item => item.key), ['width']);
    assert.deepEqual(comparison.parameterDifferences[0].values.map(item => item.value), [600, 700]);
    assert.deepEqual(comparison.metricComparison.map(item => item.key), ['cost', 'sheets']);
});

test('batch planning scales included parts, hardware packs, and label quantity', () => {
    const manifest = createManifestFixture();
    manifest.parts.find(part => part.id === 'panel_back').includeInFabrication = false;
    manifest.parts.find(part => part.id === 'panel_cp').quantity = 2;
    const plan = buildBatchPlan(manifest, 3, {
        hardwareSchedule: [{ definitionId: 'button-30-snap', name: 'Button', quantity: 6 }]
    });
    assert.equal(plan.cabinetQuantity, 3);
    assert.equal(plan.partQuantities.some(item => item.partId === 'panel_back'), false);
    assert.equal(plan.partQuantities.find(item => item.partId === 'panel_cp').total, 6);
    assert.equal(plan.hardware[0].perCabinet, 6);
    assert.equal(plan.hardware[0].quantity, 18);
    assert.equal(plan.packagingAllowance.labels, 12);
    assert.equal(plan.packagingAllowance.hardwarePacks, 3);
});

test('quote-ready costing reconciles waste, labour, machine time, overhead, and markup', () => {
    const quote = buildQuote({
        quoteNumber: 'CC-TEST-001', quantity: 2,
        workshopProfile: {
            currency: 'GBP', materialWastePercent: 10,
            labourRatePerHour: 100, machineRatePerHour: 50,
            consumablesPercent: 5, overheadPercent: 10,
            contingencyPercent: 0, markupPercent: 20
        },
        materialSummary: [{ estimatedCost: 100 }],
        hardwareSchedule: [{ quantity: 3, unitPrice: 10 }],
        labourHoursPerCabinet: 2,
        machineHoursPerCabinet: 1
    });
    assert.equal(quote.quoteNumber, 'CC-TEST-001');
    assert.equal(quote.quantity, 2);
    assert.equal(quote.costTotal, 900.9);
    assert.equal(quote.quoteTotal, 1081.08);
    assert.equal(quote.perCabinet, 540.54);
    assert.equal(quote.lineItems.find(item => item.description === 'Materials').amount, 220);

    const csv = serializeQuoteCsv(quote);
    assert.match(csv, /Quote,CC-TEST-001/);
    assert.match(csv, /Total,1081\.08/);
    assert.match(csv, /Per cabinet,540\.54/);
});
