import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webModule = relativePath => import(pathToFileURL(resolve(repositoryRoot, 'wwwroot', 'js', relativePath)).href);
const warmup = readCount('--warmup', 3);
const iterations = readCount('--iterations', 15);
const interactivePlan = process.argv.includes('--interactive-plan');

globalThis.document = createCanvasDocumentStub();
const [THREE, { Cabinet, PRESETS, cloneParams }, { createNestingPlan }, { buildManufacturingPackage }] = await Promise.all([
    webModule('lib/three.module.js'),
    webModule('cabinet.js'),
    webModule('nesting.js'),
    webModule('manufacturing-pack.js')
]);
const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
const manifest = cabinet.getFabricationManifest();
const preflight = cabinet.getPreflightResults();
const nestingPlan = createNestingPlan(manifest, manifest.materials, { includeCandidates: interactivePlan });
const options = {
    acknowledgeWarnings: true,
    generatedAt: '2026-07-25T12:00:00.000Z',
    projectName: 'Performance benchmark',
    nestingPlan
};

for (let index = 0; index < warmup; index++) buildManufacturingPackage(manifest, preflight, options);

const samples = [];
let artifact = null;
for (let index = 0; index < iterations; index++) {
    const startedAt = performance.now();
    artifact = buildManufacturingPackage(manifest, preflight, options);
    samples.push(performance.now() - startedAt);
}

const sorted = [...samples].sort((first, second) => first - second);
globalThis.gc?.();
const heapBeforeArtifact = process.memoryUsage().heapUsed;
const memoryArtifact = buildManufacturingPackage(manifest, preflight, options);
globalThis.gc?.();
const heapWithZip = process.memoryUsage().heapUsed;
const memoryBase64 = memoryArtifact.base64;
globalThis.gc?.();
const heapWithBase64 = process.memoryUsage().heapUsed;
process.stdout.write(`${JSON.stringify({
    schema: 'cabinet-crafter-package-benchmark-v1',
    environment: { node: process.version, platform: `${process.platform}-${process.arch}` },
    interactivePlan,
    warmup,
    iterations,
    milliseconds: {
        mean: round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
        median: round(sorted[Math.floor(sorted.length / 2)]),
        p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
        min: round(sorted[0]),
        max: round(sorted.at(-1))
    },
    entries: artifact.entries.length,
    zipBytes: artifact.zipBytes.length,
    base64Characters: artifact.base64.length,
    zipSignature: createHash('sha256').update(artifact.zipBytes).digest('hex'),
    memory: {
        gcExposed: typeof globalThis.gc === 'function',
        heldPackageWithoutBase64Bytes: heapWithZip - heapBeforeArtifact,
        heldBase64AdditionalBytes: heapWithBase64 - heapWithZip,
        heldPackageWithBase64Bytes: heapWithBase64 - heapBeforeArtifact,
        keepAlive: memoryBase64.length + memoryArtifact.zipBytes.length
    }
}, null, 2)}\n`);

function readCount(flag, fallback) {
    const index = process.argv.indexOf(flag);
    const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
    return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

function createCanvasDocumentStub() {
    const noop = () => {};
    const context = new Proxy({}, {
        get: (target, property) => target[property] ?? noop,
        set: (target, property, value) => {
            target[property] = value;
            return true;
        }
    });
    return {
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => context
        })
    };
}
