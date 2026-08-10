import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const webRoot = resolve(repositoryRoot, 'wwwroot');
const canvasMetrics = {
    contexts: 0,
    drawOperations: 0
};

globalThis.document = createCanvasDocumentStub(canvasMetrics);

const [THREE, cabinetModule] = await Promise.all([
    import(pathToFileURL(resolve(webRoot, 'js/lib/three.module.js')).href),
    import(pathToFileURL(resolve(webRoot, 'js/cabinet.js')).href)
]);

const { Cabinet, PRESETS, cloneParams } = cabinetModule;
const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
const parameterCorpus = [
    { preset: 'standard', patch: { width: 650, height: 1700, depth: 600 } },
    { preset: 'standard-wide', patch: { width: 900, height: 1900, depth: 720, controlProfileSupportCount: 2, controlProfileSupportSpacing: 320 } },
    { preset: 'standard-compact', patch: { width: 520, height: 1450, depth: 500, cpHeight: 840, cpDepth: 235 } },
    { preset: 'bar-top', patch: { ...cloneParams(PRESETS.barstool), width: 760, height: 1420, depth: 680 } },
    { preset: 'hardware-heavy', patch: {
        controls: {
            deck: {
                players: 4,
                buttonsPerPlayer: 8,
                rows: 2,
                layout: 'vee'
            }
        }
    } },
    { preset: 'exploded', patch: { exploded: 65, controlProfileSupportCount: 2, controlProfileSupportSpacing: 280 } }
];

const results = {};
results.construct = measure(8, 40, index => {
    const instance = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    return instance.panelMeshes.length + index;
});
results.rebuild = measure(10, 80, index => {
    cabinet.params.width = index % 2 ? 650 : 651;
    cabinet.build();
    return cabinet.panelMeshes.length;
});
results.updateParams = measure(10, 80, index => {
    cabinet.updateParams({ width: index % 2 ? 650 : 651 });
    return cabinet.panelMeshes.length;
});
results.parameterCorpus = measure(3, 24, index => {
    const fixture = parameterCorpus[index % parameterCorpus.length];
    cabinet.updateParams(fixture.patch);
    return cabinet.panelMeshes.length;
});
results.panelLookup = measure(50, 5000, index => {
    return cabinet.getPanelById(index % 2 ? 'panel_cp' : 'panel_control_riser')?.userData.id;
});
results.selection = measure(20, 300, index => {
    cabinet.selectPanel(index % 2 ? 'panel_cp' : 'panel_bezel');
    return cabinet.selectedPanelId;
});
results.visibility = measure(20, 1000, index => {
    cabinet.setPanelVisibility('panel_cp', index % 2 === 0);
    return cabinet.isPanelVisible('panel_cp');
});

const corpusVerification = [];
for (const fixture of parameterCorpus) {
    cabinet.updateParams({
        ...cloneParams(PRESETS[fixture.preset === 'bar-top' ? 'barstool' : 'standard']),
        ...fixture.patch
    });
    const manifest = cabinet.getFabricationManifest();
    const preflight = cabinet.getPreflightResults();
    corpusVerification.push({
        fixture: fixture.preset,
        panels: cabinet.panelMeshes.length,
        parts: manifest.parts.length,
        operations: manifest.operations.length,
        errors: preflight.filter(item => item.severity === 'error').length,
        fingerprint: fingerprintCabinet(cabinet, manifest)
    });
}

const canvasBefore = { ...canvasMetrics };
for (let index = 0; index < 10; index++) {
    cabinet.params.width = index % 2 ? 650 : 651;
    cabinet.build();
}
const canvasPerTenRebuilds = {
    contexts: canvasMetrics.contexts - canvasBefore.contexts,
    drawOperations: canvasMetrics.drawOperations - canvasBefore.drawOperations
};

const memory = measureMemory(cabinet, 120);
const sceneResources = measureSceneResources(cabinet.group);

process.stdout.write(`${JSON.stringify({
    schema: 'cabinet-crafter-cabinet-runtime-v1',
    environment: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        gcExposed: typeof globalThis.gc === 'function'
    },
    methodology: {
        unit: 'milliseconds',
        sequentialSingleProcess: true
    },
    timings: results,
    canvasPerTenRebuilds,
    sceneResources,
    memory,
    corpusVerification
}, null, 2)}\n`);

function measure(warmup, iterations, operation) {
    let sink = null;
    for (let index = 0; index < warmup; index++) sink = operation(index);
    const samples = [];
    for (let index = 0; index < iterations; index++) {
        const startedAt = performance.now();
        sink = operation(index);
        samples.push(performance.now() - startedAt);
    }
    if (sink === Symbol.for('never')) throw new Error('Unreachable benchmark sink.');
    return { warmup, iterations, ...summarize(samples) };
}

function measureSceneResources(root) {
    let meshes = 0;
    const geometries = new Set();
    const materials = new Set();
    root.traverse(object => {
        if (!object.isMesh && !object.isLine && !object.isLineSegments) return;
        meshes++;
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        objectMaterials.filter(Boolean).forEach(material => materials.add(material));
    });
    return {
        renderableObjects: meshes,
        uniqueGeometries: geometries.size,
        uniqueMaterials: materials.size
    };
}

function summarize(samples) {
    const sorted = [...samples].sort((left, right) => left - right);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    return {
        mean: round(mean),
        median: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
        min: round(sorted[0]),
        max: round(sorted.at(-1))
    };
}

function percentile(sorted, fraction) {
    const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
    return sorted[Math.min(sorted.length - 1, index)];
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

function fingerprintCabinet(instance, manifest) {
    const panels = instance.panelMeshes.map(mesh => ({
        id: mesh.userData.id,
        position: mesh.position.toArray().map(round),
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(round),
        scale: mesh.scale.toArray().map(round),
        vertices: Array.from(mesh.geometry?.attributes?.position?.array || [], round),
        slots: mesh.userData.joinerySlots || [],
        tongues: mesh.userData.dadoTongues || []
    })).sort((left, right) => left.id.localeCompare(right.id));
    const fabrication = {
        parts: manifest.parts,
        operations: manifest.operations,
        contours: manifest.contours
    };
    return createHash('sha256')
        .update(JSON.stringify({ panels, fabrication }))
        .digest('hex');
}

function measureMemory(instance, iterations) {
    globalThis.gc?.();
    const before = process.memoryUsage();
    const checkpointSize = 40;
    const checkpoints = [];
    for (let start = 0; start < iterations; start += checkpointSize) {
        const end = Math.min(iterations, start + checkpointSize);
        for (let index = start; index < end; index++) {
            instance.params.width = index % 2 ? 650 : 651;
            instance.build();
        }
        globalThis.gc?.();
        checkpoints.push({
            rebuilds: end,
            heapUsedBytes: process.memoryUsage().heapUsed
        });
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
        checkpoints
    };
}

function createCanvasDocumentStub(metrics) {
    const context = new Proxy({}, {
        get: (target, property) => {
            if (property in target) return target[property];
            const operation = () => {
                metrics.drawOperations++;
            };
            target[property] = operation;
            return operation;
        },
        set: (target, property, value) => {
            target[property] = value;
            return true;
        }
    });
    return {
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => {
                metrics.contexts++;
                return context;
            }
        })
    };
}
