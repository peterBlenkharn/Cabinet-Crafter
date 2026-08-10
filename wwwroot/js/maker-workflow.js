import {
    DEFAULT_MATERIAL_PROFILES,
    createMaterialProfile,
    normalizeMaterialProfiles,
    summarizeMaterials,
    validateMaterialProfile
} from './materials.js';
import { NESTING_PLAN_VERSION, createNestingPlan, validateNestingPlan } from './nesting.js';
import {
    BUILT_IN_HARDWARE_DEFINITIONS,
    normalizeHardwareLibrary,
    validateHardwareDefinitionInput
} from './hardware-library.js';
import { analyzeArcadeBuild } from './arcade-intelligence.js';
import { requestDesktop } from './project-document.js';
import { normalizeParams } from './cabinet.js';
import {
    buildCostedHardwareSchedule,
    buildProcurementBom,
    createAdditionalHardwareItem,
    normalizeAdditionalHardwareItems,
    normalizeHardwareCostOverrides
} from './procurement.js';
import * as ProjectExporter from './export.js';

const USER_PRESET_KEY = 'cabinet-crafter:user-presets:v1';
const NESTING_STRATEGIES = new Set(['area', 'longest', 'width', 'height', 'voidfill']);
const MAKER_STEPS = Object.freeze(['design', 'hardware', 'review', 'sheets', 'export']);
export const WORKFLOW_STAGE_META = Object.freeze({
    design: Object.freeze({
        title: 'Design', kicker: 'Step 1 of 5',
        description: 'Shape the cabinet, place controls and set the design intent.',
        purpose: 'Purpose: define the cabinet geometry, controls and visible components.',
        definition: 'Done when: dimensions, controls and the visual design are ready for hardware checks.'
    }),
    hardware: Object.freeze({
        title: 'Hardware', kicker: 'Step 2 of 5',
        description: 'Check real arcade components, machining operations, purchasing and underside keepouts.',
        purpose: 'Purpose: confirm that fitted hardware works and capture every purchased component.',
        definition: 'Done when: the control reference, fit findings, quantities and component costs have been reviewed.'
    }),
    review: Object.freeze({
        title: 'Review', kicker: 'Step 3 of 5',
        description: 'Confirm geometry, hardware fit, load paths and fabrication readiness.',
        purpose: 'Purpose: resolve manufacturing findings before committing material stock.',
        definition: 'Done when: all blocking findings are resolved and remaining warnings are understood.'
    }),
    sheets: Object.freeze({
        title: 'Sheets', kicker: 'Step 4 of 5',
        description: 'Assign measured materials and validate true-shape stock layouts and costs.',
        purpose: 'Purpose: turn fabricated parts into a current, costed sheet plan.',
        definition: 'Done when: stock is valid, every part is assigned, layouts are generated and the selected plan is inspected.'
    }),
    export: Object.freeze({
        title: 'Export', kicker: 'Step 5 of 5',
        description: 'Create fabrication files, reports and the total procurement BOM.',
        purpose: 'Purpose: deliver verified project and manufacturing outputs.',
        definition: 'Done when: the required files are saved successfully and their receipt is recorded.'
    })
});
const WORKFLOW_PROGRESS_VERSION = 1;
const WORKFLOW_STAGE_STATUSES = new Set(['confirmed', 'stale']);
const PERSISTED_NESTING_PLAN_VERSION = 1;
const REVIEW_SEVERITIES = new Set(['all', 'error', 'warning', 'info']);
const EXPORT_KINDS = new Set(['draft', 'production', 'package']);
const FINDING_TITLES = Object.freeze({
    HARDWARE_ANALYSIS_FAILED: 'Hardware analysis unavailable',
    HARDWARE_BODY_COLLISION: 'Hardware bodies overlap',
    HARDWARE_DEFINITION_MISSING: 'Hardware definition missing',
    HARDWARE_HOST_MISSING: 'Hardware host panel missing',
    HARDWARE_SERVICE_CLEARANCE: 'Hardware service clearance is limited',
    MATERIAL_ROTATIONS: 'No stock rotation is allowed',
    MATERIAL_STOCK_MARGIN: 'Trim margin consumes the stock',
    MATERIAL_VALUE: 'Material value is invalid',
    NESTING_PLAN_MISSING: 'Sheet layout has not been generated',
    NESTING_PLAN_STALE: 'Sheet layout is out of date',
    REFERENCE_OPERATION_OMITTED: 'Reference operations are excluded from machine files'
});

export function fingerprintWorkflowValue(value) {
    const serialized = JSON.stringify(sortWorkflowValue(value)) ?? 'null';
    let hash = 2166136261;
    for (let index = 0; index < serialized.length; index++) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function fingerprintNestingInputs(manifest = {}, materialProfiles = [], options = {}) {
    const stableManifest = clonePlain(manifest || {});
    delete stableManifest.parameters;
    delete stableManifest.project;
    delete stableManifest.materials;
    delete stableManifest.materialAssignments;
    const stableOptions = clonePlain(options || {});
    delete stableOptions.includeCandidates;
    delete stableOptions.persistedPlan;
    return fingerprintWorkflowValue({
        manifest: stableManifest,
        materials: normalizeMaterialProfiles(materialProfiles),
        options: stableOptions
    });
}

export function normalizeWorkflowProgress(value = {}) {
    const stages = {};
    MAKER_STEPS.forEach(step => {
        const record = value?.stages?.[step];
        if (!record || !WORKFLOW_STAGE_STATUSES.has(record.status)) return;
        const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.trim() : '';
        if (!fingerprint) return;
        stages[step] = {
            status: record.status,
            fingerprint,
            ...(typeof record.confirmedAt === 'string' ? { confirmedAt: record.confirmedAt } : {}),
            ...(typeof record.invalidatedAt === 'string' ? { invalidatedAt: record.invalidatedAt } : {})
        };
    });
    return { version: WORKFLOW_PROGRESS_VERSION, stages };
}

export function getFindingTitle(finding = {}) {
    const supplied = String(finding.title || '').trim();
    if (supplied) return supplied;
    const code = String(finding.code || '').trim().toUpperCase();
    if (FINDING_TITLES[code]) return FINDING_TITLES[code];
    if (!code) return 'Fabrication finding';
    const words = code.toLowerCase().replace(/[_-]+/g, ' ');
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function buildWorkflowStageState(step, context = {}) {
    const index = MAKER_STEPS.indexOf(step);
    if (index < 0) {
        return {
            step,
            status: 'unavailable',
            canConfirm: false,
            blockers: [{ code: 'WORKFLOW_STAGE_UNKNOWN', message: 'This workflow stage is unavailable.', action: null }],
            reason: 'This workflow stage is unavailable.',
            nextAction: null
        };
    }

    const completed = context.completedStages instanceof Set
        ? context.completedStages
        : new Set(context.completedStages || []);
    const stageRecords = context.stageRecords || {};
    const blockers = [];
    const previous = MAKER_STEPS[index - 1];
    if (previous && !completed.has(previous)) {
        blockers.push({
            code: 'WORKFLOW_PREVIOUS_STAGE',
            message: `Confirm ${readable(previous)} before confirming ${readable(step)}.`,
            action: previous,
            actionLabel: `Open ${readable(previous)}`
        });
    }

    if (step === 'hardware') {
        if (context.hardwareAnalysisAvailable === false) {
            blockers.push({
                code: 'WORKFLOW_HARDWARE_UNAVAILABLE',
                message: 'Hardware analysis is unavailable. Return to Controls and verify the current layout.',
                action: 'control-editor',
                actionLabel: 'Open Controls editor'
            });
        } else {
            const errorCount = Math.max(0, Number(context.hardwareErrorCount) || 0);
            if (errorCount) {
                blockers.push({
                    code: 'WORKFLOW_HARDWARE_ERRORS',
                    message: `Resolve ${errorCount} blocking hardware error${errorCount === 1 ? '' : 's'} before manufacturing review.`,
                    action: context.hardwareRepairAction || 'control-editor',
                    actionLabel: context.hardwareRepairActionLabel || 'Open Controls editor'
                });
            }
        }
    }

    if (step === 'review') {
        const errorCount = Math.max(
            Number(context.reviewErrorCount) || 0,
            context.reviewBlocked ? 1 : 0
        );
        if (errorCount) {
            blockers.push({
                code: 'WORKFLOW_REVIEW_ERRORS',
                message: `Resolve ${errorCount} blocking review error${errorCount === 1 ? '' : 's'} before sheet planning.`,
                action: 'review-first-error',
                actionLabel: 'Review first error'
            });
        }
    }

    if (step === 'sheets') {
        if (context.nestingBusy) {
            blockers.push({
                code: 'WORKFLOW_NESTING_BUSY',
                message: 'Wait for sheet layout generation to finish, or cancel it.',
                action: 'cancel-nesting',
                actionLabel: 'Cancel generation'
            });
        } else if (context.sheetReadiness?.ok === false) {
            const status = context.sheetReadiness.status || 'invalid';
            const firstError = (context.sheetReadiness.findings || []).find(item => item.severity === 'error');
            blockers.push({
                code: `WORKFLOW_SHEETS_${String(status).toUpperCase()}`,
                message: firstError?.message || 'Resolve the sheet-plan errors before confirming this stage.',
                action: status === 'missing' || status === 'stale' ? 'generate-sheets' : 'fix-sheets',
                actionLabel: status === 'missing' ? 'Generate layouts' : status === 'stale' ? 'Regenerate layouts' : 'Review sheet settings'
            });
        }
    }

    const confirmed = completed.has(step);
    const stale = !confirmed && stageRecords[step]?.status === 'stale';
    const status = confirmed ? 'confirmed' : stale ? 'stale' : blockers.length ? 'blocked' : 'ready';
    return {
        step,
        status,
        canConfirm: blockers.length === 0,
        blockers,
        reason: blockers[0]?.message || '',
        nextAction: blockers[0]?.action || null,
        nextActionLabel: blockers[0]?.actionLabel || ''
    };
}

export function buildHardwareStatusModel(analysis = {}, context = {}) {
    const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
    const counts = countWorkflowFindings(findings);
    const stage = buildWorkflowStageState('hardware', {
        ...context,
        hardwareAnalysisAvailable: Boolean(analysis && Object.keys(analysis).length),
        hardwareErrorCount: counts.error
    });
    return {
        stage,
        counts,
        detectedItems: Number(analysis.summary?.hardwareItems) || 0,
        uniqueTypes: Array.isArray(analysis.hardwareSchedule) ? analysis.hardwareSchedule.length : 0,
        status: counts.error ? 'blocked' : counts.warning ? 'check' : 'ready',
        label: counts.error
            ? `${counts.error} hardware error${counts.error === 1 ? '' : 's'}`
            : counts.warning
                ? `${counts.warning} hardware warning${counts.warning === 1 ? '' : 's'}`
                : 'Hardware analysis ready'
    };
}

export function renderHardwareLayoutReference(manifest = {}, analysis = {}) {
    const parts = new Map((manifest.parts || []).map(part => [part.id, part]));
    const instances = Array.isArray(analysis.hardwareInstances) ? analysis.hardwareInstances : [];
    const panels = [
        { id: 'panel_cp', label: 'Control deck', empty: 'No deck controls are enabled.' },
        { id: 'panel_apron', label: 'Front apron', empty: 'No apron controls are enabled.' }
    ];
    return panels.map(panel => {
        const part = parts.get(panel.id);
        const items = instances.filter(item => item.partId === panel.id);
        const width = Math.max(1, Number(part?.dimensions?.widthMm) || 1);
        const height = Math.max(1, Number(part?.dimensions?.lengthMm) || 1);
        const markerRadius = Math.max(6, Math.min(16, Math.min(width, height) * 0.055));
        const shapes = items.map((item, index) => {
            const x = clampNumber(Number(item.xMm) || 0, 0, width);
            const y = clampNumber(height - (Number(item.yMm) || 0), 0, height);
            const joystick = String(item.definitionId || '').includes('joystick');
            const label = joystick ? 'J' : String(index + 1);
            const title = escapeHtml(item.label || item.definitionId || 'Control');
            return `<g><title>${title}</title>${joystick
                ? `<rect x="${round(x - markerRadius, 2)}" y="${round(y - markerRadius, 2)}" width="${round(markerRadius * 2, 2)}" height="${round(markerRadius * 2, 2)}" rx="2" fill="#181816"/>`
                : `<circle cx="${round(x, 2)}" cy="${round(y, 2)}" r="${round(markerRadius, 2)}" fill="#fffefa" stroke="#181816" stroke-width="2"/>`}<text x="${round(x, 2)}" y="${round(y + markerRadius * 0.35, 2)}" text-anchor="middle" font-size="${round(markerRadius * 0.9, 2)}" font-family="monospace" font-weight="700" fill="${joystick ? '#ffffff' : '#181816'}">${label}</text></g>`;
        }).join('');
        const accessibleLabel = `${panel.label}: ${items.length} fitted control${items.length === 1 ? '' : 's'}`;
        return `<article class="hardware-layout-panel">
            <div class="hardware-layout-panel-heading"><strong>${panel.label}</strong><span>${items.length} fitted</span></div>
            ${part ? `<svg role="img" aria-label="${escapeAttr(accessibleLabel)}" viewBox="0 0 ${round(width, 2)} ${round(height, 2)}" preserveAspectRatio="xMidYMid meet">
                <title>${escapeHtml(accessibleLabel)}</title>
                <rect x="1" y="1" width="${round(Math.max(0, width - 2), 2)}" height="${round(Math.max(0, height - 2), 2)}" fill="#f7f7f4" stroke="#71716b" stroke-width="2"/>
                <line x1="1" y1="${round(Math.max(1, height - 2), 2)}" x2="${round(Math.max(1, width - 1), 2)}" y2="${round(Math.max(1, height - 2), 2)}" stroke="#8a5a00" stroke-width="4"/>
                ${shapes}
            </svg>` : `<div class="maker-empty-state"><strong>Panel unavailable</strong><span>${panel.empty}</span></div>`}
            <span class="hardware-layout-legend">Front edge is marked in amber. Edit positions in Design &gt; Controls.</span>
        </article>`;
    }).join('');
}

export function buildWorkflowStagePresentation(step, state = {}) {
    const meta = WORKFLOW_STAGE_META[step] || WORKFLOW_STAGE_META.design;
    const status = state.status || 'ready';
    const stateText = status === 'confirmed'
        ? 'State: confirmed.'
        : status === 'stale'
            ? 'State: needs reconfirmation because upstream details changed.'
            : status === 'blocked'
                ? `State: blocked. ${state.reason || 'Resolve the required action before continuing.'}`
                : 'State: ready to confirm.';
    return { ...meta, stateText };
}

export function buildReviewViewModel(findings = [], options = {}) {
    const query = String(options.query || '').trim().toLowerCase();
    const severity = REVIEW_SEVERITIES.has(options.severity) ? options.severity : 'all';
    const normalized = (Array.isArray(findings) ? findings : []).map((finding, sourceIndex) => {
        const normalizedSeverity = ['error', 'warning', 'info'].includes(finding?.severity) ? finding.severity : 'info';
        return {
            ...finding,
            sourceIndex,
            severity: normalizedSeverity,
            title: getFindingTitle(finding)
        };
    });
    const counts = countWorkflowFindings(normalized);
    const visibleFindings = normalized.filter(finding => {
        if (severity !== 'all' && finding.severity !== severity) return false;
        if (!query) return true;
        const searchable = [
            finding.title,
            finding.code,
            finding.message,
            finding.correctiveAction,
            finding.remedy,
            ...(finding.partIds || [])
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(query);
    });
    return {
        query,
        severity,
        counts,
        totalCount: normalized.length,
        visibleCount: visibleFindings.length,
        findings: visibleFindings,
        status: counts.error ? 'blocked' : counts.warning ? 'check' : 'ready',
        statusLabel: counts.error ? 'Blocked' : counts.warning ? 'Check warnings' : 'Ready'
    };
}

export function buildSheetWorkflowState(context = {}) {
    const materialFindings = Array.isArray(context.materialFindings) ? context.materialFindings : [];
    const assignmentFindings = Array.isArray(context.assignmentFindings) ? context.assignmentFindings : [];
    const materialErrors = materialFindings.filter(item => item.severity === 'error').length;
    const assignmentErrors = assignmentFindings.filter(item => item.severity === 'error').length;
    const readiness = context.readiness || { ok: false, status: 'missing', findings: [] };
    const planReady = readiness.ok === true;
    const elapsedMs = context.startedAt
        ? Math.max(0, Number(context.now ?? Date.now()) - Number(context.startedAt))
        : 0;
    const steps = [
        {
            id: 'stock',
            label: 'Stock',
            status: materialErrors ? 'blocked' : 'complete',
            detail: materialErrors ? `Fix ${materialErrors} material error${materialErrors === 1 ? '' : 's'}.` : 'Material profiles are valid.'
        },
        {
            id: 'assign',
            label: 'Assign',
            status: materialErrors ? 'waiting' : assignmentErrors ? 'blocked' : 'complete',
            detail: materialErrors ? 'Finish stock setup first.' : assignmentErrors ? `Fix ${assignmentErrors} assignment error${assignmentErrors === 1 ? '' : 's'}.` : 'Fabricated parts have compatible stock.'
        },
        {
            id: 'generate',
            label: 'Generate',
            status: context.busy ? 'in-progress' : planReady ? 'complete' : readiness.status === 'invalid' ? 'blocked' : 'ready',
            detail: context.busy
                ? `Generating layouts${elapsedMs >= 1000 ? `, ${Math.floor(elapsedMs / 1000)} seconds elapsed` : ''}.`
                : planReady ? 'A current validated layout is available.' : readiness.status === 'stale' ? 'Regenerate the out-of-date layout.' : readiness.status === 'invalid' ? 'The generated layout needs correction.' : 'Generate ranked layouts.'
        },
        {
            id: 'inspect',
            label: 'Inspect',
            status: planReady ? 'ready' : 'waiting',
            detail: planReady ? 'Inspect the selected candidate and each sheet.' : 'A valid generated layout is required.'
        },
        {
            id: 'confirm',
            label: 'Confirm',
            status: context.confirmed ? 'complete' : planReady ? 'ready' : 'waiting',
            detail: context.confirmed ? 'The sheet plan is confirmed.' : planReady ? 'Confirm the selected plan when inspection is complete.' : 'Resolve the earlier steps first.'
        }
    ];
    return {
        status: context.confirmed ? 'confirmed' : context.busy ? 'busy' : planReady ? 'ready' : materialErrors || assignmentErrors || readiness.status === 'invalid' ? 'blocked' : readiness.status,
        elapsedMs,
        steps,
        nextStep: steps.find(step => step.status !== 'complete') || null
    };
}

export function describeNestingCandidates(candidates = [], selectedStrategy = null) {
    const rankingBasis = 'Ranked by unplaced parts, then sheet count, waste, reusable offcut and strategy name.';
    return (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
        const sheetCount = Number(candidate.sheetCount) || 0;
        const unplacedCount = Number(candidate.unplacedCount) || 0;
        const wasteAreaMm2 = Number(candidate.wasteAreaMm2) || 0;
        const utilizationPercent = Number(candidate.utilizationPercent) || 0;
        const summary = `${sheetCount} sheet${sheetCount === 1 ? '' : 's'}, ${utilizationPercent}% utilisation, ${round(wasteAreaMm2 / 1e6, 2)} m² waste`;
        const reason = unplacedCount
            ? `Rank ${index + 1} leaves ${unplacedCount} part${unplacedCount === 1 ? '' : 's'} unplaced. ${rankingBasis}`
            : index === 0
                ? `Ranked first because it has no unplaced parts and wins the ordered comparison. ${rankingBasis}`
                : `Ranked ${index + 1} by the ordered comparison. ${rankingBasis}`;
        return {
            ...candidate,
            rank: index + 1,
            selected: candidate.strategy === selectedStrategy,
            summary,
            reason
        };
    });
}

export function buildExportReadinessModel(context = {}) {
    const preflightFindings = Array.isArray(context.preflightFindings) ? context.preflightFindings : [];
    const sheetReadiness = context.sheetReadiness || {
        ok: false,
        status: 'missing',
        findings: [{ code: 'NESTING_PLAN_MISSING', severity: 'error', message: 'Generate a sheet layout before creating a fabrication package.' }]
    };
    const packageFindings = Array.isArray(context.packageFindings) ? context.packageFindings : [];
    const acknowledged = Boolean(context.warningsAcknowledged);
    const preflightCounts = countWorkflowFindings(preflightFindings);
    const sheetFindings = Array.isArray(sheetReadiness.findings) ? sheetReadiness.findings : [];
    const productionBlocked = preflightCounts.error > 0 || (preflightCounts.warning > 0 && !acknowledged);
    const combinedPackageFindings = [...preflightFindings, ...sheetFindings, ...packageFindings];
    const packageCounts = countWorkflowFindings(combinedPackageFindings);
    const packageBlocked = sheetReadiness.ok !== true
        || packageCounts.error > 0
        || (packageCounts.warning > 0 && !acknowledged);
    const outputs = {
        draft: {
            kind: 'draft',
            status: 'available',
            label: 'Available',
            available: true,
            reason: 'Annotated draft SVG is available even when production findings remain.',
            counts: preflightCounts,
            findings: preflightFindings
        },
        production: {
            kind: 'production',
            status: productionBlocked ? preflightCounts.error ? 'blocked' : 'review' : 'ready',
            label: productionBlocked ? preflightCounts.error ? 'Blocked' : 'Review warnings' : 'Ready',
            available: !productionBlocked,
            reason: productionBlocked
                ? preflightCounts.error ? firstFindingMessage(preflightFindings, 'Resolve production errors before export.') : 'Review and acknowledge production warnings before export.'
                : 'Machine geometry is ready to export.',
            counts: preflightCounts,
            findings: preflightFindings,
            action: preflightCounts.error ? 'review' : productionBlocked ? 'acknowledge-warnings' : null
        },
        package: {
            kind: 'package',
            status: packageBlocked ? packageCounts.error || sheetReadiness.ok !== true ? 'blocked' : 'review' : 'ready',
            label: packageBlocked ? packageCounts.error || sheetReadiness.ok !== true ? 'Blocked' : 'Review warnings' : 'Ready',
            available: !packageBlocked,
            reason: packageBlocked
                ? sheetReadiness.ok !== true ? firstFindingMessage(sheetFindings, 'Generate and validate a current sheet layout.') : packageCounts.error ? firstFindingMessage(combinedPackageFindings, 'Resolve fabrication package errors before export.') : 'Review and acknowledge fabrication package warnings before export.'
                : 'The fabrication package and sheet plan are ready to export.',
            counts: packageCounts,
            findings: combinedPackageFindings,
            action: sheetReadiness.ok !== true ? 'sheets' : packageCounts.error ? 'review' : packageBlocked ? 'acknowledge-warnings' : null
        }
    };
    const availableCount = Object.values(outputs).filter(output => output.available).length;
    return {
        status: availableCount === 3 ? 'ready' : availableCount ? 'partial' : 'blocked',
        label: availableCount === 3 ? 'All outputs ready' : `${availableCount} of 3 outputs available`,
        availableCount,
        outputs
    };
}

export function normalizeExportReceipt(value = {}, now = new Date()) {
    const kind = EXPORT_KINDS.has(value.kind) ? value.kind : 'draft';
    const findings = Array.isArray(value.findings) ? value.findings : [];
    const timestamp = value.timestamp || value.completedAt || now.toISOString();
    return {
        version: 1,
        kind,
        label: kind === 'draft' ? 'Annotated draft SVG' : kind === 'production' ? 'Production SVG' : 'Fabrication package',
        delivered: value.delivered !== false,
        filename: String(value.filename || ''),
        path: String(value.path || value.filePath || ''),
        sizeBytes: Math.max(0, Number(value.sizeBytes ?? value.byteLength) || 0),
        timestamp,
        preflightStatus: value.preflightStatus || (findings.some(item => item.severity === 'error') ? 'blocked' : findings.some(item => item.severity === 'warning') ? 'warnings' : 'ready'),
        counts: countWorkflowFindings(findings),
        openFolderAvailable: Boolean(value.path || value.filePath),
        findings: clonePlain(findings)
    };
}

export function renderWorkflowStatusMarkup(state = {}) {
    if (!state.reason) return '';
    const action = state.nextAction && state.nextActionLabel
        ? `<button class="btn btn-secondary btn-sm" type="button" data-workflow-repair="${escapeAttr(state.nextAction)}">${escapeHtml(state.nextActionLabel)}</button>`
        : '';
    return `<span>${escapeHtml(state.reason)}</span>${action}`;
}

export function renderExportReadinessMarkup(model = {}) {
    const outputs = model.outputs || {};
    return `<div class="preflight-status ${model.status === 'ready' ? 'ok' : 'blocked'}">
        <strong>${escapeHtml(model.label || 'Export readiness unavailable')}</strong>
    </div>${['draft', 'production', 'package'].map(kind => {
        const output = outputs[kind];
        if (!output) return '';
        return `<div class="preflight-status ${output.available ? 'ok' : 'blocked'}" data-export-output-status="${kind}">
            <strong>${escapeHtml(output.label)}</strong>
            <span>${escapeHtml(output.reason)}</span>
        </div>`;
    }).join('')}`;
}

export class MakerWorkflow {
    constructor(ui) {
        this.ui = ui;
        this.app = ui.app;
        this.cabinet = ui.cabinet;
        this.dialog = document.getElementById('maker-workspace-dialog');
        this.projectDialog = document.getElementById('project-tools-dialog');
        this.currentPlan = null;
        this.currentManifest = null;
        this.currentPlanInputFingerprint = null;
        this.assignmentFindings = [];
        this.nestingStale = true;
        this.selectedSheetId = null;
        this.selectedPlacementId = null;
        this.activeView = 'design';
        this.completedStages = new Set();
        this.nestingRequestId = 0;
        this.activeNestingTask = null;
        this.nestingBusy = false;
        this.makerReturnFocus = null;
        this.reviewBlocked = false;
        this.reviewResults = [];
        this.reviewFilter = { query: '', severity: 'all' };
        this.hardwareAnalysis = null;
        this.nestingStartedAt = null;
        this.nestingElapsedTimer = null;
        this.lastNestingElapsedMs = 0;
        this.lastExportReceipt = null;
        this.ensureProjectState();
        // Establish stock identity before UI history and the first production
        // preflight are captured. This keeps ordinary Review/export checks on
        // the same real profiles used later by the Sheets workspace.
        try {
            this.ensureAssignments(this.cabinet.getFabricationManifest());
        } catch (error) {
            console.warn('Default material assignments could not be initialized', error);
        }
        this.bindNavigation();
        this.bindWorkspace();
        this.bindProjectTools();
    }

    ensureProjectState() {
        const params = this.cabinet.params;
        if (!Array.isArray(params.materials) || !params.materials.length) {
            params.materials = DEFAULT_MATERIAL_PROFILES.map(profile => ({ ...profile }));
        }
        const primaryThickness = Number(params.thickness) || 18;
        if (!params.materials.some(profile => Math.abs(Number(profile.measuredThicknessMm) - primaryThickness) <= 0.75)) {
            params.materials.push(createMaterialProfile({
                id: `sheet-material-${String(primaryThickness).replace(/\./g, '-')}`,
                name: `Sheet material ${primaryThickness} mm`,
                nominalThicknessMm: primaryThickness,
                measuredThicknessMm: primaryThickness,
                grainDirection: 'none'
            }));
        }
        if (!params.fabricationSettings || typeof params.fabricationSettings !== 'object') {
            params.fabricationSettings = {};
        }
        const settings = params.fabricationSettings;
        if (!settings.materialAssignments || typeof settings.materialAssignments !== 'object') {
            settings.materialAssignments = {};
        }
        settings.currencyCode = /^[A-Z]{3}$/.test(String(settings.currencyCode || '').toUpperCase())
            ? String(settings.currencyCode).toUpperCase()
            : 'GBP';
        settings.hardwareCosts = normalizeHardwareCostOverrides(settings.hardwareCosts);
        settings.additionalHardware = normalizeAdditionalHardwareItems(settings.additionalHardware);
        if (!settings.nesting || typeof settings.nesting !== 'object') settings.nesting = {};
        if (!NESTING_STRATEGIES.has(settings.nesting.selectedStrategy) && NESTING_STRATEGIES.has(settings.nestingStrategy)) {
            settings.nesting.selectedStrategy = settings.nestingStrategy;
        }
        if (!NESTING_STRATEGIES.has(settings.nesting.selectedStrategy)) settings.nesting.selectedStrategy = 'area';
        if (!settings.nesting.placementOverrides || typeof settings.nesting.placementOverrides !== 'object') {
            settings.nesting.placementOverrides = {};
        }
        settings.workflow = normalizeWorkflowProgress(settings.workflow);
        if (!Array.isArray(params.hardwareDefinitions)) params.hardwareDefinitions = [];
        this.app.params = this.cabinet.params;
    }

    bindNavigation() {
        this.navButtons = Array.from(document.querySelectorAll('[data-maker-step]'));
        this.navButtons.forEach((button, index) => {
            button.dataset.stepNumber = String(index + 1);
        });
        this.navButtons.forEach(button => button.addEventListener('click', () => this.navigate(button.dataset.makerStep)));
        document.getElementById('btn-design-continue')?.addEventListener('click', () => this.commitAndNavigate('design', 'hardware'));
        document.getElementById('btn-export')?.addEventListener('click', () => this.setActiveStep('export'));
        this.renderStepState();
    }

    bindWorkspace() {
        document.getElementById('btn-close-maker-workspace')?.addEventListener('click', () => this.closeWorkspace());
        this.dialog?.addEventListener('click', event => {
            if (event.target === this.dialog) this.closeWorkspace();
        });
        this.dialog?.addEventListener('close', () => {
            const returnFocus = this.makerReturnFocus;
            this.makerReturnFocus = null;
            if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') {
                window.setTimeout(() => returnFocus.focus(), 0);
            }
        });
        document.getElementById('btn-focus-control-design')?.addEventListener('click', () => {
            this.openControlEditor();
        });
        document.getElementById('btn-add-hardware-item')?.addEventListener('click', () => this.addAdditionalHardwareItem());
        document.getElementById('hardware-current-schedule')?.addEventListener('change', event => this.handleHardwareCostChange(event));
        document.getElementById('additional-hardware-list')?.addEventListener('change', event => this.handleAdditionalHardwareChange(event));
        document.getElementById('additional-hardware-list')?.addEventListener('click', event => this.handleAdditionalHardwareAction(event));
        document.getElementById('btn-hardware-continue')?.addEventListener('click', () => this.commitAndNavigate('hardware', 'review'));
        document.getElementById('btn-review-back')?.addEventListener('click', () => this.open('hardware'));
        document.getElementById('btn-review-continue')?.addEventListener('click', () => this.commitAndNavigate('review', 'sheets'));
        document.getElementById('btn-sheets-continue')?.addEventListener('click', () => this.commitAndNavigate('sheets', 'export'));

        document.getElementById('hardware-library-search')?.addEventListener('input', event => {
            this.renderHardwareLibrary(event.target.value);
        });
        document.getElementById('hardware-library-list')?.addEventListener('click', event => {
            this.handleHardwareLibraryAction(event);
        });
        document.getElementById('hardware-definition-import')?.addEventListener('change', event => this.importHardwareDefinitions(event));

        document.getElementById('btn-add-material')?.addEventListener('click', () => this.addMaterialProfile());
        document.getElementById('btn-regenerate-nest')?.addEventListener('click', () => {
            if (this.nestingBusy) return;
            this.invalidateFrom('sheets');
            this.generateNesting({ announce: true });
        });
        document.getElementById('nesting-candidate-select')?.addEventListener('change', event => {
            this.invalidateFrom('sheets');
            this.fabricationSettings.nesting.selectedStrategy = event.target.value;
            this.markProjectMutation('Choose nesting candidate');
            this.generateNesting({ strategy: event.target.value });
        });
        document.getElementById('nesting-sheet-select')?.addEventListener('change', event => {
            this.selectedSheetId = event.target.value;
            this.selectedPlacementId = null;
            this.renderNestingPlan();
        });

        document.getElementById('material-profile-list')?.addEventListener('change', event => this.handleMaterialChange(event));
        document.getElementById('material-profile-list')?.addEventListener('click', event => this.handleMaterialClick(event));
        document.getElementById('part-material-assignment-list')?.addEventListener('change', event => this.handleAssignmentChange(event));
        document.getElementById('part-material-assignment-list')?.addEventListener('click', event => this.handleAssignmentClick(event));
        document.getElementById('nesting-sheet-list')?.addEventListener('click', event => {
            const restore = event.target.closest('[data-restore-fabrication-part]');
            if (restore) {
                this.cabinet.setPanelIncluded?.(restore.dataset.restoreFabricationPart, true);
                this.ui.afterCabinetMutation?.('Restore part to fabrication');
                this.generateNesting({ strategy: this.currentPlan?.selectedStrategy, announce: true });
                return;
            }
            const placement = event.target.closest('[data-sheet-placement]');
            if (placement) {
                this.selectedSheetId = placement.dataset.sheetId;
                this.selectedPlacementId = placement.dataset.sheetPlacement;
                this.renderNestingPlan();
                document.getElementById('nesting-placement-editor')?.querySelector('input')?.focus();
                return;
            }
            const card = event.target.closest('[data-sheet-id]');
            if (!card) return;
            this.selectedSheetId = card.dataset.sheetId;
            this.selectedPlacementId = null;
            this.renderNestingPlan();
        });
        document.getElementById('nesting-placement-editor')?.addEventListener('change', event => this.handlePlacementEdit(event));
        document.getElementById('nesting-placement-editor')?.addEventListener('click', event => this.handlePlacementAction(event));
        document.getElementById('nesting-svg-wrap')?.addEventListener('click', event => this.selectPlacement(event.target.closest('[data-placement-id]')?.dataset.placementId));
        document.getElementById('nesting-svg-wrap')?.addEventListener('keydown', event => {
            if (!['Enter', ' '].includes(event.key)) return;
            const shape = event.target.closest('[data-placement-id]');
            if (!shape) return;
            event.preventDefault();
            this.selectPlacement(shape.dataset.placementId);
        });
        this.ensureNestingCancelButton();
    }

    bindProjectTools() {
        document.getElementById('btn-project-tools')?.addEventListener('click', () => this.openProjectTools());
        document.getElementById('btn-close-project-tools')?.addEventListener('click', () => this.projectDialog?.close());
        this.projectDialog?.addEventListener('click', event => {
            if (event.target === this.projectDialog) this.projectDialog.close();
        });
        document.getElementById('user-preset-form')?.addEventListener('submit', event => {
            event.preventDefault();
            this.saveUserPreset();
        });
        document.getElementById('user-preset-list')?.addEventListener('click', event => this.handleUserPresetAction(event));
        document.getElementById('recent-project-list')?.addEventListener('click', event => {
            const button = event.target.closest('[data-recent-path]');
            if (button) this.openRecentProject(button.dataset.recentPath);
        });
    }

    get fabricationSettings() {
        this.ensureProjectState();
        return this.cabinet.params.fabricationSettings;
    }

    get materials() {
        this.ensureProjectState();
        return this.cabinet.params.materials;
    }

    get workflowProgress() {
        const settings = this.fabricationSettings;
        settings.workflow = normalizeWorkflowProgress(settings.workflow);
        return settings.workflow;
    }

    navigate(step) {
        if (step === 'design') {
            this.setActiveStep(step);
            document.querySelector('.sidebar-left')?.scrollTo?.({ top: 0, behavior: 'smooth' });
            const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'structure';
            this.ui.activateTab?.(activeTab, true);
            return;
        }
        if (step === 'review') {
            this.open('review');
            return;
        }
        if (step === 'export') {
            this.setActiveStep(step);
            this.ui.openExportDialog?.();
            return;
        }
        if (step === 'hardware' || step === 'sheets') this.open(step);
    }

    setActiveStep(step) {
        this.activeView = step;
        this.renderStepState();
    }

    canConfirmStage(step, { notify = false } = {}) {
        const state = this.getStageActionState(step);
        if (!state.canConfirm && notify) this.ui.showNotification?.(state.reason);
        return state.canConfirm;
    }

    confirmStage(step, options = {}) {
        if (!this.canConfirmStage(step, { ...options, notify: options.notify !== false })) return false;
        if (step === 'sheets' && !this.persistCurrentNestingPlan()) {
            if (options.notify !== false) this.ui.showNotification?.('The validated sheet plan could not be stored with this project');
            return false;
        }
        const progress = this.workflowProgress;
        progress.stages[step] = {
            status: 'confirmed',
            fingerprint: this.computeStageFingerprint(step),
            confirmedAt: new Date().toISOString()
        };
        this.completedStages.add(step);
        if (options.persist !== false) this.markProjectMutation?.(`Confirm ${readable(step)} stage`);
        this.renderStepState();
        return true;
    }

    commitAndNavigate(step, nextStep) {
        this.ui.flushPendingCabinetUpdate?.();
        this.ui.flushPendingArtworkUpdate?.();
        if (!this.confirmStage(step)) return false;
        this.navigate(nextStep);
        return true;
    }

    invalidateFrom(step) {
        const startIndex = MAKER_STEPS.indexOf(step);
        if (startIndex < 0) return;
        const progress = this.workflowProgress;
        const invalidatedAt = new Date().toISOString();
        MAKER_STEPS.slice(startIndex).forEach(stage => {
            this.completedStages.delete(stage);
            const record = progress.stages[stage];
            if (record) progress.stages[stage] = { ...record, status: 'stale', invalidatedAt };
        });
        this.renderStepState();
    }

    captureProgressState() {
        return {
            activeView: this.activeView,
            completedStages: [...this.completedStages],
            workflowProgress: clonePlain(this.workflowProgress),
            dialogOpen: Boolean(this.dialog?.open)
        };
    }

    restoreProgressState(snapshot) {
        if (!snapshot) return;
        if (snapshot.workflowProgress) {
            this.fabricationSettings.workflow = normalizeWorkflowProgress(snapshot.workflowProgress);
        } else {
            const restored = normalizeWorkflowProgress();
            (snapshot.completedStages || []).filter(stage => MAKER_STEPS.includes(stage)).forEach(stage => {
                restored.stages[stage] = {
                    status: 'confirmed',
                    fingerprint: this.computeStageFingerprint(stage),
                    confirmedAt: new Date().toISOString()
                };
            });
            this.fabricationSettings.workflow = restored;
        }
        this.completedStages = new Set((snapshot.completedStages || []).filter(stage => (
            MAKER_STEPS.includes(stage)
            && this.fabricationSettings.workflow.stages[stage]?.status === 'confirmed'
        )));
        const activeView = MAKER_STEPS.includes(snapshot.activeView) ? snapshot.activeView : 'design';
        if (snapshot.dialogOpen && ['hardware', 'review', 'sheets'].includes(activeView)) {
            this.open(activeView);
        } else {
            this.closeWorkspace({ restoreFocus: false });
            this.setActiveStep(activeView);
        }
    }

    getStageStatus(step) {
        if (this.completedStages.has(step)) return 'confirmed';
        return this.workflowProgress.stages[step]?.status === 'stale' ? 'stale' : 'pending';
    }

    getStageActionState(step) {
        let stageRecords = {};
        try { stageRecords = this.workflowProgress.stages; } catch (_) { stageRecords = {}; }
        const reviewErrorCount = (this.reviewResults || []).filter(item => item.severity === 'error').length;
        const hardwareErrors = (this.hardwareAnalysis?.findings || []).filter(item => item.severity === 'error');
        const firstHardwareError = hardwareErrors[0] || null;
        const context = {
            completedStages: this.completedStages || new Set(),
            stageRecords,
            reviewBlocked: Boolean(this.reviewBlocked),
            reviewErrorCount,
            nestingBusy: Boolean(this.nestingBusy),
            hardwareAnalysisAvailable: this.hardwareAnalysis !== null,
            hardwareErrorCount: hardwareErrors.length,
            hardwareRepairAction: hardwareFindingUsesControlEditor(firstHardwareError) ? 'control-editor' : 'hardware-first-error',
            hardwareRepairActionLabel: hardwareFindingUsesControlEditor(firstHardwareError)
                ? 'Open Controls editor'
                : firstHardwareError?.field
                    ? 'Edit relevant setting'
                    : 'Inspect first error'
        };
        if (step === 'sheets' && context.completedStages.has('review') && !context.nestingBusy) {
            context.sheetReadiness = this.getExportReadiness();
        }
        return buildWorkflowStageState(step, context);
    }

    renderStageActionState(step) {
        const buttonId = {
            hardware: 'btn-hardware-continue',
            review: 'btn-review-continue',
            sheets: 'btn-sheets-continue'
        }[step];
        if (!buttonId) return null;
        const button = document.getElementById(buttonId);
        const state = this.getStageActionState(step);
        if (button) {
            button.disabled = !state.canConfirm;
            button.title = state.reason;
            button.setAttribute?.('aria-disabled', String(!state.canConfirm));
        }
        const statusId = `workflow-${step}-action-status`;
        const status = ensureWorkflowActionStatus(button, statusId);
        if (status) {
            status.hidden = !state.reason;
            status.innerHTML = renderWorkflowStatusMarkup(state);
            if (state.reason) button?.setAttribute?.('aria-describedby', statusId);
            else if (button?.getAttribute?.('aria-describedby') === statusId) button.removeAttribute('aria-describedby');
            status.querySelector?.('[data-workflow-repair]')?.addEventListener('click', () => {
                this.runWorkflowRepairAction(state.nextAction);
            });
        }
        return state;
    }

    runWorkflowRepairAction(action) {
        if (action === 'design') {
            this.closeWorkspace({ restoreFocus: false });
            this.navigate('design');
            document.getElementById('btn-design-continue')?.focus();
            return;
        }
        if (action === 'hardware' || action === 'review' || action === 'sheets') {
            this.open(action);
            return;
        }
        if (action === 'control-editor') {
            this.openControlEditor();
            return;
        }
        if (action === 'review-first-error') {
            const finding = (this.reviewResults || []).find(item => item.severity === 'error');
            if (!finding) return;
            this.closeWorkspace({ restoreFocus: false });
            this.setActiveStep('design');
            this.ui.selectPreflightIssue?.(finding);
            return;
        }
        if (action === 'hardware-first-error') {
            const finding = (this.hardwareAnalysis?.findings || []).find(item => item.severity === 'error');
            if (!finding) return;
            this.closeWorkspace({ restoreFocus: false });
            this.setActiveStep('design');
            this.ui.selectPreflightIssue?.(finding);
            return;
        }
        if (action === 'generate-sheets') {
            this.open('sheets');
            this.generateNesting({ announce: true });
            return;
        }
        if (action === 'fix-sheets') {
            this.open('sheets');
            document.querySelector('#material-profile-list .invalid input, #part-material-assignment-list select')?.focus();
            return;
        }
        if (action === 'cancel-nesting') this.cancelNestingGeneration({ announce: true });
    }

    computeStageFingerprint(step) {
        const params = clonePlain(this.cabinet?.params || {});
        const materials = clonePlain(params.materials || []);
        const hardwareDefinitions = clonePlain(params.hardwareDefinitions || []);
        const settings = clonePlain(params.fabricationSettings || {});
        const inclusion = clonePlain(params.fabricationInclusion || {});
        delete params.materials;
        delete params.hardwareDefinitions;
        delete params.fabricationSettings;
        delete params.fabricationInclusion;
        delete params.displayUnits;
        delete params.projectName;
        delete settings.workflow;
        const nestingSettings = clonePlain(settings.nesting || {});
        delete nestingSettings.persistedPlan;

        const design = { params };
        const hardware = {
            design,
            hardwareDefinitions,
            hardwareCosts: settings.hardwareCosts || {},
            additionalHardware: settings.additionalHardware || [],
            currencyCode: settings.currencyCode || 'GBP'
        };
        const review = {
            hardware,
            findings: normalizeWorkflowFindings(this.reviewResults || this.ui.getPreflightResults?.() || [])
        };
        const sheets = {
            review,
            materials,
            inclusion,
            materialAssignments: settings.materialAssignments || {},
            nestingSettings,
            plan: summarizeWorkflowPlan(this.currentPlan)
        };
        const exportStage = {
            sheets,
            exportSettings: Object.fromEntries(Object.entries(settings).filter(([key]) => (
                key !== 'materialAssignments' && key !== 'nesting'
            )))
        };
        return fingerprintWorkflowValue({ step, value: { design, hardware, review, sheets, export: exportStage }[step] || null });
    }

    restoreConfirmedStages() {
        const progress = this.workflowProgress;
        this.completedStages.clear();
        let previousConfirmed = true;
        MAKER_STEPS.forEach(step => {
            const record = progress.stages[step];
            const matches = record?.status === 'confirmed'
                && record.fingerprint === this.computeStageFingerprint(step);
            if (previousConfirmed && matches) {
                this.completedStages.add(step);
            } else if (record?.status === 'confirmed') {
                progress.stages[step] = {
                    ...record,
                    status: 'stale',
                    invalidatedAt: new Date().toISOString()
                };
            }
            previousConfirmed = this.completedStages.has(step);
        });
        this.renderStepState();
    }

    onExportCompleted(kind = 'production', result = null, details = {}) {
        if (kind !== 'production' && kind !== 'package') return false;
        if (result || Object.keys(details).length) this.recordExportReceipt(kind, result || {}, details);
        return this.confirmStage('export', { notify: false });
    }

    getExportOutputReadiness(preflightFindings = [], options = {}) {
        return buildExportReadinessModel({
            preflightFindings,
            sheetReadiness: this.getExportReadiness(),
            packageFindings: options.packageFindings || [],
            warningsAcknowledged: options.warningsAcknowledged
        });
    }

    recordExportReceipt(kind, result = {}, details = {}) {
        this.lastExportReceipt = normalizeExportReceipt({
            ...result,
            ...details,
            kind,
            delivered: true
        });
        return clonePlain(this.lastExportReceipt);
    }

    getLastExportReceipt() {
        return this.lastExportReceipt ? clonePlain(this.lastExportReceipt) : null;
    }

    renderStepState() {
        const activeStep = this.activeView;
        let persistedStages = {};
        try { persistedStages = this.workflowProgress.stages; } catch (_) { persistedStages = {}; }
        this.navButtons?.forEach(button => {
            const active = button.dataset.makerStep === activeStep;
            const index = MAKER_STEPS.indexOf(button.dataset.makerStep);
            const complete = index >= 0 && this.completedStages.has(button.dataset.makerStep);
            const stale = !complete && persistedStages[button.dataset.makerStep]?.status === 'stale';
            button.classList.toggle('active', active);
            button.classList.toggle('complete', complete);
            button.classList.toggle('stale', stale);
            if (active) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
            const number = button.querySelector('.maker-step-number');
            if (number) number.textContent = complete ? '✓' : stale ? '!' : (button.dataset.stepNumber || String(index + 1));
            const status = complete ? 'confirmed' : stale ? 'needs reconfirmation' : active ? 'current step' : 'not confirmed';
            button.setAttribute('aria-label', `${readable(button.dataset.makerStep)}, ${status}`);
        });
        const designContinue = document.getElementById('btn-design-continue');
        if (designContinue) designContinue.hidden = activeStep !== 'design';
        this.renderStageActionState('hardware');
        this.renderStageActionState('review');
        this.renderStageActionState('sheets');
        if (this.dialog?.open && ['hardware', 'review', 'sheets'].includes(this.activeView)) {
            this.renderMakerStageContext(this.activeView);
        }
    }

    open(view) {
        if (!this.dialog) return;
        if (!this.dialog.open) this.makerReturnFocus = document.activeElement;
        this.setActiveStep(view);
        const isHardware = view === 'hardware';
        const isReview = view === 'review';
        const isSheets = view === 'sheets';
        document.getElementById('maker-hardware-view').hidden = !isHardware;
        document.getElementById('maker-review-view').hidden = !isReview;
        document.getElementById('maker-sheets-view').hidden = !isSheets;
        this.renderMakerStageContext(view);
        if (isHardware) this.renderHardware();
        else if (isReview) {
            this.reviewResults = this.ui.getPreflightResults?.() || [];
            this.renderReview();
        } else {
            this.renderMaterials();
            if (this.nestingStale || !this.currentPlan) {
                this.renderNestingPlaceholder('Generate a sheet layout when the stock plan is ready.');
            } else {
                this.renderNestingPlan();
            }
            this.renderSheetWorkflowStatus();
        }
        if (isHardware) this.ui.recordLearningAction?.(this.ui.learningActions?.HARDWARE_INSPECTED, { view: 'hardware' });
        if (isReview) this.ui.recordLearningAction?.(this.ui.learningActions?.REVIEW_INSPECTED, { view: 'review' });
        if (!this.dialog.open) {
            if (typeof this.dialog.showModal === 'function') {
                try {
                    this.dialog.showModal();
                } catch (_) {
                    this.dialog.setAttribute('open', '');
                }
            } else {
                this.dialog.setAttribute('open', '');
            }
        }
        const reviewAction = this.getStageActionState('review');
        const focusSelector = isHardware
            ? '#hardware-library-search'
            : isReview
                ? reviewAction.canConfirm ? '#btn-review-continue' : '#maker-review-query'
                : '#btn-regenerate-nest';
        window.setTimeout(() => this.dialog.querySelector(focusSelector)?.focus(), 0);
    }

    closeWorkspace({ restoreFocus = true } = {}) {
        if (!this.dialog?.open) return;
        if (!restoreFocus) this.makerReturnFocus = null;
        if (this.activeView === 'sheets' && this.activeNestingTask) {
            this.cancelActiveNestingTask({ invalidateRequest: true });
        }
        if (typeof this.dialog.close === 'function') this.dialog.close();
        else this.dialog.removeAttribute('open');
    }

    openControlEditor() {
        this.closeWorkspace({ restoreFocus: false });
        this.setActiveStep('design');
        this.ui.activateTab?.('controls', true);
        const editor = document.getElementById('deck-layout-editor');
        editor?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        window.setTimeout(() => {
            document.querySelector('[data-layout-style].active, [data-layout-style]')?.focus();
        }, 0);
    }

    renderMakerStageContext(step) {
        const state = this.getStageActionState(step);
        const presentation = buildWorkflowStagePresentation(step, state);
        const title = document.getElementById('maker-workspace-title');
        const kicker = document.getElementById('maker-workspace-kicker');
        const description = document.getElementById('maker-workspace-description');
        const purpose = document.getElementById('maker-stage-purpose');
        const definition = document.getElementById('maker-stage-definition');
        const stateText = document.getElementById('maker-stage-state');
        if (title) title.textContent = presentation.title;
        if (kicker) kicker.textContent = presentation.kicker;
        if (description) description.textContent = presentation.description;
        if (purpose) purpose.textContent = presentation.purpose;
        if (definition) definition.textContent = presentation.definition;
        if (stateText) stateText.textContent = presentation.stateText;
        document.querySelectorAll('[data-maker-dialog-step]').forEach(item => {
            const itemStep = item.dataset.makerDialogStep;
            const itemState = this.getStageStatus(itemStep);
            item.classList.toggle('current', itemStep === step);
            item.classList.toggle('complete', itemState === 'confirmed');
            item.classList.toggle('stale', itemState === 'stale');
            const status = itemStep === step
                ? 'current step'
                : itemState === 'confirmed'
                    ? 'confirmed'
                    : itemState === 'stale'
                        ? 'needs reconfirmation'
                        : 'not confirmed';
            item.setAttribute('aria-label', `${item.textContent.trim()}, ${status}`);
            if (itemStep === step) item.setAttribute('aria-current', 'step');
            else item.removeAttribute('aria-current');
        });
    }

    openSheetsForPart(partId = null) {
        this.open('sheets');
        if (partId) {
            const match = this.currentPlan?.sheets?.flatMap(sheet => (
                (sheet.placements || []).map(placement => ({ sheet, placement }))
            )).find(item => item.placement.partId === partId);
            if (match) {
                this.selectedSheetId = match.sheet.id;
                this.selectedPlacementId = match.placement.instanceId;
                this.renderNestingPlan();
            }
        }
        window.setTimeout(() => {
            const target = partId
                ? document.getElementById(`material-assignment-${partId}`)
                : document.querySelector('#material-profile-list input');
            const placementTarget = partId && this.selectedPlacementId
                ? Array.from(document.querySelectorAll('[data-sheet-placement]')).find(item => (
                    item.dataset.sheetPlacement === this.selectedPlacementId
                ))
                : null;
            (placementTarget || target || document.getElementById('btn-regenerate-nest'))?.focus();
            (placementTarget || target)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        }, 0);
    }

    returnToDesignPart(partId) {
        if (!partId) return;
        this.closeWorkspace({ restoreFocus: false });
        this.setActiveStep('design');
        this.ui.selectPanel?.(partId);
        this.app.frameSelected?.();
    }

    onPreflightUpdated(results = []) {
        const previousFingerprint = this.computeStageFingerprint('review');
        this.reviewResults = results;
        const wasBlocked = this.reviewBlocked;
        this.reviewBlocked = results.some(item => item.severity === 'error');
        const reviewChanged = previousFingerprint !== this.computeStageFingerprint('review');
        if ((this.reviewBlocked && !wasBlocked) || (reviewChanged && this.completedStages.has('review'))) {
            this.invalidateFrom('review');
        }
        const count = results.filter(item => item.severity === 'error' || item.severity === 'warning').length;
        const badge = document.getElementById('maker-review-count');
        if (!badge) return;
        badge.hidden = count === 0;
        badge.textContent = String(count);
        badge.setAttribute('aria-label', `${count} review findings`);
        if (this.dialog?.open && this.activeView === 'review') this.renderReview();
    }

    onDesignChanged({ materialsOnly = false } = {}) {
        this.cancelActiveNestingTask({ invalidateRequest: true });
        this.ensureProjectState();
        try { this.ensureAssignments(this.cabinet.getFabricationManifest()); } catch (_) { /* surfaced by fabrication review */ }
        this.nestingStale = true;
        this.currentPlan = null;
        this.currentManifest = null;
        this.currentPlanInputFingerprint = null;
        this.assignmentFindings = [];
        this.invalidateFrom(materialsOnly ? 'sheets' : 'design');
        if (this.dialog?.open && this.activeView === 'hardware' && !materialsOnly) this.renderHardware();
        if (this.dialog?.open && this.activeView === 'sheets') {
            this.renderMaterials();
            this.renderNestingPlaceholder('Design or stock changed. Regenerate layouts before export.');
        }
    }

    onProjectLoaded(options = {}) {
        this.cancelActiveNestingTask({ invalidateRequest: true });
        this.ensureProjectState();
        if (options.resetAssignments === true) {
            this.fabricationSettings.materialAssignments = {};
            this.fabricationSettings.nesting.placementOverrides = {};
            delete this.fabricationSettings.nesting.persistedPlan;
        }
        let manifest = null;
        try {
            manifest = applyBatchQuantity(
                this.cabinet.getFabricationManifest(),
                resolveBatchQuantityFromSettings(this.fabricationSettings)
            );
            this.ensureAssignments(manifest);
        } catch (_) { /* the build surface reports geometry failures */ }
        this.currentPlan = null;
        this.currentManifest = null;
        this.currentPlanInputFingerprint = null;
        this.nestingStale = true;
        this.reviewResults = this.ui.getPreflightResults?.() || [];
        this.reviewBlocked = this.reviewResults.some(item => item.severity === 'error');
        if (manifest && options.resetAssignments !== true) this.restorePersistedNestingPlan(manifest);
        this.restoreConfirmedStages();
        if (this.dialog?.open) this.open(this.activeView === 'sheets' ? 'sheets' : 'hardware');
    }

    renderHardware() {
        this.renderHardwareLibrary(document.getElementById('hardware-library-search')?.value || '');
        const scheduleRoot = document.getElementById('hardware-current-schedule');
        const findingsRoot = document.getElementById('hardware-findings');
        const summaryRoot = document.getElementById('hardware-schedule-summary');
        const previewRoot = document.getElementById('hardware-control-layout-preview');
        try {
            const manifest = this.cabinet.getFabricationManifest();
            const library = this.getHardwareLibrary();
            const analysis = analyzeArcadeBuild(manifest, this.cabinet.params, { hardwareLibrary: library });
            this.hardwareAnalysis = analysis;
            const detectedSchedule = buildCostedHardwareSchedule(analysis.hardwareSchedule, {
                hardwareCosts: this.fabricationSettings.hardwareCosts
            });
            const completeSchedule = buildCostedHardwareSchedule(analysis.hardwareSchedule, {
                hardwareCosts: this.fabricationSettings.hardwareCosts,
                additionalHardware: this.fabricationSettings.additionalHardware
            });
            const procurement = buildProcurementBom([], completeSchedule, {
                currencyCode: this.fabricationSettings.currencyCode
            });
            const statusModel = buildHardwareStatusModel(analysis, {
                completedStages: this.completedStages,
                stageRecords: this.workflowProgress.stages
            });
            summaryRoot.innerHTML = summaryItems([
                [analysis.summary.hardwareItems, 'Detected items'],
                [completeSchedule.length, 'BOM lines'],
                [`${analysis.summary.harnessLengthM} m`, 'Harness estimate'],
                [analysis.findings.length, 'Fit findings'],
                [formatCurrency(procurement.summary.hardwareCost, procurement.currency), 'Component cost'],
                [procurement.summary.unpricedLineCount, 'Unpriced lines'],
                [statusModel.label, 'Analysis status']
            ]);
            scheduleRoot.innerHTML = detectedSchedule.length
                ? detectedSchedule.map(item => `
                    <article class="schedule-row costed">
                        <strong>${escapeHtml(item.name)}</strong>
                        <dl><dt>Category</dt><dd>${escapeHtml(readable(item.category))}</dd><dt>Detected quantity</dt><dd>${item.quantity}</dd>${item.connector ? `<dt>Connector</dt><dd>${escapeHtml(item.connector)}</dd>` : ''}</dl>
                        <div class="hardware-purchase-fields">
                            <label>Unit cost (${escapeHtml(this.fabricationSettings.currencyCode)})<input type="number" min="0" step="0.01" value="${escapeAttr(item.unitPrice)}" data-hardware-cost-id="${escapeAttr(item.definitionId)}" data-hardware-cost-field="unitPrice"></label>
                            <label>Supplier<input type="text" maxlength="100" value="${escapeAttr(item.supplier || '')}" data-hardware-cost-id="${escapeAttr(item.definitionId)}" data-hardware-cost-field="supplier"></label>
                            <label>SKU<input type="text" maxlength="80" value="${escapeAttr(item.sku || '')}" data-hardware-cost-id="${escapeAttr(item.definitionId)}" data-hardware-cost-field="sku"></label>
                            <span class="hardware-line-total">Line total: ${escapeHtml(formatCurrency(item.lineCost, this.fabricationSettings.currencyCode))}</span>
                        </div>
                    </article>`).join('')
                : emptyState('No hardware operations were detected. Add BOM-only components below when required.');
            if (previewRoot) previewRoot.innerHTML = renderHardwareLayoutReference(manifest, analysis);
            this.renderAdditionalHardwareList();
            findingsRoot.innerHTML = analysis.findings.length
                ? analysis.findings.map((item, index) => findingCard(item, {
                    actionIndex: index,
                    actionLabel: hardwareFindingActionLabel(item)
                })).join('')
                : emptyState('No hardware, service-clearance or ergonomic findings were reported.');
            findingsRoot.querySelectorAll('[data-hardware-finding]').forEach(button => {
                button.addEventListener('click', () => {
                    const finding = analysis.findings[Number(button.dataset.hardwareFinding)];
                    if (hardwareFindingUsesControlEditor(finding)) {
                        this.openControlEditor();
                        return;
                    }
                    this.closeWorkspace({ restoreFocus: false });
                    this.setActiveStep('design');
                    this.ui.selectPreflightIssue?.(finding);
                });
            });
        } catch (error) {
            this.hardwareAnalysis = null;
            summaryRoot.innerHTML = '';
            scheduleRoot.innerHTML = emptyState('Hardware analysis is unavailable for this build.');
            if (previewRoot) previewRoot.innerHTML = emptyState('The control layout reference is unavailable until the design can be analysed.');
            this.renderAdditionalHardwareList();
            findingsRoot.innerHTML = findingCard({ code: 'HARDWARE_ANALYSIS_FAILED', severity: 'error', message: error.message || String(error) });
        }
        this.renderStageActionState('hardware');
        this.renderMakerStageContext('hardware');
    }

    renderAdditionalHardwareList() {
        const root = document.getElementById('additional-hardware-list');
        if (!root) return;
        const items = normalizeAdditionalHardwareItems(this.fabricationSettings.additionalHardware);
        this.fabricationSettings.additionalHardware = items;
        root.innerHTML = items.length ? items.map(item => `
            <article class="additional-hardware-row" data-additional-hardware-id="${escapeAttr(item.id)}">
                <div class="additional-hardware-row-heading">
                    <strong>${escapeHtml(item.name)}</strong>
                    <button class="dialog-close" type="button" data-remove-additional-hardware="${escapeAttr(item.id)}">Remove</button>
                </div>
                <div class="additional-hardware-fields">
                    <label>Name<input type="text" maxlength="120" value="${escapeAttr(item.name)}" data-additional-hardware-field="name"></label>
                    <label>Category<input type="text" maxlength="60" value="${escapeAttr(item.category)}" data-additional-hardware-field="category"></label>
                    <label>Quantity<input type="number" min="1" step="1" value="${item.quantity}" data-additional-hardware-field="quantity"></label>
                    <label>Unit cost (${escapeHtml(this.fabricationSettings.currencyCode)})<input type="number" min="0" step="0.01" value="${item.unitPrice}" data-additional-hardware-field="unitPrice"></label>
                    <label>Supplier<input type="text" maxlength="100" value="${escapeAttr(item.supplier || '')}" data-additional-hardware-field="supplier"></label>
                    <label>SKU<input type="text" maxlength="80" value="${escapeAttr(item.sku || '')}" data-additional-hardware-field="sku"></label>
                    <label class="wide">Notes<input type="text" maxlength="300" value="${escapeAttr(item.notes || '')}" data-additional-hardware-field="notes"></label>
                    <span class="hardware-line-total">Line total: ${escapeHtml(formatCurrency(item.quantity * item.unitPrice, this.fabricationSettings.currencyCode))}</span>
                </div>
            </article>`).join('') : emptyState('No BOM-only components added. Detected controls remain listed above.');
    }

    handleHardwareCostChange(event) {
        const input = event.target.closest('[data-hardware-cost-id][data-hardware-cost-field]');
        if (!input) return;
        const id = input.dataset.hardwareCostId;
        const field = input.dataset.hardwareCostField;
        const record = { ...(this.fabricationSettings.hardwareCosts[id] || {}) };
        if (field === 'unitPrice') {
            const value = Number(input.value);
            if (!Number.isFinite(value) || value < 0) return;
            record.unitPrice = value;
        } else {
            record[field] = String(input.value || '').trim();
        }
        this.fabricationSettings.hardwareCosts[id] = record;
        this.invalidateFrom('hardware');
        this.markProjectMutation('Edit hardware purchasing');
        this.renderHardware();
    }

    addAdditionalHardwareItem(source = {}) {
        const item = createAdditionalHardwareItem({
            id: source.id ? `bom-${source.id}-${Date.now()}` : `additional-component-${Date.now()}`,
            definitionId: source.definitionId || source.id,
            name: source.name || `Additional component ${this.fabricationSettings.additionalHardware.length + 1}`,
            category: source.category || 'electronics',
            quantity: source.quantity || 1,
            unitPrice: source.unitPrice || 0,
            supplier: source.supplier,
            sku: source.sku
        }, this.fabricationSettings.additionalHardware.length);
        this.fabricationSettings.additionalHardware.push(item);
        this.invalidateFrom('hardware');
        this.markProjectMutation('Add BOM component');
        this.renderHardware();
        window.setTimeout(() => Array.from(document.querySelectorAll('[data-additional-hardware-id]')).find(row => (
            row.dataset.additionalHardwareId === item.id
        ))?.querySelector('input')?.focus(), 0);
    }

    handleAdditionalHardwareChange(event) {
        const input = event.target.closest('[data-additional-hardware-field]');
        const row = input?.closest('[data-additional-hardware-id]');
        if (!input || !row) return;
        const item = this.fabricationSettings.additionalHardware.find(candidate => candidate.id === row.dataset.additionalHardwareId);
        if (!item) return;
        const field = input.dataset.additionalHardwareField;
        if (field === 'quantity' || field === 'unitPrice') {
            const value = Number(input.value);
            if (!Number.isFinite(value) || value < (field === 'quantity' ? 1 : 0)) return;
            item[field] = field === 'quantity' ? Math.max(1, Math.round(value)) : value;
        } else {
            item[field] = String(input.value || '').trim();
        }
        this.fabricationSettings.additionalHardware = normalizeAdditionalHardwareItems(this.fabricationSettings.additionalHardware);
        this.invalidateFrom('hardware');
        this.markProjectMutation('Edit BOM component');
        this.renderHardware();
    }

    handleAdditionalHardwareAction(event) {
        const button = event.target.closest('[data-remove-additional-hardware]');
        if (!button) return;
        this.fabricationSettings.additionalHardware = this.fabricationSettings.additionalHardware.filter(item => (
            item.id !== button.dataset.removeAdditionalHardware
        ));
        this.invalidateFrom('hardware');
        this.markProjectMutation('Remove BOM component');
        this.renderHardware();
    }

    renderReview() {
        const results = this.reviewResults || [];
        const model = buildReviewViewModel(results, this.reviewFilter);
        const counts = model.counts;
        const summary = document.getElementById('maker-review-summary');
        const findings = document.getElementById('maker-review-findings');
        if (!summary || !findings) return;
        this.ensureReviewControls(findings);
        summary.innerHTML = summaryItems([
            [counts.error, 'Errors'],
            [counts.warning, 'Warnings'],
            [counts.info, 'Information'],
            [model.statusLabel, 'Review status']
        ]);
        findings.innerHTML = model.findings.length
            ? model.findings.map(item => `
                <article class="maker-review-finding ${escapeAttr(item.severity || 'info')}">
                    <div>
                        <span class="issue-severity">${escapeHtml(severityLabel(item.severity))}</span>
                        <strong>${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.message || 'No additional detail was supplied.')}</p>
                        ${item.correctiveAction || item.remedy ? `<p>${escapeHtml(item.correctiveAction || item.remedy)}</p>` : ''}
                        ${item.code ? `<span class="issue-code">Reference: ${escapeHtml(item.code)}</span>` : ''}
                    </div>
                    ${item.partIds?.length ? `<button class="btn btn-secondary btn-sm" type="button" data-review-finding="${item.sourceIndex}">Edit affected panel</button>` : ''}
                </article>`).join('')
            : results.length
                ? `<div class="maker-empty-state"><strong>No matching findings</strong><span>Change the search or severity filter to see other findings.</span></div>`
                : `<div class="maker-empty-state"><strong>${this.completedStages.has('review') ? 'Review confirmed' : 'No blocking findings'}</strong><span>No fabrication errors or warnings were found.</span></div>`;
        findings.querySelectorAll('[data-review-finding]').forEach(button => {
            button.addEventListener('click', () => {
                const finding = results[Number(button.dataset.reviewFinding)];
                this.closeWorkspace({ restoreFocus: false });
                this.setActiveStep('design');
                this.ui.selectPreflightIssue?.(finding);
            });
        });
        this.reviewBlocked = counts.error > 0;
        const filterStatus = document.getElementById('maker-review-filter-status');
        if (filterStatus) filterStatus.textContent = `${model.visibleCount} of ${model.totalCount} findings shown.`;
        this.renderStageActionState('review');
    }

    ensureReviewControls(findingsRoot) {
        if (document.getElementById('maker-review-filters')) return;
        if (typeof document.createElement !== 'function' || !findingsRoot?.parentElement) return;
        if (!this.reviewFilter) this.reviewFilter = { query: '', severity: 'all' };
        const controls = document.createElement('div');
        controls.id = 'maker-review-filters';
        controls.className = 'maker-filter-row';
        controls.setAttribute('role', 'search');
        controls.setAttribute('aria-label', 'Filter manufacturing findings');
        controls.innerHTML = `
            <label class="maker-search-field" for="maker-review-query">
                <span>Search findings</span>
                <input id="maker-review-query" type="search" autocomplete="off" placeholder="Message, reference or panel">
            </label>
            <label class="maker-search-field" for="maker-review-severity">
                <span>Severity</span>
                <select id="maker-review-severity" class="select-control">
                    <option value="all">All severities</option>
                    <option value="error">Blocking errors</option>
                    <option value="warning">Warnings</option>
                    <option value="info">Information</option>
                </select>
            </label>
            <span id="maker-review-filter-status" class="section-hint" role="status" aria-live="polite"></span>`;
        findingsRoot.parentElement.insertBefore(controls, findingsRoot);
        const query = controls.querySelector('#maker-review-query');
        const severity = controls.querySelector('#maker-review-severity');
        query.value = this.reviewFilter.query;
        severity.value = this.reviewFilter.severity;
        query.addEventListener('input', event => {
            this.reviewFilter.query = event.target.value;
            this.renderReview();
        });
        severity.addEventListener('change', event => {
            this.reviewFilter.severity = event.target.value;
            this.renderReview();
        });
    }

    getHardwareLibrary() {
        return normalizeHardwareLibrary(this.cabinet.params.hardwareDefinitions || []);
    }

    renderHardwareLibrary(query = '') {
        const root = document.getElementById('hardware-library-list');
        if (!root) return;
        const needle = String(query || '').trim().toLowerCase();
        const definitions = this.getHardwareLibrary().filter(definition => {
            const haystack = `${definition.name} ${definition.category} ${definition.id}`.toLowerCase();
            return !needle || haystack.includes(needle);
        });
        const customIds = new Set((this.cabinet.params.hardwareDefinitions || []).map(item => item.id));
        const groups = groupBy(definitions, item => item.category);
        root.innerHTML = definitions.length ? [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => `
            <details class="hardware-category" ${needle ? 'open' : ''}>
                <summary><span>${escapeHtml(readable(category))}</span><span>${items.length}</span></summary>
                <div class="hardware-definition-grid">
                    ${items.map(definition => hardwareDefinitionCard(definition, customIds.has(definition.id))).join('')}
                </div>
            </details>`).join('') : emptyState('No hardware definitions match that filter.');
    }

    handleHardwareLibraryAction(event) {
        const addButton = event.target.closest('[data-add-hardware-definition]');
        if (addButton) {
            const definition = this.getHardwareLibrary().find(item => item.id === addButton.dataset.addHardwareDefinition);
            if (definition) this.addAdditionalHardwareItem(definition);
            return;
        }
        const removeButton = event.target.closest('[data-remove-hardware-definition]');
        if (!removeButton) return;
        const id = removeButton.dataset.removeHardwareDefinition;
        const definition = (this.cabinet.params.hardwareDefinitions || []).find(item => item.id === id);
        if (!definition || !window.confirm(`Remove the custom hardware definition ${definition.name || id}?`)) return;
        this.cabinet.params.hardwareDefinitions = this.cabinet.params.hardwareDefinitions.filter(item => item.id !== id);
        this.invalidateFrom('hardware');
        this.markProjectMutation('Remove custom hardware definition');
        this.renderHardware();
        this.ui.showNotification?.(`Removed custom hardware definition: ${definition.name || id}`);
    }

    async importHardwareDefinitions(event) {
        const status = document.getElementById('hardware-import-status');
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        let imported = 0;
        const failures = [];
        const pending = [];
        for (const file of files) {
            try {
                const parsed = JSON.parse(await file.text());
                const definitions = Array.isArray(parsed) ? parsed : Array.isArray(parsed.definitions) ? parsed.definitions : [parsed];
                definitions.forEach((item, index) => {
                    const validation = validateHardwareDefinitionInput(item);
                    if (!validation.ok) {
                        failures.push(`${file.name}, definition ${index + 1}: ${validation.errors.join(' ')}`);
                        return;
                    }
                    pending.push(validation.definition);
                });
            } catch (error) {
                failures.push(`${file.name}: ${error.message || error}`);
            }
        }
        const customDefinitions = new Map(
            (this.cabinet.params.hardwareDefinitions || []).map(item => [item.id, item])
        );
        pending.forEach(definition => {
            customDefinitions.set(definition.id, definition);
            imported++;
        });
        this.cabinet.params.hardwareDefinitions = [...customDefinitions.values()];
        event.target.value = '';
        if (imported) {
            this.invalidateFrom('hardware');
            this.markProjectMutation('Import hardware definitions');
        }
        if (status) {
            status.className = `inline-status ${failures.length ? 'error' : 'success'}`;
            status.textContent = `${imported} valid definition${imported === 1 ? '' : 's'} imported${failures.length ? `. Rejected: ${failures.join(' ')}` : '.'}`;
        }
        this.renderHardware();
    }

    renderMaterials() {
        const root = document.getElementById('material-profile-list');
        if (!root) return;
        const currencyCode = this.fabricationSettings.currencyCode;
        root.innerHTML = `
            <label class="material-field project-currency-field">
                Project currency
                <input type="text" inputmode="text" maxlength="3" pattern="[A-Za-z]{3}" data-project-currency value="${escapeAttr(currencyCode)}" aria-describedby="project-currency-hint">
                <span id="project-currency-hint" class="section-hint">Three-letter ISO code, such as GBP, EUR or USD.</span>
            </label>
            ${this.materials.map((profile, index) => materialProfileCard(profile, index, this.materials.length, currencyCode)).join('')}`;
        this.renderPartAssignments();
    }

    renderPartAssignments() {
        const root = document.getElementById('part-material-assignment-list');
        if (!root) return;
        let manifest;
        try { manifest = this.cabinet.getFabricationManifest(); } catch (_) { manifest = { parts: [] }; }
        const assignmentsChanged = this.ensureAssignments(manifest);
        if (assignmentsChanged && this.ui.history?.length) this.markProjectMutation('Assign default stock by thickness');
        const assignments = this.fabricationSettings.materialAssignments;
        const profiles = this.materials;
        const parts = (manifest.parts || []).filter(part => part.includeInFabrication !== false);
        root.innerHTML = parts.length ? parts.map(part => `
            <div class="part-material-row">
                <label for="material-assignment-${escapeAttr(part.id)}" title="${escapeAttr(part.name || part.id)}">${escapeHtml(part.name || part.id)} · ${formatMm(part.thicknessMm)}</label>
                <select id="material-assignment-${escapeAttr(part.id)}" class="select-control" data-part-material="${escapeAttr(part.id)}" aria-label="Material for ${escapeAttr(part.name || part.id)}">
                    ${profiles.map(profile => `<option value="${escapeAttr(profile.id)}" ${assignments[part.id] === profile.id ? 'selected' : ''}>${escapeHtml(profile.name)}</option>`).join('')}
                </select>
                <span class="part-material-actions">
                    <button class="btn btn-secondary btn-sm" type="button" data-find-part-sheet="${escapeAttr(part.id)}">Sheet</button>
                    <button class="btn btn-secondary btn-sm" type="button" data-edit-part-design="${escapeAttr(part.id)}">Design</button>
                </span>
            </div>`).join('') : emptyState('No parts are currently included in fabrication.');
    }

    ensureAssignments(manifest) {
        const assignments = this.fabricationSettings.materialAssignments;
        const profiles = this.materials;
        const validIds = new Set(profiles.map(profile => profile.id));
        let changed = false;
        (manifest?.parts || []).forEach(part => {
            if (validIds.has(assignments[part.id])) return;
            const thickness = Number(part.thicknessMm) || Number(this.cabinet.params.thickness) || 18;
            const closest = profiles.reduce((best, profile) => {
                const candidateDifference = Math.abs(Number(profile.measuredThicknessMm) - thickness);
                const bestDifference = Math.abs(Number(best.measuredThicknessMm) - thickness);
                if (candidateDifference < bestDifference) return profile;
                if (candidateDifference === bestDifference && (profile.allowedRotations?.length || 0) > (best.allowedRotations?.length || 0)) return profile;
                return best;
            }, profiles[0]);
            if (closest) {
                assignments[part.id] = closest.id;
                changed = true;
            }
        });
        return changed;
    }

    handleMaterialChange(event) {
        if (event.target.matches('[data-project-currency]')) {
            const value = String(event.target.value || '').trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(value)) {
                event.target.setCustomValidity('Enter a three-letter currency code.');
                event.target.reportValidity();
                return;
            }
            event.target.setCustomValidity('');
            this.fabricationSettings.currencyCode = value;
            this.invalidateFrom('hardware');
            this.markProjectMutation('Change project currency');
            this.renderMaterials();
            if (this.currentPlan) this.renderNestingPlan(this.currentPlan);
            return;
        }
        const input = event.target.closest('[data-material-field], [data-material-rotation]');
        if (!input) return;
        const index = Number(input.dataset.materialIndex);
        const profile = this.materials[index];
        if (!profile) return;
        if (input.dataset.materialRotation) {
            const rotation = Number(input.dataset.materialRotation);
            const rotations = new Set(Array.isArray(profile.allowedRotations) ? profile.allowedRotations.map(Number) : []);
            if (input.checked) rotations.add(rotation);
            else rotations.delete(rotation);
            profile.allowedRotations = [...rotations].sort((a, b) => a - b);
        } else {
            const field = input.dataset.materialField;
            profile[field] = input.type === 'number' ? Number(input.value) : input.value;
        }
        this.onDesignChanged({ materialsOnly: true });
        this.markProjectMutation('Edit material profile');
        this.renderMaterials();
    }

    handleMaterialClick(event) {
        const button = event.target.closest('[data-remove-material]');
        if (!button) return;
        if (this.materials.length <= 1) {
            this.ui.showNotification?.('At least one material profile is required');
            return;
        }
        const index = Number(button.dataset.removeMaterial);
        const removed = this.materials[index];
        if (!removed || !window.confirm(`Remove ${removed.name}? Parts assigned to it will be reassigned by thickness.`)) return;
        this.materials.splice(index, 1);
        Object.entries(this.fabricationSettings.materialAssignments).forEach(([partId, materialId]) => {
            if (materialId === removed.id) delete this.fabricationSettings.materialAssignments[partId];
        });
        this.onDesignChanged({ materialsOnly: true });
        this.markProjectMutation('Remove material profile');
        this.renderMaterials();
    }

    addMaterialProfile() {
        const profile = createMaterialProfile({
            id: `custom-material-${Date.now()}`,
            name: `Custom material ${this.materials.length + 1}`,
            nominalThicknessMm: Number(this.cabinet.params.thickness) || 18,
            measuredThicknessMm: Number(this.cabinet.params.thickness) || 18
        });
        this.materials.push(profile);
        this.onDesignChanged({ materialsOnly: true });
        this.markProjectMutation('Add material profile');
        this.renderMaterials();
        window.setTimeout(() => document.querySelector(`[data-material-index="${this.materials.length - 1}"][data-material-field="name"]`)?.focus(), 0);
    }

    handleAssignmentChange(event) {
        const select = event.target.closest('[data-part-material]');
        if (!select) return;
        this.fabricationSettings.materialAssignments[select.dataset.partMaterial] = select.value;
        this.onDesignChanged({ materialsOnly: true });
        this.markProjectMutation('Assign part material');
        this.renderNestingPlaceholder('Material assignment changed. Regenerate layouts before export.');
    }

    handleAssignmentClick(event) {
        const sheetButton = event.target.closest('[data-find-part-sheet]');
        if (sheetButton) {
            this.openSheetsForPart(sheetButton.dataset.findPartSheet);
            return;
        }
        const designButton = event.target.closest('[data-edit-part-design]');
        if (designButton) this.returnToDesignPart(designButton.dataset.editPartDesign);
    }

    validateMaterials() {
        return this.materials.flatMap((profile, index) => {
            const findings = [];
            const positiveFields = ['nominalThicknessMm', 'measuredThicknessMm', 'sheetWidthMm', 'sheetHeightMm'];
            positiveFields.forEach(field => {
                if (!Number.isFinite(Number(profile[field])) || Number(profile[field]) <= 0) {
                    findings.push({ code: 'MATERIAL_VALUE', severity: 'error', materialIndex: index, message: `${profile.name || `Material ${index + 1}`}: ${readable(field)} must be greater than zero.` });
                }
            });
            ['pricePerSheet', 'trimMarginMm', 'partSpacingMm', 'quantityAvailable', 'densityKgM3'].forEach(field => {
                if (!Number.isFinite(Number(profile[field])) || Number(profile[field]) < 0) {
                    findings.push({ code: 'MATERIAL_VALUE', severity: 'error', materialIndex: index, message: `${profile.name || `Material ${index + 1}`}: ${readable(field)} cannot be negative.` });
                }
            });
            if (!Array.isArray(profile.allowedRotations) || !profile.allowedRotations.length) {
                findings.push({ code: 'MATERIAL_ROTATIONS', severity: 'error', materialIndex: index, message: `${profile.name || `Material ${index + 1}`}: choose at least one allowed rotation.` });
            }
            if (Number(profile.sheetWidthMm) <= Number(profile.trimMarginMm) * 2 || Number(profile.sheetHeightMm) <= Number(profile.trimMarginMm) * 2) {
                findings.push({ code: 'MATERIAL_STOCK_MARGIN', severity: 'error', materialIndex: index, message: `${profile.name || `Material ${index + 1}`}: trim margins consume the usable sheet.` });
            }
            const libraryValidation = validateMaterialProfile(profile);
            libraryValidation.findings.filter(item => !findings.some(existing => existing.code === item.code)).forEach(item => findings.push({ ...item, materialIndex: index, message: `${profile.name}: ${item.message}` }));
            return findings;
        });
    }

    validateAssignments(manifest) {
        this.ensureAssignments(manifest);
        const profiles = new Map(this.materials.map(profile => [profile.id, profile]));
        const assignments = this.fabricationSettings.materialAssignments;
        return (manifest?.parts || []).filter(part => part.includeInFabrication !== false).flatMap(part => {
            const profile = profiles.get(assignments[part.id]);
            if (!profile) return [{ code: 'MATERIAL_ASSIGNMENT_MISSING', severity: 'error', partIds: [part.id], message: `${part.name || part.id} has no valid material assignment.` }];
            const designThickness = Number(part.thicknessMm) || 0;
            const measuredThickness = Number(profile.measuredThicknessMm) || 0;
            const difference = Math.abs(designThickness - measuredThickness);
            if (difference > Math.max(2, designThickness * 0.15)) {
                return [{
                    code: 'MATERIAL_PART_THICKNESS_MISMATCH',
                    severity: 'error',
                    partIds: [part.id],
                    message: `${part.name || part.id} is modelled at ${formatMm(designThickness)} but is assigned ${profile.name} at ${formatMm(measuredThickness)}.`
                }];
            }
            if (difference > 0.75) {
                return [{
                    code: 'MATERIAL_PART_THICKNESS_VARIANCE',
                    severity: 'warning',
                    partIds: [part.id],
                    message: `${part.name || part.id} differs from its assigned measured stock by ${formatMm(difference)}.`
                }];
            }
            return [];
        });
    }

    getNestingGenerationOptions(strategy = null) {
        const nestingSettings = clonePlain(this.fabricationSettings.nesting || {});
        delete nestingSettings.persistedPlan;
        const selectedStrategy = NESTING_STRATEGIES.has(strategy)
            ? strategy
            : NESTING_STRATEGIES.has(nestingSettings.selectedStrategy)
                ? nestingSettings.selectedStrategy
                : null;
        return {
            ...nestingSettings,
            assignments: clonePlain(this.fabricationSettings.materialAssignments || {}),
            strategy: selectedStrategy,
            includeCandidates: true,
            pinnedPlacements: Object.entries(nestingSettings.placementOverrides || {})
                .filter(([, placement]) => placement?.pinned)
                .map(([instanceId, placement]) => ({ instanceId, ...placement }))
        };
    }

    persistCurrentNestingPlan() {
        if (this.nestingBusy || !this.currentPlan || !this.currentManifest) return false;
        const inputFingerprint = this.refreshCurrentPlanInputFingerprint();
        if (!inputFingerprint) return false;
        if (!this.getExportReadiness().ok) return false;
        const plan = clonePlain(stripInteractiveCandidateData(this.currentPlan));
        this.fabricationSettings.nesting.persistedPlan = {
            version: PERSISTED_NESTING_PLAN_VERSION,
            storedAt: new Date().toISOString(),
            inputFingerprint,
            planFingerprint: fingerprintWorkflowValue(plan),
            plan
        };
        this.currentPlanInputFingerprint = inputFingerprint;
        return true;
    }

    refreshCurrentPlanInputFingerprint() {
        if (!this.currentPlan || !this.currentManifest) {
            this.currentPlanInputFingerprint = null;
            return null;
        }
        const generationOptions = this.getNestingGenerationOptions(this.currentPlan.selectedStrategy);
        this.currentPlanInputFingerprint = fingerprintNestingInputs(
            this.currentManifest,
            normalizeMaterialProfiles(this.materials),
            generationOptions
        );
        return this.currentPlanInputFingerprint;
    }

    restorePersistedNestingPlan(manifest) {
        const envelope = this.fabricationSettings.nesting.persistedPlan;
        if (!envelope || envelope.version !== PERSISTED_NESTING_PLAN_VERSION || !envelope.plan) return false;
        const plan = clonePlain(envelope.plan);
        if (
            plan.version !== NESTING_PLAN_VERSION
            || plan.units !== 'mm'
            || envelope.planFingerprint !== fingerprintWorkflowValue(plan)
            || !hasExpectedNestingCoverage(plan, manifest)
        ) return false;
        const generationOptions = this.getNestingGenerationOptions(plan.selectedStrategy);
        const inputFingerprint = fingerprintNestingInputs(
            manifest,
            normalizeMaterialProfiles(this.materials),
            generationOptions
        );
        if (inputFingerprint !== envelope.inputFingerprint) return false;
        this.assignmentFindings = this.validateAssignments(manifest);
        if (this.assignmentFindings.some(item => item.severity === 'error')) return false;
        const restoredPlan = this.applyPlacementOverrides(plan);
        restoredPlan.findings = validateNestingPlan(restoredPlan, this.materials);
        if (restoredPlan.findings.some(item => item.severity === 'error')) return false;
        this.currentManifest = manifest;
        this.currentPlan = restoredPlan;
        this.currentPlanInputFingerprint = inputFingerprint;
        this.nestingStale = false;
        this.selectedSheetId = restoredPlan.sheets.some(sheet => sheet.id === this.selectedSheetId)
            ? this.selectedSheetId
            : restoredPlan.sheets[0]?.id || null;
        this.selectedPlacementId = null;
        return true;
    }

    getSheetWorkflowState(now = Date.now()) {
        let readiness;
        try {
            readiness = this.getExportReadiness();
        } catch (_) {
            readiness = { ok: false, status: 'invalid', findings: [] };
        }
        return buildSheetWorkflowState({
            materialFindings: this.validateMaterials?.() || [],
            assignmentFindings: this.assignmentFindings || [],
            readiness,
            busy: Boolean(this.nestingBusy),
            startedAt: this.nestingStartedAt,
            now,
            confirmed: this.completedStages?.has('sheets')
        });
    }

    renderSheetWorkflowStatus() {
        const view = document.getElementById('maker-sheets-view');
        if (!view || typeof document.createElement !== 'function') return null;
        let root = document.getElementById('sheet-workflow-status');
        if (!root) {
            root = document.createElement('section');
            root.id = 'sheet-workflow-status';
            root.className = 'maker-summary-strip';
            root.setAttribute('aria-label', 'Sheet planning progress');
            const layout = view.querySelector('.maker-sheet-layout');
            if (layout) view.insertBefore(root, layout);
            else view.appendChild(root);
        }
        const state = this.getSheetWorkflowState();
        root.innerHTML = state.steps.map(step => `
            <div class="maker-summary-item ${escapeAttr(step.status)}" data-sheet-workflow-step="${escapeAttr(step.id)}">
                <strong>${escapeHtml(step.label)}</strong>
                <span>${escapeHtml(readable(step.status))}: ${escapeHtml(step.detail)}</span>
            </div>`).join('');
        return state;
    }

    ensureNestingCancelButton() {
        let button = document.getElementById('btn-cancel-nest');
        if (button || typeof document.createElement !== 'function') return button;
        const regenerate = document.getElementById('btn-regenerate-nest');
        if (!regenerate?.parentElement) return null;
        button = document.createElement('button');
        button.id = 'btn-cancel-nest';
        button.className = 'btn btn-secondary';
        button.type = 'button';
        button.textContent = 'Cancel generation';
        button.hidden = true;
        button.addEventListener('click', () => this.cancelNestingGeneration({ announce: true }));
        regenerate.insertAdjacentElement('afterend', button);
        return button;
    }

    cancelNestingGeneration({ announce = false } = {}) {
        if (!this.nestingBusy && !this.activeNestingTask) return false;
        const elapsedMs = this.getNestingElapsedMs();
        this.cancelActiveNestingTask({ invalidateRequest: true });
        const status = document.getElementById('nesting-validation-status');
        if (status) {
            status.className = 'inline-status';
            status.textContent = `Layout generation cancelled${elapsedMs >= 1000 ? ` after ${Math.floor(elapsedMs / 1000)} seconds` : ''}.`;
        }
        this.renderSheetWorkflowStatus();
        if (announce) this.ui.showNotification?.('Sheet layout generation cancelled');
        return true;
    }

    getNestingElapsedMs(now = Date.now()) {
        return this.nestingStartedAt
            ? Math.max(0, Number(now) - Number(this.nestingStartedAt))
            : this.lastNestingElapsedMs || 0;
    }

    async generateNesting({ strategy = null, announce = false } = {}) {
        if (this.nestingBusy) {
            if (announce) this.ui.showNotification?.('Sheet layout generation is already in progress');
            return null;
        }
        const status = document.getElementById('nesting-validation-status');
        this.cancelActiveNestingTask();
        const requestId = ++this.nestingRequestId;
        const materialFindings = this.validateMaterials();
        if (materialFindings.some(item => item.severity === 'error')) {
            this.currentPlan = null;
            this.currentManifest = null;
            this.currentPlanInputFingerprint = null;
            this.nestingStale = true;
            if (status) {
                status.className = 'inline-status error';
                status.textContent = materialFindings.map(item => item.message).join(' ');
            }
            this.renderNestingPlaceholder('Fix material profile errors before generating layouts.');
            this.renderMaterials();
            return null;
        }

        try {
            const manifest = applyBatchQuantity(this.cabinet.getFabricationManifest(), resolveBatchQuantityFromSettings(this.fabricationSettings));
            this.currentManifest = manifest;
            const assignmentsChanged = this.ensureAssignments(manifest);
            if (assignmentsChanged && this.ui.history?.length) this.markProjectMutation('Assign default stock by thickness');
            this.assignmentFindings = this.validateAssignments(manifest);
            if (this.assignmentFindings.some(item => item.severity === 'error')) {
                this.currentPlan = null;
                this.currentPlanInputFingerprint = null;
                this.nestingStale = true;
                if (status) {
                    status.className = 'inline-status error';
                    status.textContent = this.assignmentFindings.map(item => item.message).join(' ');
                }
                this.renderNestingPlaceholder('Fix part-to-material thickness assignments before generating layouts.');
                return null;
            }
            const normalizedMaterials = normalizeMaterialProfiles(this.materials);
            const options = this.getNestingGenerationOptions(strategy);
            const inputFingerprint = fingerprintNestingInputs(manifest, normalizedMaterials, options);
            this.nestingStale = true;
            this.setNestingBusy(true);
            const plan = await this.runNestingTask(
                requestId,
                manifest,
                normalizedMaterials,
                options
            );
            if (requestId !== this.nestingRequestId) return null;
            const liveManifest = applyBatchQuantity(
                this.cabinet.getFabricationManifest(),
                resolveBatchQuantityFromSettings(this.fabricationSettings)
            );
            const liveOptions = this.getNestingGenerationOptions(options.strategy);
            const liveFingerprint = fingerprintNestingInputs(
                liveManifest,
                normalizeMaterialProfiles(this.materials),
                liveOptions
            );
            if (inputFingerprint !== liveFingerprint) return null;
            this.fabricationSettings.nesting.selectedStrategy = plan.selectedStrategy;
            this.currentManifest = manifest;
            this.currentPlan = this.applyPlacementOverrides(plan);
            this.currentPlan.findings = validateNestingPlan(this.currentPlan, this.materials);
            this.currentPlanInputFingerprint = inputFingerprint;
            this.nestingStale = false;
            this.selectedSheetId = this.currentPlan.sheets.some(sheet => sheet.id === this.selectedSheetId)
                ? this.selectedSheetId
                : this.currentPlan.sheets[0]?.id || null;
            this.selectedPlacementId = null;
            this.renderNestingPlan();
            const planValid = !this.currentPlan.findings.some(item => item.severity === 'error')
                && (this.currentPlan.unplaced || []).length === 0;
            this.ui.recordLearningAction?.(this.ui.learningActions?.SHEETS_GENERATED, {
                valid: planValid,
                strategy: this.currentPlan.selectedStrategy
            });
            if (announce) this.ui.showNotification?.(`Generated ${this.currentPlan.candidateSummaries?.length || 1} ranked sheet layouts`);
            return this.currentPlan;
        } catch (error) {
            if (error?.name === 'AbortError') return null;
            this.currentPlan = null;
            this.currentPlanInputFingerprint = null;
            this.nestingStale = true;
            if (status) {
                status.className = 'inline-status error';
                status.textContent = `Nesting failed: ${error.message || error}`;
            }
            this.renderNestingPlaceholder('The layout engine could not generate a plan.');
            return null;
        } finally {
            if (requestId === this.nestingRequestId) this.setNestingBusy(false);
        }
    }

    runNestingTask(requestId, manifest, materials, options) {
        if (typeof Worker !== 'function') {
            return Promise.resolve().then(() => createNestingPlan(manifest, materials, options));
        }
        return new Promise((resolve, reject) => {
            const worker = new Worker(new URL('./nesting-worker.js', import.meta.url), { type: 'module' });
            const cleanup = () => {
                worker.terminate();
                if (this.activeNestingTask?.requestId === requestId) this.activeNestingTask = null;
            };
            worker.onmessage = event => {
                if (event.data?.requestId !== requestId) return;
                cleanup();
                if (event.data.ok) {
                    resolve(event.data.plan);
                } else {
                    const error = new Error(event.data?.error?.message || 'The layout worker failed.');
                    error.name = event.data?.error?.name || 'Error';
                    reject(error);
                }
            };
            worker.onerror = event => {
                cleanup();
                reject(new Error(event.message || 'The layout worker failed.'));
            };
            this.activeNestingTask = { requestId, worker, reject };
            worker.postMessage({ requestId, manifest, materials, options });
        });
    }

    cancelActiveNestingTask({ invalidateRequest = false } = {}) {
        if (invalidateRequest) this.nestingRequestId += 1;
        const task = this.activeNestingTask;
        if (task) {
            this.activeNestingTask = null;
            task.worker?.terminate();
            const error = new Error('The previous layout request was replaced.');
            error.name = 'AbortError';
            task.reject(error);
        }
        this.setNestingBusy(false);
    }

    setNestingBusy(busy) {
        const nextBusy = Boolean(busy);
        const wasBusy = Boolean(this.nestingBusy);
        if (nextBusy && !wasBusy) {
            this.nestingStartedAt = Date.now();
            this.lastNestingElapsedMs = 0;
        }
        if (!nextBusy && wasBusy) {
            this.lastNestingElapsedMs = this.getNestingElapsedMs();
            this.nestingStartedAt = null;
        }
        this.nestingBusy = nextBusy;
        const button = document.getElementById('btn-regenerate-nest');
        if (button) {
            button.disabled = this.nestingBusy;
            button.textContent = this.nestingBusy ? 'Generating layouts...' : 'Regenerate layouts';
        }
        const cancelButton = this.ensureNestingCancelButton();
        if (cancelButton) cancelButton.hidden = !this.nestingBusy;
        const elapsed = document.getElementById('nesting-elapsed-time');
        if (elapsed && !this.nestingBusy) elapsed.hidden = true;
        const candidateSelect = document.getElementById('nesting-candidate-select');
        if (candidateSelect) candidateSelect.disabled = this.nestingBusy || !this.currentPlan;
        const addMaterial = document.getElementById('btn-add-material');
        if (addMaterial) addMaterial.disabled = this.nestingBusy;
        const wrap = document.getElementById('nesting-svg-wrap');
        if (wrap) wrap.setAttribute('aria-busy', String(this.nestingBusy));
        const workspace = document.getElementById('maker-sheets-view');
        if (workspace) workspace.setAttribute('aria-busy', String(this.nestingBusy));
        if (this.nestingElapsedTimer && (!this.nestingBusy || typeof window === 'undefined')) {
            globalThis.clearInterval(this.nestingElapsedTimer);
            this.nestingElapsedTimer = null;
        }
        if (this.nestingBusy) {
            this.updateNestingElapsedStatus();
            if (!this.nestingElapsedTimer && typeof window !== 'undefined') {
                this.nestingElapsedTimer = window.setInterval(() => this.updateNestingElapsedStatus(), 1000);
            }
        }
        this.renderStageActionState('sheets');
        this.renderSheetWorkflowStatus();
    }

    updateNestingElapsedStatus() {
        if (!this.nestingBusy) return;
        const seconds = Math.floor(this.getNestingElapsedMs() / 1000);
        const status = document.getElementById('nesting-validation-status');
        if (status && seconds === 0) {
            status.className = 'inline-status';
            status.textContent = 'Generating ranked sheet layouts...';
        }
        const elapsed = this.ensureNestingElapsedElement(status);
        if (elapsed) {
            elapsed.hidden = false;
            elapsed.textContent = seconds ? `${seconds} seconds elapsed` : 'Starting layout generation';
        }
        const generateDetail = document.querySelector('[data-sheet-workflow-step="generate"] span');
        if (generateDetail) generateDetail.textContent = `In Progress: Generating layouts${seconds ? `, ${seconds} seconds elapsed` : ''}.`;
    }

    ensureNestingElapsedElement(status = document.getElementById('nesting-validation-status')) {
        let elapsed = document.getElementById('nesting-elapsed-time');
        if (elapsed || !status || typeof document.createElement !== 'function') return elapsed;
        elapsed = document.createElement('span');
        elapsed.id = 'nesting-elapsed-time';
        elapsed.className = 'section-hint';
        elapsed.setAttribute('aria-hidden', 'true');
        status.insertAdjacentElement('afterend', elapsed);
        return elapsed;
    }

    applyPlacementOverrides(plan) {
        const overrides = this.fabricationSettings.nesting.placementOverrides || {};
        plan.sheets.forEach(sheet => sheet.placements.forEach(placement => {
            const override = overrides[placement.instanceId];
            if (!override?.pinned) return;
            const profile = this.materials.find(item => item.id === sheet.materialId);
            const allowed = profile?.allowedRotations || [0];
            const rotation = allowed.includes(Number(override.rotationDeg)) ? Number(override.rotationDeg) : placement.rotationDeg;
            rebuildPlacementPolygon(placement, Number(override.xMm), Number(override.yMm), rotation);
            placement.pinned = true;
        }));
        return plan;
    }

    renderNestingPlaceholder(message) {
        const wrap = document.getElementById('nesting-svg-wrap');
        if (wrap) wrap.innerHTML = `<div class="nesting-empty">${escapeHtml(message)}</div>`;
        document.getElementById('nesting-summary').innerHTML = '';
        document.getElementById('material-cost-breakdown').innerHTML = '';
        document.getElementById('nesting-actionable-findings').innerHTML = '';
        document.getElementById('nesting-sheet-list').innerHTML = '';
        document.getElementById('nesting-placement-editor').hidden = true;
        const sheetSelect = document.getElementById('nesting-sheet-select');
        sheetSelect.innerHTML = '';
        sheetSelect.disabled = true;
        const candidateSelect = document.getElementById('nesting-candidate-select');
        candidateSelect.innerHTML = '';
        candidateSelect.disabled = true;
        this.renderCandidateExplanation([]);
        this.renderSheetWorkflowStatus();
    }

    renderNestingPlan() {
        const plan = this.currentPlan;
        if (!plan) {
            this.renderNestingPlaceholder('No sheet layout generated yet.');
            return;
        }
        const findings = [...this.validateMaterials(), ...this.assignmentFindings, ...(plan.findings || [])];
        const errors = findings.filter(item => item.severity === 'error');
        const warnings = findings.filter(item => item.severity === 'warning');
        const status = document.getElementById('nesting-validation-status');
        status.className = `inline-status ${errors.length ? 'error' : 'success'}`;
        status.textContent = errors.length
            ? `${errors.length} blocking layout error${errors.length === 1 ? '' : 's'}: ${errors[0].message}`
            : warnings.length
                ? `Layout is valid with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.`
                : 'Layout is valid: stock bounds, trim margins, spacing and overlaps passed.';

        document.getElementById('nesting-generated-time').textContent = `Generated ${new Date(plan.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${readable(plan.selectedStrategy)} strategy`;
        const materialSummary = summarizeMaterials(this.currentManifest?.parts || [], this.materials, this.fabricationSettings.materialAssignments, plan.sheets);
        const totalWeightKg = materialSummary.reduce((sum, item) => sum + Number(item.weightKg || 0), 0);
        const totalCost = materialSummary.reduce((sum, item) => sum + Number(item.estimatedCost || 0), 0);
        document.getElementById('nesting-summary').innerHTML = summaryItems([
            [plan.totals.sheetCount, 'Sheets'],
            [`${plan.totals.utilizationPercent}%`, 'Utilisation'],
            [`${round(plan.totals.wasteAreaMm2 / 1e6, 2)} m²`, 'Waste'],
            [`${round((plan.totals.reusableOffcutAreaMm2 || 0) / 1e6, 2)} m²`, 'Reusable offcut'],
            [plan.unplaced.length, 'Unplaced'],
            [plan.excluded?.length || 0, 'Nesting exclusions'],
            [`${round(totalWeightKg, 1)} kg`, 'Estimated weight'],
            [formatCurrency(totalCost, this.fabricationSettings.currencyCode), 'Sheet cost']
        ]);
        document.getElementById('material-cost-breakdown').innerHTML = materialSummary.length
            ? materialSummary.map(item => `<div class="material-cost-row">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${item.sheets} sheet${item.sheets === 1 ? '' : 's'}</span>
                <span>${escapeHtml(formatCurrency(item.sheetCost, this.fabricationSettings.currencyCode))} each</span>
                <span>${escapeHtml(formatCurrency(item.estimatedCost, this.fabricationSettings.currencyCode))}</span>
            </div>`).join('')
            : '';
        this.renderNestingFindings(findings);

        const candidateSelect = document.getElementById('nesting-candidate-select');
        const candidateModels = describeNestingCandidates(plan.candidateSummaries || [], plan.selectedStrategy);
        candidateSelect.disabled = false;
        candidateSelect.innerHTML = candidateModels.map(candidate => `
            <option value="${escapeAttr(candidate.strategy)}" ${candidate.strategy === plan.selectedStrategy ? 'selected' : ''}>
                ${candidate.rank}. ${readable(candidate.strategy)} · ${candidate.summary}
            </option>`).join('');
        this.renderCandidateExplanation(candidateModels);

        const sheetSelect = document.getElementById('nesting-sheet-select');
        sheetSelect.disabled = !plan.sheets.length;
        sheetSelect.innerHTML = plan.sheets.map(sheet => `<option value="${escapeAttr(sheet.id)}" ${sheet.id === this.selectedSheetId ? 'selected' : ''}>${escapeHtml(sheet.materialName)} · sheet ${sheet.index}</option>`).join('');
        const sheet = plan.sheets.find(item => item.id === this.selectedSheetId) || plan.sheets[0];
        if (sheet) this.selectedSheetId = sheet.id;
        document.getElementById('nesting-svg-wrap').innerHTML = sheet ? nestingSvg(sheet, this.selectedPlacementId) : `<div class="nesting-empty">No sheets were needed.</div>`;
        this.renderPlacementEditor(sheet);
        document.getElementById('nesting-sheet-list').innerHTML = `
            <div class="sheet-summary-list">${plan.sheets.map(item => `
                <button class="sheet-summary-card ${item.id === this.selectedSheetId ? 'active' : ''}" type="button" data-sheet-id="${escapeAttr(item.id)}" aria-pressed="${item.id === this.selectedSheetId}">
                    <strong>${escapeHtml(item.materialName)} · sheet ${item.index}</strong>
                    <span>${item.placements.length} parts</span>
                    <span>${item.utilizationPercent}% used</span>
                    <span>${round(item.wasteAreaMm2 / 1e6, 2)} m² waste</span>
                </button>`).join('')}
            </div>
            ${nestingPlacementTable(plan, this.selectedPlacementId)}
            ${excludedPartRestorationList(this.currentManifest)}`;
        this.renderSheetWorkflowStatus();
    }

    renderNestingFindings(findings = []) {
        const root = document.getElementById('nesting-actionable-findings');
        if (!root) return;
        const actionable = findings.filter(item => item.severity === 'error' || item.severity === 'warning').slice(0, 8);
        root.innerHTML = actionable.map((item, index) => `
            <article class="nesting-actionable-finding ${escapeAttr(item.severity || 'warning')}">
                <span><strong>${escapeHtml(getFindingTitle(item))}</strong><br>${escapeHtml(item.message || 'Review this sheet-plan finding.')}</span>
                <button class="btn btn-secondary btn-sm" type="button" data-nesting-finding-index="${index}">Fix or locate</button>
            </article>`).join('');
        root.querySelectorAll('[data-nesting-finding-index]').forEach(button => {
            button.addEventListener('click', () => this.focusNestingFinding(actionable[Number(button.dataset.nestingFindingIndex)]));
        });
    }

    focusNestingFinding(finding = {}) {
        if (Number.isInteger(finding.materialIndex)) {
            const target = Array.from(document.querySelectorAll('[data-material-index]')).find(item => (
                Number(item.dataset.materialIndex) === finding.materialIndex
            ));
            target?.focus();
            target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            return;
        }
        const partId = finding.partIds?.[0] || finding.partId;
        if (partId) {
            this.openSheetsForPart(partId);
            return;
        }
        document.getElementById('btn-regenerate-nest')?.focus();
    }

    renderCandidateExplanation(candidateModels = []) {
        const select = document.getElementById('nesting-candidate-select');
        if (!select?.parentElement || typeof document.createElement !== 'function') return;
        let explanation = document.getElementById('nesting-candidate-explanation');
        if (!explanation) {
            explanation = document.createElement('span');
            explanation.id = 'nesting-candidate-explanation';
            explanation.className = 'section-hint';
            explanation.setAttribute('aria-live', 'polite');
            select.parentElement.appendChild(explanation);
            select.setAttribute('aria-describedby', explanation.id);
        }
        const selected = candidateModels.find(candidate => candidate.strategy === select.value)
            || candidateModels.find(candidate => candidate.selected)
            || candidateModels[0];
        explanation.textContent = selected ? `${selected.summary}. ${selected.reason}` : '';
        explanation.hidden = !selected;
    }

    selectPlacement(instanceId) {
        if (!instanceId) return;
        this.selectedPlacementId = instanceId;
        this.renderNestingPlan();
        document.getElementById('nesting-placement-editor')?.querySelector('input')?.focus();
    }

    renderPlacementEditor(sheet) {
        const root = document.getElementById('nesting-placement-editor');
        const placement = sheet?.placements.find(item => item.instanceId === this.selectedPlacementId);
        if (!placement) {
            root.hidden = true;
            root.innerHTML = '';
            return;
        }
        root.hidden = false;
        root.innerHTML = `
            <strong title="${escapeAttr(placement.name)}">${escapeHtml(placement.name)}</strong>
            <label class="placement-field">X (mm)<input type="number" step="0.1" data-placement-field="xMm" value="${round(placement.xMm, 2)}"></label>
            <label class="placement-field">Y (mm)<input type="number" step="0.1" data-placement-field="yMm" value="${round(placement.yMm, 2)}"></label>
            <button class="btn btn-secondary" type="button" data-rotate-placement>Rotate ${nextRotationLabel(placement, sheet, this.materials)}</button>
            <button class="btn btn-secondary" type="button" data-edit-placement-design>Edit part in Design</button>
            <button class="btn btn-secondary" type="button" data-exclude-placement>Exclude part</button>
            <label class="check-row"><input type="checkbox" data-placement-pin ${placement.pinned ? 'checked' : ''}><span>Pin through regeneration</span></label>`;
    }

    handlePlacementEdit(event) {
        const sheet = this.currentPlan?.sheets.find(item => item.id === this.selectedSheetId);
        const placement = sheet?.placements.find(item => item.instanceId === this.selectedPlacementId);
        if (!placement) return;
        if (event.target.matches('[data-placement-field]')) {
            const value = Number(event.target.value);
            if (!Number.isFinite(value)) return;
            const xMm = event.target.dataset.placementField === 'xMm' ? value : placement.xMm;
            const yMm = event.target.dataset.placementField === 'yMm' ? value : placement.yMm;
            rebuildPlacementPolygon(placement, xMm, yMm, placement.rotationDeg);
            placement.pinned = true;
            this.persistPlacementOverride(placement);
        } else if (event.target.matches('[data-placement-pin]')) {
            placement.pinned = event.target.checked;
            if (placement.pinned) this.persistPlacementOverride(placement);
            else delete this.fabricationSettings.nesting.placementOverrides[placement.instanceId];
        }
        refreshReusableOffcuts(sheet, this.currentPlan);
        this.currentPlan.findings = validateNestingPlan(this.currentPlan, this.materials);
        this.refreshCurrentPlanInputFingerprint();
        this.invalidateFrom('sheets');
        this.markProjectMutation('Edit sheet placement');
        this.renderNestingPlan();
    }

    handlePlacementAction(event) {
        const sheet = this.currentPlan?.sheets.find(item => item.id === this.selectedSheetId);
        const placement = sheet?.placements.find(item => item.instanceId === this.selectedPlacementId);
        if (!placement) return;
        if (event.target.closest('[data-edit-placement-design]')) {
            this.returnToDesignPart(placement.partId);
            return;
        }
        if (event.target.closest('[data-rotate-placement]')) {
            const profile = this.materials.find(item => item.id === sheet.materialId);
            const rotations = profile?.allowedRotations?.length ? profile.allowedRotations.map(Number) : [0];
            const currentIndex = Math.max(0, rotations.indexOf(Number(placement.rotationDeg)));
            const rotation = rotations[(currentIndex + 1) % rotations.length];
            rebuildPlacementPolygon(placement, placement.xMm, placement.yMm, rotation);
            placement.pinned = true;
            this.persistPlacementOverride(placement);
            refreshReusableOffcuts(sheet, this.currentPlan);
            this.currentPlan.findings = validateNestingPlan(this.currentPlan, this.materials);
            this.refreshCurrentPlanInputFingerprint();
            this.invalidateFrom('sheets');
            this.markProjectMutation('Rotate sheet placement');
            this.renderNestingPlan();
        }
        if (event.target.closest('[data-exclude-placement]')) {
            if (!window.confirm(`Exclude ${placement.name} from the fabrication manifest and all production files?`)) return;
            if (typeof this.cabinet.setPanelIncluded !== 'function') {
                this.ui.showNotification?.('Part inclusion editing is unavailable');
                return;
            }
            const selectedStrategy = this.currentPlan?.selectedStrategy
                || this.fabricationSettings.nesting.selectedStrategy;
            this.cabinet.setPanelIncluded(placement.partId, false);
            this.ui.afterCabinetMutation?.('Exclude part from fabrication');
            this.generateNesting({ strategy: selectedStrategy, announce: true });
        }
    }

    persistPlacementOverride(placement) {
        const sheet = this.currentPlan?.sheets.find(item => item.placements.some(candidate => candidate.instanceId === placement.instanceId));
        this.fabricationSettings.nesting.placementOverrides[placement.instanceId] = {
            xMm: round(placement.xMm, 3),
            yMm: round(placement.yMm, 3),
            rotationDeg: Number(placement.rotationDeg) || 0,
            sheetIndex: sheet?.index || 1,
            pinned: true
        };
    }

    getExportReadiness() {
        const materialFindings = this.validateMaterials();
        let currentInputsMatch = true;
        if (this.currentPlan && !this.nestingStale) {
            try {
                const manifest = applyBatchQuantity(
                    this.cabinet.getFabricationManifest(),
                    resolveBatchQuantityFromSettings(this.fabricationSettings)
                );
                const options = this.getNestingGenerationOptions(this.currentPlan.selectedStrategy);
                currentInputsMatch = this.currentPlanInputFingerprint === fingerprintNestingInputs(
                    manifest,
                    normalizeMaterialProfiles(this.materials),
                    options
                );
            } catch (_) {
                currentInputsMatch = false;
            }
        }
        const status = !this.currentPlan ? 'missing' : this.nestingStale || !currentInputsMatch ? 'stale' : 'ready';
        const planStateFinding = status === 'missing'
            ? [{
                code: 'NESTING_PLAN_MISSING',
                severity: 'error',
                message: 'Generate a sheet layout before creating production files.'
            }]
            : status === 'stale'
                ? [{
                    code: 'NESTING_PLAN_STALE',
                    severity: 'error',
                    message: 'The sheet layout is out of date. Regenerate it before creating production files.'
                }]
                : [];
        const findings = [
            ...materialFindings,
            ...this.assignmentFindings,
            ...planStateFinding,
            ...(this.currentPlan?.findings || [])
        ];
        const invalid = findings.some(item => item.severity === 'error');
        return {
            ok: status === 'ready' && !invalid,
            status: invalid && status === 'ready' ? 'invalid' : status,
            findings
        };
    }

    getExportOptions() {
        const readiness = this.getExportReadiness();
        const persistedSettings = clonePlain(this.fabricationSettings);
        return {
            ...persistedSettings,
            readiness,
            materials: normalizeMaterialProfiles(this.materials),
            materialAssignments: { ...this.fabricationSettings.materialAssignments },
            nesting: {
                ...(persistedSettings.nesting || {}),
                assignments: { ...this.fabricationSettings.materialAssignments },
                strategy: this.fabricationSettings.nesting.selectedStrategy
            },
            nestingPlan: readiness.ok ? stripInteractiveCandidateData(this.currentPlan) : null
        };
    }

    markProjectMutation(reason) {
        this.app.params = this.cabinet.params;
        this.ui.clearPackageAttemptFindings?.();
        this.ui.markMutation?.(reason);
    }

    async openProjectTools() {
        this.renderUserPresets();
        void this.ui.renderRecoveryRecords?.({ refresh: true });
        if (!this.projectDialog?.open) {
            if (typeof this.projectDialog?.showModal === 'function') this.projectDialog.showModal();
            else this.projectDialog?.setAttribute('open', '');
        }
        await this.renderRecentProjects();
    }

    async renderRecentProjects() {
        const root = document.getElementById('recent-project-list');
        if (!root) return;
        if (globalThis.window?.cabinetDesktop?.available !== true) {
            root.innerHTML = emptyState('Recent projects are available in the desktop app.');
            return;
        }
        root.innerHTML = emptyState('Loading recent projects...');
        try {
            const result = await requestDesktop('project.recent');
            const projects = Array.isArray(result?.projects) ? result.projects : [];
            root.innerHTML = projects.length ? projects.map(path => `
                <div class="recent-project-row">
                    <button type="button" data-recent-path="${escapeAttr(path)}" title="${escapeAttr(path)}">${escapeHtml(baseName(path))}</button>
                </div>`).join('') : emptyState('No recent project files yet.');
        } catch (error) {
            root.innerHTML = findingCard({ severity: 'error', code: 'RECENT_PROJECTS', message: error.message || String(error) });
        }
    }

    async openRecentProject(path) {
        if (this.ui.isDirty?.() && !window.confirm('Open this recent project? Unsaved changes remain available through autosave recovery.')) return;
        try {
            const result = await requestDesktop('project.openRecent', { path });
            if (result?.cancelled) return;
            const loaded = ProjectExporter.loadProject(result.content, data => this.app.applyProjectData(data, { file: { name: baseName(result.path || path) } }), error => this.app.handleProjectLoadError(error));
            if (loaded?.ok === false) throw loaded.error || new Error('The recent project could not be loaded.');
            this.projectDialog?.close();
        } catch (error) {
            this.ui.showNotification?.(`Open failed: ${error.message || error}`);
            await this.renderRecentProjects();
        }
    }

    readUserPresets() {
        try {
            const parsed = JSON.parse(window.localStorage.getItem(USER_PRESET_KEY) || '[]');
            return Array.isArray(parsed) ? parsed.filter(item => item?.name && item?.params) : [];
        } catch (_) {
            return [];
        }
    }

    writeUserPresets(presets) {
        window.localStorage.setItem(USER_PRESET_KEY, JSON.stringify(presets.slice(0, 30)));
    }

    saveUserPreset() {
        const nameInput = document.getElementById('user-preset-name');
        const name = String(nameInput?.value || '').trim();
        if (!name) return;
        const presets = this.readUserPresets();
        presets.unshift({ id: `preset-${Date.now()}`, name: name.slice(0, 60), createdAt: new Date().toISOString(), params: clonePlain(this.cabinet.params) });
        try {
            this.writeUserPresets(presets);
            nameInput.value = '';
            this.renderUserPresets();
            this.ui.showNotification?.(`Saved user preset: ${name}`);
        } catch (error) {
            this.ui.showNotification?.(`Preset save failed: ${error.message || error}`);
        }
    }

    renderUserPresets() {
        const root = document.getElementById('user-preset-list');
        if (!root) return;
        const presets = this.readUserPresets();
        root.innerHTML = presets.length ? presets.map(preset => `
            <div class="user-preset-row">
                <button type="button" data-apply-user-preset="${escapeAttr(preset.id)}" title="Apply ${escapeAttr(preset.name)}">${escapeHtml(preset.name)}</button>
                <button class="dialog-close" type="button" data-delete-user-preset="${escapeAttr(preset.id)}" aria-label="Delete ${escapeAttr(preset.name)}">Delete</button>
            </div>`).join('') : emptyState('No user presets saved on this device.');
    }

    handleUserPresetAction(event) {
        const apply = event.target.closest('[data-apply-user-preset]');
        const remove = event.target.closest('[data-delete-user-preset]');
        const presets = this.readUserPresets();
        if (remove) {
            const preset = presets.find(item => item.id === remove.dataset.deleteUserPreset);
            if (!preset || !window.confirm(`Delete the ${preset.name} preset?`)) return;
            this.writeUserPresets(presets.filter(item => item.id !== preset.id));
            this.renderUserPresets();
            return;
        }
        if (!apply) return;
        const preset = presets.find(item => item.id === apply.dataset.applyUserPreset);
        if (!preset) return;
        if (this.ui.isDirty?.() && !window.confirm(`Apply ${preset.name} to this project? You can undo the change.`)) return;
        this.ui.commitHistoryNow?.('Before user preset');
        const params = normalizeParams(clonePlain(preset.params));
        this.cabinet.params = params;
        this.app.params = params;
        this.cabinet.build();
        this.ui.setResetBaseline?.(params);
        this.ui.syncAllSliders?.(params);
        this.ui.syncControlInputs?.(params.controls);
        this.ui.selectPanel?.(null);
        this.ui.renderFabricationSummary?.();
        this.ensureProjectState();
        this.onDesignChanged();
        this.markProjectMutation(`Apply ${preset.name} preset`);
        this.projectDialog?.close();
        this.ui.showNotification?.(`Preset applied: ${preset.name}`);
    }
}

export function validateMaterialProfilesForWorkflow(profiles = []) {
    return profiles.flatMap((profile, index) => {
        const findings = validateMaterialProfile(profile).findings.map(item => ({ ...item, materialIndex: index }));
        if (!Array.isArray(profile.allowedRotations) || !profile.allowedRotations.length) {
            findings.push({ code: 'MATERIAL_ROTATIONS', severity: 'error', materialIndex: index, message: 'At least one part rotation must be allowed.' });
        }
        return findings;
    });
}

function materialProfileCard(profile, index, count, currencyCode = 'GBP') {
    const findings = rawMaterialFindings(profile);
    return `
        <article class="material-profile-card ${findings.some(item => item.severity === 'error') ? 'invalid' : ''}">
            <div class="material-card-heading">
                <div><strong>${escapeHtml(profile.name || `Material ${index + 1}`)}</strong><span>${formatMm(profile.sheetWidthMm)} x ${formatMm(profile.sheetHeightMm)} stock · ${escapeHtml(formatCurrency(profile.pricePerSheet, currencyCode))} per sheet</span></div>
                <button class="dialog-close" type="button" data-remove-material="${index}" ${count <= 1 ? 'disabled' : ''}>Remove</button>
            </div>
            <div class="material-fields">
                ${materialField(index, 'name', 'Name', profile.name, 'text')}
                ${materialField(index, 'nominalThicknessMm', 'Nominal thickness (mm)', profile.nominalThicknessMm)}
                ${materialField(index, 'measuredThicknessMm', 'Measured thickness (mm)', profile.measuredThicknessMm, 'number', '0.01')}
                ${materialField(index, 'sheetWidthMm', 'Sheet width (mm)', profile.sheetWidthMm)}
                ${materialField(index, 'sheetHeightMm', 'Sheet height (mm)', profile.sheetHeightMm)}
                <label class="material-field">Grain direction
                    <select data-material-index="${index}" data-material-field="grainDirection">
                        ${['none', 'length', 'width'].map(value => `<option value="${value}" ${profile.grainDirection === value ? 'selected' : ''}>${readable(value)}</option>`).join('')}
                    </select>
                </label>
                <label class="material-field">Finished faces
                    <select data-material-index="${index}" data-material-field="finishedFaces">
                        ${['none', 'one', 'two'].map(value => `<option value="${value}" ${profile.finishedFaces === value ? 'selected' : ''}>${readable(value)}</option>`).join('')}
                    </select>
                </label>
                ${materialField(index, 'densityKgM3', 'Density (kg/m³)', profile.densityKgM3, 'number', '1', '0')}
                ${materialField(index, 'pricePerSheet', `Price per sheet (${currencyCode})`, profile.pricePerSheet, 'number', '0.01', '0')}
                ${materialField(index, 'quantityAvailable', 'Sheets available (0 = unlimited)', profile.quantityAvailable, 'number', '1', '0')}
                ${materialField(index, 'trimMarginMm', 'Trim margin (mm)', profile.trimMarginMm, 'number', '0.1', '0')}
                ${materialField(index, 'partSpacingMm', 'Part spacing (mm)', profile.partSpacingMm, 'number', '0.1', '0')}
                ${materialField(index, 'supplier', 'Supplier', profile.supplier || '', 'text')}
                ${materialField(index, 'sku', 'Supplier SKU', profile.sku || '', 'text')}
                ${materialField(index, 'notes', 'Stock notes', profile.notes || '', 'text')}
                <div class="material-field wide"><span>Allowed rotations</span><div class="rotation-options">
                    ${[0, 90, 180, 270].map(rotation => `<label><input type="checkbox" data-material-index="${index}" data-material-rotation="${rotation}" ${(profile.allowedRotations || []).map(Number).includes(rotation) ? 'checked' : ''}>${rotation}°</label>`).join('')}
                </div></div>
            </div>
            ${findings.length ? `<div class="material-findings">${findings.map(item => escapeHtml(item.message)).join('<br>')}</div>` : ''}
        </article>`;
}

function materialField(index, field, label, value, type = 'number', step = '0.1', min = type === 'number' ? '0.01' : null) {
    return `<label class="material-field ${['name', 'notes'].includes(field) ? 'wide' : ''}">${escapeHtml(label)}
        <input type="${type}" data-material-index="${index}" data-material-field="${field}" value="${escapeAttr(value)}" ${type === 'number' ? `step="${step}" ${min == null ? '' : `min="${min}"`}` : ''}>
    </label>`;
}

function rawMaterialFindings(profile) {
    const findings = [];
    ['nominalThicknessMm', 'measuredThicknessMm', 'sheetWidthMm', 'sheetHeightMm'].forEach(field => {
        if (!Number.isFinite(Number(profile[field])) || Number(profile[field]) <= 0) findings.push({ severity: 'error', message: `${readable(field)} must be greater than zero.` });
    });
    if (!Array.isArray(profile.allowedRotations) || !profile.allowedRotations.length) findings.push({ severity: 'error', message: 'Choose at least one allowed rotation.' });
    if (Number(profile.sheetWidthMm) <= Number(profile.trimMarginMm) * 2 || Number(profile.sheetHeightMm) <= Number(profile.trimMarginMm) * 2) findings.push({ severity: 'error', message: 'Trim margins consume the usable sheet.' });
    return findings;
}

function hardwareDefinitionCard(definition, custom = false) {
    const thickness = definition.supportedPanelThicknessMm || [0, 0];
    return `<article class="hardware-definition-card">
        <div class="hardware-definition-heading">
            <strong>${escapeHtml(definition.name)}</strong>
            ${custom ? `<button class="dialog-close" type="button" data-remove-hardware-definition="${escapeAttr(definition.id)}" aria-label="Remove custom hardware definition ${escapeAttr(definition.name)}">Remove</button>` : ''}
        </div>
        <dl>
            <dt>ID</dt><dd>${escapeHtml(definition.id)}</dd>
            <dt>Panel</dt><dd>${formatMm(thickness[0])}–${formatMm(thickness[1])}</dd>
            <dt>Body</dt><dd>${dimensions(definition.body)}</dd>
            <dt>Keepout</dt><dd>${dimensions(definition.keepout)}</dd>
            <dt>Operations</dt><dd>${definition.operations.length}</dd>
        </dl>
        <button class="btn btn-secondary btn-sm" type="button" data-add-hardware-definition="${escapeAttr(definition.id)}">Add to BOM</button>
    </article>`;
}

function nestingPlacementTable(plan, selectedPlacementId) {
    const rows = (plan.sheets || []).flatMap(sheet => (sheet.placements || []).map(placement => `
        <tr class="${placement.instanceId === selectedPlacementId ? 'selected' : ''}">
            <td>${escapeHtml(sheet.materialName)}, sheet ${sheet.index}</td>
            <td>
                <button type="button" class="table-link" data-sheet-id="${escapeAttr(sheet.id)}" data-sheet-placement="${escapeAttr(placement.instanceId)}" aria-pressed="${placement.instanceId === selectedPlacementId}">
                    ${escapeHtml(placement.name)}
                </button>
            </td>
            <td>${round(placement.xMm, 2)}</td>
            <td>${round(placement.yMm, 2)}</td>
            <td>${Number(placement.rotationDeg) || 0}°</td>
            <td>${placement.pinned ? 'Pinned' : 'Automatic'}</td>
        </tr>`));
    return `<div class="nesting-placement-table-wrap">
        <table class="nesting-placement-table">
            <caption>Placed parts. Select a part to inspect or edit its position.</caption>
            <thead><tr><th scope="col">Sheet</th><th scope="col">Part</th><th scope="col">X (mm)</th><th scope="col">Y (mm)</th><th scope="col">Rotation</th><th scope="col">Placement</th></tr></thead>
            <tbody>${rows.length ? rows.join('') : '<tr><td colspan="6">No parts are placed.</td></tr>'}</tbody>
        </table>
    </div>`;
}

function excludedPartRestorationList(manifest) {
    const excluded = (manifest?.parts || []).filter(part => (
        part.includeInFabrication === false || part.included === false
    ));
    if (!excluded.length) return '';
    return `<section class="nesting-excluded-parts" aria-labelledby="nesting-excluded-title">
        <h4 id="nesting-excluded-title">Parts excluded from fabrication</h4>
        <p>Excluded parts do not appear in layouts or production files.</p>
        <ul>${excluded.map(part => `<li>
            <span>${escapeHtml(part.name || part.id)}</span>
            <button class="btn btn-secondary btn-sm" type="button" data-restore-fabrication-part="${escapeAttr(part.id)}">Restore part</button>
        </li>`).join('')}</ul>
    </section>`;
}

function nestingSvg(sheet, selectedPlacementId) {
    const padding = Math.max(20, Math.min(sheet.widthMm, sheet.heightMm) * 0.02);
    const viewWidth = sheet.widthMm + padding * 2;
    const viewHeight = sheet.heightMm + padding * 2;
    const shapes = sheet.placements.map(placement => {
        const points = placement.polygon.map(point => `${round(point.x + padding, 3)},${round(sheet.heightMm - point.y + padding, 3)}`).join(' ');
        const centerX = placement.polygon.reduce((sum, point) => sum + point.x, 0) / placement.polygon.length + padding;
        const centerY = sheet.heightMm - placement.polygon.reduce((sum, point) => sum + point.y, 0) / placement.polygon.length + padding;
        return `<polygon class="nesting-part-shape ${placement.instanceId === selectedPlacementId ? 'selected' : ''}" points="${points}" data-placement-id="${escapeAttr(placement.instanceId)}" tabindex="0" role="button" aria-label="${escapeAttr(placement.name)}, select placement"></polygon>
            <text class="nesting-part-label" x="${round(centerX, 2)}" y="${round(centerY, 2)}" text-anchor="middle">${escapeHtml(shortLabel(placement.name))}</text>`;
    }).join('');
    const offcuts = (sheet.reusableOffcuts || []).map(offcut => `<rect class="nesting-offcut-shape" x="${round(offcut.xMm + padding, 3)}" y="${round(sheet.heightMm - offcut.yMm - offcut.heightMm + padding, 3)}" width="${round(offcut.widthMm, 3)}" height="${round(offcut.heightMm, 3)}"><title>Reusable offcut ${round(offcut.widthMm, 1)} by ${round(offcut.heightMm, 1)} mm</title></rect>`).join('');
    return `<svg viewBox="0 0 ${round(viewWidth, 3)} ${round(viewHeight, 3)}" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="True-shape nesting preview for ${escapeAttr(sheet.materialName)}, sheet ${sheet.index}">
        <title>${escapeHtml(sheet.materialName)} sheet ${sheet.index}, ${sheet.placements.length} parts</title>
        <rect x="${padding}" y="${padding}" width="${sheet.widthMm}" height="${sheet.heightMm}" fill="#fffefa" stroke="#181816" stroke-width="2" vector-effect="non-scaling-stroke"></rect>
        <rect class="nesting-sheet-margin" x="${padding + sheet.trimMarginMm}" y="${padding + sheet.trimMarginMm}" width="${Math.max(0, sheet.widthMm - sheet.trimMarginMm * 2)}" height="${Math.max(0, sheet.heightMm - sheet.trimMarginMm * 2)}"></rect>
        ${offcuts}
        ${shapes}
    </svg>`;
}

function rebuildPlacementPolygon(placement, xMm, yMm, rotationDeg) {
    const points = sourcePartPoints(placement.sourcePart, placement.polygon);
    const angle = Number(rotationDeg || 0) * Math.PI / 180;
    const rotated = points.map(point => ({ x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) }));
    const bounds = polygonBounds(rotated);
    const normalized = rotated.map(point => ({ x: point.x - bounds.minX, y: point.y - bounds.minY }));
    const targetX = Number.isFinite(Number(xMm)) ? Number(xMm) : placement.xMm;
    const targetY = Number.isFinite(Number(yMm)) ? Number(yMm) : placement.yMm;
    placement.xMm = targetX;
    placement.yMm = targetY;
    placement.rotationDeg = Number(rotationDeg) || 0;
    placement.localOriginOffset = { xMm: -bounds.minX, yMm: -bounds.minY };
    placement.polygon = normalized.map(point => ({ x: point.x + targetX, y: point.y + targetY }));
    placement.bounds = polygonBounds(placement.polygon);
}

function sourcePartPoints(sourcePart, fallback) {
    const candidates = [sourcePart?.outline?.points, sourcePart?.contour?.points, sourcePart?.profilePoints];
    const selected = candidates.find(points => Array.isArray(points) && points.length >= 3);
    const points = selected
        ? selected.map(point => ({ x: Number(point.x ?? point.xMm) || 0, y: Number(point.y ?? point.yMm) || 0 }))
        : (fallback || []).map(point => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }));
    const bounds = polygonBounds(points);
    return points.map(point => ({ x: point.x - bounds.minX, y: point.y - bounds.minY }));
}

function refreshReusableOffcuts(sheet, plan) {
    if (!sheet?.placements?.length) {
        if (sheet) {
            sheet.reusableOffcuts = [];
            sheet.reusableOffcutAreaMm2 = 0;
        }
        return;
    }
    const margin = Number(sheet.trimMarginMm) || 0;
    const spacing = Number(sheet.partSpacingMm) || 0;
    const usableRight = Number(sheet.widthMm) - margin;
    const usableTop = Number(sheet.heightMm) - margin;
    const usedMaxX = Math.max(...sheet.placements.map(item => item.bounds.maxX));
    const usedMaxY = Math.max(...sheet.placements.map(item => item.bounds.maxY));
    sheet.reusableOffcuts = [
        { id: `${sheet.id}:right`, xMm: usedMaxX + spacing, yMm: margin, widthMm: usableRight - usedMaxX - spacing, heightMm: usableTop - margin },
        { id: `${sheet.id}:top`, xMm: margin, yMm: usedMaxY + spacing, widthMm: Math.max(0, Math.min(usedMaxX, usableRight) - margin), heightMm: usableTop - usedMaxY - spacing }
    ].filter(item => item.widthMm > 0 && item.heightMm > 0)
        .map(item => ({ ...item, areaMm2: item.widthMm * item.heightMm }))
        .filter(item => item.areaMm2 >= 50000);
    sheet.reusableOffcutAreaMm2 = sheet.reusableOffcuts.reduce((sum, item) => sum + item.areaMm2, 0);
    if (plan?.totals) plan.totals.reusableOffcutAreaMm2 = plan.sheets.reduce((sum, item) => sum + (item.reusableOffcutAreaMm2 || 0), 0);
}

function polygonBounds(points) {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function nextRotationLabel(placement, sheet, materials) {
    const profile = materials.find(item => item.id === sheet.materialId);
    const rotations = profile?.allowedRotations?.length ? profile.allowedRotations.map(Number) : [0];
    const index = Math.max(0, rotations.indexOf(Number(placement.rotationDeg)));
    return `${rotations[(index + 1) % rotations.length]}°`;
}

function stripInteractiveCandidateData(plan) {
    if (!plan) return null;
    const portable = { ...plan };
    delete portable.candidates;
    return portable;
}

function hasExpectedNestingCoverage(plan, manifest) {
    const expected = (manifest?.parts || [])
        .filter(part => part.includeInFabrication !== false && part.included !== false)
        .flatMap(part => Array.from(
            { length: Math.max(1, Math.round(Number(part.quantity) || 1)) },
            (_, index) => `${part.id}:${index + 1}`
        ))
        .sort();
    const actual = [
        ...(plan?.sheets || []).flatMap(sheet => (
            (sheet.placements || []).map(placement => placement.instanceId)
        )),
        ...(plan?.unplaced || []).map(item => item.instanceId),
        ...(plan?.excluded || []).map(item => item.instanceId)
    ].map(String).sort();
    return actual.length === expected.length
        && new Set(actual).size === actual.length
        && actual.every((instanceId, index) => instanceId === expected[index]);
}

function resolveBatchQuantityFromSettings(settings = {}) {
    const workshop = settings.workshopProfile || settings.workshop || {};
    const value = settings.batchQuantity ?? settings.batch?.quantity ?? workshop.defaultBatchQuantity ?? 1;
    return Math.max(1, Math.round(Number(value) || 1));
}

function applyBatchQuantity(manifest, quantity) {
    if (quantity <= 1) return manifest;
    const result = clonePlain(manifest);
    result.parts = (result.parts || []).map(part => ({
        ...part,
        quantity: Math.max(1, Math.round(Number(part.quantity) || 1)) * quantity
    }));
    return result;
}

function summaryItems(items) {
    return items.map(([value, label]) => `<div class="maker-summary-item"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function countWorkflowFindings(findings = []) {
    return (Array.isArray(findings) ? findings : []).reduce((counts, finding) => {
        const severity = ['error', 'warning', 'info'].includes(finding?.severity) ? finding.severity : 'info';
        counts[severity] += 1;
        return counts;
    }, { error: 0, warning: 0, info: 0 });
}

function firstFindingMessage(findings = [], fallback = '') {
    return (Array.isArray(findings) ? findings : []).find(item => item?.severity === 'error')?.message
        || (Array.isArray(findings) ? findings : []).find(item => item?.severity === 'warning')?.message
        || fallback;
}

function ensureWorkflowActionStatus(button, id) {
    if (!button || typeof globalThis.document?.createElement !== 'function') return null;
    let status = document.getElementById(id);
    if (status) return status;
    const actionRow = button.parentElement;
    if (!actionRow?.parentElement) return null;
    status = document.createElement('div');
    status.id = id;
    status.className = 'section-hint workflow-action-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    actionRow.insertAdjacentElement('afterend', status);
    return status;
}

function hardwareFindingUsesControlEditor(finding) {
    return Boolean(finding && (finding.partIds || []).some(partId => (
        partId === 'panel_cp' || partId === 'panel_apron'
    )));
}

function hardwareFindingActionLabel(finding) {
    if (hardwareFindingUsesControlEditor(finding)) return 'Edit control layout';
    if (finding?.field || finding?.parameter) return 'Edit relevant setting';
    return (finding?.partIds || []).length ? 'Inspect affected part' : 'Review guidance';
}

function findingCard(item, options = {}) {
    const severity = ['error', 'warning', 'info'].includes(item.severity) ? item.severity : 'info';
    const action = item.correctiveAction || item.remedy || item.action;
    return `<article class="maker-finding ${severity}">
        <strong>${escapeHtml(severityLabel(severity))}</strong>
        <span>${escapeHtml(item.message || 'Finding reported.')}</span>
        ${action ? `<div>${escapeHtml(action)}</div>` : ''}
        ${item.code ? `<small class="issue-code">Reference: ${escapeHtml(item.code)}</small>` : ''}
        ${Number.isInteger(options.actionIndex) ? `<button class="btn btn-secondary btn-sm" type="button" data-hardware-finding="${options.actionIndex}">${escapeHtml(options.actionLabel || 'Inspect')}</button>` : ''}
    </article>`;
}

function emptyState(message) {
    return `<div class="section-hint">${escapeHtml(message)}</div>`;
}

function dimensions(value = {}) {
    return `${formatMm(value.widthMm)} × ${formatMm(value.heightMm)} × ${formatMm(value.depthMm)}`;
}

function formatMm(value) {
    const number = Number(value) || 0;
    return `${round(number, Number.isInteger(number) ? 0 : 2)} mm`;
}

function formatCurrency(value, currencyCode = 'GBP') {
    const amount = round(value, 2);
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currencyCode,
            currencyDisplay: 'code'
        }).format(amount);
    } catch (_) {
        return `${currencyCode} ${amount.toFixed(2)}`;
    }
}

function readable(value) {
    return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function severityLabel(value) {
    if (value === 'error') return 'Blocking error';
    if (value === 'warning') return 'Warning';
    return 'Information';
}

function groupBy(items, selector) {
    const groups = new Map();
    items.forEach(item => {
        const key = selector(item);
        const group = groups.get(key) || [];
        group.push(item);
        groups.set(key, group);
    });
    return groups;
}

function shortLabel(value) {
    const text = String(value || 'Part').replace(/^panel\s+/i, '');
    return text.length > 22 ? `${text.slice(0, 20)}…` : text;
}

function baseName(path) {
    return String(path || '').split(/[\\/]/).pop() || String(path || 'Project');
}

function sortWorkflowValue(value) {
    if (Array.isArray(value)) return value.map(sortWorkflowValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().flatMap(key => {
            const candidate = value[key];
            if (candidate === undefined || typeof candidate === 'function') return [];
            return [[key, sortWorkflowValue(candidate)]];
        }));
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value ?? null;
}

function normalizeWorkflowFindings(findings = []) {
    return findings.map(item => ({
        code: String(item?.code || ''),
        severity: String(item?.severity || 'info'),
        partIds: Array.isArray(item?.partIds) ? [...item.partIds].map(String).sort() : [],
        message: String(item?.message || '')
    })).sort((left, right) => (
        `${left.severity}:${left.code}:${left.partIds.join(',')}:${left.message}`
            .localeCompare(`${right.severity}:${right.code}:${right.partIds.join(',')}:${right.message}`)
    ));
}

function summarizeWorkflowPlan(plan) {
    if (!plan) return null;
    return {
        selectedStrategy: plan.selectedStrategy || null,
        sheets: (plan.sheets || []).map(sheet => ({
            id: sheet.id,
            materialId: sheet.materialId,
            index: sheet.index,
            placements: (sheet.placements || []).map(placement => ({
                instanceId: placement.instanceId,
                partId: placement.partId,
                xMm: round(placement.xMm, 3),
                yMm: round(placement.yMm, 3),
                rotationDeg: Number(placement.rotationDeg) || 0,
                pinned: Boolean(placement.pinned)
            }))
        })),
        unplaced: (plan.unplaced || []).map(item => item.instanceId || item.partId || item.id || String(item)),
        excluded: (plan.excluded || []).map(item => item.instanceId || item.partId || item.id || String(item)),
        findings: normalizeWorkflowFindings(plan.findings || [])
    };
}

function clonePlain(value) {
    return JSON.parse(JSON.stringify(value));
}

function round(value, precision = 2) {
    const factor = 10 ** precision;
    return Math.round((Number(value) || 0) * factor) / factor;
}

function clampNumber(value, minimum, maximum) {
    const number = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
}
