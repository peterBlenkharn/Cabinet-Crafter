import { createNestingPlan, validateNestingPlan } from './nesting.js';
import { normalizeMaterialProfiles, resolvePartMaterial, summarizeMaterials } from './materials.js';
import { enrichManifestParts, findOperationGeometry } from './manifest-utils.js';
import { generateAssemblyPlan, serializeAssemblyMarkdown } from './assembly.js';
import { analyzeArcadeBuild } from './arcade-intelligence.js';
import { DEFAULT_PROCESS_PROFILES, applyJoineryStrategies, createProcessProfile, deriveProcessManifest } from './joinery.js';
import {
    createArtworkTemplate,
    serializeArtworkCutMaskSvg,
    serializeArtworkTemplateSvg,
    validateArtworkTemplate
} from './artwork-production.js';
import { buildBatchPlan, buildQuote, createWorkshopProfile, serializeQuoteCsv } from './workshop.js';
import {
    buildCostedHardwareSchedule,
    buildProcurementBom,
    normalizeAdditionalHardwareItems,
    normalizeHardwareCostOverrides
} from './procurement.js';

export const FABRICATION_PACKAGE_VERSION = 1;
export const FABRICATION_PACKAGE_MANIFEST_SCHEMA = 'CabinetCrafter.FabricationPackageManifestV1';

const MACHINE_OPERATION_TYPES = new Set(['profileCut', 'throughCut', 'drill', 'pocket', 'engrave']);
const CRC32_TABLE = createCrc32Table();

export function buildManufacturingPackage(manifest, preflightResults = [], options = {}) {
    assertProductionGate(preflightResults, options, 'preflight');
    const materials = normalizeMaterialProfiles(options.materials?.length ? options.materials : manifest.materials);
    const materialAssignments = {
        ...(manifest.materialAssignments || {}),
        ...(manifest.parameters?.fabricationSettings?.materialAssignments || {}),
        ...(options.nesting?.assignments || {}),
        ...(options.materialAssignments || {})
    };
    const projectName = sanitizeName(options.projectName || manifest.project?.name || 'cabinet');
    const generatedAt = validIsoDate(options.generatedAt) || new Date().toISOString();
    const workshopEnabled = Boolean(options.workshopProfile || options.workshop);
    const requestedCurrency = /^[A-Z]{3}$/.test(String(options.currencyCode || '').toUpperCase())
        ? String(options.currencyCode).toUpperCase()
        : null;
    const workshopInput = options.workshopProfile || options.workshop || {};
    const workshopProfile = createWorkshopProfile(requestedCurrency
        ? { ...workshopInput, currency: requestedCurrency }
        : workshopInput);
    const joineryOptions = normalizeJoineryOptions(options);
    const joineryResult = joineryOptions.enabled
        ? applyJoineryStrategies(manifest, joineryOptions.assignments, joineryOptions.settings)
        : { manifest, findings: [] };
    const nominalManifest = joineryResult.manifest;
    const process = resolveProcessOption(options, workshopEnabled ? workshopProfile : null);
    const processResult = process.enabled
        ? deriveProcessManifest(nominalManifest, process.profile)
        : { manifest: nominalManifest, findings: [] };
    const artwork = resolveArtworkTemplates(nominalManifest, options);
    const materialFindings = validatePackageMaterialAssignments(nominalManifest, materials, materialAssignments);
    const optionalFindings = [...joineryResult.findings, ...processResult.findings, ...artwork.findings, ...materialFindings];
    assertProductionGate(optionalFindings, options, 'optional feature');

    const batchQuantity = resolveBatchQuantity(options, workshopProfile);
    const batchManifest = createBatchManifest(nominalManifest, batchQuantity);
    const parts = enrichManifestParts(batchManifest, { includedOnly: true });
    const suppliedNestingQuantity = Number(options.nestingPlan?.batchQuantity ?? options.nestingPlan?.batch?.cabinetQuantity);
    const suppliedNestingMatchesBatch = batchQuantity === 1 || suppliedNestingQuantity === batchQuantity;
    const sourceNesting = suppliedNestingMatchesBatch && options.nestingPlan
        ? options.nestingPlan
        : createNestingPlan(batchManifest, materials, {
            ...(options.nesting || {}),
            assignments: materialAssignments
        });
    const nesting = cloneNestingPlanForPackage(sourceNesting);
    nesting.generatedAt = generatedAt;
    nesting.batchQuantity = batchQuantity;
    nesting.findings = mergeFindings(nesting.findings || [], validateNestingPlan(nesting, materials));
    assertNestingGate(nesting.findings || [], options);

    const intelligence = cloneValue(options.arcadeIntelligence || analyzeArcadeBuild(nominalManifest, nominalManifest.parameters || {}, options.arcade || {}));
    if (intelligence.assembly) intelligence.assembly.generatedAt = generatedAt;
    if (intelligence.ergonomics) intelligence.ergonomics.generatedAt = generatedAt;
    const batchPlan = buildBatchPlan(nominalManifest, batchQuantity, { hardwareSchedule: intelligence.hardwareSchedule || [] });
    const hardwareSchedule = buildCostedHardwareSchedule(batchPlan.hardware, {
        hardwareCosts: options.hardwareCosts,
        additionalHardware: options.additionalHardware,
        additionalQuantityMultiplier: batchQuantity
    });
    const baseAssembly = joineryOptions.enabled
        ? generateAssemblyPlan(nominalManifest, { projectName })
        : (intelligence.assembly || generateAssemblyPlan(nominalManifest, { projectName }));
    const assembly = createBatchAssembly(reconcileAssemblyMaterials(baseAssembly, nominalManifest, materials, materialAssignments), batchQuantity, generatedAt);
    const materialSummary = summarizeMaterials(parts, materials, materialAssignments, nesting.sheets);
    const procurementBom = buildProcurementBom(materialSummary, hardwareSchedule, {
        currencyCode: workshopProfile.currency
    });
    const quoteEnabled = options.quote === true || Boolean(options.includeQuote) || Boolean(options.quote && typeof options.quote === 'object');
    const quoteOptions = options.quote && typeof options.quote === 'object' ? options.quote : {};
    const quote = quoteEnabled ? buildQuote({
        ...quoteOptions,
        quoteNumber: quoteOptions.quoteNumber || stableQuoteNumber(projectName, generatedAt),
        generatedAt,
        quantity: batchQuantity,
        workshopProfile,
        materialSummary: materialSummary.map(item => ({ ...item, estimatedCost: Number(item.estimatedCost || 0) / batchQuantity })),
        hardwareSchedule: buildCostedHardwareSchedule(intelligence.hardwareSchedule || [], {
            hardwareCosts: options.hardwareCosts,
            additionalHardware: options.additionalHardware
        }),
        manifest: nominalManifest,
        nesting
    }) : null;
    const designVariants = normalizeDesignVariants(options);
    const packageFindings = [...optionalFindings, ...(nesting.findings || [])];
    const packageManifest = createPackageManifest({
        projectName,
        generatedAt,
        batchQuantity,
        joineryOptions,
        process,
        artwork,
        workshopEnabled,
        workshopProfile,
        quote,
        designVariants,
        materialAssignments,
        nestingPlanRegeneratedForBatch: Boolean(options.nestingPlan) && !suppliedNestingMatchesBatch,
        findings: [...preflightResults, ...packageFindings],
        intelligenceFindings: intelligence.findings || []
    });
    const entries = [];

    addText(entries, 'manifest/fabrication-manifest.json', JSON.stringify(manifest, null, 2));
    addText(entries, 'manifest/package-manifest.json', JSON.stringify(packageManifest, null, 2));
    addText(entries, 'manifest/nesting-plan.json', JSON.stringify(nesting, null, 2));
    addText(entries, 'manifest/preflight-results.json', JSON.stringify(preflightResults, null, 2));
    addText(entries, 'manifest/package-findings.json', JSON.stringify(packageFindings, null, 2));
    addText(entries, 'manifest/arcade-intelligence.json', JSON.stringify(intelligence, null, 2));
    addText(entries, 'manifest/procurement-bom.json', JSON.stringify(procurementBom, null, 2));
    addText(entries, 'project/project-document.json', JSON.stringify(options.projectDocument || {
        schemaVersion: 2,
        project: manifest.project,
        units: { internal: 'mm', display: 'mm' },
        design: { params: manifest.parameters || {}, decals: {} },
        materials,
        fabricationSettings: {
            materialAssignments,
            currencyCode: workshopProfile.currency,
            hardwareCosts: normalizeHardwareCostOverrides(options.hardwareCosts),
            additionalHardware: normalizeAdditionalHardwareItems(options.additionalHardware)
        }
    }, null, 2));

    if (Object.keys(materialAssignments).length) {
        addText(entries, 'manifest/material-assignments.json', JSON.stringify(materialAssignments, null, 2));
    }

    if (joineryOptions.enabled) {
        addText(entries, 'manifest/nominal-joinery-manifest.json', JSON.stringify(nominalManifest, null, 2));
        addText(entries, 'manifest/joinery-assignments.json', JSON.stringify({
            version: 1,
            assignments: joineryOptions.assignments,
            settings: joineryOptions.settings
        }, null, 2));
    }
    if (batchQuantity > 1 || workshopEnabled || quoteEnabled) {
        addText(entries, 'manifest/batch-plan.json', JSON.stringify(batchPlan, null, 2));
    }
    if (workshopEnabled || quoteEnabled) {
        addText(entries, 'manifest/workshop-profile.json', JSON.stringify(workshopProfile, null, 2));
    }
    if (designVariants.enabled) {
        addText(entries, 'manifest/design-variants.json', JSON.stringify(designVariants.document, null, 2));
    }

    nesting.sheets.forEach(sheet => {
        const directory = `machine/${safePath(sheet.materialId)}`;
        const baseName = `sheet-${String(sheet.index).padStart(2, '0')}`;
        const nominalOptions = { ...options, operationSource: 'manifest' };
        addText(entries, `${directory}/${baseName}.svg`, serializeSheetMachineSvg(nominalManifest, sheet, nominalOptions));
        addText(entries, `${directory}/${baseName}.dxf`, serializeSheetDxf(nominalManifest, sheet, nominalOptions));
    });

    if (process.enabled) {
        const processDirectory = `machine/derived/${safePath(process.profile.id)}`;
        addText(entries, `manifest/process/${safePath(process.profile.id)}.json`, JSON.stringify(processResult.manifest, null, 2));
        nesting.sheets.forEach(sheet => {
            const directory = `${processDirectory}/${safePath(sheet.materialId)}`;
            const baseName = `sheet-${String(sheet.index).padStart(2, '0')}`;
            const derivedOptions = { ...options, operationSource: 'manifest', processProfileId: process.profile.id };
            addText(entries, `${directory}/${baseName}.svg`, serializeSheetMachineSvg(processResult.manifest, sheet, derivedOptions));
            addText(entries, `${directory}/${baseName}.dxf`, serializeSheetDxf(processResult.manifest, sheet, derivedOptions));
        });
        addText(entries, `reports/process/${safePath(process.profile.id)}-guidance.json`, JSON.stringify(buildProcessGuidance(processResult.manifest), null, 2));
    }

    artwork.templates.forEach(template => {
        const id = safePath(template.id);
        addText(entries, `artwork/templates/${id}.json`, JSON.stringify(template, null, 2));
        addText(entries, `artwork/templates/${id}.svg`, serializeArtworkTemplateSvg(template, options.artwork || {}));
        addText(entries, `artwork/masks/${id}-cut-mask.svg`, serializeArtworkCutMaskSvg(template, options.artwork || {}));
    });

    addText(entries, 'machine/calibration-100mm.svg', serializeCalibrationSvg());
    addText(entries, 'reports/bom.csv', serializeCsv(buildBomRows(parts, materials, batchQuantity, materialAssignments), BOM_COLUMNS));
    addText(entries, 'reports/cut-list.csv', serializeCsv(buildCutListRows(nesting), CUT_LIST_COLUMNS));
    addText(entries, 'reports/material-summary.csv', serializeCsv(materialSummary, MATERIAL_COLUMNS));
    addText(entries, 'reports/joint-schedule.csv', serializeCsv(buildJointRows(nominalManifest), JOINT_COLUMNS));
    addText(entries, 'reports/fastener-schedule.csv', serializeCsv(buildFastenerRows(nominalManifest), FASTENER_COLUMNS));
    addText(entries, 'reports/operation-schedule.csv', serializeCsv(buildOperationRows(nominalManifest), OPERATION_COLUMNS));
    addText(entries, 'reports/hardware-schedule.csv', serializeCsv(hardwareSchedule, HARDWARE_COLUMNS));
    addText(entries, 'reports/total-bom.csv', serializeCsv([
        ...procurementBom.rows,
        {
            category: 'Total', itemId: '', item: 'Project total', quantity: '', unit: '', unitCost: '',
            totalCost: procurementBom.summary.totalCost, supplier: '', sku: '', notes: '', currency: procurementBom.currency
        }
    ], PROCUREMENT_COLUMNS));
    addText(entries, 'reports/total-bom.json', JSON.stringify(procurementBom, null, 2));
    addText(entries, 'reports/wiring-plan.csv', serializeCsv(intelligence.wiring?.connections || [], WIRING_COLUMNS));
    addText(entries, 'reports/ergonomics.csv', serializeCsv(intelligence.ergonomics?.profiles || [], ERGONOMICS_COLUMNS));
    addText(entries, 'reports/t-moulding.csv', serializeCsv(intelligence.tMoulding?.records || [], TMOULDING_COLUMNS));
    addText(entries, 'reports/preflight-report.html', serializePreflightReport(
        projectName,
        [...preflightResults, ...optionalFindings],
        nesting,
        materialSummary,
        generatedAt,
        intelligence.findings || [],
        procurementBom
    ));
    if (quote) {
        addText(entries, 'reports/quote.json', JSON.stringify(quote, null, 2));
        addText(entries, 'reports/quote.csv', serializeQuoteCsv(quote));
    }
    addText(entries, 'assembly/assembly-guide.md', serializeAssemblyMarkdown(assembly));
    addText(entries, 'assembly/part-labels.svg', serializePartLabelsSvg(assembly.labels));
    enrichManifestParts(nominalManifest, { includedOnly: true })
        .filter(part => (part.operations || []).some(operation => operation.type === 'drill'))
        .forEach(part => addText(entries, `assembly/templates/${safePath(part.id)}-drilling.svg`, serializePartDrillingTemplateSvg(nominalManifest, part, options)));
    addText(entries, 'drawings/annotated-shop-layout.svg', serializeAnnotatedShopLayout(nominalManifest, nesting, preflightResults));

    const zipBytes = createStoredZip(entries, { timestamp: generatedAt });
    let base64 = null;
    return {
        version: FABRICATION_PACKAGE_VERSION,
        fileName: `${projectName}-fabrication.zip`,
        entries,
        zipBytes,
        get base64() {
            return base64 || (base64 = bytesToBase64(zipBytes));
        },
        manifest: nominalManifest,
        sourceManifest: manifest,
        processManifest: process.enabled ? processResult.manifest : null,
        packageManifest,
        nesting,
        batchPlan,
        assembly,
        intelligence,
        artwork: artwork.templates,
        quote,
        designVariants: designVariants.document,
        materialSummary,
        hardwareSchedule,
        procurementBom,
        summary: {
            parts: parts.reduce((sum, part) => sum + Math.max(1, Number(part.quantity) || 1), 0),
            sheets: nesting.sheets.length,
            files: entries.length,
            errors: [...preflightResults, ...packageFindings].filter(item => item.severity === 'error').length,
            warnings: [...preflightResults, ...packageFindings].filter(item => item.severity === 'warning').length,
            batchQuantity,
            derivedProcessFiles: process.enabled,
            artworkTemplates: artwork.templates.length,
            utilizationPercent: nesting.totals?.utilizationPercent || 0,
            materialCost: procurementBom.summary.materialCost,
            hardwareCost: procurementBom.summary.hardwareCost,
            totalBomCost: procurementBom.summary.totalCost,
            currency: procurementBom.currency
        }
    };
}

function normalizeJoineryOptions(options) {
    const source = options.joinery && typeof options.joinery === 'object' ? options.joinery : {};
    const assignments = cloneValue(options.joineryAssignments || source.assignments || {});
    const settings = cloneValue(options.joinerySettings || source.settings || {});
    return {
        enabled: source.enabled === true || Object.keys(assignments).length > 0,
        assignments,
        settings
    };
}

function resolveProcessOption(options, workshopProfile = null) {
    const processOption = options.process && typeof options.process === 'object' ? options.process : {};
    const raw = options.processProfile ?? processOption.profile ?? (processOption.kind ? processOption : null) ??
        (workshopProfile?.processProfileId && workshopProfile.processProfileId !== 'nominal' ? workshopProfile.processProfileId : null);
    if (!raw) return { enabled: false, profile: DEFAULT_PROCESS_PROFILES.nominal };
    const preset = typeof raw === 'string'
        ? ({ nominal: DEFAULT_PROCESS_PROFILES.nominal, router6: DEFAULT_PROCESS_PROFILES.router6, 'router-6mm': DEFAULT_PROCESS_PROFILES.router6, laser: DEFAULT_PROCESS_PROFILES.laser, 'laser-generic': DEFAULT_PROCESS_PROFILES.laser })[raw]
        : raw;
    const profile = createProcessProfile(preset || { id: String(raw), name: String(raw), kind: 'nominal' });
    return { enabled: profile.kind !== 'nominal', profile };
}

function resolveArtworkTemplates(manifest, options) {
    const source = options.artworkTemplates ?? options.artwork?.templates ?? [];
    const requests = Array.isArray(source) ? source : [source];
    const parts = new Map(enrichManifestParts(manifest).map(part => [part.id, part]));
    const templates = [];
    const findings = [];
    const ids = new Set();

    requests.filter(Boolean).forEach((request, index) => {
        const partId = typeof request === 'string' ? request : request.partId;
        let template;
        if (request && typeof request === 'object' && Array.isArray(request.outline) && request.canvas) {
            const portablePartId = request.partId || request.id || `artwork-part-${index + 1}`;
            template = createArtworkTemplate({
                id: portablePartId,
                name: request.name || portablePartId,
                outline: { points: request.outline },
                operations: Array.isArray(request.cutouts) ? request.cutouts : [],
                finishedFace: request.finishedFace
            }, {
                ...request,
                assets: Array.isArray(request.assets) ? request.assets : []
            });
            template.id = String(request.id || template.id);
            template.partId = String(request.partId || template.partId);
        } else if (partId && parts.has(partId)) {
            const configuration = typeof request === 'object' ? request : {};
            template = createArtworkTemplate(parts.get(partId), configuration);
        } else {
            findings.push(packageFinding(
                'ARTWORK_PART_NOT_FOUND', 'error', partId ? [partId] : [],
                `Artwork template ${index + 1} does not identify a fabricated panel.`,
                'Choose an included part ID or provide a complete portable artwork template.'
            ));
            return;
        }

        const pathId = safePath(template.id);
        if (ids.has(pathId)) {
            findings.push(packageFinding(
                'ARTWORK_TEMPLATE_DUPLICATE', 'error', [template.partId].filter(Boolean),
                `Artwork template ID ${template.id} is duplicated.`,
                'Give every artwork template a unique ID.'
            ));
            return;
        }
        ids.add(pathId);
        templates.push(template);
        findings.push(...validateArtworkTemplate(template));
    });
    return { enabled: templates.length > 0 || requests.filter(Boolean).length > 0, templates, findings };
}

function resolveBatchQuantity(options, workshopProfile) {
    const value = options.batchQuantity ?? options.batch?.quantity ?? (options.workshopProfile || options.workshop ? workshopProfile.defaultBatchQuantity : 1);
    return Math.max(1, Math.round(Number(value) || 1));
}

function createBatchManifest(manifest, quantity) {
    if (quantity === 1) return manifest;
    const result = cloneValue(manifest);
    result.parts = (result.parts || []).map(part => ({
        ...part,
        quantity: Math.max(1, Math.round(Number(part.quantity) || 1)) * quantity
    }));
    result.batch = { cabinetQuantity: quantity, sourceQuantitiesArePerCabinet: true };
    return result;
}

function createBatchAssembly(assembly, batchQuantity, generatedAt) {
    const result = cloneValue(assembly);
    result.generatedAt = generatedAt;
    if (batchQuantity === 1) return result;
    result.batchQuantity = batchQuantity;
    result.labels = (assembly.labels || []).flatMap(label => {
        const piecesPerCabinet = Math.max(1, Math.round(Number(label.quantity) || 1));
        return Array.from({ length: batchQuantity }, (_, cabinetIndex) => (
            Array.from({ length: piecesPerCabinet }, (_, pieceIndex) => ({
                ...label,
                sourcePartId: label.partId,
                partId: `${label.partId}:cabinet-${cabinetIndex + 1}:piece-${pieceIndex + 1}`,
                quantity: 1,
                cabinetIndex: cabinetIndex + 1,
                pieceIndex: pieceIndex + 1,
                instanceId: `${label.partId}:cabinet-${cabinetIndex + 1}:piece-${pieceIndex + 1}`
            }))
        )).flat();
    });
    result.summary = { ...result.summary, cabinets: batchQuantity, physicalParts: result.labels.length };
    return result;
}

function normalizeDesignVariants(options) {
    const source = options.designVariants ?? (options.designVariant ? [options.designVariant] : []);
    const variants = (Array.isArray(source) ? source : [source]).filter(Boolean).map(cloneValue);
    const activeVariantId = options.activeVariantId || variants.find(item => item.active)?.id || variants[0]?.id || null;
    return {
        enabled: variants.length > 0,
        document: {
            version: 1,
            activeVariantId,
            variants
        }
    };
}

function createPackageManifest(input) {
    const featureFindings = summarizeFindings(input.findings);
    const advisoryFindings = summarizeFindings(input.intelligenceFindings);
    return {
        schema: FABRICATION_PACKAGE_MANIFEST_SCHEMA,
        version: FABRICATION_PACKAGE_VERSION,
        units: 'mm',
        projectName: input.projectName,
        generatedAt: input.generatedAt,
        sourceManifest: 'manifest/fabrication-manifest.json',
        nominalSource: input.joineryOptions.enabled ? 'manifest/nominal-joinery-manifest.json' : 'manifest/fabrication-manifest.json',
        nominalMachineDirectory: 'machine/',
        batchQuantity: input.batchQuantity,
        features: {
            joinery: {
                enabled: input.joineryOptions.enabled,
                assignmentCount: Object.keys(input.joineryOptions.assignments).length,
                manifest: input.joineryOptions.enabled ? 'manifest/nominal-joinery-manifest.json' : null
            },
            process: {
                enabled: input.process.enabled,
                id: input.process.profile.id,
                kind: input.process.profile.kind,
                derivedOnly: input.process.enabled,
                nominalFilesRetained: true,
                directory: input.process.enabled ? `machine/derived/${safePath(input.process.profile.id)}/` : null
            },
            materialAssignments: {
                enabled: Object.keys(input.materialAssignments || {}).length > 0,
                count: Object.keys(input.materialAssignments || {}).length,
                manifest: Object.keys(input.materialAssignments || {}).length ? 'manifest/material-assignments.json' : null
            },
            artwork: { enabled: input.artwork.enabled, templateCount: input.artwork.templates.length },
            batch: {
                enabled: input.batchQuantity > 1,
                quantity: input.batchQuantity,
                nestingPlanRegenerated: input.nestingPlanRegeneratedForBatch
            },
            workshop: {
                enabled: input.workshopEnabled,
                profileId: input.workshopEnabled ? input.workshopProfile.id : null,
                processProfileId: input.workshopEnabled ? input.workshopProfile.processProfileId : null
            },
            quote: { enabled: Boolean(input.quote), quoteNumber: input.quote?.quoteNumber || null },
            designVariants: {
                enabled: input.designVariants.enabled,
                count: input.designVariants.document.variants.length,
                activeVariantId: input.designVariants.document.activeVariantId
            }
        },
        findings: {
            gated: featureFindings,
            advisoryArcadeIntelligence: advisoryFindings
        },
        safety: {
            productionPreflightGated: true,
            errorOverrideAllowed: false,
            containsGCode: false,
            directMachineControl: false,
            derivedProcessFilesNeverReplaceNominal: true
        }
    };
}

function buildProcessGuidance(manifest) {
    const operations = (manifest.operations || []).filter(operation => operation.process).map(operation => ({
        operationId: operation.id,
        partId: operation.partId,
        type: operation.type,
        derivedFrom: operation.derivedFrom || null,
        process: operation.process
    }));
    return {
        version: 1,
        units: 'mm',
        profile: manifest.processProfile,
        nominalGeometryRetainedSeparately: true,
        closedNominalVectorsRetained: true,
        limitations: [
            ...(manifest.processProfile?.holdingTabs ? [
                'Holding-tab count and dimensions are metadata only; SVG/DXF profile vectors remain closed and tab spans must be placed in downstream CAM.'
            ] : []),
            ...(manifest.processProfile?.dogbones ? [
                'Dogbone circles are derived only for convex corners of closed polygonal or rectangular through-cuts; all relief positions require downstream fit verification.'
            ] : []),
            'No feeds, speeds, toolpaths, G-code, post-processors, or direct machine control are included.'
        ],
        operations,
        note: 'Derived vectors and metadata require verification in downstream CAM. No feeds, speeds, G-code, post-processor, or direct machine control are included.'
    };
}

function assertProductionGate(findings, options, label) {
    const blocking = (findings || []).filter(item => item.severity === 'error');
    if (blocking.length) {
        const error = new Error(`Production package blocked by ${blocking.length} ${label} error${blocking.length === 1 ? '' : 's'}.`);
        error.code = 'PREFLIGHT_BLOCKED';
        error.preflightResults = blocking;
        throw error;
    }
    const warnings = (findings || []).filter(item => item.severity === 'warning');
    if (warnings.length && options.acknowledgeWarnings !== true) {
        const error = new Error(`Acknowledge ${warnings.length} ${label} warning${warnings.length === 1 ? '' : 's'} before creating production files.`);
        error.code = 'WARNING_ACKNOWLEDGEMENT_REQUIRED';
        error.preflightResults = warnings;
        throw error;
    }
}

function assertNestingGate(findings, options) {
    const errors = findings.filter(item => item.severity === 'error');
    if (errors.length) {
        const error = new Error(`Production package blocked by ${errors.length} nesting error${errors.length === 1 ? '' : 's'}.`);
        error.code = 'NESTING_BLOCKED';
        error.preflightResults = errors;
        throw error;
    }
    assertProductionGate(findings, options, 'nesting');
}

function mergeFindings(...collections) {
    const seen = new Set();
    return collections.flat().filter(item => {
        const key = item?.id || [
            item?.code,
            item?.severity,
            [...(item?.partIds || [])].sort().join('|'),
            item?.message || ''
        ].join('::');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function summarizeFindings(findings = []) {
    return {
        errors: findings.filter(item => item.severity === 'error').length,
        warnings: findings.filter(item => item.severity === 'warning').length,
        info: findings.filter(item => item.severity === 'info').length,
        codes: [...new Set(findings.map(item => item.code).filter(Boolean))].sort()
    };
}

function stableQuoteNumber(projectName, generatedAt) {
    return `CC-${String(projectName).toUpperCase()}-${generatedAt.slice(0, 10).replace(/-/g, '')}`;
}

function validIsoDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function packageFinding(code, severity, partIds, message, remedy) {
    return { code, severity, partIds, message, remedy };
}

function cloneValue(value) {
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function cloneNestingPlanForPackage(plan) {
    if (!plan || typeof plan !== 'object') return cloneValue(plan);
    const { candidates, ...portablePlan } = plan;
    return cloneValue(portablePlan);
}

function validatePackageMaterialAssignments(manifest, materials, assignments) {
    const profiles = new Map(materials.map(profile => [profile.id, profile]));
    const parts = new Map((manifest.parts || []).map(part => [part.id, part]));
    const findings = [];
    Object.entries(assignments || {}).forEach(([partId, materialId]) => {
        const part = parts.get(partId);
        if (!part) {
            findings.push(packageFinding(
                'MATERIAL_ASSIGNMENT_PART_UNKNOWN', 'error', [partId],
                `Material assignment references unknown or excluded part ${partId}.`,
                'Remove the stale assignment or include the part in fabrication.'
            ));
            return;
        }
        if (part.includeInFabrication === false) {
            findings.push(packageFinding(
                'MATERIAL_ASSIGNMENT_EXCLUDED', 'info', [partId],
                `Material assignment for excluded part ${part.name || partId} is retained but not used in this package.`,
                'No action is required unless the part is included again.'
            ));
            return;
        }
        const profile = profiles.get(materialId);
        if (!profile) {
            findings.push(packageFinding(
                'MATERIAL_ASSIGNMENT_UNKNOWN', 'error', [partId],
                `${part.name || partId} references unavailable material ${materialId}.`,
                'Choose a material profile included in this package.'
            ));
            return;
        }
        const partThickness = Number(part.thicknessMm ?? part.thickness);
        if (Number.isFinite(partThickness) && Math.abs(partThickness - profile.measuredThicknessMm) > 0.75) {
            findings.push(packageFinding(
                'MATERIAL_ASSIGNMENT_THICKNESS', 'error', [partId],
                `${part.name || partId} is ${partThickness} mm but ${profile.name} measures ${profile.measuredThicknessMm} mm.`,
                'Choose matching stock or update the panel design thickness before production.'
            ));
        }
    });
    return findings;
}

function reconcileAssemblyMaterials(assembly, manifest, materials, assignments) {
    const result = cloneValue(assembly);
    const parts = new Map(enrichManifestParts(manifest).map(part => [part.id, part]));
    result.labels = (result.labels || []).map(label => {
        const part = parts.get(label.partId);
        if (!part) return label;
        const profile = resolvePartMaterial(part, materials, assignments);
        return {
            ...label,
            material: profile.name,
            thicknessMm: profile.measuredThicknessMm
        };
    });
    return result;
}

export async function saveManufacturingPackage(packageResult) {
    if (globalThis.window?.cabinetDesktop?.available) {
        return globalThis.window.cabinetDesktop.request('export.saveBinary', {
            suggestedName: packageResult.fileName,
            base64: packageResult.base64
        });
    }
    const blob = new Blob([packageResult.zipBytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = packageResult.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return { cancelled: false, path: null };
}

export function serializeSheetMachineSvg(manifest, sheet, options = {}) {
    const precision = clampPrecision(options.precision);
    const groups = new Map([...MACHINE_OPERATION_TYPES].map(type => [type, []]));
    sheet.placements.forEach(placement => {
        const part = placement.sourcePart;
        const operations = options.operationSource === 'manifest'
            ? operationsForPart(manifest, placement.partId)
            : (part?.operations?.length ? part.operations : operationsForPart(manifest, placement.partId));
        let profileWritten = false;
        operations.forEach(operation => {
            if (!MACHINE_OPERATION_TYPES.has(operation.type)) return;
            const geometry = findOperationGeometry(manifest, operation);
            const element = geometryToSvg(geometry, operation, placement, precision);
            if (element) {
                groups.get(operation.type).push(element);
                if (operation.type === 'profileCut') profileWritten = true;
            }
        });
        if (!profileWritten) groups.get('profileCut').push(polygonToSvg(placement.polygon, physicalOperationId({ id: `${placement.partId}:profile` }, placement), precision));
    });

    const groupOrder = ['profileCut', 'throughCut', 'drill', 'pocket', 'engrave'];
    const groupMarkup = groupOrder.map(type => `  <g id="${operationLayer(type)}" data-operation="${type}" fill="none" stroke="#000" stroke-width="0.1">\n    ${groups.get(type).join('\n    ')}\n  </g>`).join('\n');
    const processAttribute = options.processProfileId ? ` data-process-profile="${escapeXml(options.processProfileId)}" data-derived="true"` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${format(sheet.widthMm, precision)}mm" height="${format(sheet.heightMm, precision)}mm" viewBox="0 0 ${format(sheet.widthMm, precision)} ${format(sheet.heightMm, precision)}"${processAttribute}>
${groupMarkup}
</svg>`;
}

export function serializeSheetDxf(manifest, sheet, options = {}) {
    const precision = clampPrecision(options.precision);
    const entities = [];
    sheet.placements.forEach(placement => {
        const part = placement.sourcePart;
        const operations = options.operationSource === 'manifest'
            ? operationsForPart(manifest, placement.partId)
            : (part?.operations?.length ? part.operations : operationsForPart(manifest, placement.partId));
        let profileWritten = false;
        operations.forEach(operation => {
            if (!MACHINE_OPERATION_TYPES.has(operation.type)) return;
            const geometry = findOperationGeometry(manifest, operation);
            const entity = geometryToDxf(geometry, operation, placement, precision);
            if (entity) {
                entities.push(entity);
                if (operation.type === 'profileCut') profileWritten = true;
            }
        });
        if (!profileWritten) entities.push(polylineDxf(placement.polygon, 'PROFILE_CUT', physicalOperationId({ id: `${placement.partId}:profile` }, placement), precision));
    });

    return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`;
}

export function serializePartDrillingTemplateSvg(manifest, partOrId, options = {}) {
    const precision = clampPrecision(options.precision);
    const part = typeof partOrId === 'string'
        ? enrichManifestParts(manifest).find(item => item.id === partOrId)
        : partOrId;
    if (!part) throw new Error('Cannot create a drilling template for an unknown part.');
    const outline = part.profilePoints?.length >= 3
        ? part.profilePoints.map(pointMm)
        : [
            { x: 0, y: 0 },
            { x: Number(part.widthMm || 0), y: 0 },
            { x: Number(part.widthMm || 0), y: Number(part.lengthMm || 0) },
            { x: 0, y: Number(part.lengthMm || 0) }
        ];
    const bounds = polygonBounds(outline);
    const margin = 20;
    const width = Math.max(bounds.width, 100) + margin * 2;
    const height = bounds.height + margin * 2;
    const drillOperations = (part.operations || operationsForPart(manifest, part.id)).filter(operation => operation.type === 'drill');
    const drills = drillOperations.map((operation, index) => {
        const geometry = findOperationGeometry(manifest, operation) || {};
        const center = pointMm(geometry.center || geometry);
        const radius = Number(geometry.radiusMm ?? Number(geometry.diameterMm) / 2) || 0;
        const cross = Math.max(3, Math.min(8, radius || 4));
        return `<g id="${escapeXml(operation.id)}"><circle cx="${format(center.x, precision)}" cy="${format(center.y, precision)}" r="${format(radius, precision)}"/><line x1="${format(center.x - cross, precision)}" y1="${format(center.y, precision)}" x2="${format(center.x + cross, precision)}" y2="${format(center.y, precision)}"/><line x1="${format(center.x, precision)}" y1="${format(center.y - cross, precision)}" x2="${format(center.x, precision)}" y2="${format(center.y + cross, precision)}"/><text fill="#111" x="${format(center.x + cross + 2, precision)}" y="${format(center.y - 2, precision)}">${index + 1}: ${format(radius * 2, precision)} mm</text></g>`;
    }).join('\n      ');
    const outlinePoints = outline.map(point => `${format(point.x, precision)},${format(point.y, precision)}`).join(' ');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${format(width, precision)}mm" height="${format(height, precision)}mm" viewBox="${format(bounds.minX - margin, precision)} ${format(bounds.minY - margin, precision)} ${format(width, precision)} ${format(height, precision)}">
  <title>${escapeXml(part.name || part.id)} full-size drilling template</title>
  <g id="REFERENCE" fill="none" stroke="#777" stroke-width="0.2"><polygon points="${outlinePoints}"/></g>
  <g id="DRILL" fill="none" stroke="#000" stroke-width="0.15" font-family="sans-serif" font-size="4" data-scale="1:1" data-units="mm">
      ${drills}
  </g>
  <g id="NOTES" font-family="sans-serif" font-size="4" fill="#111"><text x="${format(bounds.minX, precision)}" y="${format(bounds.minY - 8, precision)}">${escapeXml(part.id)} - PRINT AT 100% / 1:1 - verify the 100 mm check before drilling</text><line x1="${format(bounds.minX, precision)}" y1="${format(bounds.minY - 3, precision)}" x2="${format(bounds.minX + 100, precision)}" y2="${format(bounds.minY - 3, precision)}" stroke="#000"/><text x="${format(bounds.minX + 40, precision)}" y="${format(bounds.minY - 4, precision)}">100 mm</text></g>
</svg>`;
}

export function createStoredZip(entries, options = {}) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const date = dosDateTime(options.timestamp ? new Date(options.timestamp) : new Date());

    entries.forEach(entry => {
        const name = encoder.encode(entry.path.replace(/\\/g, '/'));
        const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data));
        const crc = crc32(data);
        const local = new Uint8Array(30 + name.length);
        const view = new DataView(local.buffer);
        writeU32(view, 0, 0x04034b50);
        writeU16(view, 4, 20);
        writeU16(view, 6, 0x0800);
        writeU16(view, 8, 0);
        writeU16(view, 10, date.time);
        writeU16(view, 12, date.date);
        writeU32(view, 14, crc);
        writeU32(view, 18, data.length);
        writeU32(view, 22, data.length);
        writeU16(view, 26, name.length);
        writeU16(view, 28, 0);
        local.set(name, 30);
        chunks.push(local, data);

        const record = new Uint8Array(46 + name.length);
        const centralView = new DataView(record.buffer);
        writeU32(centralView, 0, 0x02014b50);
        writeU16(centralView, 4, 20);
        writeU16(centralView, 6, 20);
        writeU16(centralView, 8, 0x0800);
        writeU16(centralView, 10, 0);
        writeU16(centralView, 12, date.time);
        writeU16(centralView, 14, date.date);
        writeU32(centralView, 16, crc);
        writeU32(centralView, 20, data.length);
        writeU32(centralView, 24, data.length);
        writeU16(centralView, 28, name.length);
        writeU16(centralView, 30, 0);
        writeU16(centralView, 32, 0);
        writeU16(centralView, 34, 0);
        writeU16(centralView, 36, 0);
        writeU32(centralView, 38, 0);
        writeU32(centralView, 42, offset);
        record.set(name, 46);
        central.push(record);
        offset += local.length + data.length;
    });

    const centralSize = central.reduce((sum, value) => sum + value.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeU32(endView, 0, 0x06054b50);
    writeU16(endView, 4, 0);
    writeU16(endView, 6, 0);
    writeU16(endView, 8, entries.length);
    writeU16(endView, 10, entries.length);
    writeU32(endView, 12, centralSize);
    writeU32(endView, 16, offset);
    writeU16(endView, 20, 0);
    return concatenate([...chunks, ...central, end]);
}

function buildBomRows(parts, materials, batchQuantity = 1, assignments = {}) {
    return parts.map(part => {
        const material = resolvePartMaterial(part, materials, assignments);
        return {
            partId: part.id,
            name: part.name,
            quantity: Math.max(1, Number(part.quantity) || 1),
            perCabinet: Math.max(1, Number(part.quantity) || 1) / Math.max(1, batchQuantity),
            batchQuantity: Math.max(1, batchQuantity),
            material: material.name,
            thicknessMm: material.measuredThicknessMm,
            widthMm: part.widthMm,
            lengthMm: part.lengthMm,
            areaM2: format((part.areaMm2 || 0) / 1e6, 3),
            grainDirection: part.grainDirection || material.grainDirection || 'none',
            finishedFace: part.finishedFace || 'front'
        };
    });
}

function buildCutListRows(nesting) {
    return nesting.sheets.flatMap(sheet => sheet.placements.map(placement => ({
        sheet: sheet.index,
        materialId: sheet.materialId,
        partId: placement.partId,
        instanceId: placement.instanceId,
        name: placement.name,
        xMm: format(placement.xMm),
        yMm: format(placement.yMm),
        rotationDeg: placement.rotationDeg,
        widthMm: format(placement.bounds.width),
        heightMm: format(placement.bounds.height)
    })));
}

function buildJointRows(manifest) {
    return (manifest.joints || []).flatMap(joint => {
        const cuts = joint.cuts?.length ? joint.cuts : [{ partId: joint.partIds?.[0], bevelAngleDeg: null }];
        return cuts.map(cut => ({
            jointId: joint.id,
            pointName: joint.pointName,
            type: joint.type,
            partIds: (joint.partIds || []).join(' | '),
            cutPartId: cut.partId,
            includedAngleDeg: joint.includedAngleDeg,
            bevelAngleDeg: cut.bevelAngleDeg,
            longFace: cut.longFace || '',
            allowanceMm: joint.allowanceMm || 0
        }));
    });
}

function buildFastenerRows(manifest) {
    return (manifest.fasteners || []).map(item => ({
        fastenerId: item.id,
        kind: item.kind || 'screw',
        partIds: (item.partIds || [item.partId, item.targetPartId].filter(Boolean)).join(' | '),
        diameterMm: item.diameterMm ?? item.shaftDiameterMm ?? '',
        lengthMm: item.lengthMm ?? '',
        valid: item.valid === false ? 'no' : 'yes',
        notes: item.message || ''
    }));
}

function buildOperationRows(manifest) {
    return (manifest.operations || []).map(item => ({
        operationId: item.id,
        partId: item.partId,
        type: item.type,
        purpose: item.purpose || '',
        geometry: item.geometry?.kind || '',
        depthMm: item.depthMm ?? ''
    }));
}

function serializePreflightReport(projectName, preflight, nesting, materials, generatedAt = new Date().toISOString(), advisory = [], procurementBom = null) {
    const rows = preflight.map(item => `<tr class="${escapeXml(item.severity)}"><td>${escapeXml(item.severity)}</td><td>${escapeXml(item.code)}</td><td>${escapeXml((item.partIds || []).join(', '))}</td><td>${escapeXml(item.message)}</td><td>${escapeXml(item.remedy || '')}</td></tr>`).join('');
    const materialRows = materials.map(item => `<tr><td>${escapeXml(item.name)}</td><td>${item.partCount}</td><td>${item.sheets}</td><td>${item.areaM2}</td><td>${item.weightKg}</td><td>${item.estimatedCost}</td></tr>`).join('');
    const advisoryRows = advisory.map(item => `<tr class="${escapeXml(item.severity)}"><td>${escapeXml(item.severity)}</td><td>${escapeXml(item.code)}</td><td>${escapeXml((item.partIds || []).join(', '))}</td><td>${escapeXml(item.message)}</td><td>${escapeXml(item.remedy || '')}</td></tr>`).join('');
    const advisorySection = advisoryRows ? `<h2>Arcade build intelligence (advisory)</h2><p>These relationship and ergonomic findings are advisory and do not gate production.</p><table><thead><tr><th>Severity</th><th>Code</th><th>Parts</th><th>Finding</th><th>Action</th></tr></thead><tbody>${advisoryRows}</tbody></table>` : '';
    const costSummary = procurementBom?.summary
        ? `<h2>Procurement cost</h2><table><thead><tr><th>Materials</th><th>Hardware and components</th><th>Total</th><th>Currency</th><th>Unpriced lines</th></tr></thead><tbody><tr><td>${procurementBom.summary.materialCost}</td><td>${procurementBom.summary.hardwareCost}</td><td>${procurementBom.summary.totalCost}</td><td>${escapeXml(procurementBom.currency)}</td><td>${procurementBom.summary.unpricedLineCount}</td></tr></tbody></table>`
        : '';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(projectName)} fabrication report</title><style>body{font:14px system-ui;margin:32px;color:#171717}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #bbb;padding:6px;text-align:left}.error{background:#ffe7e4}.warning{background:#fff5d2}h1,h2{margin-top:24px}@media print{body{margin:10mm}}</style></head><body><h1>${escapeXml(projectName)} fabrication report</h1><p>Generated ${escapeXml(generatedAt)} &middot; ${nesting.sheets.length} sheet(s) &middot; ${nesting.totals?.utilizationPercent || 0}% utilization</p><h2>Production preflight</h2><table><thead><tr><th>Severity</th><th>Code</th><th>Parts</th><th>Finding</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No findings</td></tr>'}</tbody></table>${advisorySection}<h2>Materials</h2><table><thead><tr><th>Material</th><th>Parts</th><th>Sheets</th><th>Area m&sup2;</th><th>Weight kg</th><th>Cost</th></tr></thead><tbody>${materialRows}</tbody></table>${costSummary}</body></html>`;
}

function serializePartLabelsSvg(labels) {
    const width = 210;
    const labelWidth = 95;
    const labelHeight = 45;
    const columns = 2;
    const rows = Math.ceil(labels.length / columns);
    const height = Math.max(297, 10 + rows * (labelHeight + 5));
    const items = labels.map((label, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = 7 + column * (labelWidth + 6);
        const y = 8 + row * (labelHeight + 5);
        return `<g transform="translate(${x} ${y})"><rect width="${labelWidth}" height="${labelHeight}" fill="none" stroke="#111" stroke-width="0.3"/><text x="4" y="7" font-size="5" font-weight="700">${escapeXml(label.partId)} · ${escapeXml(label.name)}</text><text x="4" y="14" font-size="3.5">${escapeXml(label.material)} · ${label.thicknessMm} mm · qty ${label.quantity}</text><text x="4" y="21" font-size="3.5">Face: ${escapeXml(label.finishedFace)} · Grain: ${escapeXml(label.grainDirection)}</text><text x="4" y="28" font-size="3.2">${escapeXml(label.joints.slice(0, 2).join(' | '))}</text><line x1="4" y1="37" x2="28" y2="37" stroke="#111"/><path d="M28 37 l-4 -2 v4 z" fill="#111"/><text x="32" y="38" font-size="3.2">FRONT / GRAIN</text></g>`;
    }).join('\n');
    return `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><g font-family="sans-serif">${items}</g></svg>`;
}

function serializeAnnotatedShopLayout(manifest, nesting, preflight) {
    const margin = 30;
    let y = margin;
    const sheets = nesting.sheets.map(sheet => {
        const scale = Math.min(0.25, 900 / sheet.widthMm);
        const width = sheet.widthMm * scale;
        const height = sheet.heightMm * scale;
        const parts = sheet.placements.map(placement => `<polygon points="${placement.polygon.map(point => `${format(point.x * scale)},${format(point.y * scale)}`).join(' ')}" fill="none" stroke="#333" stroke-width="1"/><text x="${format((placement.bounds.minX + 4) * scale)}" y="${format((placement.bounds.minY + 14) * scale)}" font-size="9">${escapeXml(placement.partId)}</text>`).join('');
        const group = `<g transform="translate(${margin} ${y})"><text x="0" y="-8" font-size="12" font-weight="700">Sheet ${sheet.index} · ${escapeXml(sheet.materialName)} · ${sheet.utilizationPercent}%</text><rect width="${width}" height="${height}" fill="#fff" stroke="#111" stroke-width="1"/>${parts}</g>`;
        y += height + 45;
        return group;
    }).join('\n');
    const warning = preflight.some(item => item.severity === 'error') ? '<text x="30" y="22" fill="#a00" font-size="14" font-weight="700">REFERENCE ONLY: PREFLIGHT ERRORS PRESENT</text>' : '';
    return `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="960mm" height="${Math.max(300, y)}mm" viewBox="0 0 960 ${Math.max(300, y)}"><rect width="100%" height="100%" fill="#fbfbf8"/>${warning}${sheets}</svg>`;
}

function serializeCalibrationSvg() {
    return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="120mm" viewBox="0 0 120 120"><g id="PROFILE_CUT" data-operation="profileCut" fill="none" stroke="#000" stroke-width="0.1"><rect x="10" y="10" width="100" height="100"/></g></svg>`;
}

function geometryToSvg(geometry, operation, placement, precision) {
    if (!geometry) return '';
    const id = escapeXml(physicalOperationId(operation, placement));
    if (geometry.kind === 'contour' || Array.isArray(geometry.points)) {
        const points = (geometry.points || []).map(point => transformPoint(pointMm(point), placement));
        return polygonToSvg(points, id, precision);
    }
    if (geometry.kind === 'circle') {
        const center = transformPoint(pointMm(geometry.center || geometry), placement);
        const radius = Number(geometry.radiusMm ?? geometry.diameterMm / 2) || 0;
        return `<circle id="${id}" cx="${format(center.x, precision)}" cy="${format(center.y, precision)}" r="${format(radius, precision)}"/>`;
    }
    if (geometry.kind === 'rect') {
        const points = rectanglePoints(geometry).map(point => transformPoint(point, placement));
        return polygonToSvg(points, id, precision);
    }
    if (geometry.kind === 'line') {
        const start = transformPoint(pointMm(geometry.start), placement);
        const end = transformPoint(pointMm(geometry.end), placement);
        return `<line id="${id}" x1="${format(start.x, precision)}" y1="${format(start.y, precision)}" x2="${format(end.x, precision)}" y2="${format(end.y, precision)}"/>`;
    }
    return '';
}

function geometryToDxf(geometry, operation, placement, precision) {
    const layer = operationLayer(operation.type);
    const physicalId = physicalOperationId(operation, placement);
    if (!geometry) return '';
    if (geometry.kind === 'contour' || Array.isArray(geometry.points)) {
        const points = (geometry.points || []).map(point => transformPoint(pointMm(point), placement));
        return polylineDxf(points, layer, physicalId, precision);
    }
    if (geometry.kind === 'circle') {
        const center = transformPoint(pointMm(geometry.center || geometry), placement);
        const radius = Number(geometry.radiusMm ?? geometry.diameterMm / 2) || 0;
        return `0\nCIRCLE\n8\n${layer}\n5\n${dxfHandle(physicalId)}\n10\n${format(center.x, precision)}\n20\n${format(-center.y, precision)}\n30\n0\n40\n${format(radius, precision)}\n`;
    }
    if (geometry.kind === 'rect') {
        const points = rectanglePoints(geometry).map(point => transformPoint(point, placement));
        return polylineDxf(points, layer, physicalId, precision);
    }
    if (geometry.kind === 'line') {
        const start = transformPoint(pointMm(geometry.start), placement);
        const end = transformPoint(pointMm(geometry.end), placement);
        return `0\nLINE\n8\n${layer}\n5\n${dxfHandle(physicalId)}\n10\n${format(start.x, precision)}\n20\n${format(-start.y, precision)}\n30\n0\n11\n${format(end.x, precision)}\n21\n${format(-end.y, precision)}\n31\n0\n`;
    }
    return '';
}

function polylineDxf(points, layer, id, precision) {
    const vertices = points.map(point => `10\n${format(point.x, precision)}\n20\n${format(-point.y, precision)}\n`).join('');
    return `0\nLWPOLYLINE\n8\n${layer}\n5\n${dxfHandle(id)}\n90\n${points.length}\n70\n1\n${vertices}`;
}

function polygonToSvg(points, id, precision) {
    const values = points.map(point => `${format(point.x, precision)},${format(point.y, precision)}`).join(' ');
    return `<polygon id="${escapeXml(id)}" points="${values}"/>`;
}

function transformPoint(point, placement) {
    const radians = Number(placement.rotationDeg || 0) * Math.PI / 180;
    const transform = resolvePlacementTransform(placement);
    const localX = point.x - Number(transform.sourceOrigin.xMm || 0);
    const localY = point.y - Number(transform.sourceOrigin.yMm || 0);
    return {
        x: Number(placement.xMm || 0) + localX * Math.cos(radians) - localY * Math.sin(radians) + Number(transform.localOriginOffset.xMm || 0),
        y: Number(placement.yMm || 0) + localX * Math.sin(radians) + localY * Math.cos(radians) + Number(transform.localOriginOffset.yMm || 0)
    };
}

function resolvePlacementTransform(placement) {
    if (placement.sourceOrigin && placement.localOriginOffset) {
        return { sourceOrigin: placement.sourceOrigin, localOriginOffset: placement.localOriginOffset };
    }
    const sourcePoints = extractPlacementOutline(placement.sourcePart);
    if (sourcePoints.length >= 3) {
        const sourceBounds = polygonBounds(sourcePoints);
        const radians = Number(placement.rotationDeg || 0) * Math.PI / 180;
        const normalized = sourcePoints.map(point => ({ x: point.x - sourceBounds.minX, y: point.y - sourceBounds.minY }));
        const rotated = normalized.map(point => ({
            x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
            y: point.x * Math.sin(radians) + point.y * Math.cos(radians)
        }));
        const rotatedBounds = polygonBounds(rotated);
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

function extractPlacementOutline(part = {}) {
    const points = part.outline?.points || part.contour?.points || part.profilePoints || part.points;
    return Array.isArray(points) ? points.map(pointMm) : [];
}

function physicalOperationId(operation, placement) {
    const instanceId = placement.instanceId || `${placement.partId || operation.partId}:1`;
    const value = `${operation.id || operation.type || 'operation'}--${instanceId}`
        .replace(/[^A-Za-z0-9_.-]+/g, '-');
    return /^[A-Za-z_]/.test(value) ? value : `op-${value}`;
}

function pointMm(value = {}) {
    return { x: Number(value.xMm ?? value.x) || 0, y: Number(value.yMm ?? value.y) || 0 };
}

function rectanglePoints(geometry) {
    const center = pointMm(geometry.center || geometry);
    const halfWidth = Number(geometry.widthMm || 0) / 2;
    const halfHeight = Number(geometry.heightMm || 0) / 2;
    const radius = Math.max(0, Math.min(Number(geometry.cornerRadiusMm || 0), halfWidth, halfHeight));
    const radians = Number(geometry.rotationDeg || 0) * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const localPoints = radius > 0
        ? roundedRectanglePoints(halfWidth, halfHeight, radius)
        : [
            { x: -halfWidth, y: -halfHeight },
            { x: halfWidth, y: -halfHeight },
            { x: halfWidth, y: halfHeight },
            { x: -halfWidth, y: halfHeight }
        ];
    return localPoints.map(point => ({
        x: center.x + point.x * cos - point.y * sin,
        y: center.y + point.x * sin + point.y * cos
    }));
}

function roundedRectanglePoints(halfWidth, halfHeight, radius) {
    const segmentsPerCorner = 8;
    const corners = [
        { x: halfWidth - radius, y: -halfHeight + radius, start: -Math.PI / 2 },
        { x: halfWidth - radius, y: halfHeight - radius, start: 0 },
        { x: -halfWidth + radius, y: halfHeight - radius, start: Math.PI / 2 },
        { x: -halfWidth + radius, y: -halfHeight + radius, start: Math.PI }
    ];
    return corners.flatMap(corner => Array.from({ length: segmentsPerCorner }, (_, index) => {
        const angle = corner.start + Math.PI / 2 * index / segmentsPerCorner;
        return { x: corner.x + Math.cos(angle) * radius, y: corner.y + Math.sin(angle) * radius };
    }));
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

function operationsForPart(manifest, partId) {
    return (manifest.operations || []).filter(operation => operation.partId === partId);
}

function serializeCsv(rows, columns) {
    const header = columns.map(column => csv(column.label)).join(',');
    return [header, ...rows.map(row => columns.map(column => csv(row[column.key] ?? '')).join(','))].join('\r\n');
}

function csv(value) {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function addText(entries, path, data) {
    entries.push({ path, data, mimeType: mimeFor(path) });
}

function mimeFor(path) {
    if (path.endsWith('.svg')) return 'image/svg+xml';
    if (path.endsWith('.json')) return 'application/json';
    if (path.endsWith('.csv')) return 'text/csv';
    if (path.endsWith('.html')) return 'text/html';
    return 'text/plain';
}

function operationLayer(type) {
    return ({ profileCut: 'PROFILE_CUT', throughCut: 'THROUGH_CUT', drill: 'DRILL', pocket: 'POCKET', engrave: 'ENGRAVE' })[type] || 'REFERENCE';
}

function clampPrecision(value) {
    return Math.max(2, Math.min(4, Number(value) || 3));
}

function format(value, precision = 3) {
    return Number((Number(value) || 0).toFixed(precision));
}

function sanitizeName(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'cabinet';
}

function safePath(value) {
    return sanitizeName(value);
}

function escapeXml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function dxfHandle(value) {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(16).toUpperCase();
}

function dosDateTime(date) {
    const year = Math.max(1980, date.getUTCFullYear());
    return {
        time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
        date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
    };
}

function writeU16(view, offset, value) { view.setUint16(offset, value, true); }
function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

function concatenate(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(chunk => { output.set(chunk, offset); offset += chunk.length; });
    return output;
}

function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    return btoa(binary);
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
    const table = new Uint32Array(256);
    for (let index = 0; index < table.length; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
        table[index] = value >>> 0;
    }
    return table;
}

const BOM_COLUMNS = [
    ['partId', 'Part ID'], ['name', 'Name'], ['quantity', 'Quantity'], ['material', 'Material'], ['thicknessMm', 'Thickness mm'],
    ['widthMm', 'Width mm'], ['lengthMm', 'Length mm'], ['areaM2', 'Area m2'], ['grainDirection', 'Grain'], ['finishedFace', 'Finished face'],
    ['perCabinet', 'Per cabinet'], ['batchQuantity', 'Cabinets in batch']
].map(([key, label]) => ({ key, label }));
const CUT_LIST_COLUMNS = [['sheet', 'Sheet'], ['materialId', 'Material ID'], ['partId', 'Part ID'], ['instanceId', 'Instance'], ['name', 'Name'], ['xMm', 'X mm'], ['yMm', 'Y mm'], ['rotationDeg', 'Rotation deg'], ['widthMm', 'Width mm'], ['heightMm', 'Height mm']].map(([key, label]) => ({ key, label }));
const MATERIAL_COLUMNS = [['materialId', 'Material ID'], ['name', 'Material'], ['thicknessMm', 'Thickness mm'], ['sheetWidthMm', 'Sheet width mm'], ['sheetHeightMm', 'Sheet height mm'], ['partCount', 'Parts'], ['sheets', 'Sheets'], ['sheetCost', 'Cost per sheet'], ['areaM2', 'Area m2'], ['weightKg', 'Weight kg'], ['estimatedCost', 'Estimated cost'], ['supplier', 'Supplier'], ['sku', 'SKU']].map(([key, label]) => ({ key, label }));
const JOINT_COLUMNS = [['jointId', 'Joint ID'], ['pointName', 'Point'], ['type', 'Type'], ['partIds', 'Parts'], ['cutPartId', 'Cut part'], ['includedAngleDeg', 'Included angle deg'], ['bevelAngleDeg', 'Bevel angle deg'], ['longFace', 'Long face'], ['allowanceMm', 'Allowance mm']].map(([key, label]) => ({ key, label }));
const FASTENER_COLUMNS = [['fastenerId', 'Fastener ID'], ['kind', 'Kind'], ['partIds', 'Parts'], ['diameterMm', 'Diameter mm'], ['lengthMm', 'Length mm'], ['valid', 'Valid'], ['notes', 'Notes']].map(([key, label]) => ({ key, label }));
const OPERATION_COLUMNS = [['operationId', 'Operation ID'], ['partId', 'Part ID'], ['type', 'Type'], ['purpose', 'Purpose'], ['geometry', 'Geometry'], ['depthMm', 'Depth mm']].map(([key, label]) => ({ key, label }));
const HARDWARE_COLUMNS = [['definitionId', 'Definition ID'], ['category', 'Category'], ['name', 'Hardware'], ['quantity', 'Quantity'], ['unitPrice', 'Unit cost'], ['lineCost', 'Line cost'], ['connector', 'Connector'], ['supplier', 'Supplier'], ['sku', 'SKU'], ['perCabinet', 'Per cabinet'], ['source', 'Source']].map(([key, label]) => ({ key, label }));
const PROCUREMENT_COLUMNS = [['category', 'Category'], ['itemId', 'Item ID'], ['item', 'Item'], ['quantity', 'Quantity'], ['unit', 'Unit'], ['unitCost', 'Unit cost'], ['totalCost', 'Total cost'], ['currency', 'Currency'], ['supplier', 'Supplier'], ['sku', 'SKU'], ['notes', 'Notes']].map(([key, label]) => ({ key, label }));
const WIRING_COLUMNS = [['hardwareId', 'Hardware ID'], ['label', 'Label'], ['connector', 'Connector'], ['encoderInput', 'Encoder input'], ['estimatedLengthMm', 'Estimated length mm']].map(([key, label]) => ({ key, label }));
const ERGONOMICS_COLUMNS = [['id', 'Profile ID'], ['label', 'Profile'], ['heightMm', 'Height mm'], ['eyeHeightMm', 'Eye height mm'], ['elbowHeightMm', 'Elbow height mm'], ['controlDropFromElbowMm', 'Control drop mm'], ['viewingAngleDeg', 'Viewing angle deg'], ['reachDemandMm', 'Reach demand mm']].map(([key, label]) => ({ key, label }));
const TMOULDING_COLUMNS = [['partId', 'Part ID'], ['edgeId', 'Edge'], ['widthMm', 'Trim width mm'], ['slotWidthMm', 'Slot width mm'], ['lengthMm', 'Length mm'], ['orderLengthMm', 'Order length mm'], ['orderLengthM', 'Order length m']].map(([key, label]) => ({ key, label }));
