import * as ProjectExporter from './export.js';
import {
    PRESETS,
    PANEL_COLOR_PALETTE,
    DEFAULT_PANEL_COLOR,
    cloneParams,
    formatParamValue,
    formatControlValue,
    COMPONENT_OVERRIDE_DEFINITIONS
} from './cabinet.js';
import { MANNEQUIN_PRESETS } from './dummy.js';
import {
    MAX_PROJECT_DOCUMENT_BYTES,
    MAX_RECOVERY_RECORD_BYTES,
    abandonPendingProjectOpen,
    assertTextWithinLimit,
    commitPendingProjectOpen,
    configureDesktopLifecycleHooks,
    getPendingProjectOpen,
    requestDesktop,
    utf8ByteLength
} from './project-document.js';
import { MakerWorkflow } from './maker-workflow.js';
import { createStatusService } from './status-service.js';
import { WorkspaceShell } from './workspace-shell.js';
import { SideProfileEditor } from './side-profile-editor.js';

const LAYOUT_EDITOR_WIDTH_MM = 360;
const LAYOUT_EDITOR_DEPTH_MM = 180;
const MM_PER_INCH = 25.4;
const HISTORY_LIMIT = 80;
const LEGACY_AUTOSAVE_KEY = 'cabinet-crafter:recovery:v2';
const RECOVERY_KEY_PREFIX = 'cabinet-crafter:recovery:v3:';
const DEFAULT_PROJECT_NAME = 'Untitled cabinet';
const HISTORY_DELAY_MS = 260;

export class UIManager {
    constructor(app) {
        this.app = app;
        this.cabinet = app.cabinet;
        this.dummy = app.dummy;

        this.activePanelId = null;
        this.activeDecalId = null;
        this.activeLayoutDrag = null;
        this.pendingLayoutPreview = null;
        this.layoutPreviewFrame = null;
        this.pendingCabinetPatch = null;
        this.pendingCabinetReason = null;
        this.pendingCabinetAfterBuild = null;
        this.cabinetUpdateFrame = null;
        this.artworkUpdateFrame = null;
        this.unitMode = readStoredUnitMode();
        this.resetBaseline = cloneParams(this.cabinet.params);
        this.history = [];
        this.historyIndex = -1;
        this.historyTimer = null;
        this.autosaveTimer = null;
        this.restoringHistory = false;
        this.savedSignature = '';
        this.pendingRecovery = null;
        this.pendingRecoveryDescriptor = null;
        this.recoveryRecords = [];
        this.recoveryId = createRecoveryId();
        this.currentProjectPath = null;
        this.hasSavedProject = false;
        this.autosaveFailure = null;
        this.projectTransitionPromise = Promise.resolve();
        this.nativeStateTimer = null;
        this.replacementDiscardRecoveryId = null;
        this.packageAttemptFindings = [];
        this.preflightResultsCache = null;
        this.guidedTutorial = null;
        this.guidedTutorialLoadPromise = null;
        this.learningActions = null;
        this.firstCabinetLessonId = 'first-cabinet';
        this.learningCoachBound = false;
        this.learningUnsubscribe = null;
        this.helpSystem = null;
        this.helpSystemPromise = null;
        this.activeOperations = new Set();

        configureDesktopLifecycleHooks({
            beforeCandidateOpen: async ({ type }) => {
                if (type !== 'project.openRecent' || !this.isDirty()) return true;
                const result = await this.writeAutosave({ force: true, announceFailure: true });
                return result.ok === true;
            }
        });

        this.initDOM();
        this.statusService = createStatusService(document);
        this.setTheme(readStoredTheme(), false);
        this.makerWorkflow = new MakerWorkflow(this);
        this.configureAccessibility();
        this.enhanceNumericControls();
        this.addSectionResetControls();
        this.renderColorPalettes();
        this.bindEvents();
        this.sideProfileEditor = new SideProfileEditor(this);
        this.syncAllSliders(this.cabinet.params);
        this.syncControlInputs(this.cabinet.params.controls);
        this.updatePanelInventory();
        this.updateSceneVisibilityTree();
        this.renderComponentReadout();
        this.renderFabricationSummary();
        this.syncComponentControls();
        this.setUnitMode(this.unitMode, false);
        this.workspaceShell = new WorkspaceShell(this);
        this.scheduleHelpSystemLoad();
        this.pushHistoryState('Initial design', true);
        this.savedSignature = this.getProjectSignature();
        this.updateDirtyState();
        this.initialRecoveryPromise = this.checkRecoveryState();
        this.scheduleGuidedTutorialLoad(this.initialRecoveryPromise);
        this.exposeLifecycleHooks();
    }

    scheduleGuidedTutorialLoad(recoveryPromise = Promise.resolve()) {
        const tutorialButton = document.getElementById('btn-tutorial');
        if (tutorialButton) {
            tutorialButton.disabled = true;
            tutorialButton.setAttribute('aria-busy', 'true');
        }
        void Promise.resolve(recoveryPromise)
            .catch(() => [])
            .then(() => {
                window.requestAnimationFrame(() => {
                    void this.ensureGuidedTutorial().then(tutorial => {
                        if (this.pendingRecovery || this.recoveryBanner?.hidden === false || document.querySelector('dialog[open]')) return;
                        tutorial?.maybeStart?.();
                    });
                });
            });
    }

    ensureGuidedTutorial() {
        if (this.guidedTutorial) return Promise.resolve(this.guidedTutorial);
        if (!this.guidedTutorialLoadPromise) {
            this.guidedTutorialLoadPromise = import('./guided-tutorial.js')
                .then(({ GuidedTutorial, LEARNING_ACTIONS, FIRST_CABINET_LESSON_ID }) => {
                    this.learningActions = LEARNING_ACTIONS;
                    this.firstCabinetLessonId = FIRST_CABINET_LESSON_ID;
                    this.guidedTutorial = new GuidedTutorial(this);
                    this.bindLearningCoach();
                    const tutorialButton = document.getElementById('btn-tutorial');
                    if (tutorialButton) {
                        tutorialButton.disabled = false;
                        tutorialButton.removeAttribute('aria-busy');
                    }
                    return this.guidedTutorial;
                })
                .catch(error => {
                    this.guidedTutorialLoadPromise = null;
                    const tutorialButton = document.getElementById('btn-tutorial');
                    if (tutorialButton) {
                        tutorialButton.disabled = false;
                        tutorialButton.removeAttribute('aria-busy');
                    }
                    console.error('Tutorial could not be loaded', error);
                    return null;
                });
        }
        return this.guidedTutorialLoadPromise;
    }

    scheduleHelpSystemLoad() {
        const helpButton = document.getElementById('btn-help');
        const bootstrap = event => {
            event?.preventDefault?.();
            void this.ensureHelpSystem().then(help => help?.open?.());
        };
        helpButton?.addEventListener('click', bootstrap);
        const load = () => void this.ensureHelpSystem().then(() => helpButton?.removeEventListener('click', bootstrap));
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(load, { timeout: 1800 });
        else window.setTimeout(load, 650);
    }

    ensureHelpSystem() {
        if (this.helpSystem) return Promise.resolve(this.helpSystem);
        if (!this.helpSystemPromise) {
            this.helpSystemPromise = import('./help-system.js')
                .then(({ HelpSystem }) => {
                    this.helpSystem = new HelpSystem(this);
                    return this.helpSystem;
                })
                .catch(error => {
                    this.helpSystemPromise = null;
                    this.reportLifecycleFailure('Help could not be loaded', error);
                    return null;
                });
        }
        return this.helpSystemPromise;
    }

    bindLearningCoach() {
        if (this.learningCoachBound || !this.guidedTutorial) return;
        this.learningCoachBound = true;
        const startButton = document.getElementById('btn-start-first-cabinet');
        const resetButton = document.getElementById('btn-reset-learning');
        const showButton = document.getElementById('btn-learning-show');
        const whyButton = document.getElementById('btn-learning-why');
        const skipButton = document.getElementById('btn-learning-skip');
        const exitButton = document.getElementById('btn-learning-exit');

        for (const button of [startButton, resetButton]) {
            if (!button) continue;
            button.disabled = false;
            button.removeAttribute('aria-busy');
        }

        startButton?.addEventListener('click', () => void this.startFirstCabinetLesson());
        resetButton?.addEventListener('click', () => {
            if (!window.confirm('Reset the First Cabinet lesson progress? Your cabinet project will not be changed.')) return;
            this.guidedTutorial.resetLearningPath?.(this.firstCabinetLessonId);
            this.renderLearningCoach();
            this.showNotification('First Cabinet lesson progress reset.');
        });
        showButton?.addEventListener('click', () => this.showCurrentLearningStep());
        whyButton?.addEventListener('click', () => {
            const why = document.getElementById('learning-coach-why');
            if (!why) return;
            why.hidden = !why.hidden;
            whyButton.setAttribute('aria-expanded', String(!why.hidden));
        });
        skipButton?.addEventListener('click', () => {
            if (!window.confirm('Skip this lesson step? It will be recorded as skipped.')) return;
            this.guidedTutorial.skipLearningStep?.({ lessonId: this.firstCabinetLessonId, reason: 'user' });
        });
        exitButton?.addEventListener('click', () => {
            const progress = this.guidedTutorial.exitLearningPath?.(this.firstCabinetLessonId);
            this.renderLearningCoach();
            this.offerPracticeProjectRestore(progress, 'Lesson paused');
        });

        this.learningUnsubscribe = this.guidedTutorial.subscribeToLearning?.(event => {
            this.renderLearningCoach();
            if (event?.change === 'advanced' || event?.change === 'skipped') {
                this.showNotification('Lesson step complete.', { severity: 'success', title: 'First Cabinet' });
            }
            if (event?.change === 'completed') this.offerPracticeProjectRestore(event.progress, 'First Cabinet lesson complete');
        });
        this.renderLearningCoach();
    }

    async startFirstCabinetLesson() {
        const tutorial = await this.ensureGuidedTutorial();
        if (!tutorial) return;
        const existing = tutorial.getLearningProgress?.(this.firstCabinetLessonId);
        if (existing && ['in-progress', 'paused'].includes(existing.status)) {
            tutorial.resumeLearningPath?.(this.firstCabinetLessonId);
            const helpDialog = document.getElementById('help-dialog');
            if (helpDialog?.open) helpDialog.close();
            this.renderLearningCoach();
            this.showCurrentLearningStep();
            return;
        }
        const consent = window.confirm('Start a separate practice cabinet? Your current project will be saved to Recoveries so you can restore it afterward.');
        if (!consent) return;
        const recovery = await this.writeAutosave({ force: true, announceFailure: true });
        if (!recovery?.ok || !recovery.recoveryId) {
            this.reportLifecycleFailure('Practice project could not start', recovery?.message || 'The current project could not be stored in Recoveries.');
            return;
        }
        const created = await this.startNewProject({ prompt: false, presetId: 'standard' });
        if (!created?.ok) return;
        tutorial.startLearningPath?.(this.firstCabinetLessonId, {
            restart: Boolean(existing),
            practiceProject: true,
            practiceSessionId: recovery.recoveryId
        });
        const helpDialog = document.getElementById('help-dialog');
        if (helpDialog?.open) helpDialog.close();
        this.workspaceShell?.applyWorkspaceMode?.('guided', false);
        this.renderLearningCoach();
        this.showCurrentLearningStep();
    }

    recordLearningAction(event, detail = {}) {
        if (!event || !this.guidedTutorial) return null;
        return this.guidedTutorial.recordLearningAction?.(event, detail, { lessonId: this.firstCabinetLessonId }) || null;
    }

    renderLearningCoach() {
        const coach = document.getElementById('learning-coach');
        if (!coach || !this.guidedTutorial) return;
        const progress = this.guidedTutorial.getLearningProgress?.(this.firstCabinetLessonId);
        const current = this.guidedTutorial.getCurrentLearningStep?.(this.firstCabinetLessonId);
        const active = progress?.status === 'in-progress' && current?.definition;
        coach.hidden = !active;
        if (!active) return;
        const progressText = document.getElementById('learning-coach-progress');
        const title = document.getElementById('learning-coach-title');
        const instruction = document.getElementById('learning-coach-instruction');
        const why = document.getElementById('learning-coach-why');
        if (progressText) progressText.textContent = `Step ${current.stepIndex + 1} of ${current.stepCount}`;
        if (title) title.textContent = current.definition.title;
        if (instruction) instruction.textContent = current.definition.copy;
        if (why) {
            why.textContent = learningStepRationale(current.definition.id);
            why.hidden = true;
        }
        const whyButton = document.getElementById('btn-learning-why');
        whyButton?.setAttribute('aria-expanded', 'false');
        const stepKey = `${progress.lessonVersion || ''}:${current.definition.id}`;
        if (coach.dataset.currentStep !== stepKey) {
            coach.dataset.currentStep = stepKey;
            coach.classList.remove('notice-enter');
            void coach.offsetWidth;
            coach.classList.add('notice-enter');
        }
    }

    showCurrentLearningStep() {
        const current = this.guidedTutorial?.getCurrentLearningStep?.(this.firstCabinetLessonId);
        const stepId = current?.definition?.id;
        if (!stepId) return;
        const helpDialog = document.getElementById('help-dialog');
        if (helpDialog?.open && stepId !== 'before-you-cut') helpDialog.close();
        const routes = {
            'choose-preset': () => {
                this.workspaceShell?.applyWorkspaceMode?.('guided', false);
                this.activateTab('structure');
                document.querySelector('.preset-card')?.scrollIntoView?.({ block: 'center' });
                document.querySelector('.preset-card')?.focus?.();
            },
            'save-project': () => this.projectNameInput?.focus(),
            'set-envelope': () => {
                this.activateTab('structure');
                document.querySelector('[data-param="width"]')?.focus();
            },
            'inspect-model': () => this.app.renderer?.domElement?.focus(),
            'choose-controls': () => {
                this.activateTab('controls');
                document.querySelector('[data-layout-style]')?.focus();
            },
            'inspect-panel': () => {
                this.workspaceShell?.activateInspector?.('scene', true);
                this.panelInventory?.querySelector('.panel-item')?.focus();
            },
            'inspect-hardware': () => this.makerWorkflow?.open?.('hardware'),
            'review-design': () => this.makerWorkflow?.open?.('review'),
            'generate-sheets': () => this.makerWorkflow?.open?.('sheets'),
            'export-draft': () => this.openExportDialog(),
            'before-you-cut': () => void this.ensureHelpSystem().then(help => help?.openTopic?.('before-you-cut'))
        };
        routes[stepId]?.();
    }

    offerPracticeProjectRestore(progress, title) {
        const recoveryId = progress?.practiceSessionId;
        const actions = recoveryId ? [{
            label: 'Restore previous project',
            run: () => void this.restoreRecoveryRecord(recoveryId, { openAsCopy: false })
        }] : [];
        this.showNotification(
            recoveryId ? 'Your practice cabinet remains open. You can restore the project you were using before the lesson.' : 'Your lesson progress has been saved.',
            { severity: 'success', persistent: true, title, actions }
        );
    }

    initDOM() {
        this.tabButtons = document.querySelectorAll('.tab-btn');
        this.tabContents = document.querySelectorAll('.tab-content');
        this.panelInventory = document.getElementById('panel-inventory');
        this.panelInventorySearch = document.getElementById('panel-inventory-search');
        this.panelInventoryStatus = document.getElementById('panel-inventory-status');
        this.sceneVisibilityTree = document.getElementById('scene-visibility-tree');
        this.btnToggleScrews = document.getElementById('btn-toggle-screws');
        this.componentReadout = document.getElementById('component-readout');
        this.componentTuning = document.getElementById('component-tuning');
        this.fabricationSummary = document.getElementById('fabrication-summary');
        this.componentColorPalette = document.getElementById('component-color-palette');
        this.decalBox = document.getElementById('decal-box');
        this.decalPanelActive = document.getElementById('decal-panel-active');
        this.activeDecalList = document.getElementById('active-decal-list');
        this.decalSliders = document.getElementById('decal-editing-sliders');
        this.decalFileInput = document.getElementById('decal-file-input');

        this.btnSave = document.getElementById('btn-save');
        this.btnSaveAs = document.getElementById('btn-save-as');
        this.btnLoad = document.getElementById('btn-load');
        this.fileLoadProject = document.getElementById('file-load-project');
        this.btnExport = document.getElementById('btn-export');
        this.btnUndo = document.getElementById('btn-undo');
        this.btnRedo = document.getElementById('btn-redo');
        this.btnUndoMenu = document.getElementById('btn-undo-menu');
        this.btnRedoMenu = document.getElementById('btn-redo-menu');
        this.btnSaveMenu = document.getElementById('btn-save-menu');
        this.btnTheme = document.getElementById('btn-theme');
        this.btnTutorial = document.getElementById('btn-tutorial');
        this.projectNameInput = document.getElementById('project-name');
        this.dirtyIndicator = document.getElementById('dirty-indicator');
        this.exportDialog = document.getElementById('export-dialog');
        this.exportSummary = document.getElementById('export-preflight-summary');
        this.exportIssueCount = document.getElementById('export-issue-count');
        this.btnExportDraft = document.getElementById('btn-export-draft');
        this.btnExportProduction = document.getElementById('btn-export-production');
        this.btnExportPackage = document.getElementById('btn-export-package');
        this.draftReadiness = document.getElementById('draft-readiness');
        this.productionReadiness = document.getElementById('production-readiness');
        this.packageReadiness = document.getElementById('package-readiness');
        this.fabricationPackOption = document.getElementById('fabrication-pack-option');
        this.packageBlockReason = document.getElementById('package-block-reason');
        this.warningAckRow = document.getElementById('warning-ack-row');
        this.warningAcknowledgement = document.getElementById('acknowledge-export-warnings');
        this.productionBlockReason = document.getElementById('production-block-reason');
        this.exportReceipt = document.getElementById('export-receipt');
        this.exportReceiptSummary = document.getElementById('export-receipt-summary');
        this.exportReceiptDetails = document.getElementById('export-receipt-details');
        this.btnOpenExportFolder = document.getElementById('btn-open-export-folder');
        this.btnOpenBeforeCut = document.getElementById('btn-open-before-cut');
        this.recoveryBanner = document.getElementById('recovery-banner');
        this.recoveryRecordList = document.getElementById('recovery-record-list');
        this.btnRefreshRecoveries = document.getElementById('btn-refresh-recoveries');
        this.btnResetComponent = document.getElementById('btn-reset-component');
        this.componentVisibleToggle = document.getElementById('component-visible-toggle');
        this.componentIncludedToggle = document.getElementById('component-included-toggle');
        this.mannequinPreset = document.getElementById('mannequin-preset');
        this.componentMaterialEditor = document.getElementById('component-material-editor');
        this.componentEditScope = document.getElementById('component-edit-scope');
        this.componentScopePreview = document.getElementById('component-scope-preview');
        this.componentMaterialSelect = document.getElementById('component-material-select');
        this.componentMaterialSummary = document.getElementById('component-material-summary');
        this.btnManageMaterials = document.getElementById('btn-manage-materials');
        this.btnOpenSelectedSheet = document.getElementById('btn-open-selected-sheet');
        this.componentFastenerGroup = document.getElementById('component-fastener-group');
        this.componentFastenerList = document.getElementById('component-fastener-list');
        this.btnClearFastenerGroup = document.getElementById('btn-clear-fastener-group');

        this.paramInputs = Array.from(document.querySelectorAll('[data-param]'));
        this.sliders = {};
        this.displays = {};
        this.paramInputs.forEach(input => {
            const key = input.dataset.param;
            this.sliders[key] = input;
            this.displays[key] = document.querySelector(`[data-param-value="${key}"]`);
        });

        this.componentInputs = Array.from(document.querySelectorAll('[data-component-param]'));
        this.componentControls = {};
        this.componentDisplays = {};
        this.componentInputs.forEach(input => {
            const key = input.dataset.componentParam;
            this.componentControls[key] = input;
            this.componentDisplays[key] = document.querySelector(`[data-component-value="${key}"]`);
        });

        this.controlInputs = Array.from(document.querySelectorAll('[data-control-param]'));
        this.controlDisplays = {};
        this.controlInputs.forEach(input => {
            const key = input.dataset.controlParam;
            this.controlDisplays[key] = document.querySelector(`[data-control-value="${key}"]`);
        });

        this.controlColorPalettes = Array.from(document.querySelectorAll('[data-control-color-path]'));
        this.layoutStyleCards = Array.from(document.querySelectorAll('[data-layout-style]'));
        this.layoutEditor = document.getElementById('deck-layout-editor');
        this.layoutStage = document.getElementById('deck-layout-stage');
        this.btnResetLayout = document.getElementById('btn-reset-layout');
        this.exactInputBindings = [];
    }

    configureAccessibility() {
        const tabList = document.querySelector('.tabs');
        if (tabList) tabList.setAttribute('role', 'tablist');

        this.tabButtons.forEach((button, index) => {
            const panel = document.getElementById(`tab-${button.dataset.tab}`);
            const buttonId = `tab-button-${button.dataset.tab}`;
            button.id = buttonId;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', panel?.id || '');
            button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
            button.tabIndex = index === 0 ? 0 : -1;
            if (panel) {
                panel.setAttribute('role', 'tabpanel');
                panel.setAttribute('aria-labelledby', buttonId);
                panel.tabIndex = 0;
            }
        });

        this.tabButtons.forEach((button, index) => {
            button.addEventListener('keydown', (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                let nextIndex = index;
                if (event.key === 'ArrowLeft') nextIndex = (index - 1 + this.tabButtons.length) % this.tabButtons.length;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % this.tabButtons.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = this.tabButtons.length - 1;
                this.activateTab(this.tabButtons[nextIndex].dataset.tab, true);
            });
        });

        const canvas = this.app.renderer?.domElement;
        if (canvas) {
            canvas.tabIndex = 0;
            canvas.setAttribute('role', 'img');
            canvas.setAttribute(
                'aria-label',
                'Interactive 3D cabinet preview. Use arrow keys to orbit, Page Up and Page Down to zoom, Home to fit, Escape to clear selection, or use the component list to select panels.'
            );
        }
    }

    activateTab(tabId, focus = false) {
        this.tabButtons.forEach(button => {
            const active = button.dataset.tab === tabId;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
            if (active && focus) button.focus();
        });
        this.tabContents.forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${tabId}`);
        });
    }

    enhanceNumericControls() {
        const ranges = [
            ...this.paramInputs.filter(input => input.type === 'range'),
            ...this.componentInputs.filter(input => input.type === 'range'),
            ...this.controlInputs.filter(input => input.type === 'range')
        ];

        ranges.forEach((range, index) => {
            if (range.closest('.range-field')) return;
            const category = range.dataset.param
                ? 'param'
                : range.dataset.componentParam
                    ? 'component'
                    : 'control';
            const key = range.dataset.param || range.dataset.componentParam || range.dataset.controlParam;
            const unit = this.getControlUnit(category, key);
            const wrapper = document.createElement('div');
            wrapper.className = 'range-field';
            range.parentNode.insertBefore(wrapper, range);
            wrapper.appendChild(range);

            const exact = document.createElement('input');
            exact.type = 'number';
            exact.className = 'exact-value';
            exact.id = `${range.id || `range-${index}`}-exact`;
            exact.dataset.exactFor = key;
            exact.setAttribute('inputmode', 'decimal');
            const labelText = range.closest('.control-group, .slider-inline')?.querySelector('label')?.textContent?.trim() || key;
            exact.setAttribute('aria-label', `${labelText} exact value`);

            const unitLabel = document.createElement('span');
            unitLabel.className = 'exact-unit';
            unitLabel.setAttribute('aria-hidden', 'true');

            const reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'field-reset';
            reset.textContent = '↺';
            reset.title = `Reset ${labelText}`;
            reset.setAttribute('aria-label', `Reset ${labelText}`);

            const errorText = document.createElement('span');
            errorText.className = 'field-error';
            errorText.id = `${exact.id}-error`;
            errorText.hidden = true;
            errorText.setAttribute('role', 'alert');
            exact.setAttribute('aria-describedby', errorText.id);

            wrapper.append(exact, unitLabel, reset);
            wrapper.insertAdjacentElement('afterend', errorText);
            const binding = { range, exact, unitLabel, reset, errorText, category, key, unit };
            this.exactInputBindings.push(binding);
            this.updateExactInputBinding(binding, range.value);

            exact.addEventListener('input', () => this.applyExactInput(binding, false));
            exact.addEventListener('change', () => this.applyExactInput(binding, true));
            exact.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    this.updateExactInputBinding(binding, range.value);
                    exact.blur();
                }
            });
            range.addEventListener('input', () => this.updateExactInputBinding(binding, range.value));
            reset.addEventListener('click', () => this.resetExactField(binding));
        });
    }

    addSectionResetControls() {
        this.tabContents.forEach(panel => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'section-reset';
            button.textContent = 'Reset section';
            button.addEventListener('click', () => this.resetControlSection(panel));
            panel.appendChild(button);
        });
    }

    getControlUnit(category, key) {
        let formatted = '';
        if (category === 'control') {
            formatted = formatControlValue(key, 1);
        } else {
            formatted = formatParamValue(key, 1);
        }
        if (/\smm$/i.test(formatted)) return 'mm';
        if (/\sdeg$/i.test(formatted)) return 'deg';
        if (/%$/i.test(formatted)) return '%';
        return '';
    }

    getDisplayNumber(valueMm, unit) {
        const numeric = Number(valueMm) || 0;
        return unit === 'mm' && this.unitMode === 'in' ? numeric / MM_PER_INCH : numeric;
    }

    getBaseNumber(displayValue, unit) {
        const numeric = Number(displayValue);
        return unit === 'mm' && this.unitMode === 'in' ? numeric * MM_PER_INCH : numeric;
    }

    updateExactInputBinding(binding, baseValue) {
        const { range, exact, unitLabel, reset, errorText, unit } = binding;
        const converted = this.getDisplayNumber(baseValue, unit);
        const isInch = unit === 'mm' && this.unitMode === 'in';
        const sourceStep = Number(range.step) || 1;
        // Inch inputs use a predictable thousandth-inch display. Deriving the
        // decimal count from a binary floating-point conversion (for example
        // 10 / 25.4) can otherwise expose 15+ meaningless digits. The native
        // step constraint stays open because converted minimums are rarely
        // aligned to an exact 0.001-inch step base; range validation below is
        // authoritative and avoids marking rounded, valid values as invalid.
        const precision = isInch ? 3 : Math.min(3, decimalPlaces(sourceStep));
        exact.value = trimNumber(converted, precision);
        exact.min = trimNumber(this.getDisplayNumber(range.min, unit), precision + 1);
        exact.max = trimNumber(this.getDisplayNumber(range.max, unit), precision + 1);
        exact.step = isInch ? 'any' : (range.step || 'any');
        exact.disabled = range.disabled;
        reset.disabled = range.disabled;
        exact.classList.remove('invalid');
        exact.removeAttribute('aria-invalid');
        exact.setCustomValidity('');
        errorText.hidden = true;
        errorText.textContent = '';
        unitLabel.textContent = isInch ? 'in' : unit;
        const readableUnit = isInch ? 'inches' : unit === 'mm' ? 'millimetres' : unit === 'deg' ? 'degrees' : unit === '%' ? 'percent' : '';
        range.setAttribute('aria-valuetext', `${trimNumber(converted, precision)}${readableUnit ? ` ${readableUnit}` : ''}`);
    }

    syncExactBinding(range, value) {
        const binding = this.exactInputBindings.find(candidate => candidate.range === range);
        if (binding) this.updateExactInputBinding(binding, value);
    }

    applyExactInput(binding, commit) {
        const { exact, range, errorText, unit } = binding;
        const displayValue = Number(exact.value);
        const baseValue = this.getBaseNumber(displayValue, unit);
        const min = Number(range.min);
        const max = Number(range.max);
        const invalid = !Number.isFinite(displayValue)
            || !Number.isFinite(baseValue)
            || baseValue < min - 1e-9
            || baseValue > max + 1e-9;
        exact.classList.toggle('invalid', invalid);
        if (invalid) exact.setAttribute('aria-invalid', 'true');
        else exact.removeAttribute('aria-invalid');
        const validationMessage = invalid ? `Enter a value from ${exact.min} to ${exact.max} ${binding.unitLabel.textContent}.` : '';
        exact.setCustomValidity(validationMessage);
        errorText.hidden = !invalid;
        errorText.textContent = validationMessage;
        if (invalid) return;

        // A coarse slider step (often 5 or 10 mm) must not quantize the exact
        // companion field. Temporarily allow an arbitrary range value while
        // dispatching the existing update path, then restore the slider's
        // keyboard/drag increment.
        const originalStep = range.getAttribute('step');
        range.setAttribute('step', 'any');
        range.value = String(baseValue);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        if (commit) range.dispatchEvent(new Event('change', { bubbles: true }));
        if (originalStep == null) range.removeAttribute('step');
        else range.setAttribute('step', originalStep);
        if (commit) this.updateExactInputBinding(binding, range.value);
    }

    resetExactField(binding) {
        let baseline = 0;
        if (binding.category === 'param') baseline = this.resetBaseline[binding.key];
        if (binding.category === 'control') baseline = getNestedValue(this.resetBaseline.controls || {}, binding.key);
        if (binding.category === 'component') baseline = 0;
        if (!Number.isFinite(Number(baseline))) baseline = Number(binding.range.defaultValue) || 0;
        binding.range.value = String(baseline);
        binding.range.dispatchEvent(new Event('input', { bubbles: true }));
        binding.range.dispatchEvent(new Event('change', { bubbles: true }));
        this.updateExactInputBinding(binding, binding.range.value);
    }

    resetControlSection(panel) {
        const sectionName = panel.getAttribute('aria-labelledby')
            ? document.getElementById(panel.getAttribute('aria-labelledby'))?.textContent?.trim()
            : 'this section';
        if (!window.confirm(`Reset ${sectionName || 'this section'} controls to their project defaults?`)) return;
        const bindings = this.exactInputBindings.filter(binding => panel.contains(binding.range));
        bindings.forEach(binding => this.resetExactField(binding));
        panel.querySelectorAll('input[type="checkbox"][data-param], input[type="checkbox"][data-control-param]').forEach(input => {
            const key = input.dataset.param || input.dataset.controlParam;
            const baseline = input.dataset.param
                ? this.resetBaseline[key]
                : getNestedValue(this.resetBaseline.controls || {}, key);
            input.checked = Boolean(baseline);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        panel.querySelectorAll('select[data-control-param], input[type="text"][data-control-param]').forEach(input => {
            const baseline = getNestedValue(this.resetBaseline.controls || {}, input.dataset.controlParam);
            input.value = baseline ?? input.defaultValue ?? '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        this.commitHistoryNow(`Reset ${sectionName || 'section'}`);
    }

    setUnitMode(mode, announce = true) {
        this.unitMode = mode === 'in' ? 'in' : 'mm';
        if (this.cabinet?.params) this.cabinet.params.displayUnits = this.unitMode;
        try { window.localStorage.setItem('cabinet-crafter:units', this.unitMode); } catch (_) { /* storage is optional */ }
        ['mm', 'in'].forEach(unit => {
            const active = unit === this.unitMode;
            [`unit-${unit}`, `unit-${unit}-menu`].forEach(id => {
                const button = document.getElementById(id);
                button?.classList.toggle('active', active);
                button?.setAttribute('aria-pressed', String(active));
            });
        });
        this.exactInputBindings.forEach(binding => this.updateExactInputBinding(binding, binding.range.value));
        this.syncAllSliders(this.cabinet.params);
        this.syncControlInputs(this.cabinet.params.controls);
        this.syncComponentControls();
        this.updatePanelInventory();
        this.renderComponentReadout();
        this.renderFabricationSummary();
        if (announce) {
            this.showNotification(`Display units: ${this.unitMode === 'in' ? 'inches' : 'millimetres'}`);
            this.markMutation('Change display units');
        }
    }

    setTheme(mode, announce = true) {
        this.themeMode = mode === 'dark' ? 'dark' : 'light';
        document.documentElement.dataset.theme = this.themeMode;
        try { window.localStorage.setItem('cabinet-crafter:theme', this.themeMode); } catch (_) { /* storage is optional */ }
        if (this.btnTheme) {
            const dark = this.themeMode === 'dark';
            this.btnTheme.textContent = dark ? 'Light' : 'Dark';
            this.btnTheme.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
            this.btnTheme.setAttribute('aria-pressed', String(dark));
        }
        this.app.setTheme?.(this.themeMode);
        if (announce) this.showNotification(`${this.themeMode === 'dark' ? 'Dark' : 'Light'} mode`);
    }

    bindEvents() {
        this.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.activateTab(btn.dataset.tab);
            });
        });
        this.btnTheme?.addEventListener('click', () => {
            this.setTheme(this.themeMode === 'dark' ? 'light' : 'dark');
        });
        this.btnTutorial?.addEventListener('click', () => {
            if (!this.guidedTutorial) {
                this.btnTutorial.disabled = true;
                this.btnTutorial.setAttribute('aria-busy', 'true');
            }
            void this.ensureGuidedTutorial().then(tutorial => tutorial?.start?.(true));
        });

        this.paramInputs.forEach(input => {
            const key = input.dataset.param;
            const eventName = input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(eventName, (e) => {
                const val = e.target.type === 'checkbox' ? e.target.checked : parseFloat(e.target.value);
                if (e.target.type !== 'checkbox') {
                    this.updateSliderValueDisplay(key, val);
                }

                if (key === 'dummyHeight') {
                    if (this.dummy) this.dummy.setHeight(val);
                    if (this.mannequinPreset) this.mannequinPreset.value = 'custom';
                    this.afterViewMutation('Change mannequin height');
                    return;
                }

                this.queueCabinetUpdate(
                    { [key]: val },
                    `Change ${key}`,
                    key === 'depth' ? () => this.dummy?.setCabinetDepth(val) : null
                );
                if (['width', 'height', 'depth'].includes(key)) {
                    this.recordLearningAction(this.learningActions?.PARAMETER_CHANGED, {
                        section: 'structure',
                        parameter: key,
                        value: val
                    });
                }
            });
        });

        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', () => {
                if (this.isDirty() && !window.confirm(`Replace the current design with the ${this.getPresetLabel(card.dataset.preset)} preset? Unsaved changes can still be recovered with Undo.`)) {
                    return;
                }
                document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                this.applyPreset(card.dataset.preset);
                this.recordLearningAction(this.learningActions?.PRESET_SELECTED, { preset: card.dataset.preset });
            });
        });

        this.componentInputs.forEach(input => {
            const key = input.dataset.componentParam;
            input.addEventListener('input', (e) => {
                if (!this.activePanelId) return;
                const val = parseFloat(e.target.value);
                this.updateComponentControlDisplay(key, val);
                this.queueComponentOverride(this.activePanelId, key, val);
            });
        });

        this.controlInputs.forEach(input => {
            const path = input.dataset.controlParam;
            const eventName = input.type === 'text' ? 'input' : 'input';
            input.addEventListener(eventName, (e) => {
                let value = e.target.value;
                if (e.target.type === 'checkbox') {
                    value = e.target.checked;
                } else if (e.target.type === 'range') {
                    value = parseFloat(e.target.value);
                }

                this.setControlValue(path, value);
            });
        });

        this.btnResetComponent.addEventListener('click', () => {
            if (!this.activePanelId) return;
            const panel = this.cabinet.getPanelById(this.activePanelId);
            if (panel?.userData.override && Object.keys(panel.userData.override).length
                && !window.confirm(`Reset all overrides for ${panel.userData.name}?`)) return;
            this.cabinet.resetComponentOverride(this.activePanelId);
            this.afterCabinetMutation('Reset component');
            this.showNotification('Component reset');
        });

        if (this.componentVisibleToggle) {
            this.componentVisibleToggle.addEventListener('change', (e) => {
                if (!this.activePanelId) return;
                this.setPanelViewportVisibility(this.activePanelId, e.target.checked);
            });
        }

        if (this.componentIncludedToggle) {
            this.componentIncludedToggle.addEventListener('change', event => {
                if (!this.activePanelId || typeof this.cabinet.setPanelIncluded !== 'function') return;
                this.cabinet.setPanelIncluded(this.activePanelId, event.target.checked);
                this.cabinet.build();
                this.afterCabinetMutation(event.target.checked ? 'Include component in fabrication' : 'Exclude component from fabrication');
                this.showNotification(event.target.checked ? 'Component included in fabrication' : 'Component excluded from fabrication');
            });
        }

        this.componentEditScope?.addEventListener('change', () => this.syncAdvancedComponentControls());
        this.componentMaterialSelect?.addEventListener('change', event => this.applyComponentMaterial(event.target.value));
        this.btnManageMaterials?.addEventListener('click', () => this.makerWorkflow?.openSheetsForPart?.(this.activePanelId));
        this.btnOpenSelectedSheet?.addEventListener('click', () => this.makerWorkflow?.openSheetsForPart?.(this.activePanelId));
        this.componentFastenerGroup?.addEventListener('change', event => {
            const input = event.target.closest('[data-fastener-group-param]');
            if (!input || !this.activePanelId) return;
            const value = Number(input.value);
            if (!Number.isFinite(value)) return;
            this.cabinet.updateFastenerGroupOverride(this.getComponentScopePanelIds(), {
                [input.dataset.fastenerGroupParam]: value
            });
            this.afterCabinetMutation('Change screw group');
        });
        this.btnClearFastenerGroup?.addEventListener('click', () => {
            if (!this.activePanelId) return;
            this.cabinet.updateFastenerGroupOverride(this.getComponentScopePanelIds(), null);
            this.afterCabinetMutation('Reset screw group');
            this.showNotification('Screw group uses project defaults');
        });
        this.componentFastenerList?.addEventListener('change', event => {
            const input = event.target.closest('[data-fastener-id][data-fastener-param]');
            if (!input) return;
            const value = Number(input.value);
            if (!Number.isFinite(value)) return;
            this.cabinet.updateFastenerOverride(input.dataset.fastenerId, {
                [input.dataset.fastenerParam]: value
            });
            this.afterCabinetMutation('Change individual screw');
        });
        this.componentFastenerList?.addEventListener('click', event => {
            const button = event.target.closest('[data-reset-fastener-id]');
            if (!button) return;
            this.cabinet.updateFastenerOverride(button.dataset.resetFastenerId, null);
            this.afterCabinetMutation('Reset individual screw');
        });

        this.mannequinPreset.addEventListener('change', (e) => {
            const presetId = e.target.value;
            if (presetId === 'custom') return;
            this.dummy.setPreset(presetId);
            const profile = this.dummy.getCurrentProfile();
            if (this.sliders.dummyHeight) {
                this.sliders.dummyHeight.value = profile.height;
                this.updateSliderValueDisplay('dummyHeight', profile.height);
            }
            this.afterViewMutation('Change mannequin preset');
            this.showNotification(`Mannequin: ${MANNEQUIN_PRESETS[presetId].label}`);
        });

        this.decalFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && this.activePanelId) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    this.cabinet.addDecal(this.activePanelId, event.target.result, (decalId) => {
                        this.showNotification('Artwork applied');
                        this.selectDecal(decalId);
                        this.updateDecalList();
                        this.afterCabinetMutation('Add artwork');
                    });
                };
                reader.readAsDataURL(file);
            }
        });

        this.bindDecalSliders();
        this.bindLayoutEditor();
        this.bindFooterControls();
        this.bindSceneVisibilityControls();
        this.bindFileControls();
        this.bindCameraControls();
        this.bindProjectControls();
        this.bindKeyboardShortcuts();
        this.bindRecoveryControls();
    }

    renderColorPalettes() {
        if (this.componentColorPalette) {
            this.componentColorPalette.innerHTML = '';
            PANEL_COLOR_PALETTE.forEach(color => {
                const chip = this.createColorChip(color);
                chip.addEventListener('click', () => {
                    if (!this.activePanelId) return;
                    this.cabinet.updateComponentColor(this.activePanelId, color);
                    this.afterCabinetMutation('Change panel colour');
                });
                this.componentColorPalette.appendChild(chip);
            });
        }

        this.controlColorPalettes.forEach(palette => {
            palette.innerHTML = '';
            const path = palette.dataset.controlColorPath;
            PANEL_COLOR_PALETTE.forEach(color => {
                const chip = this.createColorChip(color);
                chip.addEventListener('click', () => {
                    this.setControlValue(path, color);
                });
                palette.appendChild(chip);
            });
        });
    }

    createColorChip(color) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'color-chip';
        chip.style.setProperty('--chip-color', color);
        chip.dataset.color = color;
        chip.title = color;
        chip.setAttribute('aria-label', `Use colour ${color}`);
        chip.setAttribute('aria-pressed', 'false');
        return chip;
    }

    setControlValue(path, value) {
        const controls = cloneParams(
            this.pendingCabinetPatch?.controls
            || this.cabinet.params.controls
            || {}
        );
        setNestedValue(controls, path, value);
        if (path === 'deck.layoutStyle' && value === 'custom' && !this.getCustomLayout(controls.deck || {}).length) {
            controls.deck.customLayout = this.createGeneratedCustomLayout(controls.deck || {});
        }
        this.queueCabinetUpdate({ controls }, `Change ${path}`);
    }

    syncControlInputs(controls = {}) {
        this.controlInputs.forEach(input => {
            const path = input.dataset.controlParam;
            const value = getNestedValue(controls, path);
            if (input.type === 'checkbox') {
                input.checked = Boolean(value);
            } else if (input.type === 'range') {
                input.value = Number(value) || 0;
                this.updateControlValueDisplay(path, input.value);
                this.syncExactBinding(input, input.value);
            } else {
                input.value = value ?? '';
            }
        });

        this.syncControlColorPalettes(controls);
        this.renderLayoutStyleControls(controls.deck || {});
    }

    updateControlValueDisplay(path, value) {
        const display = this.controlDisplays[path];
        if (display) {
            display.textContent = this.formatDisplayValue('control', path, value);
        }
    }

    syncControlColorPalettes(controls = {}) {
        this.controlColorPalettes.forEach(palette => {
            const path = palette.dataset.controlColorPath;
            const active = String(getNestedValue(controls, path) || DEFAULT_PANEL_COLOR).toLowerCase();
            palette.querySelectorAll('.color-chip').forEach(chip => {
                const selected = chip.dataset.color === active;
                chip.classList.toggle('active', selected);
                chip.setAttribute('aria-pressed', String(selected));
            });
        });
    }

    bindLayoutEditor() {
        this.layoutStyleCards.forEach(card => {
            card.setAttribute('aria-pressed', 'false');
            card.addEventListener('click', () => {
                const layoutStyle = card.dataset.layoutStyle;
                const deck = this.cabinet.params.controls?.deck || {};
                const patch = { layoutStyle };

                if (layoutStyle === 'custom' && !this.getCustomLayout(deck).length) {
                    patch.customLayout = this.createGeneratedCustomLayout(deck);
                }

                this.setDeckControlPatch(patch);
                this.recordLearningAction(this.learningActions?.CONTROL_LAYOUT_SELECTED, { layout: layoutStyle });
            });
        });

        if (this.btnResetLayout) {
            this.btnResetLayout.addEventListener('click', () => {
                const deck = this.cabinet.params.controls?.deck || {};
                this.setDeckControlPatch({
                    layoutStyle: 'custom',
                    customLayout: this.createGeneratedCustomLayout({ ...deck, layoutStyle: deck.layoutStyle === 'custom' ? 'staggered' : deck.layoutStyle })
                });
                this.showNotification('Layout reset');
            });
        }

        if (!this.layoutStage) return;

        this.layoutStage.addEventListener('pointerdown', (event) => {
            const node = event.target.closest('.layout-node');
            if (!node) return;

            event.preventDefault();
            this.activeLayoutDrag = {
                id: node.dataset.id,
                layout: this.getCustomLayout(this.cabinet.params.controls?.deck || {})
            };
            node.setPointerCapture(event.pointerId);
        });

        this.layoutStage.addEventListener('pointermove', (event) => {
            if (!this.activeLayoutDrag) return;
            event.preventDefault();
            this.updateDraggedLayoutNode(event);
        });

        const finishDrag = () => {
            if (!this.activeLayoutDrag) return;
            const layout = this.activeLayoutDrag.layout;
            this.cancelLayoutPreviewUpdate();
            this.activeLayoutDrag = null;
            this.setDeckControlPatch({ layoutStyle: 'custom', customLayout: layout });
        };

        this.layoutStage.addEventListener('pointerup', finishDrag);
        this.layoutStage.addEventListener('pointercancel', finishDrag);
        this.layoutStage.addEventListener('lostpointercapture', finishDrag);
    }

    setDeckControlPatch(patch, syncEditor = true) {
        const controls = cloneParams(this.cabinet.params.controls || {});
        controls.deck = {
            ...(controls.deck || {}),
            ...patch
        };
        this.cabinet.updateParams({ controls });
        this.updatePanelInventory();
        this.renderComponentReadout();
        this.renderFabricationSummary();
        this.syncComponentControls();
        this.markMutation('Change control layout');
        this.app.applyIsolation?.();

        if (syncEditor) {
            this.syncControlInputs(this.cabinet.params.controls);
            this.renderLayoutStyleControls(this.cabinet.params.controls.deck);
        }
    }

    scheduleLayoutPreviewUpdate(layout) {
        this.pendingLayoutPreview = layout;
        if (this.layoutPreviewFrame) return;

        this.layoutPreviewFrame = window.requestAnimationFrame(() => {
            this.layoutPreviewFrame = null;
            const previewLayout = this.pendingLayoutPreview;
            this.pendingLayoutPreview = null;
            if (!previewLayout) return;

            const controls = cloneParams(this.cabinet.params.controls || {});
            controls.deck = {
                ...(controls.deck || {}),
                layoutStyle: 'custom',
                customLayout: previewLayout
            };
            this.cabinet.updateParams({ controls });
        });
    }

    cancelLayoutPreviewUpdate() {
        if (this.layoutPreviewFrame) {
            window.cancelAnimationFrame(this.layoutPreviewFrame);
            this.layoutPreviewFrame = null;
        }
        this.pendingLayoutPreview = null;
    }

    renderLayoutStyleControls(deck = {}) {
        const activeStyle = deck.layoutStyle || 'staggered';
        this.layoutStyleCards.forEach(card => {
            const active = card.dataset.layoutStyle === activeStyle;
            card.classList.toggle('active', active);
            card.setAttribute('aria-pressed', String(active));
        });

        if (!this.layoutEditor || !this.layoutStage) return;
        this.layoutEditor.hidden = false;
        const customLayout = this.getCustomLayout(deck);
        const layout = activeStyle === 'custom' && customLayout.length
            ? customLayout
            : this.createGeneratedCustomLayout(deck);
        this.renderLayoutStage(layout, activeStyle === 'custom');
    }

    renderLayoutStage(layout, editable) {
        if (!this.layoutStage) return;

        this.layoutStage.innerHTML = '';
        layout.forEach(item => {
            const node = document.createElement('button');
            node.type = 'button';
            node.className = `layout-node ${item.kind === 'joystick' ? 'joystick' : 'button'}`;
            node.dataset.id = item.id;
            node.disabled = !editable;
            node.textContent = item.kind === 'joystick' ? 'J' : String((item.buttonIndex || 0) + 1);
            node.setAttribute('aria-label', `${item.kind === 'joystick' ? 'Joystick' : `Button ${(item.buttonIndex || 0) + 1}`} at ${Math.round(item.x)}, ${Math.round(item.y)} millimetres${editable ? '. Use arrow keys to move.' : ''}`);
            if (editable) {
                node.addEventListener('keydown', event => this.moveLayoutNodeWithKeyboard(event, item.id));
            }
            this.positionLayoutNode(node, item);
            this.layoutStage.appendChild(node);
        });
    }

    getCustomLayout(deck = {}) {
        return Array.isArray(deck.customLayout)
            ? deck.customLayout.map((item, index) => ({
                id: item.id || `${item.kind || 'button'}_${index}`,
                kind: item.kind === 'joystick' ? 'joystick' : 'button',
                buttonIndex: Math.max(0, Math.round(Number(item.buttonIndex) || 0)),
                x: clampNumber(Number(item.x) || 0, -260, 260),
                y: clampNumber(Number(item.y) || 0, -130, 130)
            }))
            : [];
    }

    createGeneratedCustomLayout(deck = {}) {
        const buttonsPerPlayer = clampNumber(Math.round(Number(deck.buttonsPerPlayer) || 6), 1, 8);
        const rows = clampNumber(Math.round(Number(deck.buttonRows) || 2), 1, 3);
        const legacySpacing = Number(deck.buttonSpacing) || 42;
        const spacingX = clampNumber(Number(deck.buttonSpacingX) || legacySpacing, 20, 90);
        const spacingY = clampNumber(Number(deck.buttonSpacingY) || legacySpacing, 20, 90);
        const joystickGap = clampNumber(Number(deck.joystickGap) || 72, 36, 150);
        const layoutStyle = ['grid', 'staggered', 'vee'].includes(deck.layoutStyle) ? deck.layoutStyle : 'staggered';
        const cols = Math.ceil(buttonsPerPlayer / rows);
        const layout = [];

        if (deck.joystickEnabled !== false) {
            layout.push({
                id: 'joystick',
                kind: 'joystick',
                buttonIndex: 0,
                x: joystickGap,
                y: 0
            });
        }

        for (let button = 0; button < buttonsPerPlayer; button++) {
            const row = button % rows;
            const col = Math.floor(button / rows);
            let depth = (row - (rows - 1) / 2) * spacingY;
            let across = -col * spacingX;

            if (layoutStyle === 'staggered') {
                across -= (row % 2) * spacingX * 0.35;
            } else if (layoutStyle === 'vee') {
                const colBias = col - (cols - 1) / 2;
                const rowDirection = rows === 1 ? 0 : (row < (rows - 1) / 2 ? 1 : -1);
                depth += colBias * spacingY * 0.24 * rowDirection;
            }

            layout.push({
                id: `button_${button}`,
                kind: 'button',
                buttonIndex: button,
                x: across,
                y: depth
            });
        }

        return layout;
    }

    positionLayoutNode(node, item) {
        const xPercent = ((LAYOUT_EDITOR_WIDTH_MM / 2 - item.x) / LAYOUT_EDITOR_WIDTH_MM) * 100;
        const yPercent = ((LAYOUT_EDITOR_DEPTH_MM / 2 - item.y) / LAYOUT_EDITOR_DEPTH_MM) * 100;
        node.style.left = `${clampNumber(xPercent, 4, 96)}%`;
        node.style.top = `${clampNumber(yPercent, 8, 92)}%`;
    }

    updateDraggedLayoutNode(event) {
        const rect = this.layoutStage.getBoundingClientRect();
        const x = clampNumber((0.5 - (event.clientX - rect.left) / rect.width) * LAYOUT_EDITOR_WIDTH_MM, -LAYOUT_EDITOR_WIDTH_MM / 2, LAYOUT_EDITOR_WIDTH_MM / 2);
        const y = clampNumber((0.5 - (event.clientY - rect.top) / rect.height) * LAYOUT_EDITOR_DEPTH_MM, -LAYOUT_EDITOR_DEPTH_MM / 2, LAYOUT_EDITOR_DEPTH_MM / 2);
        const layout = this.activeLayoutDrag.layout.map(item => (
            item.id === this.activeLayoutDrag.id ? { ...item, x, y } : item
        ));

        const node = this.layoutStage.querySelector(`[data-id="${cssEscape(this.activeLayoutDrag.id)}"]`);
        const moved = layout.find(item => item.id === this.activeLayoutDrag.id);
        if (node && moved) this.positionLayoutNode(node, moved);

        this.activeLayoutDrag.layout = layout;
        this.scheduleLayoutPreviewUpdate(layout);
    }

    moveLayoutNodeWithKeyboard(event, itemId) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1;
        const deck = this.cabinet.params.controls?.deck || {};
        const layout = this.getCustomLayout(deck).map(item => {
            if (item.id !== itemId) return item;
            const dx = event.key === 'ArrowLeft' ? amount : event.key === 'ArrowRight' ? -amount : 0;
            const dy = event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0;
            return {
                ...item,
                x: clampNumber(item.x + dx, -LAYOUT_EDITOR_WIDTH_MM / 2, LAYOUT_EDITOR_WIDTH_MM / 2),
                y: clampNumber(item.y + dy, -LAYOUT_EDITOR_DEPTH_MM / 2, LAYOUT_EDITOR_DEPTH_MM / 2)
            };
        });
        this.setDeckControlPatch({ layoutStyle: 'custom', customLayout: layout });
        const movedNode = this.layoutStage?.querySelector(`[data-id="${cssEscape(itemId)}"]`);
        movedNode?.focus();
    }

    bindDecalSliders() {
        const decalPosX = document.getElementById('decal-pos-x');
        const decalPosY = document.getElementById('decal-pos-y');
        const decalScale = document.getElementById('decal-scale');
        const decalRot = document.getElementById('decal-rotation');

        const updateDecalParams = () => {
            if (!this.activePanelId || !this.activeDecalId) return;

            const decal = this.cabinet.getDecal(this.activePanelId, this.activeDecalId);
            if (!decal) return;

            decal.x = parseFloat(decalPosX.value);
            decal.y = parseFloat(decalPosY.value);
            decal.scale = parseFloat(decalScale.value);
            decal.rotation = parseFloat(decalRot.value);

            document.getElementById('val-decal-pos-x').textContent = `${decal.x}%`;
            document.getElementById('val-decal-pos-y').textContent = `${decal.y}%`;
            document.getElementById('val-decal-scale').textContent = `${decal.scale}%`;
            document.getElementById('val-decal-rotation').textContent = `${decal.rotation} deg`;

            if (this.artworkUpdateFrame !== null) return;
            this.artworkUpdateFrame = window.requestAnimationFrame(() => {
                this.artworkUpdateFrame = null;
                this.cabinet.build();
                this.afterCabinetMutation('Adjust artwork');
            });
        };

        decalPosX.addEventListener('input', updateDecalParams);
        decalPosY.addEventListener('input', updateDecalParams);
        decalScale.addEventListener('input', updateDecalParams);
        decalRot.addEventListener('input', updateDecalParams);

        document.getElementById('btn-delete-decal').addEventListener('click', () => {
            if (!this.activePanelId || !this.activeDecalId) return;
            if (!window.confirm('Delete this artwork from the selected panel?')) return;
            this.cabinet.deleteDecal(this.activePanelId, this.activeDecalId);
            this.activeDecalId = null;
            this.decalSliders.hidden = true;
            this.updateDecalList();
            this.afterCabinetMutation('Delete artwork');
            this.showNotification('Artwork deleted');
        });
    }

    bindFooterControls() {
        const btnToggleGrid = document.getElementById('btn-toggle-grid');
        btnToggleGrid.setAttribute('aria-pressed', 'true');
        btnToggleGrid.addEventListener('click', () => {
            const active = btnToggleGrid.classList.toggle('active');
            btnToggleGrid.setAttribute('aria-pressed', String(active));
            this.app.gridHelper.visible = active;
            this.updateSceneVisibilityTree();
            this.afterViewMutation(active ? 'Show grid' : 'Hide grid');
        });

        const btnToggleEdges = document.getElementById('btn-toggle-edges');
        btnToggleEdges.setAttribute('aria-pressed', 'true');
        btnToggleEdges.addEventListener('click', () => {
            const active = btnToggleEdges.classList.toggle('active');
            btnToggleEdges.setAttribute('aria-pressed', String(active));
            this.cabinet.setEdgeVisibility(active);
            this.updateSceneVisibilityTree();
            this.afterViewMutation(active ? 'Show edges' : 'Hide edges');
        });

        const toggleDummy = document.getElementById('toggle-dummy');
        toggleDummy.addEventListener('change', (e) => {
            this.dummy.setVisibility(e.target.checked);
            this.updateSceneVisibilityTree();
            this.afterViewMutation(e.target.checked ? 'Show mannequin' : 'Hide mannequin');
        });
    }

    bindSceneVisibilityControls() {
        this.btnToggleScrews?.addEventListener('click', () => {
            const visible = this.app.screwsVisible === false;
            this.app.setScrewVisibility?.(visible);
            this.syncSceneVisibilityControls();
            this.afterViewMutation(visible ? 'Show screws' : 'Hide screws');
            this.showNotification(visible ? 'Screws shown' : 'Screws hidden');
        });

        this.sceneVisibilityTree?.addEventListener('change', event => {
            const control = event.target.closest('[data-scene-visibility]');
            if (!control) return;
            const focusId = control.id;
            const visible = control.checked;
            const type = control.dataset.sceneVisibility;
            if (type === 'panels') {
                this.app.setAllPanelVisibility?.(visible);
                this.refreshViewportVisibilityUI();
                this.focusSceneVisibilityControl(focusId);
                this.afterViewMutation(visible ? 'Show all panels' : 'Hide all panels');
                return;
            }
            if (type === 'panel') {
                this.setPanelViewportVisibility(control.dataset.panelId, visible);
                this.focusSceneVisibilityControl(focusId);
                return;
            }
            if (type === 'screws') {
                this.app.setScrewVisibility?.(visible);
            } else if (type === 'edges') {
                this.cabinet.setEdgeVisibility(visible);
                const button = document.getElementById('btn-toggle-edges');
                button?.classList.toggle('active', visible);
                button?.setAttribute('aria-pressed', String(visible));
            } else if (type === 'grid') {
                this.app.gridHelper.visible = visible;
                const button = document.getElementById('btn-toggle-grid');
                button?.classList.toggle('active', visible);
                button?.setAttribute('aria-pressed', String(visible));
            } else if (type === 'mannequin') {
                this.dummy.setVisibility(visible);
                const toggle = document.getElementById('toggle-dummy');
                if (toggle) toggle.checked = visible;
            } else {
                return;
            }
            this.syncSceneVisibilityControls();
            this.focusSceneVisibilityControl(focusId);
            this.afterViewMutation(`${visible ? 'Show' : 'Hide'} ${type}`);
            this.showNotification(`${capitalizeLabel(type)} ${visible ? 'shown' : 'hidden'}`);
        });

        this.sceneVisibilityTree?.addEventListener('click', event => {
            const select = event.target.closest('[data-scene-select-panel]');
            if (!select) return;
            const focusId = select.id;
            this.selectPanel(select.dataset.sceneSelectPanel);
            this.focusSceneVisibilityControl(focusId);
        });
    }

    bindFileControls() {
        this.btnSave.addEventListener('click', () => this.saveProject(false));
        this.btnSaveMenu?.addEventListener('click', () => this.saveProject(false));
        this.btnSaveAs?.addEventListener('click', () => this.saveProject(true));

        this.btnLoad.addEventListener('click', async () => {
            if (!await this.prepareProjectReplacement('open another project')) return;
            if (isDesktopAvailable()) {
                await this.openDesktopProject();
            } else {
                this.fileLoadProject.click();
            }
        });

        this.fileLoadProject.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.app.loadProjectFile(file);
                e.target.value = '';
            }
        });
        this.fileLoadProject.addEventListener('cancel', () => {
            this.replacementDiscardRecoveryId = null;
        });

        this.btnExport.addEventListener('click', () => this.openExportDialog());
        document.getElementById('btn-close-export')?.addEventListener('click', () => this.exportDialog?.close());
        this.exportDialog?.addEventListener('click', event => {
            if (event.target === this.exportDialog) this.exportDialog.close();
        });
        this.warningAcknowledgement?.addEventListener('change', () => this.updateExportControls());
        this.btnExportDraft?.addEventListener('click', () => this.performExport('draft'));
        this.btnExportProduction?.addEventListener('click', () => this.performExport('production'));
        this.btnExportPackage?.addEventListener('click', () => this.performExport('package'));
        if (this.fabricationPackOption) this.fabricationPackOption.hidden = typeof ProjectExporter.exportFabricationPackage !== 'function';
    }

    async openDesktopProject() {
        if (!this.beginOperation('project-open', [this.btnLoad], 'Opening project...')) return;
        try {
            const result = await requestDesktop('project.open');
            if (!result || result.cancelled) {
                this.replacementDiscardRecoveryId = null;
                this.statusService?.resolve('project-open');
                return;
            }
            const loaded = ProjectExporter.loadProject?.(
                result.content,
                data => this.app.applyProjectData(data, { file: result.path ? { name: result.path.split(/[\\/]/).pop() } : null }),
                error => this.app.handleProjectLoadError(error)
            );
            if (loaded?.ok === false) throw new Error(loaded.error?.message || 'The selected project could not be opened.');
        } catch (error) {
            this.replacementDiscardRecoveryId = null;
            console.error('Desktop project open failed', error);
            this.statusService?.fail('project-open', error.message || String(error), { title: 'Open failed' });
        } finally {
            this.endOperation('project-open', [this.btnLoad]);
        }
    }

    async prepareProjectReplacement(action = 'continue') {
        this.flushPendingCabinetUpdate();
        this.flushPendingArtworkUpdate();
        this.flushHistory();
        if (!this.isDirty()) return true;
        this.replacementDiscardRecoveryId = null;
        if (isDesktopAvailable()) {
            try {
                const response = await requestDesktop('project.lifecycle.prompt', {
                    action,
                    projectName: sanitizeProjectName(this.projectNameInput?.value) || DEFAULT_PROJECT_NAME
                });
                const choice = response?.choice || 'cancel';
                if (choice === 'cancel') return false;
                if (choice === 'save') {
                    const result = await this.saveProject(false);
                    return result?.ok === true;
                }
                if (choice === 'discard') {
                    this.replacementDiscardRecoveryId = this.recoveryId;
                    return true;
                }
                return false;
            } catch (error) {
                this.reportLifecycleFailure('Project change cancelled', error);
                return false;
            }
        }
        if (!window.confirm(`Open another project and discard unsaved changes to ${sanitizeProjectName(this.projectNameInput?.value) || DEFAULT_PROJECT_NAME}?`)) {
            return false;
        }
        this.replacementDiscardRecoveryId = this.recoveryId;
        return true;
    }

    exposeLifecycleHooks() {
        const lifecycle = {
            prepareClose: () => this.prepareClose(),
            saveForClose: () => this.saveProject(false),
            discardForClose: () => this.discardForClose(),
            flushRecovery: () => this.writeAutosave({ force: true, announceFailure: true }),
            newProject: options => this.startNewProject(options),
            listRecoveries: () => this.listRecoveryRecords(),
            restoreRecovery: recoveryId => this.restoreRecoveryRecord(recoveryId),
            deleteRecovery: recoveryId => this.deleteRecoveryRecord(recoveryId)
        };
        globalThis.window.cabinetCrafterLifecycle = Object.freeze(lifecycle);
        globalThis.window.addEventListener('cabinet-project-new', event => {
            void this.startNewProject(event.detail || {});
        });
        globalThis.window.addEventListener('cabinetcrafter:error', event => {
            if (event?.detail?.context === 'load-project') this.replacementDiscardRecoveryId = null;
        });
    }

    async prepareClose() {
        this.flushPendingCabinetUpdate();
        this.flushPendingArtworkUpdate();
        this.flushHistory();
        window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = null;
        let autosaveError = null;
        if (this.isDirty()) {
            const result = await this.writeAutosave({ force: true, announceFailure: true });
            if (!result.ok) autosaveError = result.message || 'Recovery write failed.';
        }
        return {
            dirty: this.isDirty(),
            projectName: sanitizeProjectName(this.projectNameInput?.value) || DEFAULT_PROJECT_NAME,
            autosaveError
        };
    }

    async discardForClose() {
        window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = null;
        await this.clearAutosave();
        return { ok: true };
    }

    async startNewProject(options = {}) {
        if (options.prompt !== false && !await this.prepareProjectReplacement('start a new project')) {
            return { ok: false, cancelled: true };
        }
        const presetId = PRESETS[options.presetId] ? options.presetId : 'standard';
        const params = cloneParams(PRESETS[presetId]);
        params.presetId = presetId;
        try {
            if (isDesktopAvailable()) {
                await requestDesktop('project.new', { projectName: DEFAULT_PROJECT_NAME });
            }
            await abandonPendingProjectOpen();
            this.currentProjectPath = null;
            this.hasSavedProject = false;
            this.recoveryId = createRecoveryId();
            this.app.applyProjectData?.({
                projectName: DEFAULT_PROJECT_NAME,
                params,
                units: { display: this.unitMode },
                viewState: {}
            }, { recovered: false });
            this.savedSignature = this.getProjectSignature();
            this.updateDirtyState();
            emitLifecycleEvent('project-new', { presetId, projectName: DEFAULT_PROJECT_NAME });
            return { ok: true, presetId };
        } catch (error) {
            this.reportLifecycleFailure('New project failed', error);
            return { ok: false, message: error?.message || String(error) };
        }
    }

    bindCameraControls() {
        const viewButtons = {
            perspective: document.getElementById('btn-view-perspective'),
            front: document.getElementById('btn-view-front'),
            side: document.getElementById('btn-view-side'),
            top: document.getElementById('btn-view-top')
        };
        Object.entries(viewButtons).forEach(([view, button]) => {
            button?.addEventListener('click', () => {
                this.app.setCameraView?.(view);
                this.syncCameraToolbar(view);
                this.afterViewMutation(`Switch to ${view} view`);
            });
        });

        document.getElementById('btn-fit-view')?.addEventListener('click', () => {
            this.app.fitCabinet?.();
            this.afterViewMutation('Fit cabinet view');
            this.recordLearningAction(this.learningActions?.VIEWPORT_FITTED, { source: 'toolbar' });
        });
        document.getElementById('btn-frame-selected')?.addEventListener('click', () => {
            this.app.frameSelected?.();
            this.afterViewMutation('Frame selected component');
        });
        document.getElementById('btn-reset-view')?.addEventListener('click', () => {
            this.app.resetCamera?.();
            this.syncCameraToolbar('perspective');
            this.afterViewMutation('Reset camera');
        });
        document.getElementById('btn-isolate-selected')?.addEventListener('click', () => {
            if (!this.activePanelId) return;
            this.app.isolatePanel?.(this.activePanelId);
            this.updatePanelInventory();
            this.syncSceneVisibilityControls();
            this.afterViewMutation('Isolate component');
            this.showNotification('Selected component isolated in the viewport');
        });
        this.app.controls?.addEventListener('end', () => {
            this.afterViewMutation('Move camera');
            this.recordLearningAction(this.learningActions?.VIEWPORT_ORBITED, { source: 'viewport' });
        });
        document.getElementById('btn-show-all')?.addEventListener('click', () => {
            this.app.showAllPanels?.();
            this.updatePanelInventory();
            this.renderComponentReadout();
            this.syncComponentControls();
            this.syncSceneVisibilityControls();
            this.afterViewMutation('Show all panels');
            this.showNotification('All cabinet panels shown');
        });
    }

    syncCameraToolbar(view = 'perspective') {
        ['perspective', 'front', 'side', 'top'].forEach(candidate => {
            const button = document.getElementById(`btn-view-${candidate}`);
            const active = candidate === view;
            button?.classList.toggle('active', active);
            button?.setAttribute('aria-pressed', String(active));
        });
        this.workspaceShell?.updateViewport(view, this.activePanelId ? this.cabinet.getPanelById(this.activePanelId) : null);
    }

    bindProjectControls() {
        document.getElementById('unit-mm')?.addEventListener('click', () => this.setUnitMode('mm'));
        document.getElementById('unit-in')?.addEventListener('click', () => this.setUnitMode('in'));
        document.getElementById('unit-mm-menu')?.addEventListener('click', () => this.setUnitMode('mm'));
        document.getElementById('unit-in-menu')?.addEventListener('click', () => this.setUnitMode('in'));
        this.btnUndo?.addEventListener('click', () => this.undo());
        this.btnRedo?.addEventListener('click', () => this.redo());
        this.btnUndoMenu?.addEventListener('click', () => this.undo());
        this.btnRedoMenu?.addEventListener('click', () => this.redo());
        this.projectNameInput?.addEventListener('input', () => {
            this.updateDirtyState();
            this.scheduleHistory('Rename project');
            this.scheduleAutosave();
        });
        this.projectNameInput?.addEventListener('change', () => {
            const cleaned = sanitizeProjectName(this.projectNameInput.value);
            this.projectNameInput.value = cleaned || DEFAULT_PROJECT_NAME;
            this.commitHistoryNow('Rename project');
        });

        window.addEventListener('cabinet-desktop-shortcut', event => {
            if (event.detail === 'save') this.saveProject(false);
            if (event.detail === 'saveAs') this.saveProject(true);
            if (event.detail === 'open') this.btnLoad?.click();
        });

        this.panelInventory?.addEventListener('keydown', event => {
            const items = Array.from(this.panelInventory.querySelectorAll('.panel-item'));
            const currentIndex = items.indexOf(document.activeElement);
            if (currentIndex < 0 || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            let nextIndex = currentIndex;
            if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
            if (event.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, currentIndex + 1);
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = items.length - 1;
            const nextId = items[nextIndex]?.dataset.id;
            if (!nextId) return;
            this.selectPanel(nextId);
            window.requestAnimationFrame(() => this.panelInventory.querySelector(`[data-id="${cssEscape(nextId)}"]`)?.focus());
        });
        this.panelInventorySearch?.addEventListener('input', () => this.updatePanelInventory());

        window.addEventListener('beforeunload', event => {
            if (!this.isDirty()) return;
            event.preventDefault();
            event.returnValue = '';
        });
    }

    bindKeyboardShortcuts() {
        document.addEventListener('keydown', event => {
            const modifier = event.ctrlKey || event.metaKey;
            const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
                || document.activeElement?.isContentEditable;
            if (modifier && event.key.toLowerCase() === 's') {
                event.preventDefault();
                this.saveProject(event.shiftKey);
                return;
            }
            if (modifier && event.key.toLowerCase() === 'o') {
                event.preventDefault();
                this.btnLoad?.click();
                return;
            }
            if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey && !typing) {
                event.preventDefault();
                this.undo();
                return;
            }
            if (modifier && !typing && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
                event.preventDefault();
                this.redo();
                return;
            }
            if (typing || modifier || event.altKey) return;
            if (event.target === this.app.renderer?.domElement) return;
            if (event.key === 'Home') {
                event.preventDefault();
                document.getElementById('btn-reset-view')?.click();
            } else if (event.key === 'Escape' && this.exportDialog?.open) {
                this.exportDialog.close();
            }
        });
    }

    bindRecoveryControls() {
        document.getElementById('btn-restore-recovery')?.addEventListener('click', async () => {
            const recoveryId = this.pendingRecoveryDescriptor?.recoveryId;
            if (!recoveryId) return;
            const result = await this.restoreRecoveryRecord(recoveryId);
            if (!result?.ok) {
                this.reportLifecycleFailure('Recovery could not be restored', result?.message || 'The recovery record is unavailable.');
            }
        });
        document.getElementById('btn-discard-recovery')?.addEventListener('click', async () => {
            const recoveryId = this.pendingRecoveryDescriptor?.recoveryId;
            if (!recoveryId) return;
            this.pendingRecovery = null;
            this.pendingRecoveryDescriptor = null;
            if (this.recoveryBanner) this.recoveryBanner.hidden = true;
            const result = await this.deleteRecoveryRecord(recoveryId);
            if (result?.deleted) await this.checkRecoveryState();
        });
        this.btnRefreshRecoveries?.addEventListener('click', () => this.renderRecoveryRecords({ refresh: true }));
        this.recoveryRecordList?.addEventListener('click', async event => {
            const restore = event.target.closest('[data-restore-recovery]');
            const remove = event.target.closest('[data-delete-recovery]');
            if (restore) {
                const recoveryId = restore.dataset.restoreRecovery;
                restore.disabled = true;
                restore.setAttribute('aria-busy', 'true');
                const result = await this.restoreRecoveryRecord(recoveryId, { openAsCopy: true });
                restore.removeAttribute('aria-busy');
                restore.disabled = false;
                if (result?.ok) {
                    this.makerWorkflow?.projectDialog?.close();
                    this.showNotification('Recovery opened as an unsaved copy.', {
                        severity: 'success',
                        title: 'Recovery restored'
                    });
                }
                return;
            }
            if (remove) {
                const recoveryId = remove.dataset.deleteRecovery;
                const descriptor = this.recoveryRecords.find(item => item.recoveryId === recoveryId);
                if (!window.confirm(`Delete the recovery for ${descriptor?.projectName || 'this project'}?`)) return;
                const result = await this.deleteRecoveryRecord(recoveryId);
                if (result?.deleted) await this.renderRecoveryRecords({ refresh: true });
            }
        });
    }

    async saveProject(saveAs = false) {
        const operationKey = saveAs ? 'project-save-as' : 'project-save';
        if (!this.beginOperation(operationKey, [this.btnSave, this.btnSaveAs], saveAs ? 'Choosing a new project file...' : 'Saving project...')) {
            return { ok: false, busy: true };
        }
        this.flushPendingCabinetUpdate();
        this.flushPendingArtworkUpdate();
        await this.projectTransitionPromise;
        const projectName = sanitizeProjectName(this.projectNameInput?.value) || DEFAULT_PROJECT_NAME;
        if (this.projectNameInput) this.projectNameInput.value = projectName;
        this.cabinet.params.displayUnits = this.unitMode;
        const mannequinState = {
            ...(this.dummy?.getCurrentProfile?.() || {}),
            visible: this.dummy?.visible !== false
        };
        const metadata = {
            projectName,
            viewState: this.app.getViewState?.() || {},
            mannequinState,
            download: !isDesktopAvailable()
        };
        this.cabinet.projectMetadata = metadata;
        try {
            const result = await Promise.resolve(ProjectExporter.saveProject?.(this.cabinet, metadata));
            if (result?.ok === false) {
                throw new Error(result.error?.message || result.message || result.reason || 'The project could not be saved.');
            }
            assertTextWithinLimit(result?.content || '', MAX_PROJECT_DOCUMENT_BYTES, 'Project');
            let desktopResult = null;
            if (isDesktopAvailable()) {
                desktopResult = await requestDesktop(saveAs ? 'project.saveAs' : 'project.save', {
                    content: result.content,
                    suggestedName: result.filename,
                    projectName
                });
                if (desktopResult?.cancelled) {
                    this.statusService?.resolve(operationKey);
                    return { ok: false, cancelled: true };
                }
                this.currentProjectPath = desktopResult?.path || this.currentProjectPath;
                this.hasSavedProject = true;
            } else if (!result?.delivered) {
                throw new Error('The browser did not accept the project download.');
            } else {
                this.hasSavedProject = true;
            }
            this.flushHistory();
            this.savedSignature = this.getProjectSignature();
            this.updateDirtyState();
            await this.clearAutosave();
            if (desktopResult?.warning) {
                this.reportLifecycleFailure('Project saved, but Recents was not updated', desktopResult.warning, { severity: 'warning' });
                this.statusService?.resolve(operationKey, 'Project saved; Recents was not updated', { severity: 'warning', title: 'Project saved' });
            } else {
                this.statusService?.resolve(operationKey, 'Project saved', { title: 'Save complete' });
            }
            this.recordLearningAction(this.learningActions?.PROJECT_SAVED, {
                saved: true,
                path: desktopResult?.path || null
            });
            return { ok: true, cancelled: false, path: desktopResult?.path || null };
        } catch (error) {
            console.error('Project save failed', error);
            this.statusService?.fail(operationKey, error.message || String(error), { title: 'Save failed' });
            return { ok: false, cancelled: false, message: error?.message || String(error) };
        } finally {
            this.endOperation(operationKey, [this.btnSave, this.btnSaveAs]);
        }
    }

    openExportDialog() {
        if (!this.exportDialog) return;
        this.flushPendingCabinetUpdate();
        this.flushPendingArtworkUpdate();
        this.clearPackageAttemptFindings();
        if (this.warningAcknowledgement) this.warningAcknowledgement.checked = false;
        this.renderExportPreflightSummary();
        this.updateExportControls();
        if (typeof this.exportDialog.showModal === 'function') this.exportDialog.showModal();
        else this.exportDialog.setAttribute('open', '');
    }

    async performExport(kind) {
        const operationKey = `export-${kind}`;
        const exportButton = kind === 'draft' ? this.btnExportDraft : kind === 'package' ? this.btnExportPackage : this.btnExportProduction;
        if (!this.beginOperation(operationKey, [exportButton], `Preparing ${kind === 'draft' ? 'annotated draft' : kind === 'package' ? 'fabrication package' : 'production drawing'}...`)) return;
        const acknowledgeWarnings = Boolean(this.warningAcknowledgement?.checked);
        try {
            const makerOptions = kind === 'package' ? this.makerWorkflow?.getExportOptions?.() : null;
            if (makerOptions?.readiness?.ok === false) {
                const first = makerOptions.readiness.findings?.find(item => item.severity === 'error');
                this.exportDialog?.close();
                this.makerWorkflow?.open?.('sheets');
                this.statusService?.fail(operationKey, first?.message || 'Fix the sheet-plan errors.', {
                    title: 'Fabrication package blocked',
                    actions: [{ label: 'Open Sheets', run: () => this.makerWorkflow?.open?.('sheets') }]
                });
                return;
            }
            const exporter = kind === 'draft'
                ? (ProjectExporter.exportDraftSVG || ProjectExporter.exportToSVG)
                : kind === 'package'
                    ? ProjectExporter.exportFabricationPackage
                    : ProjectExporter.exportProductionSVG;
            if (typeof exporter !== 'function') throw new Error(`${kind === 'draft' ? 'Draft' : kind === 'package' ? 'Fabrication package' : 'Production'} export is unavailable.`);
            const { readiness: _makerReadiness, ...makerExportOptions } = makerOptions || {};
            const result = await Promise.resolve(exporter(this.cabinet, {
                ...makerExportOptions,
                acknowledgeWarnings,
                projectName: this.projectNameInput?.value,
                download: !isDesktopAvailable()
            }));
            if (result?.ok === false || result?.blocked) {
                const message = result.reason || result.message || 'Preflight blocked this export.';
                if (kind === 'package') this.setPackageAttemptFindings(result.preflight || result.results || []);
                this.renderExportPreflightSummary(kind === 'package' ? null : result.preflight);
                this.updateExportControls();
                this.statusService?.fail(operationKey, message, { title: 'Export blocked' });
                return;
            }
            let deliveryResult = null;
            if (isDesktopAvailable()) {
                deliveryResult = kind === 'package'
                    ? await requestDesktop('export.saveBinary', {
                        base64: getBinaryExportPayload(result),
                        suggestedName: result.filename
                    })
                    : await requestDesktop('export.saveText', {
                        content: result.content,
                        suggestedName: result.filename,
                        filter: 'SVG drawing (*.svg)|*.svg|All files (*.*)|*.*'
                    });
                if (deliveryResult?.cancelled) {
                    this.statusService?.resolve(operationKey);
                    return;
                }
            } else if (result?.delivered === false) {
                throw new Error('The browser did not accept the export download.');
            }
            const packageBase64 = result?.package?.base64 || result?.base64;
            const receiptDetails = {
                path: deliveryResult?.path || '',
                sizeBytes: typeof result.content === 'string'
                    ? utf8ByteLength(result.content)
                    : typeof packageBase64 === 'string'
                        ? Math.floor(packageBase64.length * 0.75)
                        : 0,
                findings: this.getPreflightResults(),
                timestamp: new Date().toISOString()
            };
            if (kind === 'production' || kind === 'package') this.makerWorkflow?.onExportCompleted?.(kind);
            this.makerWorkflow?.recordExportReceipt?.(kind, result, receiptDetails);
            const successMessage = kind === 'draft' ? 'Annotated draft exported' : kind === 'package' ? 'Fabrication package exported' : 'Production SVG exported';
            this.statusService?.resolve(operationKey, successMessage, { title: 'Export complete' });
            this.recordLearningAction(this.learningActions?.EXPORT_COMPLETED, {
                output: kind === 'draft' ? 'annotated-draft' : kind,
                delivered: true
            });
            this.renderExportReceipt(kind, result, deliveryResult);
        } catch (error) {
            console.error(`${kind} export failed`, error);
            this.statusService?.fail(operationKey, error.message || String(error), { title: 'Export failed' });
            if (kind === 'package') this.setPackageAttemptFindings(error.preflight || error.results || []);
            this.renderExportPreflightSummary(kind === 'package' ? null : (error.preflight || error.results));
            this.updateExportControls();
        } finally {
            this.endOperation(operationKey, [exportButton]);
        }
    }

    renderExportPreflightSummary(results = null) {
        if (!this.exportSummary) return;
        const issues = this.getPreflightResults(results);
        const counts = countSeverities(issues);
        const sheetReadiness = this.makerWorkflow?.getExportReadiness?.();
        const sheetFindings = sheetReadiness?.findings || [];
        const sheetCounts = countSeverities(sheetFindings.map(normalizePreflightResult));
        const packageFindings = this.getPackageAttemptFindings(issues, sheetFindings);
        const packageCounts = countSeverities(packageFindings);
        const status = counts.error ? 'Production export is blocked' : counts.warning ? 'Review warnings to continue' : 'Ready for production';
        this.exportSummary.innerHTML = `
            <div class="preflight-status ${counts.error ? 'blocked' : 'ok'}">
                <strong>${escapeHtml(status)}</strong>
                <span>${counts.error} errors / ${counts.warning} warnings / ${counts.info} info</span>
            </div>
            ${issues.slice(0, 5).map(issue => `
                <div class="issue-card ${escapeHtml(issue.severity)}">
                    <button class="issue-card-main" type="button" data-export-issue-code="${escapeHtml(issue.code)}">
                        <span class="issue-code">${escapeHtml(issue.code)}</span>
                        <span class="issue-message">${escapeHtml(issue.message)}</span>
                    </button>
                </div>
            `).join('')}
            ${issues.length > 5 ? `<div class="section-hint">${issues.length - 5} more findings are listed in Review.</div>` : ''}
            <div class="preflight-status ${sheetCounts.error ? 'blocked' : 'ok'}">
                <strong>${sheetCounts.error ? 'Fabrication package sheets are blocked' : sheetCounts.warning ? 'Sheet warnings need review' : 'Sheet layouts ready'}</strong>
                <span>${sheetCounts.error} errors / ${sheetCounts.warning} warnings · open Sheets for details</span>
            </div>
            ${packageFindings.length ? `
                <div class="preflight-status ${packageCounts.error ? 'blocked' : 'ok'}">
                    <strong>${packageCounts.error ? 'Optional package settings are blocked' : 'Optional package warnings need acknowledgement'}</strong>
                    <span>${packageCounts.error} errors / ${packageCounts.warning} warnings from joinery, process, artwork or workshop settings</span>
                </div>
                ${packageFindings.slice(0, 5).map(issue => `
                    <div class="issue-card ${escapeHtml(issue.severity)}">
                        <div class="issue-card-main">
                            <span class="issue-code">${escapeHtml(issue.code)}</span>
                            <span class="issue-message">${escapeHtml(issue.message)}</span>
                        </div>
                    </div>`).join('')}
            ` : ''}
        `;
        this.exportSummary.querySelectorAll('[data-export-issue-code]').forEach((button, index) => {
            button.addEventListener('click', () => {
                const issue = issues.find(candidate => candidate.code === button.dataset.exportIssueCode) || issues[index];
                this.selectPreflightIssue(issue);
                this.exportDialog?.close();
            });
        });
    }

    updateExportControls() {
        const issues = this.getPreflightResults();
        const sheetReadiness = this.makerWorkflow?.getExportReadiness?.();
        const acknowledged = Boolean(this.warningAcknowledgement?.checked);
        const packageFindings = this.getPackageAttemptFindings(issues, sheetReadiness?.findings || []);
        const readiness = this.makerWorkflow?.getExportOutputReadiness?.(issues, {
            packageFindings,
            warningsAcknowledged: acknowledged
        });
        const production = readiness?.outputs?.production;
        const packageOutput = readiness?.outputs?.package;
        const draft = readiness?.outputs?.draft;
        const counts = production?.counts || countSeverities(issues);
        const packageCounts = packageOutput?.counts || countSeverities([
            ...issues,
            ...(sheetReadiness?.findings || []).map(normalizePreflightResult),
            ...packageFindings
        ]);
        const productionBlocked = production ? !production.available : counts.error > 0 || (counts.warning > 0 && !acknowledged);
        const packageBlocked = packageOutput ? !packageOutput.available : true;
        const packageErrors = packageCounts.error || 0;
        const packageWarnings = packageCounts.warning || 0;
        if (this.warningAckRow) this.warningAckRow.hidden = (counts.warning + packageWarnings) === 0 || (counts.error + packageErrors) > 0;
        if (this.btnExportDraft) this.btnExportDraft.disabled = this.activeOperations.has('export-draft');
        if (this.btnExportProduction) this.btnExportProduction.disabled = productionBlocked || this.activeOperations.has('export-production');
        if (this.btnExportPackage) this.btnExportPackage.disabled = packageBlocked || this.activeOperations.has('export-package');
        this.syncOutputReadiness(this.draftReadiness, draft || { label: 'Available', status: 'available', reason: 'Annotated draft is available.' });
        this.syncOutputReadiness(this.productionReadiness, production || { label: productionBlocked ? 'Blocked' : 'Ready', status: productionBlocked ? 'blocked' : 'ready', reason: '' });
        this.syncOutputReadiness(this.packageReadiness, packageOutput || { label: packageBlocked ? 'Blocked' : 'Ready', status: packageBlocked ? 'blocked' : 'ready', reason: '' });
        const option = this.btnExportProduction?.closest('.production-option');
        option?.classList.toggle('blocked', counts.error > 0);
        if (this.productionBlockReason) {
            this.productionBlockReason.hidden = !productionBlocked;
            this.productionBlockReason.textContent = production?.reason || (counts.error
                ? `Resolve ${counts.error} fabrication error${counts.error === 1 ? '' : 's'} before production export.`
                : 'Acknowledge the warnings to enable production export.');
        }
        if (this.packageBlockReason) {
            this.packageBlockReason.hidden = !packageBlocked;
            this.packageBlockReason.textContent = packageOutput?.reason || (packageErrors
                ? `Resolve ${packageErrors} fabrication or sheet-plan error${packageErrors === 1 ? '' : 's'} before building the workshop package.`
                : 'Acknowledge the fabrication and sheet warnings to enable the package.');
        }
    }

    syncOutputReadiness(element, output) {
        if (!element || !output) return;
        element.textContent = output.label || 'Checking';
        element.className = `output-readiness ${output.status || ''}`.trim();
        if (output.reason) element.title = output.reason;
        else element.removeAttribute('title');
    }

    queueComponentOverride(panelId, key, value) {
        if (!panelId) return;
        const overrides = cloneParams(
            this.pendingCabinetPatch?.componentOverrides
            || this.cabinet.params.componentOverrides
            || {}
        );
        overrides[panelId] = {
            ...(overrides[panelId] || {}),
            [key]: value
        };
        this.queueCabinetUpdate({ componentOverrides: overrides }, `Adjust ${panelId}`);
    }

    flushPendingArtworkUpdate() {
        if (this.artworkUpdateFrame === null) return false;
        window.cancelAnimationFrame(this.artworkUpdateFrame);
        this.artworkUpdateFrame = null;
        this.cabinet.build();
        this.afterCabinetMutation('Adjust artwork');
        return true;
    }

    queueCabinetUpdate(patch, reason = 'Edit design', afterBuild = null) {
        const nextPatch = cloneParams(patch || {});
        this.pendingCabinetPatch = {
            ...(this.pendingCabinetPatch || {}),
            ...nextPatch
        };
        this.pendingCabinetReason = reason;
        if (afterBuild) this.pendingCabinetAfterBuild = afterBuild;
        Object.assign(this.cabinet.params, nextPatch);
        this.app.params = this.cabinet.params;
        if (this.cabinetUpdateFrame !== null) return;
        this.cabinetUpdateFrame = window.requestAnimationFrame(() => {
            this.cabinetUpdateFrame = null;
            this.flushPendingCabinetUpdate();
        });
    }

    flushPendingCabinetUpdate() {
        if (this.cabinetUpdateFrame !== null) {
            window.cancelAnimationFrame(this.cabinetUpdateFrame);
            this.cabinetUpdateFrame = null;
        }
        const patch = this.pendingCabinetPatch;
        if (!patch) return false;
        const reason = this.pendingCabinetReason || 'Edit design';
        const afterBuild = this.pendingCabinetAfterBuild;
        this.pendingCabinetPatch = null;
        this.pendingCabinetReason = null;
        this.pendingCabinetAfterBuild = null;
        try {
            this.cabinet.updateParams(patch);
            afterBuild?.();
            this.afterCabinetMutation(reason);
            return true;
        } catch (error) {
            console.error('Cabinet update failed', error);
            this.showNotification(`Design update failed: ${error?.message || error}`);
            return false;
        }
    }

    afterCabinetMutation(reason = 'Edit design') {
        this.clearPackageAttemptFindings();
        this.makerWorkflow?.onDesignChanged?.();
        this.app.applyIsolation?.();
        this.updatePanelInventory();
        this.updateSceneVisibilityTree();
        this.renderComponentReadout();
        this.renderFabricationSummary();
        this.syncComponentControls();
        this.syncControlInputs(this.cabinet.params.controls);
        this.sideProfileEditor?.syncSummary();
        this.markMutation(reason);
    }

    afterViewMutation(reason = 'Change view') {
        this.scheduleAutosave();
        this.updateDirtyState();
        this.app.requestRender?.();
    }

    markMutation(reason) {
        if (this.restoringHistory) return;
        this.scheduleHistory(reason);
        this.scheduleAutosave();
        this.updateDirtyState();
    }

    scheduleHistory(reason) {
        window.clearTimeout(this.historyTimer);
        this.historyTimer = window.setTimeout(() => this.pushHistoryState(reason), HISTORY_DELAY_MS);
    }

    commitHistoryNow(reason) {
        window.clearTimeout(this.historyTimer);
        this.historyTimer = null;
        this.pushHistoryState(reason);
    }

    flushHistory() {
        this.flushPendingCabinetUpdate();
        this.flushPendingArtworkUpdate();
        if (!this.historyTimer) return;
        window.clearTimeout(this.historyTimer);
        this.historyTimer = null;
        this.pushHistoryState('Edit design');
    }

    pushHistoryState(reason, force = false) {
        if (this.restoringHistory) return;
        const state = this.captureHistoryState();
        const signature = stableStringify(state);
        if (!force && this.history[this.historyIndex]?.signature === signature) {
            this.updateHistoryButtons();
            return;
        }
        if (this.historyIndex < this.history.length - 1) this.history.splice(this.historyIndex + 1);
        this.history.push({ reason, state, signature });
        if (this.history.length > HISTORY_LIMIT) this.history.shift();
        this.historyIndex = this.history.length - 1;
        this.updateHistoryButtons();
        this.updateDirtyState();
    }

    captureHistoryState({ includeViewPreferences = false } = {}) {
        const state = {
            projectName: sanitizeProjectName(this.projectNameInput?.value) || DEFAULT_PROJECT_NAME,
            params: cloneParams(this.cabinet.params),
            decals: snapshotDecals(this.cabinet.decals),
            hiddenPanelIds: Array.from(this.cabinet.hiddenPanelIds || []).sort(),
            mannequin: this.dummy?.getCurrentProfile?.() || null,
            mannequinVisible: this.dummy?.visible !== false
        };
        if (includeViewPreferences) {
            state.gridVisible = this.app.gridHelper?.visible !== false;
            state.edgesVisible = this.cabinet.showEdges !== false;
            state.screwsVisible = this.app.screwsVisible !== false;
            state.viewState = this.app.getViewState?.() || null;
        }
        return state;
    }

    restoreHistoryState(state) {
        if (!state) return;
        this.restoringHistory = true;
        try {
            this.cabinet.params = cloneParams(state.params);
            this.app.params = cloneParams(state.params);
            this.cabinet.hiddenPanelIds = new Set(state.hiddenPanelIds || []);
            this.cabinet.decals = restoreDecalSnapshot(state.decals);
            if (Object.hasOwn(state, 'edgesVisible')) this.cabinet.showEdges = state.edgesVisible !== false;
            this.cabinet.build();
            if (this.dummy && state.mannequin) {
                const presetId = state.mannequin.presetId;
                if (MANNEQUIN_PRESETS[presetId]) this.dummy.setPreset(presetId);
                this.dummy.setHeight(state.mannequin.height);
                this.dummy.setCabinetDepth(state.params.depth);
                this.dummy.setVisibility(state.mannequinVisible !== false);
            }
            if (this.app.gridHelper && Object.hasOwn(state, 'gridVisible')) {
                this.app.gridHelper.visible = state.gridVisible !== false;
            }
            if (Object.hasOwn(state, 'screwsVisible')) {
                this.app.setScrewVisibility?.(state.screwsVisible !== false);
            }
            if (state.viewState) this.app.restoreViewState?.(state.viewState);
            if (this.projectNameInput) this.projectNameInput.value = state.projectName || DEFAULT_PROJECT_NAME;
            document.getElementById('toggle-dummy').checked = state.mannequinVisible !== false;
            if (Object.hasOwn(state, 'gridVisible')) {
                document.getElementById('btn-toggle-grid').classList.toggle('active', state.gridVisible !== false);
            }
            if (Object.hasOwn(state, 'edgesVisible')) {
                document.getElementById('btn-toggle-edges').classList.toggle('active', state.edgesVisible !== false);
            }
            this.syncSceneVisibilityControls();
            this.syncAllSliders(state.params);
            this.syncControlInputs(state.params.controls);
            this.sideProfileEditor?.syncSummary(state.params.sideProfileCustomization);
            this.selectPanel(null);
            this.makerWorkflow?.onDesignChanged?.();
            this.renderFabricationSummary();
            this.app.applyIsolation?.();
        } finally {
            this.restoringHistory = false;
        }
        this.updateDirtyState();
        this.scheduleAutosave();
    }

    undo() {
        this.flushHistory();
        if (this.historyIndex <= 0) return;
        this.historyIndex -= 1;
        const entry = this.history[this.historyIndex];
        this.restoreHistoryState(entry.state);
        this.updateHistoryButtons();
        this.showNotification(`Undo: ${entry.reason}`);
    }

    redo() {
        this.flushHistory();
        if (this.historyIndex >= this.history.length - 1) return;
        this.historyIndex += 1;
        const entry = this.history[this.historyIndex];
        this.restoreHistoryState(entry.state);
        this.updateHistoryButtons();
        this.showNotification(`Redo: ${entry.reason}`);
    }

    updateHistoryButtons() {
        const undoDisabled = this.historyIndex <= 0;
        const redoDisabled = this.historyIndex >= this.history.length - 1;
        const undoTitle = undoDisabled ? 'Nothing to undo' : `Undo ${this.history[this.historyIndex]?.reason || ''} (Ctrl+Z)`;
        const redoTitle = redoDisabled ? 'Nothing to redo' : `Redo ${this.history[this.historyIndex + 1]?.reason || ''} (Ctrl+Y)`;
        [this.btnUndo, this.btnUndoMenu].forEach(button => {
            if (!button) return;
            button.disabled = undoDisabled;
            button.title = undoTitle;
        });
        [this.btnRedo, this.btnRedoMenu].forEach(button => {
            if (!button) return;
            button.disabled = redoDisabled;
            button.title = redoTitle;
        });
    }

    getProjectSignature() {
        const state = this.captureHistoryState({ includeViewPreferences: true });
        // Camera orbit is persisted for convenience, but navigating the
        // viewport should not make an otherwise unchanged design appear
        // unsaved. The durable view choices are already represented by the
        // explicit grid/edge/visibility/mannequin fields above.
        delete state.viewState;
        return stableStringify(state);
    }

    isDirty() {
        return this.getProjectSignature() !== this.savedSignature;
    }

    updateDirtyState() {
        const dirty = this.isDirty();
        if (this.dirtyIndicator) {
            const stateText = this.autosaveFailure
                ? 'Recovery failed'
                : dirty
                    ? 'Unsaved'
                    : this.hasSavedProject
                        ? 'Saved'
                        : 'New';
            this.dirtyIndicator.textContent = stateText;
            this.dirtyIndicator.classList.toggle('dirty', dirty || Boolean(this.autosaveFailure));
            this.dirtyIndicator.title = this.autosaveFailure?.message || stateText;
            this.dirtyIndicator.setAttribute('aria-label', this.autosaveFailure?.message || stateText);
        }
        document.title = `${dirty ? '* ' : ''}${sanitizeProjectName(this.projectNameInput?.value) || DEFAULT_PROJECT_NAME} - Cabinet Crafter`;
        this.scheduleNativeProjectState(dirty);
    }

    scheduleNativeProjectState(dirty = this.isDirty()) {
        if (!isDesktopAvailable()) return;
        window.clearTimeout(this.nativeStateTimer);
        this.nativeStateTimer = window.setTimeout(() => {
            void requestDesktop('project.state.update', {
                dirty,
                projectName: sanitizeProjectName(this.projectNameInput?.value) || DEFAULT_PROJECT_NAME
            }).catch(error => console.warn('Native project state could not be updated', error));
        }, 60);
    }

    scheduleAutosave() {
        window.clearTimeout(this.autosaveTimer);
        this.autosaveTimer = window.setTimeout(() => this.writeAutosave(), 900);
    }

    async writeAutosave({ force = false, announceFailure = false } = {}) {
        if (!force && !this.isDirty()) return { ok: true, skipped: true };
        const state = this.captureHistoryState({ includeViewPreferences: true });
        const recovery = {
            ...state,
            schemaVersion: '2.0-recovery',
            timestamp: new Date().toISOString(),
            recoveryId: this.recoveryId,
            sourcePath: this.currentProjectPath || null
        };
        try {
            const content = JSON.stringify(recovery, decalJsonReplacer);
            const sizeBytes = assertTextWithinLimit(content, MAX_RECOVERY_RECORD_BYTES, 'Recovery');
            let result;
            if (isDesktopAvailable()) {
                result = await requestDesktop('project.recovery.write', {
                    recoveryId: this.recoveryId,
                    content,
                    projectName: recovery.projectName,
                    sourcePath: recovery.sourcePath
                });
            } else {
                window.localStorage.setItem(`${RECOVERY_KEY_PREFIX}${this.recoveryId}`, content);
                result = { recoveryId: this.recoveryId, sizeBytes, savedAt: recovery.timestamp };
            }
            this.autosaveFailure = null;
            this.updateDirtyState();
            emitLifecycleEvent('autosave-status', {
                status: 'saved',
                persistent: false,
                recoveryId: this.recoveryId,
                sizeBytes: result?.sizeBytes ?? sizeBytes,
                savedAt: result?.savedAt || recovery.timestamp
            });
            return { ok: true, recoveryId: this.recoveryId, ...result };
        } catch (error) {
            console.warn('Autosave unavailable', error);
            const message = error?.message || String(error);
            this.autosaveFailure = { message, timestamp: new Date().toISOString() };
            this.updateDirtyState();
            emitLifecycleEvent('autosave-status', {
                status: 'error',
                persistent: true,
                recoveryId: this.recoveryId,
                message
            });
            if (announceFailure) this.showNotification(`Recovery failed: ${message}`);
            return { ok: false, message };
        }
    }

    async checkRecoveryState() {
        try {
            const records = await this.listRecoveryRecords();
            this.recoveryRecords = records;
            await this.renderRecoveryRecords({ refresh: false });
            emitLifecycleEvent('recovery-list', { records: cloneParams(records) });
            const descriptor = records[0];
            if (!descriptor) {
                this.pendingRecovery = null;
                this.pendingRecoveryDescriptor = null;
                if (this.recoveryBanner) this.recoveryBanner.hidden = true;
                return [];
            }
            const response = await this.readRecoveryRecord(descriptor.recoveryId);
            if (!response?.content) return records;
            const recovery = JSON.parse(response.content);
            if (!recovery?.params || !recovery?.timestamp) return records;
            this.pendingRecovery = recovery;
            this.pendingRecoveryDescriptor = descriptor;
            const detail = document.getElementById('recovery-detail');
            if (detail) {
                const more = records.length > 1 ? ` | ${records.length - 1} more` : '';
                detail.textContent = `${recovery.projectName || 'Untitled cabinet'} | ${formatRecoveryTime(recovery.timestamp)}${more}`;
            }
            if (this.recoveryBanner) this.recoveryBanner.hidden = false;
            return records;
        } catch (error) {
            console.warn('Recovery data could not be read', error);
            this.reportLifecycleFailure('Recovery data could not be read', error);
            return [];
        }
    }

    async renderRecoveryRecords({ refresh = false } = {}) {
        if (!this.recoveryRecordList) return this.recoveryRecords;
        if (refresh) {
            this.recoveryRecordList.textContent = 'Loading recoveries...';
            try {
                this.recoveryRecords = await this.listRecoveryRecords();
            } catch (error) {
                this.recoveryRecordList.textContent = `Recoveries could not be loaded: ${error?.message || error}`;
                return [];
            }
        }
        this.recoveryRecordList.replaceChildren();
        if (!this.recoveryRecords.length) {
            const empty = document.createElement('p');
            empty.className = 'section-hint';
            empty.textContent = 'No recovery records are available.';
            this.recoveryRecordList.appendChild(empty);
            return [];
        }
        this.recoveryRecords.forEach(record => {
            const row = document.createElement('article');
            row.className = 'recovery-record';

            const copy = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = record.projectName || DEFAULT_PROJECT_NAME;
            const detail = document.createElement('span');
            detail.className = 'section-hint';
            detail.textContent = [
                formatRecoveryTime(record.savedAt),
                formatByteSize(record.sizeBytes),
                record.sourcePath ? `From ${record.sourcePath}` : 'Not linked to a saved file'
            ].filter(Boolean).join(' | ');
            copy.append(title, detail);

            const actions = document.createElement('div');
            actions.className = 'recovery-record-actions';
            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'btn btn-secondary btn-sm';
            restore.dataset.restoreRecovery = record.recoveryId;
            restore.textContent = 'Open as copy';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'dialog-close';
            remove.dataset.deleteRecovery = record.recoveryId;
            remove.textContent = 'Delete';
            remove.setAttribute('aria-label', `Delete recovery for ${record.projectName || DEFAULT_PROJECT_NAME}`);
            actions.append(restore, remove);
            row.append(copy, actions);
            this.recoveryRecordList.appendChild(row);
        });
        return this.recoveryRecords;
    }

    async clearAutosave() {
        return this.deleteRecoveryRecord(this.recoveryId);
    }

    async listRecoveryRecords() {
        if (isDesktopAvailable()) {
            const response = await requestDesktop('project.recovery.list');
            return Array.isArray(response?.records) ? response.records.map(normalizeRecoveryDescriptor) : [];
        }
        const records = [];
        try {
            for (let index = 0; index < window.localStorage.length; index++) {
                const key = window.localStorage.key(index);
                if (!key?.startsWith(RECOVERY_KEY_PREFIX)) continue;
                const raw = window.localStorage.getItem(key);
                if (!raw) continue;
                try {
                    const parsed = JSON.parse(raw);
                    records.push(normalizeRecoveryDescriptor({
                        recoveryId: parsed.recoveryId || key.slice(RECOVERY_KEY_PREFIX.length),
                        projectName: parsed.projectName || DEFAULT_PROJECT_NAME,
                        sourcePath: parsed.sourcePath || null,
                        savedAt: parsed.timestamp,
                        sizeBytes: utf8ByteLength(raw)
                    }));
                } catch (_) { /* invalid records remain isolated */ }
            }
            const legacy = window.localStorage.getItem(LEGACY_AUTOSAVE_KEY);
            if (legacy) {
                try {
                    const parsed = JSON.parse(legacy);
                    const recoveryId = `legacy-${Date.now()}`;
                    parsed.recoveryId = recoveryId;
                    window.localStorage.setItem(`${RECOVERY_KEY_PREFIX}${recoveryId}`, JSON.stringify(parsed));
                    window.localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
                    records.push(normalizeRecoveryDescriptor({
                        recoveryId,
                        projectName: parsed.projectName || DEFAULT_PROJECT_NAME,
                        savedAt: parsed.timestamp,
                        sizeBytes: utf8ByteLength(legacy)
                    }));
                } catch (_) { /* leave unreadable legacy data untouched */ }
            }
        } catch (error) {
            throw new Error(`Browser recovery storage is unavailable: ${error?.message || error}`);
        }
        return records.sort((a, b) => Date.parse(b.savedAt || 0) - Date.parse(a.savedAt || 0));
    }

    async readRecoveryRecord(recoveryId) {
        if (!recoveryId) return null;
        if (isDesktopAvailable()) {
            const response = await requestDesktop('project.recovery.read', { recoveryId });
            return response?.exists ? response : null;
        }
        const content = window.localStorage.getItem(`${RECOVERY_KEY_PREFIX}${recoveryId}`);
        return content ? { exists: true, recoveryId, content, sizeBytes: utf8ByteLength(content) } : null;
    }

    async deleteRecoveryRecord(recoveryId) {
        if (!recoveryId) return { deleted: false };
        try {
            let result;
            if (isDesktopAvailable()) {
                result = await requestDesktop('project.recovery.delete', { recoveryId });
            } else {
                const key = `${RECOVERY_KEY_PREFIX}${recoveryId}`;
                const existed = window.localStorage.getItem(key) != null;
                window.localStorage.removeItem(key);
                result = { deleted: existed, recoveryId };
            }
            emitLifecycleEvent('recovery-deleted', { recoveryId, deleted: Boolean(result?.deleted) });
            return result || { deleted: false, recoveryId };
        } catch (error) {
            console.warn('Recovery could not be deleted', error);
            this.reportLifecycleFailure('Recovery could not be deleted', error);
            return { deleted: false, recoveryId, message: error?.message || String(error) };
        }
    }

    async restoreRecoveryRecord(recoveryId, { openAsCopy = true } = {}) {
        try {
            const descriptor = this.recoveryRecords.find(item => item.recoveryId === recoveryId)
                || normalizeRecoveryDescriptor({ recoveryId });
            const response = await this.readRecoveryRecord(recoveryId);
            if (!response?.content) return { ok: false, message: 'Recovery record is unavailable.' };
            assertTextWithinLimit(response.content, MAX_RECOVERY_RECORD_BYTES, 'Recovery');
            const recovery = JSON.parse(response.content);
            if (!recovery?.params || !recovery?.timestamp) return { ok: false, message: 'Recovery record is invalid.' };
            this.recoveryId = recoveryId;
            this.pendingRecovery = recovery;
            this.pendingRecoveryDescriptor = descriptor;
            if (isDesktopAvailable() && !openAsCopy) {
                const activated = await requestDesktop('project.recovery.activate', { recoveryId });
                this.currentProjectPath = activated?.path || null;
                this.hasSavedProject = Boolean(this.currentProjectPath);
            } else {
                if (isDesktopAvailable()) {
                    await requestDesktop('project.new', {
                        projectName: `${recovery.projectName || DEFAULT_PROJECT_NAME} recovered copy`
                    });
                }
                this.currentProjectPath = openAsCopy ? null : (descriptor.sourcePath || recovery.sourcePath || null);
                this.hasSavedProject = false;
            }
            if (this.recoveryBanner) this.recoveryBanner.hidden = true;
            this.app.applyProjectData?.(recovery, { recovered: true });
            emitLifecycleEvent('recovery-restored', {
                recoveryId,
                sourcePath: this.currentProjectPath,
                projectName: recovery.projectName || DEFAULT_PROJECT_NAME,
                openedAsCopy: openAsCopy
            });
            return { ok: true, recoveryId };
        } catch (error) {
            const message = error?.message || String(error);
            this.reportLifecycleFailure('Recovery could not be restored', message);
            return { ok: false, recoveryId, message };
        }
    }

    onProjectLoaded(data = {}, file = null, recovered = false) {
        const discardedRecoveryId = this.replacementDiscardRecoveryId;
        this.replacementDiscardRecoveryId = null;
        this.clearPackageAttemptFindings();
        const projectName = sanitizeProjectName(data.projectName || data.project?.name || data.name || file?.name?.replace(/(?:\.cabinet)?\.json$/i, '')) || DEFAULT_PROJECT_NAME;
        if (this.projectNameInput) this.projectNameInput.value = projectName;
        const requestedUnits = data.units?.display || data.params?.displayUnits;
        if (requestedUnits === 'in' || requestedUnits === 'mm') this.setUnitMode(requestedUnits, false);
        this.makerWorkflow?.onProjectLoaded?.();
        this.sideProfileEditor?.syncSummary(this.cabinet.params.sideProfileCustomization);
        this.resetBaseline = cloneParams(this.cabinet.params);
        this.history = [];
        this.historyIndex = -1;
        this.pushHistoryState(recovered ? 'Recovered autosave' : 'Open project', true);
        this.savedSignature = recovered ? '' : this.getProjectSignature();
        if (!recovered) {
            this.recoveryId = createRecoveryId();
            const pending = getPendingProjectOpen();
            this.hasSavedProject = Boolean(pending);
            this.projectTransitionPromise = this.commitLoadedProjectCandidate(projectName);
            if (discardedRecoveryId && discardedRecoveryId !== this.recoveryId) {
                void this.deleteRecoveryRecord(discardedRecoveryId);
            }
        }
        this.updateDirtyState();
        if (recovered) {
            this.scheduleAutosave();
            this.showNotification('Autosave restored');
        } else {
            this.showNotification('Project loaded');
        }
    }

    async commitLoadedProjectCandidate(projectName) {
        if (!getPendingProjectOpen()) return null;
        try {
            const result = await commitPendingProjectOpen({ projectName });
            this.currentProjectPath = result?.path || null;
            this.hasSavedProject = Boolean(this.currentProjectPath);
            this.updateDirtyState();
            if (result?.warning) {
                this.reportLifecycleFailure('Project opened, but Recents was not updated', result.warning, { severity: 'warning' });
            }
            return result;
        } catch (error) {
            console.error('Project candidate commit failed', error);
            this.currentProjectPath = null;
            this.hasSavedProject = false;
            this.savedSignature = '';
            try { await requestDesktop('project.new', { projectName }); } catch (_) { /* Save As remains the safe fallback */ }
            this.updateDirtyState();
            this.reportLifecycleFailure('Project opened without a save target', `${error?.message || error}. Use Save As before continuing.`);
            return null;
        }
    }

    setResetBaseline(params) {
        this.resetBaseline = cloneParams(params || this.cabinet.params);
    }

    updateSliderValueDisplay(key, val) {
        const display = this.displays[key];
        if (display) {
            display.textContent = this.formatDisplayValue('param', key, val);
        }
    }

    updateComponentControlDisplay(key, val) {
        const display = this.componentDisplays[key];
        if (display) {
            const sign = val > 0 ? '+' : '';
            display.textContent = `${sign}${this.formatDisplayValue('component', key, val)}`;
        }
    }

    formatDisplayValue(category, key, value) {
        const unit = this.getControlUnit(category, key);
        if (unit === 'mm' && this.unitMode === 'in') {
            const converted = Number(value || 0) / MM_PER_INCH;
            return `${trimNumber(converted, 3)} in`;
        }
        return category === 'control' ? formatControlValue(key, value) : formatParamValue(key, value);
    }

    getPresetLabel(presetId) {
        return presetId === 'barstool' ? 'Bar-top' : presetId === 'standard' ? 'Standard' : presetId;
    }

    applyPreset(presetId) {
        const preset = PRESETS[presetId];
        if (!preset) return;

        const nextParams = cloneParams(preset);
        nextParams.presetId = presetId;
        this.commitHistoryNow('Before preset change');
        this.app.params = nextParams;
        this.cabinet.updateParams(nextParams);
        this.resetBaseline = cloneParams(nextParams);

        if (this.dummy) {
            this.dummy.setVisibility(true);
            document.getElementById('toggle-dummy').checked = true;
            this.dummy.setCabinetDepth(nextParams.depth);
        }

        this.syncAllSliders(nextParams);
        this.syncControlInputs(nextParams.controls);
        this.sideProfileEditor?.syncSummary(this.cabinet.params.sideProfileCustomization);
        this.selectPanel(null);
        this.makerWorkflow?.onProjectLoaded?.({ resetAssignments: true });
        this.renderFabricationSummary();
        this.markMutation(`Apply ${this.getPresetLabel(presetId)} preset`);
        this.showNotification(`Preset: ${this.getPresetLabel(presetId)}`);
    }

    selectPanel(panelId) {
        const selectionChanged = panelId !== this.activePanelId;
        this.activePanelId = panelId;
        this.activeDecalId = null;
        if (selectionChanged && this.componentEditScope) this.componentEditScope.value = 'selected';
        this.cabinet.selectPanel(panelId);
        if (this.app.isolatedPanelId && panelId) this.app.isolatedPanelId = panelId;
        this.app.applyIsolation?.();

        this.updatePanelInventory();
        this.updateSceneVisibilityTree();
        this.renderComponentReadout();
        this.syncComponentControls();
        this.updateDecalPanelState();
        document.getElementById('btn-frame-selected').disabled = !panelId;
        document.getElementById('btn-isolate-selected').disabled = !panelId;
        this.workspaceShell?.updateViewport(this.app.cameraMode || 'perspective', panelId ? this.cabinet.getPanelById(panelId) : null);
        if (selectionChanged && panelId) {
            this.recordLearningAction(this.learningActions?.PANEL_SELECTED, { panelId });
        }
    }

    updatePanelInventory() {
        this.panelInventory.innerHTML = '';
        const query = String(this.panelInventorySearch?.value || '').trim().toLowerCase();
        const panels = this.cabinet.panelMeshes.filter(mesh => {
            if (!query) return true;
            const ud = mesh.userData || {};
            return `${ud.name || ''} ${ud.id || ''} ${ud.role || ''}`.toLowerCase().includes(query);
        });
        if (this.panelInventoryStatus) {
            this.panelInventoryStatus.textContent = query
                ? `${panels.length} of ${this.cabinet.panelMeshes.length} panels shown`
                : `${panels.length} panels`;
        }
        panels.forEach((mesh, index) => {
            const ud = mesh.userData;
            if (!ud.id) return;

            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'panel-item';
            if (ud.id === this.activePanelId) item.classList.add('selected');
            if (ud.warnings?.length || ud.invalidIntersections?.length) item.classList.add('warning');
            if (this.cabinet.isPanelVisible && !this.cabinet.isPanelVisible(ud.id)) item.classList.add('hidden');
            if (this.cabinet.isPanelIncluded?.(ud.id) === false) item.classList.add('excluded');
            item.dataset.id = ud.id;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(ud.id === this.activePanelId));
            item.tabIndex = ud.id === this.activePanelId || (!this.activePanelId && index === 0) ? 0 : -1;
            item.setAttribute('aria-label', `${ud.name}, ${this.formatPanelSize(ud)}${this.cabinet.isPanelVisible?.(ud.id) === false ? ', hidden in viewport' : ''}${this.cabinet.isPanelIncluded?.(ud.id) === false ? ', excluded from fabrication' : ''}`);

            item.innerHTML = `
                <div class="panel-item-main">
                    <span class="panel-name">${escapeHtml(ud.name)}</span>
                </div>
                <div class="panel-item-meta">
                    <span class="panel-meta-row">
                        <span class="panel-meta-label">Part</span>
                        <span class="section-hint">${escapeHtml(ud.id)}</span>
                    </span>
                    <span class="panel-meta-row">
                        <span class="panel-meta-label">Size</span>
                        <span class="panel-info">${escapeHtml(this.formatPanelSize(ud))}</span>
                    </span>
                </div>
            `;

            item.addEventListener('click', () => {
                this.selectPanel(ud.id);
            });

            this.panelInventory.appendChild(item);
        });
        if (!panels.length) {
            const empty = document.createElement('p');
            empty.className = 'section-hint';
            empty.textContent = 'No panels match this search.';
            this.panelInventory.appendChild(empty);
        }
    }

    setPanelViewportVisibility(panelId, visible) {
        if (!panelId || !this.cabinet.getPanelById(panelId)) return;
        if (typeof this.app.setPanelViewportVisibility === 'function') {
            this.app.setPanelViewportVisibility(panelId, visible);
        } else {
            this.app.isolatedPanelId = null;
            this.cabinet.setPanelVisibility(panelId, visible);
        }
        this.refreshViewportVisibilityUI();
        this.afterViewMutation(visible ? 'Show component' : 'Hide component');
        this.showNotification(visible ? 'Component shown in viewport' : 'Component hidden in viewport');
    }

    refreshViewportVisibilityUI() {
        this.updatePanelInventory();
        this.renderComponentReadout();
        this.syncComponentControls();
        this.syncSceneVisibilityControls();
    }

    focusSceneVisibilityControl(controlId) {
        if (!controlId || !this.sceneVisibilityTree) return;
        this.sceneVisibilityTree.querySelector(`#${cssEscape(controlId)}`)?.focus();
    }

    syncSceneVisibilityControls() {
        const screwsVisible = this.app.screwsVisible !== false;
        if (this.btnToggleScrews) {
            this.btnToggleScrews.classList.toggle('active', screwsVisible);
            this.btnToggleScrews.setAttribute('aria-pressed', String(screwsVisible));
            this.btnToggleScrews.title = screwsVisible ? 'Hide screws' : 'Show screws';
        }
        this.updateSceneVisibilityTree();
    }

    updateSceneVisibilityTree() {
        if (!this.sceneVisibilityTree) return;
        const panels = this.cabinet.panelMeshes.filter(mesh => mesh.userData?.id);
        const visiblePanels = panels.filter(mesh => mesh.visible !== false).length;
        const summary = this.app.getSceneVisibilitySummary?.() || {
            screws: { total: 0, visible: 0 },
            hardware: { total: 0, visible: 0 },
            machining: { total: 0, visible: 0 },
            references: { total: 0, visible: 0 }
        };
        const screwsVisible = this.app.screwsVisible !== false;
        const edgesVisible = this.cabinet.showEdges !== false;
        const gridVisible = this.app.gridHelper?.visible !== false;
        const mannequinVisible = this.dummy?.visible !== false;
        const panelItems = panels.map(mesh => {
            const id = mesh.userData.id;
            const inputId = `scene-panel-${domToken(id)}`;
            const selectId = `scene-select-${domToken(id)}`;
            const visible = mesh.visible !== false;
            const included = this.cabinet.isPanelIncluded?.(id) !== false;
            return `<li>
                <div class="scene-tree-row${id === this.activePanelId ? ' selected' : ''}">
                    <input id="${inputId}" type="checkbox" data-scene-visibility="panel" data-panel-id="${escapeHtml(id)}" ${visible ? 'checked' : ''} aria-label="Show ${escapeHtml(mesh.userData.name)} in viewport">
                    <button id="${selectId}" class="scene-tree-select" type="button" data-scene-select-panel="${escapeHtml(id)}">${escapeHtml(mesh.userData.name)}</button>
                    <span class="scene-tree-meta${included ? '' : ' fabrication-excluded'}" title="Fabrication: ${included ? 'included' : 'excluded'}">${included ? 'Included' : 'Excluded'}</span>
                </div>
            </li>`;
        }).join('');

        this.sceneVisibilityTree.innerHTML = `<ul class="scene-tree-list">
            <li>
                <div class="scene-tree-row">
                    <input id="scene-toggle-panels" type="checkbox" data-scene-visibility="panels" ${visiblePanels === panels.length && panels.length ? 'checked' : ''} aria-label="Show all cabinet panels in viewport">
                    <label class="scene-tree-label" for="scene-toggle-panels">Cabinet panels</label>
                    <span class="scene-tree-meta">${visiblePanels} of ${panels.length} shown</span>
                </div>
                <ul class="scene-tree-list scene-tree-panel-list">${panelItems || '<li class="section-hint">No cabinet panels</li>'}</ul>
            </li>
            <li>
                <div class="scene-tree-row">
                    <span class="scene-tree-status-marker" aria-hidden="true">+</span>
                    <span class="scene-tree-label">Cabinet details</span>
                    <span class="scene-tree-meta">Viewport</span>
                </div>
                <ul class="scene-tree-list">
                    ${sceneToggleRow('scene-toggle-screws', 'screws', 'Screws', screwsVisible, `${summary.screws.visible} of ${summary.screws.total} shown`)}
                    ${sceneToggleRow('scene-toggle-edges', 'edges', 'Panel edge outlines', edgesVisible, edgesVisible ? 'Shown' : 'Hidden')}
                    ${sceneStatusRow('Control and display hardware', summary.hardware)}
                    ${sceneStatusRow('Machining markers', summary.machining)}
                    ${sceneStatusRow('Joint and warning references', summary.references)}
                </ul>
            </li>
            <li>
                <div class="scene-tree-row">
                    <span class="scene-tree-status-marker" aria-hidden="true">+</span>
                    <span class="scene-tree-label">Reference guides</span>
                    <span class="scene-tree-meta">Viewport</span>
                </div>
                <ul class="scene-tree-list">
                    ${sceneToggleRow('scene-toggle-grid', 'grid', 'Floor grid', gridVisible, gridVisible ? 'Shown' : 'Hidden')}
                    ${sceneToggleRow('scene-toggle-mannequin', 'mannequin', 'Scale mannequin', mannequinVisible, mannequinVisible ? 'Shown' : 'Hidden')}
                </ul>
            </li>
        </ul>`;

        const panelsToggle = this.sceneVisibilityTree.querySelector('#scene-toggle-panels');
        if (panelsToggle) panelsToggle.indeterminate = visiblePanels > 0 && visiblePanels < panels.length;
    }

    renderComponentReadout() {
        const panel = this.activePanelId ? this.cabinet.getPanelById(this.activePanelId) : null;

        if (!panel) {
            this.componentReadout.innerHTML = '<div class="section-hint">No component selected</div>';
            return;
        }

        const ud = panel.userData;
        const areaM2 = ud.areaMm2 ? (ud.areaMm2 / 1000000).toFixed(3) : '0.000';
        const overrideSummary = this.formatOverrideSummary(ud.override);
        const jointSummary = this.formatJointSummary(ud.intersections || []);
        const invalidSummary = this.formatInvalidIntersectionSummary(ud.invalidIntersections || []);
        const warningSummary = this.formatWarningSummary(ud.warnings || []);
        const fastenerIssueSummary = this.formatFastenerIssueSummary(ud.fastenerIssues || []);
        const panelColor = (ud.override?.color || DEFAULT_PANEL_COLOR).toLowerCase();
        const visibleSummary = this.cabinet.isPanelVisible?.(ud.id) === false ? 'hidden' : 'shown';
        const includedSummary = this.cabinet.isPanelIncluded?.(ud.id) === false ? 'excluded' : 'included';
        const assignedMaterialId = this.cabinet.params.fabricationSettings?.materialAssignments?.[ud.id] || '';
        const assignedMaterial = (this.cabinet.params.materials || []).find(material => material.id === assignedMaterialId);
        const groupOverride = this.cabinet.params.fastenerGroupOverrides?.[ud.id] || {};
        const sources = [
            Object.keys(ud.override || {}).length ? 'Panel override' : null,
            assignedMaterial ? 'Assigned material' : null,
            Object.keys(groupOverride).length ? 'Screw override' : null
        ].filter(Boolean);
        const sourceSummary = sources.length ? sources.join(', ') : 'Project defaults';

        this.componentReadout.innerHTML = `
            <div class="component-title">
                <strong>${escapeHtml(ud.name)}</strong>
                <span class="component-id">${escapeHtml(ud.id)}</span>
            </div>
            <dl class="readout-grid">
                <dt>Type</dt><dd>${escapeHtml(ud.exportType)}</dd>
                <dt>Role</dt><dd>${escapeHtml(ud.role || '-')}</dd>
                <dt>Size</dt><dd>${escapeHtml(this.formatPanelSize(ud))}</dd>
                <dt>Area</dt><dd>${areaM2} m2</dd>
                <dt>Thickness</dt><dd>${escapeHtml(this.formatLength(ud.thickness))}</dd>
                <dt>Material</dt><dd>${escapeHtml(assignedMaterial?.name || 'Automatic by thickness')}</dd>
                <dt>Setting source</dt><dd><span class="effective-source-badge ${sources.length ? 'overridden' : 'inherited'}">${escapeHtml(sourceSummary)}</span></dd>
                <dt>Joints</dt><dd>${escapeHtml(jointSummary)}</dd>
                <dt>Invalid</dt><dd class="${ud.invalidIntersections?.length ? 'warning-text' : ''}">${escapeHtml(invalidSummary)}</dd>
                <dt>Warnings</dt><dd class="${ud.warnings?.length ? 'warning-text' : ''}">${escapeHtml(warningSummary)}</dd>
                <dt>Cutouts</dt><dd>${ud.hardwareCutouts || 0}</dd>
                <dt>Ports</dt><dd>${ud.cutoutCount || 0}</dd>
                <dt>Fasteners</dt><dd>${ud.fastenerCount || 0}</dd>
                <dt>Fastener Issues</dt><dd class="${ud.fastenerIssues?.length ? 'warning-text' : ''}">${escapeHtml(fastenerIssueSummary)}</dd>
                <dt>Visible</dt><dd>${escapeHtml(visibleSummary)}</dd>
                <dt>Fabrication</dt><dd>${escapeHtml(includedSummary)}</dd>
                <dt>Color</dt><dd>${escapeHtml(panelColor)}</dd>
                <dt>Override</dt><dd>${escapeHtml(overrideSummary)}</dd>
            </dl>
        `;
    }

    renderFabricationSummary() {
        if (!this.fabricationSummary) return;
        const issues = this.getPreflightResults();
        const counts = countSeverities(issues);
        const grouped = ['error', 'warning', 'info'];
        const status = counts.error ? 'Blocked' : counts.warning ? 'Review required' : 'Ready';
        this.fabricationSummary.innerHTML = `
            <div class="preflight-status ${counts.error ? 'blocked' : 'ok'}">
                <strong>${escapeHtml(status)}</strong>
                <span>${issues.length} finding${issues.length === 1 ? '' : 's'}</span>
            </div>
            <div class="preflight-overview" aria-label="Preflight totals">
                <div class="severity-total error"><strong>${counts.error}</strong><span>Errors</span></div>
                <div class="severity-total warning"><strong>${counts.warning}</strong><span>Warnings</span></div>
                <div class="severity-total info"><strong>${counts.info}</strong><span>Info</span></div>
            </div>
            ${issues.length ? grouped.map(severity => {
                const severityIssues = issues.filter(issue => issue.severity === severity);
                if (!severityIssues.length) return '';
                return `
                    <section class="issue-group" aria-label="${severity} findings">
                        <div class="issue-group-title"><span>${severity}</span><span>${severityIssues.length}</span></div>
                        ${severityIssues.map(issue => `
                            <article class="issue-card ${severity}">
                                <button class="issue-card-main" type="button" data-issue-index="${issues.indexOf(issue)}">
                                    <span class="issue-code">${escapeHtml(issue.code)}</span>
                                    <span class="issue-message">${escapeHtml(issue.message)}</span>
                                    ${issue.correctiveAction ? `<span class="issue-action-copy">${escapeHtml(issue.correctiveAction)}</span>` : ''}
                                </button>
                                ${issue.code === 'LAYOUT_DOES_NOT_FIT' && typeof this.cabinet.applyControlLayoutFitSuggestion === 'function'
                                    ? '<button class="issue-fix-button" type="button" data-fit-layout>Apply fitted suggestion</button>'
                                    : ''}
                            </article>
                        `).join('')}
                    </section>
                `;
            }).join('') : '<div class="preflight-empty">No fabrication issues found.</div>'}
        `;

        this.fabricationSummary.querySelectorAll('[data-issue-index]').forEach(button => {
            button.addEventListener('click', () => this.selectPreflightIssue(issues[Number(button.dataset.issueIndex)]));
        });
        this.fabricationSummary.querySelectorAll('[data-fit-layout]').forEach(button => {
            button.addEventListener('click', () => this.applyLayoutFitSuggestion());
        });
        if (this.exportIssueCount) {
            const blockingCount = counts.error + counts.warning;
            this.exportIssueCount.hidden = blockingCount === 0;
            this.exportIssueCount.textContent = String(blockingCount);
        }
        this.makerWorkflow?.onPreflightUpdated?.(issues);
        this.updateExportControls();
    }

    getPreflightResults(overrideResults = null) {
        const canUseCache = !Array.isArray(overrideResults);
        const panelRevision = this.cabinet.panelMeshes;
        const inclusionRevision = this.cabinet.params.fabricationInclusion;
        if (canUseCache
            && this.preflightResultsCache?.panelRevision === panelRevision
            && this.preflightResultsCache?.inclusionRevision === inclusionRevision) {
            return [...this.preflightResultsCache.results];
        }

        let results = overrideResults;
        if (!Array.isArray(results)) {
            try { results = this.cabinet.getPreflightResults?.(); } catch (error) { console.warn('Preflight failed', error); }
        }
        if (!Array.isArray(results)) results = legacyPreflightResults(this.cabinet.fabricationDiagnostics || {});
        const normalized = results.map(normalizePreflightResult).sort(comparePreflightResults);
        if (canUseCache) {
            this.preflightResultsCache = {
                panelRevision,
                inclusionRevision,
                results: normalized
            };
        }
        return [...normalized];
    }

    setPackageAttemptFindings(results = []) {
        this.packageAttemptFindings = (Array.isArray(results) ? results : [])
            .map(normalizePreflightResult)
            .sort(comparePreflightResults);
    }

    clearPackageAttemptFindings() {
        this.packageAttemptFindings = [];
    }

    getPackageAttemptFindings(baseIssues = [], sheetFindings = []) {
        const mandatoryKeys = new Set([
            ...baseIssues.map(findingIdentity),
            ...sheetFindings.map((item, index) => findingIdentity(normalizePreflightResult(item, index)))
        ]);
        const seen = new Set();
        return (this.packageAttemptFindings || []).filter(issue => {
            const key = findingIdentity(issue);
            if (mandatoryKeys.has(key) || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    selectPreflightIssue(issue) {
        if (!issue) return;
        let panelId = issue.partIds?.find(id => this.cabinet.getPanelById(id));
        if (!panelId && issue.partIds?.length) {
            const manifest = this.cabinet.getFabricationManifest?.();
            panelId = issue.partIds
                .map(id => manifest?.parts?.find(part => part.id === id)?.metadata?.parentPartId)
                .find(id => id && this.cabinet.getPanelById(id));
        }
        if (panelId) {
            this.selectPanel(panelId);
            this.app.frameSelected?.();
        }
        const issueParameter = issue.parameter || issue.field;
        if (issueParameter) {
            const parameter = String(issueParameter).replace(/^controls\./, '');
            const control = document.querySelector(
                `[data-param="${cssEscape(issueParameter)}"], [data-param="${cssEscape(parameter)}"], `
                + `[data-control-param="${cssEscape(issueParameter)}"], [data-control-param="${cssEscape(parameter)}"], `
                + `[data-control-param^="${cssEscape(parameter)}."]`
            );
            if (control) {
                const panel = control.closest('.tab-content');
                if (panel?.id) this.activateTab(panel.id.replace(/^tab-/, ''));
                window.setTimeout(() => control.focus(), 0);
            }
        }
        this.showNotification(panelId ? `Selected ${panelId}: ${issue.code}` : issue.code);
    }

    applyLayoutFitSuggestion() {
        if (typeof this.cabinet.applyControlLayoutFitSuggestion !== 'function') return;
        const applied = this.cabinet.applyControlLayoutFitSuggestion();
        if (applied === false) {
            this.showNotification('No fitted layout suggestion is available');
            return;
        }
        this.afterCabinetMutation('Apply fitted control layout');
        this.syncControlInputs(this.cabinet.params.controls);
        this.showNotification('Fitted control layout applied');
    }

    syncComponentControls() {
        const panel = this.activePanelId ? this.cabinet.getPanelById(this.activePanelId) : null;
        this.componentTuning.hidden = !panel;
        if (this.componentMaterialEditor) this.componentMaterialEditor.hidden = !panel;

        if (!panel) {
            if (this.componentVisibleToggle) {
                this.componentVisibleToggle.checked = true;
                this.componentVisibleToggle.disabled = true;
            }
            if (this.componentIncludedToggle) {
                this.componentIncludedToggle.checked = true;
                this.componentIncludedToggle.disabled = true;
            }
            Object.entries(this.componentControls).forEach(([key, input]) => {
                input.value = 0;
                input.disabled = true;
                this.updateComponentControlDisplay(key, 0);
                this.syncExactBinding(input, 0);
            });
            this.syncComponentColorPalette(DEFAULT_PANEL_COLOR);
            this.syncAdvancedComponentControls();
            return;
        }

        const override = panel.userData.override || {};
        const isProfilePanel = panel.userData.exportType === 'profile';
        if (this.componentVisibleToggle) {
            this.componentVisibleToggle.checked = this.cabinet.isPanelVisible?.(panel.userData.id) !== false;
            this.componentVisibleToggle.disabled = false;
        }
        if (this.componentIncludedToggle) {
            this.componentIncludedToggle.checked = this.cabinet.isPanelIncluded?.(panel.userData.id) !== false;
            this.componentIncludedToggle.disabled = typeof this.cabinet.setPanelIncluded !== 'function';
        }

        Object.entries(this.componentControls).forEach(([key, input]) => {
            const val = Number(override[key] || 0);
            input.value = val;
            input.disabled = isProfilePanel && (key === 'lengthDelta' || key === 'widthDelta');
            this.updateComponentControlDisplay(key, val);
            this.syncExactBinding(input, val);
        });

        this.syncComponentColorPalette(override.color || DEFAULT_PANEL_COLOR);
        this.syncAdvancedComponentControls();
    }

    getComponentScopePanelIds() {
        if (!this.activePanelId) return [];
        const scope = this.componentEditScope?.value || 'selected';
        if (scope === 'selected') return [this.activePanelId];
        return this.cabinet.panelMeshes
            .filter(mesh => {
                if (scope === 'all') return true;
                if (scope === 'structural') return mesh.userData.isStructural === true;
                if (scope === 'shell') return mesh.userData.isStructural !== true;
                return mesh.userData.id === this.activePanelId;
            })
            .map(mesh => mesh.userData.id);
    }

    applyComponentMaterial(materialId) {
        const ids = this.getComponentScopePanelIds();
        if (!ids.length) return;
        const settings = this.cabinet.params.fabricationSettings ||= {};
        const assignments = settings.materialAssignments ||= {};
        const material = (this.cabinet.params.materials || []).find(item => item.id === materialId);
        const overrides = cloneParams(this.cabinet.params.componentOverrides || {});
        ids.forEach(panelId => {
            if (!materialId) delete assignments[panelId];
            else assignments[panelId] = materialId;
            if (!material) return;
            const current = this.cabinet.resolveComponentOverride(panelId);
            overrides[panelId] = {
                ...current,
                thicknessDelta: Number(material.measuredThicknessMm) - Number(this.cabinet.params.thickness || 18)
            };
        });
        this.cabinet.params.componentOverrides = overrides;
        this.cabinet.build();
        this.afterCabinetMutation('Assign panel material');
        this.showNotification(material ? `${material.name} assigned to ${ids.length} panel${ids.length === 1 ? '' : 's'}` : 'Automatic material matching restored');
    }

    syncAdvancedComponentControls() {
        const panel = this.activePanelId ? this.cabinet.getPanelById(this.activePanelId) : null;
        if (!this.componentMaterialSelect || !this.componentFastenerGroup || !this.componentFastenerList) return;
        const disabled = !panel;
        this.componentEditScope.disabled = disabled;
        this.componentMaterialSelect.disabled = disabled;
        if (this.btnManageMaterials) this.btnManageMaterials.disabled = disabled;
        if (this.btnOpenSelectedSheet) this.btnOpenSelectedSheet.disabled = disabled;
        this.btnClearFastenerGroup.disabled = disabled;

        const materials = this.cabinet.params.materials || [];
        const assignment = panel
            ? this.cabinet.params.fabricationSettings?.materialAssignments?.[panel.userData.id] || ''
            : '';
        this.componentMaterialSelect.innerHTML = [
            '<option value="">Automatic by thickness</option>',
            ...materials.map(material => `<option value="${escapeHtml(material.id)}">${escapeHtml(material.name)} · ${escapeHtml(this.formatLength(material.measuredThicknessMm))}</option>`)
        ].join('');
        this.componentMaterialSelect.value = assignment;
        const assignedMaterial = materials.find(material => material.id === assignment);
        if (this.componentMaterialSummary) {
            const currency = this.cabinet.params.fabricationSettings?.currencyCode || 'GBP';
            this.componentMaterialSummary.innerHTML = assignedMaterial
                ? `<strong>${escapeHtml(assignedMaterial.name)}</strong><br>${escapeHtml(this.formatLength(assignedMaterial.measuredThicknessMm))} measured, ${escapeHtml(this.formatLength(assignedMaterial.sheetWidthMm))} x ${escapeHtml(this.formatLength(assignedMaterial.sheetHeightMm))} stock, ${escapeHtml(currency)} ${Number(assignedMaterial.pricePerSheet || 0).toFixed(2)} per sheet.`
                : disabled
                    ? 'Select a panel to assign material and inspect its stock plan.'
                    : 'Automatic matching uses the closest measured material thickness.';
        }
        const scopedIds = this.getComponentScopePanelIds();
        if (this.componentScopePreview) {
            const names = scopedIds
                .map(panelId => this.cabinet.getPanelById(panelId)?.userData?.name || panelId)
                .slice(0, 3);
            const remaining = Math.max(0, scopedIds.length - names.length);
            this.componentScopePreview.textContent = disabled
                ? 'Select a panel to preview the edit scope.'
                : `${scopedIds.length} panel${scopedIds.length === 1 ? '' : 's'} will change: ${names.join(', ')}${remaining ? `, plus ${remaining} more` : ''}.`;
        }

        const groupOverride = panel ? this.cabinet.params.fastenerGroupOverrides?.[panel.userData.id] || {} : {};
        const defaults = {
            diameterMm: Number(this.cabinet.params.screwDiameter) || 4,
            lengthMm: Number(this.cabinet.params.screwLength) || 42,
            edgeClearanceMm: Number(this.cabinet.params.screwEdgeClearance) || 24,
            minCenterSpacingMm: Number(this.cabinet.params.screwMinSpacing) || 30
        };
        this.componentFastenerGroup.querySelectorAll('[data-fastener-group-param]').forEach(input => {
            const key = input.dataset.fastenerGroupParam;
            input.value = groupOverride[key] ?? defaults[key];
            input.disabled = disabled;
            input.classList.toggle('overridden', groupOverride[key] != null);
        });

        const fasteners = panel?.userData.fasteners || [];
        this.componentFastenerList.innerHTML = fasteners.length
            ? fasteners.map(fastener => {
                const override = this.cabinet.params.fastenerOverrides?.[fastener.id] || {};
                return `<div class="individual-fastener-row">
                    <div><strong>${escapeHtml(fastener.side)} · ${escapeHtml(fastener.targetPanelName)}</strong><span>${escapeHtml(fastener.id)}</span></div>
                    <label>Diameter (mm)<input type="number" min="1.5" max="12" step="0.5" value="${override.diameterMm ?? fastener.diameterMm}" data-fastener-id="${escapeHtml(fastener.id)}" data-fastener-param="diameterMm"></label>
                    <label>Length (mm)<input type="number" min="8" max="180" step="1" value="${override.lengthMm ?? fastener.lengthMm}" data-fastener-id="${escapeHtml(fastener.id)}" data-fastener-param="lengthMm"></label>
                    <button class="btn btn-secondary btn-sm" type="button" data-reset-fastener-id="${escapeHtml(fastener.id)}" ${Object.keys(override).length ? '' : 'disabled'}>Reset</button>
                </div>`;
            }).join('')
            : '<div class="section-hint">This panel has no side screws.</div>';
    }

    syncComponentColorPalette(color) {
        if (!this.componentColorPalette) return;
        const active = String(color || DEFAULT_PANEL_COLOR).toLowerCase();
        this.componentColorPalette.querySelectorAll('.color-chip').forEach(chip => {
            const selected = chip.dataset.color === active;
            chip.classList.toggle('active', selected);
            chip.setAttribute('aria-pressed', String(selected));
        });
    }

    updateDecalPanelState() {
        const panel = this.activePanelId ? this.cabinet.getPanelById(this.activePanelId) : null;
        const hint = this.decalBox.querySelector('.section-hint');

        if (panel) {
            this.decalPanelActive.hidden = false;
            if (hint) hint.hidden = true;
            this.decalSliders.hidden = true;
            this.updateDecalList();
        } else {
            this.decalPanelActive.hidden = true;
            if (hint) hint.hidden = false;
            this.activeDecalList.innerHTML = '';
            this.decalSliders.hidden = true;
        }
    }

    updateDecalList() {
        this.activeDecalList.innerHTML = '';
        if (!this.activePanelId) return;

        const decals = this.cabinet.decals[this.activePanelId] || [];
        if (decals.length === 0) {
            this.activeDecalList.innerHTML = '<div class="section-hint">No artwork on this panel</div>';
            return;
        }

        decals.forEach(decal => {
            const item = document.createElement('div');
            item.className = 'decal-item';
            if (decal.id === this.activeDecalId) item.classList.add('selected');

            item.innerHTML = `
                <div>
                    <img src="${decal.imageSrc}" class="decal-thumb" alt="">
                    <span>Artwork ${decal.scale}%</span>
                </div>
                <span>${decal.rotation} deg</span>
            `;

            item.addEventListener('click', () => {
                this.selectDecal(decal.id);
            });

            this.activeDecalList.appendChild(item);
        });
    }

    selectDecal(decalId) {
        this.activeDecalId = decalId;
        this.updateDecalList();

        const decal = this.cabinet.getDecal(this.activePanelId, decalId);
        if (!decal) return;

        this.decalSliders.hidden = false;

        document.getElementById('decal-pos-x').value = decal.x;
        document.getElementById('decal-pos-y').value = decal.y;
        document.getElementById('decal-scale').value = decal.scale;
        document.getElementById('decal-rotation').value = decal.rotation;

        document.getElementById('val-decal-pos-x').textContent = `${decal.x}%`;
        document.getElementById('val-decal-pos-y').textContent = `${decal.y}%`;
        document.getElementById('val-decal-scale').textContent = `${decal.scale}%`;
        document.getElementById('val-decal-rotation').textContent = `${decal.rotation} deg`;
    }

    syncAllSliders(params) {
        Object.entries(params).forEach(([key, val]) => {
            const slider = this.sliders[key];
            if (slider) {
                if (slider.type === 'checkbox') {
                    slider.checked = Boolean(val);
                } else {
                    slider.value = val;
                    this.updateSliderValueDisplay(key, val);
                    this.syncExactBinding(slider, val);
                }
            }
        });

        if (this.sliders.dummyHeight) {
            const val = parseFloat(this.sliders.dummyHeight.value);
            this.updateSliderValueDisplay('dummyHeight', val);
            this.syncExactBinding(this.sliders.dummyHeight, val);
        }
    }

    showNotification(message, options = {}) {
        if (this.statusService) return this.statusService.notify(message, options);
        const hud = document.getElementById('hud-message');
        if (hud) hud.textContent = message;
        return null;
    }

    beginOperation(key, controls = [], message = 'Working...') {
        if (this.activeOperations.has(key)) {
            this.showNotification('That operation is already in progress.', {
                severity: 'information',
                title: 'Still working'
            });
            return false;
        }
        this.activeOperations.add(key);
        controls.filter(Boolean).forEach(control => {
            control.disabled = true;
            control.setAttribute('aria-busy', 'true');
        });
        this.statusService?.begin(key, message, { title: 'Working' });
        return true;
    }

    endOperation(key, controls = []) {
        this.activeOperations.delete(key);
        controls.filter(Boolean).forEach(control => {
            control.disabled = false;
            control.removeAttribute('aria-busy');
        });
        if (String(key).startsWith('export-')) this.updateExportControls();
    }

    renderExportReceipt(kind, result = {}, deliveryResult = null) {
        if (!this.exportReceipt || !this.exportReceiptSummary || !this.exportReceiptDetails) return;
        const outputName = kind === 'draft'
            ? 'Annotated draft'
            : kind === 'package'
                ? 'Fabrication package'
                : 'Production drawing';
        const fileName = deliveryResult?.path?.split(/[\\/]/).pop() || result.filename || 'Exported file';
        const binaryBase64 = result?.package?.base64 || result?.base64;
        const contentLength = typeof result.content === 'string'
            ? utf8ByteLength(result.content)
            : typeof binaryBase64 === 'string'
                ? Math.floor(binaryBase64.length * 0.75)
                : null;
        const formattedSize = Number.isFinite(contentLength)
            ? contentLength < 1024
                ? `${contentLength} bytes`
                : contentLength < 1024 * 1024
                    ? `${(contentLength / 1024).toFixed(1)} KB`
                    : `${(contentLength / (1024 * 1024)).toFixed(1)} MB`
            : null;
        this.exportReceiptSummary.textContent = `${outputName} is ready.`;
        this.exportReceiptDetails.replaceChildren();
        const addReceiptDetail = (label, value) => {
            if (!value) return;
            const term = document.createElement('dt');
            term.textContent = label;
            const description = document.createElement('dd');
            description.textContent = value;
            this.exportReceiptDetails.append(term, description);
        };
        addReceiptDetail('File', fileName);
        addReceiptDetail('Size', formattedSize);
        addReceiptDetail('Created', new Date().toLocaleString());
        this.exportReceipt.hidden = false;

        const exportedPath = deliveryResult?.path || null;
        if (this.btnOpenExportFolder) {
            this.btnOpenExportFolder.hidden = !exportedPath || !isDesktopAvailable();
            this.btnOpenExportFolder.onclick = exportedPath
                ? async () => {
                    try {
                        await requestDesktop('shell.openFolder', { path: exportedPath });
                    } catch (error) {
                        this.reportLifecycleFailure('Export folder could not be opened', error);
                    }
                }
                : null;
        }
        if (this.btnOpenBeforeCut) {
            this.btnOpenBeforeCut.onclick = () => {
                this.exportDialog?.close();
                void this.ensureHelpSystem().then(help => help?.openTopic?.('before-you-cut'));
            };
        }
    }

    reportLifecycleFailure(title, error, { severity = 'error' } = {}) {
        const message = error?.message || String(error || 'Unknown error');
        const detail = {
            status: severity,
            persistent: true,
            title: String(title || 'Project lifecycle issue'),
            message,
            timestamp: new Date().toISOString()
        };
        if (severity === 'warning') console.warn(detail.title, message);
        else console.error(detail.title, message);
        this.statusService?.notify(message, {
            severity,
            persistent: true,
            title: detail.title,
            detail: detail.timestamp
        });
        emitLifecycleEvent('lifecycle-status', detail);
        return detail;
    }

    formatPanelSize(ud) {
        const type = ud.exportType === 'profile' ? 'profile' : 'rect';
        if (this.unitMode === 'in') {
            return `${trimNumber(Number(ud.width) / MM_PER_INCH, 3)} × ${trimNumber(Number(ud.length) / MM_PER_INCH, 3)} × ${trimNumber(Number(ud.thickness) / MM_PER_INCH, 3)} in ${type}`;
        }
        return `${trimNumber(ud.width, 2)} × ${trimNumber(ud.length, 2)} × ${trimNumber(ud.thickness, 2)} mm ${type}`;
    }

    formatLength(value) {
        return this.unitMode === 'in'
            ? `${trimNumber(Number(value) / MM_PER_INCH, 3)} in`
            : `${trimNumber(value, 2)} mm`;
    }

    formatOverrideSummary(override = {}) {
        const active = Object.entries(COMPONENT_OVERRIDE_DEFINITIONS)
            .filter(([key]) => key !== 'color')
            .map(([key]) => [key, Number(override[key] || 0)])
            .filter(([, value]) => value !== 0)
            .map(([key, value]) => `${key} ${value > 0 ? '+' : ''}${value}`);

        if (override.color && override.color !== DEFAULT_PANEL_COLOR) {
            active.push(`color ${override.color}`);
        }

        return active.length ? active.join(', ') : 'none';
    }

    formatJointSummary(joints = []) {
        if (!joints.length) return 'none';
        const visibleJoints = joints
            .slice(0, 3)
            .map(joint => `${joint.pointName}: ${joint.type}`);
        const remainingCount = joints.length - visibleJoints.length;
        return `${visibleJoints.join(', ')}${remainingCount > 0 ? `; +${remainingCount} more` : ''}`;
    }

    formatInvalidIntersectionSummary(records = []) {
        if (!records.length) return 'none';
        return records
            .slice(0, 2)
            .map(record => `${record.names.join(' / ')} ${record.penetrationMm} mm`)
            .join('; ');
    }

    formatFastenerIssueSummary(records = []) {
        if (!records.length) return 'none';
        return records
            .slice(0, 2)
            .map(record => record.message)
            .join('; ');
    }

    formatWarningSummary(warnings = []) {
        if (!warnings.length) return 'none';
        return warnings.slice(0, 2).join('; ');
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getNestedValue(source, path) {
    return String(path)
        .split('.')
        .reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function setNestedValue(target, path, value) {
    const keys = String(path).split('.');
    let cursor = target;
    keys.slice(0, -1).forEach(key => {
        if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
        cursor = cursor[key];
    });
    cursor[keys[keys.length - 1]] = value;
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
}

function decimalPlaces(value) {
    const text = String(value);
    if (/e-/i.test(text)) return Number(text.split(/e-/i)[1]) || 0;
    return (text.split('.')[1] || '').length;
}

function trimNumber(value, precision = 3) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    return numeric.toFixed(Math.max(0, precision)).replace(/(\.\d*?[1-9])0+$|\.0+$/g, '$1');
}

function readStoredUnitMode() {
    try {
        return window.localStorage.getItem('cabinet-crafter:units') === 'in' ? 'in' : 'mm';
    } catch (_) {
        return 'mm';
    }
}

function readStoredTheme() {
    try {
        const stored = window.localStorage.getItem('cabinet-crafter:theme');
        if (stored === 'dark' || stored === 'light') return stored;
    } catch (_) { /* optional storage */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

function sanitizeProjectName(value) {
    return String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function stableStringify(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, current) => {
        if (key === 'imageElement') return undefined;
        if (!current || typeof current !== 'object') return current;
        if (seen.has(current)) return undefined;
        seen.add(current);
        if (Array.isArray(current)) return current;
        return Object.keys(current).sort().reduce((sorted, property) => {
            sorted[property] = current[property];
            return sorted;
        }, {});
    });
}

function domToken(value) {
    return String(value || 'item').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function capitalizeLabel(value) {
    const label = String(value || 'element').replace(/_/g, ' ');
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function sceneToggleRow(id, type, label, checked, status) {
    return `<li>
        <div class="scene-tree-row">
            <input id="${escapeHtml(id)}" type="checkbox" data-scene-visibility="${escapeHtml(type)}" ${checked ? 'checked' : ''} aria-label="Show ${escapeHtml(label)} in viewport">
            <label class="scene-tree-label" for="${escapeHtml(id)}">${escapeHtml(label)}</label>
            <span class="scene-tree-meta">${escapeHtml(status)}</span>
        </div>
    </li>`;
}

function sceneStatusRow(label, counts = {}) {
    const total = Math.max(0, Number(counts.total) || 0);
    const visible = Math.max(0, Math.min(total, Number(counts.visible) || 0));
    return `<li>
        <div class="scene-tree-row">
            <span class="scene-tree-status-marker" aria-hidden="true">i</span>
            <span class="scene-tree-label">${escapeHtml(label)}</span>
            <span class="scene-tree-meta">${visible} of ${total} shown</span>
        </div>
    </li>`;
}

function snapshotDecals(decals = {}) {
    const snapshot = {};
    Object.entries(decals || {}).forEach(([panelId, items]) => {
        snapshot[panelId] = (items || []).map(item => ({
            id: item.id,
            imageSrc: item.imageSrc,
            imageElement: item.imageElement,
            x: Number(item.x) || 0,
            y: Number(item.y) || 0,
            scale: Number(item.scale) || 50,
            rotation: Number(item.rotation) || 0
        }));
    });
    return snapshot;
}

function restoreDecalSnapshot(snapshot = {}) {
    const decals = {};
    Object.entries(snapshot || {}).forEach(([panelId, items]) => {
        decals[panelId] = (items || []).map(item => {
            let imageElement = item.imageElement;
            if (!imageElement && item.imageSrc) {
                imageElement = new Image();
                imageElement.src = item.imageSrc;
            }
            return { ...item, imageElement };
        });
    });
    return decals;
}

function decalJsonReplacer(key, value) {
    return key === 'imageElement' ? undefined : value;
}

function normalizePreflightResult(result = {}, index = 0) {
    const severityCandidate = String(result.severity || 'info').toLowerCase();
    const severity = ['error', 'warning', 'info'].includes(severityCandidate) ? severityCandidate : 'info';
    const rawPartIds = result.partIds || result.affectedPartIds || result.panelIds || (result.panelId ? [result.panelId] : []);
    return {
        code: String(result.code || `PREFLIGHT_${index + 1}`).toUpperCase().replace(/[^A-Z0-9_-]/g, '_'),
        severity,
        partIds: Array.isArray(rawPartIds) ? rawPartIds.map(String) : [String(rawPartIds)],
        parameter: result.parameter || result.responsibleParameter || '',
        operationId: result.operationId || result.operation || '',
        location: result.location || null,
        message: String(result.message || result.description || 'Fabrication check returned a finding.'),
        correctiveAction: typeof result.correctiveAction === 'string'
            ? result.correctiveAction
            : String(result.correctiveAction?.message || result.action || ''),
        details: result.details || null
    };
}

function legacyPreflightResults(diagnostics = {}) {
    const results = [];
    (diagnostics.invalidIntersections || []).forEach((record, index) => {
        results.push({
            code: record.code || `STRUCTURAL_COLLISION_${index + 1}`,
            severity: 'error',
            partIds: record.panelIds || record.ids || [],
            message: record.message || 'Structural panels collide.',
            correctiveAction: 'Adjust the cabinet profile or affected component offsets.'
        });
    });
    (diagnostics.fastenerIssues || []).forEach((record, index) => {
        results.push({
            code: record.code || `FASTENER_CLEARANCE_${index + 1}`,
            severity: 'error',
            partIds: record.panelIds || (record.panelId ? [record.panelId] : []),
            message: record.message || 'A fastener does not meet fabrication clearances.',
            correctiveAction: 'Adjust fastener size, spacing, or edge clearance.'
        });
    });
    (diagnostics.warnings || []).forEach((warning, index) => {
        results.push({
            code: `LEGACY_WARNING_${index + 1}`,
            severity: 'warning',
            message: typeof warning === 'string' ? warning : warning.message,
            partIds: warning?.panelIds || []
        });
    });
    return results;
}

function countSeverities(results = []) {
    return results.reduce((counts, result) => {
        counts[result.severity] = (counts[result.severity] || 0) + 1;
        return counts;
    }, { error: 0, warning: 0, info: 0 });
}

function comparePreflightResults(a, b) {
    const rank = { error: 0, warning: 1, info: 2 };
    return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3)
        || a.code.localeCompare(b.code)
        || a.message.localeCompare(b.message);
}

function findingIdentity(result = {}) {
    const partIds = Array.isArray(result.partIds) ? [...result.partIds].map(String).sort().join(',') : '';
    return `${result.code || ''}|${result.severity || ''}|${partIds}|${result.message || ''}`;
}

function createRecoveryId() {
    const randomId = globalThis.crypto?.randomUUID?.();
    if (randomId) return randomId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    return `recovery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function normalizeRecoveryDescriptor(value = {}) {
    const savedAtValue = value.savedAt || value.timestamp || null;
    const savedAt = Number.isNaN(Date.parse(savedAtValue || ''))
        ? null
        : new Date(savedAtValue).toISOString();
    return {
        recoveryId: String(value.recoveryId || ''),
        projectName: sanitizeProjectName(value.projectName) || DEFAULT_PROJECT_NAME,
        sourcePath: value.sourcePath ? String(value.sourcePath) : null,
        savedAt,
        sizeBytes: Math.max(0, Number(value.sizeBytes) || 0)
    };
}

function emitLifecycleEvent(type, detail = {}) {
    if (typeof globalThis.window?.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
    const eventDetail = { type: String(type || 'status'), ...detail };
    globalThis.window.dispatchEvent(new CustomEvent('cabinetcrafter:lifecycle', { detail: eventDetail }));
    globalThis.window.dispatchEvent(new CustomEvent(`cabinetcrafter:${eventDetail.type}`, { detail: eventDetail }));
}

function formatRecoveryTime(timestamp) {
    if (!timestamp) return 'autosaved previously';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'autosaved previously';
    return `autosaved ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function formatByteSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return `${Math.round(bytes)} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function learningStepRationale(stepId) {
    const rationales = {
        'choose-preset': 'A preset gives you a known-good structure while keeping every important dimension editable.',
        'save-project': 'Saving early gives the project a clear recovery point before detailed work begins.',
        'set-envelope': 'Width, height, and depth drive the cabinet profile, support geometry, material use, and hardware clearances.',
        'inspect-model': 'Checking the model from several angles catches fit and access problems that a single view can hide.',
        'choose-controls': 'Control layout affects ergonomics, cutout spacing, wiring access, and support loading.',
        'inspect-panel': 'The inspector shows the effective settings that fabrication and export will actually use.',
        'inspect-hardware': 'Hardware checks make physical dimensions and service keepouts visible before machining.',
        'review-design': 'Review separates blocking errors from warnings and points you toward the setting that needs attention.',
        'generate-sheets': 'A validated sheet plan proves that included parts fit the chosen stock with the required spacing and margins.',
        'export-draft': 'The annotated draft is a safe checking artifact and remains distinct from production-ready output.',
        'before-you-cut': 'A final stock, scale, toolpath, hold-down, and safety check prevents avoidable workshop mistakes.'
    };
    return rationales[stepId] || 'This step builds a repeatable habit for safe cabinet design and fabrication.';
}

function isDesktopAvailable() {
    return globalThis.window?.cabinetDesktop?.available === true;
}

function getBinaryExportPayload(result) {
    const base64 = result?.package?.base64 || result?.base64;
    if (typeof base64 === 'string' && base64) return base64;
    const bytes = result?.package?.zipBytes || result?.zipBytes;
    if (!bytes) throw new Error('The fabrication package did not contain ZIP data.');
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return window.btoa(binary);
}
