import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Cabinet, PRESETS, cloneParams, normalizeParams } from './cabinet.js';
import { ScaleDummy } from './dummy.js';
import { UIManager } from './ui.js';
import * as ProjectIO from './export.js';

const DEFAULT_CAMERA_POSITION = Object.freeze({ x: 1900, y: 1500, z: 2500 });
const DEFAULT_CAMERA_TARGET = Object.freeze({ x: 0, y: 820, z: 0 });

class ArcadeDesignerApp {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.params = { ...cloneParams(PRESETS.standard), presetId: 'standard' };
        this.cameraMode = 'perspective';
        this.isolatedPanelId = null;
        this.screwsVisible = true;
        this.renderFrameHandle = null;
        this.controlsInteracting = false;
        this.webglContextLost = false;
        this.pointerGesture = null;
        this.hoverFrameHandle = null;
        this.pendingHoverPoint = null;
        this.projectLoadGeneration = 0;
        this.viewportRenderWidth = 0;
        this.viewportRenderHeight = 0;
        this.viewportPixelRatio = 0;

        this.initThree();
        this.initEntities();
        this.initRaycaster();
        this.initUI();

        this.onWindowResize = this.onWindowResize.bind(this);
        window.addEventListener('resize', this.onWindowResize);
        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(() => this.onWindowResize());
            this.resizeObserver.observe(this.container);
        }
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.onWindowResize();
                this.requestRender();
            }
        });
        this.requestRender();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf7f7f4);

        const viewportWidth = Math.max(1, this.container.clientWidth);
        const viewportHeight = Math.max(1, this.container.clientHeight);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        this.camera = new THREE.PerspectiveCamera(40, viewportWidth / viewportHeight, 10, 12000);
        this.camera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(viewportWidth, viewportHeight, false);
        this.viewportRenderWidth = viewportWidth;
        this.viewportRenderHeight = viewportHeight;
        this.viewportPixelRatio = pixelRatio;
        this.renderer.shadowMap.enabled = false;
        this.renderer.domElement.tabIndex = 0;
        this.renderer.domElement.setAttribute('role', 'img');
        this.renderer.domElement.setAttribute(
            'aria-label',
            'Interactive 3D cabinet preview. Use arrow keys to orbit, Page Up and Page Down to zoom, Home to fit, and Escape to clear the selected component.'
        );
        this.container.appendChild(this.renderer.domElement);
        this.renderer.domElement.addEventListener('webglcontextlost', event => {
            event.preventDefault();
            this.webglContextLost = true;
            this.uiManager?.showNotification?.('The 3D preview paused because the graphics context was lost.');
        });
        this.renderer.domElement.addEventListener('webglcontextrestored', () => {
            this.webglContextLost = false;
            this.cabinet?.build();
            this.requestRender();
            this.uiManager?.showNotification?.('The 3D preview has been restored.');
        });

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 + 0.05;
        this.controls.minDistance = 320;
        this.controls.maxDistance = 6500;
        this.controls.target.set(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z);
        this.controls.addEventListener('start', () => {
            this.controlsInteracting = true;
        });
        this.controls.addEventListener('change', () => {
            // OrbitControls can continue emitting `change` events while damping
            // settles from an earlier orbit.  Do not let that background camera
            // motion turn an otherwise stationary press into a drag.
            if (this.controlsInteracting && this.pointerGesture?.moved) {
                this.pointerGesture.cameraMoved = true;
            }
            this.requestRender();
        });
        this.controls.addEventListener('end', () => {
            this.controlsInteracting = false;
            this.requestRender();
        });

        this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
        this.scene.add(this.ambientLight);

        this.gridHelper = new THREE.GridHelper(3200, 64, 0xc9c9c1, 0xe7e7e1);
        this.gridHelper.position.y = 0;
        this.scene.add(this.gridHelper);
    }

    initEntities() {
        this.cabinet = new Cabinet(this.scene, this.params);
        this.dummy = new ScaleDummy(this.scene, 1750, this.params.depth);
        this.cabinet.onChange = () => {
            this.applySceneVisibility();
            this.requestRender();
        };
        this.dummy.onChange = () => this.requestRender();
    }

    initRaycaster() {
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        const updateMouseFromPoint = (clientX, clientY) => {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
            this.mouse.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);
        };

        this.renderer.domElement.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            this.pointerGesture = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                startedAt: performance.now(),
                moved: false,
                cameraMoved: false
            };
        });

        this.renderer.domElement.addEventListener('pointermove', event => {
            if (this.pointerGesture?.pointerId === event.pointerId) {
                const dx = event.clientX - this.pointerGesture.x;
                const dy = event.clientY - this.pointerGesture.y;
                if (dx * dx + dy * dy > 36) this.pointerGesture.moved = true;
            }
            this.pendingHoverPoint = { x: event.clientX, y: event.clientY };
            if (this.hoverFrameHandle !== null) return;
            this.hoverFrameHandle = requestAnimationFrame(() => {
                this.hoverFrameHandle = null;
                if (!this.pendingHoverPoint || document.hidden || this.webglContextLost) return;
                updateMouseFromPoint(this.pendingHoverPoint.x, this.pendingHoverPoint.y);
                const selectablePanels = this.cabinet.panelMeshes.filter(mesh => mesh.visible !== false);
                const intersects = this.raycaster.intersectObjects(selectablePanels, false);
                this.renderer.domElement.style.cursor = intersects.length > 0 ? 'crosshair' : 'default';
            });
        });

        this.renderer.domElement.addEventListener('pointerleave', () => {
            this.pendingHoverPoint = null;
            this.renderer.domElement.style.cursor = 'default';
        });

        this.renderer.domElement.addEventListener('click', (e) => {
            const gesture = this.pointerGesture;
            this.pointerGesture = null;
            if (gesture && (
                gesture.moved
                || gesture.cameraMoved
                || performance.now() - gesture.startedAt > 700
            )) return;
            updateMouseFromPoint(e.clientX, e.clientY);
            const selectablePanels = this.cabinet.panelMeshes.filter(mesh => mesh.visible !== false);
            const intersects = this.raycaster.intersectObjects(selectablePanels, false);

            if (intersects.length > 0) {
                this.uiManager.selectPanel(intersects[0].object.userData.id);
            } else {
                this.uiManager.selectPanel(null);
            }
        });

        this.renderer.domElement.addEventListener('keydown', event => this.handleViewportKeydown(event));
    }

    initUI() {
        this.uiManager = new UIManager(this);
    }

    setTheme(mode = 'light') {
        const dark = mode === 'dark';
        this.scene.background = new THREE.Color(dark ? 0x171918 : 0xf7f7f4);
        const materials = Array.isArray(this.gridHelper?.material)
            ? this.gridHelper.material
            : [this.gridHelper?.material].filter(Boolean);
        materials.forEach((material, index) => {
            material.color?.setHex(dark
                ? (index === 0 ? 0x4f5550 : 0x2b302c)
                : (index === 0 ? 0xc9c9c1 : 0xe7e7e1));
            material.needsUpdate = true;
        });
        this.requestRender();
    }

    loadProjectFile(file) {
        let handled = false;
        const handleLoaded = data => {
            if (handled) return;
            handled = true;
            this.applyProjectData(data, { file });
        };
        try {
            const result = ProjectIO.loadProject?.(file, handleLoaded, error => this.handleProjectLoadError(error));
            if (result?.then) result.then(handleLoaded).catch(error => this.handleProjectLoadError(error));
        } catch (error) {
            this.handleProjectLoadError(error);
        }
    }

    applyProjectData(data = {}, { file = null, recovered = false } = {}) {
        const loadGeneration = ++this.projectLoadGeneration;
        try {
            const sourceParams = firstNonEmptyRecord(data.params, data.designParameters, data.design?.params, data.design?.parameters);
            const nextParams = normalizeParams(sourceParams);
            const basedOnPreset = data.project?.basedOnPreset ?? data.basedOnPreset;
            if (!nextParams.presetId && PRESETS[basedOnPreset]) nextParams.presetId = basedOnPreset;

            const stagedDecals = {};
            const decalsToLoad = [];
            const decalSource = firstNonEmptyRecord(data.decals, data.design?.decals, data.artwork?.decals, data.artwork);

            Object.entries(decalSource).forEach(([panelId, decalList]) => {
                if (!Array.isArray(decalList)) return;
                decalList.forEach(d => {
                    if (!d?.imageSrc) return;
                    decalsToLoad.push({ panelId, d });
                });
            });

            const finishLoad = () => {
                if (loadGeneration !== this.projectLoadGeneration) return;
                const viewState = data.viewState || data.view || {
                    gridVisible: data.gridVisible,
                    edgesVisible: data.edgesVisible
                };
                const hiddenPanelIds = data.hiddenPanelIds || viewState.hiddenPanelIds || viewState.hiddenParts || [];
                this.params = nextParams;
                this.cabinet.params = cloneParams(nextParams);
                this.cabinet.decals = stagedDecals;
                if (this.dummy) {
                    this.dummy.setCabinetDepth(nextParams.depth);
                }
                this.cabinet.hiddenPanelIds = new Set(Array.isArray(hiddenPanelIds) ? hiddenPanelIds : []);
                this.cabinet.build();
                this.isolatedPanelId = null;
                this.uiManager.syncAllSliders(this.params);
                this.uiManager.syncControlInputs(this.params.controls);
                this.uiManager.updatePanelInventory();
                this.uiManager.selectPanel(null);
                this.restoreMannequinState({
                    ...(data.mannequinState || data.mannequin || viewState.mannequin || {}),
                    ...(typeof data.mannequinVisible === 'boolean' ? { visible: data.mannequinVisible } : {})
                });
                this.restoreViewState(viewState);
                this.uiManager.onProjectLoaded(data, file, recovered);
            };

            if (decalsToLoad.length === 0) {
                finishLoad();
                return;
            }

            let loadedCount = 0;
            let loadFinished = false;
            const completeOne = () => {
                loadedCount++;
                if (!loadFinished && loadedCount >= decalsToLoad.length) {
                    loadFinished = true;
                    finishLoad();
                }
            };
            decalsToLoad.forEach(item => {
                const image = new Image();
                let settled = false;
                const finishArtwork = loaded => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeoutId);
                    if (loaded) {
                        if (!stagedDecals[item.panelId]) stagedDecals[item.panelId] = [];
                        stagedDecals[item.panelId].push({
                            id: item.d.id || `decal_${Date.now()}_${loadedCount}`,
                            imageSrc: item.d.imageSrc,
                            imageElement: image,
                            x: Number(item.d.x) || 0,
                            y: Number(item.d.y) || 0,
                            scale: Number(item.d.scale) || 50,
                            rotation: Number(item.d.rotation) || 0
                        });
                    } else {
                        console.warn(`Artwork for ${item.panelId} could not be loaded and was skipped.`);
                    }
                    completeOne();
                };
                const timeoutId = window.setTimeout(() => finishArtwork(false), 5000);
                image.onload = () => {
                    finishArtwork(true);
                };
                image.onerror = () => finishArtwork(false);
                image.src = item.d.imageSrc;
            });
        } catch (error) {
            if (loadGeneration === this.projectLoadGeneration) {
                this.handleProjectLoadError(error);
            }
        }
    }

    handleProjectLoadError(error) {
        console.error('Project load failed', error);
        this.uiManager?.showNotification(`Open failed: ${error?.message || error}`);
    }

    restoreMannequinState(state = {}) {
        if (!this.dummy) return;
        const presetId = state.presetId || state.preset;
        if (presetId) this.dummy.setPreset(presetId);
        if (Number.isFinite(Number(state.height))) this.dummy.setHeight(Number(state.height));
        if (typeof state.visible === 'boolean') this.dummy.setVisibility(state.visible);
        this.dummy.setCabinetDepth(this.params.depth);
        const toggle = document.getElementById('toggle-dummy');
        if (toggle) toggle.checked = this.dummy.visible;
        const preset = document.getElementById('mannequin-preset');
        if (preset) preset.value = presetId && preset.querySelector(`[value="${presetId}"]`) ? presetId : 'custom';
    }

    restoreViewState(state = {}) {
        if (typeof state.gridVisible === 'boolean') this.gridHelper.visible = state.gridVisible;
        if (typeof state.edgesVisible === 'boolean') this.cabinet.setEdgeVisibility(state.edgesVisible);
        this.screwsVisible = state.screwsVisible !== false;
        const cameraState = state.camera || {};
        const requestedMode = state.cameraMode || cameraState.mode;
        const view = ['front', 'side', 'top', 'perspective'].includes(requestedMode) ? requestedMode : 'perspective';
        this.setCameraView(view);
        this.uiManager?.syncCameraToolbar?.(view);
        const cameraPosition = state.cameraPosition || cameraState.position;
        const cameraTarget = state.cameraTarget || cameraState.target;
        if (Array.isArray(cameraPosition) && cameraPosition.length === 3) {
            this.camera.position.fromArray(cameraPosition);
        }
        if (Array.isArray(cameraTarget) && cameraTarget.length === 3) {
            this.controls.target.fromArray(cameraTarget);
        }
        this.camera.updateProjectionMatrix();
        this.controls.update();
        this.applySceneVisibility();
        this.uiManager?.syncSceneVisibilityControls?.();
        this.requestRender();
    }

    getVisibleCabinetBox(selectedOnly = false) {
        const box = new THREE.Box3();
        const selectedId = this.uiManager?.activePanelId;
        const meshes = selectedOnly && selectedId
            ? [this.cabinet.getPanelById(selectedId)].filter(Boolean)
            : this.cabinet.panelMeshes.filter(mesh => mesh.visible !== false);
        meshes.forEach(mesh => box.expandByObject(mesh));
        if (box.isEmpty()) box.setFromObject(this.cabinet.group);
        return box;
    }

    swapCamera(nextCamera, mode) {
        const target = this.controls?.target?.clone() || new THREE.Vector3();
        this.camera = nextCamera;
        this.cameraMode = mode;
        if (this.controls) {
            this.controls.object = nextCamera;
            this.controls.target.copy(target);
            this.controls.update();
        }
        this.onWindowResize();
        this.requestRender();
    }

    setCameraView(mode = 'perspective') {
        if (mode === 'perspective') {
            if (!this.camera.isPerspectiveCamera) {
                const perspective = new THREE.PerspectiveCamera(40, this.getViewportAspect(), 10, 12000);
                perspective.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z);
                this.swapCamera(perspective, 'perspective');
            }
            this.cameraMode = 'perspective';
            this.fitCabinet();
            return;
        }

        const aspect = this.getViewportAspect();
        const orthographic = new THREE.OrthographicCamera(-1000 * aspect, 1000 * aspect, 1000, -1000, 1, 14000);
        this.swapCamera(orthographic, mode);
        this.fitBox(this.getVisibleCabinetBox(false), mode);
    }

    fitCabinet() {
        this.fitBox(this.getVisibleCabinetBox(false), this.cameraMode);
    }

    frameSelected() {
        if (!this.uiManager?.activePanelId) {
            this.uiManager?.showNotification('Select a component to frame it');
            return;
        }
        this.fitBox(this.getVisibleCabinetBox(true), this.cameraMode);
    }

    fitBox(box, mode = this.cameraMode) {
        if (!box || box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(80, size.length() * 0.5);
        const aspect = this.getViewportAspect();
        this.controls.target.copy(center);

        if (this.camera.isOrthographicCamera) {
            let horizontal = size.z;
            let vertical = size.y;
            let position = new THREE.Vector3(center.x + radius * 4, center.y, center.z);
            let up = new THREE.Vector3(0, 1, 0);
            if (mode === 'side') {
                horizontal = size.x;
                vertical = size.y;
                position = new THREE.Vector3(center.x, center.y, center.z + radius * 4);
            } else if (mode === 'top') {
                horizontal = size.z;
                vertical = size.x;
                position = new THREE.Vector3(center.x, center.y + radius * 4, center.z);
                up = new THREE.Vector3(-1, 0, 0);
            }
            const halfHeight = Math.max(80, vertical * 0.58, horizontal / Math.max(0.25, aspect) * 0.58);
            this.camera.left = -halfHeight * aspect;
            this.camera.right = halfHeight * aspect;
            this.camera.top = halfHeight;
            this.camera.bottom = -halfHeight;
            this.camera.position.copy(position);
            this.camera.up.copy(up);
            this.camera.lookAt(center);
            this.camera.updateProjectionMatrix();
        } else {
            const fovRadians = THREE.MathUtils.degToRad(this.camera.fov);
            const fitHeightDistance = (Math.max(size.y, 100) * 0.5) / Math.tan(fovRadians * 0.5);
            const fitWidthDistance = (Math.max(size.x, size.z, 100) * 0.5) / (Math.tan(fovRadians * 0.5) * Math.max(0.25, aspect));
            const distance = Math.max(fitHeightDistance, fitWidthDistance, radius * 0.9) * 1.25;
            let direction = this.camera.position.clone().sub(center).normalize();
            if (!Number.isFinite(direction.x) || direction.lengthSq() < 0.1) direction = new THREE.Vector3(1, 0.5, 1).normalize();
            this.camera.position.copy(center).add(direction.multiplyScalar(distance));
            this.camera.near = Math.max(1, distance / 100);
            this.camera.far = Math.max(12000, distance * 8);
            this.camera.lookAt(center);
            this.camera.updateProjectionMatrix();
        }
        this.controls.update();
        this.requestRender();
    }

    resetCamera() {
        if (!this.camera.isPerspectiveCamera) {
            const perspective = new THREE.PerspectiveCamera(40, this.getViewportAspect(), 10, 12000);
            this.swapCamera(perspective, 'perspective');
        }
        this.cameraMode = 'perspective';
        this.camera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z);
        this.camera.up.set(0, 1, 0);
        this.controls.target.set(DEFAULT_CAMERA_TARGET.x, DEFAULT_CAMERA_TARGET.y, DEFAULT_CAMERA_TARGET.z);
        this.camera.lookAt(this.controls.target);
        this.camera.updateProjectionMatrix();
        this.controls.update();
        this.requestRender();
    }

    isolatePanel(panelId) {
        if (!panelId || !this.cabinet.getPanelById(panelId)) return;
        this.isolatedPanelId = panelId;
        this.applyIsolation();
    }

    applyIsolation() {
        if (this.isolatedPanelId) {
            this.cabinet.panelMeshes.forEach(mesh => {
                mesh.visible = mesh.userData.id === this.isolatedPanelId;
            });
        }
        this.applySceneVisibility();
        this.requestRender();
    }

    showAllPanels() {
        this.setAllPanelVisibility(true);
    }

    setPanelViewportVisibility(panelId, visible) {
        if (!panelId || !this.cabinet.getPanelById(panelId)) return;
        this.isolatedPanelId = null;
        this.cabinet.setPanelVisibility(panelId, visible !== false);
        this.applySceneVisibility();
        this.requestRender();
    }

    setAllPanelVisibility(visible) {
        this.isolatedPanelId = null;
        const showPanels = visible !== false;
        this.cabinet.hiddenPanelIds = showPanels
            ? new Set()
            : new Set(this.cabinet.panelMeshes.map(mesh => mesh.userData.id).filter(Boolean));
        this.cabinet.panelMeshes.forEach(mesh => {
            mesh.visible = showPanels;
        });
        this.applySceneVisibility();
        this.requestRender();
    }

    setScrewVisibility(visible) {
        this.screwsVisible = visible !== false;
        this.applySceneVisibility();
        this.requestRender();
    }

    applySceneVisibility() {
        const cabinetGroup = this.cabinet?.group;
        if (!cabinetGroup) return;
        cabinetGroup.traverse(object => {
            const hardware = String(object.userData?.hardware || '');
            if (hardware.startsWith('side_screw_')) {
                const sourcePanel = this.cabinet.getPanelById(object.userData?.panelId);
                object.visible = this.screwsVisible
                    && !this.isolatedPanelId
                    && sourcePanel?.visible !== false;
                return;
            }
            if (object.userData?.jointPoint || object.userData?.warning) {
                object.visible = !this.isolatedPanelId;
                return;
            }
            if (String(object.userData?.id || '').endsWith('_screen_reference')) {
                object.visible = !this.isolatedPanelId
                    || String(object.userData.id).startsWith(`${this.isolatedPanelId}_`);
            }
        });
    }

    getSceneVisibilitySummary() {
        const summary = {
            screws: { total: 0, visible: 0 },
            hardware: { total: 0, visible: 0 },
            machining: { total: 0, visible: 0 },
            references: { total: 0, visible: 0 }
        };
        this.cabinet?.group?.traverse(object => {
            const hardware = String(object.userData?.hardware || '');
            if (hardware === 'side_screw_head') {
                summary.screws.total++;
                if (isObjectEffectivelyVisible(object)) summary.screws.visible++;
                return;
            }
            if (hardware && !hardware.startsWith('side_screw_') && object.isMesh) {
                summary.hardware.total++;
                if (isObjectEffectivelyVisible(object)) summary.hardware.visible++;
                return;
            }
            if (object.userData?.cutout && object.isMesh) {
                summary.machining.total++;
                if (isObjectEffectivelyVisible(object)) summary.machining.visible++;
                return;
            }
            if ((object.userData?.jointPoint || object.userData?.warning
                || String(object.userData?.id || '').endsWith('_screen_reference')) && object.isObject) {
                summary.references.total++;
                if (isObjectEffectivelyVisible(object)) summary.references.visible++;
            }
        });
        return summary;
    }

    handleViewportKeydown(event) {
        const orbitKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
        if (orbitKeys.has(event.key)) {
            event.preventDefault();
            const offset = this.camera.position.clone().sub(this.controls.target);
            const spherical = new THREE.Spherical().setFromVector3(offset);
            if (event.key === 'ArrowLeft') spherical.theta -= 0.1;
            if (event.key === 'ArrowRight') spherical.theta += 0.1;
            if (event.key === 'ArrowUp') spherical.phi -= 0.08;
            if (event.key === 'ArrowDown') spherical.phi += 0.08;
            spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.08, Math.PI - 0.08);
            this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
            this.camera.lookAt(this.controls.target);
            this.controls.update();
            this.requestRender();
            return;
        }
        if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            const zoomIn = event.key === 'PageUp';
            if (this.camera.isOrthographicCamera) {
                this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * (zoomIn ? 1.12 : 0.89), 0.1, 10);
                this.camera.updateProjectionMatrix();
            } else {
                const offset = this.camera.position.clone().sub(this.controls.target);
                const scale = zoomIn ? 0.88 : 1.14;
                const distance = THREE.MathUtils.clamp(offset.length() * scale, this.controls.minDistance, this.controls.maxDistance);
                this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
            }
            this.controls.update();
            this.requestRender();
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            this.fitCabinet();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            this.uiManager?.selectPanel?.(null);
        }
    }

    getViewState() {
        const hiddenParts = Array.from(this.cabinet.hiddenPanelIds || []);
        const mannequinProfile = this.dummy?.getCurrentProfile?.() || {};
        const cameraPosition = this.camera.position.toArray();
        const cameraTarget = this.controls.target.toArray();
        return {
            cameraMode: this.cameraMode,
            cameraPosition,
            cameraTarget,
            camera: {
                mode: this.cameraMode,
                position: cameraPosition,
                target: cameraTarget
            },
            gridVisible: this.gridHelper.visible,
            edgesVisible: this.cabinet.showEdges !== false,
            screwsVisible: this.screwsVisible !== false,
            hiddenPanelIds: hiddenParts,
            hiddenParts,
            mannequin: {
                visible: this.dummy?.visible !== false,
                preset: mannequinProfile.presetId || 'adult_average',
                height: Number(mannequinProfile.height) || 1750
            }
        };
    }

    getViewportAspect() {
        return Math.max(0.25, this.container.clientWidth / Math.max(1, this.container.clientHeight));
    }

    requestRender() {
        if (this.renderFrameHandle !== null || document.hidden || this.webglContextLost) return;
        this.renderFrameHandle = requestAnimationFrame(() => {
            this.renderFrameHandle = null;
            if (document.hidden || this.webglContextLost) return;
            const controlsChanged = Boolean(this.controls?.update?.());
            this.renderer.render(this.scene, this.camera);
            if (controlsChanged || this.controlsInteracting) this.requestRender();
        });
    }

    onWindowResize() {
        if (!this.renderer || !this.camera) return;
        const width = Math.max(1, this.container.clientWidth);
        const height = Math.max(1, this.container.clientHeight);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const dimensionsChanged = width !== this.viewportRenderWidth || height !== this.viewportRenderHeight;
        const pixelRatioChanged = pixelRatio !== this.viewportPixelRatio;
        if (!dimensionsChanged && !pixelRatioChanged) return;

        const aspect = Math.max(0.25, width / height);
        if (this.camera.isPerspectiveCamera) {
            this.camera.aspect = aspect;
        } else if (this.camera.isOrthographicCamera) {
            const halfHeight = Math.abs(this.camera.top - this.camera.bottom) / 2 || 1000;
            this.camera.left = -halfHeight * aspect;
            this.camera.right = halfHeight * aspect;
        }
        this.camera.updateProjectionMatrix();
        if (pixelRatioChanged) this.renderer.setPixelRatio(pixelRatio);
        if (dimensionsChanged) this.renderer.setSize(width, height, false);
        this.viewportRenderWidth = width;
        this.viewportRenderHeight = height;
        this.viewportPixelRatio = pixelRatio;
        this.requestRender();
    }
}

function isObjectEffectivelyVisible(object) {
    let current = object;
    while (current) {
        if (current.visible === false) return false;
        current = current.parent;
    }
    return true;
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new ArcadeDesignerApp();
});

function firstNonEmptyRecord(...candidates) {
    return candidates.find(candidate => candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0)
        || candidates.find(candidate => candidate && typeof candidate === 'object')
        || {};
}
