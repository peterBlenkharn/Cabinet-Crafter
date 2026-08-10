export const ERGONOMICS_ANALYSIS_VERSION = 1;

export const ERGONOMIC_REFERENCE_PROFILES = Object.freeze([
    profile('child_12', 'Child 12', 1500, 0.91, 0.61, 0.43),
    profile('adult_woman_small', 'Adult Woman S', 1580, 0.925, 0.625, 0.44),
    profile('adult_woman_average', 'Adult Woman M', 1650, 0.928, 0.63, 0.445),
    profile('adult_average', 'Adult Average', 1750, 0.93, 0.63, 0.45),
    profile('adult_man_average', 'Adult Man M', 1800, 0.932, 0.635, 0.455),
    profile('tall_adult', 'Tall Adult', 1930, 0.935, 0.64, 0.46)
]);

export function analyzeErgonomics(params, options = {}) {
    const profiles = resolveProfiles(options.profiles);
    const viewerDistanceMm = positive(options.viewerDistanceMm, 650);
    const deckHeightMm = positive(params?.cpHeight, 950);
    const screen = resolveScreen(params, options.profilePoints);
    const results = profiles.map(reference => analyzeProfile(reference, deckHeightMm, screen, viewerDistanceMm, params));
    const findings = results.flatMap(result => result.findings);

    return {
        version: ERGONOMICS_ANALYSIS_VERSION,
        units: 'mm',
        generatedAt: new Date().toISOString(),
        viewerDistanceMm,
        screen,
        deckHeightMm,
        profiles: results,
        summary: {
            status: findings.some(item => item.severity === 'error') ? 'CHECK' : findings.some(item => item.severity === 'warning') ? 'REVIEW' : 'OK',
            errors: findings.filter(item => item.severity === 'error').length,
            warnings: findings.filter(item => item.severity === 'warning').length,
            information: findings.filter(item => item.severity === 'info').length
        },
        findings
    };
}

export function compareErgonomicProfiles(analysis) {
    const profiles = analysis?.profiles || [];
    if (!profiles.length) return null;
    const values = key => profiles.map(item => item[key]);
    return {
        eyeHeightRangeMm: range(values('eyeHeightMm')),
        elbowHeightRangeMm: range(values('elbowHeightMm')),
        controlDropRangeMm: range(values('controlDropFromElbowMm')),
        viewingAngleRangeDeg: range(values('viewingAngleDeg')),
        maximumReachRangeMm: range(values('comfortableReachMm')),
        profilesPassingAllChecks: profiles.filter(item => !item.findings.some(finding => finding.severity !== 'info')).map(item => item.id)
    };
}

function analyzeProfile(reference, deckHeightMm, screen, viewerDistanceMm, params) {
    const eyeHeightMm = reference.heightMm * reference.eyeHeightRatio;
    const elbowHeightMm = reference.heightMm * reference.elbowHeightRatio;
    const comfortableReachMm = reference.heightMm * reference.reachRatio;
    const controlDropFromElbowMm = elbowHeightMm - deckHeightMm;
    const verticalScreenDelta = screen.centerHeightMm - eyeHeightMm;
    const viewingAngleDeg = Math.atan2(verticalScreenDelta, viewerDistanceMm) * 180 / Math.PI;
    const screenTiltDeg = finite(params?.monitorAngle, 15);
    const reachDemandMm = positive(params?.cpDepth, 280) * 0.6 + Math.max(0, positive(params?.depth, 600) - 600) * 0.2;
    const findings = [];

    if (controlDropFromElbowMm < 40) {
        findings.push(finding('ERGO_CONTROL_TOO_HIGH', 'warning', reference.id,
            `${reference.label}: control deck is only ${round(controlDropFromElbowMm)} mm below elbow height.`,
            'Lower the control deck or validate the posture with a physical mock-up.', 'cpHeight'));
    } else if (controlDropFromElbowMm > 220) {
        findings.push(finding('ERGO_CONTROL_TOO_LOW', 'warning', reference.id,
            `${reference.label}: control deck is ${round(controlDropFromElbowMm)} mm below elbow height.`,
            'Raise the control deck or provide a seat/platform suited to this user.', 'cpHeight'));
    }

    if (viewingAngleDeg > 12) {
        findings.push(finding('ERGO_SCREEN_ABOVE_EYE', 'warning', reference.id,
            `${reference.label}: screen centre is ${round(viewingAngleDeg, 1)}° above the eye line.`,
            'Lower the screen or increase viewing distance.', 'screenHeight'));
    } else if (viewingAngleDeg < -32) {
        findings.push(finding('ERGO_SCREEN_TOO_LOW', 'warning', reference.id,
            `${reference.label}: screen centre is ${round(Math.abs(viewingAngleDeg), 1)}° below the eye line.`,
            'Raise the screen or reduce viewing distance.', 'screenHeight'));
    }

    if (screenTiltDeg < 0 || screenTiltDeg > 35) {
        findings.push(finding('ERGO_MONITOR_TILT', 'warning', reference.id,
            `${reference.label}: ${round(screenTiltDeg)}° monitor tilt is outside the guided range.`,
            'Use 0–35° unless the physical monitor and sight-line mock-up support another angle.', 'monitorAngle'));
    }

    if (reachDemandMm > comfortableReachMm) {
        findings.push(finding('ERGO_REACH', 'error', reference.id,
            `${reference.label}: estimated control reach ${round(reachDemandMm)} mm exceeds the ${round(comfortableReachMm)} mm reference envelope.`,
            'Reduce control-panel depth, move controls toward the player, or change the intended user range.', 'cpDepth'));
    }

    if (!findings.length) {
        findings.push(finding('ERGO_REFERENCE_OK', 'info', reference.id,
            `${reference.label}: deck height, reach, and sight line are within the guided reference ranges.`,
            'Validate critical dimensions with a full-size mock-up before fabrication.', null));
    }

    return {
        id: reference.id,
        label: reference.label,
        heightMm: reference.heightMm,
        eyeHeightMm: round(eyeHeightMm),
        elbowHeightMm: round(elbowHeightMm),
        comfortableReachMm: round(comfortableReachMm),
        controlDropFromElbowMm: round(controlDropFromElbowMm),
        viewingAngleDeg: round(viewingAngleDeg, 1),
        reachDemandMm: round(reachDemandMm),
        findings
    };
}

function resolveScreen(params, points) {
    const height = positive(params?.screenHeight, 270);
    let centre = positive(params?.cpHeight, 950) + 270;
    if (points?.bezel_top && points?.cp_back) centre = (Number(points.bezel_top.y) + Number(points.cp_back.y)) / 2;
    return {
        widthMm: positive(params?.screenWidth, 470),
        heightMm: height,
        centerHeightMm: round(centre),
        bottomHeightMm: round(centre - height / 2),
        topHeightMm: round(centre + height / 2)
    };
}

function resolveProfiles(profiles) {
    if (!Array.isArray(profiles) || !profiles.length) return ERGONOMIC_REFERENCE_PROFILES;
    return profiles.map(item => profile(
        item.id || 'custom',
        item.label || item.name || 'Custom',
        positive(item.heightMm ?? item.height, 1750),
        finite(item.eyeHeightRatio, 0.93),
        finite(item.elbowHeightRatio, 0.63),
        finite(item.reachRatio, 0.45)
    ));
}

function profile(id, label, heightMm, eyeHeightRatio, elbowHeightRatio, reachRatio) {
    return Object.freeze({ id, label, heightMm, eyeHeightRatio, elbowHeightRatio, reachRatio });
}

function finding(code, severity, profileId, message, remedy, field) {
    return { code, severity, profileId, partIds: [], message, remedy, field };
}

function range(values) {
    return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback) {
    const parsed = finite(value, fallback);
    return parsed > 0 ? parsed : fallback;
}

function round(value, precision = 0) {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
}
