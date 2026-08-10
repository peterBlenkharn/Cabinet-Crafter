import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../wwwroot/js/lib/three.module.js';
import { Cabinet, PRESETS, cloneParams } from '../wwwroot/js/cabinet.js';
import { applyJoineryStrategies } from '../wwwroot/js/joinery.js';
import { createNestingPlan } from '../wwwroot/js/nesting.js';

function withDocument(run) {
    const previousDocument = globalThis.document;
    const noop = () => {};
    const context = new Proxy({}, {
        get: (target, property) => target[property] ?? noop,
        set: (target, property, value) => {
            target[property] = value;
            return true;
        }
    });
    globalThis.document = {
        createElement: () => ({ width: 0, height: 0, getContext: () => context })
    };
    try {
        return run();
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
}

function closeTo(actual, expected, tolerance = 0.01, message = '') {
    assert.ok(Math.abs(actual - expected) <= tolerance, message || `${actual} should equal ${expected}`);
}

function horizontalSpan(profile, y) {
    const xs = [];
    profile.forEach((start, index) => {
        const end = profile[(index + 1) % profile.length];
        if (Math.abs(end.y - start.y) < 0.0001) {
            if (Math.abs(y - start.y) < 0.0001) xs.push(start.x, end.x);
            return;
        }
        if (y < Math.min(start.y, end.y) - 0.0001 || y > Math.max(start.y, end.y) + 0.0001) return;
        const ratio = (y - start.y) / (end.y - start.y);
        xs.push(start.x + (end.x - start.x) * ratio);
    });
    return { minX: Math.min(...xs), maxX: Math.max(...xs) };
}

function pointLineDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    return Math.abs(dx * (start.y - point.y) - (start.x - point.x) * dy) / length;
}

function convexPolygonContains(container, candidate, tolerance = 0.01) {
    return container.every((start, index) => {
        const end = container[(index + 1) % container.length];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy) || 1;
        const axis = { x: -dy / length, y: dx / length };
        const bounds = container.map(point => point.x * axis.x + point.y * axis.y);
        const minimum = Math.min(...bounds) - tolerance;
        const maximum = Math.max(...bounds) + tolerance;
        return candidate.every(point => {
            const projection = point.x * axis.x + point.y * axis.y;
            return projection >= minimum && projection <= maximum;
        });
    });
}

function profileContainsPoint(profile, point, tolerance = 0.01) {
    for (let index = 0; index < profile.length; index++) {
        const start = profile[index];
        const end = profile[(index + 1) % profile.length];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const lengthSquared = dx * dx + dy * dy;
        const along = lengthSquared > 0
            ? ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
            : 0;
        const nearest = {
            x: start.x + dx * Math.max(0, Math.min(1, along)),
            y: start.y + dy * Math.max(0, Math.min(1, along))
        };
        if (Math.hypot(point.x - nearest.x, point.y - nearest.y) <= tolerance) return true;
    }

    let inside = false;
    for (let index = 0, previous = profile.length - 1; index < profile.length; previous = index++) {
        const current = profile[index];
        const prior = profile[previous];
        const crosses = (current.y > point.y) !== (prior.y > point.y)
            && point.x < (prior.x - current.x) * (point.y - current.y) / (prior.y - current.y) + current.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

function rectangularProfileCurve(minimum = -0.05, maximum = 1.05) {
    const points = [
        { x: minimum, y: minimum },
        { x: maximum, y: minimum },
        { x: maximum, y: maximum },
        { x: minimum, y: maximum }
    ];
    return {
        version: 1,
        closed: true,
        nodes: points.map((point, index) => ({
            id: `decorative-${index + 1}`,
            ...point,
            in: { ...point },
            out: { ...point },
            mode: 'corner'
        }))
    };
}

test('panel visibility updates existing scene objects without rebuilding geometry', () => withDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    const panel = cabinet.getPanelById('panel_cp_support');
    let changes = 0;
    cabinet.onChange = () => { changes += 1; };
    cabinet.build = () => { throw new Error('visibility must not rebuild geometry'); };

    cabinet.setPanelVisibility(panel.userData.id, false);
    assert.equal(panel.visible, false);
    assert.equal(cabinet.isPanelVisible(panel.userData.id), false);
    assert.equal(changes, 1);

    cabinet.setPanelVisibility(panel.userData.id, false);
    assert.equal(changes, 1, 'repeating the same visibility state should be a no-op');

    cabinet.setPanelVisibility(panel.userData.id, true);
    assert.equal(panel.visible, true);
    assert.equal(cabinet.isPanelVisible(panel.userData.id), true);
    assert.equal(changes, 2);
}));

test('decorative outer profiles change only side-wall geometry and fabrication contours', () => withDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    const baselineRib = cabinet.getPanelById('panel_control_riser').userData.profilePoints.map(point => ({ ...point }));
    const baselineSide = cabinet.getPanelById('side_left').userData;
    const baselineWidth = baselineSide.widthMm;
    const baselineHeight = baselineSide.lengthMm;

    cabinet.updateParams({
        sideProfileCustomization: {
            enabled: true,
            linked: true,
            shared: rectangularProfileCurve()
        }
    });

    const left = cabinet.getPanelById('side_left').userData;
    const right = cabinet.getPanelById('side_right').userData;
    const rib = cabinet.getPanelById('panel_control_riser').userData;
    assert.equal(left.profileCustomization.applied, true);
    assert.equal(right.profileCustomization.applied, true);
    assert.equal(left.profileCustomization.source, 'shared');
    assert.ok(left.widthMm > baselineWidth);
    assert.ok(left.lengthMm > baselineHeight);
    assert.deepEqual(left.profilePoints, right.profilePoints);
    assert.notDeepEqual(left.profilePoints, left.structuralProfilePoints);
    assert.deepEqual(rib.profilePoints, baselineRib, 'internal structural ribs must keep the nominal profile');

    const manifest = cabinet.getFabricationManifest();
    const leftPart = manifest.parts.find(part => part.id === 'side_left');
    const leftContour = manifest.contours.find(contour => contour.partId === 'side_left' && contour.role === 'outer');
    assert.equal(leftPart.metadata.profileCustomization.applied, true);
    assert.ok(Math.max(...leftContour.points.map(point => point.xMm)) > baselineWidth);
    assert.equal(cabinet.getPreflightResults().some(finding => finding.code.startsWith('SIDE_PROFILE_')), false);
}));

test('invalid saved decorative profiles fall back visibly and block production export', () => withDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    cabinet.updateParams({
        sideProfileCustomization: {
            enabled: true,
            linked: true,
            shared: rectangularProfileCurve(0.1, 0.9)
        }
    });

    const left = cabinet.getPanelById('side_left').userData;
    assert.equal(left.profileCustomization.applied, false);
    assert.equal(left.profileCustomization.reason, 'invalid');
    assert.deepEqual(left.profilePoints, left.structuralProfilePoints);
    const findings = cabinet.getPreflightResults().filter(finding => finding.code === 'SIDE_PROFILE_INVALID');
    assert.equal(findings.length, 2);
    assert.ok(findings.every(finding => finding.severity === 'error'));
}));

test('internal sheets have finite, flush mating profiles and a full control-bay load path', () => withDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    const ids = new Set(cabinet.panelMeshes.map(mesh => mesh.userData.id));
    assert.ok(ids.has('panel_cp_support'));
    assert.ok(ids.has('panel_control_riser'));
    assert.ok(ids.has('panel_display_support'));
    assert.ok(ids.has('panel_header_support'));
    assert.ok(ids.has('panel_machine_shelf'));

    const transverseSupports = ['panel_cp_support', 'panel_display_support', 'panel_header_support', 'panel_machine_shelf']
        .map(id => cabinet.getPanelById(id).userData);
    const clearSpan = cabinet.params.width
        - cabinet.getEffectiveThickness('side_left')
        - cabinet.getEffectiveThickness('side_right');
    transverseSupports.forEach(part => {
        assert.equal(part.widthMm, clearSpan);
        assert.equal(part.isStructural, true);
        assert.deepEqual(part.matingPanelIds.includes('side_left'), true);
        assert.deepEqual(part.matingPanelIds.includes('side_right'), true);
        assert.ok(part.cutouts.some(cutout => cutout.kind === 'cable_port'));
    });

    const profile = cabinet.getProfilePointList();
    ['panel_cp_support', 'panel_display_support', 'panel_header_support', 'panel_machine_shelf'].forEach(id => {
        const support = cabinet.getPanelById(id).userData;
        const innerSpan = horizontalSpan(profile, support.p1.y);
        closeTo(support.p1.x, innerSpan.minX);
        closeTo(support.p2.x, innerSpan.maxX);

        const outerY = support.crossSection.find(point => Math.abs(point.y - support.p1.y) > 0.01).y;
        const outerSpan = horizontalSpan(profile, outerY);
        const outerPoints = support.crossSection.filter(point => Math.abs(point.y - outerY) < 0.01);
        closeTo(Math.min(...outerPoints.map(point => point.x)), outerSpan.minX);
        closeTo(Math.max(...outerPoints.map(point => point.x)), outerSpan.maxX);
    });

    const points = cabinet.getProfilePoints();
    const controlSupport = cabinet.getPanelById('panel_cp_support').userData;
    closeTo(controlSupport.p1.y, points.cp_apron.y);
    closeTo(controlSupport.p2.y, points.cp_apron.y);
    const controlTop = controlSupport.crossSection.filter(point => Math.abs(point.y - points.cp_apron.y) < 0.01);
    assert.equal(controlTop.length, 2);
    closeTo(Math.min(...controlTop.map(point => point.x)), points.back_bottom.x);
    closeTo(Math.max(...controlTop.map(point => point.x)), points.cp_apron.x);

    const displaySupport = cabinet.getPanelById('panel_display_support').userData;
    closeTo(displaySupport.p1.x, points.back_bottom.x);
    closeTo(displaySupport.p1.y, points.cp_back.y);
    closeTo(displaySupport.p2.x, points.cp_back.x);
    closeTo(displaySupport.p2.y, points.cp_back.y);
    const displayFrontEdge = displaySupport.crossSection.filter(point => point.x > points.cp_back.x - 40);
    assert.equal(displayFrontEdge.length, 2);
    displayFrontEdge.forEach(point => {
        closeTo(pointLineDistance(point, points.bezel_top, points.cp_back), 0, 0.01, 'display support end must lie on the display panel line');
    });

    const headerSupport = cabinet.getPanelById('panel_header_support').userData;
    closeTo(headerSupport.p1.y, points.bezel_top.y);
    closeTo(headerSupport.p2.y, points.bezel_top.y);
    const headerFrontEdge = headerSupport.crossSection.filter(point => point.x > points.bezel_top.x - 40);
    assert.equal(headerFrontEdge.length, 2);
    headerFrontEdge.forEach(point => {
        closeTo(pointLineDistance(point, points.bezel_top, points.marquee_bottom), 0, 0.01, 'header support end must lie on the recess panel line');
    });

    const riser = cabinet.getPanelById('panel_control_riser').userData;
    const sideWall = cabinet.getPanelById('side_left').userData;
    assert.equal(riser.exportType, 'profile');
    assert.notEqual(riser.widthMm, clearSpan);
    assert.equal(riser.metadata.fullHeightProfile, true);
    assert.equal(riser.metadata.joineryDirection, 'horizontal-panels-into-profile-support');
    assert.equal(riser.profilePoints.length, profile.length);
    assert.ok(riser.areaMm2 > 0);
    assert.ok(riser.matingPanelIds.includes('panel_cp'));
    assert.ok(riser.matingPanelIds.includes('panel_cp_support'));
    assert.ok(riser.matingPanelIds.includes('panel_display_support'));
    assert.ok(riser.matingPanelIds.includes('panel_apron'));
    assert.ok(!riser.matingPanelIds.includes('side_left'));
    assert.ok(!riser.matingPanelIds.includes('side_right'));
    assert.ok(riser.cutouts.some(cutout => cutout.id === 'control-riser-cable-port'));

    const nominalProfile = cabinet.getProfilePointList();
    const sideProfile = sideWall.profilePoints;
    const sideBounds = {
        minX: Math.min(...sideProfile.map(point => point.x)),
        maxX: Math.max(...sideProfile.map(point => point.x)),
        minY: Math.min(...sideProfile.map(point => point.y)),
        maxY: Math.max(...sideProfile.map(point => point.y))
    };
    assert.ok(sideBounds.minX < Math.min(...nominalProfile.map(point => point.x)));
    assert.ok(sideBounds.maxX > Math.max(...nominalProfile.map(point => point.x)));
    assert.ok(sideBounds.maxY > Math.max(...nominalProfile.map(point => point.y)));
    const nominalBounds = {
        minX: Math.min(...nominalProfile.map(point => point.x)),
        maxX: Math.max(...nominalProfile.map(point => point.x)),
        minY: Math.min(...nominalProfile.map(point => point.y)),
        maxY: Math.max(...nominalProfile.map(point => point.y))
    };
    closeTo(riser.localBounds.minX, 0);
    closeTo(riser.localBounds.minY, 0);
    closeTo(riser.localBounds.maxX, nominalBounds.maxX - nominalBounds.minX);
    closeTo(riser.localBounds.maxY, nominalBounds.maxY - nominalBounds.minY);
    riser.crossSection.forEach((point, index) => {
        closeTo(point.x, nominalProfile[index].x);
        closeTo(point.y, nominalProfile[index].y);
    });
    assert.ok(
        riser.crossSection.every(point => profileContainsPoint(sideProfile, point)),
        'the internal profile support must remain wholly within the expanded side-wall envelope'
    );
    assert.ok(riser.crossSection.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.equal(riser.metadata.supportCount, 1);
    closeTo(riser.metadata.lateralPositionMm, 0);
    assert.deepEqual(riser.dadoTongues, [], 'the profile support must not protrude into horizontal panels');
    assert.deepEqual(
        new Set(riser.joinerySlots.map(slot => slot.matingPartId)),
        new Set([
            'panel_bottom',
            'panel_cp_support',
            'panel_display_support',
            'panel_header_support',
            'panel_machine_shelf'
        ])
    );

    const sideFasteners = cabinet.getPanelById('side_left').userData.fasteners;
    assert.ok(!sideFasteners.some(fastener => fastener.targetPanelId === 'panel_control_riser'));
    assert.ok(
        sideFasteners.every(fastener => profileContainsPoint(sideProfile, fastener)),
        'the assembled outer profile must cover every side-entry screw centre'
    );
    assert.ok(
        sideFasteners.some(fastener => fastener.x > Math.max(...nominalProfile.map(point => point.x))),
        'the regression must include screws that previously floated beyond the nominal profile'
    );

    const manifest = cabinet.getFabricationManifest();
    const exportedSideProfile = manifest.contours.find(contour =>
        contour.partId === 'side_left' && contour.role === 'outer'
    ).points;
    closeTo(
        Math.max(...exportedSideProfile.map(point => point.xMm)),
        sideBounds.maxX - sideBounds.minX
    );
    const riserOperations = manifest.operations.filter(operation => operation.partId === 'panel_control_riser');
    assert.ok(riserOperations.some(operation => operation.type === 'profileCut'));
    assert.ok(riserOperations.some(operation => operation.type === 'throughCut'));
    const supportJoints = manifest.joints.filter(joint => joint.partIds.includes('panel_control_riser') && joint.type === 'dado seam');
    assert.equal(supportJoints.length, riser.joinerySlots.length);
    assert.deepEqual(new Set(supportJoints.map(joint => joint.hostPartId)), new Set(['panel_control_riser']));
    assert.ok(supportJoints.every(joint => joint.edgeGeometry?.coordinateSpace === 'panel-local'));
    const mandatoryPockets = manifest.operations.filter(operation => supportJoints.some(joint => operation.id === `${joint.id}:dado:pocket`));
    assert.equal(mandatoryPockets.length, riser.joinerySlots.length);
    assert.ok(mandatoryPockets.every(operation => operation.type === 'throughCut' && operation.mandatory === true));
    assert.ok(mandatoryPockets.every(operation => operation.purpose === 'structural-cross-lap-rib-slot'));
    assert.deepEqual(new Set(mandatoryPockets.map(operation => operation.partId)), new Set(['panel_control_riser']));
    assert.deepEqual(new Set(mandatoryPockets.map(operation => operation.machiningFace)), new Set(['left']));
    const matingSlots = manifest.operations.filter(operation => supportJoints.some(joint => (
        operation.id === joint.matingMachiningOperationId
    )));
    assert.equal(matingSlots.length, riser.joinerySlots.length);
    assert.ok(matingSlots.every(operation => operation.type === 'throughCut' && operation.mandatory === true));
    assert.ok(matingSlots.every(operation => operation.purpose === 'structural-cross-lap-panel-slot'));
    assert.ok(matingSlots.every(operation => operation.partId !== 'panel_control_riser'));
    const joined = applyJoineryStrategies(manifest);
    const supportPockets = joined.manifest.operations.filter(operation => supportJoints.some(joint => operation.id === `${joint.id}:dado:pocket`));
    assert.equal(supportPockets.length, riser.joinerySlots.length);
    assert.equal(new Set(joined.manifest.operations.map(operation => operation.id)).size, joined.manifest.operations.length);
    assert.deepEqual(new Set(supportPockets.map(operation => operation.partId)), new Set(['panel_control_riser']));
    const nesting = createNestingPlan(manifest, manifest.materials);
    assert.equal(nesting.unplaced.some(item => item.partId === 'panel_control_riser'), false);
    assert.ok(nesting.sheets.some(sheet => sheet.placements.some(item => item.partId === 'panel_control_riser')));
    assert.deepEqual(cabinet.getPreflightResults().filter(finding => finding.severity === 'error'), []);
}));

test('horizontal panels and profile supports own complementary open-ended cross-lap slots', () => withDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    const rib = cabinet.getPanelById('panel_control_riser').userData;
    const manifest = cabinet.getFabricationManifest();
    assert.deepEqual(rib.dadoTongues, []);
    assert.ok(rib.joinerySlots.length >= 5);

    rib.joinerySlots.forEach(slot => {
        const horizontalPanel = cabinet.getPanelById(slot.matingPartId).userData;
        const joint = manifest.joints.find(item => item.id === slot.jointId);
        const ribOperation = manifest.operations.find(item => item.id === `${slot.jointId}:dado:pocket`);
        const panelOperation = manifest.operations.find(item => item.id === joint?.matingMachiningOperationId);
        const panelSlot = horizontalPanel.horizontalJoinerySlots
            .find(item => item.matingPartId === rib.id);

        assert.ok(joint, `${slot.jointId} must be included in the joint schedule`);
        assert.ok(ribOperation, `${slot.id} must have a mandatory rib-slot operation`);
        assert.ok(panelOperation, `${slot.matingPartId} must have a mandatory mating-slot operation`);
        assert.ok(panelSlot, `${slot.matingPartId} must own the complementary slot`);
        assert.equal(joint.hostPartId, rib.id);
        assert.equal(joint.matingSlotGeometry.ownerPartId, slot.matingPartId);
        assert.equal(joint.matingSlotGeometry.matingPartId, rib.id);
        assert.equal(ribOperation.partId, rib.id);
        assert.equal(panelOperation.partId, slot.matingPartId);
        assert.equal(ribOperation.type, 'throughCut');
        assert.equal(panelOperation.type, 'throughCut');
        assert.equal(ribOperation.mandatory, true);
        assert.equal(panelOperation.mandatory, true);
        assert.equal(ribOperation.purpose, 'structural-cross-lap-rib-slot');
        assert.equal(panelOperation.purpose, 'structural-cross-lap-panel-slot');
        closeTo(ribOperation.depthMm, rib.thicknessMm);
        closeTo(panelOperation.depthMm, horizontalPanel.thicknessMm);
        closeTo(ribOperation.geometry.heightMm, horizontalPanel.thicknessMm + ribOperation.clearanceMm * 2);
        closeTo(panelOperation.geometry.widthMm, rib.thicknessMm + panelOperation.clearanceMm * 2);
        assert.equal(slot.insertionAxis, 'panel-length');
        assert.equal(panelSlot.insertionAxis, 'panel-length');
        assert.ok(slot.clearanceMm > 0);
        assert.ok(
            ribOperation.geometry.widthMm < horizontalPanel.lengthMm * 0.6,
            `${slot.id} must stop near the shared midpoint rather than crossing the whole rib`
        );
        assert.ok(panelOperation.geometry.heightMm < horizontalPanel.lengthMm * 0.6);
    });

    const ribSlotOutlines = cabinet.getPanelById(rib.id).children.filter(child => child.userData?.jointSlot);
    assert.equal(ribSlotOutlines.length, rib.joinerySlots.length * 2);
    rib.joinerySlots.forEach(slot => {
        const horizontalPanel = cabinet.getPanelById(slot.matingPartId);
        assert.ok(horizontalPanel.children.some(child => (
            child.userData?.jointSlot && child.userData.matingPartId === rib.id
        )));
    });

    const profileCut = manifest.operations.find(operation => operation.partId === rib.id && operation.type === 'profileCut');
    const contour = manifest.contours.find(item => item.id === profileCut?.geometry?.contourId);
    assert.ok(contour, 'ordinary manifest profileCut must reference the full cabinet profile');
    assert.equal(contour.points.length, rib.profilePoints.length);
    contour.points.forEach((point, index) => {
        closeTo(point.xMm, rib.profilePoints[index].x);
        closeTo(point.yMm, rib.profilePoints[index].y);
    });
    assert.deepEqual(cabinet.getPreflightResults().filter(finding => finding.severity === 'error'), []);

    const barTop = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.barstool));
    const barTopRib = barTop.getPanelById('panel_control_riser').userData;
    assert.equal(barTopRib.metadata.fullHeightProfile, true);
    assert.deepEqual(barTopRib.dadoTongues, []);
    assert.ok(barTopRib.joinerySlots.length >= 5);
    assert.deepEqual(barTop.getPreflightResults().filter(finding => finding.severity === 'error'), []);
}));

test('profile support count and spacing are centred, configurable and bounded by the side walls', () => withDocument(() => {
    const leftParams = cloneParams(PRESETS.standard);
    leftParams.controlRiserLateralPosition = 20;
    const rightParams = cloneParams(PRESETS.standard);
    rightParams.controlRiserLateralPosition = 80;
    const left = new Cabinet(new THREE.Scene(), leftParams);
    const right = new Cabinet(new THREE.Scene(), rightParams);
    const leftRiser = left.getPanelById('panel_control_riser');
    const rightRiser = right.getPanelById('panel_control_riser');
    assert.deepEqual(leftRiser.userData.profilePoints, rightRiser.userData.profilePoints);
    closeTo(leftRiser.position.z, rightRiser.position.z);

    const twinParams = cloneParams(PRESETS.standard);
    twinParams.controlProfileSupportCount = 2;
    twinParams.controlProfileSupportSpacing = 260;
    twinParams.componentOverrides.panel_control_riser = {
        ...twinParams.componentOverrides.panel_control_riser,
        thicknessDelta: 6
    };
    twinParams.componentOverrides.panel_control_riser_2 = {
        ...twinParams.componentOverrides.panel_control_riser_2,
        thicknessDelta: -3
    };
    const twin = new Cabinet(new THREE.Scene(), twinParams);
    const first = twin.getPanelById('panel_control_riser');
    const second = twin.getPanelById('panel_control_riser_2');
    assert.ok(first);
    assert.ok(second);
    closeTo(second.position.z - first.position.z, 260);
    closeTo((first.position.z + second.position.z) / 2, 0);
    assert.equal(first.userData.metadata.supportCount, 2);
    assert.equal(second.userData.metadata.supportCount, 2);
    assert.equal(first.userData.metadata.supportSpacingMm, 260);
    assert.notEqual(first.userData.thicknessMm, second.userData.thicknessMm);
    assert.ok(second.userData.cutouts.some(cutout => cutout.id === 'control-riser-cable-port-2'));
    const twinManifest = twin.getFabricationManifest();
    assert.equal(twin.params.controlProfileSupportCount, 2);
    assert.equal(twin.params.controlProfileSupportSpacing, 260);
    assert.equal(twinManifest.parameters.controlProfileSupportCount, 2);
    assert.equal(twinManifest.parameters.controlProfileSupportSpacing, 260);
    const twinDadoJoints = twinManifest.joints.filter(joint => (
        joint.type === 'dado seam'
        && (joint.partIds.includes('panel_control_riser') || joint.partIds.includes('panel_control_riser_2'))
    ));
    const slotsPerSupport = first.userData.joinerySlots.length;
    assert.equal(twinDadoJoints.length, slotsPerSupport * 2);
    assert.equal(new Set(twinDadoJoints.map(joint => joint.id)).size, slotsPerSupport * 2);
    assert.ok(twinDadoJoints.every(joint => (
        joint.hostPartId === 'panel_control_riser'
        || joint.hostPartId === 'panel_control_riser_2'
    )));
    const defaultTwinPockets = twinManifest.operations.filter(operation => twinDadoJoints.some(joint => operation.id === `${joint.id}:dado:pocket`));
    assert.equal(defaultTwinPockets.length, slotsPerSupport * 2);
    assert.ok(defaultTwinPockets.every(operation => (
        operation.type === 'throughCut'
        && operation.purpose === 'structural-cross-lap-rib-slot'
    )));
    const defaultTwinMatingSlots = twinManifest.operations.filter(operation => twinDadoJoints.some(joint => (
        operation.id === joint.matingMachiningOperationId
    )));
    assert.equal(defaultTwinMatingSlots.length, slotsPerSupport * 2);
    assert.ok(defaultTwinMatingSlots.every(operation => (
        operation.type === 'throughCut'
        && operation.purpose === 'structural-cross-lap-panel-slot'
    )));
    const twinJoined = applyJoineryStrategies(twinManifest);
    const twinPockets = twinJoined.manifest.operations.filter(operation => twinDadoJoints.some(joint => operation.id === `${joint.id}:dado:pocket`));
    assert.equal(twinPockets.length, slotsPerSupport * 2);
    assert.deepEqual(twin.getPreflightResults().filter(finding => finding.severity === 'error'), []);

    const boundedParams = cloneParams(PRESETS.standard);
    boundedParams.controlProfileSupportCount = 2;
    boundedParams.controlProfileSupportSpacing = 5000;
    const bounded = new Cabinet(new THREE.Scene(), boundedParams);
    const boundedFirst = bounded.getPanelById('panel_control_riser');
    const boundedSecond = bounded.getPanelById('panel_control_riser_2');
    const innerLeft = -bounded.params.width / 2 + bounded.getEffectiveThickness('side_left');
    const innerRight = bounded.params.width / 2 - bounded.getEffectiveThickness('side_right');
    assert.ok(boundedFirst.position.z - boundedFirst.userData.thicknessMm / 2 >= innerLeft - 0.01);
    assert.ok(boundedSecond.position.z + boundedSecond.userData.thicknessMm / 2 <= innerRight + 0.01);
    assert.equal(boundedFirst.userData.metadata.supportSpacingClamped, true);
    assert.ok(boundedFirst.userData.warnings.some(message => message.includes('spacing was fitted')));

    const canonicalParams = cloneParams(PRESETS.standard);
    canonicalParams.controlProfileSupportCount = 9.7;
    canonicalParams.controlProfileSupportSpacing = -50;
    const canonical = new Cabinet(new THREE.Scene(), canonicalParams);
    assert.equal(canonical.params.controlProfileSupportCount, 2);
    assert.equal(canonical.params.controlProfileSupportSpacing, 0);
    assert.equal(canonical.getFabricationManifest().parameters.controlProfileSupportCount, 2);
    assert.equal(canonical.getFabricationManifest().parameters.controlProfileSupportSpacing, 0);

    const asymmetricParams = cloneParams(PRESETS.standard);
    asymmetricParams.componentOverrides.side_left = { thicknessDelta: 8 };
    asymmetricParams.componentOverrides.side_right = { thicknessDelta: -3 };
    const asymmetric = new Cabinet(new THREE.Scene(), asymmetricParams);
    const leftThickness = asymmetric.getEffectiveThickness('side_left');
    const rightThickness = asymmetric.getEffectiveThickness('side_right');
    const clearCenter = (leftThickness - rightThickness) / 2;
    const support = asymmetric.getPanelById('panel_cp_support');
    closeTo(support.position.z, clearCenter);
    closeTo(support.position.z - support.userData.widthMm / 2, -asymmetric.params.width / 2 + leftThickness);
    closeTo(support.position.z + support.userData.widthMm / 2, asymmetric.params.width / 2 - rightThickness);
}));

test('profile support mating metadata and mandatory dados follow enabled parts', () => withDocument(() => {
    const single = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    assert.ok(single.getPanelById('panel_cp_support').userData.matingPanelIds.includes('panel_control_riser'));
    assert.ok(!single.getPanelById('panel_cp_support').userData.matingPanelIds.includes('panel_control_riser_2'));
    assert.ok(!single.getPanelById('panel_display_support').userData.matingPanelIds.includes('panel_control_riser_2'));

    const disabledParams = cloneParams(PRESETS.standard);
    disabledParams.controlRiserEnabled = false;
    const disabled = new Cabinet(new THREE.Scene(), disabledParams);
    assert.equal(disabled.getPanelById('panel_control_riser'), null);
    assert.ok(!disabled.getPanelById('panel_cp_support').userData.matingPanelIds.some(id => id.startsWith('panel_control_riser')));
    assert.ok(!disabled.getPanelById('panel_display_support').userData.matingPanelIds.some(id => id.startsWith('panel_control_riser')));
    assert.equal(disabled.getFabricationManifest().operations.filter(operation => operation.purpose?.startsWith('structural-cross-lap-')).length, 0);

    const noDisplayParams = cloneParams(PRESETS.standard);
    noDisplayParams.displaySupportEnabled = false;
    const noDisplay = new Cabinet(new THREE.Scene(), noDisplayParams);
    const rib = noDisplay.getPanelById('panel_control_riser').userData;
    assert.ok(!rib.matingPanelIds.includes('panel_display_support'));
    assert.ok(!rib.joinerySlots.some(slot => slot.matingPartId === 'panel_display_support'));
    const noDisplayDados = noDisplay.getFabricationManifest().operations
        .filter(operation => operation.purpose === 'structural-cross-lap-rib-slot');
    assert.equal(noDisplayDados.length, rib.joinerySlots.length);
    assert.ok(noDisplayDados.every(operation => operation.partId === 'panel_control_riser'));
    assert.deepEqual(noDisplay.getPreflightResults().filter(finding => finding.severity === 'error'), []);
}));

test('vee controls converge as the on-screen preview indicates', () => withDocument(() => {
    const params = cloneParams(PRESETS.standard);
    params.controls.deck.players = 1;
    params.controls.deck.layoutStyle = 'vee';
    const cabinet = new Cabinet(new THREE.Scene(), params);
    const buttons = cabinet.getPanelById('panel_cp').userData.hardwareLayout
        .filter(item => item.kind === 'button');
    assert.equal(buttons.length, 6);
    const openingAtFirstColumn = Math.abs(buttons[0].xMm - buttons[1].xMm);
    const openingAtLastColumn = Math.abs(buttons[4].xMm - buttons[5].xMm);
    assert.ok(openingAtFirstColumn > openingAtLastColumn, 'the two rows should converge into a vee');
}));

test('exploded panels move radially away from the assembly centre', () => withDocument(() => {
    const assembled = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    const explodedParams = cloneParams(PRESETS.standard);
    explodedParams.exploded = 100;
    const exploded = new Cabinet(new THREE.Scene(), explodedParams);
    const profile = assembled.getProfilePointList();
    const center = {
        x: (Math.min(...profile.map(point => point.x)) + Math.max(...profile.map(point => point.x))) / 2,
        y: (Math.min(...profile.map(point => point.y)) + Math.max(...profile.map(point => point.y))) / 2
    };

    assembled.panelMeshes
        .filter(mesh => !mesh.userData.id.startsWith('side_'))
        .forEach(mesh => {
            const moved = exploded.getPanelById(mesh.userData.id);
            const beforeDistance = Math.hypot(mesh.position.x - center.x, mesh.position.y - center.y, mesh.position.z);
            const afterDistance = Math.hypot(moved.position.x - center.x, moved.position.y - center.y, moved.position.z);
            const displacement = moved.position.distanceTo(mesh.position);
            if (mesh.userData.id.startsWith('panel_control_riser')) {
                assert.ok(displacement > 100, `${mesh.userData.id} should separate along the cabinet width`);
            } else {
                assert.ok(afterDistance > beforeDistance + 100, `${mesh.userData.id} should move outward`);
            }
        });

    exploded.group.updateMatrixWorld(true);
    for (let first = 0; first < exploded.panelMeshes.length; first++) {
        for (let second = first + 1; second < exploded.panelMeshes.length; second++) {
            const a = exploded.panelMeshes[first];
            const b = exploded.panelMeshes[second];
            const boxA = new THREE.Box3().setFromObject(a);
            const boxB = new THREE.Box3().setFromObject(b);
            const overlap = [
                Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x),
                Math.min(boxA.max.y, boxB.max.y) - Math.max(boxA.min.y, boxB.min.y),
                Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z)
            ];
            assert.ok(
                overlap.some(value => value <= 0.5),
                `${a.userData.id} and ${b.userData.id} should not overlap in the fully exploded view`
            );
        }
    }
}));

test('changing the selected panel updates appearance without rebuilding geometry', () => withDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    const originalMeshes = [...cabinet.panelMeshes];
    cabinet.build = () => {
        throw new Error('selection must not rebuild cabinet geometry');
    };

    cabinet.selectPanel('panel_cp');
    assert.equal(cabinet.selectedPanelId, 'panel_cp');
    assert.deepEqual(cabinet.panelMeshes, originalMeshes);
    assert.equal(cabinet.getPanelById('panel_cp').userData.edges.visible, true);

    cabinet.selectPanel('panel_bottom');
    assert.equal(cabinet.selectedPanelId, 'panel_bottom');
    assert.deepEqual(cabinet.panelMeshes, originalMeshes);
}));

test('screw group and individual overrides are stable and isolated', () => withDocument(() => {
    const cabinet = new Cabinet(new THREE.Scene(), cloneParams(PRESETS.standard));
    cabinet.updateFastenerGroupOverride('panel_bottom', { lengthMm: 77, diameterMm: 5 });
    const bottomFasteners = cabinet.getPanelById('panel_bottom').userData.fasteners
        .filter(item => item.targetPanelId === 'panel_bottom');
    assert.ok(bottomFasteners.length > 0);
    assert.ok(bottomFasteners.every(item => item.lengthMm === 77 && item.diameterMm === 5));

    const chosen = bottomFasteners[0];
    cabinet.updateFastenerOverride(chosen.id, { lengthMm: 99 });
    const updated = cabinet.getPanelById('panel_bottom').userData.fasteners
        .find(item => item.id === chosen.id);
    const sibling = cabinet.getPanelById('panel_bottom').userData.fasteners
        .find(item => item.targetPanelId === 'panel_bottom' && item.id !== chosen.id);
    assert.equal(updated.lengthMm, 99);
    assert.equal(sibling.lengthMm, 77);
}));
