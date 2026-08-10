const DEFAULT_PROFILE = Object.freeze({
    shoulderRatio: 0.24,
    torsoDepthRatio: 0.11,
    pelvisRatio: 0.17,
    armRatio: 0.148,
    legRatio: 0.242
});

function finiteRatio(value, fallback, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(minimum, Math.min(maximum, numeric));
}

function point(x, y, z) {
    return Object.freeze({ x, y, z });
}

function segmentLength(start, end) {
    return Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
}

function forwardEndpoint(start, length, lateralDelta, verticalDelta) {
    const planarLength = Math.hypot(lateralDelta, verticalDelta);
    const forwardDelta = Math.sqrt(Math.max(0, length * length - planarLength * planarLength));
    return point(
        start.x + lateralDelta,
        start.y + verticalDelta,
        start.z - forwardDelta
    );
}

/**
 * Produces one connected mannequin skeleton and body envelope in millimetres.
 * Rendering code consumes these shared endpoints, which prevents limbs from
 * drifting apart when the height or body preset changes.
 */
export function createMannequinLayout(height, profile = {}) {
    const H = Math.max(900, Math.min(2500, Number(height) || 1750));
    const shoulderRatio = finiteRatio(profile.shoulderRatio, DEFAULT_PROFILE.shoulderRatio, 0.19, 0.29);
    const torsoDepthRatio = finiteRatio(profile.torsoDepthRatio, DEFAULT_PROFILE.torsoDepthRatio, 0.085, 0.145);
    const pelvisRatio = finiteRatio(profile.pelvisRatio, DEFAULT_PROFILE.pelvisRatio, 0.145, 0.205);
    const armRatio = finiteRatio(profile.armRatio, DEFAULT_PROFILE.armRatio, 0.125, 0.17);
    const legRatio = finiteRatio(profile.legRatio, DEFAULT_PROFILE.legRatio, 0.215, 0.265);

    const headRadius = H * 0.052;
    const neckHeight = H * 0.034;
    const pelvisHeight = H * 0.075;
    const footHeight = H * 0.026;
    const shoulderWidth = H * shoulderRatio;
    const pelvisWidth = H * pelvisRatio;
    const torsoDepth = H * torsoDepthRatio;
    const jointRadius = H * 0.019;
    const armLength = H * armRatio;
    const thighLength = H * legRatio;
    const calfLength = H * legRatio;

    const ankleY = footHeight * 0.72;
    const kneeY = ankleY + calfLength;
    const hipY = kneeY + thighLength;
    const pelvisBottomY = hipY - jointRadius * 0.72;
    const pelvisTopY = pelvisBottomY + pelvisHeight;

    const headCenterY = H - headRadius;
    const headBottomY = headCenterY - headRadius;
    const neckTopY = headBottomY + H * 0.007;
    const neckBottomY = neckTopY - neckHeight;
    const torsoTopY = neckBottomY;
    const torsoBottomY = pelvisTopY;
    const torsoHeight = Math.max(H * 0.24, torsoTopY - torsoBottomY);

    const legX = pelvisWidth * 0.285;
    const shoulderY = torsoTopY - H * 0.035;
    const shoulderX = shoulderWidth / 2 - jointRadius * 0.35;

    const leftShoulder = point(-shoulderX, shoulderY, 0);
    const rightShoulder = point(shoulderX, shoulderY, 0);
    const leftElbow = forwardEndpoint(leftShoulder, armLength, -H * 0.03, -H * 0.105);
    const rightElbow = forwardEndpoint(rightShoulder, armLength, H * 0.03, -H * 0.105);
    const leftHand = forwardEndpoint(leftElbow, armLength, H * 0.018, -H * 0.026);
    const rightHand = forwardEndpoint(rightElbow, armLength, -H * 0.018, -H * 0.026);

    const leftHip = point(-legX, hipY, 0);
    const rightHip = point(legX, hipY, 0);
    const leftKnee = point(-legX, kneeY, 0);
    const rightKnee = point(legX, kneeY, 0);
    const leftAnkle = point(-legX, ankleY, 0);
    const rightAnkle = point(legX, ankleY, 0);

    return Object.freeze({
        height: H,
        dimensions: Object.freeze({
            headRadius,
            neckHeight,
            shoulderWidth,
            pelvisWidth,
            torsoDepth,
            jointRadius,
            armLength,
            thighLength,
            calfLength,
            footHeight,
            footWidth: H * 0.042,
            footLength: H * 0.092
        }),
        torso: Object.freeze({
            centerY: (torsoTopY + torsoBottomY) / 2,
            height: torsoHeight,
            topY: torsoTopY,
            bottomY: torsoBottomY,
            topWidth: shoulderWidth,
            bottomWidth: pelvisWidth * 0.78,
            topDepth: torsoDepth,
            bottomDepth: torsoDepth * 0.84
        }),
        pelvis: Object.freeze({
            centerY: (pelvisTopY + pelvisBottomY) / 2,
            height: pelvisHeight,
            topY: pelvisTopY,
            bottomY: pelvisBottomY,
            topWidth: pelvisWidth * 0.78,
            bottomWidth: pelvisWidth,
            topDepth: torsoDepth * 0.84,
            bottomDepth: torsoDepth * 0.94
        }),
        head: Object.freeze({
            center: point(0, headCenterY, 0),
            bottomY: headBottomY
        }),
        neck: Object.freeze({
            center: point(0, (neckTopY + neckBottomY) / 2, 0),
            topY: neckTopY,
            bottomY: neckBottomY
        }),
        arms: Object.freeze({
            left: Object.freeze({ shoulder: leftShoulder, elbow: leftElbow, hand: leftHand }),
            right: Object.freeze({ shoulder: rightShoulder, elbow: rightElbow, hand: rightHand })
        }),
        legs: Object.freeze({
            left: Object.freeze({ hip: leftHip, knee: leftKnee, ankle: leftAnkle }),
            right: Object.freeze({ hip: rightHip, knee: rightKnee, ankle: rightAnkle })
        }),
        invariants: Object.freeze({
            leftUpperArmLength: segmentLength(leftShoulder, leftElbow),
            leftForearmLength: segmentLength(leftElbow, leftHand),
            rightUpperArmLength: segmentLength(rightShoulder, rightElbow),
            rightForearmLength: segmentLength(rightElbow, rightHand),
            leftThighLength: segmentLength(leftHip, leftKnee),
            leftCalfLength: segmentLength(leftKnee, leftAnkle)
        })
    });
}
