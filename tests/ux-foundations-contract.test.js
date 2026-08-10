import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { LEARNING_ACTIONS } from '../wwwroot/js/guided-tutorial.js';
import { StatusService } from '../wwwroot/js/status-service.js';
import { UIManager } from '../wwwroot/js/ui.js';

const html = readFileSync(new URL('../wwwroot/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../wwwroot/style.css', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('../wwwroot/js/workspace-shell.js', import.meta.url), 'utf8');
const tutorialSource = readFileSync(new URL('../wwwroot/js/guided-tutorial.js', import.meta.url), 'utf8');
const workflowSource = readFileSync(new URL('../wwwroot/js/maker-workflow.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../wwwroot/js/ui.js', import.meta.url), 'utf8');
const firstPartyJs = readdirSync(new URL('../wwwroot/js/', import.meta.url), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => readFileSync(new URL(`../wwwroot/js/${entry.name}`, import.meta.url), 'utf8'))
    .join('\n');

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.dataset = {};
        this.listeners = new Map();
        this.className = '';
        this.hidden = false;
        this.open = false;
        this._textContent = '';
    }

    get textContent() {
        return this._textContent + this.children.map(child => child.textContent || '').join('');
    }

    set textContent(value) {
        this._textContent = String(value ?? '');
        this.children = [];
    }

    set innerHTML(_) {
        throw new Error('Unsafe innerHTML write in a text-only UX surface');
    }

    append(...children) {
        children.forEach(child => this.appendChild(child));
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    prepend(child) {
        child.parentNode = this;
        this.children.unshift(child);
        return child;
    }

    replaceChildren(...children) {
        this._textContent = '';
        this.children.forEach(child => { child.parentNode = null; });
        this.children = [];
        this.append(...children);
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    querySelector() {
        return null;
    }

    querySelectorAll(selector) {
        const matches = [];
        const visit = element => {
            element.children.forEach(child => {
                if (selector === '[data-status-id]' && child.dataset.statusId !== undefined) matches.push(child);
                visit(child);
            });
        };
        visit(this);
        return matches;
    }
}

function withFakeBrowser(callback) {
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    const previousCustomEvent = globalThis.CustomEvent;
    const documentRef = {
        activeElement: null,
        createElement(tagName) {
            return new FakeElement(tagName);
        }
    };
    globalThis.document = documentRef;
    globalThis.window = {
        setTimeout,
        clearTimeout,
        dispatchEvent() {},
        localStorage: null,
        cabinetDesktop: { available: false }
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.detail = options.detail;
        }
    };
    return Promise.resolve()
        .then(() => callback(documentRef))
        .finally(() => {
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
            if (previousWindow === undefined) delete globalThis.window;
            else globalThis.window = previousWindow;
            if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
            else globalThis.CustomEvent = previousCustomEvent;
        });
}

function htmlTagWithId(id) {
    return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] || '';
}

test('status notifications have a durable lifecycle and render untrusted copy as text', async () => {
    await withFakeBrowser(() => {
        const liveRegion = new FakeElement('div');
        const toastRegion = new FakeElement('section');
        const historyList = new FakeElement('div');
        const historyEmpty = new FakeElement('p');
        const historyButton = new FakeElement('button');
        const service = new StatusService({
            liveRegion,
            toastRegion,
            historyList,
            historyEmpty,
            historyButton
        });
        const unsafeTitle = '<img src=x onerror=alert(1)>';
        const unsafeMessage = '<script>not executable</script>';

        const errorId = service.notify(unsafeMessage, {
            title: unsafeTitle,
            severity: 'error'
        });
        assert.equal(liveRegion.textContent, `${unsafeTitle}: ${unsafeMessage}`);
        assert.match(toastRegion.textContent, /<script>not executable<\/script>/);
        assert.match(historyList.textContent, /<img src=x onerror=alert\(1\)>/);
        assert.equal(historyButton.dataset.count, '1');

        service.dismiss(errorId);
        assert.equal(toastRegion.querySelectorAll('[data-status-id]').length, 0);
        assert.equal(service.entries.find(entry => entry.id === errorId)?.resolved, true);
        assert.equal(historyButton.dataset.count, '0');

        service.begin('save-project', 'Saving project');
        assert.equal(service.activeByKey.get('save-project')?.busy, true);
        assert.equal(historyButton.dataset.count, '1');
        service.resolve('save-project');
        assert.equal(service.activeByKey.has('save-project'), false);
        assert.equal(service.entries.find(entry => entry.key === 'save-project')?.resolved, true);
        assert.equal(historyButton.dataset.count, '0');

        service.begin('export-package', 'Building package');
        service.fail('export-package', 'Package could not be written');
        const unresolved = service.entries.filter(entry => !entry.resolved);
        assert.equal(unresolved.length, 1, 'failure must replace, rather than strand, an in-progress record');
        assert.equal(unresolved[0].severity, 'error');
        assert.equal(unresolved[0].busy, false);
        assert.equal(historyButton.dataset.count, '1');
    });
});

test('workspace shell keeps project commands compact and side panels recoverable', () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual(duplicates, [], `duplicate document IDs: ${[...new Set(duplicates)].join(', ')}`);

    assert.match(html, /<details id="project-command-menu"[^>]*>[\s\S]*?<summary[^>]*aria-label="Open project and application commands"/);
    for (const id of ['unit-mm-menu', 'unit-in-menu', 'btn-new', 'btn-save-as', 'btn-load', 'btn-project-tools', 'btn-theme', 'btn-status-history']) {
        assert.match(html, new RegExp(`id="${id}"`), `missing overflow command ${id}`);
    }
    assert.match(html, /class="header-command-unit-toggle" role="group" aria-label="Display units"/);
    assert.match(uiSource, /\[`unit-\$\{unit\}`, `unit-\$\{unit\}-menu`\]/);
    assert.match(uiSource, /unit-mm-menu'[\s\S]*?setUnitMode\('mm'\)/);
    assert.match(uiSource, /unit-in-menu'[\s\S]*?setUnitMode\('in'\)/);
    assert.match(htmlTagWithId('btn-toggle-left-sidebar'), /aria-pressed="true"/);
    assert.match(htmlTagWithId('btn-toggle-right-sidebar'), /aria-pressed="true"/);
    assert.match(shellSource, /left-sidebar-collapsed/);
    assert.match(shellSource, /right-sidebar-collapsed/);
    assert.match(shellSource, /writeStored\(PANEL_STATE_KEY, this\.panelState\)/);
    assert.match(shellSource, /requestAnimationFrame\(\(\) => this\.ui\.app\?\.onWindowResize\?\.\(\)\)/);
});

test('viewport controls and live status occupy stable, noticeable shell positions', () => {
    const header = html.match(/<header class="app-header"[\s\S]*?<\/header>/)?.[0] || '';
    const viewport = html.match(/<main id="canvas-container"[\s\S]*?<\/main>/)?.[0] || '';
    assert.match(header, /class="viewport-context header-status"/);
    assert.match(header, /id="viewport-orientation"[\s\S]*?id="viewport-selection"[\s\S]*?id="viewport-dimensions"/);
    assert.match(header, /class="maker-nav"[\s\S]*?data-maker-step="design"[\s\S]*?data-maker-step="export"/);
    assert.doesNotMatch(viewport, /class="viewport-context/);
    assert.match(html, /id="btn-toggle-viewport-toolbar"[\s\S]*?aria-controls="viewport-toolbar-controls"/);
    assert.match(html, /id="viewport-toolbar-controls" class="viewport-toolbar-controls"/);
    assert.match(css, /\.viewport-toolbar\s*\{[\s\S]*?left:\s*calc\([\s\S]*?var\(--left-panel-width\)[\s\S]*?transform:\s*translateX\(-50%\)/);
    assert.match(css, /\.maker-nav\s*\{[\s\S]*?position:\s*static/);
    assert.match(shellSource, /VIEW_TOOLBAR_KEY[\s\S]*?bindViewportToolbar\(\)[\s\S]*?aria-expanded/);
    assert.match(css, /\.app-container\.left-sidebar-collapsed\s*\{[\s\S]*?--left-panel-width:\s*0px/);
    assert.match(css, /\.app-container\.right-sidebar-collapsed\s*\{[\s\S]*?--right-panel-width:\s*0px/);

    assert.match(css, /\.status-toast\s*\{[\s\S]*?animation:\s*notice-slide-in/);
    assert.match(css, /\.recovery-banner:not\(\[hidden\]\)\s*\{[\s\S]*?animation:\s*notice-slide-in/);
    assert.match(css, /\.tutorial-card\.notice-enter,[\s\S]*?\.learning-coach\.notice-enter/);
    assert.match(tutorialSource, /animateNotice\(\)/);
    assert.match(uiSource, /coach\.classList\.add\('notice-enter'\)/);
});

test('inspector tabs, workspace mode and setting search expose keyboard and status contracts', () => {
    assert.match(html, /class="inspector-tabs" role="tablist" aria-label="Inspector view"/);
    for (const id of ['inspector-tab-part', 'inspector-tab-checks', 'inspector-tab-scene']) {
        const tag = htmlTagWithId(id);
        assert.match(tag, /role="tab"/);
        assert.match(tag, /aria-selected="(?:true|false)"/);
    }
    assert.match(shellSource, /tab\.setAttribute\('aria-selected', String\(active\)\)/);
    assert.match(shellSource, /tab\.tabIndex = active \? 0 : -1/);
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
        assert.match(shellSource, new RegExp(`'${key}'`), `inspector tabs do not handle ${key}`);
    }

    assert.match(html, /<label for="parameter-search">Find a setting<\/label>/);
    assert.match(htmlTagWithId('parameter-search'), /type="search"/);
    assert.match(htmlTagWithId('parameter-search-status'), /role="status"/);
    assert.match(htmlTagWithId('parameter-search-status'), /aria-live="polite"/);
    assert.match(shellSource, /results\.className = 'parameter-search-results'/);
    assert.match(shellSource, /query\.length < 2/);
    assert.match(shellSource, /slice\(0, 12\)/);
    assert.match(shellSource, /event\.key === 'Escape'/);
    assert.match(shellSource, /event\.key === 'ArrowDown'/);
    assert.match(shellSource, /candidate\.control\.focus\(\)/);

    assert.match(html, /class="workspace-mode-toggle" role="group" aria-label="Control detail"/);
    assert.match(shellSource, /document\.documentElement\.dataset\.workspaceMode = this\.mode/);
    assert.match(shellSource, /writeStored\(WORKSPACE_MODE_KEY, this\.mode\)/);
    assert.match(css, /\[data-workspace-mode="guided"\] \.guided-advanced\s*\{[\s\S]*?display:\s*none !important/);
});

test('First Cabinet advances from real application actions without confirming production stages', () => {
    const emitted = new Set(
        [...firstPartyJs.matchAll(/recordLearningAction(?:\?\.)?\(\s*this(?:\.ui)?\.learningActions\?\.(\w+)/g)]
            .map(match => match[1])
    );
    for (const actionKey of Object.keys(LEARNING_ACTIONS)) {
        assert.ok(emitted.has(actionKey), `no real UI checkpoint emits LEARNING_ACTIONS.${actionKey}`);
    }

    assert.match(uiSource, /PARAMETER_CHANGED[\s\S]*?section:\s*'structure'/);
    assert.match(uiSource, /PROJECT_SAVED[\s\S]*?saved:\s*true/);
    assert.match(workflowSource, /SHEETS_GENERATED[\s\S]*?valid:\s*planValid/);
    assert.match(uiSource, /EXPORT_COMPLETED[\s\S]*?output:\s*kind === 'draft' \? 'annotated-draft'/);
    assert.doesNotMatch(tutorialSource, /confirmStage\s*\(|commitAndNavigate\s*\(|completedStages/);
    assert.match(workflowSource, /btn-review-continue[^\n]*commitAndNavigate\('review', 'sheets'\)/);
    assert.match(workflowSource, /if \(isReview\) this\.ui\.recordLearningAction/);
});

test('recovery manager opens a recovery as an unsaved copy by default', async () => {
    await withFakeBrowser(async () => {
        const applied = [];
        const lifecycleEvents = [];
        globalThis.window.dispatchEvent = event => lifecycleEvents.push(event.detail);
        const manager = Object.create(UIManager.prototype);
        manager.recoveryRecords = [{
            recoveryId: 'recovery-safe-copy',
            projectName: 'Named original',
            sourcePath: 'C:\\Cabinets\\original.cabinet.json',
            savedAt: '2026-07-27T09:00:00.000Z',
            sizeBytes: 128
        }];
        manager.readRecoveryRecord = async () => ({
            content: JSON.stringify({
                timestamp: '2026-07-27T09:00:00.000Z',
                projectName: 'Named original',
                sourcePath: 'C:\\Cabinets\\original.cabinet.json',
                params: { width: 650 }
            })
        });
        manager.app = {
            applyProjectData(project, options) {
                applied.push({ project, options });
            }
        };
        manager.recoveryBanner = new FakeElement('section');
        manager.reportLifecycleFailure = error => assert.fail(`unexpected recovery failure: ${error}`);

        const result = await manager.restoreRecoveryRecord('recovery-safe-copy');
        assert.deepEqual(result, { ok: true, recoveryId: 'recovery-safe-copy' });
        assert.equal(manager.currentProjectPath, null);
        assert.equal(manager.hasSavedProject, false);
        assert.equal(applied.length, 1);
        assert.equal(applied[0].options.recovered, true);
        assert.ok(lifecycleEvents.some(event => event?.type === 'recovery-restored' && event.openedAsCopy === true));
    });
});

test('export readiness is per-output and a successful export produces a text-safe receipt', async () => {
    await withFakeBrowser(() => {
        for (const id of ['draft-readiness', 'production-readiness', 'package-readiness']) {
            assert.match(htmlTagWithId(id), /class="output-readiness/);
        }
        assert.equal((uiSource.match(/syncOutputReadiness\(this\.(?:draft|production|package)Readiness/g) || []).length, 3);

        const manager = Object.create(UIManager.prototype);
        manager.exportReceipt = new FakeElement('section');
        manager.exportReceiptSummary = new FakeElement('p');
        manager.exportReceiptDetails = new FakeElement('dl');
        manager.btnOpenExportFolder = new FakeElement('button');
        manager.btnOpenBeforeCut = new FakeElement('button');
        manager.exportDialog = null;
        manager.helpSystem = null;
        const unsafeFilename = '<img onerror=alert(1)>.svg';
        manager.renderExportReceipt('production', {
            filename: unsafeFilename,
            content: '<svg aria-label="drawing"></svg>'
        });

        assert.equal(manager.exportReceipt.hidden, false);
        assert.equal(manager.exportReceiptSummary.textContent, 'Production drawing is ready.');
        assert.match(manager.exportReceiptDetails.textContent, /File<img onerror=alert\(1\)>\.svg/);
        assert.match(manager.exportReceiptDetails.textContent, /Size\d+ bytes/);
        assert.match(manager.exportReceiptDetails.textContent, /Created/);
        assert.equal(manager.btnOpenExportFolder.hidden, true);
        assert.equal(typeof manager.btnOpenBeforeCut.onclick, 'function');

        const badge = new FakeElement('span');
        manager.syncOutputReadiness(badge, {
            label: 'Blocked',
            status: 'blocked',
            reason: 'Resolve two fabrication errors.'
        });
        assert.equal(badge.textContent, 'Blocked');
        assert.equal(badge.className, 'output-readiness blocked');
        assert.equal(badge.title, 'Resolve two fabrication errors.');
    });
});

test('the shell remains usable at 320 CSS pixels and honours system accessibility modes', () => {
    assert.match(css, /\.compact-dialog,\s*\.help-dialog\s*\{[\s\S]*?width:\s*min\(1120px, calc\(100vw - 32px\)\)/);
    assert.match(css, /\.status-toast-region\s*\{[\s\S]*?width:\s*min\(440px, calc\(100vw - 36px\)\)/);
    assert.match(css, /\.learning-coach\s*\{[\s\S]*?width:\s*min\(420px, calc\(100vw - 36px\)\)/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.global-actions\s*\{[\s\S]*?min-width:\s*0[\s\S]*?max-width:\s*100%/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.help-layout\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.export-receipt\s*\{[\s\S]*?flex-direction:\s*column/);
    assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.maker-nav\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)[\s\S]*?\.maker-nav-confirm\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
    assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.header-command-menu\s*\{[\s\S]*?position:\s*static/);
    assert.match(uiSource, /exact\.step = isInch \? 'any' : \(range\.step \|\| 'any'\)/);

    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition:\s*none !important[\s\S]*?animation:\s*none !important/);
    assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.status-toast[\s\S]*?\.output-readiness[\s\S]*?border-color:\s*CanvasText[\s\S]*?background:\s*Canvas[\s\S]*?color:\s*CanvasText/);
});
