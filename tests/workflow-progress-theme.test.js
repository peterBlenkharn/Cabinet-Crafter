import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    MakerWorkflow,
    fingerprintNestingInputs,
    fingerprintWorkflowValue,
    normalizeWorkflowProgress
} from '../wwwroot/js/maker-workflow.js';
import { createNestingPlan } from '../wwwroot/js/nesting.js';
import { createManifestFixture } from './helpers/fixtures.js';

function fakeButton(step, number) {
    const classes = new Set();
    const numberNode = { textContent: String(number) };
    const attributes = new Map();
    return {
        dataset: { makerStep: step, stepNumber: String(number) },
        textContent: `${number} ${step}`,
        classList: {
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            },
            contains(name) {
                return classes.has(name);
            }
        },
        querySelector(selector) {
            return selector === '.maker-step-number' ? numberNode : null;
        },
        setAttribute(name, value) {
            attributes.set(name, value);
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
        numberNode,
        classes,
        attributes
    };
}

function withWorkflowDocument(run) {
    const previousDocument = globalThis.document;
    const controls = new Map([
        ['btn-design-continue', { hidden: false }],
        ['btn-hardware-continue', { disabled: false, title: '' }],
        ['btn-review-continue', { disabled: false, title: '' }],
        ['btn-sheets-continue', { disabled: false, title: '' }]
    ]);
    globalThis.document = {
        getElementById(id) {
            return controls.get(id) || null;
        }
    };
    try {
        return run(controls);
    } finally {
        globalThis.document = previousDocument;
    }
}

test('stage navigation does not imply workflow completion', () => withWorkflowDocument(() => {
    const workflow = Object.create(MakerWorkflow.prototype);
    workflow.ui = { showNotification() {} };
    workflow.activeView = 'design';
    workflow.completedStages = new Set();
    workflow.reviewBlocked = false;
    workflow.navButtons = [
        fakeButton('design', 1),
        fakeButton('hardware', 2),
        fakeButton('review', 3),
        fakeButton('sheets', 4),
        fakeButton('export', 5)
    ];

    workflow.setActiveStep('hardware');

    assert.equal(workflow.activeView, 'hardware');
    assert.deepEqual([...workflow.completedStages], []);
    assert.equal(workflow.navButtons[0].classes.has('complete'), false);
    assert.equal(workflow.navButtons[1].classes.has('active'), true);
}));

test('only explicit, sequential confirmation marks stages complete', () => withWorkflowDocument(controls => {
    const workflow = Object.create(MakerWorkflow.prototype);
    workflow.ui = { showNotification() {} };
    workflow.activeView = 'design';
    workflow.completedStages = new Set();
    const fabricationSettings = {};
    Object.defineProperty(workflow, 'fabricationSettings', { value: fabricationSettings });
    workflow.computeStageFingerprint = step => `fingerprint:${step}`;
    workflow.markProjectMutation = () => {};
    workflow.reviewBlocked = false;
    workflow.navButtons = [
        fakeButton('design', 1),
        fakeButton('hardware', 2),
        fakeButton('review', 3),
        fakeButton('sheets', 4),
        fakeButton('export', 5)
    ];

    assert.equal(workflow.confirmStage('hardware', { notify: false }), false);
    assert.equal(workflow.confirmStage('design', { notify: false }), true);
    assert.equal(workflow.confirmStage('hardware', { notify: false }), true);
    assert.deepEqual([...workflow.completedStages], ['design', 'hardware']);
    assert.equal(fabricationSettings.workflow.stages.design.status, 'confirmed');
    assert.equal(fabricationSettings.workflow.stages.hardware.fingerprint, 'fingerprint:hardware');
    assert.equal(workflow.navButtons[0].numberNode.textContent, '\u2713');
    assert.equal(controls.get('btn-review-continue').disabled, false);

    workflow.invalidateFrom('hardware');
    assert.deepEqual([...workflow.completedStages], ['design']);
    assert.equal(fabricationSettings.workflow.stages.hardware.status, 'stale');
    assert.equal(controls.get('btn-review-continue').disabled, true);
}));

test('workflow fingerprints are deterministic and sensitive to meaningful changes', () => {
    const first = fingerprintWorkflowValue({
        controls: { players: 2, buttons: 6 },
        dimensions: [650, 1700, 600]
    });
    const reordered = fingerprintWorkflowValue({
        dimensions: [650, 1700, 600],
        controls: { buttons: 6, players: 2 }
    });
    const changed = fingerprintWorkflowValue({
        dimensions: [650, 1700, 610],
        controls: { buttons: 6, players: 2 }
    });

    assert.equal(first, reordered);
    assert.notEqual(first, changed);
});

test('workflow progress normalization rejects malformed records', () => {
    const state = normalizeWorkflowProgress({
        version: 999,
        stages: {
            design: { status: 'confirmed', fingerprint: 'abc', confirmedAt: '2026-07-25T10:00:00.000Z' },
            unknown: { status: 'confirmed', fingerprint: 'ignore' },
            hardware: { status: 'complete', fingerprint: 'ignore' }
        }
    });

    assert.equal(state.version, 1);
    assert.deepEqual(Object.keys(state.stages), ['design']);
    assert.equal(state.stages.design.status, 'confirmed');
});

test('export readiness never starts nesting as a side effect', () => {
    const workflow = Object.create(MakerWorkflow.prototype);
    workflow.currentPlan = null;
    workflow.nestingStale = true;
    workflow.assignmentFindings = [];
    workflow.validateMaterials = () => [];
    workflow.generateNesting = () => {
        throw new Error('readiness must not generate layouts');
    };

    const missing = workflow.getExportReadiness();
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 'missing');
    assert.match(missing.findings[0].message, /Generate a sheet layout/);

    workflow.currentPlan = { findings: [] };
    const stale = workflow.getExportReadiness();
    assert.equal(stale.ok, false);
    assert.equal(stale.status, 'stale');

    workflow.nestingStale = false;
    const manifest = { parts: [] };
    const settings = { nesting: { selectedStrategy: 'area', placementOverrides: {} } };
    Object.defineProperty(workflow, 'fabricationSettings', { value: settings });
    Object.defineProperty(workflow, 'materials', { value: [] });
    workflow.cabinet = { getFabricationManifest: () => manifest };
    workflow.getNestingGenerationOptions = () => ({ strategy: 'area' });
    workflow.currentPlanInputFingerprint = fingerprintNestingInputs(manifest, [], { strategy: 'area' });
    const ready = workflow.getExportReadiness();
    assert.equal(ready.ok, true);
    assert.equal(ready.status, 'ready');
});

test('nesting input fingerprints ignore persisted output and project labels', () => {
    const manifest = createManifestFixture();
    const options = {
        selectedStrategy: 'area',
        strategy: 'area',
        assignments: { side_left: 'mdf-18' },
        persistedPlan: { storedAt: 'first', plan: { sheets: [1] } }
    };
    const first = fingerprintNestingInputs(manifest, manifest.materials, options);
    const changedOutput = fingerprintNestingInputs({
        ...manifest,
        project: { name: 'Renamed project' },
        parameters: { fabricationSettings: { nesting: { persistedPlan: { large: true } } } }
    }, manifest.materials, {
        ...options,
        persistedPlan: { storedAt: 'second', plan: { sheets: [2, 3] } }
    });

    assert.equal(first, changedOutput);
    assert.notEqual(first, fingerprintNestingInputs(
        { ...manifest, parts: manifest.parts.map((part, index) => index ? part : { ...part, quantity: part.quantity + 1 }) },
        manifest.materials,
        options
    ));
});

test('confirmed sheet and export stages survive an exact project reload', () => {
    const manifest = createManifestFixture();
    const assignments = Object.fromEntries(manifest.parts.map(part => [part.id, part.materialId]));
    const settings = {
        materialAssignments: assignments,
        nesting: { selectedStrategy: 'area', placementOverrides: {} },
        workflow: normalizeWorkflowProgress()
    };
    const params = {
        width: 650,
        height: 1700,
        materials: structuredClone(manifest.materials),
        hardwareDefinitions: [],
        fabricationInclusion: {},
        fabricationSettings: settings
    };
    const plan = createNestingPlan(manifest, manifest.materials, {
        assignments,
        strategy: 'area',
        includeCandidates: true,
        selectedStrategy: 'area',
        placementOverrides: {},
        pinnedPlacements: []
    });

    const createWorkflow = (workflowParams, currentPlan = null) => {
        const instance = Object.create(MakerWorkflow.prototype);
        instance.cabinet = {
            params: workflowParams,
            getFabricationManifest: () => structuredClone(manifest)
        };
        instance.app = { params: workflowParams };
        instance.ui = { getPreflightResults: () => [], showNotification() {} };
        instance.currentPlan = currentPlan;
        instance.currentManifest = currentPlan ? structuredClone(manifest) : null;
        instance.currentPlanInputFingerprint = null;
        instance.nestingStale = !currentPlan;
        instance.nestingBusy = false;
        instance.assignmentFindings = [];
        instance.reviewResults = [];
        instance.reviewBlocked = false;
        instance.completedStages = new Set();
        instance.selectedSheetId = null;
        instance.selectedPlacementId = null;
        instance.navButtons = [];
        instance.renderStepState = () => {};
        instance.markProjectMutation = () => {};
        instance.validateMaterials = () => [];
        instance.validateAssignments = () => [];
        if (currentPlan) instance.refreshCurrentPlanInputFingerprint();
        return instance;
    };

    const original = createWorkflow(params, plan);
    ['design', 'hardware', 'review', 'sheets', 'export'].forEach(step => {
        assert.equal(original.confirmStage(step, { notify: false }), true);
    });
    const storedPlacementX = settings.nesting.persistedPlan.plan.sheets[0].placements[0].xMm;
    original.currentPlan.sheets[0].placements[0].xMm += 10;
    assert.equal(settings.nesting.persistedPlan.plan.sheets[0].placements[0].xMm, storedPlacementX);

    const reopenedParams = structuredClone(params);
    const reopened = createWorkflow(reopenedParams);
    assert.equal(reopened.restorePersistedNestingPlan(structuredClone(manifest)), true);
    reopened.restoreConfirmedStages();

    assert.deepEqual([...reopened.completedStages], ['design', 'hardware', 'review', 'sheets', 'export']);
    assert.equal(reopened.getExportReadiness().ok, true);

    const changedManifest = structuredClone(manifest);
    changedManifest.parts[0].quantity += 1;
    const changed = createWorkflow(structuredClone(params));
    assert.equal(changed.restorePersistedNestingPlan(changedManifest), false);
    assert.equal(changed.currentPlan, null);
});

test('invalidating a nesting task advances its generation and clears busy state', () => {
    const workflow = Object.create(MakerWorkflow.prototype);
    let terminated = false;
    let rejectedError = null;
    let busy = true;
    workflow.nestingRequestId = 7;
    workflow.activeNestingTask = {
        worker: { terminate() { terminated = true; } },
        reject(error) { rejectedError = error; }
    };
    workflow.setNestingBusy = value => { busy = value; };

    workflow.cancelActiveNestingTask({ invalidateRequest: true });

    assert.equal(workflow.nestingRequestId, 8);
    assert.equal(workflow.activeNestingTask, null);
    assert.equal(terminated, true);
    assert.equal(rejectedError?.name, 'AbortError');
    assert.equal(busy, false);
});

test('a superseded nesting result cannot replace the current design state', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = { getElementById() { return null; } };
    try {
        const workflow = Object.create(MakerWorkflow.prototype);
        const settings = {
            materialAssignments: {},
            nesting: { selectedStrategy: 'area', placementOverrides: {} }
        };
        Object.defineProperty(workflow, 'fabricationSettings', { value: settings });
        Object.defineProperty(workflow, 'materials', { value: [] });
        workflow.cabinet = { getFabricationManifest: () => ({ parts: [] }) };
        workflow.currentPlan = null;
        workflow.currentManifest = null;
        workflow.nestingStale = true;
        workflow.nestingRequestId = 0;
        workflow.activeNestingTask = null;
        workflow.validateMaterials = () => [];
        workflow.ensureAssignments = () => false;
        workflow.validateAssignments = () => [];
        workflow.setNestingBusy = () => {};
        workflow.renderNestingPlaceholder = () => {};
        workflow.renderMaterials = () => {};
        let resolvePlan;
        workflow.runNestingTask = () => new Promise(resolve => { resolvePlan = resolve; });

        const pending = workflow.generateNesting();
        workflow.cancelActiveNestingTask({ invalidateRequest: true });
        resolvePlan({ selectedStrategy: 'area', sheets: [] });

        assert.equal(await pending, null);
        assert.equal(workflow.currentPlan, null);
        assert.equal(workflow.nestingStale, true);
    } finally {
        globalThis.document = previousDocument;
    }
});

test('excluding a placement keeps the selected strategy after mutation invalidation', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { confirm: () => true };
    try {
        const workflow = Object.create(MakerWorkflow.prototype);
        const settings = { nesting: { selectedStrategy: 'longest' } };
        Object.defineProperty(workflow, 'fabricationSettings', { value: settings });
        workflow.currentPlan = {
            selectedStrategy: 'area',
            sheets: [{
                id: 'sheet-1',
                placements: [{ instanceId: 'part-1', partId: 'panel-1', name: 'Panel' }]
            }]
        };
        workflow.selectedSheetId = 'sheet-1';
        workflow.selectedPlacementId = 'part-1';
        workflow.cabinet = { setPanelIncluded() {} };
        workflow.ui = { afterCabinetMutation: () => { workflow.currentPlan = null; } };
        let generatedWith = null;
        workflow.generateNesting = options => { generatedWith = options; };

        workflow.handlePlacementAction({
            target: { closest: selector => selector === '[data-exclude-placement]' }
        });

        assert.deepEqual(generatedWith, { strategy: 'area', announce: true });
    } finally {
        globalThis.window = previousWindow;
    }
});

test('tutorial snapshots progress and never calls a completion action', () => {
    const source = readFileSync(new URL('../wwwroot/js/guided-tutorial.js', import.meta.url), 'utf8');
    assert.match(source, /captureProgressState/);
    assert.match(source, /restoreProgressState/);
    assert.doesNotMatch(source, /\.confirmStage\s*\(/);
    assert.doesNotMatch(source, /\.commitAndNavigate\s*\(/);
});

test('workflow markup exposes explicit confirmation actions', () => {
    const html = readFileSync(new URL('../wwwroot/index.html', import.meta.url), 'utf8');
    assert.match(html, /id="btn-design-continue"[^>]*>Confirm design</);
    assert.match(html, /id="btn-hardware-continue"[^>]*>Confirm hardware/);
    assert.match(html, /id="btn-review-continue"[^>]*>Confirm review/);
    assert.match(html, /id="btn-sheets-continue"[^>]*>Confirm sheet plan/);
});

test('the maker workspace opens as a native modal dialog', () => {
    const source = readFileSync(new URL('../wwwroot/js/maker-workflow.js', import.meta.url), 'utf8');
    assert.match(source, /this\.dialog\.showModal\(\)/);
    assert.match(source, /makerReturnFocus/);
});

test('legacy user presets are normalized and become the reset baseline when applied', () => {
    const source = readFileSync(new URL('../wwwroot/js/maker-workflow.js', import.meta.url), 'utf8');
    assert.match(source, /import \{ normalizeParams \} from '\.\/cabinet\.js'/);
    assert.match(source, /const params = normalizeParams\(clonePlain\(preset\.params\)\)/);
    assert.match(source, /this\.ui\.setResetBaseline\?\.\(params\)/);
});

test('dark theme provides contrast fixes for workflow surfaces and sliders', () => {
    const css = readFileSync(new URL('../wwwroot/style.css', import.meta.url), 'utf8');
    assert.match(css, /:root\[data-theme="dark"\] \.maker-nav-step\.active[\s\S]*?color:\s*#171918/);
    assert.match(css, /:root\[data-theme="dark"\] \.maker-summary-item[\s\S]*?background:\s*var\(--panel-solid\)/);
    assert.match(css, /:root\[data-theme="dark"\] \.tab-btn\.active[\s\S]*?color:\s*#171918/);
    assert.match(css, /:root\[data-theme="dark"\] \.preset-card\.active \.preset-desc[\s\S]*?color:\s*#282b28/);
    assert.match(css, /:root\[data-theme="dark"\] \.layout-node:not\(\.joystick\)[\s\S]*?color:\s*#171918/);
    assert.match(css, /:root\[data-theme="dark"\] input\[type="range"\][\s\S]*?background:\s*#788178/);
    assert.match(css, /input\[type="range"\]::-webkit-slider-thumb[\s\S]*?background:\s*var\(--selected\)/);
});
