using System;
using System.Buffers;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Security.Cryptography;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;

namespace CabinetCrafter;

public partial class MainWindow : Window
{
    private const int MaximumRecentProjects = 10;
    private const int MaximumRecoveryRecords = 100;
    private const long MaximumProjectBytes = 64L * 1024L * 1024L;
    private const long MaximumTextExportBytes = 256L * 1024L * 1024L;
    private const long MaximumBinaryExportBytes = 512L * 1024L * 1024L;
    private const long MaximumRecentProjectsBytes = 1024L * 1024L;
    private static readonly TimeSpan LifecycleCommandTimeout = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan LifecycleSaveCompletionTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan StartupNavigationTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan IntegrationSmokeTimeout = TimeSpan.FromSeconds(30);
    private static readonly UTF8Encoding Utf8NoBom = new(false);
    private readonly string appDataDirectory;
    private readonly string legacyAutosavePath;
    private readonly string recoveryDirectory;
    private readonly string recentProjectsPath;
    private readonly Dictionary<string, TaskCompletionSource<JsonElement?>> lifecycleCommandCompletions = [];
    private readonly CancellationTokenSource windowLifetimeCancellation = new();
    private readonly SemaphoreSlim recoveryIoGate = new(1, 1);
    private readonly SemaphoreSlim recentProjectsIoGate = new(1, 1);
    private readonly SemaphoreSlim initializationGate = new(1, 1);
    private readonly bool integrationSmokeTest;
    private string? currentProjectPath;
    private string currentProjectName = "Untitled cabinet";
    private bool currentProjectDirty;
    private PendingProjectCandidate? pendingProjectCandidate;
    private TaskCompletionSource<LifecyclePromptChoice>? lifecyclePromptCompletion;
    private bool closeHandshakeInProgress;
    private bool closeApproved;
    private bool hostDisposed;
    private bool bridgeScriptInstalled;
    private bool webMessageHandlerAttached;
    private bool nativeFileDialogOpen;
    private string startupFailureDetails = string.Empty;

    public MainWindow() : this(false)
    {
    }

    internal MainWindow(bool integrationSmokeTest)
    {
        InitializeComponent();

        this.integrationSmokeTest = integrationSmokeTest;

        appDataDirectory = integrationSmokeTest
            ? Path.Combine(Path.GetTempPath(), "CabinetCrafter-IntegrationSmoke", Environment.ProcessId.ToString())
            : Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CabinetCrafter");
        legacyAutosavePath = Path.Combine(appDataDirectory, "autosave.cabinet.json");
        recoveryDirectory = Path.Combine(appDataDirectory, "Recovery");
        recentProjectsPath = Path.Combine(appDataDirectory, "recent-projects.json");

        PreviewKeyDown += MainWindow_PreviewKeyDown;
        Closing += MainWindow_Closing;
        Closed += MainWindow_Closed;
        Loaded += async (_, _) => await InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        if (hostDisposed || windowLifetimeCancellation.IsCancellationRequested) return;
        if (!await initializationGate.WaitAsync(0, windowLifetimeCancellation.Token)) return;
        ShowStartupLoading();

        try
        {
            await Task.Run(() =>
            {
                Directory.CreateDirectory(appDataDirectory);
                Directory.CreateDirectory(recoveryDirectory);
            }, windowLifetimeCancellation.Token);
            await TryMigrateLegacyAutosaveAsync(windowLifetimeCancellation.Token);
            if (windowLifetimeCancellation.IsCancellationRequested) return;

            var wwwrootPath = ResolveWwwrootPath();
            if (wwwrootPath is null)
            {
                throw new FileNotFoundException(
                    "The application files are incomplete. Reinstall Cabinet Crafter, then try again.");
            }

            if (webView.CoreWebView2 is null)
            {
                var browserDataFolder = Path.Combine(appDataDirectory, "BrowserData");
                var environment = await CoreWebView2Environment.CreateAsync(null, browserDataFolder);
                if (windowLifetimeCancellation.IsCancellationRequested) return;
                await webView.EnsureCoreWebView2Async(environment);
                if (windowLifetimeCancellation.IsCancellationRequested) return;
            }

            var coreWebView = webView.CoreWebView2
                ?? throw new InvalidOperationException("The design workspace did not become available.");
            if (!bridgeScriptInstalled)
            {
                await coreWebView.AddScriptToExecuteOnDocumentCreatedAsync(DesktopBridgeScript);
                bridgeScriptInstalled = true;
            }
            if (!webMessageHandlerAttached)
            {
                coreWebView.WebMessageReceived += CoreWebView2_WebMessageReceived;
                webMessageHandlerAttached = true;
            }

            coreWebView.SetVirtualHostNameToFolderMapping(
                "app.local",
                wwwrootPath,
                CoreWebView2HostResourceAccessKind.DenyCors);

#if DEBUG
            coreWebView.Settings.AreDevToolsEnabled = true;
            coreWebView.Settings.AreDefaultContextMenusEnabled = true;
#else
            coreWebView.Settings.AreDevToolsEnabled = false;
            coreWebView.Settings.AreDefaultContextMenusEnabled = false;
#endif

            var navigationCompletion = new TaskCompletionSource<CoreWebView2NavigationCompletedEventArgs>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            void CompleteNavigation(object? sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
            {
                navigationCompletion.TrySetResult(eventArgs);
            }

            webView.NavigationCompleted += CompleteNavigation;
            try
            {
                coreWebView.Navigate("http://app.local/index.html");
                var navigation = await navigationCompletion.Task.WaitAsync(
                    StartupNavigationTimeout,
                    windowLifetimeCancellation.Token);
                if (!navigation.IsSuccess)
                {
                    throw new InvalidOperationException(
                        $"The design workspace could not be loaded ({navigation.WebErrorStatus}).");
                }
            }
            finally
            {
                webView.NavigationCompleted -= CompleteNavigation;
            }

            if (integrationSmokeTest)
            {
                await VerifyIntegratedWorkspaceAsync(coreWebView, windowLifetimeCancellation.Token);
            }

            CompleteStartup();
            if (integrationSmokeTest)
            {
                _ = Dispatcher.BeginInvoke(new Action(() => Application.Current.Shutdown(0)));
            }
        }
        catch (OperationCanceledException) when (windowLifetimeCancellation.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            if (hostDisposed || windowLifetimeCancellation.IsCancellationRequested) return;
            if (integrationSmokeTest)
            {
                Debug.WriteLine($"[CabinetHost] Integrated startup smoke failed: {exception}");
                Application.Current.Shutdown(3);
                return;
            }
            ShowStartupError(exception);
        }
        finally
        {
            initializationGate.Release();
        }
    }

    private static async Task VerifyIntegratedWorkspaceAsync(
        CoreWebView2 coreWebView,
        CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow + IntegrationSmokeTimeout;
        const string readinessScript = "Boolean(document.readyState === 'complete'"
            + " && window.chrome?.webview"
            + " && window.app?.uiManager"
            + " && window.app?.renderer?.domElement"
            + " && document.querySelector('.maker-nav')"
            + " && document.querySelector('#canvas-container'))";

        while (DateTimeOffset.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var result = await coreWebView.ExecuteScriptAsync(readinessScript);
            if (string.Equals(result, "true", StringComparison.OrdinalIgnoreCase)) return;
            await Task.Delay(100, cancellationToken);
        }

        throw new TimeoutException("The integrated workspace did not report that its host bridge, UI, and renderer were ready.");
    }

    private void ShowStartupLoading()
    {
        startupFailureDetails = string.Empty;
        startupTitle.Text = "Starting Cabinet Crafter";
        startupStatus.Text = "Preparing your design workspace.";
        startupProgress.Visibility = Visibility.Visible;
        startupErrorActions.Visibility = Visibility.Collapsed;
        startupCopyFeedback.Visibility = Visibility.Collapsed;
        startupOverlay.Visibility = Visibility.Visible;
        webView.Visibility = Visibility.Hidden;
        webView.IsHitTestVisible = false;
    }

    private void ShowStartupError(Exception exception)
    {
        startupFailureDetails = $"{DateTimeOffset.Now:O}{Environment.NewLine}{exception}";
        startupTitle.Text = "Cabinet Crafter could not start";
        startupStatus.Text = FriendlyStartupMessage(exception);
        startupProgress.Visibility = Visibility.Collapsed;
        startupErrorActions.Visibility = Visibility.Visible;
        startupCopyFeedback.Visibility = Visibility.Collapsed;
        startupOverlay.Visibility = Visibility.Visible;
        startupRetryButton.Focus();
    }

    private void CompleteStartup()
    {
        startupOverlay.Visibility = Visibility.Collapsed;
        webView.Visibility = Visibility.Visible;
        webView.IsHitTestVisible = true;
        webView.Focus();
    }

    private static string FriendlyStartupMessage(Exception exception)
    {
        return exception switch
        {
            FileNotFoundException => exception.Message,
            UnauthorizedAccessException =>
                "Cabinet Crafter could not prepare its local workspace. Check that your Windows account can write to its local application data, then retry.",
            WebView2RuntimeNotFoundException =>
                "Cabinet Crafter needs the Microsoft Edge WebView2 Runtime. Install or repair the runtime, then retry.",
            TimeoutException =>
                "The design workspace took too long to open. Retry now. If the problem continues, copy the details for troubleshooting.",
            _ => "The design workspace could not be opened. Retry now. If the problem continues, copy the details for troubleshooting."
        };
    }

    private async void StartupRetry_Click(object sender, RoutedEventArgs eventArgs)
    {
        await InitializeAsync();
    }

    private void StartupCopyDetails_Click(object sender, RoutedEventArgs eventArgs)
    {
        if (string.IsNullOrWhiteSpace(startupFailureDetails)) return;
        try
        {
            Clipboard.SetText(startupFailureDetails);
            startupCopyFeedback.Text = "Details copied.";
            startupCopyFeedback.Foreground = System.Windows.Media.Brushes.DarkGreen;
        }
        catch
        {
            startupCopyFeedback.Text = "Windows could not copy the details. Try again.";
            startupCopyFeedback.Foreground = System.Windows.Media.Brushes.DarkRed;
        }
        startupCopyFeedback.Visibility = Visibility.Visible;
    }

    private string? ResolveWwwrootPath()
    {
        var publishedPath = Path.Combine(AppContext.BaseDirectory, "wwwroot");
        if (Directory.Exists(publishedPath) && File.Exists(Path.Combine(publishedPath, "index.html")))
        {
            return publishedPath;
        }

#if DEBUG
        var developmentPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "wwwroot"));
        if (Directory.Exists(developmentPath) && File.Exists(Path.Combine(developmentPath, "index.html")))
        {
            return developmentPath;
        }
#endif

        return null;
    }

    private async void CoreWebView2_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        try
        {
            using var document = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            if (document.RootElement.ValueKind == JsonValueKind.String)
            {
                ForwardConsoleMessage(document.RootElement.GetString() ?? string.Empty);
                return;
            }

            if (!document.RootElement.TryGetProperty("kind", out var kindElement))
            {
                return;
            }

            var kind = kindElement.GetString();
            if (kind == "cabinetLifecycleResponse")
            {
                CompleteLifecycleCommand(document.RootElement);
                return;
            }
            if (kind != "cabinetRequest") return;

            var requestId = document.RootElement.GetProperty("requestId").GetString() ?? string.Empty;
            var type = document.RootElement.GetProperty("type").GetString() ?? string.Empty;
            var payload = document.RootElement.TryGetProperty("payload", out var payloadElement)
                ? payloadElement.Clone()
                : default;

            var responsePayload = await HandleDesktopRequestAsync(type, payload);
            PostDesktopResponse(requestId, true, responsePayload, null);
        }
        catch (OperationCanceledException) when (hostDisposed || windowLifetimeCancellation.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            var requestId = TryReadRequestId(eventArgs.WebMessageAsJson);
            PostDesktopResponse(requestId, false, null, exception.Message);
            Debug.WriteLine($"[CabinetHost] {exception}");
        }
    }

    private async Task<object?> HandleDesktopRequestAsync(string type, JsonElement payload)
    {
        var cancellationToken = windowLifetimeCancellation.Token;
        return type switch
        {
            "project.open" => await OpenProjectCandidateAsync(cancellationToken),
            "project.openRecent" => await OpenRecentProjectCandidateAsync(payload, cancellationToken),
            "project.open.commit" => await CommitProjectCandidateAsync(payload, cancellationToken),
            "project.open.discard" => DiscardProjectCandidate(payload),
            "project.save" => await SaveProjectAsync(payload, false, cancellationToken),
            "project.saveAs" => await SaveProjectAsync(payload, true, cancellationToken),
            "project.new" => StartNewProject(payload),
            "project.current" => new { path = currentProjectPath, projectName = currentProjectName, dirty = currentProjectDirty },
            "project.state.update" => UpdateProjectState(payload),
            "project.lifecycle.prompt" => await PromptForProjectReplacementAsync(payload),
            "project.recent" => new { projects = await ReadRecentProjectsAsync(cancellationToken) },
            "project.recovery.write" => await WriteRecoveryAsync(payload, cancellationToken),
            "project.recovery.list" => await ListRecoveryResponseAsync(cancellationToken),
            "project.recovery.read" => await ReadRecoveryAsync(payload, cancellationToken),
            "project.recovery.activate" => await ActivateRecoveryAsync(payload, cancellationToken),
            "project.recovery.delete" => await DeleteRecoveryAsync(payload, cancellationToken),
            "project.autosave.write" => await WriteLegacyCompatibleAutosaveAsync(payload, cancellationToken),
            "project.autosave.read" => await ReadNewestRecoveryAsync(cancellationToken),
            "project.autosave.clear" => await ClearLegacyCompatibleAutosaveAsync(payload, cancellationToken),
            "export.saveText" => await SaveTextExportAsync(payload, cancellationToken),
            "export.saveBinary" => await SaveBinaryExportAsync(payload, cancellationToken),
            "shell.openFolder" => OpenContainingFolder(payload),
            _ => throw new InvalidOperationException($"Unsupported desktop request: {type}")
        };
    }

    private async Task<object?> OpenProjectCandidateAsync(CancellationToken cancellationToken)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Open Cabinet Crafter project",
            Filter = "Cabinet Crafter project (*.cabinet.json;*.json)|*.cabinet.json;*.json|All files (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };

        if (dialog.ShowDialog(this) != true)
        {
            return new { cancelled = true };
        }

        return await CreateProjectCandidateAsync(dialog.FileName, cancellationToken);
    }

    private async Task<object> OpenRecentProjectCandidateAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var requestedPath = Path.GetFullPath(ReadRequiredString(payload, "path"));
        var recentPath = (await ReadRecentProjectsAsync(cancellationToken))
            .Select(Path.GetFullPath)
            .FirstOrDefault(item => string.Equals(item, requestedPath, StringComparison.OrdinalIgnoreCase));

        if (recentPath is null)
        {
            throw new FileNotFoundException("The selected recent project is no longer available.", requestedPath);
        }

        return await CreateProjectCandidateAsync(recentPath, cancellationToken);
    }

    private async Task<object> CreateProjectCandidateAsync(string path, CancellationToken cancellationToken)
    {
        var fullPath = Path.GetFullPath(path);
        var content = await ReadUtf8FileAsync(fullPath, MaximumProjectBytes, "Project", cancellationToken);
        var candidate = new PendingProjectCandidate(Guid.NewGuid().ToString("N"), fullPath);
        pendingProjectCandidate = candidate;
        return new
        {
            cancelled = false,
            candidateId = candidate.Id,
            path = candidate.Path,
            content,
            committed = false
        };
    }

    private async Task<object> CommitProjectCandidateAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var candidateId = ReadRequiredString(payload, "candidateId");
        var candidate = pendingProjectCandidate;
        if (candidate is null || !string.Equals(candidate.Id, candidateId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("The pending project candidate is no longer available.");
        }

        currentProjectPath = candidate.Path;
        var requestedName = ReadOptionalString(payload, "projectName");
        currentProjectName = string.IsNullOrWhiteSpace(requestedName)
            ? DisplayProjectFileName(candidate.Path)
            : requestedName.Trim();
        currentProjectDirty = false;
        pendingProjectCandidate = null;
        UpdateWindowTitle();
        var recentWarning = await TryAddRecentProjectAsync(candidate.Path, cancellationToken);
        return new
        {
            committed = true,
            path = candidate.Path,
            warning = recentWarning
        };
    }

    private object DiscardProjectCandidate(JsonElement payload)
    {
        var candidateId = ReadOptionalString(payload, "candidateId");
        var discarded = pendingProjectCandidate is not null
            && (string.IsNullOrWhiteSpace(candidateId)
                || string.Equals(candidateId, pendingProjectCandidate.Id, StringComparison.Ordinal));
        if (discarded) pendingProjectCandidate = null;
        return new { discarded };
    }

    private async Task<object> SaveProjectAsync(JsonElement payload, bool forceSaveAs, CancellationToken cancellationToken)
    {
        var content = ReadRequiredString(payload, "content");
        await ValidateUtf8ContentSizeAsync(content, MaximumProjectBytes, "Project", cancellationToken);
        var suggestedName = SafeFileName(ReadOptionalString(payload, "suggestedName") ?? "untitled.cabinet.json");
        var targetPath = currentProjectPath;

        if (forceSaveAs || string.IsNullOrWhiteSpace(targetPath))
        {
            var dialog = new SaveFileDialog
            {
                Title = "Save Cabinet Crafter project",
                FileName = suggestedName,
                DefaultExt = ".cabinet.json",
                AddExtension = true,
                Filter = "Cabinet Crafter project (*.cabinet.json)|*.cabinet.json|JSON project (*.json)|*.json"
            };

            if (!ShowSaveDialog(dialog))
            {
                return new { cancelled = true };
            }

            targetPath = dialog.FileName;
        }

        await WriteUtf8AtomicallyAsync(targetPath!, content, cancellationToken);
        currentProjectPath = targetPath;
        var projectName = ReadOptionalString(payload, "projectName");
        currentProjectName = string.IsNullOrWhiteSpace(projectName)
            ? DisplayProjectFileName(targetPath!)
            : projectName.Trim();
        currentProjectDirty = false;
        UpdateWindowTitle();
        var recentWarning = await TryAddRecentProjectAsync(targetPath!, cancellationToken);
        return new { cancelled = false, path = targetPath, warning = recentWarning };
    }

    private bool ShowSaveDialog(SaveFileDialog dialog)
    {
        nativeFileDialogOpen = true;
        try
        {
            return dialog.ShowDialog(this) == true;
        }
        finally
        {
            nativeFileDialogOpen = false;
        }
    }

    private object StartNewProject(JsonElement payload)
    {
        pendingProjectCandidate = null;
        currentProjectPath = null;
        currentProjectName = ReadOptionalString(payload, "projectName")?.Trim() is { Length: > 0 } name
            ? name
            : "Untitled cabinet";
        currentProjectDirty = false;
        UpdateWindowTitle();
        return new { started = true, path = (string?)null };
    }

    private object UpdateProjectState(JsonElement payload)
    {
        var projectName = ReadOptionalString(payload, "projectName");
        if (!string.IsNullOrWhiteSpace(projectName)) currentProjectName = projectName.Trim();
        if (payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty("dirty", out var dirtyElement)
            && dirtyElement.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            currentProjectDirty = dirtyElement.GetBoolean();
        }
        UpdateWindowTitle();
        return new
        {
            path = currentProjectPath,
            projectName = currentProjectName,
            dirty = currentProjectDirty
        };
    }

    private async Task<object> SaveTextExportAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var content = ReadRequiredString(payload, "content");
        await ValidateUtf8ContentSizeAsync(content, MaximumTextExportBytes, "Text export", cancellationToken);
        var suggestedName = SafeFileName(ReadOptionalString(payload, "suggestedName") ?? "cabinet-export.svg");
        var filter = ReadOptionalString(payload, "filter") ?? "SVG drawing (*.svg)|*.svg|DXF drawing (*.dxf)|*.dxf|All files (*.*)|*.*";
        var dialog = new SaveFileDialog
        {
            Title = "Save fabrication output",
            FileName = suggestedName,
            Filter = filter,
            AddExtension = true
        };

        if (dialog.ShowDialog(this) != true)
        {
            return new { cancelled = true };
        }

        await WriteUtf8AtomicallyAsync(dialog.FileName, content, cancellationToken);
        return new { cancelled = false, path = dialog.FileName };
    }

    private async Task<object> SaveBinaryExportAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var base64 = ReadRequiredString(payload, "base64");
        var estimatedBytes = (long)Math.Ceiling(base64.Length * 0.75);
        if (estimatedBytes > MaximumBinaryExportBytes)
        {
            throw new InvalidDataException($"Fabrication package exceeds the {FormatBytes(MaximumBinaryExportBytes)} size limit.");
        }
        var suggestedName = SafeFileName(ReadOptionalString(payload, "suggestedName") ?? "cabinet-fabrication.zip");
        var dialog = new SaveFileDialog
        {
            Title = "Save fabrication package",
            FileName = suggestedName,
            DefaultExt = ".zip",
            Filter = "Fabrication package (*.zip)|*.zip|All files (*.*)|*.*",
            AddExtension = true
        };

        if (dialog.ShowDialog(this) != true)
        {
            return new { cancelled = true };
        }

        await WriteBase64AtomicallyAsync(dialog.FileName, base64, MaximumBinaryExportBytes, cancellationToken);
        return new { cancelled = false, path = dialog.FileName };
    }

    private static object OpenContainingFolder(JsonElement payload)
    {
        var suppliedPath = ReadRequiredString(payload, "path");
        if (suppliedPath.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
        {
            throw new InvalidDataException("The requested path is not valid.");
        }

        var fullPath = Path.GetFullPath(suppliedPath);
        string folderPath;
        if (Directory.Exists(fullPath))
        {
            folderPath = fullPath;
        }
        else if (File.Exists(fullPath))
        {
            folderPath = Path.GetDirectoryName(fullPath)
                ?? throw new InvalidDataException("The requested file has no containing folder.");
        }
        else
        {
            throw new FileNotFoundException("The exported file or folder is no longer available.", fullPath);
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = folderPath,
            UseShellExecute = true
        });
        return new { opened = true, path = folderPath };
    }

    private async Task<object> ListRecoveryResponseAsync(CancellationToken cancellationToken)
    {
        var records = await ListRecoveryRecordsAsync(cancellationToken);
        return new
        {
            records = records.Select(record => new
            {
                recoveryId = record.RecoveryId,
                projectName = record.ProjectName,
                sourcePath = record.SourcePath,
                savedAt = record.SavedAt,
                sizeBytes = record.SizeBytes
            }).ToList()
        };
    }

    private async Task<object> WriteRecoveryAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var recoveryId = NormalizeRecoveryId(ReadRequiredString(payload, "recoveryId"));
        var content = ReadRequiredString(payload, "content");
        return await WriteRecoveryRecordAsync(recoveryId, content, cancellationToken);
    }

    private async Task<object> WriteRecoveryRecordAsync(string recoveryId, string content, CancellationToken cancellationToken)
    {
        await ValidateUtf8ContentSizeAsync(content, MaximumProjectBytes, "Recovery", cancellationToken);
        await recoveryIoGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var path = GetRecoveryPath(recoveryId);
            var atCapacity = await Task.Run(() =>
                !File.Exists(path)
                && Directory.EnumerateFiles(recoveryDirectory, "*.cabinet.json")
                    .Take(MaximumRecoveryRecords)
                    .Count() >= MaximumRecoveryRecords,
                cancellationToken).ConfigureAwait(false);
            if (atCapacity)
            {
                throw new InvalidOperationException($"Recovery storage already contains {MaximumRecoveryRecords} records. Restore or discard an older record before continuing.");
            }

            await WriteUtf8AtomicallyAsync(path, content, cancellationToken).ConfigureAwait(false);
            var metadata = await Task.Run(() =>
            {
                var info = new FileInfo(path);
                return (SavedAt: info.LastWriteTimeUtc, SizeBytes: info.Length);
            }, cancellationToken).ConfigureAwait(false);
            return new
            {
                recoveryId,
                path,
                savedAt = metadata.SavedAt,
                sizeBytes = metadata.SizeBytes
            };
        }
        finally
        {
            recoveryIoGate.Release();
        }
    }

    private async Task<object> ReadRecoveryAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var recoveryId = NormalizeRecoveryId(ReadRequiredString(payload, "recoveryId"));
        var path = GetRecoveryPath(recoveryId);
        var exists = await Task.Run(() => File.Exists(path), cancellationToken);
        if (!exists) return new { exists = false, recoveryId };
        var content = await ReadUtf8FileAsync(path, MaximumProjectBytes, "Recovery", cancellationToken);
        var metadata = await Task.Run(() =>
        {
            var info = new FileInfo(path);
            return (SavedAt: info.LastWriteTimeUtc, SizeBytes: info.Length);
        }, cancellationToken);
        return new
        {
            exists = true,
            recoveryId,
            content,
            savedAt = metadata.SavedAt,
            sizeBytes = metadata.SizeBytes
        };
    }

    private async Task<object> DeleteRecoveryAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var recoveryId = NormalizeRecoveryId(ReadRequiredString(payload, "recoveryId"));
        return await DeleteRecoveryByIdAsync(recoveryId, cancellationToken);
    }

    private async Task<object> DeleteRecoveryByIdAsync(string recoveryId, CancellationToken cancellationToken)
    {
        await recoveryIoGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var path = GetRecoveryPath(recoveryId);
            var deleted = await Task.Run(() =>
            {
                if (!File.Exists(path)) return false;
                File.Delete(path);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return new { deleted, recoveryId };
        }
        finally
        {
            recoveryIoGate.Release();
        }
    }

    private async Task<object> ActivateRecoveryAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var recoveryId = NormalizeRecoveryId(ReadRequiredString(payload, "recoveryId"));
        var record = (await ListRecoveryRecordsAsync(cancellationToken))
            .FirstOrDefault(item => string.Equals(item.RecoveryId, recoveryId, StringComparison.Ordinal));
        if (record is null) throw new FileNotFoundException("The selected recovery record is no longer available.");
        currentProjectPath = await ResolveExistingSourcePathAsync(record.SourcePath, cancellationToken);
        currentProjectName = record.ProjectName;
        currentProjectDirty = true;
        UpdateWindowTitle();
        return new
        {
            activated = true,
            recoveryId,
            path = currentProjectPath,
            projectName = currentProjectName
        };
    }

    private async Task<object> WriteLegacyCompatibleAutosaveAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var requestedRecoveryId = ReadOptionalString(payload, "recoveryId");
        var recoveryId = NormalizeRecoveryId(string.IsNullOrWhiteSpace(requestedRecoveryId) ? "legacy-current" : requestedRecoveryId);
        var content = ReadRequiredString(payload, "content");
        return await WriteRecoveryRecordAsync(recoveryId, content, cancellationToken);
    }

    private async Task<object> ReadNewestRecoveryAsync(CancellationToken cancellationToken)
    {
        var newest = (await ListRecoveryRecordsAsync(cancellationToken)).FirstOrDefault();
        if (newest is null) return new { exists = false };
        var path = GetRecoveryPath(newest.RecoveryId);
        var content = await ReadUtf8FileAsync(path, MaximumProjectBytes, "Recovery", cancellationToken);
        return new
        {
            exists = true,
            recoveryId = newest.RecoveryId,
            content,
            savedAt = newest.SavedAt,
            sizeBytes = newest.SizeBytes
        };
    }

    private async Task<object> ClearLegacyCompatibleAutosaveAsync(JsonElement payload, CancellationToken cancellationToken)
    {
        var recoveryId = ReadOptionalString(payload, "recoveryId");
        if (!string.IsNullOrWhiteSpace(recoveryId))
        {
            return await DeleteRecoveryByIdAsync(NormalizeRecoveryId(recoveryId), cancellationToken);
        }
        var newest = (await ListRecoveryRecordsAsync(cancellationToken)).FirstOrDefault();
        if (newest is null) return new { cleared = true, deleted = false };
        await DeleteRecoveryByIdAsync(NormalizeRecoveryId(newest.RecoveryId), cancellationToken);
        return new { cleared = true, deleted = true, recoveryId = newest.RecoveryId };
    }

    private async Task<List<RecoveryRecordInfo>> ListRecoveryRecordsAsync(CancellationToken cancellationToken)
    {
        var paths = await Task.Run(() => Directory.Exists(recoveryDirectory)
            ? Directory.EnumerateFiles(recoveryDirectory, "*.cabinet.json").ToArray()
            : [], cancellationToken).ConfigureAwait(false);
        var records = new List<RecoveryRecordInfo>(Math.Min(paths.Length, MaximumRecoveryRecords));
        foreach (var path in paths)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var record = await TryReadRecoveryRecordInfoAsync(path, cancellationToken).ConfigureAwait(false);
            if (record is not null) records.Add(record);
        }
        return records
            .OrderByDescending(record => record.SavedAt)
            .Take(MaximumRecoveryRecords)
            .ToList();
    }

    private static async Task<RecoveryRecordInfo?> TryReadRecoveryRecordInfoAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            var fileState = await Task.Run(() =>
            {
                var info = new FileInfo(path);
                return (info.Exists, info.Length, info.LastWriteTimeUtc);
            }, cancellationToken).ConfigureAwait(false);
            if (!fileState.Exists || fileState.Length <= 0 || fileState.Length > MaximumProjectBytes) return null;

            await using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                64 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
            var root = document.RootElement;
            var id = ReadRecoveryMetadataString(root, "recoveryId")
                ?? Path.GetFileName(path).Replace(".cabinet.json", string.Empty, StringComparison.OrdinalIgnoreCase);
            var projectName = ReadRecoveryMetadataString(root, "projectName") ?? "Untitled cabinet";
            var sourcePath = ReadRecoveryMetadataString(root, "sourcePath");
            var timestamp = ReadRecoveryMetadataString(root, "timestamp");
            var savedAt = DateTimeOffset.TryParse(timestamp, out var parsed)
                ? parsed
                : new DateTimeOffset(fileState.LastWriteTimeUtc, TimeSpan.Zero);
            return new RecoveryRecordInfo(id, projectName, sourcePath, savedAt, fileState.Length);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            Debug.WriteLine($"[CabinetHost] Skipped unreadable recovery record {path}: {exception.Message}");
            return null;
        }
    }

    private async Task<object> PromptForProjectReplacementAsync(JsonElement payload)
    {
        var projectName = ReadOptionalString(payload, "projectName");
        var action = ReadOptionalString(payload, "action") ?? "continue";
        var name = string.IsNullOrWhiteSpace(projectName) ? currentProjectName : projectName.Trim();
        var choice = await ShowLifecyclePromptAsync(
            "Save changes?",
            $"Save changes to {name} before you {action}?",
            null);
        return new { choice = ChoiceName(choice) };
    }

    private Task<LifecyclePromptChoice> ShowLifecyclePromptAsync(string title, string message, string? detail)
    {
        if (lifecyclePromptCompletion is not null)
        {
            throw new InvalidOperationException("Another project decision is already waiting for a response.");
        }

        lifecyclePromptTitle.Text = title;
        lifecyclePromptMessage.Text = message;
        lifecyclePromptDetail.Text = detail ?? string.Empty;
        lifecyclePromptDetail.Visibility = string.IsNullOrWhiteSpace(detail) ? Visibility.Collapsed : Visibility.Visible;
        lifecyclePromptButtons.Visibility = Visibility.Visible;
        webView.Visibility = Visibility.Hidden;
        lifecyclePromptOverlay.Visibility = Visibility.Visible;
        webView.IsHitTestVisible = false;
        lifecyclePromptCompletion = new TaskCompletionSource<LifecyclePromptChoice>();
        lifecyclePromptSaveButton.Focus();
        return lifecyclePromptCompletion.Task;
    }

    private void CompleteLifecyclePrompt(LifecyclePromptChoice choice)
    {
        var completion = lifecyclePromptCompletion;
        if (completion is null) return;
        lifecyclePromptCompletion = null;
        lifecyclePromptOverlay.Visibility = Visibility.Collapsed;
        webView.Visibility = Visibility.Visible;
        webView.IsHitTestVisible = true;
        completion.TrySetResult(choice);
    }

    private void ShowLifecycleProgress(string title, string message)
    {
        lifecyclePromptTitle.Text = title;
        lifecyclePromptMessage.Text = message;
        lifecyclePromptDetail.Visibility = Visibility.Collapsed;
        lifecyclePromptButtons.Visibility = Visibility.Collapsed;
        webView.Visibility = Visibility.Hidden;
        webView.IsHitTestVisible = false;
        lifecyclePromptOverlay.Visibility = Visibility.Visible;
    }

    private void LifecyclePromptSave_Click(object sender, RoutedEventArgs eventArgs)
    {
        CompleteLifecyclePrompt(LifecyclePromptChoice.Save);
    }

    private void LifecyclePromptDiscard_Click(object sender, RoutedEventArgs eventArgs)
    {
        CompleteLifecyclePrompt(LifecyclePromptChoice.Discard);
    }

    private void LifecyclePromptCancel_Click(object sender, RoutedEventArgs eventArgs)
    {
        CompleteLifecyclePrompt(LifecyclePromptChoice.Cancel);
    }

    private void MainWindow_Closing(object? sender, CancelEventArgs eventArgs)
    {
        if (integrationSmokeTest)
        {
            closeApproved = true;
            return;
        }
        if (closeApproved) return;
        eventArgs.Cancel = true;
        if (closeHandshakeInProgress)
        {
            if (lifecyclePromptCompletion is not null) lifecyclePromptSaveButton.Focus();
            return;
        }
        if (lifecyclePromptCompletion is not null)
        {
            CompleteLifecyclePrompt(LifecyclePromptChoice.Cancel);
        }
        closeHandshakeInProgress = true;

        Dispatcher.BeginInvoke(new Action(() => _ = CompleteCloseHandshakeAsync()));
    }

    private async Task CompleteCloseHandshakeAsync()
    {
        try
        {
            ShowLifecycleProgress("Closing Cabinet Crafter", "Checking for unsaved project changes.");
            JsonElement? state = null;
            string? lifecycleWarning = null;
            try
            {
                state = await ExecuteLifecycleCommandAsync("prepareClose");
            }
            catch (Exception exception)
            {
                lifecycleWarning = "The workspace could not finish its final recovery update. Save the project or discard the changes to close.";
                Debug.WriteLine($"[CabinetHost] Close preparation did not complete: {exception}");
            }

            var dirty = state.HasValue
                ? ReadJsonBoolean(state, "dirty", currentProjectDirty)
                : currentProjectDirty
                    || (startupOverlay.Visibility != Visibility.Visible && webView.CoreWebView2 is not null);
            if (!dirty)
            {
                ApproveClose();
                return;
            }

            var projectName = ReadJsonString(state, "projectName") ?? currentProjectName;
            var autosaveError = ReadJsonString(state, "autosaveError");
            var detail = string.IsNullOrWhiteSpace(autosaveError)
                ? lifecycleWarning
                : $"Recovery could not be updated: {autosaveError}";
            var choice = await ShowLifecyclePromptAsync(
                "Save changes before closing?",
                $"Save changes to {projectName} before closing Cabinet Crafter?",
                detail);

            if (choice == LifecyclePromptChoice.Cancel) return;
            if (choice == LifecyclePromptChoice.Discard)
            {
                ShowLifecycleProgress("Closing Cabinet Crafter", "Removing the current recovery record.");
                try
                {
                    await ExecuteLifecycleCommandAsync("discardForClose");
                }
                catch (Exception exception)
                {
                    Debug.WriteLine($"[CabinetHost] Recovery cleanup did not complete before discard: {exception}");
                }
                ApproveClose();
                return;
            }

            var saveResult = await ExecuteLifecycleCommandAsync("saveForClose", allowLongRunning: true);
            if (ReadJsonBoolean(saveResult, "ok", false))
            {
                ApproveClose();
                return;
            }
            if (!ReadJsonBoolean(saveResult, "cancelled", false))
            {
                var message = ReadJsonString(saveResult, "message") ?? "The project was not saved. Cabinet Crafter will remain open.";
                MessageBox.Show(this, message, "Save did not complete", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                this,
                $"Cabinet Crafter could not verify whether the current project is safe to close.\n\n{exception.Message}",
                "Close cancelled",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
        finally
        {
            if (!closeApproved)
            {
                closeHandshakeInProgress = false;
                if (lifecyclePromptCompletion is null)
                {
                    lifecyclePromptOverlay.Visibility = Visibility.Collapsed;
                    if (startupOverlay.Visibility != Visibility.Visible)
                    {
                        webView.Visibility = Visibility.Visible;
                        webView.IsHitTestVisible = true;
                    }
                }
            }
        }
    }

    private async Task<JsonElement?> ExecuteLifecycleCommandAsync(string method, bool allowLongRunning = false)
    {
        if (webView.CoreWebView2 is null) return null;
        var commandId = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement?>(TaskCreationOptions.RunContinuationsAsynchronously);
        lifecycleCommandCompletions[commandId] = completion;
        var commandIdJson = JsonSerializer.Serialize(commandId);
        var methodJson = JsonSerializer.Serialize(method);
        var script = $$"""
            (() => {
                const commandId = {{commandIdJson}};
                const method = {{methodJson}};
                const respond = (ok, payload, error) => window.chrome.webview.postMessage({
                    kind: 'cabinetLifecycleResponse',
                    commandId,
                    ok,
                    payload: payload ?? null,
                    error: error ?? null
                });
                try {
                    const hook = window.cabinetCrafterLifecycle?.[method];
                    if (typeof hook !== 'function') throw new Error(`Lifecycle hook ${method} is unavailable.`);
                    Promise.resolve(hook()).then(
                        payload => respond(true, payload, null),
                        error => respond(false, null, String(error?.message || error))
                    );
                } catch (error) {
                    respond(false, null, String(error?.message || error));
                }
            })();
            """;

        try
        {
            await webView.CoreWebView2.ExecuteScriptAsync(script);
            return allowLongRunning
                ? await WaitForLongRunningLifecycleCommandAsync(completion.Task)
                : await completion.Task.WaitAsync(LifecycleCommandTimeout, windowLifetimeCancellation.Token);
        }
        finally
        {
            lifecycleCommandCompletions.Remove(commandId);
        }
    }

    private async Task<JsonElement?> WaitForLongRunningLifecycleCommandAsync(Task<JsonElement?> completion)
    {
        while (true)
        {
            try
            {
                return await completion.WaitAsync(
                    LifecycleSaveCompletionTimeout,
                    windowLifetimeCancellation.Token);
            }
            catch (TimeoutException) when (nativeFileDialogOpen)
            {
            }
        }
    }

    private void CompleteLifecycleCommand(JsonElement message)
    {
        if (!message.TryGetProperty("commandId", out var commandIdElement)) return;
        var commandId = commandIdElement.GetString();
        if (string.IsNullOrWhiteSpace(commandId) || !lifecycleCommandCompletions.Remove(commandId, out var completion)) return;

        var ok = message.TryGetProperty("ok", out var okElement) && okElement.ValueKind == JsonValueKind.True;
        if (!ok)
        {
            var error = message.TryGetProperty("error", out var errorElement) && errorElement.ValueKind == JsonValueKind.String
                ? errorElement.GetString()
                : null;
            completion.TrySetException(new InvalidOperationException(error ?? "The workspace lifecycle command failed."));
            return;
        }

        var payload = message.TryGetProperty("payload", out var payloadElement) && payloadElement.ValueKind != JsonValueKind.Null
            ? payloadElement.Clone()
            : (JsonElement?)null;
        completion.TrySetResult(payload);
    }

    private void ApproveClose()
    {
        closeApproved = true;
        Close();
    }

    private void MainWindow_Closed(object? sender, EventArgs eventArgs)
    {
        if (hostDisposed) return;
        hostDisposed = true;
        windowLifetimeCancellation.Cancel();
        lifecyclePromptCompletion?.TrySetResult(LifecyclePromptChoice.Cancel);
        lifecyclePromptCompletion = null;
        foreach (var completion in lifecycleCommandCompletions.Values)
        {
            completion.TrySetCanceled(windowLifetimeCancellation.Token);
        }
        lifecycleCommandCompletions.Clear();

        if (webView.CoreWebView2 is not null)
        {
            webView.CoreWebView2.WebMessageReceived -= CoreWebView2_WebMessageReceived;
        }
        webView.Dispose();
        windowLifetimeCancellation.Dispose();
        if (integrationSmokeTest)
        {
            try
            {
                Directory.Delete(appDataDirectory, recursive: true);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
        Application.Current?.Shutdown();
    }

    private async Task<List<string>> ReadRecentProjectsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var exists = await Task.Run(() => File.Exists(recentProjectsPath), cancellationToken).ConfigureAwait(false);
            if (!exists) return [];
            var content = await ReadUtf8FileAsync(recentProjectsPath, MaximumRecentProjectsBytes, "Recent projects", cancellationToken).ConfigureAwait(false);
            var entries = JsonSerializer.Deserialize<List<string>>(content) ?? [];
            return entries.Where(File.Exists).Distinct(StringComparer.OrdinalIgnoreCase).Take(MaximumRecentProjects).ToList();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return [];
        }
    }

    private async Task<string?> TryAddRecentProjectAsync(string path, CancellationToken cancellationToken)
    {
        await recentProjectsIoGate.WaitAsync(cancellationToken);
        try
        {
            var recent = await ReadRecentProjectsAsync(cancellationToken);
            recent.RemoveAll(item => string.Equals(item, path, StringComparison.OrdinalIgnoreCase));
            recent.Insert(0, path);
            await WriteUtf8AtomicallyAsync(
                recentProjectsPath,
                JsonSerializer.Serialize(recent.Take(MaximumRecentProjects)),
                cancellationToken);
            return null;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            Debug.WriteLine($"[CabinetHost] Project was saved/opened but Recents could not be updated: {exception}");
            return "The project succeeded, but the recent-projects list could not be updated.";
        }
        finally
        {
            recentProjectsIoGate.Release();
        }
    }

    private void PostDesktopResponse(string requestId, bool ok, object? payload, string? error)
    {
        if (hostDisposed || webView.CoreWebView2 is null) return;
        try
        {
            webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                kind = "cabinetResponse",
                requestId,
                ok,
                payload,
                error
            }));
        }
        catch (InvalidOperationException) when (hostDisposed || windowLifetimeCancellation.IsCancellationRequested)
        {
        }
    }

    private void ForwardConsoleMessage(string message)
    {
        Console.WriteLine($"[WebConsole] {message}");
        Debug.WriteLine($"[WebConsole] {message}");
    }

    private void UpdateWindowTitle()
    {
        var name = !string.IsNullOrWhiteSpace(currentProjectName)
            ? currentProjectName.Trim()
            : currentProjectPath is null
                ? "Untitled cabinet"
                : DisplayProjectFileName(currentProjectPath);
        Title = $"{(currentProjectDirty ? "* " : string.Empty)}{name} - Cabinet Crafter";
    }

    private static string TryReadRequestId(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.TryGetProperty("requestId", out var value) ? value.GetString() ?? string.Empty : string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string ReadRequiredString(JsonElement payload, string propertyName)
    {
        var value = ReadOptionalString(payload, propertyName);
        return value ?? throw new InvalidDataException($"Request is missing {propertyName}.");
    }

    private static string ReadRequiredString(JsonElement payload, string propertyName, long maximumBytes, string label)
    {
        var value = ReadRequiredString(payload, propertyName);
        var bytes = Encoding.UTF8.GetByteCount(value);
        if (bytes > maximumBytes)
        {
            throw new InvalidDataException($"{label} data is {FormatBytes(bytes)}; the maximum supported size is {FormatBytes(maximumBytes)}.");
        }
        return value;
    }

    private static string? ReadOptionalString(JsonElement payload, string propertyName)
    {
        return payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty(propertyName, out var value)
            ? value.GetString()
            : null;
    }

    private static string SafeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var safe = new string(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(safe) ? "cabinet-export" : safe;
    }

    private string GetRecoveryPath(string recoveryId)
    {
        return Path.Combine(recoveryDirectory, $"{NormalizeRecoveryId(recoveryId)}.cabinet.json");
    }

    private static string NormalizeRecoveryId(string value)
    {
        var id = new string((value ?? string.Empty)
            .Where(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_')
            .Take(80)
            .ToArray());
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidDataException("Recovery ID is invalid.");
        return id;
    }

    private static string? ReadRecoveryMetadataString(JsonElement root, string propertyName)
    {
        return root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty(propertyName, out var value)
            && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
    }

    private async Task TryMigrateLegacyAutosaveAsync(CancellationToken cancellationToken)
    {
        await recoveryIoGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await Task.Run(() =>
            {
                if (!File.Exists(legacyAutosavePath)) return;
                EnsureReadableFileSize(legacyAutosavePath, MaximumProjectBytes, "Legacy recovery");
                var timestamp = File.GetLastWriteTimeUtc(legacyAutosavePath).ToString("yyyyMMddHHmmss");
                var target = GetRecoveryPath($"legacy-{timestamp}");
                if (File.Exists(target))
                {
                    target = GetRecoveryPath($"legacy-{timestamp}-{Guid.NewGuid():N}");
                }
                File.Move(legacyAutosavePath, target);
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            Debug.WriteLine($"[CabinetHost] Legacy recovery migration failed: {exception}");
        }
        finally
        {
            recoveryIoGate.Release();
        }
    }

    private static void EnsureReadableFileSize(string path, long maximumBytes, string label)
    {
        var info = new FileInfo(path);
        if (!info.Exists) throw new FileNotFoundException($"{label} file no longer exists.", path);
        if (info.Length <= 0) throw new InvalidDataException($"{label} file is empty.");
        if (info.Length > maximumBytes)
        {
            throw new InvalidDataException($"{label} file is {FormatBytes(info.Length)}; the maximum supported size is {FormatBytes(maximumBytes)}.");
        }
    }

    private static string DisplayProjectFileName(string path)
    {
        var name = Path.GetFileName(path);
        return name.EndsWith(".cabinet.json", StringComparison.OrdinalIgnoreCase)
            ? name[..^".cabinet.json".Length]
            : Path.GetFileNameWithoutExtension(name);
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} bytes";
        if (bytes < 1024 * 1024) return $"{bytes / 1024d:F1} KB";
        return $"{bytes / (1024d * 1024d):F1} MB";
    }

    private static bool ReadJsonBoolean(JsonElement? element, string propertyName, bool fallback)
    {
        if (!element.HasValue || element.Value.ValueKind != JsonValueKind.Object
            || !element.Value.TryGetProperty(propertyName, out var property)
            || property.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            return fallback;
        }
        return property.GetBoolean();
    }

    private static string? ReadJsonString(JsonElement? element, string propertyName)
    {
        return element.HasValue
            && element.Value.ValueKind == JsonValueKind.Object
            && element.Value.TryGetProperty(propertyName, out var property)
            && property.ValueKind == JsonValueKind.String
                ? property.GetString()
                : null;
    }

    private static string ChoiceName(LifecyclePromptChoice choice)
    {
        return choice switch
        {
            LifecyclePromptChoice.Save => "save",
            LifecyclePromptChoice.Discard => "discard",
            _ => "cancel"
        };
    }

    private static async Task ValidateUtf8ContentSizeAsync(
        string content,
        long maximumBytes,
        string label,
        CancellationToken cancellationToken)
    {
        var bytes = await Task.Run(() => Encoding.UTF8.GetByteCount(content), cancellationToken).ConfigureAwait(false);
        if (bytes > maximumBytes)
        {
            throw new InvalidDataException($"{label} data is {FormatBytes(bytes)}; the maximum supported size is {FormatBytes(maximumBytes)}.");
        }
    }

    private static async Task<string> ReadUtf8FileAsync(
        string path,
        long maximumBytes,
        string label,
        CancellationToken cancellationToken)
    {
        var fileState = await Task.Run(() =>
        {
            var info = new FileInfo(path);
            return (info.Exists, info.Length);
        }, cancellationToken).ConfigureAwait(false);
        if (!fileState.Exists) throw new FileNotFoundException($"{label} file no longer exists.", path);
        if (fileState.Length <= 0) throw new InvalidDataException($"{label} file is empty.");
        if (fileState.Length > maximumBytes)
        {
            throw new InvalidDataException($"{label} file is {FormatBytes(fileState.Length)}; the maximum supported size is {FormatBytes(maximumBytes)}.");
        }

        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            64 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var reader = new StreamReader(stream, Utf8NoBom, true, 64 * 1024, false);
        var content = await reader.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
        var actualBytes = Encoding.UTF8.GetByteCount(content);
        if (actualBytes > maximumBytes)
        {
            throw new InvalidDataException($"{label} file exceeds the {FormatBytes(maximumBytes)} size limit.");
        }
        return content;
    }

    private static Task<string?> ResolveExistingSourcePathAsync(string? sourcePath, CancellationToken cancellationToken)
    {
        return Task.Run(() => !string.IsNullOrWhiteSpace(sourcePath) && File.Exists(sourcePath)
            ? Path.GetFullPath(sourcePath)
            : null, cancellationToken);
    }

    private static async Task WriteUtf8AtomicallyAsync(string path, string content, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(path) ?? throw new InvalidDataException("The selected path has no parent directory.");
        var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        await Task.Run(() => Directory.CreateDirectory(directory), cancellationToken).ConfigureAwait(false);
        try
        {
            await File.WriteAllTextAsync(temporaryPath, content, Utf8NoBom, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            await Task.Run(() => File.Move(temporaryPath, path, true), CancellationToken.None).ConfigureAwait(false);
        }
        finally
        {
            await DeleteTemporaryFileAsync(temporaryPath).ConfigureAwait(false);
        }
    }

    private static async Task WriteBase64AtomicallyAsync(
        string path,
        string base64,
        long maximumBytes,
        CancellationToken cancellationToken)
    {
        const int inputBufferSize = 64 * 1024;
        await Task.Run(() => ValidateBase64Payload(base64, cancellationToken), cancellationToken).ConfigureAwait(false);
        var directory = Path.GetDirectoryName(path) ?? throw new InvalidDataException("The selected path has no parent directory.");
        var temporaryPath = Path.Combine(directory, $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");
        await Task.Run(() => Directory.CreateDirectory(directory), cancellationToken).ConfigureAwait(false);

        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                inputBufferSize,
                FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                using var transform = new FromBase64Transform(FromBase64TransformMode.IgnoreWhiteSpaces);
                var inputBuffer = ArrayPool<byte>.Shared.Rent(inputBufferSize);
                var outputBuffer = ArrayPool<byte>.Shared.Rent(inputBufferSize);
                try
                {
                    var offset = 0;
                    long totalBytes = 0;
                    while (base64.Length - offset > inputBufferSize)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        var inputCount = Encoding.ASCII.GetBytes(
                            base64.AsSpan(offset, inputBufferSize),
                            inputBuffer.AsSpan(0, inputBufferSize));
                        var outputCount = transform.TransformBlock(inputBuffer, 0, inputCount, outputBuffer, 0);
                        totalBytes = checked(totalBytes + outputCount);
                        if (totalBytes > maximumBytes)
                        {
                            throw new InvalidDataException($"Fabrication package exceeds the {FormatBytes(maximumBytes)} size limit.");
                        }
                        await stream.WriteAsync(outputBuffer.AsMemory(0, outputCount), cancellationToken).ConfigureAwait(false);
                        offset += inputBufferSize;
                    }

                    var finalCharacterCount = base64.Length - offset;
                    var finalInputCount = Encoding.ASCII.GetBytes(
                        base64.AsSpan(offset, finalCharacterCount),
                        inputBuffer.AsSpan(0, finalCharacterCount));
                    var finalBytes = transform.TransformFinalBlock(inputBuffer, 0, finalInputCount);
                    totalBytes = checked(totalBytes + finalBytes.LongLength);
                    if (totalBytes > maximumBytes)
                    {
                        throw new InvalidDataException($"Fabrication package exceeds the {FormatBytes(maximumBytes)} size limit.");
                    }
                    await stream.WriteAsync(finalBytes, cancellationToken).ConfigureAwait(false);
                    await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                }
                finally
                {
                    ArrayPool<byte>.Shared.Return(inputBuffer);
                    ArrayPool<byte>.Shared.Return(outputBuffer);
                }
            }

            cancellationToken.ThrowIfCancellationRequested();
            await Task.Run(() => File.Move(temporaryPath, path, true), CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is FormatException or CryptographicException)
        {
            throw new InvalidDataException("Fabrication package data is not valid base64.", exception);
        }
        finally
        {
            await DeleteTemporaryFileAsync(temporaryPath).ConfigureAwait(false);
        }
    }

    private static void ValidateBase64Payload(string base64, CancellationToken cancellationToken)
    {
        var symbolCount = 0;
        var paddingCount = 0;
        var paddingStarted = false;
        for (var index = 0; index < base64.Length; index++)
        {
            if ((index & 0xFFFF) == 0) cancellationToken.ThrowIfCancellationRequested();
            var character = base64[index];
            if (character is ' ' or '\t' or '\r' or '\n') continue;
            symbolCount++;
            if (character == '=')
            {
                paddingStarted = true;
                paddingCount++;
                if (paddingCount > 2) throw new InvalidDataException("Fabrication package data is not valid base64.");
                continue;
            }

            var validSymbol = character is >= 'A' and <= 'Z'
                or >= 'a' and <= 'z'
                or >= '0' and <= '9'
                or '+' or '/';
            if (!validSymbol || paddingStarted)
            {
                throw new InvalidDataException("Fabrication package data is not valid base64.");
            }
        }

        if ((symbolCount & 3) != 0)
        {
            throw new InvalidDataException("Fabrication package data is not valid base64.");
        }
    }

    private static Task DeleteTemporaryFileAsync(string path)
    {
        return Task.Run(() =>
        {
            if (File.Exists(path)) File.Delete(path);
        });
    }

    private async void MainWindow_PreviewKeyDown(object sender, KeyEventArgs eventArgs)
    {
        if (lifecyclePromptOverlay.Visibility == Visibility.Visible && eventArgs.Key == Key.Escape)
        {
            CompleteLifecyclePrompt(LifecyclePromptChoice.Cancel);
            eventArgs.Handled = true;
            return;
        }
#if DEBUG
        if (eventArgs.Key == Key.F12 && webView.CoreWebView2 is not null)
        {
            webView.CoreWebView2.OpenDevToolsWindow();
            eventArgs.Handled = true;
        }
        else if (eventArgs.Key == Key.F5)
        {
            webView.Reload();
            eventArgs.Handled = true;
        }
        else
#endif
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control) && eventArgs.Key is Key.S or Key.O)
        {
            var action = eventArgs.Key == Key.O
                ? "open"
                : Keyboard.Modifiers.HasFlag(ModifierKeys.Shift) ? "saveAs" : "save";
            if (webView.CoreWebView2 is not null)
            {
                await webView.CoreWebView2.ExecuteScriptAsync(
                    $"window.dispatchEvent(new CustomEvent('cabinet-desktop-shortcut', {{ detail: '{action}' }}));");
            }
            eventArgs.Handled = true;
        }
    }

    private sealed record PendingProjectCandidate(string Id, string Path);

    private sealed record RecoveryRecordInfo(
        string RecoveryId,
        string ProjectName,
        string? SourcePath,
        DateTimeOffset SavedAt,
        long SizeBytes);

    private enum LifecyclePromptChoice
    {
        Save,
        Discard,
        Cancel
    }

    private const string DesktopBridgeScript = """
        (() => {
            const pending = new Map();
            let sequence = 0;

            const postConsole = (level, args) => {
                try {
                    const rendered = args.map(value => typeof value === 'object' ? JSON.stringify(value) : String(value)).join(' ');
                    window.chrome.webview.postMessage(`${level}: ${rendered}`);
                } catch { }
            };

            ['log', 'warn', 'error'].forEach(level => {
                const original = console[level].bind(console);
                console[level] = (...args) => {
                    original(...args);
                    postConsole(level, args);
                };
            });

            window.addEventListener('error', event => postConsole('exception', [event.message, event.filename, event.lineno]));
            window.addEventListener('unhandledrejection', event => postConsole('unhandled_rejection', [event.reason?.stack || event.reason]));

            window.cabinetDesktop = Object.freeze({
                available: true,
                request(type, payload = {}) {
                    const requestId = `desktop-${Date.now()}-${++sequence}`;
                    return new Promise((resolve, reject) => {
                        pending.set(requestId, { resolve, reject });
                        window.chrome.webview.postMessage({ kind: 'cabinetRequest', requestId, type, payload });
                    });
                }
            });

            window.chrome.webview.addEventListener('message', event => {
                const message = event.data;
                if (!message || message.kind !== 'cabinetResponse') return;
                const request = pending.get(message.requestId);
                if (!request) return;
                pending.delete(message.requestId);
                if (message.ok) request.resolve(message.payload);
                else request.reject(new Error(message.error || 'Desktop request failed'));
            });
        })();
        """;
}
