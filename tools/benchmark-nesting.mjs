import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webModule = relativePath => import(pathToFileURL(resolve(repositoryRoot, 'wwwroot', 'js', relativePath)).href);
const warmup = readCount('--warmup', 1);
const iterations = readCount('--iterations', 3);

globalThis.document = createCanvasDocumentStub();
const [THREE, { Cabinet, PRESETS, cloneParams }, { createNestingPlan }] = await Promise.all([
    webModule('lib/three.module.js'),
    webModule('cabinet.js'),
    webModule('nesting.js')
]);
const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
const manifest = cabinet.getFabricationManifest();

for (let index = 0; index < warmup; index++) {
    createNestingPlan(manifest, manifest.materials, { includeCandidates: true });
}

const samples = [];
let plan = null;
for (let index = 0; index < iterations; index++) {
    const startedAt = performance.now();
    plan = createNestingPlan(manifest, manifest.materials, { includeCandidates: true });
    samples.push(performance.now() - startedAt);
}

const qualityPayload = plan.candidates.map(candidate => ({
    strategy: candidate.strategy,
    sheets: candidate.sheets.map(sheet => sheet.placements.map(placement => [
        placement.instanceId,
        placement.xMm,
        placement.yMm,
        placement.rotationDeg
    ])),
    totals: candidate.totals
}));
const sorted = [...samples].sort((first, second) => first - second);
process.stdout.write(`${JSON.stringify({
    schema: 'cabinet-crafter-nesting-benchmark-v1',
    environment: { node: process.version, platform: `${process.platform}-${process.arch}` },
    fixture: { preset: 'standard', parts: manifest.parts.length },
    warmup,
    iterations,
    milliseconds: {
        mean: round(samples.reduce((sum, value) => sum + value, 0) / samples.length),
        median: round(sorted[Math.floor(sorted.length / 2)]),
        min: round(sorted[0]),
        max: round(sorted.at(-1))
    },
    selectedStrategy: plan.selectedStrategy,
    candidateSummaries: plan.candidateSummaries,
    qualitySignature: createHash('sha256').update(JSON.stringify(qualityPayload)).digest('hex')
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
