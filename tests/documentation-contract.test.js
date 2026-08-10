import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readDocument(relativePath) {
    return readFile(join(repositoryRoot, relativePath), 'utf8');
}

test('internal-structure documentation covers every live support and cable parameter', async () => {
    const parameters = await readDocument('docs/PARAMETERS.md');
    const liveKeys = [
        'controlSupportEnabled',
        'controlSupportDrop',
        'controlCablePortWidth',
        'controlCablePortHeight',
        'controlCablePortOffset',
        'controlRiserEnabled',
        'controlProfileSupportCount',
        'controlProfileSupportSpacing',
        'controlRiserLateralPosition',
        'controlRiserCablePortWidth',
        'controlRiserCablePortHeight',
        'controlRiserCablePortOffset',
        'displaySupportEnabled',
        'displayCablePortWidth',
        'displayCablePortHeight',
        'displayCablePortOffset',
        'headerSupportEnabled',
        'headerSupportDrop',
        'monitorCablePortWidth',
        'monitorCablePortHeight',
        'monitorCablePortOffset',
        'machineShelfEnabled',
        'machineShelfHeight',
        'machineCablePortWidth',
        'machineCablePortHeight',
        'machineCablePortOffset'
    ];

    for (const key of liveKeys) {
        assert.ok(parameters.includes(`| \`${key}\` |`), `${key} is missing from the parameter reference`);
    }

    for (const legacyKey of [
        'controlSupportRearInset',
        'controlSupportFrontRise',
        'machineShelfDepth',
        'machineShelfInset'
    ]) {
        assert.ok(parameters.includes(`\`${legacyKey}\``), `${legacyKey} compatibility note is missing`);
    }
});

test('geometry documentation names the complete structural load path', async () => {
    const geometry = await readDocument('docs/GEOMETRY_PIPELINE.md');
    for (const partId of [
        'panel_cp_support',
        'panel_control_riser',
        'panel_control_riser_2',
        'panel_display_support',
        'panel_header_support',
        'panel_machine_shelf'
    ]) {
        assert.ok(geometry.includes(`\`${partId}\``), `${partId} is missing from the geometry reference`);
    }
    assert.match(geometry, /complete cabinet side profile from the bottom\/base to the top\/roof/i);
    assert.match(geometry, /front end face angle-matched to the display panel/i);
    assert.match(geometry, /outer front endpoint is solved on `panel_recess`/i);
    assert.match(geometry, /ordinary fabrication manifest contains two mandatory full-depth `throughCut` operations/i);
    assert.match(geometry, /complementary open-ended cross-lap slot/i);
    assert.match(geometry, /horizontal panel slides into the profile support along its length/i);
    assert.match(geometry, /Cable slots[\s\S]*typed `throughCut` operations/);
});

test('documentation index exposes release, privacy, safety, security and licence guidance', async () => {
    const index = await readDocument('docs/INDEX.md');
    for (const destination of [
        'RELEASE_GUIDE.md',
        'PRIVACY_AND_OFFLINE.md',
        'BEFORE_YOU_CUT.md',
        'RELEASING.md',
        'REPOSITORY_STRUCTURE.md',
        '../SECURITY.md',
        '../LICENSE',
        '../THIRD_PARTY_NOTICES.md'
    ]) {
        assert.ok(index.includes(destination), `${destination} is missing from the documentation index`);
    }
});

test('public documentation distinguishes source, release assets and generated folders', async () => {
    const readme = await readDocument('README.md');
    const structure = await readDocument('docs/REPOSITORY_STRUCTURE.md');
    assert.match(readme, /Download the latest published Windows x64 release/);
    assert.match(readme, /Source code \(zip\).*source rather than a runnable application/s);
    assert.match(readme, /GitHub Actions artifacts are short-lived test outputs/);
    assert.match(readme, /RELEASE_MANIFEST\.sha256/);

    for (const expected of [
        '`bin/Debug/`',
        '`bin/Release/`',
        '`obj/`',
        '`artifacts/publish/`',
        '`artifacts/release/staging/`',
        '`tools/tmp/`'
    ]) {
        assert.ok(structure.includes(expected), `${expected} is missing from the repository folder guide`);
    }
});
