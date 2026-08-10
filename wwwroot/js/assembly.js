import { enrichManifestParts } from './manifest-utils.js';

export const ASSEMBLY_PLAN_VERSION = 1;

const ASSEMBLY_PRIORITY = [
    'side_left', 'panel_bottom', 'panel_toe', 'panel_kick', 'panel_back',
    'panel_machine_shelf', 'panel_cp_support', 'panel_control_riser', 'panel_control_riser_2', 'panel_apron', 'panel_cp',
    'panel_display_support',
    'panel_bezel', 'panel_header_support', 'panel_recess', 'panel_marquee',
    'panel_marq_top', 'panel_top', 'side_right'
];

export function generateAssemblyPlan(manifest, options = {}) {
    const includedParts = enrichManifestParts(manifest, { includedOnly: true }).filter(part => part.included !== false);
    const partsById = new Map(includedParts.map(part => [part.id, part]));
    const joints = normalizeJoints(manifest?.joints, includedParts);
    const fasteners = normalizeFasteners(manifest?.fasteners, includedParts);
    const ordered = [...includedParts].sort(compareParts);
    const leftSide = partsById.get('side_left');
    const rightSide = partsById.get('side_right');
    const internal = ordered.filter(part => !['side_left', 'side_right'].includes(part.id));

    const steps = [];
    steps.push(step('prepare', 'Prepare and identify parts', ordered.map(part => part.id), {
        instructions: [
            'Verify every part label, material, finished face, and grain arrow against the fabrication manifest.',
            'Dry-fit all joints before applying adhesive or driving fasteners.',
            'Keep reference-only operations out of the machining workflow.'
        ],
        checks: ['Part count matches the BOM', 'No blocking preflight findings remain']
    }));

    if (leftSide) {
        steps.push(step('datum-side', `Lay ${leftSide.name || 'left wall'} finished face down`, [leftSide.id], {
            instructions: ['Support the side wall on a flat, protected surface.', 'Use its labelled mating edges as the assembly datum.'],
            checks: ['Panel is flat', 'Inside face and front direction are confirmed']
        }));
    }

    internal.forEach((part, index) => {
        const partJoints = joints.filter(joint => joint.partIds.includes(part.id));
        const partFasteners = fasteners.filter(fastener => fastener.partIds.includes(part.id));
        const mates = [...new Set(partJoints.flatMap(joint => joint.partIds).filter(id => id !== part.id))];
        steps.push(step(`install-${part.id}`, `Install ${part.name || part.id}`, [part.id, ...mates], {
            instructions: buildPartInstructions(part, partJoints, partFasteners, index === 0),
            joints: partJoints.map(joint => ({
                pointName: joint.pointName,
                type: joint.type,
                includedAngleDeg: joint.includedAngleDeg,
                bevelAngleDeg: joint.bevelAngleDeg,
                matePartIds: joint.partIds.filter(id => id !== part.id)
            })),
            fasteners: summarizeFasteners(partFasteners),
            checks: [
                'Part ID and orientation match the drawing',
                'Mating edges close without forcing',
                'Pilot holes and cutouts remain unobstructed'
            ]
        }));
    });

    if (rightSide) {
        steps.push(step('close-cabinet', `Fit ${rightSide.name || 'right wall'}`, [rightSide.id, ...internal.map(part => part.id)], {
            instructions: [
                'Dry-fit the second side over all labelled mating edges.',
                'Check cabinet diagonals before tightening fasteners.',
                'Tighten progressively from the bottom datum toward the top.'
            ],
            fasteners: summarizeFasteners(fasteners.filter(item => item.partIds.includes(rightSide.id))),
            checks: ['Cabinet is square', 'All seams are flush', 'No panel is bowed']
        }));
    }

    const hardwareParts = includedParts.filter(part => (part.operations || []).some(operation => ['throughCut', 'drill', 'pocket'].includes(operation.type)));
    if (hardwareParts.length) {
        steps.push(step('fit-hardware', 'Fit controls, display, and service hardware', hardwareParts.map(part => part.id), {
            instructions: [
                'Deburr and seal all machined openings before fitting hardware.',
                'Install hardware from the documented finished face.',
                'Maintain every body, movement, cable, and service keepout.'
            ],
            checks: ['Controls move freely', 'Monitor and service access are unobstructed', 'Cable strain relief is present']
        }));
    }

    steps.push(step('final-inspection', 'Final fabrication and safety inspection', ordered.map(part => part.id), {
        instructions: [
            'Re-run preflight against the as-built material thickness and hardware choices.',
            'Confirm all fasteners are below finished surfaces where required.',
            'Check stability, ventilation, earth continuity, cable protection, and service access before power-up.'
        ],
        checks: ['No sharp edges or exposed conductors', 'Cabinet is stable', 'All removable panels remain serviceable']
    }));

    return {
        version: ASSEMBLY_PLAN_VERSION,
        units: 'mm',
        projectName: manifest?.project?.name || options.projectName || 'Cabinet',
        generatedAt: new Date().toISOString(),
        steps: steps.map((item, index) => ({ ...item, number: index + 1 })),
        labels: generatePartLabels(manifest, options),
        summary: {
            parts: includedParts.length,
            joints: joints.length,
            fasteners: fasteners.length,
            steps: steps.length
        }
    };
}

export function generatePartLabels(manifest, options = {}) {
    const materialMap = new Map((manifest?.materials || []).map(material => [material.id, material]));
    const edgeAssignments = options.edgeAssignments || {};
    return (manifest?.parts || []).filter(part => part.includeInFabrication !== false).map(part => {
        const material = materialMap.get(part.materialId) || part.material || {};
        const jointEdges = normalizeJoints(manifest?.joints, manifest?.parts || []).filter(joint => joint.partIds.includes(part.id));
        return {
            partId: part.id,
            name: part.name || part.id,
            quantity: Math.max(1, Math.round(Number(part.quantity) || 1)),
            material: material.name || part.materialId || 'Unassigned material',
            thicknessMm: Number(part.thicknessMm ?? part.thickness ?? material.measuredThicknessMm) || 0,
            grainDirection: part.grainDirection || material.grainDirection || 'none',
            finishedFace: part.finishedFace || 'front',
            frontArrow: part.frontDirection || 'labelled in drawing',
            joints: jointEdges.map(joint => `${joint.pointName || 'edge'}: ${joint.type || 'joint'}`),
            edgeTreatments: edgeAssignments[part.id] || []
        };
    });
}

export function calculateTMoulding(manifest, edgeAssignments = {}, options = {}) {
    const wastePercent = Math.max(0, Number(options.wastePercent) || 10);
    const records = [];
    (manifest?.parts || []).forEach(part => {
        const assignments = edgeAssignments[part.id] || [];
        assignments.forEach(assignment => {
            const lengthMm = Number(assignment.lengthMm) || inferPerimeter(part);
            const withWasteMm = Math.ceil(lengthMm * (1 + wastePercent / 100));
            records.push({
                partId: part.id,
                edgeId: assignment.edgeId || 'perimeter',
                widthMm: Number(assignment.widthMm ?? part.thicknessMm ?? part.thickness) || 18,
                slotWidthMm: Number(assignment.slotWidthMm) || 1.6,
                lengthMm,
                orderLengthMm: withWasteMm,
                orderLengthM: Math.ceil(withWasteMm / 100) / 10,
                wastePercent
            });
        });
    });
    return {
        records,
        totalOrderLengthMm: records.reduce((sum, item) => sum + item.orderLengthMm, 0),
        byWidth: groupBy(records, item => `${item.widthMm}mm / ${item.slotWidthMm}mm slot`)
    };
}

export function serializeAssemblyMarkdown(plan) {
    const lines = [`# ${plan.projectName} assembly guide`, '', `Parts: ${plan.summary.parts} · Joints: ${plan.summary.joints} · Fasteners: ${plan.summary.fasteners}`, ''];
    plan.steps.forEach(item => {
        lines.push(`## ${item.number}. ${item.title}`, '');
        item.instructions.forEach(instruction => lines.push(`- ${instruction}`));
        if (item.checks?.length) {
            lines.push('', '**Checks**', '');
            item.checks.forEach(check => lines.push(`- [ ] ${check}`));
        }
        lines.push('');
    });
    return lines.join('\n');
}

function buildPartInstructions(part, joints, fasteners, firstInternal) {
    const instructions = [];
    if (firstInternal) instructions.push('Start at the cabinet datum/base and confirm the first panel is square to the side wall.');
    if (joints.length) {
        joints.forEach(joint => instructions.push(
            `Align ${joint.pointName || 'the labelled edge'} as a ${joint.type || 'joint'}` +
            (Number.isFinite(joint.bevelAngleDeg) ? `; set the panel bevel to ${format(joint.bevelAngleDeg)}°` : '') + '.'
        ));
    } else {
        instructions.push('Align the part with its dimensioned location on the shop drawing.');
    }
    if (fasteners.length) instructions.push(`Use ${fasteners.length} documented fastener position${fasteners.length === 1 ? '' : 's'}; drill the specified pilot/clearance operations first.`);
    return instructions;
}

function normalizeJoints(source, parts) {
    const direct = Array.isArray(source) ? source : parts.flatMap(part => part.joints || []);
    const unique = new Map();
    direct.forEach((joint, index) => {
        const partIds = [...new Set((joint.partIds || [joint.partAId, joint.partBId, joint.panelId]).filter(Boolean).map(String))];
        const key = joint.id || `${partIds.sort().join('|')}:${joint.pointName || index}`;
        if (!unique.has(key)) unique.set(key, {
            id: key,
            partIds,
            pointName: joint.pointName || joint.edgeId || 'edge',
            type: joint.type || 'joint',
            includedAngleDeg: finiteOrNull(joint.includedAngleDeg ?? joint.angleDeg),
            bevelAngleDeg: finiteOrNull(joint.bevelAngleDeg ?? joint.cutAngleDeg)
        });
    });
    return [...unique.values()];
}

function normalizeFasteners(source, parts) {
    const direct = Array.isArray(source) ? source : parts.flatMap(part => part.fasteners || []);
    return direct.map((fastener, index) => ({
        id: fastener.id || `fastener-${index + 1}`,
        partIds: [...new Set((fastener.partIds || [fastener.panelId, fastener.targetPanelId, fastener.sidePanelId]).filter(Boolean).map(String))],
        kind: fastener.kind || 'screw',
        diameterMm: Number(fastener.diameterMm ?? fastener.shaftDiameterMm) || null,
        lengthMm: Number(fastener.lengthMm) || null
    }));
}

function summarizeFasteners(fasteners) {
    const groups = groupBy(fasteners, item => `${item.kind} ${item.diameterMm || '?'} × ${item.lengthMm || '?'} mm`);
    return Object.entries(groups).map(([description, items]) => ({ description, quantity: items.length }));
}

function compareParts(a, b) {
    const aIndex = ASSEMBLY_PRIORITY.indexOf(a.id);
    const bIndex = ASSEMBLY_PRIORITY.indexOf(b.id);
    return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex) || String(a.name || a.id).localeCompare(String(b.name || b.id));
}

function step(id, title, partIds, data) {
    return { id, title, partIds: [...new Set(partIds)], instructions: data.instructions || [], checks: data.checks || [], joints: data.joints || [], fasteners: data.fasteners || [] };
}

function groupBy(items, keySelector) {
    return items.reduce((groups, item) => {
        const key = keySelector(item);
        (groups[key] ||= []).push(item);
        return groups;
    }, {});
}

function inferPerimeter(part) {
    const points = part.outline?.points || part.contour?.points || part.profilePoints;
    if (Array.isArray(points) && points.length > 1) {
        return Math.round(points.reduce((sum, point, index) => {
            const next = points[(index + 1) % points.length];
            const x1 = Number(point.x ?? point[0]) || 0;
            const y1 = Number(point.y ?? point[1]) || 0;
            const x2 = Number(next.x ?? next[0]) || 0;
            const y2 = Number(next.y ?? next[1]) || 0;
            return sum + Math.hypot(x2 - x1, y2 - y1);
        }, 0));
    }
    const width = Number(part.widthMm ?? part.width) || 0;
    const height = Number(part.heightMm ?? part.lengthMm ?? part.length) || 0;
    return Math.round((width + height) * 2);
}

function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function format(value) {
    return Math.round(value * 100) / 100;
}
