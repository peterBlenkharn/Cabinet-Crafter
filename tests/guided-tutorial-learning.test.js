import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    FIRST_CABINET_LESSON,
    FIRST_CABINET_LESSON_ID,
    INTERFACE_TOUR_ID,
    INTERFACE_TOUR_VERSION,
    GuidedTutorial,
    LEARNING_ACTIONS,
    LEARNING_SCHEMA_VERSION,
    LearningPathController
} from '../wwwroot/js/guided-tutorial.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

function createController(storage = new MemoryStorage()) {
    let timestamp = 1000;
    return {
        controller: new LearningPathController({ storage, now: () => ++timestamp }),
        storage
    };
}

test('the passive walkthrough is truthfully presented as an Interface Tour', () => {
    const source = readFileSync(new URL('../wwwroot/js/guided-tutorial.js', import.meta.url), 'utf8');
    assert.equal(INTERFACE_TOUR_ID, 'interface-tour');
    assert.equal(INTERFACE_TOUR_VERSION, 2);
    assert.match(source, /Welcome to the Interface Tour/);
    assert.match(source, /It does not change or confirm your project/);
    assert.match(source, /Resume the Interface Tour\?/);
    assert.match(source, /Restart tour/);
    assert.match(source, /Interface Tour paused/);
    assert.doesNotMatch(source, /\.confirmStage\s*\(/);
    assert.doesNotMatch(source, /\.commitAndNavigate\s*\(/);
    assert.equal(LEARNING_ACTIONS.REVIEW_INSPECTED, 'review.inspected');
});

test('Interface Tour progress is versioned, resumable, and uses stable step IDs', () => {
    const storage = new MemoryStorage();
    const harness = Object.create(GuidedTutorial.prototype);
    harness.steps = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
    harness.index = 1;
    harness.readStorage = key => storage.getItem(key);
    harness.writeStorage = (key, value) => storage.setItem(key, value);
    harness.removeStorage = key => storage.removeItem(key);

    let progress = harness.saveTourProgress('paused');
    assert.equal(progress.schemaVersion, LEARNING_SCHEMA_VERSION);
    assert.equal(progress.tourId, INTERFACE_TOUR_ID);
    assert.equal(progress.tourVersion, INTERFACE_TOUR_VERSION);
    assert.equal(progress.stepId, 'two');
    assert.equal(harness.hasResumableTourProgress(), true);
    assert.equal(harness.getResumableTourIndex(), 1);

    harness.index = 2;
    progress = harness.saveTourProgress('completed');
    assert.equal(progress.stepId, 'three');
    assert.equal(harness.hasResumableTourProgress(), false);
    assert.equal(harness.isTourComplete(), true);

    storage.setItem('cabinet-crafter:tutorial-complete:v1', 'true');
    storage.removeItem('cabinet-crafter:interface-tour-complete:v2');
    harness.migrateLegacyCompletion();
    assert.equal(storage.getItem('cabinet-crafter:tutorial-complete:v1'), null);
    assert.equal(harness.getTourProgress().status, 'completed');
});

test('the First Cabinet lesson defines action checkpoints for an isolated practice project', () => {
    assert.equal(FIRST_CABINET_LESSON.id, FIRST_CABINET_LESSON_ID);
    assert.equal(FIRST_CABINET_LESSON.requiresPracticeProject, true);
    assert.equal(FIRST_CABINET_LESSON.steps.length, 11);
    assert.deepEqual(
        FIRST_CABINET_LESSON.steps.map(step => step.id),
        [
            'choose-preset',
            'save-project',
            'set-envelope',
            'inspect-model',
            'choose-controls',
            'inspect-panel',
            'inspect-hardware',
            'review-design',
            'generate-sheets',
            'export-draft',
            'before-you-cut'
        ]
    );
    assert.throws(
        () => createController().controller.startLesson(FIRST_CABINET_LESSON_ID),
        /isolated practice project/
    );
});

test('lesson progress advances only after required actions and persists for resume', () => {
    const { controller, storage } = createController();
    const changes = [];
    controller.subscribe(event => changes.push(event.change));

    let progress = controller.startLesson(FIRST_CABINET_LESSON_ID, {
        practiceProject: true,
        practiceSessionId: 'practice-copy-1'
    });
    assert.equal(progress.schemaVersion, LEARNING_SCHEMA_VERSION);
    assert.equal(progress.status, 'in-progress');
    assert.equal(progress.stepIndex, 0);

    let result = controller.recordAction('viewport.orbit');
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'action-not-required');
    assert.equal(controller.getProgress(FIRST_CABINET_LESSON_ID).stepIndex, 0);

    result = controller.recordAction('preset.selected', { preset: 'standard' });
    assert.equal(result.accepted, true);
    assert.equal(result.completedStep, true);
    assert.equal(result.progress.stepIndex, 1);

    result = controller.recordAction('project.saved', { saved: false });
    assert.equal(result.accepted, false);
    assert.equal(controller.getProgress(FIRST_CABINET_LESSON_ID).stepIndex, 1);

    result = controller.recordAction('project.saved', { saved: true });
    assert.equal(result.progress.stepIndex, 2);

    controller.recordAction('parameter.changed', { section: 'structure', parameter: 'width' });
    controller.recordAction('parameter.changed', { section: 'structure', parameter: 'height' });
    result = controller.recordAction('parameter.changed', { section: 'structure', parameter: 'unrelated' });
    assert.equal(result.accepted, false);
    result = controller.recordAction('parameter.changed', { section: 'structure', parameter: 'width' });
    assert.equal(result.completedStep, false);
    assert.equal(result.progress.stepIndex, 2);

    result = controller.recordAction('parameter.changed', { section: 'structure', parameter: 'depth' });
    assert.equal(result.completedStep, true);
    assert.equal(result.progress.stepIndex, 3);

    progress = controller.exitLesson();
    assert.equal(progress.status, 'paused');
    assert.equal(controller.activeLessonId, null);

    const resumedController = new LearningPathController({ storage, now: () => 2000 });
    progress = resumedController.resumeLesson(FIRST_CABINET_LESSON_ID);
    assert.equal(progress.status, 'in-progress');
    assert.equal(progress.stepIndex, 3);
    assert.equal(progress.practiceSessionId, 'practice-copy-1');
    assert.equal(resumedController.getCurrentStep().definition.id, 'inspect-model');
    assert.ok(changes.includes('started'));
    assert.ok(changes.includes('paused'));
});

test('multi-action checkpoints require every action and explicit skip is recorded', () => {
    const { controller } = createController();
    controller.startLesson(FIRST_CABINET_LESSON_ID, {
        practiceProject: true,
        practiceSessionId: 'practice-copy-2'
    });
    controller.recordAction('preset.selected');
    controller.recordAction('project.saved', { saved: true });
    for (const parameter of ['width', 'height', 'depth']) {
        controller.recordAction('parameter.changed', { section: 'structure', parameter });
    }

    let result = controller.recordAction('viewport.orbit');
    assert.equal(result.completedStep, false);
    assert.equal(result.progress.stepIndex, 3);
    result = controller.recordAction('viewport.fit');
    assert.equal(result.completedStep, true);
    assert.equal(result.progress.stepIndex, 4);

    result = controller.skipCurrentStep({ reason: 'user chose a preset layout earlier' });
    assert.equal(result.skipped, true);
    assert.equal(result.progress.steps['choose-controls'].status, 'skipped');
    assert.equal(result.progress.steps['choose-controls'].skipReason, 'user chose a preset layout earlier');
    assert.equal(result.progress.stepIndex, 5);
});

test('restart preserves the practice session and stale lesson versions do not resume', () => {
    const { controller, storage } = createController();
    controller.startLesson(FIRST_CABINET_LESSON_ID, {
        practiceProject: true,
        practiceSessionId: 'practice-copy-3'
    });
    controller.recordAction('preset.selected');
    const restarted = controller.restartLesson(FIRST_CABINET_LESSON_ID);
    assert.equal(restarted.stepIndex, 0);
    assert.equal(restarted.practiceSessionId, 'practice-copy-3');

    const revisedDefinition = {
        ...FIRST_CABINET_LESSON,
        version: FIRST_CABINET_LESSON.version + 1
    };
    const revisedController = new LearningPathController({
        storage,
        definitions: [revisedDefinition]
    });
    assert.equal(revisedController.getProgress(FIRST_CABINET_LESSON_ID), null);
});

test('lesson completion is learning state only and never confirms production stages', () => {
    const definition = {
        id: 'single-checkpoint',
        version: 1,
        title: 'Single checkpoint',
        description: 'Test lesson',
        estimatedMinutes: 1,
        requiresPracticeProject: false,
        steps: [{
            id: 'observe',
            title: 'Observe',
            copy: 'Complete one learning action.',
            requirements: [{ id: 'observed', event: 'lesson.observed' }]
        }]
    };
    const storage = new MemoryStorage();
    const controller = new LearningPathController({ storage, definitions: [definition] });
    controller.startLesson(definition.id);
    const result = controller.recordAction('lesson.observed');
    assert.equal(result.completedLesson, true);
    assert.equal(result.progress.status, 'completed');
    assert.equal(result.progress.steps.observe.status, 'completed');
    assert.equal(storage.values.size, 1);
});
