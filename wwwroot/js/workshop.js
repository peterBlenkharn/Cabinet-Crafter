export const WORKSHOP_SCHEMA_VERSION = 1;

export function createWorkshopProfile(input = {}) {
    return {
        version: WORKSHOP_SCHEMA_VERSION,
        id: safeId(input.id || input.name || 'default-workshop'),
        name: String(input.name || 'Default workshop').trim(),
        currency: /^[A-Z]{3}$/.test(String(input.currency || '').toUpperCase()) ? String(input.currency).toUpperCase() : 'GBP',
        labourRatePerHour: nonNegative(input.labourRatePerHour, 25),
        machineRatePerHour: nonNegative(input.machineRatePerHour, 18),
        consumablesPercent: nonNegative(input.consumablesPercent, 5),
        overheadPercent: nonNegative(input.overheadPercent, 12),
        contingencyPercent: nonNegative(input.contingencyPercent, 8),
        markupPercent: nonNegative(input.markupPercent, 20),
        materialWastePercent: nonNegative(input.materialWastePercent, 10),
        defaultBatchQuantity: Math.max(1, Math.round(number(input.defaultBatchQuantity, 1))),
        processProfileId: input.processProfileId || 'nominal',
        materialProfileIds: Array.isArray(input.materialProfileIds) ? [...new Set(input.materialProfileIds.map(String))] : []
    };
}

export function createDesignVariant(projectDocument, name, options = {}) {
    const copy = clone(projectDocument);
    const createdAt = validDate(options.createdAt) || new Date().toISOString();
    return {
        id: options.id || `${safeId(name)}-${new Date(createdAt).getTime().toString(36)}`,
        name: String(name || 'Variant'),
        createdAt,
        notes: String(options.notes || ''),
        basedOnVariantId: options.basedOnVariantId || null,
        project: copy,
        thumbnail: options.thumbnail || null,
        metrics: clone(options.metrics || {})
    };
}

export function compareDesignVariants(variants = []) {
    const normalized = variants.filter(Boolean);
    const paramKeys = new Set();
    normalized.forEach(variant => Object.keys(resolveParams(variant)).forEach(key => {
        if (typeof resolveParams(variant)[key] === 'number' || typeof resolveParams(variant)[key] === 'boolean') paramKeys.add(key);
    }));

    const parameterDifferences = [...paramKeys].sort().map(key => ({
        key,
        values: normalized.map(variant => ({ variantId: variant.id, value: resolveParams(variant)[key] }))
    })).filter(record => new Set(record.values.map(item => JSON.stringify(item.value))).size > 1);

    const metricKeys = new Set(normalized.flatMap(variant => Object.keys(variant.metrics || {})));
    const metricComparison = [...metricKeys].sort().map(key => ({
        key,
        values: normalized.map(variant => ({ variantId: variant.id, value: variant.metrics?.[key] ?? null }))
    }));

    return {
        variants: normalized.map(variant => ({ id: variant.id, name: variant.name, createdAt: variant.createdAt })),
        parameterDifferences,
        metricComparison
    };
}

export function buildBatchPlan(manifest, quantity = 1, options = {}) {
    const count = Math.max(1, Math.round(number(quantity, 1)));
    const partQuantities = (manifest?.parts || []).filter(part => part.includeInFabrication !== false).map(part => ({
        partId: part.id,
        name: part.name,
        perCabinet: Math.max(1, Math.round(number(part.quantity, 1))),
        total: Math.max(1, Math.round(number(part.quantity, 1))) * count,
        materialId: part.materialId,
        thicknessMm: part.thicknessMm
    }));
    const hardware = (options.hardwareSchedule || []).map(item => ({ ...item, perCabinet: item.quantity, quantity: item.quantity * count }));
    return {
        version: WORKSHOP_SCHEMA_VERSION,
        cabinetQuantity: count,
        partQuantities,
        hardware,
        packagingAllowance: {
            labels: partQuantities.reduce((sum, item) => sum + item.total, 0),
            hardwarePacks: count
        }
    };
}

export function buildQuote(input = {}) {
    const profile = createWorkshopProfile(input.workshopProfile);
    const quantity = Math.max(1, Math.round(number(input.quantity, profile.defaultBatchQuantity)));
    const materialBase = (input.materialSummary || []).reduce((sum, item) => sum + nonNegative(item.estimatedCost, 0), 0) * quantity;
    const materialWithWaste = materialBase * (1 + profile.materialWastePercent / 100);
    const hardwareBase = (input.hardwareSchedule || []).reduce((sum, item) => sum + nonNegative(item.unitPrice, 0) * nonNegative(item.quantity, 0), 0) * quantity;
    const labourHours = nonNegative(input.labourHoursPerCabinet, estimateLabourHours(input)) * quantity;
    const machineHours = nonNegative(input.machineHoursPerCabinet, estimateMachineHours(input)) * quantity;
    const labourCost = labourHours * profile.labourRatePerHour;
    const machineCost = machineHours * profile.machineRatePerHour;
    const subtotalBeforeConsumables = materialWithWaste + hardwareBase + labourCost + machineCost;
    const consumables = subtotalBeforeConsumables * profile.consumablesPercent / 100;
    const overhead = (subtotalBeforeConsumables + consumables) * profile.overheadPercent / 100;
    const contingency = (subtotalBeforeConsumables + consumables + overhead) * profile.contingencyPercent / 100;
    const costTotal = subtotalBeforeConsumables + consumables + overhead + contingency;
    const markup = costTotal * profile.markupPercent / 100;
    const quoteTotal = costTotal + markup;

    return {
        version: WORKSHOP_SCHEMA_VERSION,
        quoteNumber: input.quoteNumber || `CC-${(validDate(input.generatedAt) || new Date().toISOString()).slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        generatedAt: validDate(input.generatedAt) || new Date().toISOString(),
        currency: profile.currency,
        quantity,
        lineItems: [
            line('Materials', materialWithWaste),
            line('Hardware', hardwareBase),
            line(`Labour (${round(labourHours, 1)} h)`, labourCost),
            line(`Machine time (${round(machineHours, 1)} h)`, machineCost),
            line('Consumables', consumables),
            line('Overheads', overhead),
            line('Contingency', contingency),
            line('Markup', markup)
        ],
        costTotal: money(costTotal),
        quoteTotal: money(quoteTotal),
        perCabinet: money(quoteTotal / quantity),
        assumptions: [
            `${profile.materialWastePercent}% material allowance`,
            `${profile.contingencyPercent}% contingency`,
            'Shipping, tax, artwork licensing, and site installation are excluded unless separately listed.'
        ]
    };
}

export function serializeQuoteCsv(quote) {
    const rows = [['Quote', quote.quoteNumber], ['Generated', quote.generatedAt], ['Currency', quote.currency], ['Quantity', quote.quantity], []];
    rows.push(['Item', 'Amount']);
    quote.lineItems.forEach(item => rows.push([item.description, item.amount.toFixed(2)]));
    rows.push(['Total', quote.quoteTotal.toFixed(2)], ['Per cabinet', quote.perCabinet.toFixed(2)]);
    return rows.map(row => row.map(csv).join(',')).join('\r\n');
}

function resolveParams(variant) {
    return variant?.project?.design?.params || variant?.project?.designParameters || variant?.project?.params || {};
}

function estimateLabourHours(input) {
    const parts = number(input.partCount, input.manifest?.parts?.length || 16);
    const hardware = (input.hardwareSchedule || []).reduce((sum, item) => sum + number(item.quantity, 0), 0);
    return 4 + parts * 0.18 + hardware * 0.08;
}

function estimateMachineHours(input) {
    const sheets = number(input.sheetCount, input.nesting?.sheets?.length || 1);
    const operations = number(input.operationCount, input.manifest?.operations?.length || 0);
    return 0.5 + sheets * 0.75 + operations * 0.025;
}

function line(description, amount) {
    return { description, amount: money(amount) };
}

function money(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value, fallback) {
    return Math.max(0, number(value, fallback));
}

function safeId(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'workshop';
}

function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}

function csv(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function clone(value) {
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function validDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
