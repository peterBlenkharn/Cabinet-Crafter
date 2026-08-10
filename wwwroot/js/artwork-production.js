export const ARTWORK_TEMPLATE_VERSION = 1;

export function createArtworkTemplate(part, options = {}) {
    const outline = extractOutline(part);
    const bounds = polygonBounds(outline);
    const bleedMm = Math.max(0, finite(options.bleedMm, 12));
    const safeMarginMm = Math.max(0, finite(options.safeMarginMm, 15));
    const role = options.role || inferArtworkRole(part);
    const orientation = options.orientation || (part.id === 'side_right' ? 'mirrored' : 'normal');
    const cutouts = (part.operations || [])
        .filter(operation => ['throughCut', 'drill', 'pocket'].includes(operation.type))
        .map(operation => ({
            id: operation.id,
            type: operation.type,
            geometry: normalizeOperationGeometry(operation.geometry, part.contours || [])
        }));

    return {
        version: ARTWORK_TEMPLATE_VERSION,
        units: 'mm',
        id: `${part.id}-${role}`,
        partId: part.id,
        name: `${part.name || part.id} ${role}`,
        role,
        orientation,
        outline,
        bounds,
        bleedMm,
        safeMarginMm,
        canvas: {
            widthMm: bounds.width + bleedMm * 2,
            heightMm: bounds.height + bleedMm * 2,
            originX: bounds.minX - bleedMm,
            originY: bounds.minY - bleedMm
        },
        cutouts,
        assets: normalizeAssets(options.assets || []),
        finishedFace: options.finishedFace || part.finishedFace || 'front'
    };
}

export function validateArtworkTemplate(template) {
    const findings = [];
    if (!Array.isArray(template?.outline) || template.outline.length < 3) {
        findings.push(finding('ARTWORK_OUTLINE', 'error', template?.partId, 'Artwork template has no closed panel outline.', 'Choose a fabricated panel with a valid contour.'));
    }
    (template?.cutouts || []).forEach(cutout => {
        if (!isRenderableGeometry(cutout.geometry)) findings.push(finding(
            'ARTWORK_CUTOUT_GEOMETRY', 'error', template?.partId,
            `${cutout.id || 'A cutout'} has no renderable full-scale geometry.`,
            'Regenerate the fabrication manifest or replace the unsupported reference operation.'
        ));
    });
    (template?.assets || []).forEach(asset => {
        if (asset.kind === 'raster') {
            const widthInches = asset.widthMm / 25.4;
            const heightInches = asset.heightMm / 25.4;
            const effectiveDpi = Math.min(asset.pixelWidth / Math.max(widthInches, 0.01), asset.pixelHeight / Math.max(heightInches, 0.01));
            asset.effectiveDpi = Math.round(effectiveDpi);
            if (effectiveDpi < 100) findings.push(finding(
                'ARTWORK_DPI_LOW', 'error', template.partId,
                `${asset.name} resolves to ${Math.round(effectiveDpi)} DPI at print size.`,
                'Use a higher-resolution source or reduce its printed size.'
            ));
            else if (effectiveDpi < 150) findings.push(finding(
                'ARTWORK_DPI_REVIEW', 'warning', template.partId,
                `${asset.name} resolves to ${Math.round(effectiveDpi)} DPI at print size.`,
                'Inspect a full-size proof before ordering the print.'
            ));
        }

        if (!asset.source) findings.push(finding('ARTWORK_SOURCE_MISSING', 'error', template.partId, `${asset.name} has no source.`, 'Relink or embed the artwork asset.'));
        if (!asset.coversBleed) findings.push(finding('ARTWORK_BLEED', 'warning', template.partId, `${asset.name} does not cover the full bleed area.`, 'Extend the artwork through the bleed boundary.'));
    });
    return findings;
}

export function serializeArtworkTemplateSvg(template, options = {}) {
    const precision = Math.max(2, Math.min(4, Number(options.precision) || 2));
    const canvas = template.canvas;
    const transform = template.orientation === 'mirrored'
        ? `translate(${format(canvas.originX * 2 + canvas.widthMm, precision)} 0) scale(-1 1)`
        : '';
    const outlinePath = polygonPath(template.outline, precision);
    const safePath = polygonPath(insetPolygonApprox(template.outline, template.safeMarginMm), precision);
    const cutoutElements = template.cutouts.map(operationToSvg).join('\n      ');
    const imageElements = template.assets.map(assetToSvg).join('\n      ');
    const title = escapeXml(template.name);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${format(canvas.widthMm, precision)}mm" height="${format(canvas.heightMm, precision)}mm" viewBox="${format(canvas.originX, precision)} ${format(canvas.originY, precision)} ${format(canvas.widthMm, precision)} ${format(canvas.heightMm, precision)}">
  <title>${title}</title>
  <g id="ARTWORK" transform="${transform}">
      ${imageElements}
  </g>
  <g id="CUT_MASK" fill="none" stroke="#ff00ff" stroke-width="0.2">
      <path d="${outlinePath}"/>
      ${cutoutElements}
  </g>
  <g id="SAFE_AREA" fill="none" stroke="#00a7a7" stroke-width="0.2" stroke-dasharray="4 3">
      <path d="${safePath}"/>
  </g>
  <g id="GUIDES" font-family="sans-serif" font-size="4" fill="#222">
      <text x="${format(canvas.originX + 4, precision)}" y="${format(canvas.originY + 7, precision)}">${title} · 1:1 · ${template.orientation} · ${template.bleedMm} mm bleed</text>
  </g>
</svg>`;
}

export function serializeArtworkCutMaskSvg(template, options = {}) {
    const precision = Math.max(2, Math.min(4, Number(options.precision) || 2));
    const canvas = template.canvas;
    const transform = template.orientation === 'mirrored'
        ? `translate(${format(canvas.originX * 2 + canvas.widthMm, precision)} 0) scale(-1 1)`
        : '';
    const outlinePath = polygonPath(template.outline, precision);
    const cutoutElements = template.cutouts.map(operationToSvg).join('\n      ');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${format(canvas.widthMm, precision)}mm" height="${format(canvas.heightMm, precision)}mm" viewBox="${format(canvas.originX, precision)} ${format(canvas.originY, precision)} ${format(canvas.widthMm, precision)} ${format(canvas.heightMm, precision)}">
  <g id="CUT_MASK" data-scale="1:1" data-units="mm" transform="${transform}" fill="none" stroke="#000" stroke-width="0.1">
      <path data-operation="profileCut" d="${outlinePath}"/>
      ${cutoutElements}
  </g>
</svg>`;
}

export function createMirroredSideTemplates(leftPart, rightPart, options = {}) {
    return [
        createArtworkTemplate(leftPart, { ...options, orientation: 'normal', role: 'side-art-left' }),
        createArtworkTemplate(rightPart, { ...options, orientation: 'mirrored', role: 'side-art-right' })
    ];
}

function normalizeAssets(assets) {
    return assets.map((asset, index) => ({
        id: String(asset.id || `asset-${index + 1}`),
        name: String(asset.name || `Artwork ${index + 1}`),
        kind: asset.kind === 'vector' || /svg\+xml/i.test(asset.mimeType || '') ? 'vector' : 'raster',
        source: String(asset.source || asset.imageSrc || ''),
        mimeType: String(asset.mimeType || ''),
        xMm: finite(asset.xMm ?? asset.x, 0),
        yMm: finite(asset.yMm ?? asset.y, 0),
        widthMm: Math.max(0.01, finite(asset.widthMm ?? asset.width, 100)),
        heightMm: Math.max(0.01, finite(asset.heightMm ?? asset.height, 100)),
        rotationDeg: finite(asset.rotationDeg ?? asset.rotation, 0),
        opacity: Math.max(0, Math.min(1, finite(asset.opacity, 1))),
        pixelWidth: Math.max(1, Math.round(finite(asset.pixelWidth, 1))),
        pixelHeight: Math.max(1, Math.round(finite(asset.pixelHeight, 1))),
        coversBleed: Boolean(asset.coversBleed)
    }));
}

function extractOutline(part) {
    const points = part.outline?.points || part.contour?.points || part.profilePoints || part.points;
    if (Array.isArray(points) && points.length >= 3) return points.map(point);
    const width = Math.max(0.01, finite(part.widthMm ?? part.width, 0.01));
    const height = Math.max(0.01, finite(part.heightMm ?? part.lengthMm ?? part.length, 0.01));
    return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
}

function inferArtworkRole(part) {
    if (String(part.id).startsWith('side_')) return 'side-art';
    if (part.id === 'panel_cp') return 'control-overlay';
    if (part.id === 'panel_bezel') return 'bezel-art';
    if (part.id === 'panel_marquee') return 'marquee-art';
    return 'panel-art';
}

function operationToSvg(operation) {
    const geometry = operation.geometry || {};
    if (geometry.kind === 'circle') {
        const center = point(geometry.center || geometry);
        const radius = finite(geometry.radiusMm ?? finite(geometry.diameterMm, 0) / 2, 0);
        return `<circle data-operation="${escapeXml(operation.type)}" cx="${format(center.x)}" cy="${format(center.y)}" r="${format(radius)}"/>`;
    }
    if (geometry.kind === 'rect') {
        const x = geometry.xMm - geometry.widthMm / 2;
        const y = geometry.yMm - geometry.heightMm / 2;
        return `<rect data-operation="${escapeXml(operation.type)}" x="${format(x)}" y="${format(y)}" width="${format(geometry.widthMm)}" height="${format(geometry.heightMm)}" rx="${format(geometry.cornerRadiusMm || 0)}"/>`;
    }
    if (Array.isArray(geometry.points)) return `<path data-operation="${escapeXml(operation.type)}" d="${polygonPath(geometry.points.map(point), 2)}"/>`;
    return '';
}

function normalizeOperationGeometry(source = {}, contours = []) {
    if (source.kind === 'circle') {
        const center = point(source.center || source);
        const radiusMm = Math.max(0, finite(source.radiusMm ?? finite(source.diameterMm, 0) / 2, 0));
        return { kind: 'circle', xMm: center.x, yMm: center.y, radiusMm, diameterMm: radiusMm * 2 };
    }
    if (source.kind === 'rect') {
        const center = point(source.center || source);
        return {
            ...source,
            xMm: center.x,
            yMm: center.y,
            widthMm: Math.max(0, finite(source.widthMm, 0)),
            heightMm: Math.max(0, finite(source.heightMm, 0))
        };
    }
    if (source.kind === 'contour') {
        const points = Array.isArray(source.points) && source.points.length
            ? source.points
            : contours.find(contour => contour.id === source.contourId)?.points;
        return { ...source, points: Array.isArray(points) ? points.map(point) : [] };
    }
    if (Array.isArray(source.points)) return { ...source, points: source.points.map(point) };
    return { ...source };
}

function isRenderableGeometry(geometry = {}) {
    if (geometry.kind === 'circle') return finite(geometry.radiusMm ?? finite(geometry.diameterMm, 0) / 2, 0) > 0;
    if (geometry.kind === 'rect') return finite(geometry.widthMm, 0) > 0 && finite(geometry.heightMm, 0) > 0;
    return Array.isArray(geometry.points) && geometry.points.length >= 3;
}

function assetToSvg(asset) {
    const x = asset.xMm - asset.widthMm / 2;
    const y = asset.yMm - asset.heightMm / 2;
    const transform = `rotate(${format(asset.rotationDeg)} ${format(asset.xMm)} ${format(asset.yMm)})`;
    return `<image id="${escapeXml(asset.id)}" href="${escapeXml(asset.source)}" x="${format(x)}" y="${format(y)}" width="${format(asset.widthMm)}" height="${format(asset.heightMm)}" opacity="${format(asset.opacity)}" transform="${transform}" preserveAspectRatio="xMidYMid meet"/>`;
}

function insetPolygonApprox(points, margin) {
    const centre = points.reduce((sum, value) => ({ x: sum.x + value.x / points.length, y: sum.y + value.y / points.length }), { x: 0, y: 0 });
    return points.map(value => {
        const distance = Math.hypot(value.x - centre.x, value.y - centre.y) || 1;
        const scale = Math.max(0, (distance - margin) / distance);
        return { x: centre.x + (value.x - centre.x) * scale, y: centre.y + (value.y - centre.y) * scale };
    });
}

function polygonPath(points, precision = 2) {
    return points.map((value, index) => `${index ? 'L' : 'M'} ${format(value.x, precision)} ${format(value.y, precision)}`).join(' ') + ' Z';
}

function polygonBounds(points) {
    const xs = points.map(value => value.x);
    const ys = points.map(value => value.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function point(value) {
    if (Array.isArray(value)) return { x: finite(value[0], 0), y: finite(value[1], 0) };
    return { x: finite(value?.x ?? value?.xMm, 0), y: finite(value?.y ?? value?.yMm, 0) };
}

function finding(code, severity, partId, message, remedy) {
    return { code, severity, partIds: partId ? [partId] : [], message, remedy };
}

function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function format(value, precision = 2) {
    return Number(finite(value, 0).toFixed(precision));
}

function escapeXml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
