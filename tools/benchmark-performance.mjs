import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webRoot = join(repositoryRoot, 'wwwroot');
let benchmarkSink = null;

if (process.argv.includes('--cold-import')) {
    const startedAt = performance.now();
    await import(pathToFileURL(join(webRoot, 'js', 'ui.js')).href);
    process.stdout.write(JSON.stringify({ elapsedMs: performance.now() - startedAt }));
} else {
    await runBenchmarks();
}

async function runBenchmarks() {
    const coldImport = measureColdImports(2, 9);
    const previousDocument = globalThis.document;
    globalThis.document = createCanvasDocumentStub();

    try {
        const [THREE, cabinetModule, nestingModule, exportModule, packModule, projectModule] = await Promise.all([
            import(pathToFileURL(join(webRoot, 'js', 'lib', 'three.module.js')).href),
            import(pathToFileURL(join(webRoot, 'js', 'cabinet.js')).href),
            import(pathToFileURL(join(webRoot, 'js', 'nesting.js')).href),
            import(pathToFileURL(join(webRoot, 'js', 'export.js')).href),
            import(pathToFileURL(join(webRoot, 'js', 'manufacturing-pack.js')).href),
            import(pathToFileURL(join(webRoot, 'js', 'project-document.js')).href)
        ]);
        const { Cabinet, PRESETS, cloneParams } = cabinetModule;
        const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
        const stableManifest = cabinet.getFabricationManifest();
        const stablePreflight = cabinet.getPreflightResults();
        const projectArtifact = exportModule.saveProject(cabinet, {
            download: false,
            projectName: 'Performance benchmark'
        });
        if (!projectArtifact.ok) throw new Error('Benchmark project serialization failed.');

        const results = {};
        results.coldUiModuleImport = coldImport;
        results.cabinetConstruct = await measureOperation({ warmup: 3, iterations: 20 }, index => {
            const instance = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
            benchmarkSink = instance.panelMeshes.length + index;
        });
        results.cabinetRebuild = await measureOperation({ warmup: 5, iterations: 30 }, index => {
            cabinet.params.width = index % 2 ? 650 : 651;
            cabinet.build();
            benchmarkSink = cabinet.panelMeshes.length;
        });
        results.parameterUpdateAndRegeneration = await measureOperation({ warmup: 5, iterations: 30 }, index => {
            cabinet.updateParams({ width: index % 2 ? 650 : 651 });
            benchmarkSink = cabinet.panelMeshes.length;
        });
        results.selectionAppearanceUpdate = await measureOperation({ warmup: 10, iterations: 100 }, index => {
            cabinet.selectPanel(index % 2 ? 'panel_cp' : 'panel_bezel');
            benchmarkSink = cabinet.selectedPanelId;
        });
        results.fabricationManifest = await measureOperation({ warmup: 10, iterations: 80 }, () => {
            benchmarkSink = cabinet.getFabricationManifest().parts.length;
        });
        results.manifestPreflight = await measureOperation({ warmup: 8, iterations: 60 }, () => {
            benchmarkSink = cabinet.getPreflightResults().length;
        });
        results.interactiveNesting = await measureOperation({ warmup: 1, iterations: 5 }, () => {
            const plan = nestingModule.createNestingPlan(stableManifest, stableManifest.materials, {
                includeCandidates: true
            });
            benchmarkSink = plan.sheets.length + (plan.candidates?.length || 0);
        });
        const nestingPlan = nestingModule.createNestingPlan(stableManifest, stableManifest.materials);
        results.nestingPlanValidationOnly = await measureOperation({ warmup: 10, iterations: 100 }, () => {
            benchmarkSink = nestingModule.validateNestingPlan(nestingPlan, stableManifest.materials).length;
        });
        results.projectParseAndNormalize = await measureOperation({ warmup: 15, iterations: 150 }, () => {
            benchmarkSink = exportModule.parseProjectDocument(projectArtifact.content).params.width;
        });
        results.projectSerializeForSave = await measureOperation({ warmup: 10, iterations: 80 }, () => {
            benchmarkSink = exportModule.saveProject(cabinet, {
                download: false,
                projectName: 'Performance benchmark'
            }).content.length;
        });
        const canonicalDocument = projectModule.createProjectDocument({
            name: 'Autosave benchmark',
            params: cloneParams(cabinet.params),
            viewState: { screwsVisible: true }
        });
        results.autosaveJsonSerialization = await measureOperation({ warmup: 15, iterations: 150 }, () => {
            const content = JSON.stringify(canonicalDocument);
            benchmarkSink = projectModule.utf8ByteLength(content);
        });
        results.machineSvgExport = await measureOperation({ warmup: 5, iterations: 30 }, () => {
            const artifact = exportModule.buildFabricationExport(stableManifest, {
                preflight: stablePreflight,
                acknowledgeWarnings: true,
                download: false
            });
            benchmarkSink = artifact.content?.length || 0;
        });
        results.manufacturingPackage = await measureOperation({ warmup: 1, iterations: 3 }, () => {
            const artifact = packModule.buildManufacturingPackage(stableManifest, stablePreflight, {
                acknowledgeWarnings: true,
                projectName: 'Performance benchmark',
                nestingPlan
            });
            benchmarkSink = artifact.zipBytes.length;
        });

        const memory = measureRebuildMemory(cabinet, 40);
        const startupPayload = measureStartupPayload();
        const fullPayload = measureDirectoryPayload(webRoot);
        const releaseZipPath = join(repositoryRoot, 'artifacts', 'release', 'CabinetCrafter-2.0.0-win-x64.zip');

        const report = {
            schema: 'cabinet-crafter-performance-benchmark-v1',
            environment: {
                node: process.version,
                platform: `${process.platform}-${process.arch}`,
                gcExposed: typeof globalThis.gc === 'function'
            },
            methodology: {
                timeUnit: 'milliseconds',
                statistics: ['mean', 'median', 'p95', 'min', 'max'],
                isolation: 'Single process except cold UI imports, which use fresh child processes.',
                warmupAndRepeatCounts: Object.fromEntries(Object.entries(results).map(([name, value]) => [name, {
                    warmup: value.warmup,
                    iterations: value.iterations
                }]))
            },
            fixture: {
                preset: 'standard',
                panels: cabinet.panelMeshes.length,
                manifestParts: stableManifest.parts.length,
                preflightFindings: stablePreflight.length,
                projectBytes: Buffer.byteLength(projectArtifact.content, 'utf8')
            },
            timings: results,
            memory,
            payload: {
                startup: startupPayload.eager,
                deferred: startupPayload.deferred,
                deferredUnique: startupPayload.deferredUnique,
                fullWebRoot: fullPayload,
                releaseZipBytes: existsSync(releaseZipPath) ? statSync(releaseZipPath).size : null
            }
        };
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

async function measureOperation({ warmup, iterations }, operation) {
    for (let index = 0; index < warmup; index++) await operation(index);
    const samples = [];
    for (let index = 0; index < iterations; index++) {
        const startedAt = performance.now();
        await operation(index);
        samples.push(performance.now() - startedAt);
    }
    return { warmup, iterations, ...summarize(samples) };
}

function measureColdImports(warmup, iterations) {
    const samples = [];
    const total = warmup + iterations;
    for (let index = 0; index < total; index++) {
        const child = spawnSync(process.execPath, [scriptPath, '--cold-import'], {
            cwd: repositoryRoot,
            encoding: 'utf8',
            windowsHide: true,
            timeout: 30000
        });
        if (child.status !== 0) {
            throw new Error(`Cold import child failed: ${child.stderr || child.stdout}`);
        }
        const elapsedMs = Number(JSON.parse(child.stdout).elapsedMs);
        if (index >= warmup) samples.push(elapsedMs);
    }
    return { warmup, iterations, ...summarize(samples) };
}

function summarize(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return {
        mean: round(total / Math.max(1, sorted.length)),
        median: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
        min: round(sorted[0] || 0),
        max: round(sorted.at(-1) || 0)
    };
}

function percentile(sorted, fraction) {
    if (!sorted.length) return 0;
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return sorted[Math.min(sorted.length - 1, index)];
}

function round(value, precision = 3) {
    const factor = 10 ** precision;
    return Math.round(Number(value || 0) * factor) / factor;
}

function measureRebuildMemory(cabinet, iterations) {
    globalThis.gc?.();
    const before = process.memoryUsage();
    for (let index = 0; index < iterations; index++) {
        cabinet.params.width = index % 2 ? 650 : 651;
        cabinet.build();
    }
    globalThis.gc?.();
    const after = process.memoryUsage();
    return {
        iterations,
        heapUsedBeforeBytes: before.heapUsed,
        heapUsedAfterBytes: after.heapUsed,
        heapUsedDeltaBytes: after.heapUsed - before.heapUsed,
        rssBeforeBytes: before.rss,
        rssAfterBytes: after.rss,
        rssDeltaBytes: after.rss - before.rss,
        note: typeof globalThis.gc === 'function'
            ? 'Measured after explicit garbage collection.'
            : 'Informational only. Run Node with --expose-gc for a stable retained-heap reading.'
    };
}

function measureStartupPayload() {
    const eagerEntryFiles = [
        join(webRoot, 'index.html'),
        join(webRoot, 'style.css'),
        join(webRoot, 'js', 'app.js')
    ];
    const eagerFiles = new Set();
    eagerEntryFiles.forEach(file => collectStaticModuleGraph(file, eagerFiles));

    const claimedFiles = new Set(eagerFiles);
    const deferredFiles = new Set();
    const deferred = {};
    const deferredEntries = {
        guidedTutorial: join(webRoot, 'js', 'guided-tutorial.js'),
        manufacturingPackage: join(webRoot, 'js', 'manufacturing-pack.js'),
        nestingWorker: join(webRoot, 'js', 'nesting-worker.js')
    };
    Object.entries(deferredEntries).forEach(([name, entry]) => {
        const graph = new Set();
        collectStaticModuleGraph(entry, graph);
        const incrementalFiles = [...graph].filter(file => !claimedFiles.has(file));
        incrementalFiles.forEach(file => {
            claimedFiles.add(file);
            deferredFiles.add(file);
        });
        deferred[name] = measureFiles(incrementalFiles);
    });
    return {
        eager: measureFiles([...eagerFiles]),
        deferred,
        deferredUnique: measureFiles([...deferredFiles])
    };
}

function collectStaticModuleGraph(filePath, files) {
    const resolvedPath = resolve(filePath);
    if (files.has(resolvedPath) || !existsSync(resolvedPath)) return;
    files.add(resolvedPath);
    if (extname(resolvedPath) !== '.js') return;
    const source = readFileSync(resolvedPath, 'utf8');
    const importPattern = /(?:^|\n)\s*(?:import|export)\s+(?!\()(?:(?:[^'";]+?)\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importPattern)) {
        if (!match[1].startsWith('.')) continue;
        collectStaticModuleGraph(resolve(join(resolvedPath, '..', match[1])), files);
    }
}

function measureDirectoryPayload(directory) {
    return measureFiles(listFiles(directory));
}

function listFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? listFiles(path) : [path];
    });
}

function measureFiles(files) {
    let rawBytes = 0;
    let gzipBytes = 0;
    files.forEach(file => {
        const content = readFileSync(file);
        rawBytes += content.length;
        gzipBytes += gzipSync(content, { level: 9 }).length;
    });
    return {
        files: files.length,
        rawBytes,
        gzipBytes,
        compressionRatio: rawBytes ? round(gzipBytes / rawBytes, 4) : 0
    };
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
