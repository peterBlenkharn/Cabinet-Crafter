import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../wwwroot/js/ui.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../wwwroot/index.html', import.meta.url), 'utf8');
const workflowGuide = readFileSync(new URL('../docs/UI_WORKFLOWS.md', import.meta.url), 'utf8');

test('high-frequency cabinet edits are coalesced to animation frames', () => {
    assert.match(uiSource, /queueCabinetUpdate\(/);
    assert.match(uiSource, /cabinetUpdateFrame = window\.requestAnimationFrame/);
    assert.match(uiSource, /queueComponentOverride\(/);
    assert.match(uiSource, /artworkUpdateFrame = window\.requestAnimationFrame/);
});

test('native text editing undo is not replaced by project undo', () => {
    assert.match(uiSource, /event\.key\.toLowerCase\(\) === 'z' && !event\.shiftKey && !typing/);
    assert.match(uiSource, /modifier && !typing && \(event\.key\.toLowerCase\(\) === 'y'/);
});

test('camera changes stay out of project undo and risky bulk scope resets on selection', () => {
    const afterView = uiSource.match(/afterViewMutation\([^]*?\n    \}/)?.[0] || '';
    assert.doesNotMatch(afterView, /scheduleHistory|markMutation/);
    assert.match(uiSource, /captureHistoryState\(\{ includeViewPreferences = false \}/);
    assert.match(uiSource, /selectionChanged && this\.componentEditScope/);
});

test('component joint summaries disclose when additional joints are hidden', () => {
    assert.match(uiSource, /remainingCount = joints\.length - visibleJoints\.length/);
    assert.match(uiSource, /remainingCount > 0 \? `; \+\$\{remainingCount\} more`/);
});

test('material assignment is visible in the main inspector and links both ways with Sheets', () => {
    const materialIndex = html.indexOf('id="component-material-title"');
    const advancedIndex = html.indexOf('<details class="advanced-component-editor">');
    assert.ok(materialIndex > 0 && materialIndex < advancedIndex);
    assert.match(html, /id="btn-manage-materials"[\s\S]*id="btn-open-selected-sheet"/);
    assert.match(html, /id="part-material-assignment-list"/);
    assert.match(uiSource, /openSheetsForPart/);
});

test('hardware stage exposes a read-only control reference and purchasing editors', () => {
    assert.match(html, /id="hardware-control-layout-preview"/);
    assert.match(html, /id="additional-hardware-list"/);
    assert.match(html, /id="btn-add-hardware-item"/);
    assert.match(html, /Back to Controls editor/);
});

test('undocumented single-letter viewport shortcuts are removed from UI and guidance', () => {
    assert.doesNotMatch(uiSource, /event\.key\.toLowerCase\(\) === '[fi]'/);
    assert.doesNotMatch(html, /\((?:Shift\+)?[FI]\)/);
    assert.doesNotMatch(workflowGuide, /`(?:Shift\+)?[FI]`/);
});
