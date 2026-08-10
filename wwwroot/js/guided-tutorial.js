export const LEARNING_SCHEMA_VERSION = 2;
export const INTERFACE_TOUR_ID = 'interface-tour';
export const INTERFACE_TOUR_VERSION = 2;
export const FIRST_CABINET_LESSON_ID = 'first-cabinet';
export const LEARNING_ACTIONS = Object.freeze({
    PRESET_SELECTED: 'preset.selected',
    PROJECT_SAVED: 'project.saved',
    PARAMETER_CHANGED: 'parameter.changed',
    VIEWPORT_ORBITED: 'viewport.orbit',
    VIEWPORT_FITTED: 'viewport.fit',
    CONTROL_LAYOUT_SELECTED: 'controls.layout.selected',
    PANEL_SELECTED: 'panel.selected',
    HARDWARE_INSPECTED: 'hardware.inspected',
    REVIEW_INSPECTED: 'review.inspected',
    SHEETS_GENERATED: 'sheets.generated',
    EXPORT_COMPLETED: 'export.completed',
    HELP_TOPIC_OPENED: 'help.topic.opened'
});

const COMPLETION_KEY = 'cabinet-crafter:interface-tour-complete:v2';
const LEGACY_COMPLETION_KEY = 'cabinet-crafter:tutorial-complete:v1';
const TOUR_PROGRESS_KEY = 'cabinet-crafter:interface-tour-progress:v2';
const LESSON_PROGRESS_PREFIX = 'cabinet-crafter:learning-progress:v2:';
const PROMPT_PREFERENCE_KEY = 'cabinet-crafter:tutorial-prompt:v1';
const REMINDER_KEY = 'cabinet-crafter:tutorial-remind-after:v1';
const PROMPT_DISMISSED = 'dismissed';
const REMINDER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export const FIRST_CABINET_LESSON = Object.freeze({
    id: FIRST_CABINET_LESSON_ID,
    version: 1,
    title: 'Build your first cabinet',
    description: 'Complete a safe practice project from preset selection to an annotated draft export.',
    estimatedMinutes: 15,
    requiresPracticeProject: true,
    steps: Object.freeze([
        Object.freeze({
            id: 'choose-preset',
            title: 'Choose a starting cabinet',
            copy: 'Choose Standard or Bar-top. The lesson waits until a preset has actually been selected.',
            requirements: Object.freeze([
                Object.freeze({ id: 'preset', event: LEARNING_ACTIONS.PRESET_SELECTED })
            ])
        }),
        Object.freeze({
            id: 'save-project',
            title: 'Name and save the practice project',
            copy: 'Give the practice project a clear name and save it before making detailed changes.',
            requirements: Object.freeze([
                Object.freeze({ id: 'saved', event: LEARNING_ACTIONS.PROJECT_SAVED, match: Object.freeze({ saved: true }) })
            ])
        }),
        Object.freeze({
            id: 'set-envelope',
            title: 'Set the cabinet envelope',
            copy: 'Enter exact values for width, height, and depth so the relationship between sliders and exact entry is clear.',
            requirements: Object.freeze([
                Object.freeze({
                    id: 'dimensions',
                    event: LEARNING_ACTIONS.PARAMETER_CHANGED,
                    match: Object.freeze({ section: 'structure' }),
                    evidenceField: 'parameter',
                    requiredValues: Object.freeze(['width', 'height', 'depth'])
                })
            ])
        }),
        Object.freeze({
            id: 'inspect-model',
            title: 'Inspect the live model',
            copy: 'Orbit the model, then fit it to the viewport.',
            requirements: Object.freeze([
                Object.freeze({ id: 'orbit', event: LEARNING_ACTIONS.VIEWPORT_ORBITED }),
                Object.freeze({ id: 'fit', event: LEARNING_ACTIONS.VIEWPORT_FITTED })
            ])
        }),
        Object.freeze({
            id: 'choose-controls',
            title: 'Choose a control layout',
            copy: 'Open Controls and choose a layout that suits the practice cabinet.',
            requirements: Object.freeze([
                Object.freeze({ id: 'layout', event: LEARNING_ACTIONS.CONTROL_LAYOUT_SELECTED })
            ])
        }),
        Object.freeze({
            id: 'inspect-panel',
            title: 'Inspect a panel',
            copy: 'Select a panel and review its effective material, thickness, visibility, and fabrication state.',
            requirements: Object.freeze([
                Object.freeze({ id: 'panel', event: LEARNING_ACTIONS.PANEL_SELECTED })
            ])
        }),
        Object.freeze({
            id: 'inspect-hardware',
            title: 'Inspect detected hardware',
            copy: 'Open Hardware and inspect at least one detected component or fit result.',
            requirements: Object.freeze([
                Object.freeze({ id: 'hardware', event: LEARNING_ACTIONS.HARDWARE_INSPECTED })
            ])
        }),
        Object.freeze({
            id: 'review-design',
            title: 'Review fabrication readiness',
            copy: 'Open Review and inspect the current status or one finding. Learning progress does not confirm the review stage.',
            requirements: Object.freeze([
                Object.freeze({ id: 'review', event: LEARNING_ACTIONS.REVIEW_INSPECTED })
            ])
        }),
        Object.freeze({
            id: 'generate-sheets',
            title: 'Generate a sheet plan',
            copy: 'Generate a valid sheet plan and inspect the selected candidate.',
            requirements: Object.freeze([
                Object.freeze({ id: 'sheets', event: LEARNING_ACTIONS.SHEETS_GENERATED, match: Object.freeze({ valid: true }) })
            ])
        }),
        Object.freeze({
            id: 'export-draft',
            title: 'Export an annotated draft',
            copy: 'Create an annotated draft for checking. Production output remains governed by the normal workflow checks.',
            requirements: Object.freeze([
                Object.freeze({ id: 'draft', event: LEARNING_ACTIONS.EXPORT_COMPLETED, match: Object.freeze({ output: 'annotated-draft' }) })
            ])
        }),
        Object.freeze({
            id: 'before-you-cut',
            title: 'Read Before You Cut',
            copy: 'Open the fabrication safety guidance before completing the lesson.',
            requirements: Object.freeze([
                Object.freeze({ id: 'safety', event: LEARNING_ACTIONS.HELP_TOPIC_OPENED, match: Object.freeze({ topic: 'before-you-cut' }) })
            ])
        })
    ])
});

function clonePlain(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function getDefaultStorage() {
    try { return globalThis.window?.localStorage ?? null; } catch (_) { return null; }
}

function matchesExpected(detail, expected = {}) {
    return Object.entries(expected).every(([key, value]) => {
        const actual = detail?.[key];
        return Array.isArray(value) ? value.includes(actual) : actual === value;
    });
}

function createInitialLessonProgress(definition, now, practiceSessionId) {
    const steps = Object.fromEntries(definition.steps.map((step, index) => [
        step.id,
        {
            status: index === 0 ? 'in-progress' : 'pending',
            evidence: {}
        }
    ]));
    return {
        schemaVersion: LEARNING_SCHEMA_VERSION,
        lessonId: definition.id,
        lessonVersion: definition.version,
        status: 'in-progress',
        stepIndex: 0,
        steps,
        practiceProject: Boolean(definition.requiresPracticeProject),
        practiceSessionId: practiceSessionId || null,
        startedAt: now,
        updatedAt: now,
        completedAt: null
    };
}

export class LearningPathController {
    constructor({
        storage = getDefaultStorage(),
        now = () => Date.now(),
        definitions = [FIRST_CABINET_LESSON],
        onChange = null
    } = {}) {
        this.storage = storage;
        this.now = now;
        this.definitions = new Map(definitions.map(definition => [definition.id, definition]));
        this.listeners = new Set();
        this.activeLessonId = null;
        if (typeof onChange === 'function') this.listeners.add(onChange);
    }

    listLessons() {
        return Array.from(this.definitions.values()).map(definition => ({
            id: definition.id,
            version: definition.version,
            title: definition.title,
            description: definition.description,
            estimatedMinutes: definition.estimatedMinutes,
            requiresPracticeProject: Boolean(definition.requiresPracticeProject),
            progress: this.getProgress(definition.id)
        }));
    }

    getDefinition(lessonId) {
        return this.definitions.get(lessonId) || null;
    }

    getProgress(lessonId) {
        const definition = this.requireDefinition(lessonId);
        const stored = this.readJson(this.progressKey(lessonId));
        if (!stored
            || stored.schemaVersion !== LEARNING_SCHEMA_VERSION
            || stored.lessonId !== definition.id
            || stored.lessonVersion !== definition.version
            || !['in-progress', 'paused', 'completed'].includes(stored.status)
            || !Number.isInteger(stored.stepIndex)
            || stored.stepIndex < 0
            || stored.stepIndex >= definition.steps.length
            || !stored.steps
            || definition.steps.some(step => !stored.steps[step.id])) {
            return null;
        }
        return clonePlain(stored);
    }

    getCurrentStep(lessonId = this.activeLessonId) {
        if (!lessonId) return null;
        const definition = this.requireDefinition(lessonId);
        const progress = this.getProgress(lessonId);
        if (!progress) return null;
        return {
            definition: clonePlain(definition.steps[progress.stepIndex]),
            progress: clonePlain(progress.steps[definition.steps[progress.stepIndex].id]),
            stepIndex: progress.stepIndex,
            stepCount: definition.steps.length,
            lessonStatus: progress.status
        };
    }

    startLesson(lessonId, { restart = false, practiceProject = false, practiceSessionId = null } = {}) {
        const definition = this.requireDefinition(lessonId);
        const stored = restart ? null : this.getProgress(lessonId);
        if (stored && stored.status !== 'completed') {
            stored.status = 'in-progress';
            stored.updatedAt = this.now();
            this.activeLessonId = lessonId;
            return this.persist(definition, stored, 'resumed');
        }
        if (definition.requiresPracticeProject && (!practiceProject || !practiceSessionId)) {
            throw new Error('This lesson requires an isolated practice project and a restoration session ID.');
        }
        const progress = createInitialLessonProgress(definition, this.now(), practiceSessionId);
        this.activeLessonId = lessonId;
        return this.persist(definition, progress, restart ? 'restarted' : 'started');
    }

    resumeLesson(lessonId) {
        const progress = this.getProgress(lessonId);
        if (!progress || progress.status === 'completed') return null;
        progress.status = 'in-progress';
        progress.updatedAt = this.now();
        this.activeLessonId = lessonId;
        return this.persist(this.requireDefinition(lessonId), progress, 'resumed');
    }

    restartLesson(lessonId, options = {}) {
        const previous = this.getProgress(lessonId);
        return this.startLesson(lessonId, {
            practiceProject: options.practiceProject ?? previous?.practiceProject ?? false,
            practiceSessionId: options.practiceSessionId ?? previous?.practiceSessionId ?? null,
            restart: true
        });
    }

    resetLesson(lessonId) {
        const definition = this.requireDefinition(lessonId);
        try { this.storage?.removeItem?.(this.progressKey(lessonId)); } catch (_) { /* optional storage */ }
        if (this.activeLessonId === lessonId) this.activeLessonId = null;
        this.listeners.forEach(listener => {
            try {
                listener({
                    change: 'reset',
                    lesson: clonePlain(definition),
                    progress: null,
                    currentStep: null
                });
            } catch (_) {
                // A presentation listener cannot interrupt a reset.
            }
        });
        return true;
    }

    exitLesson(lessonId = this.activeLessonId) {
        if (!lessonId) return null;
        const progress = this.getProgress(lessonId);
        if (!progress || progress.status === 'completed') return progress;
        progress.status = 'paused';
        progress.updatedAt = this.now();
        if (this.activeLessonId === lessonId) this.activeLessonId = null;
        return this.persist(this.requireDefinition(lessonId), progress, 'paused');
    }

    recordAction(event, detail = {}, { lessonId = this.activeLessonId } = {}) {
        if (!lessonId || typeof event !== 'string' || !event.trim()) {
            return { accepted: false, reason: 'no-active-lesson' };
        }
        const definition = this.requireDefinition(lessonId);
        const progress = this.getProgress(lessonId);
        if (!progress || progress.status !== 'in-progress') {
            return { accepted: false, reason: 'lesson-not-active', progress };
        }
        const step = definition.steps[progress.stepIndex];
        const stepProgress = progress.steps[step.id];
        let accepted = false;

        step.requirements.forEach(requirement => {
            if (requirement.event !== event || !matchesExpected(detail, requirement.match)) return;
            if (requirement.requiredValues?.length) {
                const evidenceValue = detail?.[requirement.evidenceField];
                if (!requirement.requiredValues.includes(evidenceValue)) return;
                accepted = true;
                const evidence = new Set(stepProgress.evidence[requirement.id] || []);
                evidence.add(evidenceValue);
                stepProgress.evidence[requirement.id] = Array.from(evidence);
            } else {
                accepted = true;
                stepProgress.evidence[requirement.id] = true;
            }
        });

        if (!accepted) return { accepted: false, reason: 'action-not-required', progress };
        progress.updatedAt = this.now();
        const stepComplete = step.requirements.every(requirement => {
            const evidence = stepProgress.evidence[requirement.id];
            if (!requirement.requiredValues?.length) return evidence === true;
            return requirement.requiredValues.every(value => evidence?.includes(value));
        });
        if (!stepComplete) {
            const saved = this.persist(definition, progress, 'checkpoint');
            return { accepted: true, completedStep: false, completedLesson: false, progress: saved };
        }
        return this.advance(definition, progress, { skipped: false });
    }

    skipCurrentStep({ lessonId = this.activeLessonId, reason = 'user' } = {}) {
        if (!lessonId) return { accepted: false, reason: 'no-active-lesson' };
        const definition = this.requireDefinition(lessonId);
        const progress = this.getProgress(lessonId);
        if (!progress || progress.status !== 'in-progress') {
            return { accepted: false, reason: 'lesson-not-active', progress };
        }
        return this.advance(definition, progress, { skipped: true, reason });
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    advance(definition, progress, { skipped, reason = null }) {
        const step = definition.steps[progress.stepIndex];
        const stepProgress = progress.steps[step.id];
        const timestamp = this.now();
        stepProgress.status = skipped ? 'skipped' : 'completed';
        stepProgress.completedAt = timestamp;
        if (skipped) stepProgress.skipReason = reason;

        const completedLesson = progress.stepIndex === definition.steps.length - 1;
        if (completedLesson) {
            progress.status = 'completed';
            progress.completedAt = timestamp;
            progress.updatedAt = timestamp;
            if (this.activeLessonId === definition.id) this.activeLessonId = null;
        } else {
            progress.stepIndex += 1;
            const nextStep = definition.steps[progress.stepIndex];
            progress.steps[nextStep.id].status = 'in-progress';
            progress.updatedAt = timestamp;
        }
        const saved = this.persist(definition, progress, completedLesson ? 'completed' : (skipped ? 'skipped' : 'advanced'));
        return {
            accepted: true,
            completedStep: true,
            skipped,
            completedLesson,
            progress: saved
        };
    }

    persist(definition, progress, change) {
        this.writeJson(this.progressKey(definition.id), progress);
        const snapshot = clonePlain(progress);
        this.listeners.forEach(listener => {
            try {
                listener({
                    change,
                    lesson: clonePlain(definition),
                    progress: clonePlain(snapshot),
                    currentStep: progress.status === 'completed'
                        ? null
                        : clonePlain(definition.steps[progress.stepIndex])
                });
            } catch (_) {
                // A presentation listener cannot interrupt durable learning progress.
            }
        });
        return snapshot;
    }

    requireDefinition(lessonId) {
        const definition = this.definitions.get(lessonId);
        if (!definition) throw new Error(`Unknown learning path: ${lessonId}`);
        return definition;
    }

    progressKey(lessonId) {
        return `${LESSON_PROGRESS_PREFIX}${lessonId}`;
    }

    readJson(key) {
        try {
            const value = this.storage?.getItem?.(key);
            return value ? JSON.parse(value) : null;
        } catch (_) {
            return null;
        }
    }

    writeJson(key, value) {
        try { this.storage?.setItem?.(key, JSON.stringify(value)); } catch (_) { /* optional storage */ }
    }
}

export class GuidedTutorial {
    constructor(ui) {
        this.ui = ui;
        this.learning = new LearningPathController();
        this.launcher = document.getElementById('btn-tutorial');
        if (this.launcher) this.launcher.title = 'Open the Interface Tour';
        this.layer = document.getElementById('tutorial-layer');
        this.spotlight = document.getElementById('tutorial-spotlight');
        this.card = document.getElementById('tutorial-card');
        this.title = document.getElementById('tutorial-title');
        this.copy = document.getElementById('tutorial-copy');
        this.progress = document.getElementById('tutorial-progress');
        this.invitationActions = document.getElementById('tutorial-invitation-actions');
        this.tourActions = document.getElementById('tutorial-tour-actions');
        this.startButton = document.getElementById('btn-tutorial-start');
        this.skipButton = document.getElementById('btn-tutorial-skip');
        this.remindButton = document.getElementById('btn-tutorial-remind');
        this.dismissButton = document.getElementById('btn-tutorial-dismiss');
        this.backButton = document.getElementById('btn-tutorial-back');
        this.nextButton = document.getElementById('btn-tutorial-next');
        this.exitButton = document.getElementById('btn-tutorial-exit');
        this.index = 0;
        this.active = false;
        this.mode = null;
        this.contextSnapshot = null;
        this.inertSnapshot = [];
        this.promptTimer = null;
        this.steps = this.createSteps();
        this.bind();
    }

    createSteps() {
        return [
            {
                id: 'welcome',
                target: '.logo',
                title: 'Welcome to the Interface Tour',
                copy: 'This short orientation shows where to design a cabinet, inspect hardware, review fabrication geometry, plan sheets, and prepare an export. It does not change or confirm your project.',
                action: () => {
                    this.safeClose(this.ui.makerWorkflow?.dialog);
                    this.ui.makerWorkflow?.setActiveStep('design');
                }
            },
            {
                id: 'presets',
                target: '.preset-grid',
                title: 'Find the starting cabinets',
                copy: 'Choose Standard or Bar-top as a safe starting point. Every dimension remains parametric and can be changed later.',
                action: () => this.ui.activateTab('structure')
            },
            {
                id: 'structure',
                target: '#tab-structure',
                title: 'Find the main envelope controls',
                copy: 'Enter exact width, height, depth, and sheet thickness. Profile and Internals refine the shape and its structural load paths.'
            },
            {
                id: 'viewport',
                target: '#canvas-container',
                title: 'Inspect the live model',
                copy: 'Orbit the cabinet, use the fixed camera views, select panels, and use Explode to inspect how every part separates from the assembly centre.'
            },
            {
                id: 'controls',
                target: '#tab-controls',
                title: 'Explore control layouts',
                copy: 'Choose a grid, stagger, vee, or custom layout. Advanced users can drag a custom layout and inspect cutout fit before fabrication.',
                action: () => this.ui.activateTab('controls')
            },
            {
                id: 'panels',
                target: '#component-tuning',
                title: 'Find individual panel controls',
                copy: 'Select a panel to set its material, measured thickness, visibility, colour, and screw overrides. Scope controls can apply changes to a panel group.',
                action: () => {
                    this.safeClose(this.ui.makerWorkflow?.dialog);
                    this.ui.makerWorkflow?.setActiveStep('design');
                    this.ui.selectPanel('panel_cp');
                }
            },
            {
                id: 'hardware',
                target: '#maker-hardware-view',
                title: 'Inspect the Hardware workspace',
                copy: 'Hardware checks real component definitions, machining operations, thickness support, and underside service keepouts.',
                action: () => this.ui.makerWorkflow?.open('hardware')
            },
            {
                id: 'review',
                target: '#maker-review-view',
                title: 'Inspect the Review workspace',
                copy: 'Errors block the next production stage. Warnings remain visible with a corrective action and a link back to the affected panel.',
                action: () => this.ui.makerWorkflow?.open('review')
            },
            {
                id: 'sheets',
                target: '#maker-sheets-view',
                title: 'Explore sheet planning',
                copy: 'Assign materials per part, edit measured stock, compare ranked true-shape nests, and pin individual placements when needed.',
                action: () => this.ui.makerWorkflow?.open('sheets')
            },
            {
                id: 'export',
                target: '[data-maker-step="export"]',
                title: 'Find the export options',
                copy: 'The final stage produces drawings or a fabrication package only from the same validated geometry and sheet plan you reviewed.',
                action: () => {
                    this.safeClose(this.ui.makerWorkflow?.dialog);
                    this.ui.makerWorkflow?.setActiveStep('export');
                }
            },
            {
                id: 'theme',
                target: '#project-command-menu summary',
                title: 'Make the workspace yours',
                copy: 'Light and dark themes cover the entire design, review, sheet, and learning interface. Theme controls are in the Project menu, and Help lets you resume or replay this orientation.'
            }
        ];
    }

    bind() {
        this.startButton?.addEventListener('click', () => {
            if (this.mode === 'resume-choice') {
                this.resume();
                return;
            }
            this.start(false, { fromInvitation: true });
        });
        this.skipButton?.addEventListener('click', () => {
            if (this.mode === 'resume-choice') {
                this.restart();
                return;
            }
            this.finish(false);
        });
        this.remindButton?.addEventListener('click', () => {
            this.writeStorage(REMINDER_KEY, String(Date.now() + REMINDER_DELAY_MS));
            this.finish(false);
        });
        this.dismissButton?.addEventListener('click', () => {
            if (this.mode === 'resume-choice') {
                this.finish(false);
                return;
            }
            this.writeStorage(PROMPT_PREFERENCE_KEY, PROMPT_DISMISSED);
            this.finish(false);
        });
        this.backButton?.addEventListener('click', () => this.move(-1));
        this.nextButton?.addEventListener('click', () => this.move(1));
        this.exitButton?.addEventListener('click', () => this.finish(false));
        this.layer?.addEventListener('cancel', event => {
            event.preventDefault();
            this.finish(false);
        });
        window.addEventListener('resize', () => {
            if (this.active) this.position();
        });
        window.addEventListener('keydown', event => {
            if (!this.active || event.key !== 'Escape' || this.layer?.open) return;
            event.preventDefault();
            this.finish(false);
        });
    }

    maybeStart() {
        this.migrateLegacyCompletion();
        const completed = this.isTourComplete();
        const promptDismissed = this.readStorage(PROMPT_PREFERENCE_KEY) === PROMPT_DISMISSED;
        const remindAfter = Number(this.readStorage(REMINDER_KEY)) || 0;
        if (!completed && !promptDismissed && remindAfter <= Date.now()) {
            this.promptTimer = window.setTimeout(() => {
                this.promptTimer = null;
                this.invite();
            }, 700);
        }
    }

    invite() {
        if (!this.layer || this.active) return;
        this.captureContext();
        if (this.hasResumableTourProgress()) {
            this.showResumeChoice({ contextCaptured: true });
            return;
        }
        this.active = true;
        this.mode = 'invitation';
        this.layer.dataset.mode = 'invitation';
        this.layer.dataset.replay = 'false';
        document.body.classList.add('tutorial-active');
        this.openLayer();

        this.spotlight.hidden = true;
        this.progress.hidden = true;
        this.tourActions.hidden = true;
        this.invitationActions.hidden = false;
        this.configureInvitationButtons('invitation');
        this.title.textContent = 'Take the Interface Tour?';
        this.copy.textContent = 'Learn where each stage and major control lives without changing or confirming your project. You can leave at any time, replay it from Tour, skip for now, or choose when the invitation returns.';
        this.positionInvitation();
        this.animateNotice();
        this.startButton?.focus();
    }

    start(replay = false, { fromInvitation = false, resume = false, restart = false } = {}) {
        if (!this.layer || !this.steps.length) return;
        if (this.promptTimer !== null) {
            window.clearTimeout(this.promptTimer);
            this.promptTimer = null;
        }
        this.removeStorage(REMINDER_KEY);
        if (replay && !resume && !restart && this.hasResumableTourProgress()) {
            this.showResumeChoice({ contextCaptured: fromInvitation });
            return;
        }
        if (!fromInvitation) this.captureContext();
        this.active = true;
        this.mode = 'tour';
        this.layer.dataset.mode = 'tour';
        this.index = resume ? this.getResumableTourIndex() : 0;
        if (!resume) {
            this.removeStorage(TOUR_PROGRESS_KEY);
            this.removeStorage(COMPLETION_KEY);
            this.removeStorage(LEGACY_COMPLETION_KEY);
        }
        this.layer.dataset.replay = String(replay);
        document.body.classList.add('tutorial-active');
        this.openLayer();

        this.spotlight.hidden = false;
        this.progress.hidden = false;
        this.tourActions.hidden = false;
        this.invitationActions.hidden = true;
        this.render();
    }

    resume() {
        if (!this.hasResumableTourProgress()) {
            this.restart();
            return;
        }
        this.start(true, { fromInvitation: this.active, resume: true });
    }

    restart() {
        this.removeStorage(TOUR_PROGRESS_KEY);
        this.removeStorage(COMPLETION_KEY);
        this.start(true, { fromInvitation: this.active, restart: true });
    }

    startInterfaceTour({ resume = false, restart = false } = {}) {
        return this.start(true, { resume, restart });
    }

    resumeInterfaceTour() {
        return this.resume();
    }

    restartInterfaceTour() {
        return this.restart();
    }

    showResumeChoice({ contextCaptured = false } = {}) {
        if (!this.layer) return;
        if (!contextCaptured && !this.active) this.captureContext();
        this.active = true;
        this.mode = 'resume-choice';
        this.index = this.getResumableTourIndex();
        this.layer.dataset.mode = 'invitation';
        this.layer.dataset.replay = 'true';
        document.body.classList.add('tutorial-active');
        this.openLayer();
        this.spotlight.hidden = true;
        this.progress.hidden = true;
        this.tourActions.hidden = true;
        this.invitationActions.hidden = false;
        this.configureInvitationButtons('resume-choice');
        const progress = this.getTourProgress();
        this.title.textContent = 'Resume the Interface Tour?';
        this.copy.textContent = `You paused at step ${Math.min(this.steps.length, (progress?.stepIndex || 0) + 1)} of ${this.steps.length}. Resume there, restart from the beginning, or exit without changing your project.`;
        this.positionInvitation();
        this.animateNotice();
        this.startButton?.focus();
    }

    configureInvitationButtons(mode) {
        const choosingResume = mode === 'resume-choice';
        if (this.startButton) this.startButton.textContent = choosingResume ? 'Resume tour' : 'Start tour';
        if (this.skipButton) this.skipButton.textContent = choosingResume ? 'Restart tour' : 'Skip for now';
        if (this.remindButton) this.remindButton.hidden = choosingResume;
        if (this.dismissButton) this.dismissButton.textContent = choosingResume ? 'Exit' : "Don't show again";
    }

    move(delta) {
        if (this.mode !== 'tour') return;
        const next = this.index + delta;
        if (next >= this.steps.length) {
            this.finish(true);
            return;
        }
        this.index = Math.max(0, next);
        this.render();
    }

    render() {
        const step = this.steps[this.index];
        this.saveTourProgress('in-progress');
        step.action?.();
        window.setTimeout(() => {
            if (!this.active || this.mode !== 'tour') return;
            this.bringLayerToFront();
            this.title.textContent = step.title;
            this.copy.textContent = step.copy;
            this.progress.textContent = `Interface Tour, ${this.index + 1} of ${this.steps.length}`;
            this.backButton.disabled = this.index === 0;
            this.nextButton.textContent = this.index === this.steps.length - 1 ? 'Finish' : 'Next';
            this.position();
            this.animateNotice();
            this.title.focus();
        }, 50);
    }

    animateNotice() {
        if (!this.card) return;
        this.card.classList.remove('notice-enter');
        this.spotlight?.classList.remove('notice-enter');
        void this.card.offsetWidth;
        this.card.classList.add('notice-enter');
        if (!this.spotlight?.hidden) this.spotlight.classList.add('notice-enter');
    }

    position() {
        if (this.mode === 'invitation') {
            this.positionInvitation();
            return;
        }

        const step = this.steps[this.index];
        const target = document.querySelector(step.target);
        if (!target || target.hidden) {
            this.spotlight.style.cssText = 'left:20px;top:20px;width:1px;height:1px;';
            this.positionInvitation();
            return;
        }
        target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
        const rect = target.getBoundingClientRect();
        const pad = 8;
        this.spotlight.style.left = `${Math.max(8, rect.left - pad)}px`;
        this.spotlight.style.top = `${Math.max(8, rect.top - pad)}px`;
        this.spotlight.style.width = `${Math.max(24, Math.min(window.innerWidth - 16, rect.width + pad * 2))}px`;
        this.spotlight.style.height = `${Math.max(24, Math.min(window.innerHeight - 16, rect.height + pad * 2))}px`;

        const cardWidth = Math.min(390, window.innerWidth - 32);
        const cardHeight = this.card.getBoundingClientRect().height || 218;
        const placeBelow = rect.bottom + cardHeight + 34 < window.innerHeight;
        const left = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left + rect.width / 2 - cardWidth / 2));
        const top = placeBelow ? rect.bottom + 18 : Math.max(16, rect.top - cardHeight - 18);
        this.card.style.width = `${cardWidth}px`;
        this.card.style.left = `${left}px`;
        this.card.style.top = `${top}px`;
        this.card.style.transform = 'none';
    }

    positionInvitation() {
        this.card.style.width = `${Math.min(430, window.innerWidth - 32)}px`;
        this.card.style.left = '50%';
        this.card.style.top = '50%';
        this.card.style.transform = 'translate(-50%, -50%)';
    }

    captureContext() {
        const activeElement = document.activeElement;
        const scrollableSelectors = ['.sidebar-left', '.sidebar-right', '.maker-dialog-body'];
        this.contextSnapshot = {
            workflow: this.ui.makerWorkflow?.captureProgressState?.() || null,
            activeTab: document.querySelector('.tab-btn.active')?.dataset.tab || null,
            activePanelId: this.ui.activePanelId ?? null,
            focus: activeElement instanceof HTMLElement
                && activeElement !== document.body
                && activeElement !== document.documentElement
                && !this.layer?.contains(activeElement)
                ? activeElement
                : null,
            windowScrollX: window.scrollX,
            windowScrollY: window.scrollY,
            scrollPositions: scrollableSelectors.map(selector => {
                const element = document.querySelector(selector);
                return { selector, top: element?.scrollTop || 0, left: element?.scrollLeft || 0 };
            })
        };
    }

    restoreContext() {
        const snapshot = this.contextSnapshot;
        if (!snapshot) return;

        if (snapshot.workflow && this.ui.makerWorkflow?.restoreProgressState) {
            this.ui.makerWorkflow.restoreProgressState(snapshot.workflow);
        }
        if (snapshot.activeTab) this.ui.activateTab(snapshot.activeTab);
        if (this.ui.activePanelId !== snapshot.activePanelId) this.ui.selectPanel(snapshot.activePanelId);

        window.setTimeout(() => {
            snapshot.scrollPositions.forEach(position => {
                const element = document.querySelector(position.selector);
                if (!element) return;
                element.scrollTop = position.top;
                element.scrollLeft = position.left;
            });
            window.scrollTo?.(snapshot.windowScrollX, snapshot.windowScrollY);
            if (snapshot.focus?.isConnected && !snapshot.focus.disabled) snapshot.focus.focus();
        }, 80);
    }

    openLayer() {
        this.layer.hidden = false;
        this.layer.setAttribute('aria-modal', 'true');
        if (this.layer.open) return;
        if (typeof this.layer.showModal === 'function') {
            try {
                this.layer.showModal();
                return;
            } catch (_) {
                // A non-modal fallback remains available in older embedded browsers.
            }
        }
        this.layer.setAttribute('open', '');
        this.setBackgroundInert(true);
    }

    bringLayerToFront() {
        if (!this.layer?.open || typeof this.layer.showModal !== 'function') return;
        try {
            this.layer.close();
            this.layer.showModal();
        } catch (_) {
            this.layer.setAttribute('open', '');
            this.setBackgroundInert(true);
        }
    }

    closeLayer() {
        if (this.layer?.open && typeof this.layer.close === 'function') {
            try { this.layer.close(); } catch (_) { this.layer.removeAttribute('open'); }
        } else {
            this.layer?.removeAttribute('open');
        }
        this.layer?.removeAttribute('aria-modal');
        if (this.layer) this.layer.hidden = true;
        this.setBackgroundInert(false);
    }

    setBackgroundInert(enabled) {
        if (enabled) {
            if (this.inertSnapshot.length) return;
            const container = this.layer?.parentElement;
            this.inertSnapshot = Array.from(container?.children || [])
                .filter(element => element !== this.layer)
                .map(element => ({ element, wasInert: Boolean(element.inert) }));
            this.inertSnapshot.forEach(({ element }) => { element.inert = true; });
            return;
        }
        this.inertSnapshot.forEach(({ element, wasInert }) => { element.inert = wasInert; });
        this.inertSnapshot = [];
    }

    finish(completed) {
        if (!this.active) return;
        const previousMode = this.mode;
        if (previousMode === 'tour' || (previousMode === 'resume-choice' && this.hasResumableTourProgress())) {
            this.saveTourProgress(completed ? 'completed' : 'paused');
        }
        this.active = false;
        this.mode = null;
        delete this.layer.dataset.mode;
        this.closeLayer();
        document.body.classList.remove('tutorial-active');
        if (completed) {
            this.writeStorage(COMPLETION_KEY, 'true');
            this.removeStorage(REMINDER_KEY);
            this.ui.showNotification?.('Interface Tour complete. Use Tour to replay it.');
        } else if (previousMode === 'tour') {
            this.ui.showNotification?.('Interface Tour paused. Use Tour to resume it.');
        }
        this.restoreContext();
        this.contextSnapshot = null;
    }

    exit() {
        this.finish(false);
    }

    getTourProgress() {
        try {
            const stored = JSON.parse(this.readStorage(TOUR_PROGRESS_KEY) || 'null');
            if (!stored
                || stored.schemaVersion !== LEARNING_SCHEMA_VERSION
                || stored.tourId !== INTERFACE_TOUR_ID
                || stored.tourVersion !== INTERFACE_TOUR_VERSION
                || !Number.isInteger(stored.stepIndex)) {
                return null;
            }
            return {
                ...stored,
                stepIndex: Math.max(0, Math.min(this.steps.length - 1, stored.stepIndex))
            };
        } catch (_) {
            return null;
        }
    }

    saveTourProgress(status) {
        const timestamp = Date.now();
        const previous = this.getTourProgress();
        const progress = {
            schemaVersion: LEARNING_SCHEMA_VERSION,
            tourId: INTERFACE_TOUR_ID,
            tourVersion: INTERFACE_TOUR_VERSION,
            status,
            stepIndex: Math.max(0, Math.min(this.steps.length - 1, this.index)),
            stepId: this.steps[this.index]?.id || null,
            startedAt: previous?.startedAt || timestamp,
            updatedAt: timestamp,
            completedAt: status === 'completed' ? timestamp : null
        };
        this.writeStorage(TOUR_PROGRESS_KEY, JSON.stringify(progress));
        return progress;
    }

    hasResumableTourProgress() {
        const progress = this.getTourProgress();
        return Boolean(progress && ['in-progress', 'paused'].includes(progress.status));
    }

    getResumableTourIndex() {
        return this.hasResumableTourProgress() ? this.getTourProgress().stepIndex : 0;
    }

    isTourComplete() {
        const progress = this.getTourProgress();
        if (progress) return progress.status === 'completed';
        return this.readStorage(COMPLETION_KEY) === 'true';
    }

    migrateLegacyCompletion() {
        if (this.readStorage(COMPLETION_KEY) === 'true') return;
        if (this.readStorage(LEGACY_COMPLETION_KEY) !== 'true') return;
        this.writeStorage(COMPLETION_KEY, 'true');
        this.removeStorage(LEGACY_COMPLETION_KEY);
        this.writeStorage(TOUR_PROGRESS_KEY, JSON.stringify({
            schemaVersion: LEARNING_SCHEMA_VERSION,
            tourId: INTERFACE_TOUR_ID,
            tourVersion: INTERFACE_TOUR_VERSION,
            status: 'completed',
            stepIndex: this.steps.length - 1,
            stepId: this.steps.at(-1)?.id || null,
            startedAt: null,
            updatedAt: Date.now(),
            completedAt: Date.now()
        }));
    }

    listLearningPaths() {
        return this.learning.listLessons();
    }

    getLearningProgress(lessonId = FIRST_CABINET_LESSON_ID) {
        return this.learning.getProgress(lessonId);
    }

    getCurrentLearningStep(lessonId = this.learning.activeLessonId) {
        return this.learning.getCurrentStep(lessonId);
    }

    startLearningPath(lessonId = FIRST_CABINET_LESSON_ID, options = {}) {
        return this.learning.startLesson(lessonId, options);
    }

    resumeLearningPath(lessonId = FIRST_CABINET_LESSON_ID) {
        return this.learning.resumeLesson(lessonId);
    }

    restartLearningPath(lessonId = FIRST_CABINET_LESSON_ID, options = {}) {
        return this.learning.restartLesson(lessonId, options);
    }

    resetLearningPath(lessonId = FIRST_CABINET_LESSON_ID) {
        return this.learning.resetLesson(lessonId);
    }

    exitLearningPath(lessonId = this.learning.activeLessonId) {
        return this.learning.exitLesson(lessonId);
    }

    recordLearningAction(event, detail = {}, options = {}) {
        return this.learning.recordAction(event, detail, options);
    }

    skipLearningStep(options = {}) {
        return this.learning.skipCurrentStep(options);
    }

    subscribeToLearning(listener) {
        return this.learning.subscribe(listener);
    }

    safeClose(dialog) {
        if (dialog?.open) dialog.close();
    }

    readStorage(key) {
        try { return window.localStorage.getItem(key); } catch (_) { return null; }
    }

    writeStorage(key, value) {
        try { window.localStorage.setItem(key, value); } catch (_) { /* optional storage */ }
    }

    removeStorage(key) {
        try { window.localStorage.removeItem(key); } catch (_) { /* optional storage */ }
    }
}
