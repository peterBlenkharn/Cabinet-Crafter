import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../tools/benchmark-performance.mjs', import.meta.url), 'utf8');

test('performance payload separates eager and deferred module graphs', () => {
    const measureMethod = source.match(/function measureStartupPayload\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
    assert.match(measureMethod, /eagerEntryFiles/);
    assert.doesNotMatch(
        measureMethod.match(/const eagerEntryFiles = \[([\s\S]*?)\];/)?.[1] || '',
        /nesting-worker/
    );
    assert.match(measureMethod, /guidedTutorial/);
    assert.match(measureMethod, /manufacturingPackage/);
    assert.match(measureMethod, /nestingWorker/);
    assert.match(measureMethod, /claimedFiles/);
    assert.match(source, /collectStaticModuleGraph/);
    assert.doesNotMatch(source, /from\\s\*\|import\\s\*\\\(/);
});
