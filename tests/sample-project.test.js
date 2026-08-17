import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../wwwroot/js/lib/three.module.js';
import { Cabinet, normalizeParams } from '../wwwroot/js/cabinet.js';
import { parseProjectDocument } from '../wwwroot/js/export.js';
import { validateProjectDocument } from '../wwwroot/js/project-document.js';
import { BUILT_IN_HARDWARE_DEFINITIONS, normalizeHardwareLibrary } from '../wwwroot/js/hardware-library.js';
import { analyzeArcadeBuild } from '../wwwroot/js/arcade-intelligence.js';
import { buildCostedHardwareSchedule, buildProcurementBom } from '../wwwroot/js/procurement.js';

function installHeadlessDom() {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const noop = () => {};
    const context = new Proxy({}, {
        get: (target, property) => target[property] ?? noop,
        set: (target, property, value) => {
            target[property] = value;
            return true;
        }
    });
    globalThis.document = {
        createElement: () => ({ width: 0, height: 0, getContext: () => context }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
    globalThis.window = {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout
    };
    return () => {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    };
}

test('Workshop Upright remains a complete, costed and fabrication-ready sample', async () => {
    const restoreDom = installHeadlessDom();
    try {
        const text = await readFile(new URL('../examples/workshop-upright.cabinet.json', import.meta.url), 'utf8');
        const raw = JSON.parse(text);
        const validationErrors = validateProjectDocument(raw).filter(item => item.severity === 'error');
        assert.deepEqual(validationErrors, []);
        assert.equal(raw.schemaVersion, 2);
        assert.equal(raw.project.name, 'Workshop Upright');
        assert.equal(raw.project.basedOnPreset, 'standard');
        assert.deepEqual(raw.materials, raw.design.params.materials);
        assert.deepEqual(raw.fabricationSettings, raw.design.params.fabricationSettings);

        const loaded = parseProjectDocument(text);
        const params = normalizeParams(loaded.params);
        assert.equal(params.width, 650);
        assert.equal(params.height, 1700);
        assert.equal(params.depth, 600);
        assert.equal(params.cpHeight, 1020);
        assert.equal(params.screenFrameDepth, 18);
        assert.equal(params.materials.length, 1);
        assert.equal(params.materials[0].id, 'mdf-18');
        assert.equal(params.materials[0].quantityAvailable, 3);

        const cabinet = new Cabinet(new THREE.Scene(), params);
        const manifest = cabinet.getFabricationManifest();
        const preflight = cabinet.getPreflightResults();
        assert.deepEqual(
            preflight.reduce((counts, item) => ({ ...counts, [item.severity]: counts[item.severity] + 1 }), {
                error: 0,
                warning: 0,
                info: 0
            }),
            { error: 0, warning: 0, info: 1 }
        );
        assert.equal(manifest.parts.filter(part => part.includeInFabrication !== false).length, 23);
        assert.ok(manifest.parts.every(part => part.includeInFabrication === false || part.materialId === 'mdf-18'));

        const hardwareLibrary = normalizeHardwareLibrary([
            ...BUILT_IN_HARDWARE_DEFINITIONS,
            ...(params.hardwareDefinitions || [])
        ]);
        const analysis = analyzeArcadeBuild(manifest, params, { hardwareLibrary });
        const hardwareSchedule = buildCostedHardwareSchedule(analysis.hardwareSchedule, {
            hardwareCosts: params.fabricationSettings.hardwareCosts,
            additionalHardware: params.fabricationSettings.additionalHardware
        });
        const procurement = buildProcurementBom([], hardwareSchedule, { currencyCode: 'GBP' });
        assert.equal(analysis.summary.hardwareItems, 17);
        assert.equal(analysis.summary.harnessLengthM, 13.9);
        assert.equal(hardwareSchedule.length, 6);
        assert.equal(procurement.summary.hardwareCost, 427.35);
        assert.equal(procurement.summary.unpricedLineCount, 0);

        const persistedPlan = params.fabricationSettings.nesting.persistedPlan.plan;
        assert.equal(persistedPlan.selectedStrategy, 'area');
        assert.equal(persistedPlan.sheets.length, 3);
        assert.deepEqual(persistedPlan.sheets.map(sheet => sheet.placements.length), [10, 5, 8]);
        assert.equal(persistedPlan.totals.utilizationPercent, 81.9);
        assert.equal(persistedPlan.totals.unplacedCount, 0);
        assert.equal(persistedPlan.unplaced.length, 0);
        assert.equal(persistedPlan.findings.length, 0);
        assert.equal(params.materials[0].pricePerSheet * persistedPlan.totals.sheetCount, 126);

        const stages = params.fabricationSettings.workflow.stages;
        assert.deepEqual(Object.keys(stages), ['design', 'hardware', 'review', 'sheets', 'export']);
        assert.ok(Object.values(stages).every(stage => stage.status === 'confirmed'));
    } finally {
        restoreDom();
    }
});
