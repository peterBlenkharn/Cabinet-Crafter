import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createProjectDocument, migrateProjectDocument } from '../wwwroot/js/project-document.js';

const html = readFileSync(new URL('../wwwroot/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../wwwroot/style.css', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../wwwroot/js/ui.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../wwwroot/js/app.js', import.meta.url), 'utf8');

test('scene hierarchy exposes viewport visibility separately from fabrication inclusion', () => {
    assert.match(html, /id="scene-visibility-tree"[^>]*aria-label="Scene element hierarchy"/);
    assert.match(html, /These controls change only the 3D viewport\. Fabrication inclusion remains separate/);
    assert.match(uiSource, /data-scene-visibility="panel"/);
    assert.match(uiSource, /Fabrication: \$\{included \? 'included' : 'excluded'\}/);
    assert.match(uiSource, /sceneToggleRow\('scene-toggle-screws', 'screws', 'Screws'/);
});

test('global screw visibility changes render state without changing fabrication data', () => {
    assert.match(html, /id="btn-toggle-screws"[^>]*aria-pressed="true"/);
    const setter = appSource.match(/setScrewVisibility\(visible\) \{[\s\S]*?\n    \}/)?.[0] || '';
    assert.match(setter, /this\.screwsVisible = visible !== false/);
    assert.match(setter, /this\.applySceneVisibility\(\)/);
    assert.doesNotMatch(setter, /fabrication|setPanelIncluded|params|build\(/);

    const screwBranch = uiSource.match(/if \(type === 'screws'\) \{[\s\S]*?\n            \}/)?.[0] || '';
    assert.match(screwBranch, /setScrewVisibility/);
    assert.doesNotMatch(screwBranch, /setPanelIncluded|fabrication|afterCabinetMutation/);
});

test('screw visibility survives canonical save and load and legacy projects default to shown', () => {
    const hidden = createProjectDocument({
        name: 'Hidden screws',
        params: { width: 650 },
        viewState: { screwsVisible: false }
    });
    assert.equal(hidden.viewState.screwsVisible, false);
    assert.equal(migrateProjectDocument(hidden).viewState.screwsVisible, false);

    const legacy = migrateProjectDocument({
        version: '1.2',
        params: { width: 650 },
        decals: {}
    });
    assert.equal(legacy.viewState.screwsVisible, true);
    assert.match(appSource, /this\.screwsVisible = state\.screwsVisible !== false/);
});

test('geometry undo snapshots do not capture or revert the non-undo screw preference', () => {
    const capture = uiSource.match(/captureHistoryState\(\{ includeViewPreferences = false \} = \{\}\) \{[\s\S]*?\n    \}/)?.[0] || '';
    const ordinarySnapshot = capture.split('if (includeViewPreferences)')[0];
    assert.doesNotMatch(ordinarySnapshot, /screwsVisible/);
    assert.match(capture, /if \(includeViewPreferences\)[\s\S]*?state\.screwsVisible = this\.app\.screwsVisible !== false/);

    const restore = uiSource.match(/restoreHistoryState\(state\) \{[\s\S]*?\n    \}/)?.[0] || '';
    assert.match(restore, /if \(Object\.hasOwn\(state, 'screwsVisible'\)\) \{[\s\S]*?setScrewVisibility/);

    const runtimePreference = false;
    const geometryUndoState = { params: { width: 650 } };
    const restoredPreference = Object.hasOwn(geometryUndoState, 'screwsVisible')
        ? geometryUndoState.screwsVisible !== false
        : runtimePreference;
    assert.equal(restoredPreference, false);
});

test('inspector controls reflow and panel cards avoid competing columns', () => {
    assert.match(css, /\.advanced-component-editor \.text-control\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(css, /\.advanced-fastener-heading\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(css, /\.individual-fastener-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.panel-item-meta\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(css, /\.panel-item\s*\{[\s\S]*?flex:\s*0 0 auto/);
    assert.match(css, /\.panel-list\s*\{[\s\S]*?overflow-x:\s*hidden/);
    assert.match(css, /\.panel-meta-row\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\)/);
    assert.match(uiSource, /panel-meta-label">Part[\s\S]*?panel-meta-label">Size/);
    assert.match(uiSource, /Diameter \(mm\).*Length \(mm\)/s);
});
