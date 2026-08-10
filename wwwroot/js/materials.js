export const MATERIAL_PROFILE_VERSION = 1;

export const DEFAULT_MATERIAL_PROFILES = Object.freeze([
    material({ id: 'birch-plywood-18', name: 'Birch plywood 18 mm', thickness: 18, density: 680, price: 78, grain: 'length' }),
    material({ id: 'mdf-18', name: 'MDF 18 mm', thickness: 18, density: 750, price: 42, grain: 'none' }),
    material({ id: 'mdf-12', name: 'MDF 12 mm', thickness: 12, density: 750, price: 31, grain: 'none' }),
    material({ id: 'plywood-12', name: 'Plywood 12 mm', thickness: 12, density: 620, price: 48, grain: 'length' })
]);

export function createMaterialProfile(input = {}) {
    const profile = {
        version: MATERIAL_PROFILE_VERSION,
        id: safeId(input.id || input.name || 'custom-material'),
        name: String(input.name || 'Custom material').trim().slice(0, 100),
        nominalThicknessMm: positive(input.nominalThicknessMm ?? input.thickness, 18),
        measuredThicknessMm: positive(input.measuredThicknessMm ?? input.nominalThicknessMm ?? input.thickness, 18),
        sheetWidthMm: positive(input.sheetWidthMm ?? input.sheetWidth ?? input.stock?.widthMm, 2440),
        sheetHeightMm: positive(input.sheetHeightMm ?? input.sheetHeight ?? input.stock?.heightMm, 1220),
        grainDirection: normalizeChoice(input.grainDirection ?? input.grain, ['none', 'length', 'width'], 'none'),
        finishedFaces: normalizeChoice(input.finishedFaces, ['none', 'one', 'two'], 'none'),
        densityKgM3: nonNegative(input.densityKgM3 ?? input.density, 700),
        pricePerSheet: nonNegative(input.pricePerSheet ?? input.price, 0),
        trimMarginMm: nonNegative(input.trimMarginMm ?? input.stock?.trimMarginMm, 12),
        partSpacingMm: nonNegative(input.partSpacingMm ?? input.stock?.partSpacingMm, 8),
        quantityAvailable: Math.max(0, Math.round(number(input.quantityAvailable, 0))),
        allowedRotations: normalizeRotations(input.allowedRotations, input.grainDirection ?? input.grain),
        color: normalizeColor(input.color, '#d9d1bd'),
        supplier: String(input.supplier || '').trim().slice(0, 100),
        sku: String(input.sku || '').trim().slice(0, 80),
        notes: String(input.notes || '').trim().slice(0, 500)
    };

    return profile;
}

export function normalizeMaterialProfiles(profiles = []) {
    const source = Array.isArray(profiles) && profiles.length ? profiles : DEFAULT_MATERIAL_PROFILES;
    const seen = new Set();
    return source.map(createMaterialProfile).map((profile, index) => {
        let id = profile.id;
        while (seen.has(id)) id = `${profile.id}-${index + 1}`;
        seen.add(id);
        return { ...profile, id };
    });
}

export function validateMaterialProfile(input) {
    const profile = createMaterialProfile(input);
    const findings = [];
    if (profile.measuredThicknessMm <= 0) findings.push(issue('MATERIAL_THICKNESS', 'error', 'Measured thickness must be positive.'));
    if (profile.measuredThicknessMm > profile.nominalThicknessMm * 1.25 || profile.measuredThicknessMm < profile.nominalThicknessMm * 0.75) {
        findings.push(issue('MATERIAL_THICKNESS_VARIANCE', 'warning', 'Measured thickness differs from nominal thickness by more than 25%.'));
    }
    if (profile.sheetWidthMm <= profile.trimMarginMm * 2 || profile.sheetHeightMm <= profile.trimMarginMm * 2) {
        findings.push(issue('MATERIAL_STOCK_MARGIN', 'error', 'Trim margins consume the usable stock area.'));
    }
    if (!profile.allowedRotations.length) findings.push(issue('MATERIAL_ROTATIONS', 'error', 'At least one part rotation must be allowed.'));
    return { profile, findings };
}

export function resolvePartMaterial(part, profiles, assignments = {}, fallbackThickness = 18) {
    const normalized = normalizeMaterialProfiles(profiles);
    const requestedId = assignments[part.id] || part.materialId || part.material?.id;
    if (requestedId) {
        const exact = normalized.find(profile => profile.id === requestedId);
        if (exact) return exact;
    }

    const thickness = positive(part.thicknessMm ?? part.thickness, fallbackThickness);
    return normalized.reduce((best, profile) => (
        Math.abs(profile.measuredThicknessMm - thickness) < Math.abs(best.measuredThicknessMm - thickness) ? profile : best
    ), normalized[0]);
}

export function summarizeMaterials(parts, profiles, assignments = {}, sheets = []) {
    const byMaterial = new Map();
    const normalizedProfiles = normalizeMaterialProfiles(profiles);

    (parts || []).forEach(part => {
        const profile = resolvePartMaterial(part, normalizedProfiles, assignments);
        const quantity = Math.max(1, Math.round(number(part.quantity, 1)));
        const areaMm2 = nonNegative(part.areaMm2 ?? part.area, inferArea(part));
        const volumeM3 = areaMm2 * profile.measuredThicknessMm * quantity / 1e9;
        const entry = byMaterial.get(profile.id) || {
            materialId: profile.id,
            name: profile.name,
            thicknessMm: profile.measuredThicknessMm,
            sheetWidthMm: profile.sheetWidthMm,
            sheetHeightMm: profile.sheetHeightMm,
            partCount: 0,
            areaMm2: 0,
            weightKg: 0,
            sheets: 0,
            sheetCost: profile.pricePerSheet,
            estimatedCost: 0,
            supplier: profile.supplier || null,
            sku: profile.sku || null
        };
        entry.partCount += quantity;
        entry.areaMm2 += areaMm2 * quantity;
        entry.weightKg += volumeM3 * profile.densityKgM3;
        byMaterial.set(profile.id, entry);
    });

    (sheets || []).forEach(sheet => {
        const entry = byMaterial.get(sheet.materialId);
        if (entry) entry.sheets += 1;
    });

    byMaterial.forEach(entry => {
        entry.weightKg = round(entry.weightKg, 2);
        entry.areaM2 = round(entry.areaMm2 / 1e6, 3);
        entry.estimatedCost = round(entry.sheets * entry.sheetCost, 2);
    });

    return [...byMaterial.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function material({ id, name, thickness, density, price, grain }) {
    return Object.freeze(createMaterialProfile({
        id,
        name,
        nominalThicknessMm: thickness,
        measuredThicknessMm: thickness,
        densityKgM3: density,
        pricePerSheet: price,
        grainDirection: grain,
        sheetWidthMm: 2440,
        sheetHeightMm: 1220,
        trimMarginMm: 12,
        partSpacingMm: 8,
        allowedRotations: grain === 'none' ? [0, 90, 180, 270] : [0, 180]
    }));
}

function normalizeRotations(rotations, grain) {
    const defaults = grain && grain !== 'none' ? [0, 180] : [0, 90, 180, 270];
    const values = Array.isArray(rotations) ? rotations : defaults;
    return [...new Set(values.map(value => ((Math.round(number(value, 0) / 90) * 90) % 360 + 360) % 360))].sort((a, b) => a - b);
}

function inferArea(part) {
    const width = positive(part.widthMm ?? part.dimensions?.widthMm ?? part.width, 0);
    const height = positive(part.heightMm ?? part.dimensions?.lengthMm ?? part.lengthMm ?? part.length, 0);
    return width * height;
}

function issue(code, severity, message) {
    return { code, severity, message };
}

function safeId(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'material';
}

function normalizeChoice(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function normalizeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
}

function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback) {
    const parsed = number(value, fallback);
    return parsed > 0 ? parsed : fallback;
}

function nonNegative(value, fallback) {
    const parsed = number(value, fallback);
    return parsed >= 0 ? parsed : fallback;
}

function round(value, precision) {
    const factor = 10 ** precision;
    // Decimal measurements such as 16.875 can land infinitesimally below the
    // half-way point in IEEE-754. Bias by one machine epsilon so user-facing
    // totals use conventional half-up rounding.
    const scaled = value * factor;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 2;
    return Math.round(scaled + tolerance) / factor;
}
