import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { posix, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_WEB_ASSETS = [
    'index.html',
    'style.css',
    'assets/cabinet-crafter-icon.svg',
    'js/app.js',
    'js/ui.js',
    'js/side-profile.js',
    'js/side-profile-editor.js',
    'js/guided-tutorial.js',
    'js/help-registry.js',
    'js/help-system.js',
    'js/status-service.js',
    'js/workspace-shell.js',
    'js/dummy.js',
    'js/dummy-layout.js',
    'js/cabinet.js',
    'js/fabrication.js',
    'js/export.js',
    'js/project-document.js',
    'js/materials.js',
    'js/procurement.js',
    'js/nesting.js',
    'js/nesting-worker.js',
    'js/hardware-library.js',
    'js/arcade-intelligence.js',
    'js/assembly.js',
    'js/ergonomics.js',
    'js/joinery.js',
    'js/artwork-production.js',
    'js/manufacturing-pack.js',
    'js/manifest-utils.js',
    'js/maker-workflow.js',
    'js/workshop.js',
    'js/lib/three.module.js',
    'js/lib/orbit-controls.js'
];

export const REQUIRED_APPLICATION_FILES = [
    'CabinetCrafter.exe',
    'CabinetCrafter.dll',
    'CabinetCrafter.deps.json',
    'CabinetCrafter.runtimeconfig.json',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.Wpf.dll',
    'WebView2Loader.dll',
    'LICENSE.txt',
    'THIRD_PARTY_NOTICES.txt',
    'THREEJS_LICENSE.txt',
    'DOTNET_RUNTIME_PACKAGES.txt',
    'DOTNET_RUNTIME_LICENSE.txt',
    'DOTNET_RUNTIME_THIRD_PARTY_NOTICES.txt',
    'WINDOWS_DESKTOP_RUNTIME_LICENSE.txt',
    'WEBVIEW2_LICENSE.txt',
    'WEBVIEW2_THIRD_PARTY_NOTICES.txt',
    'RELEASE_MANIFEST.sha256',
    'README.md',
    'PRIVACY_AND_OFFLINE.md',
    'BEFORE_YOU_CUT.md'
];

export const SOURCE_ONLY_ENTRIES = [
    '.git',
    '.github',
    '.agents',
    'docs',
    'tests',
    'tools',
    'SECURITY.md',
    'THIRD_PARTY_NOTICES.md',
    'CabinetCrafter.csproj',
    'global.json',
    'packages.lock.json',
    'package.json'
];

export const FORBIDDEN_RELEASE_EXTENSIONS = new Set([
    '.cs',
    '.csproj',
    '.map',
    '.pdb',
    '.sln',
    '.suo',
    '.user'
]);

async function listFiles(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...await listFiles(join(directory, entry.name), relativePath));
        } else {
            files.push(relativePath);
        }
    }
    return files;
}

function normalizePath(relativePath) {
    return relativePath.replaceAll('\\', '/').replace(/^\.?\//, '');
}

function readImportMap(index) {
    const match = index.match(/<script\b[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return {};
    try {
        return JSON.parse(match[1])?.imports || {};
    } catch (error) {
        throw new Error(`Published import map is invalid JSON: ${error.message}`);
    }
}

function collectModuleSpecifiers(source) {
    const specifiers = new Set();
    const patterns = [
        /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
        /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
    }
    return [...specifiers];
}

function resolveModuleSpecifier(importer, specifier, importMap) {
    if (/^(?:https?:|data:|blob:)/i.test(specifier)) return null;

    let target = specifier;
    let importMapTarget = false;
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        target = importMap[specifier];
        importMapTarget = Boolean(target);
        if (!target) {
            const prefix = Object.keys(importMap)
                .filter(key => key.endsWith('/') && specifier.startsWith(key))
                .sort((left, right) => right.length - left.length)[0];
            if (prefix) {
                target = `${importMap[prefix]}${specifier.slice(prefix.length)}`;
                importMapTarget = true;
            }
        }
        if (!target) {
            throw new Error(`Published module ${importer} uses unmapped bare import: ${specifier}`);
        }
    }

    if (/^(?:https?:|data:|blob:)/i.test(target)) return null;
    const webPath = posix.normalize(
        target.startsWith('/')
            ? target.slice(1)
            : importMapTarget
                ? target.replace(/^\.\//, '')
            : posix.join(posix.dirname(importer), target)
    );
    if (webPath === '..' || webPath.startsWith('../') || posix.isAbsolute(webPath)) {
        throw new Error(`Published module ${importer} imports outside wwwroot: ${specifier}`);
    }
    return normalizePath(webPath);
}

async function verifyModuleGraph(webRoot, index, referencedScripts, declaredAssets) {
    const importMap = readImportMap(index);
    const declared = new Set(declaredAssets.map(normalizePath));
    const queue = referencedScripts
        .map(source => source.replace(/^\.\//, '').split(/[?#]/, 1)[0])
        .filter(source => source.toLowerCase().endsWith('.js'));
    const visited = new Set();

    while (queue.length) {
        const importer = normalizePath(queue.shift());
        if (visited.has(importer)) continue;
        visited.add(importer);
        if (!declared.has(importer)) {
            throw new Error(`Published module graph contains an undeclared entry: ${importer}`);
        }

        const source = await readFile(join(webRoot, importer), 'utf8');
        for (const specifier of collectModuleSpecifiers(source)) {
            const dependency = resolveModuleSpecifier(importer, specifier, importMap);
            if (!dependency) continue;
            if (!declared.has(dependency)) {
                throw new Error(`Published module ${importer} depends on undeclared asset: ${dependency}`);
            }
            await access(join(webRoot, dependency), constants.R_OK);
            if (dependency.toLowerCase().endsWith('.js')) queue.push(dependency);
        }
    }

    return [...visited].sort();
}

async function verifyReleaseManifest(root, releaseFiles) {
    const manifestName = 'RELEASE_MANIFEST.sha256';
    const manifest = await readFile(join(root, manifestName), 'utf8');
    const entries = new Map();

    for (const [index, line] of manifest.split(/\r?\n/).entries()) {
        if (!line) continue;
        const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
        if (!match) throw new Error(`Release manifest line ${index + 1} is invalid.`);
        const relativePath = normalizePath(match[2]);
        if (relativePath !== match[2]
            || relativePath === manifestName
            || relativePath === '..'
            || relativePath.startsWith('../')
            || posix.isAbsolute(relativePath)) {
            throw new Error(`Release manifest contains an unsafe path: ${match[2]}`);
        }
        if (entries.has(relativePath)) {
            throw new Error(`Release manifest contains a duplicate path: ${relativePath}`);
        }
        entries.set(relativePath, match[1]);
    }

    const expectedFiles = releaseFiles
        .map(normalizePath)
        .filter(relativePath => relativePath !== manifestName)
        .sort();
    const declaredFiles = [...entries.keys()].sort();
    if (JSON.stringify([...entries.keys()]) !== JSON.stringify(declaredFiles)) {
        throw new Error('Release manifest paths are not in deterministic ordinal order.');
    }
    const missing = expectedFiles.filter(relativePath => !entries.has(relativePath));
    const unexpected = declaredFiles.filter(relativePath => !expectedFiles.includes(relativePath));
    if (missing.length || unexpected.length) {
        throw new Error(
            `Release manifest coverage is invalid. Missing: ${missing.join(', ') || 'none'}. `
            + `Unexpected: ${unexpected.join(', ') || 'none'}.`
        );
    }

    for (const relativePath of expectedFiles) {
        const content = await readFile(join(root, relativePath));
        const actual = createHash('sha256').update(content).digest('hex');
        if (actual !== entries.get(relativePath)) {
            throw new Error(`Release manifest hash mismatch: ${relativePath}`);
        }
    }

    return { entryCount: entries.size };
}

function readDeclaredRuntimeFiles(deps) {
    const targetName = deps?.runtimeTarget?.name;
    const target = targetName ? deps?.targets?.[targetName] : null;
    if (!target || typeof target !== 'object') {
        throw new Error('Published CabinetCrafter.deps.json does not define its runtime target.');
    }

    const paths = new Set();
    const assemblyNames = new Set();
    for (const dependency of Object.values(target)) {
        for (const sectionName of ['runtime', 'native']) {
            for (const relativePath of Object.keys(dependency?.[sectionName] || {})) {
                const normalized = normalizePath(relativePath);
                paths.add(normalized);
                paths.add(normalized.split('/').at(-1));
                if (normalized.toLowerCase().endsWith('.dll')) {
                    assemblyNames.add(normalized.split('/').at(-1).slice(0, -4));
                }
            }
        }
    }
    const applicationNode = Object.entries(target)
        .find(([name]) => name.startsWith('CabinetCrafter/'))?.[1];
    const applicationDependencies = applicationNode?.dependencies;
    if (!applicationDependencies || typeof applicationDependencies !== 'object') {
        throw new Error('Published CabinetCrafter.deps.json does not declare application dependencies.');
    }
    return { paths, assemblyNames, applicationDependencies };
}

function isDeclaredSatelliteResource(relativePath, assemblyNames) {
    const segments = normalizePath(relativePath).split('/');
    if (segments.length !== 2 || !/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(segments[0])) return false;
    const match = /^(.*)\.resources\.dll$/i.exec(segments[1]);
    return Boolean(match && assemblyNames.has(match[1]));
}

export async function assertPublishedAssets(publishDirectory) {
    const root = resolve(publishDirectory);
    const webRoot = join(root, 'wwwroot');
    const missing = [];
    await Promise.all(REQUIRED_WEB_ASSETS.map(async relativePath => {
        try {
            await access(join(webRoot, relativePath), constants.R_OK);
        } catch {
            missing.push(relativePath);
        }
    }));
    if (missing.length) throw new Error(`Published wwwroot is missing: ${missing.sort().join(', ')}`);

    const index = await readFile(join(webRoot, 'index.html'), 'utf8');
    const referencedScripts = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)]
        .map(match => match[1])
        .filter(source => !/^(?:https?:)?\/\//i.test(source));
    for (const source of referencedScripts) {
        const localPath = source.replace(/^\.\//, '').split(/[?#]/, 1)[0];
        await access(join(webRoot, localPath), constants.R_OK);
    }
    const moduleAssets = await verifyModuleGraph(webRoot, index, referencedScripts, REQUIRED_WEB_ASSETS);

    const publishedWebAssets = (await listFiles(webRoot)).map(normalizePath).sort();
    const declaredWebAssets = [...REQUIRED_WEB_ASSETS].map(normalizePath).sort();
    const unexpected = publishedWebAssets.filter(relativePath => !declaredWebAssets.includes(relativePath));
    if (unexpected.length) {
        throw new Error(`Published wwwroot contains undeclared files: ${unexpected.join(', ')}`);
    }

    return { root, webRoot, assetCount: REQUIRED_WEB_ASSETS.length, referencedScripts, moduleAssets };
}

export async function assertEndUserPublish(publishDirectory) {
    const assets = await assertPublishedAssets(publishDirectory);
    const missing = [];
    await Promise.all(REQUIRED_APPLICATION_FILES.map(async relativePath => {
        try {
            await access(join(assets.root, relativePath), constants.R_OK);
        } catch {
            missing.push(relativePath);
        }
    }));
    if (missing.length) throw new Error(`Published application is missing: ${missing.sort().join(', ')}`);

    const sourceOnly = [];
    await Promise.all(SOURCE_ONLY_ENTRIES.map(async relativePath => {
        try {
            await access(join(assets.root, relativePath), constants.F_OK);
            sourceOnly.push(relativePath);
        } catch {
            // Expected: source and contributor files are not part of the application package.
        }
    }));
    if (sourceOnly.length) throw new Error(`Published application contains source-only entries: ${sourceOnly.sort().join(', ')}`);

    const releaseFiles = await listFiles(assets.root);
    const forbiddenFiles = releaseFiles.filter(relativePath => {
        const extensionIndex = relativePath.lastIndexOf('.');
        const extension = extensionIndex >= 0 ? relativePath.slice(extensionIndex).toLowerCase() : '';
        return FORBIDDEN_RELEASE_EXTENSIONS.has(extension);
    });
    if (forbiddenFiles.length) {
        throw new Error(`Published application contains source or debug files: ${forbiddenFiles.sort().join(', ')}`);
    }

    const deps = JSON.parse(await readFile(join(assets.root, 'CabinetCrafter.deps.json'), 'utf8'));
    const declaredRuntime = readDeclaredRuntimeFiles(deps);
    const allowedFiles = new Set([
        ...REQUIRED_APPLICATION_FILES,
        ...REQUIRED_WEB_ASSETS.map(relativePath => `wwwroot/${normalizePath(relativePath)}`),
        ...declaredRuntime.paths
    ].map(normalizePath));
    const undeclaredFiles = releaseFiles.filter(relativePath => {
        const normalized = normalizePath(relativePath);
        return !allowedFiles.has(normalized)
            && !isDeclaredSatelliteResource(normalized, declaredRuntime.assemblyNames);
    });
    if (undeclaredFiles.length) {
        throw new Error(`Published application contains undeclared files: ${undeclaredFiles.sort().join(', ')}`);
    }
    const releaseManifest = await verifyReleaseManifest(assets.root, releaseFiles);

    const webViewVersion = declaredRuntime.applicationDependencies['Microsoft.Web.WebView2'];
    const coreRuntimeEntry = Object.entries(declaredRuntime.applicationDependencies)
        .find(([name]) => name.startsWith('runtimepack.Microsoft.NETCore.App.Runtime.'));
    const windowsDesktopEntry = Object.entries(declaredRuntime.applicationDependencies)
        .find(([name]) => name.startsWith('runtimepack.Microsoft.WindowsDesktop.App.Runtime.'));
    if (!webViewVersion || !coreRuntimeEntry || !windowsDesktopEntry) {
        throw new Error('Published dependency manifest is missing WebView2 or required .NET runtime-pack identities.');
    }

    const thirdPartySummary = await readFile(join(assets.root, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
    const dotnetMajor = String(coreRuntimeEntry[1]).split('.')[0];
    for (const expectedNotice of ['Three.js r160', `Microsoft Edge WebView2 SDK ${webViewVersion}`, `Microsoft .NET ${dotnetMajor} Runtime`]) {
        if (!thirdPartySummary.includes(expectedNotice)) {
            throw new Error(`Third-party summary is missing: ${expectedNotice}`);
        }
    }

    const runtimePackages = await readFile(join(assets.root, 'DOTNET_RUNTIME_PACKAGES.txt'), 'utf8');
    for (const [dependencyName, version] of [coreRuntimeEntry, windowsDesktopEntry]) {
        const packageIdentity = `${dependencyName.slice('runtimepack.'.length)} ${version}`;
        if (!runtimePackages.split(/\r?\n/).includes(packageIdentity)) {
            throw new Error(`Runtime package inventory is missing: ${packageIdentity}`);
        }
    }
    for (const [relativePath, requiredText] of [
        ['THREEJS_LICENSE.txt', 'Copyright © 2010-2023 three.js authors'],
        ['DOTNET_RUNTIME_LICENSE.txt', 'The MIT License'],
        ['DOTNET_RUNTIME_THIRD_PARTY_NOTICES.txt', '.NET Runtime uses third-party libraries'],
        ['WINDOWS_DESKTOP_RUNTIME_LICENSE.txt', 'The MIT License']
    ]) {
        const content = await readFile(join(assets.root, relativePath), 'utf8');
        if (!content.includes(requiredText)) {
            throw new Error(`Packaged upstream terms are invalid: ${relativePath}`);
        }
    }

    const endUserReadme = await readFile(join(assets.root, 'README.md'), 'utf8');
    if (!/^# Windows Release Guide$/m.test(endUserReadme)
        || !/^## Install And Start$/m.test(endUserReadme)) {
        throw new Error('Release README is not the end-user release guide.');
    }
    for (const requiredIdentity of ['Peter Blenkharn', 'CumberlandQuail', 'MIT License']) {
        if (!endUserReadme.includes(requiredIdentity)) {
            throw new Error(`Release README is missing release identity: ${requiredIdentity}`);
        }
    }
    if (/dotnet\s+(?:build|publish|restore)|tools[\\/]build-release/i.test(endUserReadme)) {
        throw new Error('Release README contains contributor build instructions.');
    }
    for (const relativePath of ['README.md', 'PRIVACY_AND_OFFLINE.md', 'BEFORE_YOU_CUT.md']) {
        const copy = await readFile(join(assets.root, relativePath), 'utf8');
        if (/\bTODO\b|\bFIXME\b|developer note|for the developer|\u2014/i.test(copy)) {
            throw new Error(`Release guidance contains internal or forbidden copy: ${relativePath}`);
        }
    }

    const licence = await readFile(join(assets.root, 'LICENSE.txt'), 'utf8');
    for (const requiredLicenceText of ['MIT License', 'Peter Blenkharn', 'CumberlandQuail']) {
        if (!licence.includes(requiredLicenceText)) {
            throw new Error(`Release licence is missing required text: ${requiredLicenceText}`);
        }
    }

    return {
        ...assets,
        releaseManifest,
        applicationFileCount: REQUIRED_APPLICATION_FILES.length,
        releaseFileCount: releaseFiles.length
    };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
    const publishDirectory = process.argv[2] || 'artifacts/publish';
    try {
        const result = await assertEndUserPublish(publishDirectory);
        process.stdout.write(`Publish smoke check passed: ${result.applicationFileCount} required application files, ${result.assetCount} web assets, ${result.releaseManifest.entryCount} verified hashes, and ${result.releaseFileCount} total release files in ${result.root}\n`);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
