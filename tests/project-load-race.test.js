import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    .replace(/\r\n?/g, '\n');
const appSource = readSource('../wwwroot/js/app.js');
const uiSource = readSource('../wwwroot/js/ui.js');
const applyProjectDataSource = appSource.match(
    /applyProjectData\(data = \{\}, \{ file = null, recovered = false \} = \{\}\) \{([\s\S]*?)\n    \}\n\n    handleProjectLoadError/
)?.[1] || '';

test('each project application receives a monotonically increasing load generation', () => {
    assert.match(appSource, /this\.projectLoadGeneration = 0/);
    assert.match(applyProjectDataSource, /const loadGeneration = \+\+this\.projectLoadGeneration/);
    assert.match(
        applyProjectDataSource,
        /const finishLoad = \(\) => \{\s*if \(loadGeneration !== this\.projectLoadGeneration\) return;/
    );
});

test('project parameters and artwork remain staged until the current load commits', () => {
    assert.match(applyProjectDataSource, /const nextParams = normalizeParams\(sourceParams\)/);
    assert.match(applyProjectDataSource, /data\.project\?\.basedOnPreset \?\? data\.basedOnPreset/);
    assert.match(applyProjectDataSource, /if \(!nextParams\.presetId && PRESETS\[basedOnPreset\]\) nextParams\.presetId = basedOnPreset/);
    assert.match(applyProjectDataSource, /const stagedDecals = \{\}/);
    assert.match(applyProjectDataSource, /stagedDecals\[item\.panelId\]\.push/);
    assert.doesNotMatch(applyProjectDataSource, /this\.cabinet\.decals\[item\.panelId\]\.push/);

    const generationGuard = applyProjectDataSource.indexOf('if (loadGeneration !== this.projectLoadGeneration) return;');
    const parameterCommit = applyProjectDataSource.indexOf('this.params = nextParams;');
    const artworkCommit = applyProjectDataSource.indexOf('this.cabinet.decals = stagedDecals;');
    assert.ok(generationGuard >= 0);
    assert.ok(parameterCommit > generationGuard);
    assert.ok(artworkCommit > generationGuard);
});

test('new and applied built-in presets retain their project provenance', () => {
    assert.match(appSource, /presetId: 'standard'/);
    assert.match(uiSource, /const params = cloneParams\(PRESETS\[presetId\]\);\s*params\.presetId = presetId/);
    assert.match(uiSource, /const nextParams = cloneParams\(preset\);\s*nextParams\.presetId = presetId/);
});

test('an obsolete project load cannot report a late application error', () => {
    assert.match(
        applyProjectDataSource,
        /if \(loadGeneration === this\.projectLoadGeneration\) \{\s*this\.handleProjectLoadError\(error\);/
    );
});
