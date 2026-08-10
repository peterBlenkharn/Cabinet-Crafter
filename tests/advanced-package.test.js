import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildManufacturingPackage,
    serializeSheetDxf,
    serializeSheetMachineSvg
} from '../wwwroot/js/manufacturing-pack.js';
import { buildFabricationExport, exportDraftSVG, exportFabricationPackage } from '../wwwroot/js/export.js';
import { DEFAULT_PROCESS_PROFILES } from '../wwwroot/js/joinery.js';
import { createArtworkTemplate, serializeArtworkCutMaskSvg } from '../wwwroot/js/artwork-production.js';
import { enrichManifestPart } from '../wwwroot/js/manifest-utils.js';
import { DEFAULT_MATERIAL_PROFILES } from '../wwwroot/js/materials.js';
import { createNestingPlan, transformPartPoint } from '../wwwroot/js/nesting.js';
import { createManifestFixture } from './helpers/fixtures.js';

const FIXED_TIME = '2026-07-17T12:00:00.000Z';

function textEntry(result, path) {
    const entry = result.entries.find(item => item.path === path);
    assert.ok(entry, `missing ${path}`);
    return String(entry.data);
}

function bounds(points) {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function dxfHandle(value) {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16).toUpperCase();
}

function assertBoundsClose(actual, expected, tolerance = 0.001) {
    ['minX', 'minY', 'maxX', 'maxY'].forEach(key => assert.ok(
        Math.abs(actual[key] - expected[key]) <= tolerance,
        `${key}: expected ${expected[key]}, received ${actual[key]}`
    ));
}

function dxfEntityPoints(dxf, physicalId) {
    const marker = `5\n${dxfHandle(physicalId)}\n`;
    const start = dxf.indexOf(marker);
    assert.ok(start >= 0, `missing DXF entity ${physicalId}`);
    const tail = dxf.slice(start + marker.length);
    const end = tail.indexOf('\n0\n');
    const entity = end >= 0 ? tail.slice(0, end) : tail;
    return [...entity.matchAll(/10\n([^\n]+)\n20\n([^\n]+)\n/g)]
        .map(match => ({ x: Number(match[1]), y: -Number(match[2]) }));
}

test('default package retains nominal machine paths and records disabled optional features', () => {
    const result = buildManufacturingPackage(createManifestFixture(), [], { generatedAt: FIXED_TIME });
    const metadata = JSON.parse(textEntry(result, 'manifest/package-manifest.json'));
    const paths = result.entries.map(item => item.path);

    assert.equal(metadata.schema, 'CabinetCrafter.FabricationPackageManifestV1');
    assert.equal(metadata.generatedAt, FIXED_TIME);
    assert.equal(metadata.nominalSource, 'manifest/fabrication-manifest.json');
    assert.equal(metadata.features.joinery.enabled, false);
    assert.equal(metadata.features.process.enabled, false);
    assert.equal(metadata.features.process.id, 'nominal');
    assert.equal(metadata.features.process.nominalFilesRetained, true);
    assert.equal(metadata.features.artwork.enabled, false);
    assert.equal(metadata.features.workshop.enabled, false);
    assert.equal(metadata.features.quote.enabled, false);
    assert.equal(metadata.safety.containsGCode, false);
    assert.equal(paths.some(path => path.startsWith('machine/derived/')), false);
    assert.equal(paths.some(path => path.startsWith('artwork/')), false);
    assert.ok(paths.some(path => /^machine\/mdf-18\/sheet-\d\d\.svg$/.test(path)));
});

test('fixed generation time makes the default package byte deterministic', () => {
    const first = buildManufacturingPackage(createManifestFixture(), [], { generatedAt: FIXED_TIME });
    const second = buildManufacturingPackage(createManifestFixture(), [], { generatedAt: FIXED_TIME });
    assert.deepEqual(first.zipBytes, second.zipBytes);
});

test('package strips editor-only nesting candidates while preserving selected geometry', () => {
    const manifest = createManifestFixture();
    const interactivePlan = createNestingPlan(manifest, manifest.materials, { includeCandidates: true });
    const selectedGeometry = interactivePlan.sheets.map(sheet => sheet.placements.map(placement => [
        placement.instanceId,
        placement.xMm,
        placement.yMm,
        placement.rotationDeg
    ]));
    const result = buildManufacturingPackage(manifest, [], {
        generatedAt: FIXED_TIME,
        nestingPlan: interactivePlan
    });
    assert.ok(interactivePlan.candidates.length > 1);
    assert.equal(result.nesting.candidates, undefined);
    assert.equal(JSON.parse(textEntry(result, 'manifest/nesting-plan.json')).candidates, undefined);
    assert.deepEqual(
        result.nesting.sheets.map(sheet => sheet.placements.map(placement => [
            placement.instanceId,
            placement.xMm,
            placement.yMm,
            placement.rotationDeg
        ])),
        selectedGeometry
    );
});

test('advanced package keeps nominal sources while adding derived process, artwork, batch, quote, and variants', () => {
    const manifest = createManifestFixture();
    manifest.joints[0].edgeGeometry = { start: { x: 10, y: 20 }, end: { x: 310, y: 20 } };
    const result = buildManufacturingPackage(manifest, [], {
        generatedAt: FIXED_TIME,
        joineryAssignments: {
            'joint-cp-left': { strategy: 'dado', hostPartId: 'panel_cp', clearanceMm: 0.25 }
        },
        processProfile: { ...DEFAULT_PROCESS_PROFILES.laser, kerfMm: 0.24 },
        artworkTemplates: [{ partId: 'panel_cp', bleedMm: 10, safeMarginMm: 12 }],
        workshopProfile: { id: 'maker-space', name: 'Maker Space', defaultBatchQuantity: 2 },
        batchQuantity: 2,
        quote: { quoteNumber: 'CC-ADVANCED-001', labourHoursPerCabinet: 2, machineHoursPerCabinet: 1 },
        designVariants: [{ id: 'standard', name: 'Standard', notes: 'Active production variant' }],
        activeVariantId: 'standard'
    });
    const paths = new Set(result.entries.map(item => item.path));
    const metadata = JSON.parse(textEntry(result, 'manifest/package-manifest.json'));
    const sourceManifest = JSON.parse(textEntry(result, 'manifest/fabrication-manifest.json'));
    const nominalManifest = JSON.parse(textEntry(result, 'manifest/nominal-joinery-manifest.json'));
    const processManifest = JSON.parse(textEntry(result, 'manifest/process/laser-generic.json'));

    assert.equal(sourceManifest.joinery, undefined);
    assert.equal(nominalManifest.joinery.version, 1);
    assert.ok(nominalManifest.operations.some(operation => operation.id === 'joint-cp-left:dado:pocket'));
    assert.equal(processManifest.processProfile.kind, 'laser');
    assert.ok(processManifest.operations.some(operation => operation.process?.vectorCompensated));
    assert.equal(metadata.nominalSource, 'manifest/nominal-joinery-manifest.json');
    assert.equal(metadata.features.process.directory, 'machine/derived/laser-generic/');
    assert.equal(metadata.features.artwork.templateCount, 1);
    assert.equal(metadata.features.workshop.profileId, 'maker-space');
    assert.equal(metadata.features.quote.quoteNumber, 'CC-ADVANCED-001');
    assert.equal(metadata.features.designVariants.activeVariantId, 'standard');
    assert.equal(metadata.safety.derivedProcessFilesNeverReplaceNominal, true);

    assert.ok([...paths].some(path => /^machine\/mdf-18\/sheet-\d\d\.svg$/.test(path)));
    assert.ok([...paths].some(path => /^machine\/derived\/laser-generic\/mdf-18\/sheet-\d\d\.svg$/.test(path)));
    assert.ok(paths.has('artwork/templates/panel-cp-control-overlay.svg'));
    assert.ok(paths.has('artwork/masks/panel-cp-control-overlay-cut-mask.svg'));
    const artworkMask = textEntry(result, 'artwork/masks/panel-cp-control-overlay-cut-mask.svg');
    assert.match(artworkMask, /width="670mm" height="320mm"/);
    assert.match(artworkMask, /data-scale="1:1" data-units="mm"/);
    assert.doesNotMatch(artworkMask, /<text\b|<image\b/);
    assert.ok(paths.has('manifest/batch-plan.json'));
    assert.ok(paths.has('manifest/workshop-profile.json'));
    assert.ok(paths.has('manifest/design-variants.json'));
    assert.ok(paths.has('reports/quote.csv'));
    assert.ok(paths.has('reports/quote.json'));
    assert.equal([...paths].some(path => /\.(?:gcode|nc|tap)$/i.test(path)), false);

    const nominalMachine = textEntry(result, [...paths].find(path => /^machine\/mdf-18\/sheet-\d\d\.svg$/.test(path)));
    const derivedMachine = textEntry(result, [...paths].find(path => /^machine\/derived\/laser-generic\/mdf-18\/sheet-\d\d\.svg$/.test(path)));
    assert.doesNotMatch(nominalMachine, /data-derived="true"/);
    assert.match(derivedMachine, /data-process-profile="laser-generic" data-derived="true"/);
    const sideSheet = result.nesting.sheets.find(sheet => sheet.placements.some(placement => placement.instanceId === 'side_left:1'));
    const sheetName = `sheet-${String(sideSheet.index).padStart(2, '0')}`;
    const sideOperationId = 'side_left-outer-profileCut--side_left-1';
    const nominalSideSvg = textEntry(result, `machine/${sideSheet.materialId}/${sheetName}.svg`);
    const derivedSideSvg = textEntry(result, `machine/derived/laser-generic/${sideSheet.materialId}/${sheetName}.svg`);
    const nominalSidePoints = nominalSideSvg.match(new RegExp(`<polygon id="${sideOperationId}" points="([^"]+)"`))?.[1];
    const derivedSidePoints = derivedSideSvg.match(new RegExp(`<polygon id="${sideOperationId}" points="([^"]+)"`))?.[1];
    assert.ok(nominalSidePoints && derivedSidePoints);
    assert.notEqual(derivedSidePoints, nominalSidePoints, 'laser SVG must serialize compensated contour points');
    const nominalSideDxf = textEntry(result, `machine/${sideSheet.materialId}/${sheetName}.dxf`);
    const derivedSideDxf = textEntry(result, `machine/derived/laser-generic/${sideSheet.materialId}/${sheetName}.dxf`);
    assert.notDeepEqual(dxfEntityPoints(derivedSideDxf, sideOperationId), dxfEntityPoints(nominalSideDxf, sideOperationId));
    assert.equal(result.summary.batchQuantity, 2);
    assert.equal(result.summary.parts, 8);
    assert.equal(result.nesting.sheets.flatMap(sheet => sheet.placements).length, 8);
    assert.match(textEntry(result, 'reports/bom.csv'), /side_left,Left side,2,/);
    assert.match(textEntry(result, 'assembly/part-labels.svg'), /side_left:cabinet-2:piece-1/);
    assert.equal(JSON.parse(textEntry(result, 'reports/quote.json')).generatedAt, FIXED_TIME);
});

test('optional artwork errors and joinery warnings use the production gate', () => {
    assert.throws(
        () => buildManufacturingPackage(createManifestFixture(), [], { artworkTemplates: ['missing-part'] }),
        error => error.code === 'PREFLIGHT_BLOCKED' && error.preflightResults.some(item => item.code === 'ARTWORK_PART_NOT_FOUND')
    );

    assert.throws(
        () => buildManufacturingPackage(createManifestFixture(), [], {
            joineryAssignments: { 'joint-cp-left': { strategy: 'dado', hostPartId: 'panel_cp' } }
        }),
        error => error.code === 'WARNING_ACKNOWLEDGEMENT_REQUIRED' && error.preflightResults.some(item => item.code === 'JOINERY_EDGE_GEOMETRY_MISSING')
    );
});

test('arcade relationship findings are reported as advisory without becoming production gates', () => {
    const advisory = {
        code: 'CONTROL_PLAYER_SPACING', severity: 'warning', partIds: ['panel_cp'],
        message: 'Players are close together.', remedy: 'Review the control spacing.'
    };
    const result = buildManufacturingPackage(createManifestFixture(), [], {
        generatedAt: FIXED_TIME,
        arcadeIntelligence: {
            findings: [advisory],
            hardwareSchedule: [], wiring: { connections: [] },
            ergonomics: { profiles: [] }, tMoulding: { records: [] }
        }
    });
    assert.equal(result.summary.warnings, 0);
    assert.equal(result.packageManifest.findings.advisoryArcadeIntelligence.warnings, 1);
    assert.match(textEntry(result, 'reports/preflight-report.html'), /Arcade build intelligence \(advisory\)/);
    assert.match(textEntry(result, 'reports/preflight-report.html'), /CONTROL_PLAYER_SPACING/);
});

test('drill operations generate annotated explicit-mm full-size shop templates', () => {
    const result = buildManufacturingPackage(createManifestFixture(), [], { generatedAt: FIXED_TIME });
    const template = textEntry(result, 'assembly/templates/panel-cp-drilling.svg');
    assert.match(template, /width="690mm" height="340mm"/);
    assert.match(template, /data-scale="1:1" data-units="mm"/);
    assert.match(template, /PRINT AT 100% \/ 1:1/);
    assert.match(template, />100 mm</);
    assert.match(template, /<circle\b/);
    assert.match(template, /<text\b/);
});

test('fabrication export forwards persisted advanced settings through a safe whitelist', async () => {
    const manifest = createManifestFixture();
    manifest.joints[0].edgeGeometry = { start: { x: 10, y: 20 }, end: { x: 310, y: 20 } };
    manifest.parameters.fabricationSettings = {
        joineryAssignments: { 'joint-cp-left': { strategy: 'dado', hostPartId: 'panel_cp' } },
        processProfile: { ...DEFAULT_PROCESS_PROFILES.laser, kerfMm: 0.18 },
        artworkTemplates: [{ partId: 'panel_cp' }],
        workshopProfile: { id: 'saved-shop', name: 'Saved Shop' },
        batchQuantity: 2,
        currencyCode: 'GBP',
        hardwareCosts: { 'button-30-snap': { unitPrice: 2.5, supplier: 'Arcade Parts' } },
        additionalHardware: [{ id: 'mini-pc-line', definitionId: 'mini-pc-180', name: 'Mini PC', category: 'electronics', quantity: 1, unitPrice: 120 }],
        quote: { quoteNumber: 'CC-SAVED-001' },
        designVariants: [{ id: 'saved-variant', name: 'Saved variant' }],
        activeVariantId: 'saved-variant',
        acknowledgeWarnings: true
    };

    const staleSingleCabinetNesting = buildManufacturingPackage(createManifestFixture(), [], { generatedAt: FIXED_TIME }).nesting;
    const artifact = await exportFabricationPackage(manifest, {
        download: false,
        generatedAt: FIXED_TIME,
        nestingPlan: staleSingleCabinetNesting
    });
    assert.equal(artifact.ok, true);
    assert.equal(artifact.package.packageManifest.features.joinery.enabled, true);
    assert.equal(artifact.package.packageManifest.features.process.id, 'laser-generic');
    assert.equal(artifact.package.packageManifest.features.artwork.templateCount, 1);
    assert.equal(artifact.package.packageManifest.features.workshop.profileId, 'saved-shop');
    assert.equal(artifact.package.packageManifest.features.quote.quoteNumber, 'CC-SAVED-001');
    assert.equal(artifact.package.packageManifest.features.designVariants.activeVariantId, 'saved-variant');
    assert.equal(artifact.package.packageManifest.features.batch.nestingPlanRegenerated, true);
    assert.equal(artifact.package.summary.batchQuantity, 2);
    assert.equal(artifact.package.nesting.sheets.flatMap(sheet => sheet.placements).length, 8);
    assert.equal(artifact.package.hardwareSchedule.find(item => item.name === 'Mini PC').quantity, 2);
    assert.ok(artifact.package.procurementBom.summary.hardwareCost >= 240);
    assert.match(textEntry(artifact.package, 'reports/total-bom.csv'), /Mini PC,2,each,120,240,GBP/);

    const warning = { code: 'SAVED_WARNING', severity: 'warning', partIds: [], message: 'Review this.' };
    const blocked = await exportFabricationPackage(manifest, { download: false, preflight: [warning] });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'warning_acknowledgement_required');
});

test('computed preflight cannot be replaced by an empty supplied list and draft status stays honest', () => {
    const manifest = createManifestFixture();
    manifest.contours[0].closed = false;

    const production = buildFabricationExport(manifest, { preflight: [] });
    assert.equal(production.ok, false);
    assert.equal(production.reason, 'preflight_errors');
    assert.ok(production.preflight.some(item => item.severity === 'error'));

    const draft = exportDraftSVG(manifest, { preflight: [], download: false });
    assert.equal(draft.ok, true);
    assert.ok(draft.preflight.some(item => item.severity === 'error'));
    assert.match(draft.content, /DRAFT \/ NON-PRODUCTION/);
    assert.match(draft.content, /Preflight: [1-9]\d* errors/);
});

test('supplied nesting findings are recomputed so overlap and stock-bound bypasses fail closed', () => {
    const manifest = createManifestFixture();
    const clean = buildManufacturingPackage(manifest, [], { generatedAt: FIXED_TIME });
    const overlap = structuredClone(clean.nesting);
    const sheet = overlap.sheets.find(item => item.placements.length >= 2);
    assert.ok(sheet);
    sheet.placements[1].polygon = structuredClone(sheet.placements[0].polygon);
    sheet.placements[1].bounds = structuredClone(sheet.placements[0].bounds);
    overlap.findings = [];
    assert.throws(
        () => buildManufacturingPackage(manifest, [], { nestingPlan: overlap }),
        error => error.code === 'NESTING_BLOCKED' && error.preflightResults.some(item => item.code === 'NEST_PART_OVERLAP')
    );

    const outOfBounds = structuredClone(clean.nesting);
    outOfBounds.sheets[0].placements[0].polygon = outOfBounds.sheets[0].placements[0].polygon.map(point => ({ ...point, x: point.x - 100 }));
    outOfBounds.findings = [];
    assert.throws(
        () => buildManufacturingPackage(manifest, [], { nestingPlan: outOfBounds }),
        error => error.code === 'NESTING_BLOCKED' && error.preflightResults.some(item => item.code === 'NEST_OUT_OF_BOUNDS')
    );
});

test('direct material assignments reconcile nesting, BOM, package metadata, and labels', () => {
    const materials = DEFAULT_MATERIAL_PROFILES.map(profile => ({ ...profile }));
    const result = buildManufacturingPackage(createManifestFixture(), [], {
        generatedAt: FIXED_TIME,
        materials,
        materialAssignments: { side_left: 'birch-plywood-18' }
    });
    assert.equal(result.packageManifest.features.materialAssignments.count, 1);
    assert.ok(result.entries.some(entry => entry.path.startsWith('machine/birch-plywood-18/')));
    assert.match(textEntry(result, 'reports/bom.csv'), /side_left,Left side,1,Birch plywood 18 mm,18/);
    assert.match(textEntry(result, 'assembly/part-labels.svg'), /Birch plywood 18 mm/);
    assert.equal(JSON.parse(textEntry(result, 'manifest/material-assignments.json')).side_left, 'birch-plywood-18');
});

test('artwork cut masks preserve exact manifest circle centres, radii, and contour points', () => {
    const manifest = createManifestFixture();
    const template = createArtworkTemplate(enrichManifestPart(manifest, 'panel_cp'));
    const button = template.cutouts.find(item => item.id.startsWith('panel_cp:hardware-button-1'));
    const drill = template.cutouts.find(item => item.id === 'panel_cp:drill-cp-fastener-1');
    assert.deepEqual(button.geometry, { kind: 'circle', xMm: 325, yMm: 150, radiusMm: 15, diameterMm: 30 });
    assert.deepEqual(drill.geometry, { kind: 'circle', xMm: 40, yMm: 40, radiusMm: 1.5, diameterMm: 3 });
    const mask = serializeArtworkCutMaskSvg(template);
    assert.match(mask, /data-operation="throughCut" cx="325" cy="150" r="15"/);
    assert.match(mask, /data-operation="drill" cx="40" cy="40" r="1\.5"/);

    const contourTemplate = createArtworkTemplate({
        id: 'panel-test', name: 'Contour test',
        outline: { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }] },
        contours: [{
            id: 'slot-contour',
            points: [{ xMm: 50, yMm: 60 }, { xMm: 90, yMm: 60 }, { xMm: 90, yMm: 80 }, { xMm: 50, yMm: 80 }]
        }],
        operations: [{ id: 'slot', type: 'throughCut', geometry: { kind: 'contour', contourId: 'slot-contour' } }]
    });
    assert.match(serializeArtworkCutMaskSvg(contourTemplate), /data-operation="throughCut" d="M 50 60 L 90 60 L 90 80 L 50 80 Z"/);
});

test('serialized operation bounds exactly match normalized nesting placements at every quarter turn', () => {
    const manifest = createManifestFixture();
    manifest.parts.forEach(part => { part.includeInFabrication = part.id === 'side_left'; });
    const material = { ...manifest.materials[0], allowedRotations: [0, 90, 180, 270] };
    const physicalId = 'side_left-outer-profileCut--side_left-1';

    [0, 90, 180, 270].forEach(rotationDeg => {
        const plan = createNestingPlan(manifest, [material], {
            pinnedPlacements: [{ instanceId: 'side_left:1', sheetIndex: 1, xMm: 100, yMm: 80, rotationDeg }]
        });
        const sheet = plan.sheets[0];
        const placement = sheet.placements[0];
        assert.deepEqual(placement.localOriginOffset, {
            xMm: -Math.min(...manifest.contours[0].points.map(point => {
                const x = point.xMm - placement.sourceOrigin.xMm;
                const y = point.yMm - placement.sourceOrigin.yMm;
                return x * Math.cos(rotationDeg * Math.PI / 180) - y * Math.sin(rotationDeg * Math.PI / 180);
            })),
            yMm: -Math.min(...manifest.contours[0].points.map(point => {
                const x = point.xMm - placement.sourceOrigin.xMm;
                const y = point.yMm - placement.sourceOrigin.yMm;
                return x * Math.sin(rotationDeg * Math.PI / 180) + y * Math.cos(rotationDeg * Math.PI / 180);
            }))
        });
        const firstSourcePoint = manifest.contours[0].points[0];
        const transformedFirst = transformPartPoint({ x: firstSourcePoint.xMm, y: firstSourcePoint.yMm }, placement);
        assert.ok(Math.abs(transformedFirst.x - placement.polygon[0].x) < 1e-8);
        assert.ok(Math.abs(transformedFirst.y - placement.polygon[0].y) < 1e-8);

        const svg = serializeSheetMachineSvg(manifest, sheet, { operationSource: 'manifest', precision: 3 });
        const serialized = svg.match(new RegExp(`<polygon id="${physicalId}" points="([^"]+)"`))?.[1];
        assert.ok(serialized, `missing ${physicalId} at ${rotationDeg} degrees`);
        const svgPoints = serialized.split(/\s+/).map(value => {
            const [x, y] = value.split(',').map(Number);
            return { x, y };
        });
        assertBoundsClose(bounds(svgPoints), placement.bounds);

        const dxf = serializeSheetDxf(manifest, sheet, { operationSource: 'manifest', precision: 3 });
        assertBoundsClose(bounds(dxfEntityPoints(dxf, physicalId)), placement.bounds);
    });
});

test('physical part instances receive unique SVG IDs and DXF handles', () => {
    const manifest = createManifestFixture();
    manifest.parts.forEach(part => { part.includeInFabrication = part.id === 'panel_cp'; });
    manifest.parts.find(part => part.id === 'panel_cp').quantity = 2;
    const result = buildManufacturingPackage(manifest, [], { generatedAt: FIXED_TIME });
    const machineSvgs = result.entries.filter(entry => /^machine\/[^/]+\/sheet-\d\d\.svg$/.test(entry.path)).map(entry => String(entry.data));
    const ids = machineSvgs.flatMap(svg => [...svg.matchAll(/<(?:polygon|circle|line) id="([^"]+)"/g)].map(match => match[1]));
    assert.equal(ids.length, 6);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.some(id => id.endsWith('--panel_cp-1')));
    assert.ok(ids.some(id => id.endsWith('--panel_cp-2')));

    const handles = result.entries
        .filter(entry => /^machine\/[^/]+\/sheet-\d\d\.dxf$/.test(entry.path))
        .flatMap(entry => [...String(entry.data).matchAll(/\n5\n([A-F0-9]+)\n/g)].map(match => match[1]));
    assert.equal(handles.length, 6);
    assert.equal(new Set(handles).size, handles.length);
});

test('router package guidance states dogbone scope and that holding tabs remain CAM metadata', () => {
    const result = buildManufacturingPackage(createManifestFixture(), [], {
        generatedAt: FIXED_TIME,
        processProfile: DEFAULT_PROCESS_PROFILES.router6
    });
    const findings = JSON.parse(textEntry(result, 'manifest/package-findings.json'));
    assert.ok(findings.some(item => item.code === 'PROCESS_DOGBONE_GUIDANCE'));
    assert.ok(findings.some(item => item.code === 'PROCESS_HOLDING_TABS_CAM_REQUIRED'));
    const guidance = JSON.parse(textEntry(result, 'reports/process/router-6mm-guidance.json'));
    assert.ok(guidance.limitations.some(item => /Holding-tab count and dimensions are metadata only/.test(item)));
    assert.ok(guidance.limitations.some(item => /Dogbone circles are derived only/.test(item)));
    assert.ok(guidance.limitations.some(item => /No feeds, speeds, toolpaths, G-code/.test(item)));
});
