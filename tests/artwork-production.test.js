import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createArtworkTemplate,
    createMirroredSideTemplates,
    serializeArtworkTemplateSvg,
    validateArtworkTemplate
} from '../wwwroot/js/artwork-production.js';
import { enrichManifestPart } from '../wwwroot/js/manifest-utils.js';
import { createManifestFixture } from './helpers/fixtures.js';

test('full-scale artwork template carries outline, bleed, safe area, cutout mask, and face', () => {
    const manifest = createManifestFixture();
    const control = enrichManifestPart(manifest, 'panel_cp');
    const template = createArtworkTemplate(control, { bleedMm: 12, safeMarginMm: 15 });
    assert.equal(template.units, 'mm');
    assert.equal(template.role, 'control-overlay');
    assert.equal(template.canvas.widthMm, 674);
    assert.equal(template.canvas.heightMm, 324);
    assert.equal(template.cutouts.length, 2);
    assert.equal(template.finishedFace, 'front');
});

test('artwork validation reports missing sources, insufficient bleed, and effective DPI', () => {
    const part = enrichManifestPart(createManifestFixture(), 'side_left');
    const template = createArtworkTemplate(part, {
        assets: [{
            id: 'low-res', name: 'Low resolution art', kind: 'raster', source: '',
            widthMm: 500, heightMm: 500, pixelWidth: 800, pixelHeight: 800, coversBleed: false
        }]
    });
    const codes = new Set(validateArtworkTemplate(template).map(item => item.code));
    assert.ok(codes.has('ARTWORK_DPI_LOW'));
    assert.ok(codes.has('ARTWORK_SOURCE_MISSING'));
    assert.ok(codes.has('ARTWORK_BLEED'));
    assert.equal(template.assets[0].effectiveDpi, 41);
});

test('artwork SVG is explicit millimetre 1:1 output with closed masks and print guides', () => {
    const template = createArtworkTemplate(enrichManifestPart(createManifestFixture(), 'panel_cp'));
    const svg = serializeArtworkTemplateSvg(template, { precision: 3 });
    assert.match(svg, /width="674mm" height="324mm"/);
    assert.match(svg, /viewBox="-12 -12 674 324"/);
    assert.match(svg, /<g id="CUT_MASK"/);
    assert.match(svg, /<g id="SAFE_AREA"/);
    assert.match(svg, / Z"\/>/);
    assert.match(svg, /1:1/);
});

test('paired side templates preserve left/right identity and mirror only the right artwork', () => {
    const manifest = createManifestFixture();
    const [left, right] = createMirroredSideTemplates(
        enrichManifestPart(manifest, 'side_left'),
        enrichManifestPart(manifest, 'side_right')
    );
    assert.equal(left.orientation, 'normal');
    assert.equal(right.orientation, 'mirrored');
    assert.match(serializeArtworkTemplateSvg(right), /scale\(-1 1\)/);
    assert.doesNotMatch(serializeArtworkTemplateSvg(left), /scale\(-1 1\)/);
});
