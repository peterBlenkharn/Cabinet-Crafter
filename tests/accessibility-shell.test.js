import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../wwwroot/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../wwwroot/style.css', import.meta.url), 'utf8');
const tutorial = readFileSync(new URL('../wwwroot/js/guided-tutorial.js', import.meta.url), 'utf8');

test('the application shell exposes useful landmarks and described dialogs', () => {
    assert.match(html, /<main id="canvas-container"[^>]*aria-labelledby="workspace-title"[^>]*aria-describedby="viewport-instructions"/);
    assert.match(html, /<h1 id="workspace-title"/);
    assert.match(html, /<aside class="sidebar sidebar-right"[^>]*aria-label=/);
    assert.match(html, /<section class="app-controls"[^>]*aria-label=/);
    assert.match(html, /id="maker-workspace-dialog"[^>]*aria-describedby="maker-workspace-description"/);
    assert.match(html, /id="project-tools-dialog"[^>]*aria-describedby="project-tools-description"/);
    assert.match(html, /id="export-dialog"[^>]*aria-describedby="export-dialog-description"/);
});

test('all static range controls have programmatic names', () => {
    const ranges = [...html.matchAll(/<input\b[^>]*\btype="range"[^>]*>/g)].map(match => match[0]);
    assert.ok(ranges.length > 20, 'expected the application range controls to be present');

    for (const range of ranges) {
        const id = range.match(/\bid="([^"]+)"/)?.[1];
        assert.ok(id, `range is missing an id: ${range}`);
        assert.ok(html.includes(`for="${id}"`), `range #${id} is missing its label`);
    }
});

test('colour palettes and upload triggers are keyboard and screen reader reachable', () => {
    for (const paletteId of [
        'component-color-palette',
        'deck-button-colour-label',
        'deck-joystick-colour-label',
        'apron-button-colour-label'
    ]) {
        assert.ok(html.includes(paletteId), `missing accessible colour palette hook ${paletteId}`);
    }

    const decalInput = html.match(/<input\b[^>]*id="decal-file-input"[^>]*>/)?.[0] || '';
    const hardwareInput = html.match(/<input\b[^>]*id="hardware-definition-import"[^>]*>/)?.[0] || '';
    assert.doesNotMatch(decalInput, /\bhidden\b/);
    assert.doesNotMatch(hardwareInput, /\bhidden\b/);
    assert.match(decalInput, /accessible-file-input/);
    assert.match(hardwareInput, /accessible-file-input/);
    assert.match(css, /\.accessible-file-input[\s\S]*opacity:\s*0/);
    assert.match(css, /\.maker-file-button:focus-within/);
});

test('tutorial invitation uses a native dialog and offers durable user choices', () => {
    assert.match(html, /<dialog id="tutorial-layer"[^>]*aria-describedby="tutorial-copy"/);
    assert.match(html, /id="btn-tutorial-skip"/);
    assert.match(html, /id="btn-tutorial-remind"/);
    assert.match(html, /id="btn-tutorial-dismiss"/);
    assert.match(html, /id="btn-tutorial-start"/);
    assert.match(tutorial, /showModal\(\)/);
    assert.match(tutorial, /captureContext\(\)/);
    assert.match(tutorial, /restoreContext\(\)/);
    assert.match(tutorial, /PROMPT_DISMISSED/);
    assert.match(tutorial, /REMINDER_DELAY_MS/);
    assert.match(tutorial, /snapshot\.focus\.focus\(\)/);
});

test('focus, contrast preference and responsive safeguards are shipped', () => {
    assert.match(css, /input\[type="range"\]:focus-visible/);
    assert.match(css, /\.toggle-switch:focus-within/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /@media \(forced-colors: active\)/);
    assert.match(css, /#btn-project-tools\s*\{[\s\S]*?display:\s*inline-flex/);
    assert.match(css, /\.global-actions\s*\{[\s\S]*?overflow-x:\s*auto/);
    assert.match(css, /\.maker-finding\.error:not\(:has\(\.finding-severity,\s*\.issue-severity\)\)::before[\s\S]*?content:\s*"Error"/);
});
