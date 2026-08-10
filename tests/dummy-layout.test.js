import test from 'node:test';
import assert from 'node:assert/strict';
import { createMannequinLayout } from '../wwwroot/js/dummy-layout.js';
import * as THREE from '../wwwroot/js/lib/three.module.js';
import { MANNEQUIN_PRESETS, ScaleDummy } from '../wwwroot/js/dummy.js';

const PRESET_PROFILES = [
    { height: 1500, shoulderRatio: 0.225, torsoDepthRatio: 0.105, pelvisRatio: 0.17, armRatio: 0.145, legRatio: 0.236 },
    { height: 1580, shoulderRatio: 0.225, torsoDepthRatio: 0.105, pelvisRatio: 0.172, armRatio: 0.145, legRatio: 0.238 },
    { height: 1650, shoulderRatio: 0.23, torsoDepthRatio: 0.108, pelvisRatio: 0.174, armRatio: 0.146, legRatio: 0.24 },
    { height: 1750, shoulderRatio: 0.24, torsoDepthRatio: 0.11, pelvisRatio: 0.17, armRatio: 0.148, legRatio: 0.242 },
    { height: 1800, shoulderRatio: 0.255, torsoDepthRatio: 0.118, pelvisRatio: 0.168, armRatio: 0.15, legRatio: 0.244 },
    { height: 1930, shoulderRatio: 0.255, torsoDepthRatio: 0.118, pelvisRatio: 0.166, armRatio: 0.151, legRatio: 0.246 }
];

function closeTo(actual, expected, tolerance = 0.000001) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${actual} should be within ${tolerance} of ${expected}`
    );
}

test('all bundled mannequin profiles form a continuous body from floor to stated height', () => {
    PRESET_PROFILES.forEach(profile => {
        const layout = createMannequinLayout(profile.height, profile);
        closeTo(layout.height, profile.height);
        closeTo(layout.head.center.y + layout.dimensions.headRadius, profile.height);
        closeTo(layout.torso.bottomY, layout.pelvis.topY);
        closeTo(layout.neck.bottomY, layout.torso.topY);
        assert.ok(layout.legs.left.ankle.y < layout.legs.left.knee.y);
        assert.ok(layout.legs.left.knee.y < layout.legs.left.hip.y);
        assert.ok(layout.legs.left.hip.y < layout.pelvis.topY);
        assert.ok(layout.dimensions.footHeight > layout.legs.left.ankle.y);
    });
});

test('arm and leg segments preserve their configured lengths at every preset size', () => {
    PRESET_PROFILES.forEach(profile => {
        const layout = createMannequinLayout(profile.height, profile);
        const expectedArm = profile.height * profile.armRatio;
        const expectedLeg = profile.height * profile.legRatio;
        closeTo(layout.invariants.leftUpperArmLength, expectedArm);
        closeTo(layout.invariants.leftForearmLength, expectedArm);
        closeTo(layout.invariants.rightUpperArmLength, expectedArm);
        closeTo(layout.invariants.rightForearmLength, expectedArm);
        closeTo(layout.invariants.leftThighLength, expectedLeg);
        closeTo(layout.invariants.leftCalfLength, expectedLeg);
    });
});

test('custom heights scale a stable forward-facing pose without disconnected joints', () => {
    const small = createMannequinLayout(1350);
    const tall = createMannequinLayout(2050);

    for (const layout of [small, tall]) {
        assert.ok(layout.arms.left.elbow.z < layout.arms.left.shoulder.z);
        assert.ok(layout.arms.left.hand.z < layout.arms.left.elbow.z);
        closeTo(layout.arms.left.elbow.x, -layout.arms.right.elbow.x);
        closeTo(layout.arms.left.hand.x, -layout.arms.right.hand.x);
        closeTo(layout.legs.left.hip.x, -layout.legs.right.hip.x);
        closeTo(layout.legs.left.knee.y, layout.legs.right.knee.y);
    }

    closeTo(
        tall.dimensions.shoulderWidth / small.dimensions.shoulderWidth,
        tall.height / small.height
    );
});

test('rendered limbs terminate at the shared skeleton joints', () => {
    const scene = new THREE.Scene();
    const dummy = new ScaleDummy(scene, 1750, 600);
    const layout = createMannequinLayout(1750, MANNEQUIN_PRESETS.adult_average);

    const closePoint = (actual, expected) => {
        closeTo(actual.x, expected.x, 0.0001);
        closeTo(actual.y, expected.y, 0.0001);
        closeTo(actual.z, expected.z, 0.0001);
    };
    const endpoints = mesh => {
        const halfLength = mesh.geometry.parameters.height / 2;
        const axis = new THREE.Vector3(0, halfLength, 0).applyQuaternion(mesh.quaternion);
        return [
            mesh.position.clone().sub(axis),
            mesh.position.clone().add(axis)
        ];
    };

    const leftUpperArm = dummy.group.getObjectByName('mannequin_left_upper_arm');
    const leftForearm = dummy.group.getObjectByName('mannequin_left_forearm');
    const [upperStart, upperEnd] = endpoints(leftUpperArm);
    const [forearmStart, forearmEnd] = endpoints(leftForearm);
    closePoint(upperStart, layout.arms.left.shoulder);
    closePoint(upperEnd, layout.arms.left.elbow);
    closePoint(forearmStart, layout.arms.left.elbow);
    closePoint(forearmEnd, layout.arms.left.hand);

    const leftThigh = dummy.group.getObjectByName('mannequin_left_thigh');
    const leftCalf = dummy.group.getObjectByName('mannequin_left_calf');
    const [thighStart, thighEnd] = endpoints(leftThigh);
    const [calfStart, calfEnd] = endpoints(leftCalf);
    closePoint(thighStart, layout.legs.left.hip);
    closePoint(thighEnd, layout.legs.left.knee);
    closePoint(calfStart, layout.legs.left.knee);
    closePoint(calfEnd, layout.legs.left.ankle);
});

test('repeated preset, height, depth and visibility updates replace rather than accumulate geometry', () => {
    const scene = new THREE.Scene();
    const dummy = new ScaleDummy(scene, 1750, 600);
    const expectedPartCount = dummy.group.children.length;
    assert.ok(expectedPartCount > 20);

    const assertFiniteGeometry = () => {
        assert.equal(dummy.group.children.length, expectedPartCount);
        dummy.group.traverse(object => {
            for (const value of [
                object.position.x, object.position.y, object.position.z,
                object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w,
                object.scale.x, object.scale.y, object.scale.z
            ]) {
                assert.ok(Number.isFinite(value));
            }
            const positions = object.geometry?.getAttribute?.('position')?.array || [];
            for (const value of positions) assert.ok(Number.isFinite(value));
        });
    };

    for (const [presetId, preset] of Object.entries(MANNEQUIN_PRESETS)) {
        dummy.setPreset(presetId);
        assertFiniteGeometry();
        closeTo(
            dummy.group.getObjectByName('mannequin_head').geometry.parameters.radius,
            preset.height * 0.052
        );
    }

    for (const height of [1350, 1750, 2050, 1750]) {
        dummy.setHeight(height);
        dummy.setHeight(height);
        assertFiniteGeometry();
        closeTo(
            dummy.group.getObjectByName('mannequin_head').geometry.parameters.radius,
            height * 0.052
        );
    }

    for (const depth of [400, 600, 900, 600]) {
        dummy.setCabinetDepth(depth);
        assertFiniteGeometry();
        closeTo(dummy.group.position.x, depth / 2 + 280);
    }

    dummy.setVisibility(false);
    assert.equal(dummy.group.visible, false);
    assert.equal(dummy.group.children.length, expectedPartCount);
    dummy.setHeight(1800);
    assert.equal(dummy.group.children.length, 0);
    dummy.setVisibility(true);
    assert.equal(dummy.group.visible, true);
    assertFiniteGeometry();
});

test('invalid external values are constrained to safe mannequin geometry', () => {
    const layout = createMannequinLayout(Number.NaN, {
        shoulderRatio: 99,
        torsoDepthRatio: -2,
        pelvisRatio: Infinity,
        armRatio: 0,
        legRatio: 9
    });
    assert.equal(layout.height, 1750);
    assert.ok(layout.torso.height > 0);
    assert.ok(layout.dimensions.shoulderWidth < layout.height * 0.3);
    assert.ok(layout.dimensions.torsoDepth > layout.height * 0.08);
    assert.ok(layout.dimensions.armLength > layout.height * 0.12);
    assert.ok(layout.dimensions.thighLength < layout.height * 0.27);
});
