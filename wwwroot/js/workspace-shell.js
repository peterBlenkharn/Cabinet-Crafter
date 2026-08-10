const WORKSPACE_MODE_KEY = 'cabinet-crafter:workspace-mode:v1';
const PANEL_STATE_KEY = 'cabinet-crafter:workspace-panels:v1';
const VIEW_TOOLBAR_KEY = 'cabinet-crafter:view-toolbar:v1';

const GUIDED_PARAMETER_KEYS = new Set([
    'width', 'height', 'depth', 'thickness', 'toeKickHeight', 'toeKickInset',
    'cpHeight', 'cpDepth', 'cpAngle', 'frontApronDrop',
    'monitorAngle', 'screenWidth', 'screenHeight', 'screenBezelMargin',
    'marqueeHeight', 'includeControlDeckSupport', 'controlProfileSupportCount',
    'includeDisplayBottomSupport', 'includeHeaderSupport', 'includeBackDoor',
    'includeMachineShelf', 'machineShelfHeight', 'screwDiameter', 'screwLength',
    'dummyHeight', 'exploded'
]);

const GUIDED_CONTROL_KEYS = new Set([
    'deck.players', 'deck.buttonsPerPlayer', 'deck.buttonRows', 'deck.buttonDiameter',
    'deck.groupSpacing', 'apron.buttons', 'apron.buttonDiameter'
]);

function readStored(key, fallback) {
    try {
        const value = window.localStorage.getItem(key);
        return value == null ? fallback : JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function writeStored(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage is optional */ }
}

function controlLabel(group) {
    return group?.querySelector('label')?.textContent?.replace(/\s+/g, ' ').trim()
        || group?.querySelector('legend, summary, h2, h3')?.textContent?.replace(/\s+/g, ' ').trim()
        || '';
}

export class WorkspaceShell {
    constructor(ui) {
        this.ui = ui;
        this.appContainer = document.querySelector('.app-container');
        this.mode = readStored(WORKSPACE_MODE_KEY, 'detailed') === 'guided' ? 'guided' : 'detailed';
        this.panelState = readStored(PANEL_STATE_KEY, { left: true, right: true });
        this.bindHeaderMenu();
        this.bindSidebarControls();
        this.bindInspectorTabs();
        this.bindWorkspaceMode();
        this.bindParameterSearch();
        this.bindViewportToolbar();
        this.bindViewportGuide();
        this.applyPanelState();
        this.applyWorkspaceMode(this.mode, false);
    }

    bindViewportToolbar() {
        const toolbar = document.querySelector('.viewport-toolbar');
        const controls = document.getElementById('viewport-toolbar-controls');
        const toggle = document.getElementById('btn-toggle-viewport-toolbar');
        if (!toolbar || !controls || !toggle) return;

        let expanded = readStored(VIEW_TOOLBAR_KEY, true) !== false;
        const apply = (announce = false) => {
            toolbar.classList.toggle('collapsed', !expanded);
            controls.hidden = !expanded;
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.textContent = expanded ? 'Hide views' : 'Views';
            toggle.title = expanded ? 'Collapse camera and visibility controls' : 'Show camera and visibility controls';
            writeStored(VIEW_TOOLBAR_KEY, expanded);
            if (announce) this.ui.showNotification(`View controls ${expanded ? 'shown' : 'collapsed'}`);
        };

        toggle.addEventListener('click', () => {
            expanded = !expanded;
            apply(true);
        });
        apply();
    }

    bindHeaderMenu() {
        const menu = document.getElementById('project-command-menu');
        menu?.querySelectorAll('button').forEach(button => button.addEventListener('click', () => menu.removeAttribute('open')));
        document.addEventListener('pointerdown', event => {
            if (menu?.open && !menu.contains(event.target)) menu.removeAttribute('open');
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && menu?.open) {
                menu.removeAttribute('open');
                menu.querySelector('summary')?.focus();
            }
        });
        document.getElementById('btn-new')?.addEventListener('click', () => void this.ui.startNewProject?.());
    }

    bindSidebarControls() {
        document.getElementById('btn-toggle-left-sidebar')?.addEventListener('click', () => {
            this.panelState.left = !this.panelState.left;
            this.applyPanelState(true);
        });
        document.getElementById('btn-toggle-right-sidebar')?.addEventListener('click', () => {
            this.panelState.right = !this.panelState.right;
            this.applyPanelState(true);
        });
    }

    applyPanelState(announce = false) {
        this.appContainer?.classList.toggle('left-sidebar-collapsed', !this.panelState.left);
        this.appContainer?.classList.toggle('right-sidebar-collapsed', !this.panelState.right);
        const leftButton = document.getElementById('btn-toggle-left-sidebar');
        const rightButton = document.getElementById('btn-toggle-right-sidebar');
        leftButton?.setAttribute('aria-pressed', String(this.panelState.left));
        rightButton?.setAttribute('aria-pressed', String(this.panelState.right));
        if (leftButton) {
            leftButton.textContent = 'Controls';
            leftButton.setAttribute('aria-label', `${this.panelState.left ? 'Hide' : 'Show'} controls panel`);
        }
        if (rightButton) {
            rightButton.textContent = 'Inspector';
            rightButton.setAttribute('aria-label', `${this.panelState.right ? 'Hide' : 'Show'} inspector panel`);
        }
        writeStored(PANEL_STATE_KEY, this.panelState);
        window.requestAnimationFrame(() => this.ui.app?.onWindowResize?.());
        if (announce) this.ui.showNotification(`${this.panelState.left ? 'Controls shown' : 'Controls hidden'}; ${this.panelState.right ? 'inspector shown' : 'inspector hidden'}`);
    }

    bindInspectorTabs() {
        const tabs = Array.from(document.querySelectorAll('[data-inspector-view]'));
        const activate = (view, focus = false) => {
            tabs.forEach(tab => {
                const active = tab.dataset.inspectorView === view;
                tab.classList.toggle('active', active);
                tab.setAttribute('aria-selected', String(active));
                tab.tabIndex = active ? 0 : -1;
                if (active && focus) tab.focus();
            });
            document.querySelectorAll('[data-inspector-panel]').forEach(panel => {
                panel.hidden = panel.dataset.inspectorPanel !== view;
            });
        };
        tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => activate(tab.dataset.inspectorView));
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                let next = index;
                if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = tabs.length - 1;
                activate(tabs[next].dataset.inspectorView, true);
            });
        });
        this.activateInspector = activate;
        activate('part');
    }

    bindWorkspaceMode() {
        document.getElementById('btn-mode-guided')?.addEventListener('click', () => this.applyWorkspaceMode('guided'));
        document.getElementById('btn-mode-detailed')?.addEventListener('click', () => this.applyWorkspaceMode('detailed'));
        document.getElementById('btn-show-detailed-settings')?.addEventListener('click', () => this.applyWorkspaceMode('detailed'));
        this.markGuidedControls();
    }

    markGuidedControls() {
        document.querySelectorAll('[data-param], [data-control-param], [data-component-param]').forEach(control => {
            const key = control.dataset.param || control.dataset.controlParam || control.dataset.componentParam;
            const essential = control.dataset.param
                ? GUIDED_PARAMETER_KEYS.has(key)
                : control.dataset.controlParam
                    ? GUIDED_CONTROL_KEYS.has(key)
                    : false;
            const group = control.closest('.control-group, .slider-inline');
            if (group && !essential) group.classList.add('guided-advanced');
        });
        document.querySelector('.advanced-component-editor')?.classList.add('guided-advanced');
        document.querySelectorAll('.control-subsection').forEach(section => {
            if (!section.querySelector('[data-param]:not(.guided-advanced *)')) section.classList.add('guided-advanced');
        });
    }

    applyWorkspaceMode(mode, announce = true) {
        this.mode = mode === 'guided' ? 'guided' : 'detailed';
        document.documentElement.dataset.workspaceMode = this.mode;
        const guided = document.getElementById('btn-mode-guided');
        const detailed = document.getElementById('btn-mode-detailed');
        [guided, detailed].forEach(button => button?.classList.toggle('active', button === (this.mode === 'guided' ? guided : detailed)));
        guided?.setAttribute('aria-pressed', String(this.mode === 'guided'));
        detailed?.setAttribute('aria-pressed', String(this.mode === 'detailed'));
        const summary = document.getElementById('guided-settings-summary');
        if (summary) summary.hidden = this.mode !== 'guided';
        writeStored(WORKSPACE_MODE_KEY, this.mode);
        if (announce) this.ui.showNotification(`${this.mode === 'guided' ? 'Guided' : 'Detailed'} controls shown`);
    }

    bindParameterSearch() {
        const search = document.getElementById('parameter-search');
        const status = document.getElementById('parameter-search-status');
        if (!search) return;
        const results = document.createElement('div');
        results.className = 'parameter-search-results';
        results.hidden = true;
        search.insertAdjacentElement('afterend', results);

        const candidates = Array.from(document.querySelectorAll('.sidebar-left .control-group, .sidebar-left .control-subsection'))
            .map(group => {
                const control = group.querySelector('[data-param], [data-control-param]');
                const tab = group.closest('.tab-content');
                return {
                    group,
                    control,
                    label: controlLabel(group),
                    searchable: `${controlLabel(group)} ${control?.dataset.param || ''} ${control?.dataset.controlParam || ''}`.toLowerCase(),
                    tabId: tab?.id?.replace(/^tab-/, '') || null
                };
            })
            .filter(candidate => candidate.label && candidate.control);

        const clear = () => {
            candidates.forEach(candidate => candidate.group.classList.remove('parameter-search-match'));
            results.replaceChildren();
            results.hidden = true;
            if (status) status.textContent = '';
        };

        search.addEventListener('input', () => {
            clear();
            const query = search.value.trim().toLowerCase();
            if (query.length < 2) return;
            const matches = candidates.filter(candidate => candidate.searchable.includes(query)).slice(0, 12);
            if (status) status.textContent = `${matches.length} setting${matches.length === 1 ? '' : 's'} found`;
            matches.forEach(candidate => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = candidate.label;
                button.addEventListener('click', () => {
                    this.applyWorkspaceMode('detailed', false);
                    if (candidate.tabId) this.ui.activateTab(candidate.tabId);
                    candidate.group.classList.add('parameter-search-match');
                    candidate.group.scrollIntoView({ block: 'center' });
                    window.setTimeout(() => candidate.control.focus(), 0);
                    results.hidden = true;
                });
                results.appendChild(button);
            });
            results.hidden = matches.length === 0;
        });
        search.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                search.value = '';
                clear();
            } else if (event.key === 'ArrowDown' && !results.hidden) {
                event.preventDefault();
                results.querySelector('button')?.focus();
            }
        });
        results.addEventListener('keydown', event => {
            const buttons = Array.from(results.querySelectorAll('button'));
            const index = buttons.indexOf(document.activeElement);
            if (event.key === 'Escape') {
                event.preventDefault();
                results.hidden = true;
                search.focus();
                return;
            }
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || index < 0) return;
            event.preventDefault();
            let next = index;
            if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
            if (event.key === 'ArrowDown') next = Math.min(buttons.length - 1, index + 1);
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = buttons.length - 1;
            buttons[next]?.focus();
        });
        document.addEventListener('pointerdown', event => {
            if (!results.hidden && !results.contains(event.target) && event.target !== search) results.hidden = true;
        });
    }

    bindViewportGuide() {
        const dialog = document.getElementById('viewport-guide-dialog');
        const opener = document.getElementById('btn-viewport-guide');
        opener?.addEventListener('click', () => {
            if (typeof dialog?.showModal === 'function') dialog.showModal();
            else dialog?.setAttribute('open', '');
            window.setTimeout(() => document.getElementById('btn-close-viewport-guide')?.focus(), 0);
        });
        document.getElementById('btn-close-viewport-guide')?.addEventListener('click', () => dialog?.close());
        dialog?.addEventListener('close', () => opener?.focus());
    }

    updateViewport(view, panel) {
        const orientation = document.getElementById('viewport-orientation');
        const selection = document.getElementById('viewport-selection');
        const dimensions = document.getElementById('viewport-dimensions');
        const orientationText = view === 'perspective' ? 'Perspective' : view ? `${view[0].toUpperCase()}${view.slice(1)} view` : '';
        const selectionText = panel?.userData?.name || 'No part selected';
        const dimensionsText = panel?.userData ? this.ui.formatPanelSize(panel.userData) : '';
        if (orientation && orientationText) {
            orientation.textContent = orientationText;
            orientation.title = `Current view: ${orientationText}`;
        }
        if (selection) {
            selection.textContent = selectionText;
            selection.title = selectionText;
        }
        if (dimensions) {
            dimensions.textContent = dimensionsText;
            dimensions.title = dimensionsText;
        }
    }
}
