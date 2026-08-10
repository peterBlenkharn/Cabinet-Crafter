import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BUILT_IN_HARDWARE_DEFINITIONS,
    buildHardwareSchedule,
    buildWiringPlan,
    createHardwareDefinition,
    getHardwareOperations,
    instantiateHardware,
    normalizeHardwareLibrary,
    validateHardwareDefinitionInput,
    validateHardwareInstances
} from '../wwwroot/js/hardware-library.js';

const hostPart = { id: 'panel_cp', name: 'Control panel', widthMm: 600, lengthMm: 300, thicknessMm: 18 };

test('bundled arcade hardware covers core controls, display, service, and electronics categories', () => {
    const categories = new Set(BUILT_IN_HARDWARE_DEFINITIONS.map(item => item.category));
    for (const category of ['button', 'joystick', 'trackball', 'spinner', 'monitor', 'speaker', 'ventilation', 'service', 'power', 'electronics']) {
        assert.ok(categories.has(category), `missing ${category}`);
    }
    assert.ok(BUILT_IN_HARDWARE_DEFINITIONS.every(item => item.keepout.depthMm >= item.body.depthMm));
});

test('hardware instances generate typed, transformed panel operations', () => {
    const instance = instantiateHardware('joystick-jlf-pattern', {
        id: 'p1-stick', partId: 'panel_cp', xMm: 100, yMm: 50, rotationDeg: 90, encoderInput: 'P1'
    });
    const operations = getHardwareOperations(instance);
    assert.equal(operations.length, 5);
    assert.equal(operations[0].type, 'throughCut');
    assert.equal(operations[0].geometry.xMm, 100);
    assert.equal(operations[0].geometry.yMm, 50);
    assert.ok(operations.every(operation => operation.hardwareId === 'p1-stick' && operation.partId === 'panel_cp'));
});

test('custom hardware JSON normalizes safely and can replace a bundled definition by ID', () => {
    const custom = createHardwareDefinition({
        id: 'button-30-snap', category: 'button', name: 'Workshop 30 mm button',
        panelThickness: [1, 20], body: [35, 35, 45], keepout: [40, 40, 50],
        operations: [{ id: 'opening', type: 'throughCut', geometry: { kind: 'circle', xMm: 0, yMm: 0, diameterMm: 30 } }]
    });
    const library = normalizeHardwareLibrary([custom]);
    assert.equal(library.filter(item => item.id === 'button-30-snap').length, 1);
    assert.equal(library.find(item => item.id === 'button-30-snap').name, 'Workshop 30 mm button');
    assert.throws(() => instantiateHardware('does-not-exist', {}, library), /Unknown hardware definition/);
});

test('hardware imports reject malformed definitions before they enter the library', () => {
    const invalid = validateHardwareDefinitionInput({
        id: '',
        name: '',
        category: 'button',
        panelThickness: [20, 2],
        body: [0, 35, 45],
        keepout: [10, 10, 10],
        operations: [{ type: 'throughCut', geometry: { kind: 'circle', diameterMm: 0 } }]
    });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.length >= 4);

    const valid = validateHardwareDefinitionInput({
        id: 'workshop-button',
        name: 'Workshop button',
        category: 'button',
        supportedPanelThicknessMm: [2, 20],
        body: { widthMm: 35, heightMm: 35, depthMm: 45 },
        keepout: { widthMm: 45, heightMm: 45, depthMm: 55 },
        operations: [{
            id: 'opening',
            type: 'throughCut',
            geometry: { kind: 'circle', diameterMm: 30, xMm: 0, yMm: 0 }
        }]
    });
    assert.equal(valid.ok, true);
    assert.equal(valid.definition.id, 'workshop-button');
    assert.deepEqual(valid.definition.supportedPanelThicknessMm, [2, 20]);
});

test('hardware validation distinguishes hard body collisions from service-clearance warnings', () => {
    const valid = instantiateHardware('button-30-snap', { id: 'valid', partId: 'panel_cp', xMm: 100, yMm: 50 });
    assert.deepEqual(validateHardwareInstances([valid], [hostPart]), []);

    const outside = instantiateHardware('button-30-snap', { id: 'outside', partId: 'panel_cp', xMm: 595, yMm: 50 });
    const overlap = instantiateHardware('button-30-snap', { id: 'overlap', partId: 'panel_cp', xMm: 110, yMm: 50 });
    const serviceOnly = instantiateHardware('button-30-snap', { id: 'service', partId: 'panel_cp', xMm: 138, yMm: 50 });
    const missing = instantiateHardware('button-30-snap', { id: 'missing', partId: 'not-a-panel' });
    const findings = validateHardwareInstances([valid, outside, overlap, serviceOnly, missing], [{ ...hostPart, thicknessMm: 30 }]);
    const codes = new Set(findings.map(item => item.code));
    assert.ok(codes.has('HARDWARE_PANEL_THICKNESS'));
    assert.ok(codes.has('HARDWARE_CUTOUT_OUTSIDE'));
    assert.ok(codes.has('HARDWARE_BODY_COLLISION'));
    assert.ok(codes.has('HARDWARE_SERVICE_CLEARANCE'));
    assert.equal(findings.find(item => item.code === 'HARDWARE_BODY_COLLISION').severity, 'error');
    assert.equal(findings.find(item => item.code === 'HARDWARE_SERVICE_CLEARANCE').severity, 'warning');
    assert.ok(codes.has('HARDWARE_HOST_MISSING'));
});

test('hardware and wiring schedules reconcile quantities, connectors, and harness lengths', () => {
    const instances = [
        instantiateHardware('button-30-snap', { id: 'b1', partId: 'panel_cp', xMm: 100, yMm: 40, encoderInput: 'P1-B1' }),
        instantiateHardware('button-30-snap', { id: 'b2', partId: 'panel_cp', xMm: 150, yMm: 40, encoderInput: 'P1-B2' }),
        instantiateHardware('joystick-jlf-pattern', { id: 'j1', partId: 'panel_cp', xMm: -100, yMm: 0, encoderInput: 'P1-JOY' })
    ];
    const schedule = buildHardwareSchedule(instances);
    assert.equal(schedule.find(item => item.definitionId === 'button-30-snap').quantity, 2);
    const wiring = buildWiringPlan(instances);
    assert.equal(wiring.connections.length, 3);
    assert.equal(wiring.connectors.find(item => item.type === '2.8mm-spade').quantity, 2);
    assert.ok(wiring.estimatedHarnessLengthMm > 1200);
    assert.ok(wiring.estimatedHarnessLengthM > 0);
});
