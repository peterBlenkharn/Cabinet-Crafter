import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../wwwroot/js/app.js', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../wwwroot/js/export.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../wwwroot/js/ui.js', import.meta.url), 'utf8');
const tutorialSource = readFileSync(new URL('../wwwroot/js/guided-tutorial.js', import.meta.url), 'utf8');

test('the 3D viewport renders on demand and does not preserve every frame buffer', () => {
    assert.match(appSource, /preserveDrawingBuffer:\s*false/);
    assert.match(appSource, /requestRender\(\)\s*\{/);
    assert.doesNotMatch(appSource, /animate\(\)\s*\{\s*requestAnimationFrame/);
    assert.match(appSource, /document\.hidden/);
});

test('viewport interaction distinguishes an orbit gesture from a selection click', () => {
    assert.match(appSource, /pointerGesture/);
    assert.match(appSource, /dx \* dx \+ dy \* dy > 36/);
    assert.match(appSource, /gesture\.cameraMoved/);
    assert.match(appSource, /pointerGesture\?\.moved/);
    assert.match(appSource, /ResizeObserver/);
});

test('redundant resize notifications do not reallocate the WebGL drawing buffer', () => {
    assert.match(appSource, /viewportRenderWidth/);
    assert.match(appSource, /viewportRenderHeight/);
    assert.match(appSource, /viewportPixelRatio/);
    assert.match(appSource, /if \(!dimensionsChanged && !pixelRatioChanged\) return/);
    assert.match(appSource, /if \(dimensionsChanged\) this\.renderer\.setSize\(width, height, false\)/);
});

test('the generated canvas provides keyboard camera controls and context recovery', () => {
    assert.match(appSource, /Interactive 3D cabinet preview/);
    assert.match(appSource, /handleViewportKeydown/);
    assert.match(appSource, /webglcontextlost/);
    assert.match(appSource, /webglcontextrestored/);
});

test('the manufacturing package graph loads only when a package is requested', () => {
    assert.doesNotMatch(exportSource, /^import[\s\S]{0,160}from '\.\/manufacturing-pack\.js';/m);
    assert.match(exportSource, /import\('\.\/manufacturing-pack\.js'\)/);
    assert.match(exportSource, /manufacturingPackModulePromise/);
});

test('the tutorial module loads after the first workspace frame', () => {
    assert.doesNotMatch(uiSource, /^import\s+\{\s*GuidedTutorial\s*\}/m);
    assert.match(uiSource, /requestAnimationFrame\(\(\) => \{/);
    assert.match(uiSource, /import\('\.\/guided-tutorial\.js'\)/);
    assert.match(uiSource, /tutorialButton\.setAttribute\('aria-busy', 'true'\)/);
    assert.match(uiSource, /btnTutorial\?\.addEventListener\('click',[\s\S]*?ensureGuidedTutorial\(\)/);
    assert.doesNotMatch(tutorialSource, /getElementById\('btn-tutorial'\)[\s\S]{0,120}addEventListener/);
});

test('preflight results are reused until geometry or fabrication inclusion changes', () => {
    assert.match(uiSource, /preflightResultsCache/);
    assert.match(uiSource, /panelRevision,\s*inclusionRevision/);
    assert.match(uiSource, /return \[\.\.\.this\.preflightResultsCache\.results\]/);
});

test('showing or hiding every panel does not rebuild cabinet geometry', () => {
    const method = appSource.match(/setAllPanelVisibility\(visible\) \{([\s\S]*?)\n    \}/)?.[1] || '';
    assert.match(method, /panelMeshes\.forEach/);
    assert.doesNotMatch(method, /cabinet\.build\(/);
});
