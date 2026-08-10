import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    buildManufacturingPackage,
    createStoredZip,
    serializeSheetDxf,
    serializeSheetMachineSvg
} from '../wwwroot/js/manufacturing-pack.js';
import { createManifestFixture, readStoredZipEntries } from './helpers/fixtures.js';

const decode = bytes => new TextDecoder().decode(bytes);

test('production package is preflight-gated with no error override in the normal path', () => {
    const errorFinding = { code: 'TEST_ERROR', severity: 'error', partIds: ['panel_cp'], message: 'Unsafe geometry.' };
    assert.throws(
        () => buildManufacturingPackage(createManifestFixture(), [errorFinding]),
        error => error.code === 'PREFLIGHT_BLOCKED' && error.preflightResults[0] === errorFinding
    );
});

test('warnings require explicit acknowledgement before production packaging', () => {
    const warning = { code: 'REFERENCE_OPERATION_OMITTED', severity: 'warning', partIds: ['panel_cp'], message: 'Reference marks are omitted.' };
    assert.throws(
        () => buildManufacturingPackage(createManifestFixture(), [warning]),
        error => error.code === 'WARNING_ACKNOWLEDGEMENT_REQUIRED' && error.preflightResults[0] === warning
    );
    const acknowledged = buildManufacturingPackage(createManifestFixture(), [warning], { acknowledgeWarnings: true });
    assert.equal(acknowledged.summary.warnings, 1);
    assert.equal(acknowledged.summary.errors, 0);
});

test('manufacturing ZIP contains versioned manifests, grouped machine files, schedules, labels, and guidance', () => {
    const result = buildManufacturingPackage(createManifestFixture(), []);
    const paths = new Set(result.entries.map(entry => entry.path));
    const required = [
        'manifest/fabrication-manifest.json', 'manifest/nesting-plan.json', 'manifest/preflight-results.json',
        'project/project-document.json', 'machine/calibration-100mm.svg',
        'reports/bom.csv', 'reports/total-bom.csv', 'reports/total-bom.json', 'reports/cut-list.csv', 'reports/material-summary.csv',
        'reports/joint-schedule.csv', 'reports/fastener-schedule.csv', 'reports/operation-schedule.csv',
        'reports/preflight-report.html', 'assembly/assembly-guide.md', 'assembly/part-labels.svg',
        'drawings/annotated-shop-layout.svg'
    ];
    required.forEach(path => assert.ok(paths.has(path), `missing ${path}`));
    assert.ok([...paths].some(path => /^machine\/mdf-18\/sheet-\d\d\.svg$/.test(path)));
    assert.ok([...paths].some(path => /^machine\/mdf-18\/sheet-\d\d\.dxf$/.test(path)));
    assert.equal(result.summary.parts, 4);
    assert.equal(result.summary.errors, 0);
    assert.equal(result.summary.files, result.entries.length);
    assert.equal(result.summary.totalBomCost, result.summary.materialCost + result.summary.hardwareCost);
});

test('total BOM combines costed stock and BOM-only electronics', () => {
    const result = buildManufacturingPackage(createManifestFixture(), [], {
        currencyCode: 'GBP',
        additionalHardware: [{ id: 'pc', name: 'Mini PC', category: 'electronics', quantity: 1, unitPrice: 200 }]
    });
    const totalBom = result.entries.find(entry => entry.path === 'reports/total-bom.csv')?.data || '';
    assert.match(totalBom, /Sheet material/);
    assert.match(totalBom, /Additional component,pc,Mini PC,1,each,200,200,GBP/);
    assert.equal(result.procurementBom.summary.hardwareCost, 200);
    assert.equal(result.summary.totalBomCost, result.summary.materialCost + 200);
});

test('package currency is consistent and fallback recovery keeps procurement settings', () => {
    const result = buildManufacturingPackage(createManifestFixture(), [], {
        currencyCode: 'USD',
        workshopProfile: { id: 'uk-shop', currency: 'GBP' },
        quote: { quoteNumber: 'CC-USD-001' },
        hardwareCosts: { button: { unitPrice: 3.5, supplier: 'Parts Inc' } },
        additionalHardware: [{ id: 'pc', name: 'Mini PC', quantity: 1, unitPrice: 200 }]
    });
    const quote = JSON.parse(result.entries.find(entry => entry.path === 'reports/quote.json').data);
    const recovery = JSON.parse(result.entries.find(entry => entry.path === 'project/project-document.json').data);

    assert.equal(result.procurementBom.currency, 'USD');
    assert.equal(quote.currency, 'USD');
    assert.equal(recovery.fabricationSettings.currencyCode, 'USD');
    assert.equal(recovery.fabricationSettings.hardwareCosts.button.unitPrice, 3.5);
    assert.equal(recovery.fabricationSettings.additionalHardware[0].name, 'Mini PC');
});

test('machine SVG uses explicit mm, matching viewBox, operation groups, precision, and no annotations', () => {
    const result = buildManufacturingPackage(createManifestFixture(), []);
    const sheet = result.nesting.sheets[0];
    const svg = serializeSheetMachineSvg(result.manifest, sheet, { precision: 3 });
    assert.match(svg, new RegExp(`width="${sheet.widthMm}mm" height="${sheet.heightMm}mm" viewBox="0 0 ${sheet.widthMm} ${sheet.heightMm}"`));
    const order = ['PROFILE_CUT', 'THROUGH_CUT', 'DRILL', 'POCKET', 'ENGRAVE'].map(id => svg.indexOf(`id="${id}"`));
    assert.ok(order.every(index => index >= 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.doesNotMatch(svg, /<text\b|<title\b|REFERENCE|font-family|background/i);
    assert.match(svg, /<polygon\b[^>]*\/>/);
    assert.match(svg, /<circle\b[^>]*\/>/);
});

test('DXF declares millimetres and emits closed operation-aware vectors without annotations', () => {
    const result = buildManufacturingPackage(createManifestFixture(), []);
    const dxf = serializeSheetDxf(result.manifest, result.nesting.sheets[0], { precision: 3 });
    assert.match(dxf, /\$INSUNITS\n70\n4/);
    assert.match(dxf, /0\nLWPOLYLINE\n8\nPROFILE_CUT/);
    assert.match(dxf, /90\n5\n70\n1/);
    assert.match(dxf, /0\nCIRCLE\n8\nTHROUGH_CUT/);
    assert.doesNotMatch(dxf, /\nTEXT\n|\nMTEXT\n|REFERENCE/);
    assert.match(dxf, /0\nEOF\n$/);
});

test('100 x 100 mm calibration contour is byte-for-byte golden', async () => {
    const result = buildManufacturingPackage(createManifestFixture(), []);
    const actual = result.entries.find(entry => entry.path === 'machine/calibration-100mm.svg').data.trim();
    const expected = (await readFile(new URL('./fixtures/calibration-100mm.golden.svg', import.meta.url), 'utf8')).trim();
    assert.equal(actual, expected);
    assert.match(actual, /<rect x="10" y="10" width="100" height="100"\/>/);
});

test('stored ZIP bytes have valid local/central/end records and preserve entry data', () => {
    const entries = [
        { path: 'hello.txt', data: 'Cabinet Crafter' },
        { path: 'nested/metric-µm.txt', data: new Uint8Array([0, 1, 2, 255]) }
    ];
    const bytes = createStoredZip(entries);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034b50);
    assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
    const unpacked = readStoredZipEntries(bytes);
    assert.equal(decode(unpacked.get('hello.txt')), 'Cabinet Crafter');
    assert.deepEqual([...unpacked.get('nested/metric-µm.txt')], [0, 1, 2, 255]);
    const signatureBytes = [...bytes].reduce((count, _, index) => (
        index + 4 <= bytes.length && view.getUint32(index, true) === 0x02014b50 ? count + 1 : count
    ), 0);
    assert.equal(signatureBytes, entries.length);
});

test('package base64 resolves to the exact ZIP bytes and remains stable', () => {
    const result = buildManufacturingPackage(createManifestFixture(), []);
    const first = result.base64;
    assert.equal(result.base64, first);
    assert.deepEqual(Buffer.from(first, 'base64'), Buffer.from(result.zipBytes));
});

test('generated ZIP opens to the same paths and manifest content advertised by the package', () => {
    const result = buildManufacturingPackage(createManifestFixture('barstool'), []);
    const unpacked = readStoredZipEntries(result.zipBytes);
    assert.deepEqual(new Set(unpacked.keys()), new Set(result.entries.map(entry => entry.path)));
    const manifest = JSON.parse(decode(unpacked.get('manifest/fabrication-manifest.json')));
    assert.equal(manifest.schema, 'CabinetCrafter.FabricationManifestV1');
    assert.equal(manifest.project.presetId, 'barstool');
    assert.equal(JSON.parse(decode(unpacked.get('manifest/nesting-plan.json'))).units, 'mm');
    assert.match(decode(unpacked.get('reports/bom.csv')), /Part ID,Name,Quantity,Material,Thickness mm/);
});
