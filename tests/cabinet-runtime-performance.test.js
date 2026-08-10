import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../wwwroot/js/lib/three.module.js';
import { Cabinet, PRESETS, cloneParams } from '../wwwroot/js/cabinet.js';

function withMeasuredDocument(run) {
    const previousDocument = globalThis.document;
    const metrics = { contexts: 0, drawOperations: 0 };
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
    globalThis.document = {
        createElement: () => ({
            width: 0,
            height: 0,
            getContext: () => {
                metrics.contexts++;
                return context;
            }
        })
    };
    try {
        return run(metrics);
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

test('unchanged panel canvases avoid redundant redraw and texture upload work', () => withMeasuredDocument(metrics => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    metrics.contexts = 0;
    metrics.drawOperations = 0;

    cabinet.build();
    assert.equal(metrics.contexts, 0);
    assert.equal(metrics.drawOperations, 0);

    cabinet.selectPanel('panel_cp');
    assert.equal(metrics.contexts, 1);
    assert.ok(metrics.drawOperations > 0);

    metrics.contexts = 0;
    metrics.drawOperations = 0;
    cabinet.updateComponentColor('panel_cp', '#2f7d58');
    assert.equal(metrics.contexts, 1);
    assert.ok(metrics.drawOperations > 0);
}));

test('identical screw meshes share immutable geometry within each build', () => withMeasuredDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    const shafts = cabinet.group.children.filter(object => object.userData.hardware === 'side_screw_shaft');
    const heads = cabinet.group.children.filter(object => object.userData.hardware === 'side_screw_head');
    const slots = cabinet.group.children.filter(object => object.userData.hardware === 'side_screw_slot');

    assert.ok(shafts.length > 4);
    assert.equal(new Set(shafts.map(object => object.geometry)).size, 1);
    assert.equal(new Set(heads.map(object => object.geometry)).size, 1);
    assert.equal(new Set(slots.map(object => object.geometry)).size, 1);
}));

test('shared geometry disposal and child removal events occur exactly once', () => withMeasuredDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    const shafts = cabinet.group.children.filter(object => object.userData.hardware === 'side_screw_shaft');
    const sharedGeometry = shafts[0].geometry;
    let geometryDisposals = 0;
    let removalEvents = 0;
    sharedGeometry.addEventListener('dispose', () => {
        geometryDisposals++;
    });
    shafts[0].addEventListener('removed', () => {
        removalEvents++;
    });

    cabinet.build();
    assert.equal(geometryDisposals, 1);
    assert.equal(removalEvents, 1);
}));

test('panel lookup map tracks every rebuilt mesh without changing identity', () => withMeasuredDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    cabinet.updateParams({ width: 720, controlProfileSupportCount: 2 });

    assert.equal(cabinet.panelMeshById.size, cabinet.panelMeshes.length);
    cabinet.panelMeshes.forEach(mesh => {
        assert.equal(cabinet.getPanelById(mesh.userData.id), mesh);
    });
}));

test('runtime optimisations preserve finite geometry and clean preflight across valid parameter cases', () => withMeasuredDocument(() => {
    const cases = [
        {
            name: 'standard',
            params: cloneParams(PRESETS.standard)
        },
        {
            name: 'wide with two full profile supports',
            params: {
                ...cloneParams(PRESETS.standard),
                width: 900,
                height: 1900,
                depth: 720,
                controlProfileSupportCount: 2,
                controlProfileSupportSpacing: 320
            }
        },
        {
            name: 'bar top',
            params: {
                ...cloneParams(PRESETS.barstool),
                width: 760,
                height: 1420,
                depth: 680
            }
        },
        {
            name: 'exploded two support view',
            params: {
                ...cloneParams(PRESETS.standard),
                exploded: 65,
                controlProfileSupportCount: 2,
                controlProfileSupportSpacing: 280
            }
        },
        {
            name: 'optional service parts disabled',
            params: {
                ...cloneParams(PRESETS.standard),
                rearDoorEnabled: false,
                machineShelfEnabled: false,
                headerSupportEnabled: false
            }
        }
    ];

    cases.forEach(fixture => {
        const cabinet = new Cabinet(new THREE.Scene(), fixture.params);
        cabinet.panelMeshes.forEach(mesh => {
            const positions = mesh.geometry?.attributes?.position?.array || [];
            assert.ok(positions.length > 0, `${fixture.name} must retain panel geometry`);
            assert.ok(
                Array.from(positions).every(Number.isFinite),
                `${fixture.name} must retain finite panel geometry`
            );
        });
        const errors = cabinet.getPreflightResults().filter(item => item.severity === 'error');
        assert.deepEqual(errors, [], `${fixture.name} should pass fabrication preflight`);
    });
}));
