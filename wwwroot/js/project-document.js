export const PROJECT_SCHEMA_VERSION = 2;
export const PROJECT_FILE_EXTENSION = '.cabinet.json';
export const MAX_PROJECT_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const MAX_RECOVERY_RECORD_BYTES = 64 * 1024 * 1024;

const DEFAULT_PROJECT_NAME = 'Untitled Cabinet';
let pendingDesktopOpen = null;
let desktopLifecycleHooks = {};

export function createProjectDocument(source = {}) {
    const timestamp = new Date().toISOString();
    return {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        application: 'Cabinet Crafter',
        project: {
            name: sanitizeProjectName(source.project?.name ?? source.name ?? DEFAULT_PROJECT_NAME),
            createdAt: source.project?.createdAt || timestamp,
            modifiedAt: timestamp,
            basedOnPreset: source.project?.basedOnPreset ?? source.basedOnPreset ?? null,
            notes: String(source.project?.notes ?? source.notes ?? '')
        },
        units: {
            internal: 'mm',
            display: source.units?.display === 'in' ? 'in' : 'mm'
        },
        design: {
            params: clone(source.design?.params ?? source.params ?? {}),
            decals: clone(source.design?.decals ?? source.decals ?? {})
        },
        materials: clone(source.materials ?? []),
        fabricationSettings: clone(source.fabricationSettings ?? {}),
        inclusion: clone(source.inclusion ?? {}),
        viewState: normalizeViewState(source.viewState),
        assets: clone(source.assets ?? {})
    };
}

export function migrateProjectDocument(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new ProjectDocumentError('PROJECT_NOT_OBJECT', 'Project file must contain a JSON object.');
    }

    if (Number(input.schemaVersion) === PROJECT_SCHEMA_VERSION) {
        const normalized = createProjectDocument(input);
        normalized.project.createdAt = input.project?.createdAt || normalized.project.createdAt;
        normalized.project.modifiedAt = input.project?.modifiedAt || normalized.project.modifiedAt;
        return normalized;
    }

    if (input.schemaVersion != null && Number(input.schemaVersion) > PROJECT_SCHEMA_VERSION) {
        throw new ProjectDocumentError(
            'PROJECT_VERSION_NEWER',
            `This project uses schema ${input.schemaVersion}; this version of Cabinet Crafter supports schema ${PROJECT_SCHEMA_VERSION}.`
        );
    }

    // Legacy project files used a string `version` plus top-level params/decals.
    if (input.params || input.decals || String(input.version || '').startsWith('1.')) {
        return createProjectDocument({
            name: inferLegacyProjectName(input),
            params: input.params || {},
            decals: input.decals || {},
            project: {
                createdAt: input.timestamp || undefined,
                notes: `Migrated from Cabinet Crafter project ${input.version || '1.x'}`
            }
        });
    }

    // Early v2 prototypes may already have design/project sections without a marker.
    if (input.design || input.project) {
        return createProjectDocument(input);
    }

    throw new ProjectDocumentError('PROJECT_UNRECOGNIZED', 'The JSON file is not a recognized Cabinet Crafter project.');
}

export function validateProjectDocument(document) {
    const findings = [];
    if (!document || typeof document !== 'object') {
        return [finding('PROJECT_NOT_OBJECT', 'error', 'Project file must contain an object.', 'document')];
    }

    if (Number(document.schemaVersion) !== PROJECT_SCHEMA_VERSION) {
        findings.push(finding(
            'PROJECT_SCHEMA_VERSION',
            'error',
            `Expected schema ${PROJECT_SCHEMA_VERSION}.`,
            'schemaVersion'
        ));
    }

    if (!document.project?.name?.trim()) {
        findings.push(finding('PROJECT_NAME_MISSING', 'warning', 'Project has no name.', 'project.name'));
    }

    if (!document.design?.params || typeof document.design.params !== 'object') {
        findings.push(finding('PROJECT_PARAMS_MISSING', 'error', 'Project design parameters are missing.', 'design.params'));
    }

    if (document.units?.internal !== 'mm') {
        findings.push(finding('PROJECT_INTERNAL_UNITS', 'error', 'Internal project units must be millimetres.', 'units.internal'));
    }

    if (!['mm', 'in'].includes(document.units?.display)) {
        findings.push(finding('PROJECT_DISPLAY_UNITS', 'warning', 'Display units were reset to millimetres.', 'units.display'));
    }

    if (document.materials != null && !Array.isArray(document.materials)) {
        findings.push(finding('PROJECT_MATERIALS_TYPE', 'error', 'Materials must be an array.', 'materials'));
    }

    const fabricationSettings = document.fabricationSettings;
    if (fabricationSettings != null && (typeof fabricationSettings !== 'object' || Array.isArray(fabricationSettings))) {
        findings.push(finding('PROJECT_FABRICATION_SETTINGS_TYPE', 'error', 'Fabrication settings must be an object.', 'fabricationSettings'));
    } else if (fabricationSettings) {
        if (fabricationSettings.hardwareCosts != null && (
            typeof fabricationSettings.hardwareCosts !== 'object' || Array.isArray(fabricationSettings.hardwareCosts)
        )) {
            findings.push(finding('PROJECT_HARDWARE_COSTS_TYPE', 'error', 'Hardware costs must be an object.', 'fabricationSettings.hardwareCosts'));
        } else {
            Object.entries(fabricationSettings.hardwareCosts || {}).forEach(([definitionId, record]) => {
                const unitPrice = typeof record === 'number' ? record : record?.unitPrice;
                if (unitPrice != null && (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) < 0)) {
                    findings.push(finding('PROJECT_HARDWARE_COST_VALUE', 'error', `Hardware cost for ${definitionId} must be zero or greater.`, `fabricationSettings.hardwareCosts.${definitionId}`));
                }
            });
        }
        if (fabricationSettings.additionalHardware != null && !Array.isArray(fabricationSettings.additionalHardware)) {
            findings.push(finding('PROJECT_ADDITIONAL_HARDWARE_TYPE', 'error', 'Additional hardware must be an array.', 'fabricationSettings.additionalHardware'));
        } else {
            (fabricationSettings.additionalHardware || []).forEach((item, index) => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                    findings.push(finding('PROJECT_ADDITIONAL_HARDWARE_ITEM', 'error', 'Each additional hardware item must be an object.', `fabricationSettings.additionalHardware.${index}`));
                    return;
                }
                if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 1) {
                    findings.push(finding('PROJECT_ADDITIONAL_HARDWARE_QUANTITY', 'error', 'Additional hardware quantity must be one or greater.', `fabricationSettings.additionalHardware.${index}.quantity`));
                }
                if (item.unitPrice != null && (!Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0)) {
                    findings.push(finding('PROJECT_ADDITIONAL_HARDWARE_COST', 'error', 'Additional hardware unit price must be zero or greater.', `fabricationSettings.additionalHardware.${index}.unitPrice`));
                }
            });
        }
    }

    validateDecals(document.design?.decals, findings);
    return findings;
}

export function serializeProjectDocument(document) {
    // Do not let normalization silently repair an invalid current-schema
    // document during Save. Migrations may supply defaults for legacy files,
    // but a V2 document must satisfy the V2 contract as supplied.
    if (Number(document?.schemaVersion) === PROJECT_SCHEMA_VERSION) {
        const sourceFindings = validateProjectDocument(document);
        const sourceErrors = sourceFindings.filter(item => item.severity === 'error');
        if (sourceErrors.length) {
            throw new ProjectDocumentError('PROJECT_INVALID', sourceErrors.map(item => item.message).join(' '), sourceFindings);
        }
    }
    const normalized = migrateProjectDocument(document);
    const findings = validateProjectDocument(normalized);
    const errors = findings.filter(item => item.severity === 'error');
    if (errors.length) {
        throw new ProjectDocumentError('PROJECT_INVALID', errors.map(item => item.message).join(' '), findings);
    }
    normalized.project.modifiedAt = new Date().toISOString();
    const serialized = JSON.stringify(normalized, null, 2);
    assertTextWithinLimit(serialized, MAX_PROJECT_DOCUMENT_BYTES, 'Project');
    return serialized;
}

export function getProjectSuggestedFileName(document) {
    const name = sanitizeProjectName(document?.project?.name || DEFAULT_PROJECT_NAME)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'untitled-cabinet';
    return `${name}${PROJECT_FILE_EXTENSION}`;
}

export class ProjectHistory {
    constructor(initialState, options = {}) {
        this.limit = Math.max(2, Number(options.limit) || 100);
        this.past = [];
        this.present = clone(initialState);
        this.future = [];
        this.savedFingerprint = stableFingerprint(this.present);
    }

    commit(nextState) {
        const next = clone(nextState);
        if (stableFingerprint(next) === stableFingerprint(this.present)) return this.present;
        this.past.push(this.present);
        if (this.past.length > this.limit) this.past.shift();
        this.present = next;
        this.future = [];
        return clone(this.present);
    }

    undo() {
        if (!this.canUndo) return clone(this.present);
        this.future.unshift(this.present);
        this.present = this.past.pop();
        return clone(this.present);
    }

    redo() {
        if (!this.canRedo) return clone(this.present);
        this.past.push(this.present);
        this.present = this.future.shift();
        return clone(this.present);
    }

    markSaved() {
        this.savedFingerprint = stableFingerprint(this.present);
    }

    reset(nextState, markSaved = true) {
        this.past = [];
        this.future = [];
        this.present = clone(nextState);
        if (markSaved) this.markSaved();
        return clone(this.present);
    }

    get canUndo() { return this.past.length > 0; }
    get canRedo() { return this.future.length > 0; }
    get isDirty() { return stableFingerprint(this.present) !== this.savedFingerprint; }
}

export async function requestDesktop(type, payload = {}) {
    if (!globalThis.window?.cabinetDesktop?.available) {
        throw new ProjectDocumentError('DESKTOP_UNAVAILABLE', 'The native desktop file bridge is unavailable.');
    }
    if (type === 'project.open' || type === 'project.openRecent') {
        const allowed = await desktopLifecycleHooks.beforeCandidateOpen?.({ type, payload });
        if (allowed === false) return { cancelled: true };
        await abandonPendingProjectOpen();
    }
    const result = await globalThis.window.cabinetDesktop.request(type, payload);
    if ((type === 'project.open' || type === 'project.openRecent') && result?.candidateId) {
        pendingDesktopOpen = {
            candidateId: String(result.candidateId),
            path: String(result.path || '')
        };
    }
    return result;
}

export function configureDesktopLifecycleHooks(hooks = {}) {
    desktopLifecycleHooks = {
        ...desktopLifecycleHooks,
        ...(hooks && typeof hooks === 'object' ? hooks : {})
    };
}

export function getPendingProjectOpen() {
    return pendingDesktopOpen ? { ...pendingDesktopOpen } : null;
}

export async function commitPendingProjectOpen(metadata = {}) {
    const candidate = pendingDesktopOpen;
    if (!candidate) return null;
    if (!globalThis.window?.cabinetDesktop?.available) {
        pendingDesktopOpen = null;
        return null;
    }
    const result = await globalThis.window.cabinetDesktop.request('project.open.commit', {
        candidateId: candidate.candidateId,
        projectName: String(metadata.projectName || '')
    });
    pendingDesktopOpen = null;
    return result;
}

export async function abandonPendingProjectOpen() {
    const candidate = pendingDesktopOpen;
    pendingDesktopOpen = null;
    if (!candidate || !globalThis.window?.cabinetDesktop?.available) return null;
    try {
        return await globalThis.window.cabinetDesktop.request('project.open.discard', {
            candidateId: candidate.candidateId
        });
    } catch (_) {
        return null;
    }
}

export function utf8ByteLength(value) {
    const text = String(value ?? '');
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    return unescape(encodeURIComponent(text)).length;
}

export function assertTextWithinLimit(value, maximumBytes = MAX_PROJECT_DOCUMENT_BYTES, label = 'Project') {
    const bytes = utf8ByteLength(value);
    if (bytes > maximumBytes) {
        throw new ProjectDocumentError(
            'DOCUMENT_TOO_LARGE',
            `${label} data is ${formatBytes(bytes)}; the maximum supported size is ${formatBytes(maximumBytes)}.`
        );
    }
    return bytes;
}

export class ProjectDocumentError extends Error {
    constructor(code, message, findings = []) {
        super(message);
        this.name = 'ProjectDocumentError';
        this.code = code;
        this.findings = findings;
    }
}

function normalizeViewState(viewState = {}) {
    return {
        camera: clone(viewState?.camera ?? null),
        gridVisible: viewState?.gridVisible !== false,
        edgesVisible: viewState?.edgesVisible !== false,
        screwsVisible: viewState?.screwsVisible !== false,
        hiddenParts: Array.isArray(viewState?.hiddenParts) ? [...new Set(viewState.hiddenParts.map(String))] : [],
        mannequin: {
            visible: viewState?.mannequin?.visible !== false,
            preset: String(viewState?.mannequin?.preset || 'adult_average'),
            height: finiteNumber(viewState?.mannequin?.height, 1750)
        }
    };
}

function validateDecals(decals, findings) {
    if (decals == null) return;
    if (typeof decals !== 'object' || Array.isArray(decals)) {
        findings.push(finding('PROJECT_DECALS_TYPE', 'error', 'Artwork records must be keyed by panel ID.', 'design.decals'));
        return;
    }

    Object.entries(decals).forEach(([panelId, items]) => {
        if (!Array.isArray(items)) {
            findings.push(finding('PROJECT_DECAL_LIST', 'warning', `Artwork for ${panelId} was ignored.`, `design.decals.${panelId}`));
            return;
        }
        items.forEach((item, index) => {
            if (!item?.imageSrc || typeof item.imageSrc !== 'string') {
                findings.push(finding(
                    'PROJECT_DECAL_SOURCE',
                    'warning',
                    `Artwork ${index + 1} on ${panelId} has no image source.`,
                    `design.decals.${panelId}.${index}.imageSrc`
                ));
            }
        });
    });
}

function finding(code, severity, message, field) {
    return { code, severity, message, field };
}

function inferLegacyProjectName(input) {
    const width = Number(input.params?.width);
    const height = Number(input.params?.height);
    return width > 0 && height > 0 ? `Cabinet ${width} × ${height}` : DEFAULT_PROJECT_NAME;
}

function sanitizeProjectName(value) {
    const name = String(value || '').replace(/[\u0000-\u001f]/g, '').trim();
    return (name || DEFAULT_PROJECT_NAME).slice(0, 120);
}

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clone(value) {
    if (value == null) return value;
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function stableFingerprint(value) {
    return JSON.stringify(sortObject(value));
}

function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} bytes`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function sortObject(value) {
    if (Array.isArray(value)) return value.map(sortObject);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = sortObject(value[key]);
        return result;
    }, {});
}

if (globalThis.window?.addEventListener) {
    globalThis.window.addEventListener('cabinetcrafter:error', event => {
        if (event?.detail?.context === 'load-project') void abandonPendingProjectOpen();
    });
}
