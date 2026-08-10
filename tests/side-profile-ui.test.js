import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../wwwroot/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../wwwroot/style.css', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../wwwroot/js/side-profile-editor.js', import.meta.url), 'utf8');
const cabinet = readFileSync(new URL('../wwwroot/js/cabinet.js', import.meta.url), 'utf8');
const fabrication = readFileSync(new URL('../wwwroot/js/fabrication.js', import.meta.url), 'utf8');

test('decorative profile editor exposes a described, transactional advanced workflow', () => {
    assert.match(html, /id="side-profile-dialog"[^>]*aria-describedby="side-profile-editor-description"/);
    assert.match(html, /id="side-profile-target"[\s\S]*value="both">Both walls/);
    assert.match(html, /id="side-profile-anchor-list"[^>]*size="4"/);
    assert.match(html, /Exact handle coordinates/);
    assert.match(html, /hatched structural envelope is locked/i);
    for (const id of [
        'side-profile-enabled', 'side-profile-linked', 'side-profile-snap',
        'btn-side-profile-undo', 'btn-side-profile-redo',
        'btn-side-profile-zoom-out', 'btn-side-profile-fit', 'btn-side-profile-zoom-in',
        'btn-cancel-side-profile', 'btn-apply-side-profile'
    ]) assert.ok(html.includes(`id="${id}"`), `${id} is missing`);
});

test('editor validates both walls, honours display units, and keeps edits reversible', () => {
    assert.match(editor, /left:\s*validateCurveProfile\(/);
    assert.match(editor, /right:\s*validateCurveProfile\(/);
    assert.match(editor, /SIDE_PROFILE_SAMPLING_OPTIONS/);
    assert.match(editor, /getScreenCTM/);
    assert.match(editor, /getDisplayNumber/);
    assert.match(editor, /getBaseNumber/);
    assert.match(editor, /commitDraft\(\)/);
    assert.match(editor, /Discard the unapplied side-profile changes/);
    assert.match(editor, /errors\?\.\[0\]\?\.message/);
});

test('outer-profile integration preserves structure and fails closed before fabrication', () => {
    assert.match(cabinet, /structuralProfilePoints:/);
    assert.match(cabinet, /resolveSideProfile\(/);
    assert.match(cabinet, /fabricationDiagnostics\.profileIssues\.push/);
    assert.match(fabrication, /parameter: 'sideProfileCustomization'/);
    assert.match(fabrication, /SIDE_PROFILE_INVALID/);
});

test('profile editor adapts to compact and forced-colour layouts', () => {
    assert.match(css, /@media \(max-width: 840px\), \(max-height: 620px\)[\s\S]*?\.side-profile-editor-layout/);
    assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.side-profile-dialog/);
    assert.match(css, /\.profile-anchor-hit/);
});
