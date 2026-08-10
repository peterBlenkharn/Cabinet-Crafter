export function enrichManifestPart(manifest, partOrId) {
    const part = typeof partOrId === 'string'
        ? (manifest?.parts || []).find(item => item.id === partOrId)
        : partOrId;
    if (!part) return null;

    const contours = byIds(manifest?.contours, part.contourIds, item => item.partId === part.id);
    const operations = byIds(manifest?.operations, part.operationIds, item => item.partId === part.id);
    const joints = byIds(manifest?.joints, part.jointIds, item => (item.partIds || []).includes(part.id));
    const fasteners = byIds(manifest?.fasteners, part.fastenerIds, item => (item.partIds || [item.partId, item.targetPartId]).includes(part.id));
    const keepouts = byIds(manifest?.keepouts, part.keepoutIds, item => item.partId === part.id);
    const outer = contours.find(contour => contour.role === 'outer') || contours[0];
    const points = (outer?.points || []).map(point => ({ x: Number(point.xMm ?? point.x) || 0, y: Number(point.yMm ?? point.y) || 0 }));

    return {
        ...part,
        widthMm: Number(part.dimensions?.widthMm ?? part.widthMm ?? part.width) || 0,
        lengthMm: Number(part.dimensions?.lengthMm ?? part.lengthMm ?? part.length) || 0,
        heightMm: Number(part.dimensions?.lengthMm ?? part.heightMm ?? part.lengthMm ?? part.length) || 0,
        outline: outer ? { ...outer, points } : null,
        contour: outer ? { ...outer, points } : null,
        profilePoints: points,
        contours,
        operations,
        joints,
        fasteners,
        keepouts
    };
}

export function enrichManifestParts(manifest, options = {}) {
    return (manifest?.parts || [])
        .filter(part => options.includedOnly ? part.includeInFabrication !== false : true)
        .map(part => enrichManifestPart(manifest, part));
}

export function getManifestPartBounds(manifest, partOrId) {
    const part = enrichManifestPart(manifest, partOrId);
    const bounds = part?.outline?.bounds || part?.contour?.bounds;
    if (bounds) {
        const minX = Number(bounds.minX ?? bounds.minXmm) || 0;
        const minY = Number(bounds.minY ?? bounds.minYmm) || 0;
        const maxX = Number(bounds.maxX ?? bounds.maxXmm) || minX + part.widthMm;
        const maxY = Number(bounds.maxY ?? bounds.maxYmm) || minY + part.lengthMm;
        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }
    return { minX: 0, minY: 0, maxX: part?.widthMm || 0, maxY: part?.lengthMm || 0, width: part?.widthMm || 0, height: part?.lengthMm || 0 };
}

export function findOperationGeometry(manifest, operationOrId) {
    const operation = typeof operationOrId === 'string'
        ? (manifest?.operations || []).find(item => item.id === operationOrId)
        : operationOrId;
    if (!operation) return null;
    const geometry = operation.geometry || {};
    if (geometry.kind === 'contour') {
        const contour = (manifest?.contours || []).find(item => item.id === geometry.contourId);
        if (Array.isArray(geometry.points) && geometry.points.length) return geometry;
        return contour ? { ...geometry, points: contour.points } : geometry;
    }
    return geometry;
}

export function indexManifest(manifest) {
    return {
        parts: new Map((manifest?.parts || []).map(item => [item.id, item])),
        contours: new Map((manifest?.contours || []).map(item => [item.id, item])),
        operations: new Map((manifest?.operations || []).map(item => [item.id, item])),
        joints: new Map((manifest?.joints || []).map(item => [item.id, item])),
        fasteners: new Map((manifest?.fasteners || []).map(item => [item.id, item])),
        keepouts: new Map((manifest?.keepouts || []).map(item => [item.id, item])),
        materials: new Map((manifest?.materials || []).map(item => [item.id, item]))
    };
}

function byIds(source = [], ids = [], predicate) {
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    return source.filter(item => idSet.size ? idSet.has(item.id) : predicate(item));
}
