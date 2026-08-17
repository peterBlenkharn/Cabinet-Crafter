import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assertEndUserPublish,
    REQUIRED_APPLICATION_FILES,
    REQUIRED_WEB_ASSETS
} from './publish-smoke.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readRepositoryFile(relativePath) {
    return readFile(join(repositoryRoot, relativePath), 'utf8');
}

async function makeSyntheticRelease() {
    const root = await mkdtemp(join(tmpdir(), 'cabinet-crafter-release-'));
    for (const relativePath of REQUIRED_APPLICATION_FILES) {
        const destination = join(root, relativePath);
        await mkdir(dirname(destination), { recursive: true });
        let content = '';
        if (relativePath === 'THIRD_PARTY_NOTICES.txt') {
            content = 'Three.js r160\nMicrosoft Edge WebView2 SDK 1.0.4022.49\nMicrosoft .NET 9 Runtime\n';
        }
        if (relativePath === 'THREEJS_LICENSE.txt') {
            content = 'The MIT License\nCopyright © 2010-2023 three.js authors\n';
        }
        if (relativePath === 'DOTNET_RUNTIME_PACKAGES.txt') {
            content = 'Microsoft.NETCore.App.Runtime.win-x64 9.0.18\nMicrosoft.WindowsDesktop.App.Runtime.win-x64 9.0.18\n';
        }
        if (relativePath === 'DOTNET_RUNTIME_LICENSE.txt'
            || relativePath === 'WINDOWS_DESKTOP_RUNTIME_LICENSE.txt') {
            content = 'The MIT License (MIT)\nCopyright (c) .NET Foundation and Contributors\n';
        }
        if (relativePath === 'DOTNET_RUNTIME_THIRD_PARTY_NOTICES.txt') {
            content = '.NET Runtime uses third-party libraries or other resources.\n';
        }
        if (relativePath === 'README.md') {
            content = '# Windows Release Guide\n\n## Install And Start\n\nPeter Blenkharn\nCumberlandQuail\nMIT License\n';
        }
        if (relativePath === 'LICENSE.txt') {
            content = 'MIT License\n\nCopyright (c) 2026 Peter Blenkharn (CumberlandQuail)\n';
        }
        if (relativePath === 'CabinetCrafter.deps.json') {
            content = JSON.stringify({
                runtimeTarget: { name: 'synthetic/win-x64' },
                targets: {
                    'synthetic/win-x64': {
                      'CabinetCrafter/2.0.0': {
                            dependencies: {
                                'Microsoft.Web.WebView2': '1.0.4022.49',
                                'runtimepack.Microsoft.NETCore.App.Runtime.win-x64': '9.0.18',
                                'runtimepack.Microsoft.WindowsDesktop.App.Runtime.win-x64': '9.0.18'
                            },
                            runtime: {
                                'CabinetCrafter.dll': {}
                            }
                        }
                    }
                }
            });
        }
        await writeFile(destination, content);
    }
    for (const relativePath of REQUIRED_WEB_ASSETS) {
        const destination = join(root, 'wwwroot', relativePath);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, relativePath === 'index.html' ? '<!doctype html><title>Test</title>' : '');
    }
    const manifestFiles = [
        ...REQUIRED_APPLICATION_FILES.filter(relativePath => relativePath !== 'RELEASE_MANIFEST.sha256'),
        ...REQUIRED_WEB_ASSETS.map(relativePath => `wwwroot/${relativePath}`)
    ].sort();
    const manifestLines = [];
    for (const relativePath of manifestFiles) {
        const content = await readFile(join(root, relativePath));
        manifestLines.push(`${createHash('sha256').update(content).digest('hex')}  ${relativePath}`);
    }
    await writeFile(
        join(root, 'RELEASE_MANIFEST.sha256'),
        `${manifestLines.join('\n')}\n`
    );
    return root;
}

test('release metadata identifies the author, publisher, version and MIT licence', async () => {
    const project = await readRepositoryFile('CabinetCrafter.csproj');
    assert.match(project, /<Authors>Peter Blenkharn<\/Authors>/);
    assert.match(project, /<Company>CumberlandQuail<\/Company>/);
    assert.match(project, /<PackageLicenseExpression>MIT<\/PackageLicenseExpression>/);
    assert.match(project, /<IsPackable>false<\/IsPackable>/);
    assert.match(project, /<Version>2\.0\.0<\/Version>/);
    assert.match(project, /<RestorePackagesWithLockFile>true<\/RestorePackagesWithLockFile>/);
    assert.match(project, /<PublishTrimmed>false<\/PublishTrimmed>/);
    assert.match(project, /<Content Include="wwwroot\\\*\*\\\*">[\s\S]*<CopyToPublishDirectory>Always<\/CopyToPublishDirectory>/);

    const packageMetadata = JSON.parse(await readRepositoryFile('package.json'));
    assert.equal(packageMetadata.author, 'Peter Blenkharn (CumberlandQuail)');
    assert.equal(packageMetadata.license, 'MIT');
    assert.equal(packageMetadata.version, '2.0.0');

    const licence = await readRepositoryFile('LICENSE');
    assert.match(licence, /^MIT License/m);
    assert.match(licence, /Copyright \(c\) 2026 Peter Blenkharn/);
});

test('Windows executable, window and browser shell use the application icon', async () => {
    const project = await readRepositoryFile('CabinetCrafter.csproj');
    const window = await readRepositoryFile('MainWindow.xaml');
    const index = await readRepositoryFile('wwwroot/index.html');
    assert.match(project, /<ApplicationIcon>assets\\cabinet-crafter\.ico<\/ApplicationIcon>/);
    assert.match(project, /<Resource Include="assets\\cabinet-crafter\.ico"\s*\/>/);
    assert.match(window, /Icon="assets\/cabinet-crafter\.ico"/);
    assert.match(index, /<link rel="icon" href="assets\/cabinet-crafter-icon\.svg"/);

    const icon = await readFile(join(repositoryRoot, 'assets', 'cabinet-crafter.ico'));
    assert.equal(icon.readUInt16LE(0), 0);
    assert.equal(icon.readUInt16LE(2), 1);
    assert.ok(icon.readUInt16LE(4) >= 7);
});

test('release automation is versioned, rooted, checked and tag driven', async () => {
    const buildScript = await readRepositoryFile('tools/build-release.ps1');
    const buildCommand = await readRepositoryFile('tools/build-release.cmd');
    assert.match(buildScript, /CabinetCrafter-\$version-\$Runtime/);
    assert.match(buildScript, /CreateFromDirectory\([\s\S]*\$true\)/);
    assert.match(buildScript, /Get-FileHash[\s\S]*SHA256/);
    assert.match(buildScript, /DOTNET_RUNTIME_LICENSE\.txt/);
    assert.match(buildScript, /DOTNET_RUNTIME_THIRD_PARTY_NOTICES\.txt/);
    assert.match(buildScript, /WINDOWS_DESKTOP_RUNTIME_LICENSE\.txt/);
    assert.match(buildScript, /DOTNET_RUNTIME_PACKAGES\.txt/);
    assert.match(buildScript, /packages\.lock\.json[\s\S]*Microsoft\.Web\.WebView2/);
    assert.match(buildScript, /WEBVIEW2_THIRD_PARTY_NOTICES\.txt/);
    assert.match(buildScript, /Write-ReleaseManifest/);
    assert.match(buildScript, /RELEASE_MANIFEST\.sha256/);
    assert.match(buildCommand, /-ExecutionPolicy Bypass -File/);

    const workflow = await readRepositoryFile('.github/workflows/release.yml');
    assert.match(workflow, /tags:/);
    assert.match(workflow, /permissions:\s*\n\s*contents: read/);
    assert.match(workflow, /fetch-depth: 0/);
    assert.match(workflow, /Confirm annotated tag belongs to main[\s\S]*merge-base --is-ancestor/);
    assert.match(workflow, /package\.json version[\s\S]*does not match project version/);
    assert.match(workflow, /Build staged portable release[\s\S]*Run packaged application startup smoke[\s\S]*Generate SPDX software bill of materials[\s\S]*Archive the verified staged release/);
    assert.match(workflow, /anchore\/sbom-action/);
    assert.match(workflow, /Upload verified release assets[\s\S]*publish-release:[\s\S]*needs: build-and-verify/);
    assert.match(workflow, /environment:\s*\n\s*name: release/);
    assert.match(workflow, /publish-release:[\s\S]*permissions:\s*\n\s*actions: read\s*\n\s*contents: write/);
    assert.match(workflow, /actions\/download-artifact/);
    assert.match(workflow, /sha256sum --check "\$\{package\}\.zip\.sha256"[\s\S]*sha256sum --check "\$\{package\}\.spdx\.json\.sha256"/);
    assert.match(workflow, /gh release create[\s\S]*--verify-tag[\s\S]*--generate-notes/);
    assert.match(workflow, /intentionally unsigned portable Windows x64 build/);
    assert.doesNotMatch(workflow, /Authenticode|signtool|WINDOWS_SIGNING|\.pfx|softprops\/action-gh-release/i);
    assert.match(workflow, /--integration-smoke-test/);
    assert.match(workflow, /WaitForExit\(60000\)/);

    const ciWorkflow = await readRepositoryFile('.github/workflows/ci.yml');
    assert.match(ciWorkflow, /--integration-smoke-test/);
    assert.match(ciWorkflow, /WaitForExit\(60000\)/);
    for (const [name, source] of [['release', workflow], ['CI', ciWorkflow]]) {
        const actionReferences = [...source.matchAll(/uses:\s*([^\s#]+)/g)].map(match => match[1]);
        assert.ok(actionReferences.length > 0, `${name} workflow must use at least one action`);
        for (const reference of actionReferences) {
            assert.match(reference, /@[0-9a-f]{40}$/, `${name} action must use a full commit SHA: ${reference}`);
        }
    }

    const codeOwners = await readRepositoryFile('.github/CODEOWNERS');
    assert.match(codeOwners, /^\/\.github\/\s+@peterBlenkharn$/m);
    assert.match(codeOwners, /^\/tools\/build-release\.ps1\s+@peterBlenkharn$/m);

    const dependabot = await readRepositoryFile('.github/dependabot.yml');
    assert.match(dependabot, /package-ecosystem:\s*github-actions/);
    assert.match(dependabot, /package-ecosystem:\s*nuget/);
});

test('clean-package validation accepts a complete release and rejects debug or undeclared files', async () => {
    const root = await makeSyntheticRelease();
    try {
        const result = await assertEndUserPublish(root);
        assert.equal(result.applicationFileCount, REQUIRED_APPLICATION_FILES.length);
        assert.equal(result.releaseManifest.entryCount, result.releaseFileCount - 1);
        assert.equal(basename(result.root), basename(root));

        await writeFile(join(root, 'CabinetCrafter.pdb'), 'debug');
        await assert.rejects(
            assertEndUserPublish(root),
            /source or debug files: CabinetCrafter\.pdb/
        );

        await rm(join(root, 'CabinetCrafter.pdb'));
        await writeFile(join(root, 'developer-notes.txt'), 'not for the end user');
        await assert.rejects(
            assertEndUserPublish(root),
            /undeclared files: developer-notes\.txt/
        );

        await rm(join(root, 'developer-notes.txt'));
        await writeFile(join(root, 'wwwroot', 'developer-notes.txt'), 'not for the end user');
        await assert.rejects(
            assertEndUserPublish(root),
            /wwwroot contains undeclared files: developer-notes\.txt/
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('clean-package validation rejects a release changed after its manifest was written', async () => {
    const root = await makeSyntheticRelease();
    try {
        await writeFile(join(root, 'wwwroot', 'style.css'), 'tampered');
        await assert.rejects(
            assertEndUserPublish(root),
            /Release manifest hash mismatch: wwwroot\/style\.css/
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('end-user release documents avoid internal implementation notes', async () => {
    for (const relativePath of [
        'docs/RELEASE_GUIDE.md',
        'docs/PRIVACY_AND_OFFLINE.md',
        'docs/BEFORE_YOU_CUT.md'
    ]) {
        const content = await readRepositoryFile(relativePath);
        assert.doesNotMatch(content, /\bTODO\b|\bFIXME\b|for the developer|developer note/i);
        assert.doesNotMatch(content, /\u2014/);
        assert.doesNotMatch(content, /^Status:|^Last updated:/m);
    }
});

test('end-user release guide provides an exact checksum verification command', async () => {
    const guide = await readRepositoryFile('docs/RELEASE_GUIDE.md');
    assert.match(guide, /Get-FileHash[\s\S]*-Algorithm SHA256/);
    assert.match(guide, /\$actual\s+-ne\s+\$expected/);
    assert.match(guide, /Checksum mismatch/);
    assert.match(guide, /Source code \(zip\)[\s\S]*repository source, not the built Windows application/);
    assert.match(guide, /does not prove the publisher's identity/);
    assert.match(guide, /Official Cabinet Crafter Windows releases are currently unsigned/);
    assert.match(guide, /Unknown publisher[\s\S]*Microsoft Defender SmartScreen warning/);
    assert.match(guide, /official Microsoft WebView2 page/);
    assert.match(guide, /Copyright \(c\) 2026 Peter Blenkharn/);
    assert.match(guide, /CumberlandQuail is the project publishing label/);
    assert.match(guide, /MIT License/);
});
