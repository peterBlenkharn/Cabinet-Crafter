import { createFabricationManifest } from '../../wwwroot/js/fabrication.js';

export function createSourceFixture(preset = 'standard') {
    const isBarTop = preset === 'barstool' || preset === 'bar-top';
    const sideWidth = isBarTop ? 500 : 600;
    const sideLength = isBarTop ? 650 : 1000;
    const controlWidth = isBarTop ? 550 : 650;
    const controlLength = isBarTop ? 260 : 300;
    const backLength = isBarTop ? 500 : 800;
    const projectName = isBarTop ? 'Golden Bar-top' : 'Golden Standard';

    const sideProfile = [
        { x: 0, y: 0 },
        { x: sideWidth, y: 0 },
        { x: sideWidth, y: sideLength * 0.5 },
        { x: sideWidth - (isBarTop ? 60 : 100), y: sideLength },
        { x: 0, y: sideLength }
    ];

    return {
        project: { name: projectName, presetId: isBarTop ? 'barstool' : 'standard' },
        params: {
            presetId: isBarTop ? 'barstool' : 'standard',
            width: controlWidth,
            height: sideLength,
            depth: sideWidth,
            thickness: 18,
            cpHeight: isBarTop ? 430 : 950,
            cpDepth: controlLength,
            screenHeight: isBarTop ? 220 : 270,
            screenWidth: isBarTop ? 400 : 470,
            monitorAngle: 15
        },
        materials: [{
            id: 'mdf-18',
            name: 'MDF 18 mm',
            nominalThicknessMm: 18,
            measuredThicknessMm: 18,
            sheetWidthMm: 2440,
            sheetHeightMm: 1220,
            stock: { widthMm: 2440, heightMm: 1220, allowRotation: true },
            grainDirection: 'none',
            densityKgM3: 750,
            pricePerSheet: 42,
            trimMarginMm: 12,
            partSpacingMm: 8,
            allowedRotations: [0, 90, 180, 270]
        }],
        parts: [
            {
                id: 'side_left', name: 'Left side', role: 'side', exportType: 'profile',
                lengthMm: sideLength, widthMm: sideWidth, thicknessMm: 18,
                materialId: 'mdf-18', profilePoints: sideProfile,
                includeInFabrication: true, viewportVisible: true, acceptsArtwork: true
            },
            {
                id: 'side_right', name: 'Right side', role: 'side', exportType: 'profile',
                lengthMm: sideLength, widthMm: sideWidth, thicknessMm: 18,
                materialId: 'mdf-18', profilePoints: sideProfile,
                includeInFabrication: true, viewportVisible: false, acceptsArtwork: true
            },
            {
                id: 'panel_cp', name: 'Control panel', role: 'control', exportType: 'rectangle',
                lengthMm: controlLength, widthMm: controlWidth, thicknessMm: 18,
                materialId: 'mdf-18', includeInFabrication: true, viewportVisible: true,
                hardware: [{ kind: 'button', label: 'P1 Start', xMm: controlLength / 2, yMm: controlWidth / 2, radiusMm: 15, keepoutRadiusMm: 22, keepoutDepthMm: 48 }],
                fasteners: [{ id: 'cp-fastener-1', xMm: 40, yMm: 40, diameterMm: 3, lengthMm: 35, targetPanelId: 'side_left' }],
                finishedFace: 'front', grainDirection: 'none', acceptsArtwork: true
            },
            {
                id: 'panel_back', name: 'Back panel', role: 'back', exportType: 'rectangle',
                lengthMm: backLength, widthMm: sideWidth, thicknessMm: 18,
                materialId: 'mdf-18', includeInFabrication: true, viewportVisible: true
            }
        ],
        joints: [{
            id: 'joint-cp-left', pointName: 'control-front', type: 'mitre',
            partIds: ['side_left', 'panel_cp'], includedAngleDeg: 90,
            cuts: [
                { partId: 'side_left', bevelAngleDeg: 45, longFace: 'outside' },
                { partId: 'panel_cp', bevelAngleDeg: 45, longFace: 'top' }
            ],
            location: { xMm: 0, yMm: isBarTop ? 430 : 950 }
        }],
        invalidIntersections: [],
        fastenerIssues: [],
        sourceWarnings: []
    };
}

export function createManifestFixture(preset = 'standard') {
    return createFabricationManifest(createSourceFixture(preset));
}

export function snapshotManifest(manifest) {
    return {
        schema: manifest.schema,
        version: manifest.version,
        units: manifest.units,
        project: manifest.project,
        counts: {
            materials: manifest.materials.length,
            parts: manifest.parts.length,
            contours: manifest.contours.length,
            operations: manifest.operations.length,
            joints: manifest.joints.length,
            fasteners: manifest.fasteners.length,
            keepouts: manifest.keepouts.length
        },
        parts: manifest.parts.map(part => ({
            id: part.id,
            quantity: part.quantity,
            thicknessMm: part.thicknessMm,
            dimensions: part.dimensions,
            included: part.includeInFabrication,
            viewportVisible: part.viewportVisible,
            operationCount: part.operationIds.length
        })),
        joints: manifest.joints.map(joint => ({
            id: joint.id,
            includedAngleDeg: joint.includedAngleDeg,
            bevelAnglesDeg: joint.cuts.map(cut => cut.bevelAngleDeg)
        }))
    };
}

export function rectanglePart(id, widthMm, lengthMm, materialId = 'mdf-18', extra = {}) {
    return {
        id,
        name: extra.name || id,
        quantity: extra.quantity || 1,
        materialId,
        thicknessMm: extra.thicknessMm || 18,
        dimensions: { widthMm, lengthMm },
        widthMm,
        lengthMm,
        areaMm2: widthMm * lengthMm,
        includeInFabrication: extra.includeInFabrication !== false,
        viewportVisible: extra.viewportVisible !== false,
        contourIds: [],
        operationIds: [],
        jointIds: [],
        fastenerIds: [],
        keepoutIds: [],
        outline: {
            points: [
                { x: 0, y: 0 }, { x: widthMm, y: 0 },
                { x: widthMm, y: lengthMm }, { x: 0, y: lengthMm }
            ]
        },
        ...extra
    };
}

export function readStoredZipEntries(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();
    const entries = new Map();
    let offset = 0;
    while (offset + 4 <= data.length && view.getUint32(offset, true) === 0x04034b50) {
        const method = view.getUint16(offset + 8, true);
        const compressedSize = view.getUint32(offset + 18, true);
        const nameLength = view.getUint16(offset + 26, true);
        const extraLength = view.getUint16(offset + 28, true);
        const nameStart = offset + 30;
        const contentStart = nameStart + nameLength + extraLength;
        const path = decoder.decode(data.subarray(nameStart, nameStart + nameLength));
        if (method !== 0) throw new Error(`Expected stored ZIP entry for ${path}.`);
        entries.set(path, data.slice(contentStart, contentStart + compressedSize));
        offset = contentStart + compressedSize;
    }
    return entries;
}
