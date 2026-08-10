import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHardwareLayoutReference } from '../wwwroot/js/maker-workflow.js';

test('hardware reference renders every deck and apron control as non-editable geometry', () => {
    const manifest = {
        parts: [
            { id: 'panel_cp', dimensions: { widthMm: 700, lengthMm: 320 } },
            { id: 'panel_apron', dimensions: { widthMm: 700, lengthMm: 140 } }
        ]
    };
    const analysis = {
        hardwareInstances: [
            { id: 'p1-joy', definitionId: 'joystick-jlf-pattern', partId: 'panel_cp', xMm: 180, yMm: 120, label: 'P1 joystick' },
            { id: 'p1-b1', definitionId: 'button-30-snap', partId: 'panel_cp', xMm: 270, yMm: 110, label: 'P1 <A>' },
            { id: 'p2-joy', definitionId: 'joystick-jlf-pattern', partId: 'panel_cp', xMm: 500, yMm: 120, label: 'P2 joystick' },
            { id: 'start', definitionId: 'button-24-snap', partId: 'panel_apron', xMm: 350, yMm: 70, label: 'Start' }
        ]
    };

    const markup = renderHardwareLayoutReference(manifest, analysis);
    assert.match(markup, /Control deck[\s\S]*3 fitted/);
    assert.match(markup, /Front apron[\s\S]*1 fitted/);
    assert.match(markup, /role="img" aria-label="Control deck: 3 fitted controls"/);
    assert.match(markup, /P1 &lt;A&gt;/);
    assert.doesNotMatch(markup, /<button|disabled/);
});
