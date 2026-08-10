import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { assertPublishedAssets, REQUIRED_WEB_ASSETS } from './publish-smoke.mjs';

test('source web root contains every asset required by the desktop publish', async () => {
    const result = await assertPublishedAssets(resolve('.'));
    assert.equal(result.assetCount, REQUIRED_WEB_ASSETS.length);
    assert.ok(result.referencedScripts.some(source => source.replace(/^\.\//, '') === 'js/app.js'));
    assert.ok(REQUIRED_WEB_ASSETS.includes('js/guided-tutorial.js'));
    assert.ok(REQUIRED_WEB_ASSETS.includes('js/help-registry.js'));
    assert.ok(REQUIRED_WEB_ASSETS.includes('js/help-system.js'));
    assert.ok(REQUIRED_WEB_ASSETS.includes('js/status-service.js'));
    assert.ok(REQUIRED_WEB_ASSETS.includes('js/workspace-shell.js'));
    assert.ok(result.moduleAssets.includes('js/status-service.js'));
    assert.ok(result.moduleAssets.includes('js/workspace-shell.js'));
    assert.ok(REQUIRED_WEB_ASSETS.includes('assets/cabinet-crafter-icon.svg'));
});
