import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hostSource = readFileSync(new URL('../MainWindow.xaml.cs', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.xaml.cs', import.meta.url), 'utf8');
const hostMarkup = readFileSync(new URL('../MainWindow.xaml', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../wwwroot/js/ui.js', import.meta.url), 'utf8');

test('native startup remains branded and recoverable until navigation succeeds', () => {
    assert.match(hostMarkup, /WindowState="Maximized"/);
    assert.match(hostMarkup, /x:Name="startupOverlay"/);
    assert.match(hostMarkup, /x:Name="startupProgress"[\s\S]*?IsIndeterminate="True"/);
    assert.match(hostMarkup, /x:Name="startupRetryButton"/);
    assert.match(hostMarkup, /x:Name="startupCopyDetailsButton"/);
    assert.match(hostSource, /navigationCompletion\.Task\.WaitAsync\([\s\S]*?StartupNavigationTimeout/);
    assert.match(hostSource, /if \(!navigation\.IsSuccess\)/);
    assert.match(hostSource, /CompleteStartup\(\);/);
    assert.match(hostSource, /private void CompleteStartup\(\)[\s\S]*?startupOverlay\.Visibility\s*=\s*Visibility\.Collapsed/);
    assert.doesNotMatch(
        hostSource.slice(hostSource.indexOf('private async Task InitializeAsync()'), hostSource.indexOf('private string? ResolveWwwrootPath()')),
        /MessageBox\.Show/
    );
});

test('integrated startup smoke exercises WebView2, the bridge, UI and renderer', () => {
    assert.match(appSource, /--integration-smoke-test[\s\S]*new MainWindow\(integrationSmokeTest\)/);
    assert.match(hostSource, /VerifyIntegratedWorkspaceAsync[\s\S]*ExecuteScriptAsync\(readinessScript\)/);
    assert.match(hostSource, /window\.chrome\?\.webview/);
    assert.match(hostSource, /window\.app\?\.uiManager/);
    assert.match(hostSource, /window\.app\?\.renderer\?\.domElement/);
    assert.match(hostSource, /document\.querySelector\('\.maker-nav'\)/);
});

test('native shell opens only an existing file or folder location', () => {
    assert.match(hostSource, /"shell\.openFolder"\s*=>\s*OpenContainingFolder\(payload\)/);
    const start = hostSource.indexOf('private static object OpenContainingFolder');
    const end = hostSource.indexOf('private async Task<object> ListRecoveryResponseAsync');
    const method = hostSource.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.match(method, /Directory\.Exists\(fullPath\)/);
    assert.match(method, /File\.Exists\(fullPath\)/);
    assert.match(method, /Path\.GetDirectoryName\(fullPath\)/);
    assert.match(method, /UseShellExecute\s*=\s*true/);
    assert.match(method, /throw new FileNotFoundException/);
});

test('native project open uses candidate, commit, and discard operations', () => {
    assert.match(hostSource, /"project\.open"\s*=>\s*await OpenProjectCandidateAsync/);
    assert.match(hostSource, /"project\.open\.commit"\s*=>\s*await CommitProjectCandidateAsync/);
    assert.match(hostSource, /"project\.open\.discard"\s*=>\s*DiscardProjectCandidate/);
    assert.match(hostSource, /pendingProjectCandidate\s*=\s*candidate/);
    assert.match(hostSource, /currentProjectPath\s*=\s*candidate\.Path/);
});

test('native lifecycle offers explicit save, discard, and cancel choices', () => {
    assert.match(hostSource, /Closing\s*\+=\s*MainWindow_Closing/);
    assert.match(hostSource, /ExecuteLifecycleCommandAsync\("prepareClose"\)/);
    assert.match(hostSource, /ExecuteLifecycleCommandAsync\("saveForClose",\s*allowLongRunning:\s*true\)/);
    assert.match(hostSource, /ExecuteLifecycleCommandAsync\("discardForClose"\)/);
    assert.match(hostMarkup, /x:Name="lifecyclePromptSaveButton"/);
    assert.match(hostMarkup, /x:Name="lifecyclePromptDiscardButton"/);
    assert.match(hostMarkup, /x:Name="lifecyclePromptCancelButton"/);
    assert.match(hostSource, /webView\.Visibility\s*=\s*Visibility\.Hidden;[\s\S]*?lifecyclePromptOverlay\.Visibility\s*=\s*Visibility\.Visible/);
    assert.match(hostSource, /lifecyclePromptOverlay\.Visibility\s*=\s*Visibility\.Collapsed;[\s\S]*?webView\.Visibility\s*=\s*Visibility\.Visible/);
});

test('native close handshake is bounded, message-driven, and disposes its WebView', () => {
    assert.match(hostSource, /kind == "cabinetLifecycleResponse"/);
    assert.match(hostSource, /Promise\.resolve\(hook\(\)\)\.then/);
    assert.match(hostSource, /WaitAsync\(LifecycleCommandTimeout, windowLifetimeCancellation\.Token\)/);
    assert.match(hostSource, /allowLongRunning[\s\S]*?WaitForLongRunningLifecycleCommandAsync\(completion\.Task\)/);
    assert.match(hostSource, /LifecycleSaveCompletionTimeout/);
    assert.match(hostSource, /catch \(TimeoutException\) when \(nativeFileDialogOpen\)/);
    assert.doesNotMatch(hostSource, /JSON\.stringify\(await window\.cabinetCrafterLifecycle/);
    assert.match(hostSource, /Closed\s*\+=\s*MainWindow_Closed/);
    assert.match(hostSource, /WebMessageReceived\s*-=/);
    assert.match(hostSource, /webView\.Dispose\(\)/);
    assert.match(hostSource, /Application\.Current\?\.Shutdown\(\)/);
});

test('native close defers its async handshake until the WPF closing transaction has unwound', () => {
    const closingHandler = hostSource.slice(
        hostSource.indexOf('private void MainWindow_Closing'),
        hostSource.indexOf('private async Task CompleteCloseHandshakeAsync')
    );
    assert.ok(closingHandler.length > 0);
    assert.match(hostSource, /private void MainWindow_Closing\(object\? sender, CancelEventArgs eventArgs\)/);
    assert.doesNotMatch(hostSource, /private async void MainWindow_Closing/);
    assert.match(closingHandler, /eventArgs\.Cancel\s*=\s*true;/);
    assert.match(closingHandler, /Dispatcher\.BeginInvoke\(new Action\(\(\) => _ = CompleteCloseHandshakeAsync\(\)\)\);/);
    assert.doesNotMatch(closingHandler, /await\s|ShowLifecyclePromptAsync/);
    assert.match(hostSource, /private async Task CompleteCloseHandshakeAsync\(\)[\s\S]*?ShowLifecyclePromptAsync/);
});

test('native close safely replaces an existing decision prompt and shows progress', () => {
    const closingHandler = hostSource.slice(
        hostSource.indexOf('private void MainWindow_Closing'),
        hostSource.indexOf('private async Task CompleteCloseHandshakeAsync')
    );
    assert.match(closingHandler, /lifecyclePromptCompletion is not null[\s\S]*?CompleteLifecyclePrompt\(LifecyclePromptChoice\.Cancel\)/);
    assert.match(hostSource, /ShowLifecycleProgress\("Closing Cabinet Crafter",\s*"Checking for unsaved project changes\."\)/);
    assert.match(hostSource, /lifecyclePromptButtons\.Visibility\s*=\s*Visibility\.Collapsed/);
    assert.match(hostSource, /startupOverlay\.Visibility\s*!=\s*Visibility\.Visible/);
});

test('recovery records are independently addressable and written atomically', () => {
    assert.match(hostSource, /"project\.recovery\.write"\s*=>\s*await WriteRecoveryAsync/);
    assert.match(hostSource, /"project\.recovery\.list"\s*=>\s*await ListRecoveryResponseAsync/);
    assert.match(hostSource, /"project\.recovery\.read"\s*=>\s*await ReadRecoveryAsync/);
    assert.match(hostSource, /"project\.recovery\.delete"\s*=>\s*await DeleteRecoveryAsync/);
    assert.match(hostSource, /await WriteUtf8AtomicallyAsync\(path,\s*content,\s*cancellationToken\)/);
    assert.match(hostSource, /File\.Move\(temporaryPath,\s*path,\s*true\)/);
});

test('successful production delivery, not tab navigation, confirms export', () => {
    assert.match(uiSource, /if \(kind === 'production' \|\| kind === 'package'\)[\s\S]*?onExportCompleted\?\.\(kind\)/);
    const deliveryIndex = uiSource.indexOf("if (kind === 'production' || kind === 'package')");
    const blockedIndex = uiSource.indexOf('if (result?.ok === false || result?.blocked)');
    const desktopCancellationIndex = uiSource.indexOf('if (desktopResult?.cancelled) return;');
    assert.ok(deliveryIndex > blockedIndex);
    assert.ok(deliveryIndex > desktopCancellationIndex);
    assert.doesNotMatch(uiSource, /openExportDialog[\s\S]{0,500}onExportCompleted/);
});
