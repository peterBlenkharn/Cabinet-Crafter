import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_PROJECT_DOCUMENT_BYTES,
    PROJECT_SCHEMA_VERSION,
    ProjectDocumentError,
    ProjectHistory,
    abandonPendingProjectOpen,
    assertTextWithinLimit,
    commitPendingProjectOpen,
    configureDesktopLifecycleHooks,
    createProjectDocument,
    getProjectSuggestedFileName,
    getPendingProjectOpen,
    migrateProjectDocument,
    requestDesktop,
    serializeProjectDocument,
    utf8ByteLength,
    validateProjectDocument
} from '../wwwroot/js/project-document.js';
import { parseProjectDocument } from '../wwwroot/js/export.js';

test('ProjectDocumentV2 captures design, materials, fabrication, inclusion, and view state', () => {
    const document = createProjectDocument({
        name: 'My Cabinet',
        params: { width: 650, componentOverrides: { panel_cp: { thickness: 15 } } },
        decals: { side_left: [] },
        materials: [{ id: 'mdf-18' }],
        fabricationSettings: { cutoutSpacingMm: 3 },
        inclusion: { panel_back: false },
        units: { display: 'in' },
        viewState: { hiddenParts: ['panel_back', 'panel_back'], mannequin: { height: 1810 } }
    });
    assert.equal(document.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.equal(document.units.internal, 'mm');
    assert.equal(document.units.display, 'in');
    assert.equal(document.design.params.componentOverrides.panel_cp.thickness, 15);
    assert.deepEqual(document.viewState.hiddenParts, ['panel_back']);
    assert.equal(document.inclusion.panel_back, false);
});

test('v1.2 migration preserves parameter keys, component IDs, and artwork', () => {
    const legacy = {
        version: '1.2', timestamp: '2025-02-01T10:00:00.000Z',
        params: { width: 620, componentOverrides: { panel_cp: { width: 601 } } },
        decals: { panel_cp: [{ imageSrc: 'data:image/png;base64,AA==' }] }
    };
    const migrated = migrateProjectDocument(legacy);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.design.params.componentOverrides.panel_cp.width, 601);
    assert.equal(migrated.design.decals.panel_cp[0].imageSrc, legacy.decals.panel_cp[0].imageSrc);
    assert.match(migrated.project.notes, /Migrated.*1\.2/);
});

test('schema-aware errors reject future and unrecognized project files', () => {
    assert.throws(
        () => migrateProjectDocument({ schemaVersion: 99, design: {} }),
        error => error instanceof ProjectDocumentError && error.code === 'PROJECT_VERSION_NEWER'
    );
    assert.throws(
        () => migrateProjectDocument({ unrelated: true }),
        error => error instanceof ProjectDocumentError && error.code === 'PROJECT_UNRECOGNIZED'
    );
});

test('project serialization validates and suggests a safe filename', () => {
    const document = createProjectDocument({ name: 'Space Invaders: Deluxe!', params: { width: 600 } });
    const serialized = serializeProjectDocument(document);
    assert.equal(JSON.parse(serialized).units.internal, 'mm');
    assert.equal(getProjectSuggestedFileName(document), 'space-invaders-deluxe.cabinet.json');

    const invalid = structuredClone(document);
    invalid.units.internal = 'in';
    assert.ok(validateProjectDocument(invalid).some(item => item.code === 'PROJECT_INTERNAL_UNITS'));
    assert.throws(() => serializeProjectDocument(invalid), error => error.code === 'PROJECT_INVALID');
});

test('ProjectHistory provides bounded undo/redo and dirty-state tracking', () => {
    const history = new ProjectHistory({ width: 600 }, { limit: 3 });
    assert.equal(history.isDirty, false);
    history.commit({ width: 620 });
    history.commit({ width: 640 });
    assert.equal(history.isDirty, true);
    assert.deepEqual(history.undo(), { width: 620 });
    assert.deepEqual(history.redo(), { width: 640 });
    history.markSaved();
    assert.equal(history.isDirty, false);
    history.commit({ width: 660 });
    history.undo();
    assert.equal(history.isDirty, false);
});

test('external V2 top-level fabrication fields merge into live design parameters', () => {
    const loaded = parseProjectDocument({
        schemaVersion: 2,
        project: { name: 'External V2' },
        units: { internal: 'mm', display: 'in' },
        design: { params: { width: 612 }, decals: {} },
        materials: [{ id: 'birch-18', measuredThicknessMm: 17.8 }],
        fabricationSettings: { nestingStrategy: 'width', spacingMm: 7 },
        inclusion: { panel_back: false },
        viewState: { hiddenParts: ['panel_back'] }
    });
    assert.equal(loaded.params.materials[0].id, 'birch-18');
    assert.equal(loaded.params.fabricationSettings.nestingStrategy, 'width');
    assert.equal(loaded.params.fabricationInclusion.panel_back, false);
    assert.equal(loaded.params.displayUnits, 'in');
});

test('project validation preserves valid procurement settings and rejects unsafe costs', () => {
    const valid = createProjectDocument({
        fabricationSettings: {
            currencyCode: 'GBP',
            hardwareCosts: { encoder: { unitPrice: 18.5, supplier: 'Parts Co' } },
            additionalHardware: [{ id: 'pc', name: 'Mini PC', quantity: 1, unitPrice: 220 }]
        }
    });
    assert.equal(validateProjectDocument(valid).filter(item => item.severity === 'error').length, 0);
    const roundTrip = parseProjectDocument(serializeProjectDocument(valid));
    assert.equal(roundTrip.fabricationSettings.hardwareCosts.encoder.unitPrice, 18.5);
    assert.equal(roundTrip.fabricationSettings.additionalHardware[0].name, 'Mini PC');

    valid.fabricationSettings.additionalHardware[0].unitPrice = -1;
    assert.match(
        validateProjectDocument(valid).find(item => item.code === 'PROJECT_ADDITIONAL_HARDWARE_COST')?.message || '',
        /zero or greater/
    );
});

test('project size limits count UTF-8 bytes and fail before oversized data is delivered', () => {
    assert.equal(utf8ByteLength('plain'), 5);
    assert.equal(utf8ByteLength('£'), 2);
    assert.equal(utf8ByteLength('😀'), 4);
    assert.equal(assertTextWithinLimit('£', 2, 'Test project'), 2);
    assert.throws(
        () => assertTextWithinLimit('£', 1, 'Test project'),
        error => error instanceof ProjectDocumentError
            && error.code === 'DOCUMENT_TOO_LARGE'
            && /maximum supported size/.test(error.message)
    );
    assert.ok(MAX_PROJECT_DOCUMENT_BYTES >= 1024 * 1024);
});

test('desktop project open is two-phase and can be committed or abandoned explicitly', async () => {
    const previousWindow = globalThis.window;
    const calls = [];
    globalThis.window = {
        cabinetDesktop: {
            available: true,
            async request(type, payload) {
                calls.push({ type, payload });
                if (type === 'project.open') {
                    return {
                        candidateId: 'candidate-1',
                        path: 'C:\\projects\\alpha.cabinet.json',
                        content: '{"schemaVersion":2}'
                    };
                }
                if (type === 'project.open.commit') return { committed: true, path: 'C:\\projects\\alpha.cabinet.json' };
                if (type === 'project.open.discard') return { discarded: true };
                throw new Error(`Unexpected desktop request: ${type}`);
            }
        }
    };
    configureDesktopLifecycleHooks({ beforeCandidateOpen: async () => true });

    try {
        const candidate = await requestDesktop('project.open');
        assert.equal(candidate.candidateId, 'candidate-1');
        assert.deepEqual(getPendingProjectOpen(), {
            candidateId: 'candidate-1',
            path: 'C:\\projects\\alpha.cabinet.json'
        });
        assert.deepEqual(calls.map(call => call.type), ['project.open']);

        const committed = await commitPendingProjectOpen({ projectName: 'Alpha' });
        assert.equal(committed.committed, true);
        assert.equal(getPendingProjectOpen(), null);
        assert.deepEqual(calls.map(call => call.type), ['project.open', 'project.open.commit']);

        await requestDesktop('project.open');
        await abandonPendingProjectOpen();
        assert.equal(getPendingProjectOpen(), null);
        assert.deepEqual(calls.map(call => call.type), [
            'project.open',
            'project.open.commit',
            'project.open',
            'project.open.discard'
        ]);
    } finally {
        await abandonPendingProjectOpen();
        configureDesktopLifecycleHooks({ beforeCandidateOpen: null });
        globalThis.window = previousWindow;
    }
});

test('desktop lifecycle hook can cancel a destructive open before native state is touched', async () => {
    const previousWindow = globalThis.window;
    let nativeRequests = 0;
    globalThis.window = {
        cabinetDesktop: {
            available: true,
            async request() {
                nativeRequests += 1;
                return {};
            }
        }
    };
    configureDesktopLifecycleHooks({ beforeCandidateOpen: async () => false });
    try {
        const result = await requestDesktop('project.openRecent', { path: 'C:\\missing.cabinet.json' });
        assert.deepEqual(result, { cancelled: true });
        assert.equal(nativeRequests, 0);
        assert.equal(getPendingProjectOpen(), null);
    } finally {
        configureDesktopLifecycleHooks({ beforeCandidateOpen: null });
        globalThis.window = previousWindow;
    }
});
