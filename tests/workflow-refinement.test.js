import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MakerWorkflow,
    buildExportReadinessModel,
    buildReviewViewModel,
    buildSheetWorkflowState,
    buildWorkflowStageState,
    buildWorkflowStagePresentation,
    describeNestingCandidates,
    getFindingTitle,
    normalizeExportReceipt,
    renderExportReadinessMarkup,
    renderWorkflowStatusMarkup
} from '../wwwroot/js/maker-workflow.js';

test('workflow stage state reports explicit prerequisites and repair actions', () => {
    const hardware = buildWorkflowStageState('hardware', { completedStages: [] });
    assert.equal(hardware.canConfirm, false);
    assert.equal(hardware.reason, 'Confirm Design before confirming Hardware.');
    assert.equal(hardware.nextAction, 'design');

    const review = buildWorkflowStageState('review', {
        completedStages: ['design', 'hardware'],
        reviewErrorCount: 2
    });
    assert.equal(review.status, 'blocked');
    assert.match(review.reason, /2 blocking review errors/);
    assert.equal(review.nextAction, 'review-first-error');

    const sheets = buildWorkflowStageState('sheets', {
        completedStages: ['design', 'hardware', 'review'],
        sheetReadiness: {
            ok: false,
            status: 'missing',
            findings: [{ severity: 'error', message: 'Generate a sheet layout.' }]
        }
    });
    assert.equal(sheets.canConfirm, false);
    assert.equal(sheets.nextAction, 'generate-sheets');
    assert.equal(sheets.nextActionLabel, 'Generate layouts');
});

test('hardware errors block confirmation and each stage has distinct live context', () => {
    const blocked = buildWorkflowStageState('hardware', {
        completedStages: ['design'],
        hardwareAnalysisAvailable: true,
        hardwareErrorCount: 2
    });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.nextAction, 'control-editor');
    assert.match(blocked.reason, /2 blocking hardware errors/);

    const settingRepair = buildWorkflowStageState('hardware', {
        completedStages: ['design'],
        hardwareAnalysisAvailable: true,
        hardwareErrorCount: 1,
        hardwareRepairAction: 'hardware-first-error',
        hardwareRepairActionLabel: 'Edit relevant setting'
    });
    assert.equal(settingRepair.nextAction, 'hardware-first-error');
    assert.equal(settingRepair.nextActionLabel, 'Edit relevant setting');

    const review = buildWorkflowStagePresentation('review', { status: 'ready' });
    const sheets = buildWorkflowStagePresentation('sheets', { status: 'stale' });
    assert.match(review.purpose, /manufacturing findings/);
    assert.match(sheets.purpose, /costed sheet plan/);
    assert.match(sheets.stateText, /needs reconfirmation/);
    assert.notEqual(review.definition, sheets.definition);
});

test('review model provides human titles and searches messages, references and panels', () => {
    const findings = [
        {
            code: 'REFERENCE_OPERATION_OMITTED',
            severity: 'info',
            message: 'Reference marks remain annotations.',
            partIds: ['panel_back']
        },
        {
            code: 'HARDWARE_BODY_COLLISION',
            severity: 'error',
            message: 'Joystick bodies overlap.',
            partIds: ['panel_cp']
        }
    ];
    const byPanel = buildReviewViewModel(findings, { query: 'panel_back', severity: 'all' });
    assert.equal(byPanel.visibleCount, 1);
    assert.equal(byPanel.findings[0].title, 'Reference operations are excluded from machine files');

    const errors = buildReviewViewModel(findings, { query: 'joystick', severity: 'error' });
    assert.equal(errors.visibleCount, 1);
    assert.equal(errors.status, 'blocked');
    assert.equal(errors.findings[0].sourceIndex, 1);
    assert.equal(getFindingTitle({ code: 'UNMAPPED_SAMPLE_CODE' }), 'Unmapped sample code');
});

test('sheet workflow model exposes ordered progress and elapsed generation state', () => {
    const busy = buildSheetWorkflowState({
        materialFindings: [],
        assignmentFindings: [],
        readiness: { ok: false, status: 'missing', findings: [] },
        busy: true,
        startedAt: 1000,
        now: 6500
    });
    assert.deepEqual(busy.steps.map(step => step.id), ['stock', 'assign', 'generate', 'inspect', 'confirm']);
    assert.equal(busy.status, 'busy');
    assert.equal(busy.elapsedMs, 5500);
    assert.match(busy.steps[2].detail, /5 seconds elapsed/);

    const confirmed = buildSheetWorkflowState({
        materialFindings: [],
        assignmentFindings: [],
        readiness: { ok: true, status: 'ready', findings: [] },
        confirmed: true
    });
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.steps.at(-1).status, 'complete');
});

test('nesting candidates state the deterministic ranking basis', () => {
    const candidates = describeNestingCandidates([
        { strategy: 'area', sheetCount: 1, utilizationPercent: 91.2, wasteAreaMm2: 120000, unplacedCount: 0 },
        { strategy: 'width', sheetCount: 2, utilizationPercent: 60, wasteAreaMm2: 500000, unplacedCount: 0 }
    ], 'area');
    assert.equal(candidates[0].rank, 1);
    assert.equal(candidates[0].selected, true);
    assert.match(candidates[0].summary, /1 sheet, 91.2% utilisation/);
    assert.match(candidates[0].reason, /unplaced parts, then sheet count, waste/);
});

test('export readiness is reported independently for each output', () => {
    const model = buildExportReadinessModel({
        preflightFindings: [],
        sheetReadiness: {
            ok: false,
            status: 'missing',
            findings: [{ code: 'NESTING_PLAN_MISSING', severity: 'error', message: 'Generate layouts.' }]
        }
    });
    assert.equal(model.status, 'partial');
    assert.equal(model.label, '2 of 3 outputs available');
    assert.equal(model.outputs.draft.available, true);
    assert.equal(model.outputs.production.available, true);
    assert.equal(model.outputs.package.available, false);
    assert.equal(model.outputs.package.action, 'sheets');

    const warnings = buildExportReadinessModel({
        preflightFindings: [{ code: 'CHECK', severity: 'warning', message: 'Check this.' }],
        sheetReadiness: { ok: true, status: 'ready', findings: [] }
    });
    assert.equal(warnings.outputs.production.status, 'review');
    assert.equal(warnings.outputs.package.status, 'review');
    assert.equal(buildExportReadinessModel({
        preflightFindings: warnings.outputs.production.findings,
        sheetReadiness: { ok: true, status: 'ready', findings: [] },
        warningsAcknowledged: true
    }).status, 'ready');
});

test('export receipt API normalizes delivery metadata without mutating input', () => {
    const source = {
        kind: 'package',
        filename: 'cabinet.zip',
        filePath: 'C:\\Exports\\cabinet.zip',
        byteLength: 4096,
        findings: [{ severity: 'warning', message: 'Check stock.' }]
    };
    const receipt = normalizeExportReceipt(source, new Date('2026-07-27T12:00:00.000Z'));
    assert.equal(receipt.label, 'Fabrication package');
    assert.equal(receipt.sizeBytes, 4096);
    assert.equal(receipt.openFolderAvailable, true);
    assert.equal(receipt.preflightStatus, 'warnings');
    assert.equal(receipt.timestamp, '2026-07-27T12:00:00.000Z');
    assert.equal(source.path, undefined);
});

test('busy nesting ignores duplicate generation actions', async () => {
    const workflow = Object.create(MakerWorkflow.prototype);
    workflow.nestingBusy = true;
    workflow.ui = { showNotification(message) { workflow.message = message; } };
    assert.equal(await workflow.generateNesting({ announce: true }), null);
    assert.match(workflow.message, /already in progress/);
});

test('status render helpers escape user-facing content', () => {
    const workflowMarkup = renderWorkflowStatusMarkup({
        reason: '<unsafe>',
        nextAction: 'review',
        nextActionLabel: 'Open review'
    });
    assert.match(workflowMarkup, /&lt;unsafe&gt;/);
    assert.doesNotMatch(workflowMarkup, /<unsafe>/);

    const exportMarkup = renderExportReadinessMarkup(buildExportReadinessModel({
        preflightFindings: [],
        sheetReadiness: { ok: true, status: 'ready', findings: [] }
    }));
    assert.match(exportMarkup, /data-export-output-status="draft"/);
    assert.match(exportMarkup, /All outputs ready/);
});
