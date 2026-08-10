import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createManifestFixture, snapshotManifest } from './helpers/fixtures.js';

const goldenPath = new URL('./fixtures/manifest-golden.json', import.meta.url);

test('Standard and Bar-top fabrication contracts match deterministic golden fixtures', async () => {
    const golden = JSON.parse(await readFile(goldenPath, 'utf8'));
    const actual = {
        standard: snapshotManifest(createManifestFixture('standard')),
        barTop: snapshotManifest(createManifestFixture('barstool'))
    };
    assert.deepEqual(actual, golden);
});
