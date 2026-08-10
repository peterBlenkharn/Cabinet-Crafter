import * as THREE from './lib/three.module.js';
import { createMannequinLayout } from './dummy-layout.js';

export const MANNEQUIN_PRESETS = Object.freeze({
    child_12: {
        label: 'Child 12',
        height: 1500,
        shoulderRatio: 0.225,
        torsoDepthRatio: 0.105,
        pelvisRatio: 0.17,
        armRatio: 0.145,
        legRatio: 0.236
    },
    adult_woman_small: {
        label: 'Adult Woman S',
        height: 1580,
        shoulderRatio: 0.225,
        torsoDepthRatio: 0.105,
        pelvisRatio: 0.172,
        armRatio: 0.145,
        legRatio: 0.238
    },
    adult_woman_average: {
        label: 'Adult Woman M',
        height: 1650,
        shoulderRatio: 0.23,
        torsoDepthRatio: 0.108,
        pelvisRatio: 0.174,
        armRatio: 0.146,
        legRatio: 0.24
    },
    adult_average: {
        label: 'Adult Average',
        height: 1750,
        shoulderRatio: 0.24,
        torsoDepthRatio: 0.11,
        pelvisRatio: 0.17,
        armRatio: 0.148,
        legRatio: 0.242
    },
    adult_man_average: {
        label: 'Adult Man M',
        height: 1800,
        shoulderRatio: 0.255,
        torsoDepthRatio: 0.118,
        pelvisRatio: 0.168,
        armRatio: 0.15,
        legRatio: 0.244
    },
    tall_adult: {
        label: 'Tall Adult',
        height: 1930,
        shoulderRatio: 0.255,
        torsoDepthRatio: 0.118,
        pelvisRatio: 0.166,
        armRatio: 0.151,
        legRatio: 0.246
    }
});

export class ScaleDummy {
    constructor(scene, height = 1750, cabinetDepth = 600) {
        this.scene = scene;
        const numericHeight = Number(height);
        const numericDepth = Number(cabinetDepth);
        this.height = Number.isFinite(numericHeight)
            ? Math.max(900, Math.min(2500, numericHeight))
            : 1750;
        this.cabinetDepth = Number.isFinite(numericDepth)
            ? Math.max(200, Math.min(1600, numericDepth))
            : 600;
        this.activePresetId = 'adult_average';
        this.profile = { ...MANNEQUIN_PRESETS.adult_average, height: this.height };

        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.visible = true;
        this.onChange = null;
        this.build();
    }

    setPreset(presetId) {
        const preset = MANNEQUIN_PRESETS[presetId];
        if (!preset) return;
        this.activePresetId = presetId;
        this.profile = { ...preset };
        this.height = preset.height;
        this.build();
    }

    setHeight(newHeight) {
        const numericHeight = Number(newHeight);
        if (!Number.isFinite(numericHeight)) return;
        this.height = Math.max(900, Math.min(2500, numericHeight));
        this.profile = {
            ...this.profile,
            height: this.height
        };
        this.build();
    }

    setCabinetDepth(depth) {
        const numericDepth = Number(depth);
        if (!Number.isFinite(numericDepth)) return;
        this.cabinetDepth = Math.max(200, Math.min(1600, numericDepth));
        this.build();
    }

    setVisibility(visible) {
        this.visible = visible;
        this.group.visible = visible;
        if (visible && this.group.children.length === 0) this.build();
        else this.onChange?.();
    }

    getCurrentProfile() {
        return {
            presetId: this.activePresetId,
            ...this.profile,
            height: this.height
        };
    }

    addSolidWirePart(geometry, material, position, rotation = null, edgeOpacity = 0.5, name = '') {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        mesh.userData.isScaleDummy = true;
        mesh.position.set(position.x, position.y, position.z);
        if (rotation) mesh.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry, 8),
            new THREE.LineBasicMaterial({ color: 0x333330, transparent: true, opacity: edgeOpacity })
        );
        mesh.add(edges);
        this.group.add(mesh);
        return mesh;
    }

    addLimbBetween(name, start, end, startRadius, endRadius, material) {
        const startPoint = new THREE.Vector3(start.x, start.y, start.z);
        const endPoint = new THREE.Vector3(end.x, end.y, end.z);
        const direction = endPoint.clone().sub(startPoint);
        const length = direction.length();
        const mesh = this.addSolidWirePart(
            new THREE.CylinderGeometry(endRadius, startRadius, length, 12),
            material,
            startPoint.clone().add(endPoint).multiplyScalar(0.5),
            null,
            0.48,
            name
        );
        mesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.normalize()
        );
        return mesh;
    }

    build() {
        while (this.group.children.length > 0) {
            const child = this.group.children[0];
            this.group.remove(child);
            disposeThreeObject(child);
        }

        if (!this.visible) {
            this.onChange?.();
            return;
        }

        const layout = createMannequinLayout(this.height, this.profile);
        const H = layout.height;
        const D = layout.dimensions;
        const solidMat = new THREE.MeshBasicMaterial({
            color: 0xf2f2ee,
            side: THREE.DoubleSide
        });
        const jointMat = new THREE.MeshBasicMaterial({
            color: 0xd7d7cf,
            side: THREE.DoubleSide
        });

        this.addSolidWirePart(
            new THREE.SphereGeometry(D.headRadius, 24, 18),
            solidMat,
            layout.head.center,
            null,
            0.42,
            'mannequin_head'
        );

        this.addSolidWirePart(
            new THREE.CylinderGeometry(H * 0.022, H * 0.026, D.neckHeight, 12),
            solidMat,
            layout.neck.center,
            null,
            0.48,
            'mannequin_neck'
        );

        this.addSolidWirePart(
            createTaperedPrismGeometry(
                layout.torso.topWidth,
                layout.torso.bottomWidth,
                layout.torso.height,
                layout.torso.topDepth,
                layout.torso.bottomDepth
            ),
            solidMat,
            { x: 0, y: layout.torso.centerY, z: 0 },
            null,
            0.48,
            'mannequin_torso'
        );

        this.addSolidWirePart(
            createTaperedPrismGeometry(
                layout.pelvis.topWidth,
                layout.pelvis.bottomWidth,
                layout.pelvis.height,
                layout.pelvis.topDepth,
                layout.pelvis.bottomDepth
            ),
            solidMat,
            { x: 0, y: layout.pelvis.centerY, z: 0 },
            null,
            0.48,
            'mannequin_pelvis'
        );

        Object.entries(layout.arms).forEach(([side, arm]) => {
            this.addSolidWirePart(
                new THREE.SphereGeometry(D.jointRadius, 12, 10),
                jointMat,
                arm.shoulder,
                null,
                0.48,
                `mannequin_${side}_shoulder`
            );
            this.addLimbBetween(
                `mannequin_${side}_upper_arm`,
                arm.shoulder,
                arm.elbow,
                H * 0.0155,
                H * 0.013,
                solidMat
            );
            this.addSolidWirePart(
                new THREE.SphereGeometry(H * 0.015, 12, 10),
                jointMat,
                arm.elbow,
                null,
                0.48,
                `mannequin_${side}_elbow`
            );
            this.addLimbBetween(
                `mannequin_${side}_forearm`,
                arm.elbow,
                arm.hand,
                H * 0.013,
                H * 0.01,
                solidMat
            );
            this.addSolidWirePart(
                new THREE.SphereGeometry(H * 0.014, 12, 10),
                jointMat,
                arm.hand,
                null,
                0.48,
                `mannequin_${side}_hand`
            );
        });

        Object.entries(layout.legs).forEach(([side, leg]) => {
            this.addSolidWirePart(
                new THREE.SphereGeometry(D.jointRadius, 12, 10),
                jointMat,
                leg.hip,
                null,
                0.48,
                `mannequin_${side}_hip`
            );
            this.addLimbBetween(
                `mannequin_${side}_thigh`,
                leg.hip,
                leg.knee,
                H * 0.023,
                H * 0.0185,
                solidMat
            );
            this.addSolidWirePart(
                new THREE.SphereGeometry(H * 0.017, 12, 10),
                jointMat,
                leg.knee,
                null,
                0.48,
                `mannequin_${side}_knee`
            );
            this.addLimbBetween(
                `mannequin_${side}_calf`,
                leg.knee,
                leg.ankle,
                H * 0.0185,
                H * 0.014,
                solidMat
            );
            this.addSolidWirePart(
                new THREE.SphereGeometry(H * 0.014, 12, 10),
                jointMat,
                leg.ankle,
                null,
                0.48,
                `mannequin_${side}_ankle`
            );
            this.addSolidWirePart(
                new THREE.BoxGeometry(D.footWidth, D.footHeight, D.footLength),
                solidMat,
                {
                    x: leg.ankle.x,
                    y: D.footHeight / 2,
                    z: -(D.footLength / 2 - H * 0.014)
                },
                null,
                0.48,
                `mannequin_${side}_foot`
            );
        });

        const eyeY = H - H * 0.065;
        const sightGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, eyeY, -H * 0.006),
            new THREE.Vector3(0, eyeY - H * 0.14, -H * 0.34)
        ]);
        const sightLine = new THREE.Line(
            sightGeom,
            new THREE.LineDashedMaterial({ color: 0x4d4d49, dashSize: 20, gapSize: 10, linewidth: 1 })
        );
        sightLine.computeLineDistances();
        sightLine.name = 'mannequin_sight_line';
        sightLine.userData.isScaleDummy = true;
        this.group.add(sightLine);

        const eyeHelper = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(-H * 0.17, eyeY, 0),
                new THREE.Vector3(H * 0.17, eyeY, 0)
            ]),
            new THREE.LineBasicMaterial({ color: 0x4d4d49, transparent: true, opacity: 0.35 })
        );
        eyeHelper.name = 'mannequin_eye_level';
        eyeHelper.userData.isScaleDummy = true;
        this.group.add(eyeHelper);

        const dummyX = this.cabinetDepth / 2 + 280;
        this.group.position.set(dummyX, 0, 0);
        this.group.rotation.y = Math.PI / 2;
        this.group.name = 'scale_mannequin';
        this.group.userData.isScaleDummy = true;
        this.onChange?.();
    }
}

function createTaperedPrismGeometry(topWidth, bottomWidth, height, topDepth, bottomDepth) {
    const topY = height / 2;
    const bottomY = -height / 2;
    const positions = new Float32Array([
        -bottomWidth / 2, bottomY, -bottomDepth / 2,
        bottomWidth / 2, bottomY, -bottomDepth / 2,
        bottomWidth / 2, bottomY, bottomDepth / 2,
        -bottomWidth / 2, bottomY, bottomDepth / 2,
        -topWidth / 2, topY, -topDepth / 2,
        topWidth / 2, topY, -topDepth / 2,
        topWidth / 2, topY, topDepth / 2,
        -topWidth / 2, topY, topDepth / 2
    ]);
    const indices = [
        0, 2, 1, 0, 3, 2,
        4, 5, 6, 4, 6, 7,
        0, 1, 5, 0, 5, 4,
        1, 2, 6, 1, 6, 5,
        2, 3, 7, 2, 7, 6,
        3, 0, 4, 3, 4, 7
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function disposeThreeObject(root) {
    root.traverse?.(object => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        materials.forEach(material => {
            Object.values(material).forEach(value => {
                if (value?.isTexture) value.dispose?.();
            });
            material.dispose?.();
        });
    });
}
