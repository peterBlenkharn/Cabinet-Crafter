import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ERGONOMIC_REFERENCE_PROFILES,
    analyzeErgonomics,
    compareErgonomicProfiles
} from '../wwwroot/js/ergonomics.js';

test('ergonomic workbench evaluates the bundled user-height range', () => {
    const analysis = analyzeErgonomics({
        cpHeight: 950, cpDepth: 280, depth: 650,
        screenHeight: 270, screenWidth: 470, monitorAngle: 15
    });
    assert.equal(analysis.units, 'mm');
    assert.equal(analysis.profiles.length, ERGONOMIC_REFERENCE_PROFILES.length);
    assert.equal(analysis.findings.length, analysis.summary.errors + analysis.summary.warnings + analysis.summary.information);
    assert.ok(['OK', 'REVIEW', 'CHECK'].includes(analysis.summary.status));
});

test('profile geometry supplies exact sight-line centre and viewing angles', () => {
    const analysis = analyzeErgonomics(
        { cpHeight: 900, cpDepth: 250, depth: 600, screenHeight: 300, monitorAngle: 10 },
        {
            profiles: [{ id: 'test', label: 'Test', heightMm: 1700, eyeHeightRatio: 0.9, elbowHeightRatio: 0.62, reachRatio: 0.45 }],
            viewerDistanceMm: 700,
            profilePoints: { bezel_top: { y: 1500 }, cp_back: { y: 1000 } }
        }
    );
    assert.equal(analysis.screen.centerHeightMm, 1250);
    assert.equal(analysis.profiles[0].eyeHeightMm, 1530);
    assert.equal(analysis.profiles[0].viewingAngleDeg, -21.8);
});

test('excessive control reach is a stable blocking ergonomic finding', () => {
    const analysis = analyzeErgonomics(
        { cpHeight: 500, cpDepth: 2000, depth: 900, screenHeight: 250, monitorAngle: 15 },
        { profiles: [{ id: 'small', label: 'Small user', heightMm: 1400, reachRatio: 0.4 }] }
    );
    assert.ok(analysis.findings.some(item => item.code === 'ERGO_REACH' && item.severity === 'error' && item.field === 'cpDepth'));
    assert.equal(analysis.summary.status, 'CHECK');
});

test('ergonomic comparison reports min/max ranges and passing profiles', () => {
    const analysis = analyzeErgonomics({ cpHeight: 900, cpDepth: 240, depth: 600, monitorAngle: 15 });
    const comparison = compareErgonomicProfiles(analysis);
    assert.ok(comparison.eyeHeightRangeMm.minimum < comparison.eyeHeightRangeMm.maximum);
    assert.ok(comparison.maximumReachRangeMm.minimum < comparison.maximumReachRangeMm.maximum);
    assert.equal(compareErgonomicProfiles({ profiles: [] }), null);
});
