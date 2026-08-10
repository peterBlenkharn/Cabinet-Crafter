import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const textExtensions = new Set([
    '.cmd',
    '.cs',
    '.csproj',
    '.css',
    '.html',
    '.js',
    '.json',
    '.md',
    '.mjs',
    '.ps1',
    '.svg',
    '.xaml',
    '.yaml',
    '.yml'
]);

function collectTextFiles(target) {
    const absoluteTarget = path.join(repositoryRoot, target);
    if (!fs.existsSync(absoluteTarget)) return [];
    if (fs.statSync(absoluteTarget).isFile()) return [absoluteTarget];

    return fs.readdirSync(absoluteTarget, { withFileTypes: true })
        .flatMap(entry => collectTextFiles(path.join(target, entry.name)))
        .filter(filePath => textExtensions.has(path.extname(filePath).toLowerCase()));
}

test('shipped application copy and documentation contain no em dashes', () => {
    const files = [
        ...collectTextFiles('.github'),
        ...collectTextFiles('assets'),
        ...collectTextFiles('wwwroot'),
        ...collectTextFiles('docs'),
        ...collectTextFiles('tests'),
        ...collectTextFiles('tools'),
        ...[
            'README.md',
            'SECURITY.md',
            'THIRD_PARTY_NOTICES.md',
            '.gitignore',
            'LICENSE',
            'App.xaml',
            'App.xaml.cs',
            'AssemblyInfo.cs',
            'CabinetCrafter.csproj',
            'global.json',
            'MainWindow.xaml',
            'MainWindow.xaml.cs',
            'package.json',
            'packages.lock.json'
        ].map(file => path.join(repositoryRoot, file))
    ];
    const forbiddenForms = [
        String.fromCodePoint(0x2014),
        `&${'mdash'};`,
        `&#${8212};`,
        `&#x${(0x2014).toString(16)};`,
        String.fromCodePoint(0x00e2, 0x20ac, 0x201d)
    ];
    const findings = files
        .filter(filePath => {
            const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
            return forbiddenForms.some(form => content.includes(form));
        })
        .map(filePath => path.relative(repositoryRoot, filePath));

    assert.deepEqual(findings, []);
});

test('end-user deliverable contains no vestigial developer-only notes', () => {
    const files = [
        ...collectTextFiles('wwwroot')
            .filter(filePath => !filePath.includes(`${path.sep}js${path.sep}lib${path.sep}`)),
        ...[
            'docs/RELEASE_GUIDE.md',
            'docs/PRIVACY_AND_OFFLINE.md',
            'docs/BEFORE_YOU_CUT.md'
        ].map(file => path.join(repositoryRoot, file))
    ];
    const forbidden = /\bTODO\b|\bFIXME\b|developer note|for the developer|do not ship|implementation plan/i;
    const findings = files
        .filter(filePath => forbidden.test(fs.readFileSync(filePath, 'utf8')))
        .map(filePath => path.relative(repositoryRoot, filePath));

    assert.deepEqual(findings, []);
});
