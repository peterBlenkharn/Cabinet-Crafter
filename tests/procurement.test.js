import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCostedHardwareSchedule,
    buildProcurementBom,
    normalizeAdditionalHardwareItems,
    normalizeHardwareCostOverrides
} from '../wwwroot/js/procurement.js';

test('hardware costs and additional components normalize into a priced schedule', () => {
    const overrides = normalizeHardwareCostOverrides({
        'button-30': { unitPrice: 3.25, supplier: 'Parts Co', sku: 'BTN30' }
    });
    const additional = normalizeAdditionalHardwareItems([
        { id: 'mini-pc', name: 'Mini PC', category: 'electronics', quantity: 1, unitPrice: 210 }
    ]);
    const schedule = buildCostedHardwareSchedule([
        { definitionId: 'button-30', category: 'button', name: '30 mm button', quantity: 12 }
    ], { hardwareCosts: overrides, additionalHardware: additional });

    assert.equal(schedule[0].lineCost, 39);
    assert.equal(schedule[0].supplier, 'Parts Co');
    assert.equal(schedule[1].name, 'Mini PC');
    assert.equal(schedule[1].lineCost, 210);
});

test('additional component quantities scale independently for a fabrication batch', () => {
    const schedule = buildCostedHardwareSchedule([
        { definitionId: 'encoder', category: 'electronics', name: 'Encoder', quantity: 4, unitPrice: 18 }
    ], {
        additionalHardware: [{ id: 'pc', name: 'PC', quantity: 1, unitPrice: 200 }],
        additionalQuantityMultiplier: 4
    });

    assert.equal(schedule.find(item => item.definitionId === 'encoder').quantity, 4);
    assert.equal(schedule.find(item => item.definitionId === 'pc').quantity, 4);
});

test('additional component lines preserve an optional linked library definition', () => {
    const [item] = normalizeAdditionalHardwareItems([
        { id: 'pc-line', definitionId: 'mini-pc-180', name: 'Configured PC', quantity: 1 }
    ]);
    assert.equal(item.id, 'pc-line');
    assert.equal(item.definitionId, 'mini-pc-180');
});

test('colliding additional component IDs receive stable unique suffixes', () => {
    const items = normalizeAdditionalHardwareItems([
        { id: 'component', name: 'First' },
        { id: 'component-3', name: 'Reserved suffix' },
        { id: 'component', name: 'Second' },
        { id: 'component', name: 'Third' }
    ]);

    assert.deepEqual(items.map(item => item.id), ['component', 'component-3', 'component-2', 'component-4']);
});

test('procurement BOM reconciles sheet and hardware costs with an explicit currency', () => {
    const result = buildProcurementBom([
        {
            materialId: 'mdf-18', name: 'MDF 18 mm', sheets: 3, sheetCost: 42,
            estimatedCost: 126, sheetWidthMm: 2440, sheetHeightMm: 1220, thicknessMm: 18
        }
    ], [
        { definitionId: 'button', name: 'Button', category: 'button', quantity: 12, unitPrice: 3, lineCost: 36 }
    ], { currencyCode: 'GBP' });

    assert.equal(result.summary.materialCost, 126);
    assert.equal(result.summary.hardwareCost, 36);
    assert.equal(result.summary.totalCost, 162);
    assert.equal(result.rows[0].notes, '2440 x 1220 mm, 18 mm measured');
    assert.ok(result.rows.every(item => item.currency === 'GBP'));
});
