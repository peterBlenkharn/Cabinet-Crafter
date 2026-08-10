import {
    FABRICATION_MANIFEST_SCHEMA,
    FABRICATION_MANIFEST_VERSION,
    OPERATION_TYPES,
    createManifestFromCabinet,
    runPreflight,
    summarizePreflight
} from './fabrication.js';
import {
    createProjectDocument,
    getProjectSuggestedFileName,
    migrateProjectDocument,
    serializeProjectDocument
} from './project-document.js';

const MACHINE_OPERATION_TYPES = Object.freeze(OPERATION_TYPES.filter(type => type !== 'reference'));
const PERSISTED_MANUFACTURING_OPTION_KEYS = Object.freeze([
    'materialAssignments', 'nesting', 'currencyCode',
    'hardwareCosts', 'additionalHardware',
    'joinery', 'joineryAssignments', 'joinerySettings',
    'process', 'processProfile',
    'artwork', 'artworkTemplates',
    'workshop', 'workshopProfile', 'batch', 'batchQuantity',
    'quote', 'includeQuote',
    'designVariant', 'designVariants', 'activeVariantId'
]);
let manufacturingPackModulePromise = null;

function loadManufacturingPackModule() {
    if (!manufacturingPackModulePromise) {
        manufacturingPackModulePromise = import('./manufacturing-pack.js').catch(error => {
            manufacturingPackModulePromise = null;
            throw error;
        });
    }
    return manufacturingPackModulePromise;
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function collectPreflight(manifest, supplied = null, preflightOptions = undefined) {
    const computed = runPreflight(manifest, preflightOptions);
    const additive = Array.isArray(supplied) ? supplied : [];
    const seen = new Set();
    return [...computed, ...additive].filter(item => {
        const key = item?.id || [
            item?.code,
            item?.severity,
            [...(item?.partIds || [])].sort().join('|'),
            item?.responsibleParameter || item?.parameter || '',
            JSON.stringify(item?.location || null)
        ].join('::');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function formatMm(value, precision = 3) {
    const numeric = finiteNumber(value);
    const fixed = numeric.toFixed(Math.max(2, precision));
    return fixed.replace(/\.?0+$/, '') || '0';
}

function safeFilename(value, fallback = 'cabinet') {
    const normalized = String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
        .replace(/\s+/g, '_')
        .replace(/^\.+|\.+$/g, '');
    return normalized || fallback;
}

function emitApplicationError(error, context) {
    const detail = {
        context,
        message: error instanceof Error ? error.message : String(error),
        error
    };
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('cabinetcrafter:error', { detail }));
    }
    return detail;
}

function downloadText(content, filename, mimeType) {
    if (typeof document === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return false;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body?.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return true;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function desktopAvailable() {
    return Boolean(globalThis.window?.cabinetDesktop?.available
        && typeof globalThis.window.cabinetDesktop.request === 'function');
}

function beginDesktopDelivery(artifact, requestType, payload) {
    artifact.delivered = true;
    artifact.deliveryPending = true;
    artifact.deliveryPromise = globalThis.window.cabinetDesktop.request(requestType, payload)
        .then(result => {
            artifact.deliveryPending = false;
            artifact.delivery = result;
            artifact.delivered = result?.cancelled !== true;
            return result;
        })
        .catch(error => {
            artifact.deliveryPending = false;
            artifact.delivered = false;
            artifact.deliveryError = emitApplicationError(error, requestType);
            throw error;
        });
    return artifact;
}

function deliverTextArtifact(artifact, options = {}, requestType = 'export.saveText') {
    if (options.download === false) return artifact;
    if (desktopAvailable()) {
        return beginDesktopDelivery(artifact, requestType, {
            content: artifact.content,
            suggestedName: artifact.filename,
            ...(requestType === 'export.saveText'
                ? { filter: options.filter || 'SVG drawing (*.svg)|*.svg|All files (*.*)|*.*' }
                : {})
        });
    }
    artifact.delivered = downloadText(artifact.content, artifact.filename, artifact.mimeType);
    return artifact;
}

export function createProjectDocumentV2(cabinet, options = {}) {
    if (!cabinet) throw new TypeError('A Cabinet instance is required.');
    const metadata = {
        ...(cabinet.projectMetadata || {}),
        ...(options || {})
    };
    const artwork = {};
    Object.entries(cabinet.decals || {}).forEach(([panelId, decals]) => {
        artwork[panelId] = (decals || []).map(decal => ({
            id: decal.id,
            imageSrc: decal.imageSrc,
            x: finiteNumber(decal.x),
            y: finiteNumber(decal.y),
            scale: finiteNumber(decal.scale, 50),
            rotation: finiteNumber(decal.rotation)
        }));
    });

    const viewState = clonePlain(metadata.viewState || cabinet.projectMetadata?.viewState || {});
    if (metadata.mannequinState || cabinet.projectMetadata?.mannequinState) {
        viewState.mannequin = clonePlain(metadata.mannequinState || cabinet.projectMetadata.mannequinState);
    }
    return createProjectDocument({
        name: metadata.projectName || metadata.name || cabinet.params?.projectName || 'Untitled Cabinet',
        basedOnPreset: cabinet.params?.presetId || null,
        params: clonePlain(cabinet.params || {}),
        decals: artwork,
        materials: clonePlain(cabinet.params?.materials || []),
        fabricationSettings: clonePlain(cabinet.params?.fabricationSettings || {}),
        inclusion: clonePlain(cabinet.params?.fabricationInclusion || {}),
        viewState,
        units: { display: cabinet.params?.displayUnits === 'in' ? 'in' : 'mm' }
    });
}

export function saveProject(cabinet, options = {}) {
    try {
        const documentData = createProjectDocumentV2(cabinet, options);
        const content = serializeProjectDocument(documentData);
        const filename = getProjectSuggestedFileName(documentData);
        const artifact = {
            ok: true,
            kind: 'project',
            filename,
            mimeType: 'application/json',
            content,
            document: documentData,
            delivered: false
        };

        return deliverTextArtifact(
            artifact,
            options,
            options.saveAs ? 'project.saveAs' : 'project.save'
        );
    } catch (error) {
        return {
            ok: false,
            kind: 'project',
            reason: 'serialize_failed',
            error: emitApplicationError(error, 'save-project')
        };
    }
}

function normalizeLoadedProject(projectData) {
    const migratedFrom = Number(projectData?.schemaVersion) === 2 ? null : (projectData?.version || '1.2');
    const documentData = migrateProjectDocument(projectData);
    const params = clonePlain(documentData.design.params || {});
    if (Array.isArray(documentData.materials)) params.materials = clonePlain(documentData.materials);
    params.fabricationSettings = {
        ...(params.fabricationSettings || {}),
        ...clonePlain(documentData.fabricationSettings || {})
    };
    params.fabricationInclusion = {
        ...(params.fabricationInclusion || {}),
        ...clonePlain(documentData.inclusion || {})
    };
    params.displayUnits = documentData.units?.display === 'in' ? 'in' : 'mm';
    return {
        ...documentData,
        params,
        decals: clonePlain(documentData.design.decals || {}),
        migratedFrom
    };
}

export function parseProjectDocument(text) {
    let parsed;
    try {
        parsed = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (error) {
        throw new SyntaxError(`Project JSON could not be parsed: ${error.message}`);
    }
    return normalizeLoadedProject(parsed);
}

export function loadProject(fileOrText, onLoaded, onError = null) {
    const succeed = text => {
        try {
            const projectData = parseProjectDocument(text);
            onLoaded?.(projectData);
            return { ok: true, document: projectData };
        } catch (error) {
            const detail = emitApplicationError(error, 'load-project');
            onError?.(detail);
            return { ok: false, reason: 'parse_failed', error: detail };
        }
    };

    if (typeof fileOrText === 'string' || (fileOrText && typeof fileOrText === 'object' && !(typeof File !== 'undefined' && fileOrText instanceof File))) {
        return succeed(fileOrText);
    }
    if (typeof FileReader === 'undefined' || !fileOrText) {
        const error = new TypeError('A readable project file is required.');
        const detail = emitApplicationError(error, 'load-project');
        onError?.(detail);
        return { ok: false, reason: 'read_failed', error: detail };
    }

    const reader = new FileReader();
    reader.onload = event => succeed(event.target.result);
    reader.onerror = () => {
        const detail = emitApplicationError(reader.error || new Error('Project file could not be read.'), 'load-project');
        onError?.(detail);
    };
    reader.readAsText(fileOrText);
    return { ok: true, pending: true };
}

function resolveManifest(cabinetOrManifest) {
    if (cabinetOrManifest?.schema === FABRICATION_MANIFEST_SCHEMA
        && cabinetOrManifest?.version === FABRICATION_MANIFEST_VERSION) {
        return cabinetOrManifest;
    }
    return createManifestFromCabinet(cabinetOrManifest);
}

function contourBounds(contour) {
    const points = contour?.points || [];
    if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthMm: 0, heightMm: 0 };
    const minX = Math.min(...points.map(item => item.xMm));
    const minY = Math.min(...points.map(item => item.yMm));
    const maxX = Math.max(...points.map(item => item.xMm));
    const maxY = Math.max(...points.map(item => item.yMm));
    return { minX, minY, maxX, maxY, widthMm: maxX - minX, heightMm: maxY - minY };
}

/**
 * Deterministic row layout for the single-file draft SVG. Production sheet
 * exports consume the same manifest with explicit validated placements.
 */
export function layoutManifestParts(manifest, options = {}) {
    const contoursById = new Map((manifest.contours || []).map(item => [item.id, item]));
    const marginMm = Math.max(0, finiteNumber(options.marginMm, 10));
    const spacingMm = Math.max(0, finiteNumber(options.spacingMm, 20));
    const maxRowWidthMm = Math.max(100, finiteNumber(options.maxRowWidthMm, 2440));
    const placements = [];
    let cursorX = marginMm;
    let cursorY = marginMm;
    let rowHeight = 0;
    let usedWidth = marginMm;

    (manifest.parts || [])
        .filter(part => part.includeInFabrication !== false)
        .forEach(part => {
            const contour = (part.contourIds || [])
                .map(id => contoursById.get(id))
                .find(item => item?.role === 'outer');
            const bounds = contourBounds(contour);
            if (cursorX > marginMm && cursorX + bounds.widthMm > maxRowWidthMm - marginMm) {
                cursorX = marginMm;
                cursorY += rowHeight + spacingMm;
                rowHeight = 0;
            }
            placements.push({
                partId: part.id,
                xMm: cursorX - bounds.minX,
                yMm: cursorY - bounds.minY,
                widthMm: bounds.widthMm,
                heightMm: bounds.heightMm
            });
            cursorX += bounds.widthMm + spacingMm;
            rowHeight = Math.max(rowHeight, bounds.heightMm);
            usedWidth = Math.max(usedWidth, cursorX - spacingMm + marginMm);
        });

    return {
        placements,
        widthMm: Math.max(1, usedWidth),
        heightMm: Math.max(1, cursorY + rowHeight + marginMm)
    };
}

function contourPathData(contour, placement, precision) {
    const points = contour?.points || [];
    if (!points.length) return '';
    const coordinates = points.map(item => (
        `${formatMm(item.xMm + placement.xMm, precision)} ${formatMm(item.yMm + placement.yMm, precision)}`
    ));
    return `M ${coordinates.join(' L ')} Z`;
}

function lineElement(operation, placement, precision, attributes = '') {
    const start = operation.geometry.start;
    const end = operation.geometry.end;
    return `<line id="${escapeXml(operation.id)}" x1="${formatMm(start.xMm + placement.xMm, precision)}" y1="${formatMm(start.yMm + placement.yMm, precision)}" x2="${formatMm(end.xMm + placement.xMm, precision)}" y2="${formatMm(end.yMm + placement.yMm, precision)}" ${attributes}/>`;
}

function operationElement(operation, placement, contoursById, precision, attributes = '') {
    const common = `data-part-id="${escapeXml(operation.partId)}" ${attributes}`;
    if (operation.geometry?.kind === 'contour') {
        const contour = contoursById.get(operation.geometry.contourId);
        if (!contour) return '';
        return `<path id="${escapeXml(operation.id)}" ${common} d="${contourPathData(contour, placement, precision)}"/>`;
    }
    if (operation.geometry?.kind === 'circle') {
        return `<circle id="${escapeXml(operation.id)}" ${common} cx="${formatMm(operation.geometry.center.xMm + placement.xMm, precision)}" cy="${formatMm(operation.geometry.center.yMm + placement.yMm, precision)}" r="${formatMm(operation.geometry.radiusMm, precision)}"/>`;
    }
    if (operation.geometry?.kind === 'line') {
        return lineElement(operation, placement, precision, common);
    }
    return '';
}

const OPERATION_STYLES = Object.freeze({
    profileCut: 'fill="none" stroke="#000000" stroke-width="0.2"',
    throughCut: 'fill="none" stroke="#ff0000" stroke-width="0.2"',
    drill: 'fill="none" stroke="#0000ff" stroke-width="0.2"',
    pocket: 'fill="none" stroke="#00a651" stroke-width="0.2"',
    engrave: 'fill="none" stroke="#7f3f98" stroke-width="0.2"',
    reference: 'fill="none" stroke="#777777" stroke-width="0.2" stroke-dasharray="4 2"'
});

/**
 * Serialize a clean, production-oriented SVG.  It contains no text,
 * background, legend, annotations, or reference operations.
 */
export function serializeMachineSvg(manifestInput, options = {}) {
    const manifest = resolveManifest(manifestInput);
    const precision = Math.max(2, Math.round(finiteNumber(options.precision, 3)));
    const layout = options.layout || layoutManifestParts(manifest, options);
    const placementsByPart = new Map(layout.placements.map(item => [item.partId, item]));
    const contoursById = new Map((manifest.contours || []).map(item => [item.id, item]));
    const includedPartIds = new Set((manifest.parts || []).filter(item => item.includeInFabrication !== false).map(item => item.id));

    const groups = MACHINE_OPERATION_TYPES.map(type => {
        const operations = (manifest.operations || [])
            .filter(operation => operation.type === type && includedPartIds.has(operation.partId))
            .map(operation => {
                const placement = placementsByPart.get(operation.partId);
                if (!placement) return '';
                return operationElement(operation, placement, contoursById, precision, OPERATION_STYLES[type]);
            })
            .filter(Boolean)
            .join('\n    ');
        return operations
            ? `  <g id="${type}">\n    ${operations}\n  </g>`
            : `  <g id="${type}"></g>`;
    }).join('\n');

    const width = formatMm(layout.widthMm, precision);
    const height = formatMm(layout.heightMm, precision);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">\n${groups}\n</svg>`;
}

function draftStatusText(summary) {
    if (summary.errors) return `DRAFT / NON-PRODUCTION: ${summary.errors} PREFLIGHT ERROR${summary.errors === 1 ? '' : 'S'}`;
    if (summary.warnings) return `ANNOTATED DRAFT: ${summary.warnings} WARNING${summary.warnings === 1 ? '' : 'S'} REQUIRE ACKNOWLEDGEMENT`;
    return 'ANNOTATED DRAFT: VERIFY BEFORE MACHINING';
}

/** Always available, even when production export is blocked. */
export function serializeDraftSvg(manifestInput, preflightInput = null, options = {}) {
    const manifest = resolveManifest(manifestInput);
    const preflight = collectPreflight(manifest, preflightInput, options.preflightOptions);
    const summary = summarizePreflight(preflight);
    const precision = Math.max(2, Math.round(finiteNumber(options.precision, 3)));
    const headerHeightMm = 45;
    const rawLayout = options.layout || layoutManifestParts(manifest, options);
    const layout = {
        ...rawLayout,
        heightMm: rawLayout.heightMm + headerHeightMm,
        placements: rawLayout.placements.map(item => ({ ...item, yMm: item.yMm + headerHeightMm }))
    };
    const placementsByPart = new Map(layout.placements.map(item => [item.partId, item]));
    const contoursById = new Map((manifest.contours || []).map(item => [item.id, item]));
    const includedParts = (manifest.parts || []).filter(item => item.includeInFabrication !== false);
    const includedPartIds = new Set(includedParts.map(item => item.id));
    const elements = [];

    (manifest.operations || []).forEach(operation => {
        if (!includedPartIds.has(operation.partId)) return;
        const placement = placementsByPart.get(operation.partId);
        if (!placement) return;
        const element = operationElement(
            operation,
            placement,
            contoursById,
            precision,
            OPERATION_STYLES[operation.type] || OPERATION_STYLES.reference
        );
        if (element) elements.push(`  ${element}`);
    });

    includedParts.forEach(part => {
        const placement = placementsByPart.get(part.id);
        if (!placement) return;
        const labelX = placement.xMm + placement.widthMm / 2;
        const labelY = Math.max(headerHeightMm + 4, placement.yMm - 3);
        elements.push(`  <text x="${formatMm(labelX, precision)}" y="${formatMm(labelY, precision)}" text-anchor="middle" font-size="5" fill="#171717">${escapeXml(part.name)}: ${formatMm(part.dimensions.widthMm, 2)} × ${formatMm(part.dimensions.lengthMm, 2)} × ${formatMm(part.thicknessMm, 2)} mm</text>`);
        const joints = (manifest.joints || []).filter(joint => joint.partIds.includes(part.id) && joint.type !== 'butt seam');
        joints.slice(0, 3).forEach((joint, index) => {
            const cut = joint.cuts.find(item => item.partId === part.id);
            elements.push(`  <text x="${formatMm(labelX, precision)}" y="${formatMm(placement.yMm + 7 + index * 5, precision)}" text-anchor="middle" font-size="3.6" fill="#55554f">${escapeXml(joint.pointName || joint.id)}: included ${formatMm(joint.includedAngleDeg, 2)}°, bevel ${formatMm(cut?.bevelAngleDeg, 2)}°</text>`);
        });
    });

    const width = formatMm(layout.widthMm, precision);
    const height = formatMm(layout.heightMm, precision);
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fbfbf8"/>
  <text x="10" y="14" font-size="8" font-weight="700" fill="${summary.errors ? '#8c1d1d' : '#171717'}">CABINET CRAFTER: ${escapeXml(draftStatusText(summary))}</text>
  <text x="10" y="25" font-size="5" fill="#55554f">${escapeXml(manifest.project?.name || 'Untitled Cabinet')} · exact millimetre geometry · machine SVG exported separately</text>
  <text x="10" y="34" font-size="4.2" fill="#55554f">Preflight: ${summary.errors} errors · ${summary.warnings} warnings · ${summary.info} info</text>
${elements.join('\n')}
</svg>`;
}

export const buildMachineSvg = serializeMachineSvg;
export const buildDraftSvg = serializeDraftSvg;

export function buildFabricationExport(cabinetOrManifest, options = {}) {
    try {
        const manifest = resolveManifest(cabinetOrManifest);
        const preflight = collectPreflight(manifest, options.preflight, options.preflightOptions);
        const summary = summarizePreflight(preflight);
        const baseName = safeFilename(options.projectName || manifest.project?.name || 'cabinet');
        const common = {
            manifest,
            preflight,
            summary,
            filename: `${baseName}_machine.svg`,
            mimeType: 'image/svg+xml'
        };

        if (summary.errors > 0) {
            return { ...common, ok: false, blocked: true, reason: 'preflight_errors' };
        }
        if (summary.warnings > 0 && options.acknowledgeWarnings !== true) {
            return { ...common, ok: false, blocked: true, reason: 'warning_acknowledgement_required' };
        }

        return {
            ...common,
            ok: true,
            blocked: false,
            content: serializeMachineSvg(manifest, options)
        };
    } catch (error) {
        return {
            ok: false,
            blocked: true,
            reason: 'generation_failed',
            error: emitApplicationError(error, 'fabrication-export')
        };
    }
}

export function exportProductionSVG(cabinetOrManifest, options = {}) {
    const artifact = buildFabricationExport(cabinetOrManifest, options);
    if (!artifact.ok) return artifact;
    artifact.delivered = false;
    return deliverTextArtifact(artifact, options);
}

export async function exportFabricationPackage(cabinetOrManifest, options = {}) {
    const gate = buildFabricationExport(cabinetOrManifest, {
        ...options,
        download: false
    });
    if (!gate.ok) return gate;

    try {
        const { buildManufacturingPackage, saveManufacturingPackage } = await loadManufacturingPackModule();
        const projectDocument = options.projectDocument
            || (cabinetOrManifest?.panelMeshes ? createProjectDocumentV2(cabinetOrManifest, options) : undefined);
        const persistedOptions = resolvePersistedManufacturingOptions(cabinetOrManifest, gate.manifest, projectDocument, options.fabricationSettings);
        const packageResult = buildManufacturingPackage(gate.manifest, gate.preflight, {
            ...persistedOptions,
            ...options,
            projectName: options.projectName || gate.manifest.project?.name,
            projectDocument
        });
        const delivery = options.download === false
            ? { cancelled: false, skipped: true, path: null }
            : await saveManufacturingPackage(packageResult);
        const artifact = {
            ok: true,
            blocked: false,
            kind: 'fabrication-package',
            manifest: gate.manifest,
            preflight: gate.preflight,
            summary: {
                ...gate.summary,
                ...packageResult.summary
            },
            filename: packageResult.fileName,
            mimeType: 'application/zip',
            package: packageResult,
            delivery,
            delivered: options.download !== false && delivery?.cancelled !== true
        };
        return artifact;
    } catch (error) {
        return {
            ok: false,
            blocked: true,
            kind: 'fabrication-package',
            reason: error?.code === 'NESTING_BLOCKED'
                ? 'nesting_errors'
                : error?.code === 'PREFLIGHT_BLOCKED'
                    ? 'preflight_errors'
                    : error?.code === 'WARNING_ACKNOWLEDGEMENT_REQUIRED'
                        ? 'warning_acknowledgement_required'
                        : 'package_generation_failed',
            preflight: error?.preflightResults || gate.preflight,
            error: emitApplicationError(error, 'fabrication-package')
        };
    }
}

function resolvePersistedManufacturingOptions(cabinetOrManifest, manifest, projectDocument, explicitSettings) {
    const sources = [
        manifest?.parameters?.fabricationSettings,
        cabinetOrManifest?.params?.fabricationSettings,
        projectDocument?.fabricationSettings,
        explicitSettings
    ].filter(source => source && typeof source === 'object');
    const result = {};
    sources.forEach(source => PERSISTED_MANUFACTURING_OPTION_KEYS.forEach(key => {
        if (source[key] !== undefined) result[key] = clonePlain(source[key]);
    }));
    return result;
}

export function exportDraftSVG(cabinetOrManifest, options = {}) {
    try {
        const manifest = resolveManifest(cabinetOrManifest);
        const preflight = collectPreflight(manifest, options.preflight, options.preflightOptions);
        const summary = summarizePreflight(preflight);
        const filename = `${safeFilename(options.projectName || manifest.project?.name || 'cabinet')}_annotated_draft.svg`;
        const content = serializeDraftSvg(manifest, preflight, options);
        const artifact = {
            ok: true,
            blocked: false,
            kind: 'draft',
            manifest,
            preflight,
            summary,
            filename,
            mimeType: 'image/svg+xml',
            content,
            delivered: false
        };
        return deliverTextArtifact(artifact, options);
    } catch (error) {
        return {
            ok: false,
            blocked: false,
            kind: 'draft',
            reason: 'generation_failed',
            error: emitApplicationError(error, 'draft-export')
        };
    }
}

// The historical toolbar action remains safe: it now creates the annotated
// reference drawing. Production export must be invoked explicitly.
export function exportToSVG(cabinetOrManifest, options = {}) {
    return exportDraftSVG(cabinetOrManifest, options);
}

export const exportInternals = Object.freeze({ formatMm, safeFilename, contourPathData });
