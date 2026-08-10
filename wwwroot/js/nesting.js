import { normalizeMaterialProfiles, resolvePartMaterial } from './materials.js';
import { enrichManifestParts } from './manifest-utils.js';

export const NESTING_PLAN_VERSION = 1;

const rotationVariantCache = new WeakMap();

export function createNestingPlan(manifest, materialProfiles = [], options = {}) {
    const profiles = normalizeMaterialProfiles(materialProfiles?.length ? materialProfiles : manifest?.materials);
    const assignments = options.assignments || manifest?.materialAssignments || {};
    const parts = enrichManifestParts(manifest, { includedOnly: true })
        .filter(part => part.included !== false)
        .map(part => normalizeNestPart(part));
    const excludedPartIds = new Set((options.excludedPartIds || []).map(String));
    const excludedInstanceIds = new Set((options.excludedInstanceIds || []).map(String));
    const excluded = [];

    const groups = new Map();
    parts.forEach(part => {
        const profile = resolvePartMaterial(part.source, profiles, assignments, manifest?.materialThicknessMm || 18);
        const group = groups.get(profile.id) || { profile, parts: [] };
        for (let index = 0; index < part.quantity; index++) {
            const instanceId = `${part.id}:${index + 1}`;
            if (excludedPartIds.has(part.id) || excludedInstanceIds.has(instanceId)) {
                excluded.push({ partId: part.id, instanceId, name: part.name, materialId: profile.id });
                continue;
            }
            group.parts.push({ ...part, instanceId });
        }
        groups.set(profile.id, group);
    });

    const candidates = [];
    const sorters = candidateSorters();
    for (const [strategy, sorter] of Object.entries(sorters)) {
        const sheets = [];
        const unplaced = [];
        groups.forEach(group => {
            const result = packMaterialGroup([...group.parts].sort(sorter), group.profile, {
                strategy,
                pinnedPlacements: options.pinnedPlacements || [],
                spacingMm: options.spacingMm
            });
            sheets.push(...result.sheets);
            unplaced.push(...result.unplaced);
        });
        candidates.push(scoreCandidate({ strategy, sheets, unplaced }));
    }

    candidates.sort(compareCandidates);
    const requestedStrategy = typeof options.strategy === 'string' ? options.strategy : null;
    const selected = (requestedStrategy && candidates.find(candidate => candidate.strategy === requestedStrategy))
        || candidates[0]
        || scoreCandidate({ strategy: 'none', sheets: [], unplaced: [] });
    const candidateSummary = candidate => ({
        strategy: candidate.strategy,
        sheetCount: candidate.totals.sheetCount,
        utilizationPercent: candidate.totals.utilizationPercent,
        wasteAreaMm2: candidate.totals.wasteAreaMm2,
        unplacedCount: candidate.unplaced.length,
        selected: candidate.strategy === selected.strategy
    });
    const plan = {
        version: NESTING_PLAN_VERSION,
        units: 'mm',
        generatedAt: new Date().toISOString(),
        selectedStrategy: selected.strategy,
        sheets: selected.sheets,
        unplaced: selected.unplaced,
        excluded,
        totals: selected.totals,
        candidateSummaries: candidates.map(candidateSummary),
        alternatives: candidates
            .filter(candidate => candidate.strategy !== selected.strategy)
            .map(candidateSummary)
    };
    if (options.includeCandidates === true) {
        // Interactive sheet editors need the actual ranked placements, while
        // normal fabrication manifests keep only the selected geometry to
        // avoid quadrupling package size.
        plan.candidates = candidates;
    }
    plan.findings = validateNestingPlan(plan, profiles);
    return plan;
}

export function validateNestingPlan(plan, materialProfiles = []) {
    const profiles = new Map(normalizeMaterialProfiles(materialProfiles).map(profile => [profile.id, profile]));
    const findings = [];

    const sheetsByMaterial = new Map();
    (plan?.sheets || []).forEach(sheet => sheetsByMaterial.set(sheet.materialId, (sheetsByMaterial.get(sheet.materialId) || 0) + 1));
    sheetsByMaterial.forEach((sheetCount, materialId) => {
        const profile = profiles.get(materialId);
        if (profile?.quantityAvailable > 0 && sheetCount > profile.quantityAvailable) {
            const partIds = (plan.sheets || [])
                .filter(sheet => sheet.materialId === materialId)
                .flatMap(sheet => sheet.placements.map(placement => placement.partId));
            findings.push(finding(
                'NEST_STOCK_QUANTITY',
                'error',
                [...new Set(partIds)],
                `${profile.name} requires ${sheetCount} sheets but only ${profile.quantityAvailable} are available.`,
                'Increase stock quantity, reduce parts, or choose another material.'
            ));
        }
    });

    (plan?.unplaced || []).forEach(item => findings.push(finding(
        'NEST_PART_UNPLACED',
        'error',
        [item.partId],
        `${item.name || item.partId} does not fit available stock.`,
        'Choose larger stock, permit another rotation, or divide the part.'
    )));

    (plan?.sheets || []).forEach(sheet => {
        const profile = profiles.get(sheet.materialId) || sheet.stock;
        const margin = Number(sheet.trimMarginMm ?? profile?.trimMarginMm ?? 0);
        const width = Number(sheet.widthMm ?? profile?.sheetWidthMm ?? 0);
        const height = Number(sheet.heightMm ?? profile?.sheetHeightMm ?? 0);
        const spacing = Number(sheet.partSpacingMm ?? profile?.partSpacingMm ?? 0);

        sheet.placements.forEach(placement => {
            const polygon = Array.isArray(placement.polygon) ? placement.polygon : [];
            const bounds = polygon.length >= 3 ? polygonBounds(polygon) : placement.bounds;
            if (polygon.length >= 3 && placement.bounds && boundsDiffer(bounds, placement.bounds)) {
                findings.push(finding(
                    'NEST_BOUNDS_MISMATCH',
                    'error',
                    [placement.partId],
                    `${placement.name} has stale placement bounds on sheet ${sheet.index}.`,
                    'Regenerate the sheet plan before export.'
                ));
            }
            const sourcePolygon = placement.sourcePart ? extractPolygon(placement.sourcePart) : [];
            if (sourcePolygon.length >= 3 && polygon.length >= 3) {
                const transformed = sourcePolygon.map(point => transformPartPoint(point, placement));
                if (!polygonsEquivalent(transformed, polygon)) findings.push(finding(
                    'NEST_TRANSFORM_MISMATCH',
                    'error',
                    [placement.partId],
                    `${placement.name} placement geometry does not match its machining transform on sheet ${sheet.index}.`,
                    'Regenerate the sheet plan before export.'
                ));
            }
            if (bounds.minX < margin - 0.001 || bounds.minY < margin - 0.001 ||
                bounds.maxX > width - margin + 0.001 || bounds.maxY > height - margin + 0.001) {
                findings.push(finding(
                    'NEST_OUT_OF_BOUNDS',
                    'error',
                    [placement.partId],
                    `${placement.name} lies outside usable stock on sheet ${sheet.index}.`,
                    'Move the part inside the trim margin or choose a larger sheet.'
                ));
            }
            const allowedRotations = profile?.allowedRotations || [0];
            const rotationDeg = normalizeRotation(placement.rotationDeg);
            if (!allowedRotations.includes(rotationDeg)) {
                findings.push(finding(
                    'NEST_ROTATION_NOT_ALLOWED',
                    'error',
                    [placement.partId],
                    `${placement.name} uses a ${rotationDeg} degree rotation that is not permitted for ${sheet.materialName || sheet.materialId}.`,
                    'Use an allowed rotation or change the material grain/rotation rules.'
                ));
            }
        });

        for (let first = 0; first < sheet.placements.length; first++) {
            for (let second = first + 1; second < sheet.placements.length; second++) {
                const a = sheet.placements[first];
                const b = sheet.placements[second];
                if (polygonsOverlapOrTooClose(a.polygon, b.polygon, spacing - 0.001)) {
                    findings.push(finding(
                        'NEST_PART_OVERLAP',
                        'error',
                        [a.partId, b.partId],
                        `${a.name} and ${b.name} overlap or violate spacing on sheet ${sheet.index}.`,
                        'Re-nest or increase stock size.'
                    ));
                }
            }
        }
    });

    return findings;
}

export function transformPartPoint(point, placement) {
    const angle = Number(placement.rotationDeg || 0) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const transform = resolvePlacementTransform(placement);
    const sourceOrigin = transform.sourceOrigin;
    const localOriginOffset = transform.localOriginOffset;
    const localX = Number(point.x ?? point.xMm) - Number(sourceOrigin.xMm || 0);
    const localY = Number(point.y ?? point.yMm) - Number(sourceOrigin.yMm || 0);
    return {
        x: placement.xMm + localX * cos - localY * sin + Number(localOriginOffset.xMm || 0),
        y: placement.yMm + localX * sin + localY * cos + Number(localOriginOffset.yMm || 0)
    };
}

function packMaterialGroup(parts, profile, options) {
    const sheets = [];
    const unplaced = [];
    const spacing = Number.isFinite(Number(options.spacingMm)) ? Math.max(0, Number(options.spacingMm)) : profile.partSpacingMm;
    const pinnedByInstance = new Map((options.pinnedPlacements || [])
        .filter(item => item?.instanceId)
        .map(item => [String(item.instanceId), item]));
    const automaticParts = [];

    parts.forEach(part => {
        const pinned = pinnedByInstance.get(part.instanceId);
        if (!pinned) {
            automaticParts.push(part);
            return;
        }
        const sheetIndex = Math.max(1, Math.round(Number(pinned.sheetIndex) || 1));
        while (sheets.length < sheetIndex) sheets.push(createSheet(profile, sheets.length + 1, spacing));
        sheets[sheetIndex - 1].placements.push(createPinnedPlacement(part, profile, pinned));
    });

    automaticParts.forEach(part => {
        let placed = false;
        for (const sheet of sheets) {
            const placement = findPlacement(part, sheet, profile, spacing);
            if (placement) {
                sheet.placements.push(placement);
                placed = true;
                break;
            }
        }

        if (!placed) {
            const sheet = createSheet(profile, sheets.length + 1, spacing);
            const placement = findPlacement(part, sheet, profile, spacing);
            if (placement) {
                sheet.placements.push(placement);
                sheets.push(sheet);
                placed = true;
            }
        }

        if (!placed) {
            unplaced.push({ partId: part.id, instanceId: part.instanceId, name: part.name });
        }
    });

    sheets.forEach(finalizeSheet);

    if (options.strategy === 'voidfill' && !unplaced.length && !pinnedByInstance.size && parts.length <= 12 && sheets.length > 1) {
        const optimized = compactMaterialGroup(parts, profile, spacing, sheets.length);
        if (optimized && optimized.sheets.length < sheets.length) return optimized;
    }
    return { sheets, unplaced };
}

function compactMaterialGroup(parts, profile, spacing, currentSheetCount) {
    const usableArea = Math.max(1, (profile.sheetWidthMm - profile.trimMarginMm * 2) * (profile.sheetHeightMm - profile.trimMarginMm * 2));
    const lowerBound = Math.max(1, Math.ceil(parts.reduce((sum, part) => sum + part.areaMm2, 0) / usableArea));
    const orderings = [[...parts].sort(candidateSorters().voidfill)];

    for (let target = lowerBound; target < currentSheetCount; target++) {
        for (const orderedParts of orderings) {
            const result = beamPackMaterialGroup(orderedParts, profile, spacing, target);
            if (result) return result;
        }
    }
    return null;
}

function beamPackMaterialGroup(parts, profile, spacing, targetSheetCount) {
    const BEAM_WIDTH = 12;
    const PLACEMENTS_PER_SHEET = 2;
    let states = [{
        sheets: Array.from({ length: targetSheetCount }, (_, index) => createSheet(profile, index + 1, spacing)),
        score: 0
    }];

    for (const part of parts) {
        const nextStates = [];
        states.forEach(state => {
            state.sheets.forEach((sheet, sheetIndex) => {
                findPlacements(part, sheet, profile, spacing, PLACEMENTS_PER_SHEET).forEach(placement => {
                    const sheets = state.sheets.map((item, index) => (
                        index === sheetIndex
                            ? { ...item, placements: [...item.placements, placement] }
                            : item
                    ));
                    nextStates.push({ sheets, score: packingStateScore(sheets, profile) });
                });
            });
        });
        if (!nextStates.length) return null;
        nextStates.sort((a, b) => a.score - b.score || packingStateSignature(a).localeCompare(packingStateSignature(b)));
        const seen = new Set();
        states = nextStates.filter(state => {
            const signature = packingStateSignature(state);
            if (seen.has(signature)) return false;
            seen.add(signature);
            return true;
        }).slice(0, BEAM_WIDTH);
    }

    const winner = states.find(state => state.sheets.every(sheet => sheet.placements.length));
    if (!winner) return null;
    winner.sheets.forEach(finalizeSheet);
    return { sheets: winner.sheets, unplaced: [] };
}

function packingStateScore(sheets, profile) {
    return sheets.reduce((sum, sheet) => {
        if (!sheet.placements.length) return sum;
        const maxX = Math.max(...sheet.placements.map(item => item.bounds.maxX));
        const maxY = Math.max(...sheet.placements.map(item => item.bounds.maxY));
        const envelope = (maxX - profile.trimMarginMm) * (maxY - profile.trimMarginMm);
        return sum + envelope;
    }, 0);
}

function packingStateSignature(state) {
    return state.sheets.map(sheet => sheet.placements
        .map(item => `${item.instanceId}@${Math.round(item.xMm * 10)},${Math.round(item.yMm * 10)},${item.rotationDeg}`)
        .join('|')).join('||');
}

function createPinnedPlacement(part, profile, pinned) {
    const rotationDeg = normalizeRotation(pinned.rotationDeg);
    const rotated = rotatePolygon(part.polygon, rotationDeg);
    const localBounds = polygonBounds(rotated);
    const translated = rotated.map(point => ({ x: point.x - localBounds.minX, y: point.y - localBounds.minY }));
    const xMm = Number.isFinite(Number(pinned.xMm)) ? Number(pinned.xMm) : profile.trimMarginMm;
    const yMm = Number.isFinite(Number(pinned.yMm)) ? Number(pinned.yMm) : profile.trimMarginMm;
    const polygon = translated.map(point => ({ x: point.x + xMm, y: point.y + yMm }));
    return {
        partId: part.id,
        instanceId: part.instanceId,
        name: part.name,
        materialId: profile.id,
        xMm,
        yMm,
        rotationDeg,
        polygon,
        bounds: polygonBounds(polygon),
        sourceOrigin: { xMm: part.sourceBounds.minX, yMm: part.sourceBounds.minY },
        localOriginOffset: { xMm: -localBounds.minX, yMm: -localBounds.minY },
        sourcePart: part.source,
        areaMm2: part.areaMm2,
        pinned: true
    };
}

function createSheet(profile, index, spacing) {
    return {
        id: `${profile.id}-sheet-${index}`,
        index,
        materialId: profile.id,
        materialName: profile.name,
        thicknessMm: profile.measuredThicknessMm,
        widthMm: profile.sheetWidthMm,
        heightMm: profile.sheetHeightMm,
        trimMarginMm: profile.trimMarginMm,
        partSpacingMm: spacing,
        grainDirection: profile.grainDirection,
        placements: []
    };
}

function findPlacement(part, sheet, profile, spacing) {
    return findPlacements(part, sheet, profile, spacing, 1)[0] || null;
}

function findPlacements(part, sheet, profile, spacing, limit = 1) {
    const margin = profile.trimMarginMm;
    const rotations = profile.allowedRotations || [0];
    const retainedLimit = Math.max(1, limit);
    const matches = [];
    const retainedSignatures = new Set();
    const existingMaxX = Math.max(margin, ...sheet.placements.map(item => item.bounds.maxX));
    const existingMaxY = Math.max(margin, ...sheet.placements.map(item => item.bounds.maxY));

    getRotationVariants(part, rotations).forEach(({ rotationDeg, translated, localBounds, normalizedBounds }) => {
        const xCandidates = new Set([margin]);
        const yCandidates = new Set([margin]);
        sheet.placements.forEach(placement => {
            xCandidates.add(placement.bounds.maxX + spacing);
            xCandidates.add(placement.bounds.minX - normalizedBounds.width - spacing);
            yCandidates.add(placement.bounds.maxY + spacing);
            yCandidates.add(placement.bounds.minY - normalizedBounds.height - spacing);
            placement.polygon.forEach(anchor => {
                xCandidates.add(anchor.x + spacing);
                xCandidates.add(anchor.x - normalizedBounds.width - spacing);
                yCandidates.add(anchor.y + spacing);
                yCandidates.add(anchor.y - normalizedBounds.height - spacing);
                translated.forEach(partPoint => {
                    xCandidates.add(anchor.x - partPoint.x + spacing);
                    xCandidates.add(anchor.x - partPoint.x - spacing);
                    yCandidates.add(anchor.y - partPoint.y + spacing);
                    yCandidates.add(anchor.y - partPoint.y - spacing);
                });
            });
        });

        const maximumX = sheet.widthMm - margin - normalizedBounds.width;
        const maximumY = sheet.heightMm - margin - normalizedBounds.height;
        const xs = [...xCandidates]
            .filter(value => value >= margin - 0.001 && value <= maximumX + 0.001)
            .sort((a, b) => a - b);
        const ys = [...yCandidates]
            .filter(value => value >= margin - 0.001 && value <= maximumY + 0.001)
            .sort((a, b) => a - b);
        for (const yMm of ys) {
            for (const xMm of xs) {
            if (xMm + normalizedBounds.width > sheet.widthMm - margin + 0.001 ||
                yMm + normalizedBounds.height > sheet.heightMm - margin + 0.001) continue;

            const bounds = {
                minX: xMm + normalizedBounds.minX,
                minY: yMm + normalizedBounds.minY,
                maxX: xMm + normalizedBounds.maxX,
                maxY: yMm + normalizedBounds.maxY,
                width: normalizedBounds.width,
                height: normalizedBounds.height
            };
            const occupiedMaxX = Math.max(bounds.maxX, existingMaxX);
            const occupiedMaxY = Math.max(bounds.maxY, existingMaxY);
            const envelopeArea = (occupiedMaxX - margin) * (occupiedMaxY - margin);
            const score = envelopeArea * sheet.widthMm * sheet.heightMm
                + occupiedMaxY * sheet.widthMm
                + occupiedMaxX;
            const ordering = { score, yMm, xMm, rotationDeg };
            if (matches.length >= retainedLimit && comparePlacementMatches(ordering, matches.at(-1)) > 0) break;

            const polygon = translated.map(point => ({ x: point.x + xMm, y: point.y + yMm }));
            if (sheet.placements.some(existing => polygonsOverlapOrTooClose(
                polygon,
                existing.polygon,
                spacing - 0.001,
                bounds,
                existing.bounds
            ))) continue;

            const match = {
                score,
                partId: part.id,
                instanceId: part.instanceId,
                name: part.name,
                materialId: profile.id,
                xMm,
                yMm,
                rotationDeg,
                polygon,
                bounds,
                sourceOrigin: { xMm: part.sourceBounds.minX, yMm: part.sourceBounds.minY },
                localOriginOffset: { xMm: -localBounds.minX, yMm: -localBounds.minY },
                sourcePart: part.source,
                areaMm2: part.areaMm2
            };
            retainPlacementMatch(matches, retainedSignatures, match, retainedLimit);
            }
        }
    });

    return matches.map(({ score, ...placement }) => placement);
}

function comparePlacementMatches(first, second) {
    return first.score - second.score
        || first.yMm - second.yMm
        || first.xMm - second.xMm
        || first.rotationDeg - second.rotationDeg;
}

function retainPlacementMatch(matches, signatures, match, limit) {
    const signature = `${Math.round(match.xMm * 1000)}:${Math.round(match.yMm * 1000)}:${match.rotationDeg}`;
    if (signatures.has(signature)) return;
    signatures.add(signature);
    matches.push(match);
    matches.sort(comparePlacementMatches);
    if (matches.length <= limit) return;
    const removed = matches.pop();
    signatures.delete(`${Math.round(removed.xMm * 1000)}:${Math.round(removed.yMm * 1000)}:${removed.rotationDeg}`);
}

function getRotationVariants(part, rotations) {
    const key = rotations.join(':');
    const cached = rotationVariantCache.get(part);
    if (cached?.key === key) return cached.variants;

    const variants = rotations.map(rotationDeg => {
        const rotated = rotatePolygon(part.polygon, rotationDeg);
        const localBounds = polygonBounds(rotated);
        const translated = rotated.map(point => ({ x: point.x - localBounds.minX, y: point.y - localBounds.minY }));
        return {
            rotationDeg,
            translated,
            localBounds,
            normalizedBounds: polygonBounds(translated)
        };
    });
    rotationVariantCache.set(part, { key, variants });
    return variants;
}

function finalizeSheet(sheet) {
    const stockArea = sheet.widthMm * sheet.heightMm;
    const usableArea = Math.max(1, (sheet.widthMm - sheet.trimMarginMm * 2) * (sheet.heightMm - sheet.trimMarginMm * 2));
    const usedArea = sheet.placements.reduce((total, placement) => total + placement.areaMm2, 0);
    sheet.stockAreaMm2 = stockArea;
    sheet.usableAreaMm2 = usableArea;
    sheet.usedAreaMm2 = usedArea;
    sheet.utilizationPercent = round(usedArea / usableArea * 100, 1);
    sheet.wasteAreaMm2 = Math.max(0, usableArea - usedArea);
    sheet.reusableOffcuts = calculateReusableOffcuts(sheet);
    sheet.reusableOffcutAreaMm2 = sheet.reusableOffcuts.reduce((sum, offcut) => sum + offcut.areaMm2, 0);
}

function calculateReusableOffcuts(sheet) {
    if (!sheet.placements.length) return [];
    const margin = sheet.trimMarginMm;
    const spacing = sheet.partSpacingMm;
    const usableRight = sheet.widthMm - margin;
    const usableBottom = sheet.heightMm - margin;
    const usedMaxX = Math.max(...sheet.placements.map(item => item.bounds.maxX));
    const usedMaxY = Math.max(...sheet.placements.map(item => item.bounds.maxY));
    const candidates = [
        { id: `${sheet.id}:right`, xMm: usedMaxX + spacing, yMm: margin, widthMm: usableRight - usedMaxX - spacing, heightMm: usableBottom - margin },
        { id: `${sheet.id}:top`, xMm: margin, yMm: usedMaxY + spacing, widthMm: Math.max(0, Math.min(usedMaxX, usableRight) - margin), heightMm: usableBottom - usedMaxY - spacing }
    ];
    return candidates
        .filter(item => item.widthMm > 0 && item.heightMm > 0)
        .map(item => ({ ...item, areaMm2: item.widthMm * item.heightMm }))
        .filter(item => item.areaMm2 >= 50000);
}

function scoreCandidate(candidate) {
    const stockArea = candidate.sheets.reduce((sum, sheet) => sum + sheet.usableAreaMm2, 0);
    const usedArea = candidate.sheets.reduce((sum, sheet) => sum + sheet.usedAreaMm2, 0);
    return {
        ...candidate,
        totals: {
            sheetCount: candidate.sheets.length,
            stockAreaMm2: stockArea,
            usedAreaMm2: usedArea,
            wasteAreaMm2: Math.max(0, stockArea - usedArea),
            reusableOffcutAreaMm2: candidate.sheets.reduce((sum, sheet) => sum + (sheet.reusableOffcutAreaMm2 || 0), 0),
            utilizationPercent: stockArea ? round(usedArea / stockArea * 100, 1) : 0,
            unplacedCount: candidate.unplaced.length
        }
    };
}

function compareCandidates(a, b) {
    return a.unplaced.length - b.unplaced.length ||
        a.totals.sheetCount - b.totals.sheetCount ||
        a.totals.wasteAreaMm2 - b.totals.wasteAreaMm2 ||
        b.totals.reusableOffcutAreaMm2 - a.totals.reusableOffcutAreaMm2 ||
        a.strategy.localeCompare(b.strategy);
}

function candidateSorters() {
    return {
        area: (a, b) => b.areaMm2 - a.areaMm2 || a.instanceId.localeCompare(b.instanceId),
        longest: (a, b) => Math.max(b.bounds.width, b.bounds.height) - Math.max(a.bounds.width, a.bounds.height) || a.instanceId.localeCompare(b.instanceId),
        width: (a, b) => b.bounds.width - a.bounds.width || b.areaMm2 - a.areaMm2,
        height: (a, b) => b.bounds.height - a.bounds.height || b.areaMm2 - a.areaMm2,
        voidfill: (a, b) => {
            const aVoid = a.bounds.width * a.bounds.height - a.areaMm2;
            const bVoid = b.bounds.width * b.bounds.height - b.areaMm2;
            return bVoid - aVoid || b.areaMm2 - a.areaMm2 || a.instanceId.localeCompare(b.instanceId);
        }
    };
}

function normalizeNestPart(part) {
    const polygon = extractPolygon(part);
    const originalBounds = polygonBounds(polygon);
    const normalized = polygon.map(point => ({ x: point.x - originalBounds.minX, y: point.y - originalBounds.minY }));
    const bounds = polygonBounds(normalized);
    return {
        id: String(part.id),
        name: String(part.name || part.id),
        quantity: Math.max(1, Math.round(Number(part.quantity) || 1)),
        polygon: normalized,
        sourceBounds: originalBounds,
        bounds,
        areaMm2: Math.abs(polygonArea(normalized)) || bounds.width * bounds.height,
        source: part,
        thicknessMm: Number(part.thicknessMm ?? part.thickness) || 18
    };
}

function extractPolygon(part) {
    const candidates = [
        part.outline?.points,
        part.contour?.points,
        part.profilePoints,
        part.points,
        (part.operations || []).find(operation => operation.type === 'profileCut')?.geometry?.points,
        (part.operations || []).find(operation => operation.type === 'profileCut')?.points
    ];
    const points = candidates.find(value => Array.isArray(value) && value.length >= 3);
    if (points) return points.map(normalizePoint);

    const width = Math.max(0.01, Number(part.widthMm ?? part.dimensions?.widthMm ?? part.width) || 0.01);
    const height = Math.max(0.01, Number(part.heightMm ?? part.dimensions?.lengthMm ?? part.lengthMm ?? part.length) || 0.01);
    return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
}

function normalizePoint(point) {
    if (Array.isArray(point)) return { x: Number(point[0]) || 0, y: Number(point[1]) || 0 };
    return { x: Number(point.x) || 0, y: Number(point.y) || 0 };
}

function resolvePlacementTransform(placement) {
    if (placement.sourceOrigin && placement.localOriginOffset) {
        return { sourceOrigin: placement.sourceOrigin, localOriginOffset: placement.localOriginOffset };
    }
    const sourcePolygon = placement.sourcePart ? extractPolygon(placement.sourcePart) : [];
    if (sourcePolygon.length >= 3) {
        const sourceBounds = polygonBounds(sourcePolygon);
        const normalized = sourcePolygon.map(point => ({ x: point.x - sourceBounds.minX, y: point.y - sourceBounds.minY }));
        const rotatedBounds = polygonBounds(rotatePolygon(normalized, Number(placement.rotationDeg || 0)));
        return {
            sourceOrigin: placement.sourceOrigin || { xMm: sourceBounds.minX, yMm: sourceBounds.minY },
            localOriginOffset: placement.localOriginOffset || { xMm: -rotatedBounds.minX, yMm: -rotatedBounds.minY }
        };
    }
    return {
        sourceOrigin: placement.sourceOrigin || { xMm: 0, yMm: 0 },
        localOriginOffset: placement.localOriginOffset || { xMm: 0, yMm: 0 }
    };
}

function boundsDiffer(first, second, tolerance = 0.001) {
    return ['minX', 'minY', 'maxX', 'maxY'].some(key => Math.abs(Number(first[key]) - Number(second[key])) > tolerance);
}

function polygonsEquivalent(first, second, tolerance = 0.001) {
    return first.length === second.length && first.every((point, index) => (
        Math.abs(point.x - Number(second[index].x)) <= tolerance &&
        Math.abs(point.y - Number(second[index].y)) <= tolerance
    ));
}

function rotatePolygon(polygon, degrees) {
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return polygon.map(point => ({ x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }));
}

function normalizeRotation(value) {
    return ((Math.round(Number(value) || 0) % 360) + 360) % 360;
}

function polygonBounds(points) {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function polygonArea(points) {
    return points.reduce((total, point, index) => {
        const next = points[(index + 1) % points.length];
        return total + point.x * next.y - next.x * point.y;
    }, 0) / 2;
}

function polygonsOverlapOrTooClose(a, b, spacing, suppliedBoundsA = null, suppliedBoundsB = null) {
    const boundsA = suppliedBoundsA || polygonBounds(a);
    const boundsB = suppliedBoundsB || polygonBounds(b);
    if (boundsA.maxX + spacing < boundsB.minX || boundsB.maxX + spacing < boundsA.minX ||
        boundsA.maxY + spacing < boundsB.minY || boundsB.maxY + spacing < boundsA.minY) return false;

    if (polygonsIntersect(a, b)) return true;
    if (spacing <= 0) return false;
    return polygonDistance(a, b) < spacing;
}

function polygonsIntersect(a, b) {
    for (let ai = 0; ai < a.length; ai++) {
        const a1 = a[ai];
        const a2 = a[(ai + 1) % a.length];
        for (let bi = 0; bi < b.length; bi++) {
            if (segmentsIntersect(a1, a2, b[bi], b[(bi + 1) % b.length])) return true;
        }
    }
    return pointInPolygon(a[0], b) || pointInPolygon(b[0], a);
}

function polygonDistance(a, b) {
    let minimum = Infinity;
    for (let ai = 0; ai < a.length; ai++) {
        for (let bi = 0; bi < b.length; bi++) {
            minimum = Math.min(minimum, segmentDistance(a[ai], a[(ai + 1) % a.length], b[bi], b[(bi + 1) % b.length]));
        }
    }
    return minimum;
}

function segmentsIntersect(a, b, c, d) {
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);
    if (Math.abs(abC) < 1e-8 && onSegment(a, b, c)) return true;
    if (Math.abs(abD) < 1e-8 && onSegment(a, b, d)) return true;
    if (Math.abs(cdA) < 1e-8 && onSegment(c, d, a)) return true;
    if (Math.abs(cdB) < 1e-8 && onSegment(c, d, b)) return true;
    return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function segmentDistance(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function pointSegmentDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const pi = polygon[i];
        const pj = polygon[j];
        if (((pi.y > point.y) !== (pj.y > point.y)) &&
            point.x < (pj.x - pi.x) * (point.y - pi.y) / ((pj.y - pi.y) || 1e-12) + pi.x) inside = !inside;
    }
    return inside;
}

function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, p) {
    return p.x >= Math.min(a.x, b.x) - 1e-8 && p.x <= Math.max(a.x, b.x) + 1e-8 &&
        p.y >= Math.min(a.y, b.y) - 1e-8 && p.y <= Math.max(a.y, b.y) + 1e-8;
}

function finding(code, severity, partIds, message, remedy) {
    return { code, severity, partIds, message, remedy };
}

function round(value, precision) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}
