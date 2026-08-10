import {
    createCurveFromPolygon,
    deleteCurveNode,
    normalizeSideProfileCustomization,
    polygonBounds,
    sampleCurveProfile,
    SIDE_PROFILE_NORMALIZED_LIMIT,
    SIDE_PROFILE_SAMPLING_OPTIONS,
    setCurveNodeMode,
    splitCurveSegment,
    validateCurveProfile
} from './side-profile.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EDITOR_WIDTH = 800;
const EDITOR_HEIGHT = 700;
const EDITOR_PADDING = 42;
const SIDE_PROFILE_PREVIEW_OPTIONS = Object.freeze({
    toleranceMm: 2,
    maxDepth: 9,
    maxPoints: 384
});

export class SideProfileEditor {
    constructor(ui) {
        this.ui = ui;
        this.dialog = document.getElementById('side-profile-dialog');
        this.openButton = document.getElementById('btn-edit-side-profile');
        this.svg = document.getElementById('side-profile-editor-canvas');
        this.stage = document.getElementById('side-profile-editor-stage');
        this.status = document.getElementById('side-profile-editor-status');
        this.applySummary = document.getElementById('side-profile-apply-summary');
        this.enabledInput = document.getElementById('side-profile-enabled');
        this.linkedInput = document.getElementById('side-profile-linked');
        this.snapInput = document.getElementById('side-profile-snap');
        this.targetInput = document.getElementById('side-profile-target');
        this.anchorList = document.getElementById('side-profile-anchor-list');
        this.pointXInput = document.getElementById('side-profile-point-x');
        this.pointYInput = document.getElementById('side-profile-point-y');
        this.handleInXInput = document.getElementById('side-profile-in-x');
        this.handleInYInput = document.getElementById('side-profile-in-y');
        this.handleOutXInput = document.getElementById('side-profile-out-x');
        this.handleOutYInput = document.getElementById('side-profile-out-y');
        this.coordinateUnitLabels = [...document.querySelectorAll(
            '#side-profile-point-x-unit, #side-profile-point-y-unit, .side-profile-coordinate-unit'
        )];
        this.snapLabel = document.getElementById('side-profile-snap-label');
        this.nudgeShortcut = document.getElementById('side-profile-nudge-shortcut');
        this.largeNudgeShortcut = document.getElementById('side-profile-nudge-large-shortcut');
        this.modeInput = document.getElementById('side-profile-point-mode');
        this.selectionHelp = document.getElementById('side-profile-selection-help');
        this.addPointButton = document.getElementById('btn-side-profile-add-point');
        this.deletePointButton = document.getElementById('btn-side-profile-delete-point');
        this.undoButton = document.getElementById('btn-side-profile-undo');
        this.redoButton = document.getElementById('btn-side-profile-redo');
        this.resetButton = document.getElementById('btn-side-profile-reset');
        this.applyButton = document.getElementById('btn-apply-side-profile');
        this.cancelButton = document.getElementById('btn-cancel-side-profile');
        this.closeButton = document.getElementById('btn-close-side-profile');
        this.zoomOutButton = document.getElementById('btn-side-profile-zoom-out');
        this.fitButton = document.getElementById('btn-side-profile-fit');
        this.zoomInButton = document.getElementById('btn-side-profile-zoom-in');
        this.zoomLabel = document.getElementById('side-profile-zoom-label');
        this.draft = null;
        this.structuralBySide = { left: [], right: [] };
        this.targetSide = 'left';
        this.selectedNodeId = null;
        this.drag = null;
        this.editorTransform = null;
        this.draftHistory = [];
        this.draftHistoryIndex = -1;
        this.openedDraftSignature = '';
        this.zoomFactor = 1;

        if (!this.dialog || !this.svg || !this.stage) return;
        this.bindEvents();
        this.syncSummary();
    }

    bindEvents() {
        this.openButton?.addEventListener('click', () => this.open());
        this.cancelButton?.addEventListener('click', () => this.close(true));
        this.closeButton?.addEventListener('click', () => this.requestClose());
        this.dialog.addEventListener('cancel', event => {
            event.preventDefault();
            this.requestClose();
        });
        this.enabledInput?.addEventListener('change', () => {
            this.draft.enabled = this.enabledInput.checked;
            this.commitDraft();
            this.render();
        });
        this.linkedInput?.addEventListener('change', () => this.setLinked(this.linkedInput.checked));
        this.targetInput?.addEventListener('change', () => {
            if (this.targetInput.value === 'both') return;
            this.targetSide = this.targetInput.value === 'right' ? 'right' : 'left';
            this.selectedNodeId = null;
            this.ensureActiveCurve();
            this.render();
        });
        this.anchorList?.addEventListener('change', () => {
            this.selectedNodeId = this.anchorList.value || null;
            this.render();
            this.stage.querySelector(`.profile-anchor[data-profile-node-id="${cssEscape(this.selectedNodeId)}"]`)?.focus();
        });
        this.modeInput?.addEventListener('change', () => this.changeSelectedMode(this.modeInput.value));
        this.pointXInput?.addEventListener('change', () => this.applyExactPoint());
        this.pointYInput?.addEventListener('change', () => this.applyExactPoint());
        [this.handleInXInput, this.handleInYInput, this.handleOutXInput, this.handleOutYInput]
            .forEach(input => input?.addEventListener('change', () => this.applyExactHandles()));
        this.addPointButton?.addEventListener('click', () => this.addMidpoint());
        this.deletePointButton?.addEventListener('click', () => this.deleteSelectedPoint());
        this.undoButton?.addEventListener('click', () => this.undoDraft());
        this.redoButton?.addEventListener('click', () => this.redoDraft());
        this.resetButton?.addEventListener('click', () => this.resetCurrentSide());
        this.applyButton?.addEventListener('click', () => this.apply());
        this.zoomOutButton?.addEventListener('click', () => this.setZoom(this.zoomFactor / 1.25));
        this.fitButton?.addEventListener('click', () => this.setZoom(1));
        this.zoomInButton?.addEventListener('click', () => this.setZoom(this.zoomFactor * 1.25));
        this.svg.addEventListener('pointerdown', event => this.beginDrag(event));
        this.svg.addEventListener('pointermove', event => this.continueDrag(event));
        this.svg.addEventListener('pointerup', event => this.endDrag(event));
        this.svg.addEventListener('pointercancel', event => this.endDrag(event));
        this.svg.addEventListener('keydown', event => this.handleCanvasKeydown(event));
        this.svg.addEventListener('click', event => {
            const anchor = event.target.closest?.('[data-profile-node-id]');
            if (!anchor) return;
            this.selectedNodeId = anchor.dataset.profileNodeId;
            this.render();
        });
    }

    syncSummary() {}

    open() {
        this.ui?.flushPendingCabinetUpdate?.();
        const leftPanel = this.ui?.cabinet?.getPanelById?.('side_left');
        const rightPanel = this.ui?.cabinet?.getPanelById?.('side_right');
        this.structuralBySide = {
            left: clonePoints(leftPanel?.userData?.structuralProfilePoints || leftPanel?.userData?.profilePoints || []),
            right: clonePoints(rightPanel?.userData?.structuralProfilePoints || rightPanel?.userData?.profilePoints || [])
        };
        if (this.structuralBySide.left.length < 3 || this.structuralBySide.right.length < 3) {
            this.ui?.showNotification?.('The structural side profile is not available yet.');
            return;
        }

        this.draft = normalizeSideProfileCustomization(this.ui.cabinet.params.sideProfileCustomization);
        this.targetSide = 'left';
        this.selectedNodeId = null;
        this.ensureActiveCurve();
        this.enabledInput.checked = this.draft.enabled;
        this.linkedInput.checked = this.draft.linked;
        this.snapInput.checked = true;
        this.draftHistory = [clone(this.draft)];
        this.draftHistoryIndex = 0;
        this.openedDraftSignature = JSON.stringify(this.draft);
        this.zoomFactor = 1;
        this.targetInput.value = this.draft.linked ? 'both' : this.targetSide;
        this.dialog.showModal();
        this.render();
    }

    requestClose() {
        if (!this.draft) return;
        const dirty = JSON.stringify(this.draft) !== this.openedDraftSignature;
        if (dirty && typeof globalThis.confirm === 'function'
            && !globalThis.confirm('Discard the unapplied side-profile changes?')) return;
        this.close(true);
    }

    close(discard = false) {
        if (!discard) {
            this.requestClose();
            return;
        }
        this.drag = null;
        this.draft = null;
        this.draftHistory = [];
        this.draftHistoryIndex = -1;
        this.openedDraftSignature = '';
        if (this.dialog?.open) this.dialog.close();
    }

    getStructuralProfile() {
        return this.structuralBySide[this.targetSide] || this.structuralBySide.left;
    }

    getActiveCurve() {
        if (!this.draft) return null;
        return this.draft.linked ? this.draft.shared : this.draft[this.targetSide];
    }

    setActiveCurve(curve) {
        if (!this.draft) return;
        if (this.draft.linked) this.draft.shared = curve;
        else this.draft[this.targetSide] = curve;
    }

    ensureActiveCurve() {
        if (!this.draft) return null;
        const structural = this.getStructuralProfile();
        if (this.draft.linked) {
            this.draft.shared ||= createCurveFromPolygon(structural);
        } else {
            this.draft[this.targetSide] ||= createCurveFromPolygon(structural);
        }
        return this.getActiveCurve();
    }

    setLinked(linked) {
        if (!this.draft || this.draft.linked === linked) return;
        const current = this.ensureActiveCurve();
        if (linked) {
            this.draft.shared = clone(current || createCurveFromPolygon(this.getStructuralProfile()));
            this.draft.linked = true;
        } else {
            const shared = clone(current || createCurveFromPolygon(this.structuralBySide.left));
            this.draft.linked = false;
            this.draft.left = clone(shared);
            this.draft.right = clone(shared);
        }
        this.selectedNodeId = null;
        this.ensureActiveCurve();
        this.commitDraft();
        this.render();
    }

    render() {
        if (!this.draft || !this.stage) return;
        const structural = this.getStructuralProfile();
        const curve = this.ensureActiveCurve();
        const validations = this.validateDraft(this.drag ? SIDE_PROFILE_PREVIEW_OPTIONS : SIDE_PROFILE_SAMPLING_OPTIONS);
        const validation = validations[this.targetSide];
        const allValid = Object.values(validations).every(result => result.valid);
        const sampled = validation.points?.length
            ? validation.points
            : sampleCurveProfile(curve, structural, SIDE_PROFILE_SAMPLING_OPTIONS);
        const combined = [...structural, ...sampled];
        if (!this.drag || !this.editorTransform) {
            this.editorTransform = makeEditorTransform(combined, this.zoomFactor);
        }
        this.stage.replaceChildren();
        this.drawGrid();
        this.stage.appendChild(svgPath('structural-envelope', polygonPath(structural, this.editorTransform)));

        const editablePath = svgPath(
            `editable-profile${validation.valid ? '' : ' invalid'}`,
            curvePath(curve, structural, this.editorTransform)
        );
        this.stage.appendChild(editablePath);
        this.drawNodes(curve, structural);

        this.enabledInput.checked = this.draft.enabled;
        this.linkedInput.checked = this.draft.linked;
        this.targetInput.disabled = this.draft.linked;
        this.targetInput.value = this.draft.linked ? 'both' : this.targetSide;
        this.resetButton.textContent = this.draft.linked ? 'Reset both walls' : `Reset ${this.targetSide} wall`;
        this.undoButton.disabled = this.draftHistoryIndex <= 0;
        this.redoButton.disabled = this.draftHistoryIndex >= this.draftHistory.length - 1;
        this.zoomLabel.textContent = `${Math.round(this.zoomFactor * 100)}%`;
        const mayApply = !this.draft.enabled || allValid;
        this.applyButton.disabled = !mayApply;
        this.status.className = `side-profile-editor-status ${allValid ? 'success' : 'error'}`;
        if (!this.draft.enabled) {
            this.status.textContent = allValid
                ? 'Decorative shaping is off. Your curve is retained and can be enabled later.'
                : 'Decorative shaping is off. Resolve the curve issues before enabling it.';
        } else if (allValid) {
            this.status.textContent = 'Profile is valid. The locked structural envelope is fully covered.';
        } else {
            const invalidSide = Object.entries(validations).find(([, result]) => !result.valid);
            const prefix = this.draft.linked ? 'Shared curve' : `${capitalize(invalidSide?.[0] || this.targetSide)} wall`;
            this.status.textContent = `${prefix}: ${invalidSide?.[1]?.errors?.[0]?.message || 'the curve must remain outside the structural envelope.'}`;
        }
        this.applySummary.textContent = this.draft.enabled
            ? `${curve.nodes.length} anchors, ${this.draft.linked ? 'shared by both walls' : `editing the ${this.targetSide} wall`}.`
            : 'The standard structural outline will remain active.';
        this.syncUnitControls();
        this.syncSelectedControls(curve, structural);
    }

    validateDraft(options = SIDE_PROFILE_SAMPLING_OPTIONS) {
        const linkedCurve = this.draft?.shared;
        return {
            left: validateCurveProfile(
                this.draft?.linked ? linkedCurve : this.draft?.left,
                this.structuralBySide.left,
                options
            ),
            right: validateCurveProfile(
                this.draft?.linked ? linkedCurve : this.draft?.right,
                this.structuralBySide.right,
                options
            )
        };
    }

    setZoom(value) {
        this.zoomFactor = Math.min(3, Math.max(0.5, Number(value) || 1));
        this.editorTransform = null;
        this.render();
    }

    syncUnitControls() {
        const inches = this.ui?.unitMode === 'in';
        const unit = inches ? 'in' : 'mm';
        const step = inches ? '0.001' : '1';
        this.coordinateUnitLabels.forEach(label => { label.textContent = unit; });
        [this.pointXInput, this.pointYInput, this.handleInXInput, this.handleInYInput, this.handleOutXInput, this.handleOutYInput]
            .forEach(input => { if (input) input.step = step; });
        if (this.snapLabel) this.snapLabel.textContent = inches
            ? 'Snap pointer edits to 0.197 in'
            : 'Snap pointer edits to 5 mm';
        if (this.nudgeShortcut) this.nudgeShortcut.textContent = inches
            ? 'Arrow keys: 0.01 in'
            : 'Arrow keys: 1 mm';
        if (this.largeNudgeShortcut) this.largeNudgeShortcut.textContent = inches
            ? 'Shift + arrows: 0.1 in'
            : 'Shift + arrows: 10 mm';
    }

    drawGrid() {
        const { minX, maxX, minY, maxY } = this.editorTransform.worldBounds;
        const step = niceGridStep(Math.max(maxX - minX, maxY - minY) / 20);
        const startX = Math.floor(minX / step) * step;
        const startY = Math.floor(minY / step) * step;
        for (let x = startX; x <= maxX; x += step) {
            const a = this.editorTransform.toScreen({ x, y: minY });
            const b = this.editorTransform.toScreen({ x, y: maxY });
            this.stage.appendChild(svgLine('profile-grid-line', a, b));
        }
        for (let y = startY; y <= maxY; y += step) {
            const a = this.editorTransform.toScreen({ x: minX, y });
            const b = this.editorTransform.toScreen({ x: maxX, y });
            this.stage.appendChild(svgLine('profile-grid-line', a, b));
        }
    }

    drawNodes(curve, structural) {
        const bounds = polygonBounds(structural);
        const selected = curve.nodes.find(node => node.id === this.selectedNodeId) || null;
        if (selected) {
            const anchorPoint = normalizedToWorld(selected, bounds);
            ['in', 'out'].forEach(handleName => {
                const handlePoint = normalizedToWorld(selected[handleName], bounds);
                const anchorScreen = this.editorTransform.toScreen(anchorPoint);
                const handleScreen = this.editorTransform.toScreen(handlePoint);
                this.stage.appendChild(svgLine('profile-handle-line', anchorScreen, handleScreen));
                const handle = svgCircle('profile-handle', handleScreen, 5);
                handle.dataset.profileNodeId = selected.id;
                handle.dataset.profileHandle = handleName;
                handle.setAttribute('aria-hidden', 'true');
                this.stage.appendChild(handle);
            });
        }

        curve.nodes.forEach((node, index) => {
            const screen = this.editorTransform.toScreen(normalizedToWorld(node, bounds));
            const hit = svgCircle('profile-anchor-hit', screen, 15);
            hit.dataset.profileNodeId = node.id;
            hit.setAttribute('aria-hidden', 'true');
            this.stage.appendChild(hit);
            const anchor = svgCircle(`profile-anchor${node.id === this.selectedNodeId ? ' selected' : ''}`, screen, 7);
            anchor.dataset.profileNodeId = node.id;
            anchor.setAttribute('tabindex', '0');
            anchor.setAttribute('role', 'button');
            anchor.setAttribute('aria-label', `Profile anchor ${index + 1} of ${curve.nodes.length}`);
            this.stage.appendChild(anchor);
        });
    }

    syncSelectedControls(curve, structural) {
        const node = curve.nodes.find(item => item.id === this.selectedNodeId);
        const disabled = !node;
        const exactInputs = [
            this.pointXInput,
            this.pointYInput,
            this.handleInXInput,
            this.handleInYInput,
            this.handleOutXInput,
            this.handleOutYInput
        ];
        [...exactInputs, this.modeInput, this.addPointButton].forEach(control => {
            control.disabled = disabled;
        });
        this.anchorList.replaceChildren(...curve.nodes.map((candidate, index) => {
            const option = document.createElement('option');
            const world = normalizedToWorld(candidate, polygonBounds(structural));
            option.value = candidate.id;
            option.textContent = `${index + 1}. ${candidate.id} (${this.formatDisplay(world.x)}, ${this.formatDisplay(world.y)})`;
            option.selected = candidate.id === this.selectedNodeId;
            return option;
        }));
        this.deletePointButton.disabled = disabled || curve.nodes.length <= 3;
        if (!node) {
            this.selectionHelp.textContent = 'Select a circular anchor in the drawing or choose one from the list.';
            exactInputs.forEach(input => { input.value = ''; });
            return;
        }
        const bounds = polygonBounds(structural);
        const world = normalizedToWorld(node, bounds);
        const handleIn = normalizedToWorld(node.in, bounds);
        const handleOut = normalizedToWorld(node.out, bounds);
        this.selectionHelp.textContent = `Editing ${node.id}. Add midpoint inserts a point on the following segment.`;
        this.pointXInput.value = this.formatDisplay(world.x);
        this.pointYInput.value = this.formatDisplay(world.y);
        this.handleInXInput.value = this.formatDisplay(handleIn.x);
        this.handleInYInput.value = this.formatDisplay(handleIn.y);
        this.handleOutXInput.value = this.formatDisplay(handleOut.x);
        this.handleOutYInput.value = this.formatDisplay(handleOut.y);
        this.modeInput.value = node.mode;
    }

    formatDisplay(valueMm) {
        const value = this.ui?.getDisplayNumber?.(valueMm, 'mm') ?? valueMm;
        return trim(value, this.ui?.unitMode === 'in' ? 3 : 2);
    }

    parseDisplay(value) {
        return this.ui?.getBaseNumber?.(value, 'mm') ?? Number(value);
    }

    beginDrag(event) {
        const target = event.target.closest?.('[data-profile-node-id]');
        if (!target || !this.draft) return;
        event.preventDefault();
        this.selectedNodeId = target.dataset.profileNodeId;
        const curve = this.getActiveCurve();
        const node = curve?.nodes?.find(candidate => candidate.id === this.selectedNodeId);
        const handle = target.dataset.profileHandle || 'anchor';
        const pointerWorld = this.clientToWorld(event.clientX, event.clientY);
        const bounds = polygonBounds(this.getStructuralProfile());
        const grabbedPoint = node
            ? normalizedToWorld(handle === 'anchor' ? node : node[handle], bounds)
            : pointerWorld;
        this.drag = {
            pointerId: event.pointerId,
            nodeId: this.selectedNodeId,
            handle,
            moved: false,
            grabOffset: pointerWorld && grabbedPoint
                ? { x: grabbedPoint.x - pointerWorld.x, y: grabbedPoint.y - pointerWorld.y }
                : { x: 0, y: 0 }
        };
        this.svg.setPointerCapture?.(event.pointerId);
    }

    continueDrag(event) {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        this.updateDraggedPoint(event);
    }

    endDrag(event) {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        this.svg.releasePointerCapture?.(event.pointerId);
        const moved = this.drag.moved;
        this.drag = null;
        if (moved) this.commitDraft();
        this.editorTransform = null;
        this.render();
    }

    updateDraggedPoint(event) {
        const pointerWorld = this.clientToWorld(event.clientX, event.clientY);
        const sourceWorld = pointerWorld ? {
            x: pointerWorld.x + this.drag.grabOffset.x,
            y: pointerWorld.y + this.drag.grabOffset.y
        } : null;
        const world = sourceWorld && this.snapInput?.checked
            ? { x: Math.round(sourceWorld.x / 5) * 5, y: Math.round(sourceWorld.y / 5) * 5 }
            : sourceWorld;
        if (!world) return;
        const bounds = polygonBounds(this.getStructuralProfile());
        const normalized = clampNormalizedPoint(worldToNormalized(world, bounds));
        const curve = this.getActiveCurve();
        const index = curve.nodes.findIndex(node => node.id === this.drag.nodeId);
        if (index < 0) return;
        const nodes = curve.nodes.map(node => clone(node));
        const node = nodes[index];
        if (this.drag.handle === 'anchor') {
            const delta = { x: normalized.x - node.x, y: normalized.y - node.y };
            node.x = normalized.x;
            node.y = normalized.y;
            node.in = { x: node.in.x + delta.x, y: node.in.y + delta.y };
            node.out = { x: node.out.x + delta.x, y: node.out.y + delta.y };
        } else {
            node[this.drag.handle] = normalized;
            alignOppositeHandle(node, this.drag.handle);
        }
        this.setActiveCurve({ ...curve, nodes });
        this.drag.moved = true;
        this.render();
    }

    clientToWorld(clientX, clientY) {
        const matrix = this.svg.getScreenCTM?.();
        if (matrix && this.svg.createSVGPoint) {
            const point = this.svg.createSVGPoint();
            point.x = clientX;
            point.y = clientY;
            const screen = point.matrixTransform(matrix.inverse());
            return this.editorTransform?.toWorld(screen) || null;
        }
        const rect = this.svg.getBoundingClientRect();
        if (!rect.width || !rect.height || !this.editorTransform) return null;
        const screen = {
            x: (clientX - rect.left) / rect.width * EDITOR_WIDTH,
            y: (clientY - rect.top) / rect.height * EDITOR_HEIGHT
        };
        return this.editorTransform.toWorld(screen);
    }

    handleCanvasKeydown(event) {
        const target = event.target.closest?.('[data-profile-node-id]');
        if (target) this.selectedNodeId = target.dataset.profileNodeId;
        if (!this.selectedNodeId) return;
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            this.deleteSelectedPoint();
            return;
        }
        const directions = {
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 },
            ArrowUp: { x: 0, y: 1 },
            ArrowDown: { x: 0, y: -1 }
        };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        const amount = this.ui?.unitMode === 'in'
            ? (event.shiftKey ? 2.54 : 0.254)
            : (event.shiftKey ? 10 : 1);
        this.moveSelectedBy(direction.x * amount, direction.y * amount);
    }

    moveSelectedBy(dxMm, dyMm) {
        const curve = this.getActiveCurve();
        const bounds = polygonBounds(this.getStructuralProfile());
        const dx = dxMm / Math.max(1, bounds.maxX - bounds.minX);
        const dy = dyMm / Math.max(1, bounds.maxY - bounds.minY);
        const nodes = curve.nodes.map(node => {
            if (node.id !== this.selectedNodeId) return clone(node);
            const bounded = boundedNodeDelta(node, dx, dy);
            return {
                ...clone(node),
                x: node.x + bounded.x,
                y: node.y + bounded.y,
                in: { x: node.in.x + bounded.x, y: node.in.y + bounded.y },
                out: { x: node.out.x + bounded.x, y: node.out.y + bounded.y }
            };
        });
        this.setActiveCurve({ ...curve, nodes });
        this.commitDraft();
        this.render();
        this.stage.querySelector(`.profile-anchor[data-profile-node-id="${cssEscape(this.selectedNodeId)}"]`)?.focus();
    }

    applyExactPoint() {
        if (!this.selectedNodeId) return;
        const x = this.parseDisplay(this.pointXInput.value);
        const y = this.parseDisplay(this.pointYInput.value);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const curve = this.getActiveCurve();
        const bounds = polygonBounds(this.getStructuralProfile());
        const next = clampNormalizedPoint(worldToNormalized({ x, y }, bounds));
        const nodes = curve.nodes.map(node => {
            if (node.id !== this.selectedNodeId) return clone(node);
            const delta = { x: next.x - node.x, y: next.y - node.y };
            return {
                ...clone(node),
                x: next.x,
                y: next.y,
                in: { x: node.in.x + delta.x, y: node.in.y + delta.y },
                out: { x: node.out.x + delta.x, y: node.out.y + delta.y }
            };
        });
        this.setActiveCurve({ ...curve, nodes });
        this.commitDraft();
        this.render();
    }

    applyExactHandles() {
        if (!this.selectedNodeId) return;
        const values = [
            this.handleInXInput.value,
            this.handleInYInput.value,
            this.handleOutXInput.value,
            this.handleOutYInput.value
        ].map(value => this.parseDisplay(value));
        if (!values.every(Number.isFinite)) return;
        const bounds = polygonBounds(this.getStructuralProfile());
        const handleIn = clampNormalizedPoint(worldToNormalized({ x: values[0], y: values[1] }, bounds));
        const handleOut = clampNormalizedPoint(worldToNormalized({ x: values[2], y: values[3] }, bounds));
        const curve = this.getActiveCurve();
        const nodes = curve.nodes.map(node => node.id === this.selectedNodeId
            ? { ...clone(node), in: handleIn, out: handleOut }
            : clone(node));
        let nextCurve = { ...curve, nodes };
        const selected = nodes.find(node => node.id === this.selectedNodeId);
        if (selected?.mode && selected.mode !== 'corner') {
            nextCurve = setCurveNodeMode(nextCurve, this.selectedNodeId, selected.mode, 'out');
        }
        this.setActiveCurve(nextCurve);
        this.commitDraft();
        this.render();
    }

    changeSelectedMode(mode) {
        if (!this.selectedNodeId) return;
        this.setActiveCurve(setCurveNodeMode(this.getActiveCurve(), this.selectedNodeId, mode));
        this.commitDraft();
        this.render();
    }

    addMidpoint() {
        const curve = this.getActiveCurve();
        const index = curve.nodes.findIndex(node => node.id === this.selectedNodeId);
        if (index < 0 || curve.nodes.length >= 64) return;
        const next = splitCurveSegment(curve, index, 0.5);
        const insertedIndex = (index + 1) % next.nodes.length;
        this.selectedNodeId = next.nodes[insertedIndex]?.id || null;
        this.setActiveCurve(next);
        this.commitDraft();
        this.render();
    }

    deleteSelectedPoint() {
        const curve = this.getActiveCurve();
        if (!this.selectedNodeId || curve.nodes.length <= 3) return;
        const index = curve.nodes.findIndex(node => node.id === this.selectedNodeId);
        const next = deleteCurveNode(curve, this.selectedNodeId);
        this.selectedNodeId = next.nodes[Math.min(index, next.nodes.length - 1)]?.id || null;
        this.setActiveCurve(next);
        this.commitDraft();
        this.render();
    }

    resetCurrentSide() {
        this.setActiveCurve(createCurveFromPolygon(this.getStructuralProfile()));
        this.selectedNodeId = null;
        this.commitDraft();
        this.render();
    }

    commitDraft() {
        if (!this.draft) return;
        const signature = JSON.stringify(this.draft);
        if (JSON.stringify(this.draftHistory[this.draftHistoryIndex]) === signature) return;
        if (this.draftHistoryIndex < this.draftHistory.length - 1) {
            this.draftHistory.splice(this.draftHistoryIndex + 1);
        }
        this.draftHistory.push(clone(this.draft));
        if (this.draftHistory.length > 80) this.draftHistory.shift();
        this.draftHistoryIndex = this.draftHistory.length - 1;
    }

    undoDraft() {
        if (this.draftHistoryIndex <= 0) return;
        this.draftHistoryIndex -= 1;
        this.draft = clone(this.draftHistory[this.draftHistoryIndex]);
        this.selectedNodeId = null;
        this.render();
    }

    redoDraft() {
        if (this.draftHistoryIndex >= this.draftHistory.length - 1) return;
        this.draftHistoryIndex += 1;
        this.draft = clone(this.draftHistory[this.draftHistoryIndex]);
        this.selectedNodeId = null;
        this.render();
    }

    apply() {
        if (!this.draft) return;
        const validations = this.validateDraft();
        const invalid = this.draft.enabled && Object.values(validations).some(result => !result.valid);
        if (invalid) {
            this.status.textContent = 'Both active wall profiles must cover their structural envelopes before they can be applied.';
            this.status.className = 'side-profile-editor-status error';
            return;
        }
        const value = normalizeSideProfileCustomization(this.draft);
        this.ui.cabinet.updateParams({ sideProfileCustomization: value });
        this.ui.app.params = this.ui.cabinet.params;
        this.ui.afterCabinetMutation('Edit decorative side profile');
        this.ui.commitHistoryNow('Edit decorative side profile');
        this.syncSummary(value);
        this.ui.selectPanel?.(this.targetSide === 'right' ? 'side_right' : 'side_left');
        this.ui.showNotification?.(value.enabled ? 'Decorative side profile applied' : 'Standard side profile restored');
        this.openedDraftSignature = JSON.stringify(value);
        this.close(true);
    }
}

function makeEditorTransform(points, zoomFactor = 1) {
    const bounds = polygonBounds(points);
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const padX = Math.max(40, width * 0.08);
    const padY = Math.max(40, height * 0.08);
    const fitBounds = {
        minX: bounds.minX - padX,
        maxX: bounds.maxX + padX,
        minY: bounds.minY - padY,
        maxY: bounds.maxY + padY
    };
    const worldWidth = fitBounds.maxX - fitBounds.minX;
    const worldHeight = fitBounds.maxY - fitBounds.minY;
    const fitScale = Math.min(
        (EDITOR_WIDTH - EDITOR_PADDING * 2) / worldWidth,
        (EDITOR_HEIGHT - EDITOR_PADDING * 2) / worldHeight
    );
    const scale = fitScale * zoomFactor;
    const centerX = (fitBounds.minX + fitBounds.maxX) / 2;
    const centerY = (fitBounds.minY + fitBounds.maxY) / 2;
    const worldBounds = {
        minX: centerX - EDITOR_WIDTH / (2 * scale),
        maxX: centerX + EDITOR_WIDTH / (2 * scale),
        minY: centerY - EDITOR_HEIGHT / (2 * scale),
        maxY: centerY + EDITOR_HEIGHT / (2 * scale)
    };
    return {
        scale,
        worldBounds,
        toScreen(point) {
            return {
                x: EDITOR_WIDTH / 2 + (point.x - centerX) * scale,
                y: EDITOR_HEIGHT / 2 - (point.y - centerY) * scale
            };
        },
        toWorld(point) {
            return {
                x: centerX + (point.x - EDITOR_WIDTH / 2) / scale,
                y: centerY + (EDITOR_HEIGHT / 2 - point.y) / scale
            };
        }
    };
}

function curvePath(curve, structural, transform) {
    const bounds = polygonBounds(structural);
    const nodes = curve?.nodes || [];
    if (!nodes.length) return '';
    const start = transform.toScreen(normalizedToWorld(nodes[0], bounds));
    let d = `M ${trim(start.x)} ${trim(start.y)}`;
    nodes.forEach((node, index) => {
        const next = nodes[(index + 1) % nodes.length];
        const controlA = transform.toScreen(normalizedToWorld(node.out, bounds));
        const controlB = transform.toScreen(normalizedToWorld(next.in, bounds));
        const end = transform.toScreen(normalizedToWorld(next, bounds));
        d += ` C ${trim(controlA.x)} ${trim(controlA.y)} ${trim(controlB.x)} ${trim(controlB.y)} ${trim(end.x)} ${trim(end.y)}`;
    });
    return `${d} Z`;
}

function polygonPath(points, transform) {
    if (!points.length) return '';
    return points.map((point, index) => {
        const screen = transform.toScreen(point);
        return `${index ? 'L' : 'M'} ${trim(screen.x)} ${trim(screen.y)}`;
    }).join(' ') + ' Z';
}

function normalizedToWorld(point, bounds) {
    return {
        x: bounds.minX + Number(point?.x || 0) * Math.max(1, bounds.maxX - bounds.minX),
        y: bounds.minY + Number(point?.y || 0) * Math.max(1, bounds.maxY - bounds.minY)
    };
}

function worldToNormalized(point, bounds) {
    return {
        x: (point.x - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX),
        y: (point.y - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY)
    };
}

function alignOppositeHandle(node, changedName) {
    if (node.mode === 'corner') return;
    const otherName = changedName === 'in' ? 'out' : 'in';
    const changed = node[changedName];
    const other = node[otherName];
    const dx = changed.x - node.x;
    const dy = changed.y - node.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.000001) return;
    const otherLength = node.mode === 'symmetric'
        ? length
        : Math.hypot(other.x - node.x, other.y - node.y);
    node[otherName] = {
        x: node.x - dx / length * otherLength,
        y: node.y - dy / length * otherLength
    };
}

function svgPath(className, d) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', d);
    return path;
}

function svgLine(className, start, end) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', className);
    line.setAttribute('x1', trim(start.x));
    line.setAttribute('y1', trim(start.y));
    line.setAttribute('x2', trim(end.x));
    line.setAttribute('y2', trim(end.y));
    return line;
}

function svgCircle(className, center, radius) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', className);
    circle.setAttribute('cx', trim(center.x));
    circle.setAttribute('cy', trim(center.y));
    circle.setAttribute('r', radius);
    return circle;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function clonePoints(points) {
    return (points || []).map(point => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }));
}

function trim(value, precision = 3) {
    return Number(Number(value || 0).toFixed(precision));
}

function clampNormalizedPoint(point) {
    return {
        x: Math.min(SIDE_PROFILE_NORMALIZED_LIMIT, Math.max(-SIDE_PROFILE_NORMALIZED_LIMIT, Number(point?.x) || 0)),
        y: Math.min(SIDE_PROFILE_NORMALIZED_LIMIT, Math.max(-SIDE_PROFILE_NORMALIZED_LIMIT, Number(point?.y) || 0))
    };
}

function boundedNodeDelta(node, dx, dy) {
    const xs = [node.x, node.in.x, node.out.x];
    const ys = [node.y, node.in.y, node.out.y];
    return {
        x: Math.min(
            SIDE_PROFILE_NORMALIZED_LIMIT - Math.max(...xs),
            Math.max(-SIDE_PROFILE_NORMALIZED_LIMIT - Math.min(...xs), dx)
        ),
        y: Math.min(
            SIDE_PROFILE_NORMALIZED_LIMIT - Math.max(...ys),
            Math.max(-SIDE_PROFILE_NORMALIZED_LIMIT - Math.min(...ys), dy)
        )
    };
}

function niceGridStep(rawStep) {
    const safe = Math.max(1, Number(rawStep) || 100);
    const magnitude = 10 ** Math.floor(Math.log10(safe));
    const normalized = safe / magnitude;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return factor * magnitude;
}

function capitalize(value) {
    const text = String(value || '');
    return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
