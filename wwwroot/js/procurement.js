export const PROCUREMENT_BOM_VERSION = 1;

export function normalizeHardwareCostOverrides(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([definitionId, record]) => {
        const source = typeof record === 'number' ? { unitPrice: record } : (record || {});
        return [String(definitionId), {
            ...(source.unitPrice == null ? {} : { unitPrice: nonNegative(source.unitPrice, 0) }),
            supplier: optionalText(source.supplier, 100),
            sku: optionalText(source.sku, 80)
        }];
    }));
}

export function createAdditionalHardwareItem(input = {}, index = 0) {
    const name = text(input.name, `Additional component ${index + 1}`, 120);
    return {
        id: safeId(input.id || `${name}-${index + 1}`),
        definitionId: safeId(input.definitionId || input.id || `${name}-${index + 1}`),
        category: text(input.category, 'additional', 60),
        name,
        quantity: Math.max(1, Math.round(number(input.quantity, 1))),
        unitPrice: nonNegative(input.unitPrice, 0),
        connector: optionalText(input.connector, 80),
        supplier: optionalText(input.supplier, 100),
        sku: optionalText(input.sku, 80),
        notes: optionalText(input.notes, 300),
        source: 'additional'
    };
}

export function normalizeAdditionalHardwareItems(items = []) {
    if (!Array.isArray(items)) return [];
    const usedIds = new Set();
    return items.map(createAdditionalHardwareItem).map(item => {
        let id = item.id;
        let suffix = 2;
        while (usedIds.has(id)) {
            id = `${item.id}-${suffix}`;
            suffix += 1;
        }
        usedIds.add(id);
        return { ...item, id };
    });
}

export function buildCostedHardwareSchedule(schedule = [], options = {}) {
    const overrides = normalizeHardwareCostOverrides(options.hardwareCosts || options.overrides);
    const detected = (Array.isArray(schedule) ? schedule : []).map(item => {
        const definitionId = String(item.definitionId || item.id || 'hardware');
        const override = overrides[definitionId] || {};
        const quantity = Math.max(0, Math.round(number(item.quantity, 0)));
        const unitPrice = nonNegative(
            Object.hasOwn(override, 'unitPrice') ? override.unitPrice : item.unitPrice,
            0
        );
        return {
            ...item,
            definitionId,
            quantity,
            unitPrice,
            lineCost: money(quantity * unitPrice),
            supplier: override.supplier || optionalText(item.supplier, 100),
            sku: override.sku || optionalText(item.sku, 80),
            source: item.source === 'additional' ? 'additional' : 'detected'
        };
    });
    const multiplier = Math.max(1, Math.round(number(options.additionalQuantityMultiplier, 1)));
    const additional = normalizeAdditionalHardwareItems(options.additionalHardware).map(item => {
        const quantity = item.quantity * multiplier;
        return {
            ...item,
            perCabinet: item.quantity,
            quantity,
            lineCost: money(quantity * item.unitPrice)
        };
    });
    return [...detected, ...additional].sort((a, b) => (
        String(a.category).localeCompare(String(b.category))
        || String(a.name).localeCompare(String(b.name))
    ));
}

export function buildProcurementBom(materialSummary = [], hardwareSchedule = [], options = {}) {
    const currency = /^[A-Z]{3}$/.test(String(options.currency || options.currencyCode || '').toUpperCase())
        ? String(options.currency || options.currencyCode).toUpperCase()
        : 'GBP';
    const materialRows = (Array.isArray(materialSummary) ? materialSummary : []).map(item => ({
        category: 'Sheet material',
        itemId: String(item.materialId || ''),
        item: String(item.name || 'Sheet material'),
        quantity: Math.max(0, Math.round(number(item.sheets, 0))),
        unit: 'sheet',
        unitCost: money(nonNegative(item.sheetCost, 0)),
        totalCost: money(nonNegative(item.estimatedCost, 0)),
        supplier: optionalText(item.supplier, 100),
        sku: optionalText(item.sku, 80),
        notes: stockDescription(item),
        currency
    }));
    const hardwareRows = (Array.isArray(hardwareSchedule) ? hardwareSchedule : []).map(item => {
        const quantity = Math.max(0, Math.round(number(item.quantity, 0)));
        const unitCost = money(nonNegative(item.unitPrice, 0));
        return {
            category: item.source === 'additional' ? 'Additional component' : 'Hardware',
            itemId: String(item.definitionId || item.id || ''),
            item: String(item.name || 'Hardware'),
            quantity,
            unit: 'each',
            unitCost,
            totalCost: money(Number.isFinite(Number(item.lineCost)) ? Number(item.lineCost) : quantity * unitCost),
            supplier: optionalText(item.supplier, 100),
            sku: optionalText(item.sku, 80),
            notes: optionalText(item.notes || item.connector, 300),
            currency
        };
    });
    const rows = [...materialRows, ...hardwareRows];
    const materialCost = money(materialRows.reduce((sum, item) => sum + item.totalCost, 0));
    const hardwareCost = money(hardwareRows.reduce((sum, item) => sum + item.totalCost, 0));
    return {
        version: PROCUREMENT_BOM_VERSION,
        currency,
        rows,
        summary: {
            materialCost,
            hardwareCost,
            totalCost: money(materialCost + hardwareCost),
            pricedLineCount: rows.filter(item => item.unitCost > 0).length,
            unpricedLineCount: rows.filter(item => item.quantity > 0 && item.unitCost === 0).length
        }
    };
}

function stockDescription(item) {
    const width = positiveOrZero(item.sheetWidthMm);
    const height = positiveOrZero(item.sheetHeightMm);
    const size = width && height ? `${width} x ${height} mm` : '';
    const thickness = positiveOrZero(item.thicknessMm);
    return [size, thickness ? `${thickness} mm measured` : ''].filter(Boolean).join(', ');
}

function safeId(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'component';
}

function text(value, fallback, maximum) {
    return String(value == null || value === '' ? fallback : value).trim().slice(0, maximum);
}

function optionalText(value, maximum) {
    return value == null || value === '' ? null : String(value).trim().slice(0, maximum);
}

function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value, fallback) {
    const parsed = number(value, fallback);
    return parsed >= 0 ? parsed : fallback;
}

function positiveOrZero(value) {
    const parsed = number(value, 0);
    return parsed > 0 ? parsed : 0;
}

function money(value) {
    return Math.round((number(value, 0) + Number.EPSILON) * 100) / 100;
}
