import {
    getHardwareOperations,
    instantiateHardware,
    normalizeHardwareLibrary,
    validateHardwareInstances
} from './hardware-library.js';

/**
 * Renderer-independent fabrication data and validation.
 *
 * The Three.js model is deliberately adapted at the boundary by
 * buildFabricationSourceFromCabinet().  Everything after that adapter is plain
 * data and can run in a browser, Node, a worker, or a future native exporter.
 */

export const FABRICATION_MANIFEST_VERSION = '1.0';
export const FABRICATION_MANIFEST_SCHEMA = 'CabinetCrafter.FabricationManifestV1';

export const OPERATION_TYPES = Object.freeze([
    'profileCut',
    'throughCut',
    'drill',
    'pocket',
    'engrave',
    'reference'
]);

export const PREFLIGHT_SEVERITIES = Object.freeze(['error', 'warning', 'info']);

export const FABRICATION_ASSEMBLY_IDS = Object.freeze({
    rearServiceDoor: 'assembly:rear-service-door',
    screenFrame: 'assembly:screen-frame'
});

export const FABRICATION_ASSEMBLY_PART_IDS = Object.freeze({
    rearServiceDoor: 'panel_back_service_door',
    screenFrameTop: 'screen_frame_top_rail',
    screenFrameBottom: 'screen_frame_bottom_rail',
    screenFrameLeft: 'screen_frame_left_stile',
    screenFrameRight: 'screen_frame_right_stile'
});

const MACHINE_OPERATION_TYPES = new Set(OPERATION_TYPES.filter(type => type !== 'reference'));
const EPSILON = 0.000001;

function finiteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function optionalPositiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > EPSILON ? numeric : null;
}

function normalizeRecessSpec(value, flatDiameter, flatDepth, flatAngle = null) {
    const source = value && typeof value === 'object' ? value : {};
    const diameterMm = optionalPositiveNumber(source.diameterMm ?? flatDiameter);
    const depthMm = optionalPositiveNumber(source.depthMm ?? flatDepth);
    const angleDeg = optionalPositiveNumber(source.angleDeg ?? flatAngle);
    if (diameterMm === null && depthMm === null && angleDeg === null) return null;
    return { diameterMm, depthMm, angleDeg };
}

function clonePlain(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function slug(value) {
    return String(value || 'item')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'item';
}

function stableThicknessId(thicknessMm) {
    return `sheet-${String(finiteNumber(thicknessMm, 18)).replace(/\./g, '_')}mm`;
}

function point(x, y) {
    return { xMm: finiteNumber(x), yMm: finiteNumber(y) };
}

function pointsFromUnknown(points = []) {
    return (Array.isArray(points) ? points : []).map(item => point(
        item?.xMm ?? item?.x,
        item?.yMm ?? item?.y
    ));
}

function contourBounds(contour) {
    const points = contour?.points || [];
    if (!points.length) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, widthMm: 0, heightMm: 0 };
    }

    const xs = points.map(item => item.xMm);
    const ys = points.map(item => item.yMm);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { minX, minY, maxX, maxY, widthMm: maxX - minX, heightMm: maxY - minY };
}

function normalizePolygonPoints(points = []) {
    const normalized = pointsFromUnknown(points);
    if (normalized.length > 1 && samePoint(normalized[0], normalized[normalized.length - 1])) {
        normalized.pop();
    }
    if (!normalized.length) return normalized;

    const minX = Math.min(...normalized.map(item => item.xMm));
    const minY = Math.min(...normalized.map(item => item.yMm));
    return normalized.map(item => point(item.xMm - minX, item.yMm - minY));
}

function rectanglePoints(widthMm, heightMm, centerX = null, centerY = null) {
    const width = finiteNumber(widthMm);
    const height = finiteNumber(heightMm);
    const left = centerX === null ? 0 : finiteNumber(centerX) - width / 2;
    const top = centerY === null ? 0 : finiteNumber(centerY) - height / 2;
    return [
        point(left, top),
        point(left + width, top),
        point(left + width, top + height),
        point(left, top + height)
    ];
}

function samePoint(a, b, tolerance = 0.000001) {
    return Math.abs(a.xMm - b.xMm) <= tolerance && Math.abs(a.yMm - b.yMm) <= tolerance;
}

function polygonArea(points = []) {
    if (points.length < 3) return 0;
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.xMm * next.yMm - next.xMm * current.yMm;
    }
    return Math.abs(area / 2);
}

function makeContour(id, partId, role, points, metadata = {}) {
    const contour = {
        id,
        partId,
        role,
        closed: true,
        points: pointsFromUnknown(points),
        ...clonePlain(metadata)
    };
    contour.bounds = contourBounds(contour);
    contour.areaMm2 = polygonArea(contour.points);
    return contour;
}

function makeOperation(id, partId, type, geometry, metadata = {}) {
    return {
        id,
        partId,
        type,
        geometry: clonePlain(geometry),
        ...clonePlain(metadata)
    };
}

function getPanelSnapshot(panel, cabinet) {
    const data = panel?.userData || panel || {};
    const id = data.id;
    const lengthMm = finiteNumber(data.lengthMm ?? data.length);
    const widthMm = finiteNumber(data.widthMm ?? data.width);
    const thicknessMm = finiteNumber(data.thicknessMm ?? data.thickness, cabinet?.params?.thickness ?? 18);
    const sourceProfilePoints = pointsFromUnknown(data.profilePoints);
    const sourceProfileMinX = sourceProfilePoints.length ? Math.min(...sourceProfilePoints.map(item => item.xMm)) : 0;
    const sourceProfileMinY = sourceProfilePoints.length ? Math.min(...sourceProfilePoints.map(item => item.yMm)) : 0;
    const profilePoints = data.exportType === 'profile'
        ? normalizePolygonPoints(sourceProfilePoints)
        : rectanglePoints(widthMm, lengthMm);
    const hardwareInfo = data.hardwareLayout
        ? {
            items: clonePlain(data.hardwareLayout),
            adjusted: Boolean(data.layoutAdjusted),
            fitSuggestion: clonePlain(data.layoutFitSuggestion),
            warnings: clonePlain(data.hardwareWarnings || [])
        }
        : cabinet?.getHardwareLayoutInfo?.(id, lengthMm, widthMm) || { items: [], warnings: [], adjusted: false };

    return {
        id,
        name: data.name || id,
        role: data.role || '',
        exportType: data.exportType || 'rectangle',
        lengthMm,
        widthMm,
        thicknessMm,
        areaMm2: finiteNumber(data.areaMm2, polygonArea(profilePoints)),
        profilePoints,
        includeInFabrication: typeof cabinet?.isPanelIncluded === 'function'
            ? cabinet.isPanelIncluded(id)
            : data.includeInFabrication !== false,
        viewportVisible: typeof cabinet?.isPanelVisible === 'function'
            ? cabinet.isPanelVisible(id)
            : data.viewportVisible !== false,
        materialId: data.materialId || null,
        quantity: Math.max(1, Math.round(finiteNumber(data.quantity, 1))),
        cutouts: clonePlain(data.cutouts || []),
        screenLayout: clonePlain(data.screenLayout || null),
        screenFrame: clonePlain(data.screenFrame || null),
        fabricationOperations: clonePlain(data.fabricationOperations || []),
        parentPartId: data.parentPartId || null,
        assemblyId: data.assemblyId || null,
        assemblyRole: data.assemblyRole || null,
        metadata: {
            ...clonePlain(data.metadata || {}),
            ...(data.profileCustomization
                ? { profileCustomization: clonePlain(data.profileCustomization) }
                : {})
        },
        hardware: clonePlain(hardwareInfo.items || []),
        hardwareWarnings: clonePlain(hardwareInfo.warnings || []),
        layoutFitSuggestion: clonePlain(hardwareInfo.fitSuggestion || data.layoutFitSuggestion || null),
        layoutDoesNotFit: Boolean(hardwareInfo.adjusted || data.layoutAdjusted),
        mitreGuides: clonePlain(data.mitreGuides || []),
        fasteners: clonePlain(data.fasteners || []).map(item => ({
            ...item,
            fabricationXmm: data.exportType === 'profile' ? finiteNumber(item.x) - sourceProfileMinX : finiteNumber(item.yMm),
            fabricationYmm: data.exportType === 'profile' ? finiteNumber(item.y) - sourceProfileMinY : finiteNumber(item.xMm)
        })),
        fastenerIssues: clonePlain(data.fastenerIssues || []),
        warnings: clonePlain(data.warnings || []),
        acceptsArtwork: Boolean(data.acceptsArtwork),
        finishedFace: data.finishedFace || 'front',
        grainDirection: data.grainDirection || 'none'
    };
}

/**
 * Adapter for the current renderer.  It snapshots exact millimetre values and
 * intentionally excludes meshes, materials, matrices, and every other Three.js
 * object from the fabrication contract.
 */
export function buildFabricationSourceFromCabinet(cabinet) {
    const records = cabinet?.fabricationPartRecords || cabinet?.panelMeshes;
    if (!cabinet || !Array.isArray(records)) {
        throw new TypeError('A built Cabinet instance is required.');
    }

    return {
        project: {
            name: cabinet.params?.projectName || 'Untitled Cabinet',
            presetId: cabinet.params?.presetId || null
        },
        params: clonePlain(cabinet.params || {}),
        materials: clonePlain(cabinet.params?.materials || []),
        materialAssignments: clonePlain(cabinet.params?.fabricationSettings?.materialAssignments || {}),
        parts: records.map(panel => getPanelSnapshot(panel, cabinet)),
        assemblySchedules: clonePlain(cabinet.fabricationAssemblySchedules || []),
        joints: clonePlain(cabinet.fabricationDiagnostics?.intersections || []),
        invalidIntersections: clonePlain(cabinet.fabricationDiagnostics?.invalidIntersections || []),
        fastenerIssues: clonePlain(cabinet.fabricationDiagnostics?.fastenerIssues || []),
        profileIssues: clonePlain(cabinet.fabricationDiagnostics?.profileIssues || []),
        sourceWarnings: clonePlain(cabinet.fabricationDiagnostics?.warnings || [])
    };
}

/**
 * Create the detachable service-door and four-piece screen-frame records from
 * the parent panel geometry. The helper is renderer-independent so its stable
 * IDs, fit clearances, and schedules can be regression tested headlessly.
 */
export function createCabinetAssemblyFabricationRecords({
    parts: sourceParts = [],
    defaultThicknessMm = 18,
    isIncluded = () => true,
    isVisible = () => true
} = {}) {
    const parts = [];
    const schedules = [];
    const existingPartIds = new Set((sourceParts || []).map(part => part?.id).filter(Boolean));
    const includePart = part => {
        if (!part?.id || existingPartIds.has(part.id)) return;
        existingPartIds.add(part.id);
        parts.push(part);
    };
    const bounded = (value, minimum, maximum) =>
        Math.min(Math.max(finiteNumber(value, minimum), minimum), Math.max(minimum, maximum));

    const backPanel = sourceParts.find(record => record?.id === 'panel_back');
    const doorOpening = backPanel?.cutouts?.find(item => item.kind === 'service_door');
    if (backPanel && doorOpening) {
        const partId = FABRICATION_ASSEMBLY_PART_IDS.rearServiceDoor;
        const assemblyId = FABRICATION_ASSEMBLY_IDS.rearServiceDoor;
        const clearancePerSideMm = bounded(finiteNumber(doorOpening.clearancePerSideMm, 2), 0.5, 6);
        const lengthMm = Math.max(20, finiteNumber(doorOpening.heightMm, 20) - clearancePerSideMm * 2);
        const widthMm = Math.max(20, finiteNumber(doorOpening.widthMm, 20) - clearancePerSideMm * 2);
        const thicknessMm = Math.max(3, finiteNumber(backPanel.thicknessMm, defaultThicknessMm));
        const minimumEdgeInsetMm = Math.min(18, Math.max(4, widthMm / 4));
        const minimumEndInsetMm = Math.min(45, Math.max(4, lengthMm / 4));
        const hardwareEdgeInsetMm = bounded(widthMm * 0.08, minimumEdgeInsetMm, widthMm / 2 - 4);
        const hardwareEndInsetMm = bounded(lengthMm * 0.18, minimumEndInsetMm, lengthMm / 2 - 4);
        const hardwareReferences = [
            {
                id: `${partId}:hinge-upper-reference`,
                type: 'reference',
                geometry: {
                    kind: 'circle',
                    center: { xMm: hardwareEdgeInsetMm, yMm: hardwareEndInsetMm },
                    radiusMm: 2
                },
                purpose: 'hinge-location',
                hardwareRole: 'upper-hinge'
            },
            {
                id: `${partId}:hinge-lower-reference`,
                type: 'reference',
                geometry: {
                    kind: 'circle',
                    center: { xMm: hardwareEdgeInsetMm, yMm: lengthMm - hardwareEndInsetMm },
                    radiusMm: 2
                },
                purpose: 'hinge-location',
                hardwareRole: 'lower-hinge'
            },
            {
                id: `${partId}:latch-reference`,
                type: 'reference',
                geometry: {
                    kind: 'circle',
                    center: { xMm: widthMm - hardwareEdgeInsetMm, yMm: lengthMm / 2 },
                    radiusMm: 2
                },
                purpose: 'latch-location',
                hardwareRole: 'service-latch'
            }
        ];

        includePart({
            id: partId,
            name: 'Rear Service Door',
            role: 'Removable rear service-access closure',
            exportType: 'rectangle',
            parentPartId: backPanel.id,
            assemblyId,
            assemblyRole: 'door-leaf',
            lengthMm,
            widthMm,
            thicknessMm,
            areaMm2: lengthMm * widthMm,
            materialId: backPanel.materialId || null,
            includeInFabrication: isIncluded(partId) !== false,
            viewportVisible: isVisible(partId) !== false,
            finishedFace: 'exterior',
            grainDirection: backPanel.grainDirection || 'none',
            fabricationOperations: hardwareReferences,
            metadata: {
                clearancePerSideMm,
                openingPartId: backPanel.id,
                openingCutoutId: doorOpening.id,
                hardwareReferenceOperationIds: hardwareReferences.map(item => item.id)
            }
        });

        schedules.push({
            id: assemblyId,
            kind: 'rear-service-door',
            name: 'Rear service door assembly',
            parentPartId: backPanel.id,
            partIds: [partId],
            openingOperationId: `${backPanel.id}:${doorOpening.id || `${slug(doorOpening.kind || 'service-door')}-1`}:throughCut`,
            clearancePerSideMm,
            clearanceTotalMm: clearancePerSideMm * 2,
            hardware: [
                {
                    id: `${assemblyId}:hinges`,
                    kind: 'surface-hinge',
                    quantity: 2,
                    operationIds: hardwareReferences.filter(item => item.purpose === 'hinge-location').map(item => item.id),
                    note: 'Reference centres only; transfer the supplied hinge hole pattern before drilling.'
                },
                {
                    id: `${assemblyId}:latch`,
                    kind: 'service-latch',
                    quantity: 1,
                    operationIds: hardwareReferences.filter(item => item.purpose === 'latch-location').map(item => item.id),
                    note: 'Reference centre only; confirm the selected latch body and strike clearances.'
                }
            ]
        });
    }

    const bezelPanel = sourceParts.find(record => record?.id === 'panel_bezel');
    const frame = bezelPanel?.screenFrame;
    if (bezelPanel && frame) {
        const assemblyId = FABRICATION_ASSEMBLY_IDS.screenFrame;
        const frameThicknessMm = Math.max(3, finiteNumber(frame.depthMm, 12));
        const pieceDefinitions = [
            {
                id: FABRICATION_ASSEMBLY_PART_IDS.screenFrameTop,
                name: 'Screen Frame Top Rail',
                assemblyRole: 'top-rail',
                lengthMm: frame.outerWidthMm,
                widthMm: frame.bezelMm,
                matesWith: [FABRICATION_ASSEMBLY_PART_IDS.screenFrameLeft, FABRICATION_ASSEMBLY_PART_IDS.screenFrameRight]
            },
            {
                id: FABRICATION_ASSEMBLY_PART_IDS.screenFrameBottom,
                name: 'Screen Frame Bottom Rail',
                assemblyRole: 'bottom-rail',
                lengthMm: frame.outerWidthMm,
                widthMm: frame.bezelMm,
                matesWith: [FABRICATION_ASSEMBLY_PART_IDS.screenFrameLeft, FABRICATION_ASSEMBLY_PART_IDS.screenFrameRight]
            },
            {
                id: FABRICATION_ASSEMBLY_PART_IDS.screenFrameLeft,
                name: 'Screen Frame Left Stile',
                assemblyRole: 'left-stile',
                lengthMm: frame.innerHeightMm,
                widthMm: frame.bezelMm,
                matesWith: [FABRICATION_ASSEMBLY_PART_IDS.screenFrameTop, FABRICATION_ASSEMBLY_PART_IDS.screenFrameBottom]
            },
            {
                id: FABRICATION_ASSEMBLY_PART_IDS.screenFrameRight,
                name: 'Screen Frame Right Stile',
                assemblyRole: 'right-stile',
                lengthMm: frame.innerHeightMm,
                widthMm: frame.bezelMm,
                matesWith: [FABRICATION_ASSEMBLY_PART_IDS.screenFrameTop, FABRICATION_ASSEMBLY_PART_IDS.screenFrameBottom]
            }
        ];

        pieceDefinitions.forEach((piece, index) => {
            const lengthMm = Math.max(20, finiteNumber(piece.lengthMm, 20));
            const widthMm = Math.max(4, finiteNumber(piece.widthMm, 4));
            includePart({
                id: piece.id,
                name: piece.name,
                role: 'Monitor screen-frame stock',
                exportType: 'rectangle',
                parentPartId: bezelPanel.id,
                assemblyId,
                assemblyRole: piece.assemblyRole,
                lengthMm,
                widthMm,
                thicknessMm: frameThicknessMm,
                areaMm2: lengthMm * widthMm,
                materialId: null,
                includeInFabrication: isIncluded(piece.id) !== false,
                viewportVisible: isVisible(piece.id) !== false,
                finishedFace: 'front',
                grainDirection: 'length',
                metadata: {
                    sequence: index + 1,
                    jointTreatment: 'square-butt',
                    matesWith: piece.matesWith,
                    frameOpeningMm: {
                        widthMm: finiteNumber(frame.innerWidthMm),
                        heightMm: finiteNumber(frame.innerHeightMm)
                    }
                }
            });
        });

        schedules.push({
            id: assemblyId,
            kind: 'screen-frame',
            name: 'Four-piece monitor screen frame',
            parentPartId: bezelPanel.id,
            partIds: pieceDefinitions.map(piece => piece.id),
            construction: 'square-butt',
            clearanceMm: finiteNumber(frame.clearanceMm),
            bezelMm: finiteNumber(frame.bezelMm),
            depthMm: frameThicknessMm,
            placementReferenceOperationIds: [
                `${bezelPanel.id}:screen-frame-outer:reference`,
                `${bezelPanel.id}:screen-frame-inner:reference`
            ],
            pieces: pieceDefinitions.map((piece, index) => ({
                id: piece.id,
                sequence: index + 1,
                role: piece.assemblyRole,
                lengthMm: Math.max(20, finiteNumber(piece.lengthMm, 20)),
                widthMm: Math.max(4, finiteNumber(piece.widthMm, 4)),
                quantity: 1,
                jointTreatment: 'square-butt',
                matesWith: piece.matesWith
            }))
        });
    }

    return { parts, schedules };
}

function addContourAndOperation(manifest, part, contour, operationType = null, operationMetadata = {}) {
    manifest.contours.push(contour);
    part.contourIds.push(contour.id);
    if (!operationType) return null;

    const operation = makeOperation(
        `${contour.id}:${operationType}`,
        part.id,
        operationType,
        { kind: 'contour', contourId: contour.id },
        operationMetadata
    );
    manifest.operations.push(operation);
    part.operationIds.push(operation.id);
    return operation;
}

function addCircleOperation(manifest, part, id, type, centerX, centerY, radiusMm, metadata = {}) {
    const operation = makeOperation(id, part.id, type, {
        kind: 'circle',
        center: point(centerX, centerY),
        radiusMm: finiteNumber(radiusMm)
    }, metadata);
    manifest.operations.push(operation);
    part.operationIds.push(operation.id);
    return operation;
}

function materialProfilesForSource(sourceParts, suppliedMaterials = []) {
    const materials = Array.isArray(suppliedMaterials) ? clonePlain(suppliedMaterials) : [];
    const materialIds = new Set(materials.map(item => item.id));

    sourceParts.forEach(sourcePart => {
        const requestedId = sourcePart.materialId;
        if (requestedId && materialIds.has(requestedId)) return;

        const thicknessMm = finiteNumber(sourcePart.thicknessMm ?? sourcePart.thickness, 18);
        const id = requestedId || stableThicknessId(thicknessMm);
        sourcePart.materialId = id;
        if (materialIds.has(id)) return;

        materials.push({
            id,
            name: `${thicknessMm} mm sheet material`,
            nominalThicknessMm: thicknessMm,
            measuredThicknessMm: thicknessMm,
            stock: null,
            grainDirection: 'none',
            densityKgM3: null,
            pricePerSheet: null
        });
        materialIds.add(id);
    });

    return materials;
}

function addPartOperations(manifest, part, sourcePart, hardwareLibrary) {
    const outerPoints = sourcePart.profilePoints?.length >= 3
        ? normalizePolygonPoints(sourcePart.profilePoints)
        : rectanglePoints(part.dimensions.widthMm, part.dimensions.lengthMm);
    const outerContour = makeContour(`${part.id}:outer`, part.id, 'outer', outerPoints);
    addContourAndOperation(manifest, part, outerContour, 'profileCut', { side: 'outside' });

    const addRectThroughCut = (idSuffix, item, metadata = {}) => {
        const widthMm = finiteNumber(item.widthMm);
        const heightMm = finiteNumber(item.heightMm);
        const contour = makeContour(
            `${part.id}:${idSuffix}`,
            part.id,
            'inner',
            rectanglePoints(widthMm, heightMm, item.yMm, item.xMm),
            { sourceKind: item.kind || idSuffix }
        );
        addContourAndOperation(manifest, part, contour, 'throughCut', { side: 'inside', ...metadata });
    };

    if (sourcePart.screenLayout) {
        addRectThroughCut('monitor-cutout', {
            ...sourcePart.screenLayout,
            kind: 'monitor'
        }, { purpose: 'monitor' });
    }

    (sourcePart.cutouts || []).forEach((item, index) => {
        const cutoutId = item.id || `${slug(item.kind || 'cutout')}-${index + 1}`;
        addRectThroughCut(slug(cutoutId), item, {
            purpose: item.kind || 'cutout',
            label: item.label || null,
            assemblyId: item.assemblyId || null,
            matingPartId: item.matingPartId || null,
            clearancePerSideMm: Number.isFinite(Number(item.clearancePerSideMm))
                ? Number(item.clearancePerSideMm)
                : null
        });
    });

    (sourcePart.hardware || []).forEach((item, index) => {
        const radiusMm = finiteNumber(item.radiusMm);
        const definitionId = item.hardwareDefinitionId
            || (item.kind === 'joystick' ? 'joystick-jlf-pattern' : radiusMm <= 13 ? 'button-24-snap' : 'button-30-snap');
        const instanceId = `${part.id}:hardware-${slug(item.kind)}-${index + 1}`;
        const definition = hardwareLibrary.find(candidate => candidate.id === definitionId);
        if (!definition) {
            const operation = addCircleOperation(
                manifest, part, instanceId, 'throughCut', item.yMm, item.xMm, radiusMm,
                {
                    purpose: item.kind || 'hardware', label: item.label || null,
                    hardwareDefinitionId: definitionId, hardwareInstanceId: instanceId
                }
            );
            manifest.hardwareFindings.push({
                code: 'HARDWARE_DEFINITION_MISSING', severity: 'error', partIds: [part.id],
                operationId: operation.id,
                message: `${item.label || item.kind || 'Hardware'} refers to missing definition ${definitionId}.`,
                correctiveAction: 'Choose or import a valid hardware definition.'
            });
            const keepout = {
                id: `${instanceId}:keepout`, partId: part.id, hardwareOperationId: operation.id,
                hardwareDefinitionId: definitionId, hardwareInstanceId: instanceId,
                kind: 'cylinder', center: point(item.yMm, item.xMm),
                radiusMm: finiteNumber(item.keepoutRadiusMm, radiusMm),
                depthMm: finiteNumber(item.keepoutDepthMm, item.kind === 'joystick' ? 70 : 45),
                side: 'underside'
            };
            manifest.keepouts.push(keepout);
            part.keepoutIds.push(keepout.id);
            return;
        }

        const instance = instantiateHardware(definitionId, {
            id: instanceId,
            partId: part.id,
            xMm: item.yMm,
            yMm: item.xMm,
            rotationDeg: item.rotationDeg || 0,
            label: item.label || definition.name,
            encoderInput: item.encoderInput || null
        }, hardwareLibrary);
        manifest.hardwareInstances.push(instance);
        const definitionOperations = getHardwareOperations(instance, hardwareLibrary);
        const primaryIndex = Math.max(0, definitionOperations.findIndex(operation => operation.type === 'throughCut'));
        let primaryOperationId = null;

        definitionOperations.forEach((definitionOperation, operationIndex) => {
            const geometry = definitionOperation.geometry || {};
            const isPrimary = operationIndex === primaryIndex;
            const metadata = {
                purpose: isPrimary ? (item.kind || definition.category || 'hardware') : 'hardware-mount',
                label: isPrimary ? (item.label || definition.name) : null,
                hardwareDefinitionId: definitionId,
                hardwareInstanceId: instanceId,
                definitionOperationId: definitionOperation.id,
                depthMm: definitionOperation.depthMm,
                requestedDiameterMm: radiusMm * 2
            };
            let operation = null;
            if (geometry.kind === 'circle') {
                operation = addCircleOperation(
                    manifest, part, definitionOperation.id, definitionOperation.type,
                    geometry.xMm, geometry.yMm, finiteNumber(geometry.diameterMm) / 2, metadata
                );
            } else if (geometry.kind === 'rect') {
                const contour = makeContour(
                    `${definitionOperation.id}:contour`, part.id, 'inner',
                    rectanglePoints(geometry.widthMm, geometry.heightMm, geometry.xMm, geometry.yMm),
                    { sourceKind: item.kind || definition.category, hardwareInstanceId: instanceId }
                );
                operation = addContourAndOperation(manifest, part, contour, definitionOperation.type, metadata);
            }
            if (isPrimary && operation) primaryOperationId = operation.id;
        });

        const keepout = {
            id: `${instanceId}:keepout`,
            partId: part.id,
            hardwareOperationId: primaryOperationId,
            hardwareDefinitionId: definitionId,
            hardwareInstanceId: instanceId,
            kind: 'box',
            center: point(instance.xMm, instance.yMm),
            widthMm: definition.body.widthMm,
            heightMm: definition.body.heightMm,
            depthMm: definition.body.depthMm,
            serviceEnvelope: clonePlain(definition.keepout),
            side: 'underside',
            validationHandledByHardwareLibrary: true
        };
        manifest.keepouts.push(keepout);
        part.keepoutIds.push(keepout.id);
    });

    (sourcePart.fasteners || []).forEach((item, index) => {
        if (item.sourcePanelId && item.sourcePanelId !== part.id) return;

        const xMm = sourcePart.exportType === 'profile'
            ? finiteNumber(item.fabricationXmm)
            : finiteNumber(item.yMm);
        const yMm = sourcePart.exportType === 'profile'
            ? finiteNumber(item.fabricationYmm)
            : finiteNumber(item.xMm);
        const fastenerId = item.id || `${part.id}:fastener-${index + 1}`;
        const diameterMm = finiteNumber(item.diameterMm, finiteNumber(item.radiusMm) * 2);
        const pilotDiameterMm = optionalPositiveNumber(item.pilotDiameterMm) || diameterMm;
        const coreDiameterMm = optionalPositiveNumber(item.coreDiameterMm);
        const clearanceDiameterMm = optionalPositiveNumber(item.clearanceDiameterMm);
        const headDiameterMm = optionalPositiveNumber(item.headDiameterMm)
            || (optionalPositiveNumber(item.headRadiusMm) !== null ? optionalPositiveNumber(item.headRadiusMm) * 2 : null);
        const countersink = normalizeRecessSpec(
            item.countersink,
            item.countersinkDiameterMm,
            item.countersinkDepthMm,
            item.countersinkAngleDeg
        );
        const counterbore = normalizeRecessSpec(
            item.counterbore,
            item.counterboreDiameterMm,
            item.counterboreDepthMm
        );
        const insertionDirection = item.insertionDirection ?? item.direction ?? null;
        const collisionDiameterMm = Math.max(
            pilotDiameterMm,
            headDiameterMm || 0,
            clearanceDiameterMm || 0,
            countersink?.diameterMm || 0,
            counterbore?.diameterMm || 0
        );
        const fastener = {
            id: fastenerId,
            partId: part.id,
            targetPartId: item.targetPanelId || null,
            kind: item.kind || 'screw',
            center: point(xMm, yMm),
            diameterMm,
            pilotDiameterMm,
            coreDiameterMm,
            clearanceDiameterMm,
            headDiameterMm,
            headType: item.headType || null,
            countersink,
            counterbore,
            lengthMm: finiteNumber(item.lengthMm),
            insertionDirection,
            invalid: Boolean(item.invalid),
            issueMessages: clonePlain(item.issueMessages || [])
        };
        manifest.fasteners.push(fastener);
        part.fastenerIds.push(fastener.id);
        addCircleOperation(
            manifest,
            part,
            `${part.id}:drill-${slug(fastener.id)}`,
            'drill',
            xMm,
            yMm,
            pilotDiameterMm / 2,
            {
                fastenerId: fastener.id,
                purpose: 'pilot-hole',
                pilotDiameterMm,
                coreDiameterMm,
                clearanceDiameterMm,
                collisionDiameterMm,
                headDiameterMm,
                headType: fastener.headType,
                countersink,
                counterbore,
                insertionDirection
            }
        );
    });

    if (sourcePart.screenFrame) {
        const frame = sourcePart.screenFrame;
        [
            ['screen-frame-outer', frame.outerWidthMm, frame.outerHeightMm],
            ['screen-frame-inner', frame.innerWidthMm, frame.innerHeightMm]
        ].forEach(([suffix, widthMm, heightMm]) => {
            const contour = makeContour(
                `${part.id}:${suffix}`,
                part.id,
                'reference',
                rectanglePoints(widthMm, heightMm, frame.yMm, frame.xMm),
                { sourceKind: suffix }
            );
            addContourAndOperation(manifest, part, contour, 'reference', {
                purpose: 'screen-frame-placement',
                assemblyId: frame.assemblyId || FABRICATION_ASSEMBLY_IDS.screenFrame,
                framePartIds: clonePlain(frame.partIds || [])
            });
        });
    }

    (sourcePart.fabricationOperations || []).forEach((declared, index) => {
        const geometry = clonePlain(declared?.geometry || {});
        const operationId = declared?.id || `${part.id}:declared-${index + 1}`;
        if (manifest.operations.some(operation => operation.id === operationId)) return;

        const metadata = clonePlain(declared || {});
        delete metadata.id;
        delete metadata.type;
        delete metadata.geometry;
        const operation = makeOperation(
            operationId,
            part.id,
            declared?.type || 'reference',
            geometry,
            metadata
        );
        manifest.operations.push(operation);
        part.operationIds.push(operation.id);
    });

    (sourcePart.mitreGuides || []).forEach((guide, index) => {
        const operation = makeOperation(
            `${part.id}:mitre-reference-${index + 1}`,
            part.id,
            'reference',
            {
                kind: 'line',
                start: point(0, finiteNumber(guide.frontLineMm)),
                end: point(part.dimensions.widthMm, finiteNumber(guide.frontLineMm))
            },
            {
                purpose: guide.type === 'butt' ? 'butt-joint' : 'mitre',
                pointName: guide.pointName,
                edge: guide.edge,
                includedAngleDeg: finiteNumber(guide.includedAngleDeg ?? guide.angleDeg),
                bevelAngleDeg: finiteNumber(guide.bevelAngleDeg),
                longFace: guide.longFace || null
            }
        );
        manifest.operations.push(operation);
        part.operationIds.push(operation.id);
    });
}

function normalizeJoint(sourceJoint, sourceParts) {
    const partIds = [...new Set(sourceJoint.partIds || sourceJoint.panels || [])];
    const cuts = Array.isArray(sourceJoint.cuts) ? clonePlain(sourceJoint.cuts) : [];
    if (!cuts.length) {
        partIds.forEach(partId => {
            const part = sourceParts.find(item => item.id === partId);
            const guide = part?.mitreGuides?.find(item => item.pointName === sourceJoint.pointName);
            if (!guide) return;
            cuts.push({
                partId,
                edge: guide.edge,
                bevelAngleDeg: finiteNumber(guide.bevelAngleDeg),
                frontLineMm: finiteNumber(guide.frontLineMm),
                backLineMm: finiteNumber(guide.backLineMm),
                longFace: guide.longFace || null
            });
        });
    }

    return {
        id: sourceJoint.id || `joint:${slug(sourceJoint.pointName || partIds.join('-'))}`,
        pointName: sourceJoint.pointName || null,
        type: sourceJoint.type || 'mitre',
        partIds,
        includedAngleDeg: finiteNumber(
            sourceJoint.includedAngleDeg,
            finiteNumber(sourceJoint.cutAngleDeg) * 2
        ),
        cuts,
        allowanceMm: finiteNumber(sourceJoint.allowanceMm),
        fit: sourceJoint.fit || null,
        strategy: sourceJoint.strategy || null,
        recommendedStrategy: sourceJoint.recommendedStrategy || null,
        hostPartId: sourceJoint.hostPartId || null,
        edgeGeometry: sourceJoint.edgeGeometry ? clonePlain(sourceJoint.edgeGeometry) : null,
        tongueGeometry: sourceJoint.tongueGeometry ? clonePlain(sourceJoint.tongueGeometry) : null,
        matingSlotGeometry: sourceJoint.matingSlotGeometry ? clonePlain(sourceJoint.matingSlotGeometry) : null,
        machiningOperationId: sourceJoint.machiningOperationId || null,
        matingMachiningOperationId: sourceJoint.matingMachiningOperationId || null,
        location: clonePlain(sourceJoint.location || sourceJoint.center || null)
    };
}

/**
 * Build FabricationManifestV1 from a plain source snapshot.
 */
export function createFabricationManifest(source = {}) {
    const sourceParts = clonePlain(Array.isArray(source.parts) ? source.parts : []);
    const materialAssignments = clonePlain(
        source.materialAssignments
        || source.params?.fabricationSettings?.materialAssignments
        || source.parameters?.fabricationSettings?.materialAssignments
        || {}
    );
    sourceParts.forEach(sourcePart => {
        const assignedMaterialId = materialAssignments[sourcePart?.id];
        if (assignedMaterialId) sourcePart.materialId = String(assignedMaterialId);
    });
    const manifest = {
        schema: FABRICATION_MANIFEST_SCHEMA,
        version: FABRICATION_MANIFEST_VERSION,
        units: 'mm',
        project: {
            name: source.project?.name || source.projectName || 'Untitled Cabinet',
            presetId: source.project?.presetId || null
        },
        parameters: clonePlain(source.params || source.parameters || {}),
        materials: materialProfilesForSource(sourceParts, source.materials),
        parts: [],
        contours: [],
        operations: [],
        joints: [],
        fasteners: [],
        keepouts: [],
        hardwareInstances: [],
        hardwareFindings: [],
        assemblySchedules: [],
        layoutFitSuggestions: [],
        sourceDiagnostics: {
            invalidIntersections: clonePlain(source.invalidIntersections || []),
            fastenerIssues: clonePlain(source.fastenerIssues || []),
            profileIssues: clonePlain(source.profileIssues || []),
            warnings: clonePlain(source.sourceWarnings || [])
        }
    };
    const hardwareLibrary = normalizeHardwareLibrary(
        source.hardwareDefinitions
        || manifest.parameters?.hardwareDefinitions
        || []
    );

    sourceParts.forEach(sourcePart => {
        if (!sourcePart?.id) return;
        const lengthMm = finiteNumber(sourcePart.lengthMm ?? sourcePart.length);
        const widthMm = finiteNumber(sourcePart.widthMm ?? sourcePart.width);
        const thicknessMm = finiteNumber(sourcePart.thicknessMm ?? sourcePart.thickness, 18);
        const part = {
            id: sourcePart.id,
            name: sourcePart.name || sourcePart.id,
            role: sourcePart.role || '',
            quantity: Math.max(1, Math.round(finiteNumber(sourcePart.quantity, 1))),
            materialId: sourcePart.materialId || stableThicknessId(thicknessMm),
            thicknessMm,
            dimensions: { lengthMm, widthMm },
            areaMm2: finiteNumber(sourcePart.areaMm2, lengthMm * widthMm),
            includeInFabrication: sourcePart.includeInFabrication !== false,
            viewportVisible: sourcePart.viewportVisible !== false,
            finishedFace: sourcePart.finishedFace || 'front',
            grainDirection: sourcePart.grainDirection || 'none',
            contourIds: [],
            operationIds: [],
            jointIds: [],
            fastenerIds: [],
            keepoutIds: [],
            metadata: {
                exportType: sourcePart.exportType || 'rectangle',
                acceptsArtwork: Boolean(sourcePart.acceptsArtwork),
                parentPartId: sourcePart.parentPartId || null,
                assemblyId: sourcePart.assemblyId || null,
                assemblyRole: sourcePart.assemblyRole || null,
                ...clonePlain(sourcePart.metadata || {})
            }
        };
        manifest.parts.push(part);
        addPartOperations(manifest, part, sourcePart, hardwareLibrary);

        if (sourcePart.layoutDoesNotFit || sourcePart.layoutFitSuggestion) {
            const suggestion = {
                id: `${part.id}:layout-fit`,
                partId: part.id,
                controlPath: part.id === 'panel_apron' ? 'apron' : 'deck',
                ...clonePlain(sourcePart.layoutFitSuggestion || {})
            };
            manifest.layoutFitSuggestions.push(suggestion);
        }
    });

    manifest.joints = (source.joints || []).map(item => normalizeJoint(item, sourceParts));
    manifest.joints.forEach(joint => {
        joint.partIds.forEach(partId => {
            const part = manifest.parts.find(item => item.id === partId);
            if (part && !part.jointIds.includes(joint.id)) part.jointIds.push(joint.id);
        });
    });

    manifest.assemblySchedules = (source.assemblySchedules || []).map((schedule, index) => {
        const normalized = clonePlain(schedule || {});
        const partIds = [...new Set((normalized.partIds || []).filter(partId =>
            manifest.parts.some(part => part.id === partId)
        ))];
        return {
            ...normalized,
            id: normalized.id || `assembly:schedule-${index + 1}`,
            partIds,
            includedPartIds: partIds.filter(partId =>
                manifest.parts.find(part => part.id === partId)?.includeInFabrication !== false
            )
        };
    });

    return manifest;
}

export function createManifestFromCabinet(cabinet) {
    return createFabricationManifest(buildFabricationSourceFromCabinet(cabinet));
}

export function createPreflightResult({
    code,
    severity,
    partIds = [],
    parameter = null,
    operationId = null,
    location = null,
    message,
    correctiveAction = null,
    details = null
}) {
    if (!code || !PREFLIGHT_SEVERITIES.includes(severity) || !message) {
        throw new TypeError('PreflightResult requires a stable code, severity, and message.');
    }
    const normalizedPartIds = [...new Set((partIds || []).filter(Boolean))];
    const suffix = [normalizedPartIds.join(','), operationId || '', parameter || ''].filter(Boolean).join(':');
    return {
        id: suffix ? `${code}:${suffix}` : code,
        code,
        severity,
        partIds: normalizedPartIds,
        parameter,
        operationId,
        location: clonePlain(location),
        message,
        correctiveAction,
        details: clonePlain(details)
    };
}

function orientation(a, b, c) {
    return (b.xMm - a.xMm) * (c.yMm - a.yMm) - (b.yMm - a.yMm) * (c.xMm - a.xMm);
}

function onSegment(a, b, p) {
    return p.xMm >= Math.min(a.xMm, b.xMm) - EPSILON
        && p.xMm <= Math.max(a.xMm, b.xMm) + EPSILON
        && p.yMm >= Math.min(a.yMm, b.yMm) - EPSILON
        && p.yMm <= Math.max(a.yMm, b.yMm) + EPSILON
        && Math.abs(orientation(a, b, p)) <= EPSILON;
}

function segmentsIntersect(a, b, c, d) {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON))
        && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) {
        return true;
    }
    return (Math.abs(o1) <= EPSILON && onSegment(a, b, c))
        || (Math.abs(o2) <= EPSILON && onSegment(a, b, d))
        || (Math.abs(o3) <= EPSILON && onSegment(c, d, a))
        || (Math.abs(o4) <= EPSILON && onSegment(c, d, b));
}

function contourSelfIntersects(points = []) {
    if (points.length < 4) return false;
    for (let first = 0; first < points.length; first++) {
        const firstNext = (first + 1) % points.length;
        for (let second = first + 1; second < points.length; second++) {
            const secondNext = (second + 1) % points.length;
            if (first === second || firstNext === second || secondNext === first) continue;
            if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) return true;
        }
    }
    return false;
}

function pointInPolygon(testPoint, points = []) {
    let inside = false;
    for (let current = 0, previous = points.length - 1; current < points.length; previous = current++) {
        const a = points[current];
        const b = points[previous];
        if (onSegment(a, b, testPoint)) return true;
        const crosses = ((a.yMm > testPoint.yMm) !== (b.yMm > testPoint.yMm))
            && (testPoint.xMm < ((b.xMm - a.xMm) * (testPoint.yMm - a.yMm)) / ((b.yMm - a.yMm) || EPSILON) + a.xMm);
        if (crosses) inside = !inside;
    }
    return inside;
}

function pointSegmentDistance(testPoint, a, b) {
    const dx = b.xMm - a.xMm;
    const dy = b.yMm - a.yMm;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= EPSILON) return Math.hypot(testPoint.xMm - a.xMm, testPoint.yMm - a.yMm);
    const t = Math.max(0, Math.min(1, ((testPoint.xMm - a.xMm) * dx + (testPoint.yMm - a.yMm) * dy) / lengthSquared));
    return Math.hypot(testPoint.xMm - (a.xMm + t * dx), testPoint.yMm - (a.yMm + t * dy));
}

function pointContourDistance(testPoint, contour) {
    let distance = Infinity;
    for (let index = 0; index < contour.points.length; index++) {
        distance = Math.min(distance, pointSegmentDistance(
            testPoint,
            contour.points[index],
            contour.points[(index + 1) % contour.points.length]
        ));
    }
    return distance;
}

function operationCenterAndRadius(operation, contoursById) {
    if (operation.geometry?.kind === 'circle') {
        return {
            center: operation.geometry.center,
            radiusMm: finiteNumber(operation.geometry.radiusMm),
            bounds: {
                minX: operation.geometry.center.xMm - finiteNumber(operation.geometry.radiusMm),
                maxX: operation.geometry.center.xMm + finiteNumber(operation.geometry.radiusMm),
                minY: operation.geometry.center.yMm - finiteNumber(operation.geometry.radiusMm),
                maxY: operation.geometry.center.yMm + finiteNumber(operation.geometry.radiusMm)
            }
        };
    }
    if (operation.geometry?.kind === 'contour') {
        const contour = contoursById.get(operation.geometry.contourId);
        if (!contour) return null;
        const bounds = contourBounds(contour);
        return {
            center: point((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2),
            radiusMm: Math.hypot(bounds.widthMm, bounds.heightMm) / 2,
            bounds
        };
    }
    return null;
}

function operationCollisionEnvelope(operation, contoursById) {
    const geometry = operationCenterAndRadius(operation, contoursById);
    if (!geometry || operation.geometry?.kind !== 'circle') return geometry;
    const collisionDiameterMm = optionalPositiveNumber(operation.collisionDiameterMm);
    const radiusMm = Math.max(geometry.radiusMm, (collisionDiameterMm || 0) / 2);
    return {
        ...geometry,
        radiusMm,
        bounds: {
            minX: geometry.center.xMm - radiusMm,
            maxX: geometry.center.xMm + radiusMm,
            minY: geometry.center.yMm - radiusMm,
            maxY: geometry.center.yMm + radiusMm
        }
    };
}

function boundsGap(a, b) {
    const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
    const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
    return Math.hypot(dx, dy);
}

function operationInsideOuter(operation, outerContour, contoursById, requiredClearanceMm) {
    if (operation.geometry?.kind === 'circle') {
        const center = operation.geometry.center;
        const radius = finiteNumber(operation.geometry.radiusMm);
        return pointInPolygon(center, outerContour.points)
            && pointContourDistance(center, outerContour) - radius >= requiredClearanceMm - EPSILON;
    }
    if (operation.geometry?.kind === 'contour') {
        const contour = contoursById.get(operation.geometry.contourId);
        return Boolean(contour?.points?.length) && contour.points.every(item => (
            pointInPolygon(item, outerContour.points)
            && pointContourDistance(item, outerContour) >= requiredClearanceMm - EPSILON
        ));
    }
    return true;
}

function deduplicateResults(results) {
    const seen = new Set();
    return results.filter(result => {
        const key = `${result.code}|${result.severity}|${result.partIds.join(',')}|${result.operationId || ''}|${result.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Run deterministic manufacturing checks.  No renderer state is read here.
 */
export function runPreflight(manifest, options = {}) {
    const results = [];
    const add = input => results.push(createPreflightResult(input));
    const edgeClearanceMm = Math.max(0, finiteNumber(options.cutoutEdgeClearanceMm, 2));
    const cutoutSpacingMm = Math.max(0, finiteNumber(options.cutoutSpacingMm, 2));

    if (!manifest || manifest.schema !== FABRICATION_MANIFEST_SCHEMA || manifest.version !== FABRICATION_MANIFEST_VERSION) {
        add({
            code: 'MANIFEST_INVALID', severity: 'error',
            message: 'The fabrication manifest is missing or uses an unsupported schema version.',
            correctiveAction: 'Rebuild the cabinet with the current application before exporting.'
        });
        return results;
    }
    if (manifest.units !== 'mm') {
        add({
            code: 'INVALID_UNITS', severity: 'error',
            message: 'Fabrication geometry must use millimetres.',
            correctiveAction: 'Convert the manifest to millimetres before exporting.'
        });
    }

    const includedParts = (manifest.parts || []).filter(part => part.includeInFabrication !== false);
    if (!includedParts.length) {
        add({
            code: 'NO_FABRICATION_PARTS', severity: 'error',
            message: 'No parts are included in fabrication.',
            correctiveAction: 'Include at least one part in the fabrication package.'
        });
    }

    const contoursById = new Map((manifest.contours || []).map(item => [item.id, item]));
    const operationsById = new Map((manifest.operations || []).map(item => [item.id, item]));
    const materialsById = new Map((manifest.materials || []).map(item => [item.id, item]));
    const hardwareLibrary = normalizeHardwareLibrary(manifest.parameters?.hardwareDefinitions || []);
    const hardwareFindings = [
        ...(manifest.hardwareFindings || []),
        ...validateHardwareInstances(manifest.hardwareInstances || [], manifest.parts || [], hardwareLibrary)
    ];
    hardwareFindings.forEach(finding => add({
        code: finding.code,
        severity: finding.severity,
        partIds: finding.partIds || [],
        parameter: finding.parameter || ((finding.partIds || []).includes('panel_apron') ? 'controls.apron' : 'controls.deck'),
        operationId: finding.operationId || null,
        location: finding.location || null,
        message: finding.message,
        correctiveAction: finding.correctiveAction || finding.remedy || 'Review the selected hardware and its supplier drawing.',
        details: finding.details || null
    }));

    includedParts.forEach(part => {
        const dimensions = part.dimensions || {};
        if (![part.thicknessMm, dimensions.lengthMm, dimensions.widthMm].every(value => Number.isFinite(value) && value > EPSILON)) {
            add({
                code: 'PART_INVALID_DIMENSIONS', severity: 'error', partIds: [part.id],
                parameter: 'componentOverrides',
                message: `${part.name} has a zero, negative, or non-finite dimension.`,
                correctiveAction: 'Increase the panel dimensions or reset its component overrides.'
            });
        }

        const outerContour = (part.contourIds || [])
            .map(id => contoursById.get(id))
            .find(contour => contour?.role === 'outer');
        if (!outerContour) {
            add({
                code: 'CONTOUR_MISSING', severity: 'error', partIds: [part.id],
                message: `${part.name} has no outer profile contour.`,
                correctiveAction: 'Rebuild the part geometry before exporting.'
            });
        }

        (part.contourIds || []).forEach(contourId => {
            const contour = contoursById.get(contourId);
            if (!contour) return;
            if (contour.closed !== true) {
                add({
                    code: 'CONTOUR_OPEN', severity: 'error', partIds: [part.id],
                    operationId: contourId,
                    message: `${part.name} contains an open ${contour.role} contour.`,
                    correctiveAction: 'Close the contour before production export.'
                });
            }
            const hasFinitePolygon = contour.points.length >= 3
                && contour.points.every(item => Number.isFinite(item.xMm) && Number.isFinite(item.yMm));
            if (!hasFinitePolygon || polygonArea(contour.points) <= EPSILON) {
                add({
                    code: 'CONTOUR_INVALID', severity: 'error', partIds: [part.id],
                    operationId: contourId,
                    message: `${part.name} contains a degenerate or non-finite contour.`,
                    correctiveAction: 'Correct the responsible dimensions and rebuild the geometry.'
                });
            }
            // Check independently of signed/absolute area: a symmetric bow-tie
            // has zero shoelace area but must still receive the stable,
            // actionable self-intersection code.
            if (hasFinitePolygon && contourSelfIntersects(contour.points)) {
                add({
                    code: 'CONTOUR_SELF_INTERSECTION', severity: 'error', partIds: [part.id],
                    operationId: contourId,
                    message: `${part.name} contains a self-intersecting contour.`,
                    correctiveAction: 'Adjust the cabinet profile until the contour no longer crosses itself.'
                });
            }
        });

        const partOperations = (part.operationIds || []).map(id => operationsById.get(id)).filter(Boolean);
        const cuttingOperations = partOperations.filter(item => item.type === 'throughCut');
        cuttingOperations.forEach(operation => {
            if (outerContour && !operationInsideOuter(operation, outerContour, contoursById, edgeClearanceMm)) {
                add({
                    code: 'CUTOUT_EDGE_CLEARANCE', severity: 'error', partIds: [part.id],
                    operationId: operation.id, location: operationCenterAndRadius(operation, contoursById)?.center,
                    message: `${part.name} has a cutout outside the profile or within ${edgeClearanceMm} mm of an edge.`,
                    correctiveAction: 'Move or resize the cutout to restore edge clearance.'
                });
            }
        });

        for (let first = 0; first < cuttingOperations.length; first++) {
            for (let second = first + 1; second < cuttingOperations.length; second++) {
                const a = operationCenterAndRadius(cuttingOperations[first], contoursById);
                const b = operationCenterAndRadius(cuttingOperations[second], contoursById);
                if (!a || !b || boundsGap(a.bounds, b.bounds) >= cutoutSpacingMm - EPSILON) continue;
                add({
                    code: 'CUTOUT_COLLISION', severity: 'error', partIds: [part.id],
                    operationId: cuttingOperations[second].id,
                    location: point((a.center.xMm + b.center.xMm) / 2, (a.center.yMm + b.center.yMm) / 2),
                    message: `${part.name} has overlapping cutouts or less than ${cutoutSpacingMm} mm between them.`,
                    correctiveAction: 'Move the controls or cutouts farther apart.'
                });
            }
        }

        const drills = partOperations.filter(item => item.type === 'drill');
        drills.forEach(drill => {
            const drillGeometry = operationCollisionEnvelope(drill, contoursById);
            cuttingOperations.forEach(cutout => {
                const cutoutGeometry = operationCenterAndRadius(cutout, contoursById);
                if (!drillGeometry || !cutoutGeometry || boundsGap(drillGeometry.bounds, cutoutGeometry.bounds) > EPSILON) return;
                add({
                    code: 'SCREW_CUTOUT_CONFLICT', severity: 'error', partIds: [part.id],
                    operationId: drill.id, location: drillGeometry.center,
                    message: `${part.name} has a screw hole intersecting a cutout.`,
                    correctiveAction: 'Move the fastener or the cutout.'
                });
            });
        });

        const keepouts = (part.keepoutIds || [])
            .map(id => (manifest.keepouts || []).find(item => item.id === id))
            .filter(item => item && item.validationHandledByHardwareLibrary !== true);
        for (let first = 0; first < keepouts.length; first++) {
            for (let second = first + 1; second < keepouts.length; second++) {
                const a = keepouts[first];
                const b = keepouts[second];
                if (a.side !== b.side) continue;
                const centerDistance = Math.hypot(
                    a.center.xMm - b.center.xMm,
                    a.center.yMm - b.center.yMm
                );
                if (centerDistance + EPSILON >= finiteNumber(a.radiusMm) + finiteNumber(b.radiusMm)) continue;
                add({
                    code: 'HARDWARE_KEEPOUT_COLLISION', severity: 'error', partIds: [part.id],
                    operationId: b.hardwareOperationId,
                    location: point((a.center.xMm + b.center.xMm) / 2, (a.center.yMm + b.center.yMm) / 2),
                    message: `${part.name} has overlapping underside hardware keepouts.`,
                    correctiveAction: 'Move the controls apart or select hardware with smaller underside bodies.',
                    details: { keepoutIds: [a.id, b.id] }
                });
            }
        }

        const material = materialsById.get(part.materialId);
        if (!material) {
            add({
                code: 'MATERIAL_MISSING', severity: 'error', partIds: [part.id],
                message: `${part.name} refers to an unknown material profile.`,
                correctiveAction: 'Assign a valid material profile.'
            });
        } else {
            const stockWidthMm = finiteNumber(material.stock?.widthMm ?? material.sheetWidthMm);
            const stockHeightMm = finiteNumber(material.stock?.heightMm ?? material.sheetHeightMm);
            const allowedRotations = Array.isArray(material.allowedRotations)
                ? material.allowedRotations.map(value => ((finiteNumber(value) % 360) + 360) % 360)
                : null;
            const allowQuarterTurn = allowedRotations
                ? allowedRotations.some(value => value === 90 || value === 270)
                : material.stock?.allowRotation !== false;
            if (stockWidthMm <= EPSILON || stockHeightMm <= EPSILON) return;
            const fitsNormal = dimensions.widthMm <= stockWidthMm + EPSILON && dimensions.lengthMm <= stockHeightMm + EPSILON;
            const fitsRotated = allowQuarterTurn
                && dimensions.lengthMm <= stockWidthMm + EPSILON
                && dimensions.widthMm <= stockHeightMm + EPSILON;
            if (!fitsNormal && !fitsRotated) {
                add({
                    code: 'STOCK_BOUNDS_EXCEEDED', severity: 'error', partIds: [part.id],
                    parameter: 'materials',
                    message: `${part.name} does not fit the assigned stock size.`,
                    correctiveAction: 'Choose larger stock, allow rotation, or reduce the part size.'
                });
            }
        }
    });

    const referencesByPart = new Map();
    (manifest.operations || []).forEach(operation => {
        const part = manifest.parts.find(item => item.id === operation.partId);
        if (part?.includeInFabrication === false) return;
        const geometry = operation.geometry || {};
        const geometryValid = geometry.kind === 'contour'
            ? contoursById.has(geometry.contourId)
            : geometry.kind === 'circle'
                ? Number.isFinite(geometry.center?.xMm)
                    && Number.isFinite(geometry.center?.yMm)
                    && Number.isFinite(geometry.radiusMm)
                    && geometry.radiusMm > EPSILON
                : geometry.kind === 'rect'
                    ? Number.isFinite(geometry.center?.xMm ?? geometry.xMm)
                        && Number.isFinite(geometry.center?.yMm ?? geometry.yMm)
                        && Number.isFinite(geometry.widthMm)
                        && Number.isFinite(geometry.heightMm)
                        && geometry.widthMm > EPSILON
                        && geometry.heightMm > EPSILON
                : geometry.kind === 'line'
                    ? [geometry.start?.xMm, geometry.start?.yMm, geometry.end?.xMm, geometry.end?.yMm].every(Number.isFinite)
                    : false;
        if (!geometryValid) {
            add({
                code: 'OPERATION_GEOMETRY_INVALID', severity: 'error', partIds: [operation.partId],
                operationId: operation.id,
                message: `Operation ${operation.id} has missing, degenerate, or non-finite geometry.`,
                correctiveAction: 'Correct the operation geometry before export.'
            });
        }
        if (!OPERATION_TYPES.includes(operation.type)) {
            add({
                code: 'UNSUPPORTED_OPERATION', severity: 'error', partIds: [operation.partId],
                operationId: operation.id,
                message: `Operation ${operation.id} uses unsupported type “${operation.type}”.`,
                correctiveAction: `Use one of: ${OPERATION_TYPES.join(', ')}.`
            });
        } else if (operation.type === 'reference') {
            if (!referencesByPart.has(operation.partId)) referencesByPart.set(operation.partId, []);
            referencesByPart.get(operation.partId).push(operation.id);
        } else if (!MACHINE_OPERATION_TYPES.has(operation.type)) {
            add({
                code: 'UNSUPPORTED_OPERATION', severity: 'error', partIds: [operation.partId],
                operationId: operation.id,
                message: `Operation ${operation.id} cannot be represented in the production SVG.`,
                correctiveAction: 'Remove or convert the operation before export.'
            });
        }
    });
    if (referencesByPart.size) {
        const partIds = [...referencesByPart.keys()];
        const operationIds = [...referencesByPart.values()].flat();
        add({
            code: 'REFERENCE_OPERATION_OMITTED', severity: 'info', partIds,
            operationId: operationIds[0],
            message: `${operationIds.length} reference operation${operationIds.length === 1 ? '' : 's'} across ${partIds.length} part${partIds.length === 1 ? '' : 's'} will be kept in the annotated draft and omitted from machine files as intended.`,
            correctiveAction: 'Use the annotated draft when you need labels, guides, or other reference marks.',
            details: { operationIds }
        });
    }

    (manifest.layoutFitSuggestions || []).forEach(suggestion => {
        const part = manifest.parts.find(item => item.id === suggestion.partId);
        if (part?.includeInFabrication === false) return;
        add({
            code: 'LAYOUT_DOES_NOT_FIT', severity: 'error', partIds: [suggestion.partId],
            parameter: `controls.${suggestion.controlPath || 'deck'}`,
            location: suggestion.location || null,
            message: `${part?.name || suggestion.partId} control layout does not fit the usable panel area.`,
            correctiveAction: 'Apply the fitted suggestion or reduce control spacing/count before production export.',
            details: { suggestionId: suggestion.id, suggestion }
        });
    });

    (manifest.sourceDiagnostics?.invalidIntersections || []).forEach(collision => {
        const affectedPartIds = collision.partIds || collision.panels || [];
        if (affectedPartIds.some(partId => manifest.parts.find(item => item.id === partId)?.includeInFabrication === false)) return;
        add({
            code: 'STRUCTURAL_PANEL_COLLISION', severity: 'error',
            partIds: affectedPartIds,
            location: collision.location || collision.center || null,
            message: collision.message || 'Structural panels intersect.',
            correctiveAction: 'Adjust the responsible panel position, length, or thickness.',
            details: { penetrationMm: collision.penetrationMm }
        });
    });

    (manifest.sourceDiagnostics?.fastenerIssues || []).forEach(issue => {
        const affectedPartIds = issue.partIds || issue.panels || [];
        if (affectedPartIds.some(partId => manifest.parts.find(item => item.id === partId)?.includeInFabrication === false)) return;
        add({
            code: 'FASTENER_CONFLICT', severity: 'error',
            partIds: affectedPartIds,
            location: issue.location || issue.center || null,
            message: issue.message || 'A fastener violates the fabrication rules.',
            correctiveAction: 'Adjust the screw specification or panel geometry.',
            details: { fastenerIds: issue.fastenerIds || issue.fasteners || [] }
        });
    });

    (manifest.sourceDiagnostics?.profileIssues || []).forEach(issue => {
        const affectedPartIds = issue.partIds || [];
        if (affectedPartIds.some(partId => manifest.parts.find(item => item.id === partId)?.includeInFabrication === false)) return;
        add({
            code: issue.code || 'SIDE_PROFILE_INVALID',
            severity: 'error',
            partIds: affectedPartIds,
            parameter: 'sideProfileCustomization',
            location: issue.location || null,
            message: issue.message || 'A decorative side profile is invalid.',
            correctiveAction: issue.correctiveAction || 'Repair or reset the decorative side profile before production export.',
            details: issue.details || null
        });
    });

    (manifest.joints || []).forEach(joint => {
        if (joint.partIds.some(partId => manifest.parts.find(item => item.id === partId)?.includeInFabrication === false)) return;
        if (joint.type === 'butt seam' || joint.type === 'butt') return;
        if (!Number.isFinite(joint.includedAngleDeg) || joint.includedAngleDeg <= EPSILON || joint.includedAngleDeg >= 180 - EPSILON) {
            add({
                code: 'JOINT_ANGLE_INVALID', severity: 'error', partIds: joint.partIds,
                location: joint.location,
                message: `Joint ${joint.pointName || joint.id} has an invalid included angle.`,
                correctiveAction: 'Adjust the profile so the joined panels meet at a valid angle.'
            });
            return;
        }
        const bevelTotal = (joint.cuts || []).reduce((sum, cut) => sum + finiteNumber(cut.bevelAngleDeg), 0);
        if ((joint.cuts || []).length >= 2 && Math.abs(bevelTotal - joint.includedAngleDeg) > 0.25) {
            add({
                code: 'JOINT_BEVEL_MISMATCH', severity: 'error', partIds: joint.partIds,
                location: joint.location,
                message: `Joint ${joint.pointName || joint.id} bevels total ${bevelTotal.toFixed(2)}°, not the ${joint.includedAngleDeg.toFixed(2)}° included angle.`,
                correctiveAction: 'Rebuild the joint from the exact panel thicknesses before export.',
                details: { includedAngleDeg: joint.includedAngleDeg, bevelTotalDeg: bevelTotal }
            });
        }
    });

    return deduplicateResults(results);
}

export function summarizePreflight(results = []) {
    const summary = { errors: 0, warnings: 0, info: 0, canExportProduction: true };
    (results || []).forEach(result => {
        if (result.severity === 'error') summary.errors++;
        else if (result.severity === 'warning') summary.warnings++;
        else summary.info++;
    });
    summary.canExportProduction = summary.errors === 0;
    summary.requiresWarningAcknowledgement = summary.warnings > 0;
    return summary;
}

export function getLayoutFitSuggestion(manifest, partId = null) {
    return (manifest?.layoutFitSuggestions || []).find(item => !partId || item.partId === partId) || null;
}

export const geometryInternals = Object.freeze({
    polygonArea,
    contourBounds,
    contourSelfIntersects,
    pointInPolygon
});
