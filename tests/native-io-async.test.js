import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hostSource = readFileSync(new URL('../MainWindow.xaml.cs', import.meta.url), 'utf8');

function methodSource(name, nextName) {
    const methodPattern = method => new RegExp(`\\n\\s*private[^\\n]*\\b${method}\\s*\\(`);
    const startMatch = methodPattern(name).exec(hostSource);
    const start = startMatch?.index ?? -1;
    const remainder = start >= 0 && nextName ? hostSource.slice(start + 1) : '';
    const endMatch = nextName ? methodPattern(nextName).exec(remainder) : null;
    const end = endMatch ? start + 1 + endMatch.index : hostSource.length;
    assert.ok(start >= 0, `Missing method ${name}`);
    assert.ok(end > start, `Could not bound method ${name}`);
    return hostSource.slice(start, end);
}

test('large native request paths dispatch to asynchronous operations', () => {
    for (const request of [
        'project.open',
        'project.openRecent',
        'project.save',
        'project.saveAs',
        'project.recovery.write',
        'project.recovery.list',
        'project.recovery.read',
        'project.recovery.delete',
        'project.autosave.write',
        'project.autosave.read',
        'project.autosave.clear',
        'export.saveText',
        'export.saveBinary'
    ]) {
        assert.match(hostSource, new RegExp(`"${request.replaceAll('.', '\\.') }"\\s*=>\\s*await`));
    }
    assert.doesNotMatch(hostSource, /\.Result\b|\.Wait\(/);
});

test('project dialogs remain before asynchronous I/O and state commits remain after it', () => {
    const open = methodSource('OpenProjectCandidateAsync', 'OpenRecentProjectCandidateAsync');
    assert.ok(open.indexOf('dialog.ShowDialog(this)') < open.indexOf('await CreateProjectCandidateAsync'));

    const save = methodSource('SaveProjectAsync', 'StartNewProject');
    assert.ok(save.indexOf('ShowSaveDialog(dialog)') < save.indexOf('await WriteUtf8AtomicallyAsync'));
    assert.ok(save.indexOf('await WriteUtf8AtomicallyAsync') < save.indexOf('currentProjectPath = targetPath'));
    assert.ok(save.indexOf('currentProjectDirty = false') < save.indexOf('UpdateWindowTitle()'));

    const textExport = methodSource('SaveTextExportAsync', 'SaveBinaryExportAsync');
    assert.ok(textExport.indexOf('dialog.ShowDialog(this)') < textExport.indexOf('await WriteUtf8AtomicallyAsync'));
});

test('UTF-8 reads and writes are asynchronous, size-bounded, and atomically committed', () => {
    const read = methodSource('ReadUtf8FileAsync', 'ResolveExistingSourcePathAsync');
    assert.match(read, /FileOptions\.Asynchronous\s*\|\s*FileOptions\.SequentialScan/);
    assert.match(read, /ReadToEndAsync\(cancellationToken\)/);
    assert.match(read, /fileState\.Length\s*>\s*maximumBytes/);
    assert.match(read, /actualBytes\s*>\s*maximumBytes/);

    const write = methodSource('WriteUtf8AtomicallyAsync', 'WriteBase64AtomicallyAsync');
    assert.match(write, /File\.WriteAllTextAsync\(temporaryPath,\s*content,\s*Utf8NoBom,\s*cancellationToken\)/);
    assert.match(write, /File\.Move\(temporaryPath,\s*path,\s*true\)/);
    assert.match(write, /finally[\s\S]*?DeleteTemporaryFileAsync/);
    assert.doesNotMatch(hostSource, /File\.ReadAllText\(|File\.WriteAllText\(|File\.WriteAllBytes\(/);
});

test('binary export decodes through bounded pooled buffers instead of a full byte array', () => {
    const binary = methodSource('WriteBase64AtomicallyAsync', 'DeleteTemporaryFileAsync');
    assert.match(binary, /inputBufferSize\s*=\s*64\s*\*\s*1024/);
    assert.match(binary, /ArrayPool<byte>\.Shared\.Rent/);
    assert.match(binary, /FromBase64Transform\(FromBase64TransformMode\.IgnoreWhiteSpaces\)/);
    assert.match(binary, /TransformBlock/);
    assert.match(binary, /TransformFinalBlock/);
    assert.match(binary, /totalBytes\s*>\s*maximumBytes/);
    assert.match(binary, /FileOptions\.Asynchronous\s*\|\s*FileOptions\.SequentialScan/);
    assert.doesNotMatch(hostSource, /Convert\.FromBase64String/);
    assert.match(hostSource, /ValidateBase64Payload\(base64,\s*cancellationToken\)/);
    assert.match(hostSource, /paddingCount\s*>\s*2/);
});

test('recovery ordering and lifecycle cancellation contracts are explicit', () => {
    assert.match(hostSource, /recoveryIoGate\.WaitAsync\(cancellationToken\)/);
    assert.match(hostSource, /recentProjectsIoGate\.WaitAsync\(cancellationToken\)/);
    assert.match(hostSource, /JsonDocument\.ParseAsync\(stream,\s*cancellationToken:\s*cancellationToken\)/);
    assert.match(hostSource, /"saveForClose",\s*allowLongRunning:\s*true/);
    assert.match(hostSource, /allowLongRunning[\s\S]*?WaitForLongRunningLifecycleCommandAsync\(completion\.Task\)/);
    assert.match(hostSource, /completion\.WaitAsync\([\s\S]*?LifecycleSaveCompletionTimeout/);
    assert.match(hostSource, /catch \(TimeoutException\) when \(nativeFileDialogOpen\)/);
    assert.match(hostSource, /OperationCanceledException[\s\S]*?windowLifetimeCancellation\.IsCancellationRequested/);
});
