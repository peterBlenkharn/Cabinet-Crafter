export const HARDWARE_LIBRARY_VERSION = 1;

export const BUILT_IN_HARDWARE_DEFINITIONS = Object.freeze([
    define({
        id: 'button-30-snap', category: 'button', name: '30 mm arcade button',
        panelThickness: [2, 18], body: [36, 36, 48], keepout: [42, 42, 58],
        operations: [circle('shaft', 'throughCut', 30)], cableExit: { side: 'back', clearanceMm: 35 },
        electrical: { connector: '2.8mm-spade', contacts: 2, currentMa: 20 }
    }),
    define({
        id: 'button-24-snap', category: 'button', name: '24 mm arcade button',
        panelThickness: [2, 18], body: [29, 29, 42], keepout: [35, 35, 52],
        operations: [circle('shaft', 'throughCut', 24)], cableExit: { side: 'back', clearanceMm: 30 },
        electrical: { connector: '2.8mm-spade', contacts: 2, currentMa: 20 }
    }),
    define({
        id: 'joystick-jlf-pattern', category: 'joystick', name: 'JLF-pattern joystick',
        panelThickness: [1, 24], body: [95, 70, 45], keepout: [125, 105, 70],
        operations: [circle('shaft', 'throughCut', 24), ...holePattern('mount', 4, 40, 40, 4.5)],
        cableExit: { side: 'rear', clearanceMm: 45 },
        movementEnvelope: { widthMm: 115, heightMm: 115, depthMm: 70 },
        electrical: { connector: '5-pin-joystick', contacts: 5, currentMa: 40 }
    }),
    define({
        id: 'trackball-3in', category: 'trackball', name: '3 inch trackball assembly',
        panelThickness: [2, 25], body: [165, 165, 95], keepout: [205, 205, 130],
        operations: [circle('ball', 'throughCut', 80), ...holePattern('mount', 4, 126, 126, 5)],
        movementEnvelope: { widthMm: 220, heightMm: 220, depthMm: 130 },
        cableExit: { side: 'rear', clearanceMm: 70 },
        electrical: { connector: 'usb-a', contacts: 1, currentMa: 300 }
    }),
    define({
        id: 'spinner-28', category: 'spinner', name: '28 mm spinner',
        panelThickness: [1, 20], body: [52, 52, 72], keepout: [70, 70, 90],
        operations: [circle('shaft', 'throughCut', 28)], cableExit: { side: 'back', clearanceMm: 45 },
        electrical: { connector: 'usb-a', contacts: 1, currentMa: 100 }
    }),
    define({
        id: 'monitor-24-vesa100', category: 'monitor', name: '24 inch monitor / VESA 100',
        panelThickness: [3, 30], body: [540, 320, 55], keepout: [575, 365, 120],
        operations: [...holePattern('vesa', 4, 100, 100, 5)], cableExit: { side: 'bottom', clearanceMm: 90 },
        serviceEnvelope: { widthMm: 600, heightMm: 390, depthMm: 180 },
        electrical: { connector: 'iec-c13', contacts: 1, currentMa: 1200 }
    }),
    define({
        id: 'speaker-4in', category: 'speaker', name: '4 inch cabinet speaker',
        panelThickness: [3, 30], body: [125, 125, 58], keepout: [145, 145, 75],
        operations: [circle('cone', 'throughCut', 92), ...radialHoles('mount', 4, 108, 4)],
        electrical: { connector: 'speaker-pair', contacts: 2, currentMa: 1000 }
    }),
    define({
        id: 'fan-120', category: 'ventilation', name: '120 mm fan',
        panelThickness: [1, 30], body: [120, 120, 28], keepout: [145, 145, 55],
        operations: [circle('airflow', 'throughCut', 112), ...holePattern('mount', 4, 105, 105, 4.5)],
        airflow: { diameterMm: 112, serviceClearanceMm: 40 },
        electrical: { connector: 'fan-3-pin', contacts: 1, currentMa: 250 }
    }),
    define({
        id: 'coin-door-compact', category: 'service', name: 'Compact coin door',
        panelThickness: [6, 30], body: [240, 360, 95], keepout: [280, 410, 180],
        operations: [rect('opening', 'throughCut', 205, 325, 4), ...holePattern('mount', 4, 222, 342, 5)],
        serviceEnvelope: { widthMm: 350, heightMm: 470, depthMm: 350 },
        cableExit: { side: 'top', clearanceMm: 60 },
        electrical: { connector: 'coin-switch', contacts: 4, currentMa: 50 }
    }),
    define({
        id: 'iec-c14-inlet', category: 'power', name: 'IEC C14 fused inlet',
        panelThickness: [1, 6], body: [50, 32, 55], keepout: [70, 55, 90],
        operations: [rect('opening', 'throughCut', 48, 28, 2), ...holePattern('mount', 2, 58, 0, 3.5)],
        serviceEnvelope: { widthMm: 80, heightMm: 65, depthMm: 120 },
        electrical: { connector: 'iec-c14', contacts: 1, currentMa: 10000 }
    }),
    define({
        id: 'dual-usb-panel', category: 'io', name: 'Dual USB panel connector',
        panelThickness: [1, 10], body: [45, 28, 45], keepout: [65, 50, 75],
        operations: [rect('opening', 'throughCut', 36, 20, 3), ...holePattern('mount', 2, 46, 0, 3.2)],
        electrical: { connector: 'usb-a', contacts: 2, currentMa: 1000 }
    }),
    define({
        id: 'encoder-4player', category: 'electronics', name: 'Four-player USB encoder',
        panelThickness: [0, 50], body: [170, 90, 24], keepout: [205, 130, 55],
        operations: [...holePattern('mount', 4, 158, 78, 3.2)], cableExit: { side: 'edge', clearanceMm: 70 },
        electrical: { connector: 'usb-b', contacts: 48, currentMa: 300 }
    }),
    define({
        id: 'mini-pc-180', category: 'computer', name: 'Mini PC 180 × 180',
        panelThickness: [0, 50], body: [180, 180, 55], keepout: [240, 240, 110],
        operations: [...holePattern('mount', 4, 160, 160, 4)], serviceEnvelope: { widthMm: 300, heightMm: 280, depthMm: 180 },
        electrical: { connector: 'dc-barrel', contacts: 1, currentMa: 5000 }
    }),
    define({
        id: 'recessed-handle-100', category: 'handle', name: '100 mm recessed handle',
        panelThickness: [6, 25], body: [115, 48, 22], keepout: [145, 75, 45],
        operations: [rect('recess', 'pocket', 105, 38, 6), ...holePattern('mount', 2, 96, 0, 4)]
    }),
    define({
        id: 'caster-50', category: 'mobility', name: '50 mm plate caster',
        panelThickness: [9, 30], body: [65, 50, 70], keepout: [90, 80, 90],
        operations: [...holePattern('mount', 4, 48, 34, 5)]
    })
]);

export function createHardwareDefinition(input = {}) {
    return define(input);
}

export function validateHardwareDefinitionInput(input) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, errors: ['Definition must be a JSON object.'], definition: null };
    }
    const id = String(input.id || '').trim();
    const name = String(input.name || '').trim();
    const category = String(input.category || '').trim();
    if (!id) errors.push('ID is required.');
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) errors.push('ID may contain letters, numbers, dots, underscores and hyphens.');
    if (!name) errors.push('Name is required.');
    if (!category) errors.push('Category is required.');

    const thickness = readDimensionInput(input.panelThickness ?? input.supportedPanelThicknessMm, 2);
    const body = readDimensionInput(input.body, 3);
    const keepout = readDimensionInput(input.keepout, 3);
    if (!thickness || thickness.some(value => value < 0) || thickness[0] > thickness[1]) {
        errors.push('Panel thickness must contain a valid minimum and maximum.');
    }
    if (!body || body.some(value => value <= 0)) errors.push('Body dimensions must contain three values greater than zero.');
    if (!keepout || keepout.some(value => value <= 0)) errors.push('Keepout dimensions must contain three values greater than zero.');
    if (body && keepout && keepout.some((value, index) => value < body[index])) {
        errors.push('Keepout dimensions cannot be smaller than the hardware body.');
    }

    if (!Array.isArray(input.operations) || !input.operations.length) {
        errors.push('At least one machining or reference operation is required.');
    } else {
        input.operations.forEach((operation, index) => {
            if (!operation || typeof operation !== 'object') {
                errors.push(`Operation ${index + 1} must be an object.`);
                return;
            }
            if (!['profileCut', 'throughCut', 'drill', 'pocket', 'engrave', 'reference'].includes(operation.type)) {
                errors.push(`Operation ${index + 1} has an unsupported type.`);
            }
            const geometry = operation.geometry;
            if (!geometry || !['circle', 'rect'].includes(geometry.kind)) {
                errors.push(`Operation ${index + 1} must use circle or rect geometry.`);
            } else if (geometry.kind === 'circle' && !(Number(geometry.diameterMm) > 0)) {
                errors.push(`Operation ${index + 1} requires a diameter greater than zero.`);
            } else if (geometry.kind === 'rect' && (!(Number(geometry.widthMm) > 0) || !(Number(geometry.heightMm) > 0))) {
                errors.push(`Operation ${index + 1} requires width and height greater than zero.`);
            }
        });
    }
    if (input.unitPrice != null && (!(Number(input.unitPrice) >= 0) || !Number.isFinite(Number(input.unitPrice)))) {
        errors.push('Unit price must be zero or greater.');
    }

    if (errors.length) return { ok: false, errors, definition: null };
    return {
        ok: true,
        errors: [],
        definition: createHardwareDefinition({
            ...input,
            id,
            name,
            category,
            panelThickness: thickness,
            body,
            keepout
        })
    };
}

export function normalizeHardwareLibrary(customDefinitions = []) {
    const definitions = [...BUILT_IN_HARDWARE_DEFINITIONS, ...(Array.isArray(customDefinitions) ? customDefinitions.map(define) : [])];
    const unique = new Map();
    definitions.forEach(definition => unique.set(definition.id, definition));
    return [...unique.values()];
}

export function instantiateHardware(definitionId, placement = {}, library = BUILT_IN_HARDWARE_DEFINITIONS) {
    const definition = library.find(item => item.id === definitionId);
    if (!definition) throw new Error(`Unknown hardware definition: ${definitionId}`);
    return {
        id: String(placement.id || `${definitionId}-${Date.now()}`),
        definitionId,
        partId: String(placement.partId || ''),
        xMm: finite(placement.xMm ?? placement.x, 0),
        yMm: finite(placement.yMm ?? placement.y, 0),
        rotationDeg: finite(placement.rotationDeg ?? placement.rotation, 0),
        face: placement.face === 'back' ? 'back' : 'front',
        label: String(placement.label || definition.name),
        encoderInput: placement.encoderInput == null ? null : String(placement.encoderInput)
    };
}

export function getHardwareOperations(instance, library = BUILT_IN_HARDWARE_DEFINITIONS) {
    const definition = library.find(item => item.id === instance.definitionId);
    if (!definition) return [];
    return definition.operations.map(operation => ({
        ...operation,
        id: `${instance.id}:${operation.id}`,
        hardwareId: instance.id,
        partId: instance.partId,
        geometry: transformGeometry(operation.geometry, instance)
    }));
}

export function validateHardwareInstances(instances = [], parts = [], library = BUILT_IN_HARDWARE_DEFINITIONS) {
    const definitions = new Map(library.map(item => [item.id, item]));
    const partMap = new Map(parts.map(part => [part.id, part]));
    const findings = [];

    instances.forEach(instance => {
        const definition = definitions.get(instance.definitionId);
        const part = partMap.get(instance.partId);
        if (!definition) {
            findings.push(finding('HARDWARE_DEFINITION_MISSING', 'error', [instance.partId], `Hardware ${instance.definitionId} is not defined.`, 'Choose or import a valid definition.'));
            return;
        }
        if (!part) {
            findings.push(finding('HARDWARE_HOST_MISSING', 'error', [instance.partId], `${definition.name} has no valid host panel.`, 'Select a fabricated panel.'));
            return;
        }

        const thickness = Number(part.thicknessMm ?? part.thickness) || 0;
        const [minimum, maximum] = definition.supportedPanelThicknessMm;
        if (thickness < minimum || thickness > maximum) {
            findings.push(finding(
                'HARDWARE_PANEL_THICKNESS', 'error', [part.id],
                `${definition.name} supports ${minimum}–${maximum} mm panels; ${part.name || part.id} is ${thickness} mm.`,
                'Choose compatible hardware or adjust the panel/mounting recess.'
            ));
        }

        const bounds = partBounds(part);
        getHardwareOperations(instance, library).forEach(operation => {
            if (!geometryWithinBounds(operation.geometry, bounds, 0.01)) {
                findings.push(finding(
                    'HARDWARE_CUTOUT_OUTSIDE', 'error', [part.id],
                    `${definition.name} has a ${operation.type} operation outside ${part.name || part.id}.`,
                    'Move the hardware away from the panel edge.'
                ));
            }
        });
    });

    for (let first = 0; first < instances.length; first++) {
        for (let second = first + 1; second < instances.length; second++) {
            const a = instances[first];
            const b = instances[second];
            if (a.partId !== b.partId || !definitions.has(a.definitionId) || !definitions.has(b.definitionId)) continue;
            const definitionA = definitions.get(a.definitionId);
            const definitionB = definitions.get(b.definitionId);
            if (envelopesOverlap(a, definitionA.body, b, definitionB.body)) {
                findings.push(finding(
                    'HARDWARE_BODY_COLLISION', 'error', [a.partId],
                    `${a.label} and ${b.label} have overlapping underside bodies.`,
                    'Move the components apart or choose physically smaller hardware.'
                ));
            } else if (envelopesOverlap(a, definitionA.keepout, b, definitionB.keepout)) {
                findings.push(finding(
                    'HARDWARE_SERVICE_CLEARANCE', 'warning', [a.partId],
                    `${a.label} and ${b.label} have overlapping recommended service clearances.`,
                    'Increase spacing or verify installation and maintenance access with the supplier drawings.'
                ));
            }
        }
    }

    return findings;
}

export function buildHardwareSchedule(instances = [], library = BUILT_IN_HARDWARE_DEFINITIONS) {
    const definitions = new Map(library.map(item => [item.id, item]));
    const grouped = new Map();
    instances.forEach(instance => {
        const definition = definitions.get(instance.definitionId);
        if (!definition) return;
        const entry = grouped.get(definition.id) || {
            definitionId: definition.id,
            category: definition.category,
            name: definition.name,
            quantity: 0,
            connector: definition.electrical?.connector || null,
            supplier: definition.supplier || null,
            sku: definition.sku || null,
            unitPrice: definition.unitPrice || 0
        };
        entry.quantity += 1;
        grouped.set(definition.id, entry);
    });
    return [...grouped.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function buildWiringPlan(instances = [], library = BUILT_IN_HARDWARE_DEFINITIONS) {
    const definitions = new Map(library.map(item => [item.id, item]));
    const connectors = new Map();
    const connections = [];
    let estimatedHarnessLengthMm = 0;

    instances.forEach(instance => {
        const definition = definitions.get(instance.definitionId);
        if (!definition?.electrical) return;
        const connector = definition.electrical.connector || 'unspecified';
        connectors.set(connector, (connectors.get(connector) || 0) + 1);
        const lengthMm = Math.round(400 + Math.hypot(instance.xMm, instance.yMm) * 1.25);
        estimatedHarnessLengthMm += lengthMm;
        connections.push({
            hardwareId: instance.id,
            label: instance.label,
            connector,
            encoderInput: instance.encoderInput,
            estimatedLengthMm: lengthMm
        });
    });

    return {
        connections,
        connectors: [...connectors.entries()].map(([type, quantity]) => ({ type, quantity })),
        estimatedHarnessLengthMm,
        estimatedHarnessLengthM: Math.ceil(estimatedHarnessLengthMm / 100) / 10
    };
}

function define(input) {
    const body = dimensions(input.body, [40, 40, 40]);
    const keepout = dimensions(input.keepout, body.map(value => value + 20));
    return Object.freeze({
        version: HARDWARE_LIBRARY_VERSION,
        id: safeId(input.id || input.name || 'hardware'),
        category: String(input.category || 'other'),
        name: String(input.name || 'Hardware').trim(),
        supportedPanelThicknessMm: dimensions(input.panelThickness, [0, 50]).slice(0, 2),
        body: { widthMm: body[0], heightMm: body[1], depthMm: body[2] },
        keepout: { widthMm: keepout[0], heightMm: keepout[1], depthMm: keepout[2] },
        operations: (input.operations || []).map(normalizeOperation),
        cableExit: input.cableExit ? { ...input.cableExit } : null,
        movementEnvelope: input.movementEnvelope ? { ...input.movementEnvelope } : null,
        serviceEnvelope: input.serviceEnvelope ? { ...input.serviceEnvelope } : null,
        airflow: input.airflow ? { ...input.airflow } : null,
        electrical: input.electrical ? { ...input.electrical } : null,
        supplier: input.supplier || null,
        sku: input.sku || null,
        unitPrice: Math.max(0, finite(input.unitPrice, 0))
    });
}

function normalizeOperation(operation) {
    return {
        id: safeId(operation.id || operation.type || 'operation'),
        type: ['profileCut', 'throughCut', 'drill', 'pocket', 'engrave', 'reference'].includes(operation.type) ? operation.type : 'reference',
        depthMm: operation.depthMm == null ? null : Math.max(0, finite(operation.depthMm, 0)),
        geometry: { ...operation.geometry }
    };
}

function circle(id, type, diameterMm, xMm = 0, yMm = 0) {
    return { id, type, geometry: { kind: 'circle', xMm, yMm, diameterMm } };
}

function rect(id, type, widthMm, heightMm, cornerRadiusMm = 0) {
    return { id, type, geometry: { kind: 'rect', xMm: 0, yMm: 0, widthMm, heightMm, cornerRadiusMm } };
}

function holePattern(prefix, count, widthMm, heightMm, diameterMm) {
    if (count === 2) {
        return [-1, 1].map((sign, index) => circle(`${prefix}-${index + 1}`, 'drill', diameterMm, sign * widthMm / 2, 0));
    }
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y], index) => circle(
        `${prefix}-${index + 1}`, 'drill', diameterMm, x * widthMm / 2, y * heightMm / 2
    ));
}

function radialHoles(prefix, count, pitchDiameterMm, diameterMm) {
    return Array.from({ length: count }, (_, index) => {
        const angle = index / count * Math.PI * 2;
        return circle(`${prefix}-${index + 1}`, 'drill', diameterMm, Math.cos(angle) * pitchDiameterMm / 2, Math.sin(angle) * pitchDiameterMm / 2);
    });
}

function transformGeometry(geometry, instance) {
    const angle = finite(instance.rotationDeg, 0) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = finite(geometry.xMm, 0);
    const y = finite(geometry.yMm, 0);
    return {
        ...geometry,
        xMm: instance.xMm + x * cos - y * sin,
        yMm: instance.yMm + x * sin + y * cos,
        rotationDeg: finite(geometry.rotationDeg, 0) + finite(instance.rotationDeg, 0)
    };
}

function partBounds(part) {
    const contourBounds = part.outline?.bounds || part.contour?.bounds;
    if (contourBounds && [contourBounds.minX, contourBounds.maxX, contourBounds.minY, contourBounds.maxY].every(Number.isFinite)) {
        return {
            minX: contourBounds.minX,
            maxX: contourBounds.maxX,
            minY: contourBounds.minY,
            maxY: contourBounds.maxY
        };
    }
    const width = Number(part.widthMm ?? part.dimensions?.widthMm ?? part.width) || 0;
    const height = Number(part.heightMm ?? part.dimensions?.lengthMm ?? part.lengthMm ?? part.length) || 0;
    // FabricationManifest panel-local coordinates start at the lower-left
    // stock-space origin; inferred hardware coordinates use the same frame.
    return { minX: 0, maxX: width, minY: 0, maxY: height };
}

function geometryWithinBounds(geometry, bounds, tolerance) {
    if (geometry.kind === 'circle') {
        const radius = Number(geometry.diameterMm || 0) / 2;
        return geometry.xMm - radius >= bounds.minX - tolerance && geometry.xMm + radius <= bounds.maxX + tolerance &&
            geometry.yMm - radius >= bounds.minY - tolerance && geometry.yMm + radius <= bounds.maxY + tolerance;
    }
    const halfWidth = Number(geometry.widthMm || 0) / 2;
    const halfHeight = Number(geometry.heightMm || 0) / 2;
    return geometry.xMm - halfWidth >= bounds.minX - tolerance && geometry.xMm + halfWidth <= bounds.maxX + tolerance &&
        geometry.yMm - halfHeight >= bounds.minY - tolerance && geometry.yMm + halfHeight <= bounds.maxY + tolerance;
}

function envelopesOverlap(a, envelopeA, b, envelopeB, toleranceMm = 0.01) {
    const halfAw = Number(envelopeA?.widthMm) / 2 || 0;
    const halfAh = Number(envelopeA?.heightMm) / 2 || 0;
    const halfBw = Number(envelopeB?.widthMm) / 2 || 0;
    const halfBh = Number(envelopeB?.heightMm) / 2 || 0;
    return Math.abs(a.xMm - b.xMm) < halfAw + halfBw - toleranceMm
        && Math.abs(a.yMm - b.yMm) < halfAh + halfBh - toleranceMm;
}

function finding(code, severity, partIds, message, remedy) {
    return { code, severity, partIds, message, remedy };
}

function dimensions(values, fallback) {
    const input = Array.isArray(values) ? values : fallback;
    return fallback.map((defaultValue, index) => Math.max(0, finite(input[index], defaultValue)));
}

function readDimensionInput(value, length) {
    const values = Array.isArray(value)
        ? value
        : value && typeof value === 'object'
            ? length === 2
                ? [value.minimumMm ?? value.minMm ?? value[0], value.maximumMm ?? value.maxMm ?? value[1]]
                : [value.widthMm, value.heightMm, value.depthMm]
            : null;
    if (!values || values.length < length) return null;
    const parsed = values.slice(0, length).map(Number);
    return parsed.every(Number.isFinite) ? parsed : null;
}

function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function safeId(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'hardware';
}
