[CmdletBinding()]
param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [ValidatePattern("^win-[A-Za-z0-9]+$")]
    [string]$Runtime = "win-x64",

    [string]$OutputRoot,

    [switch]$NoRestore,

    [switch]$SkipPublish,

    [switch]$SkipArchive
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-FullPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$BasePath
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Assert-PathInside {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Candidate,

        [Parameter(Mandatory = $true)]
        [string]$Parent,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
    $parentPath = [System.IO.Path]::GetFullPath($Parent).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar)
    $prefix = $parentPath + [System.IO.Path]::DirectorySeparatorChar

    if (-not $candidatePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must remain inside $parentPath. Resolved path: $candidatePath"
    }
}

function Get-RequiredFile {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Candidates,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    foreach ($candidate in $Candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    throw "Could not locate $Description. Checked: $($Candidates -join ', ')"
}

function Copy-RequiredFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Required release file is missing: $Source"
    }

    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Write-ReleaseManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageDirectory
    )

    $packageRoot = [System.IO.Path]::GetFullPath($PackageDirectory).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar)
    $packagePrefix = $packageRoot + [System.IO.Path]::DirectorySeparatorChar
    $manifestPath = Join-Path $packageRoot "RELEASE_MANIFEST.sha256"
    [string[]]$relativeFiles = @(Get-ChildItem -LiteralPath $packageRoot -Recurse -File |
        Where-Object {
            -not $_.FullName.Equals($manifestPath, [System.StringComparison]::OrdinalIgnoreCase)
        } |
        ForEach-Object {
            $fullPath = [System.IO.Path]::GetFullPath($_.FullName)
            if (-not $fullPath.StartsWith($packagePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Release manifest input is outside the package: $fullPath"
            }
            $fullPath.Substring($packagePrefix.Length).Replace("\", "/")
        })
    [System.Array]::Sort($relativeFiles, [System.StringComparer]::Ordinal)

    $manifestLines = @($relativeFiles | ForEach-Object {
        $sourcePath = Join-Path $packageRoot ($_.Replace("/", "\"))
        $hash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $_"
    })
    $manifestText = if ($manifestLines.Count -gt 0) {
        ($manifestLines -join "`n") + "`n"
    } else {
        ""
    }
    [System.IO.File]::WriteAllText(
        $manifestPath,
        $manifestText,
        (New-Object System.Text.UTF8Encoding($false)))
}

function Write-GitHubOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($env:GITHUB_OUTPUT)) {
        return
    }

    "$Name=$Value" | Out-File -LiteralPath $env:GITHUB_OUTPUT -Append -Encoding utf8
}

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$projectPath = Join-Path $repositoryRoot "CabinetCrafter.csproj"
$projectXml = [xml](Get-Content -LiteralPath $projectPath -Raw)
$versionPropertyGroup = @($projectXml.Project.PropertyGroup | Where-Object {
    $versionNode = $_.SelectSingleNode("Version")
    $null -ne $versionNode -and -not [string]::IsNullOrWhiteSpace($versionNode.InnerText)
}) | Select-Object -First 1
$version = [string]$versionPropertyGroup.SelectSingleNode("Version").InnerText

if ([string]::IsNullOrWhiteSpace($version) -or $version -notmatch "^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$") {
    throw "CabinetCrafter.csproj must contain a semantic Version value. Found: '$version'"
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repositoryRoot "artifacts\release"
}

$outputRootPath = Get-FullPath -Path $OutputRoot -BasePath $repositoryRoot
Assert-PathInside -Candidate $outputRootPath -Parent $repositoryRoot -Label "OutputRoot"

$packageName = "CabinetCrafter-$version-$Runtime"
$stagingRoot = Join-Path $outputRootPath "staging"
$packageDirectory = Join-Path $stagingRoot $packageName
$archivePath = Join-Path $outputRootPath "$packageName.zip"
$checksumPath = "$archivePath.sha256"

Assert-PathInside -Candidate $packageDirectory -Parent $outputRootPath -Label "Package directory"
Assert-PathInside -Candidate $archivePath -Parent $outputRootPath -Label "Archive"
Assert-PathInside -Candidate $checksumPath -Parent $outputRootPath -Label "Checksum"

if (-not $SkipPublish) {
    if (Test-Path -LiteralPath $packageDirectory) {
        Remove-Item -LiteralPath $packageDirectory -Recurse -Force
    }

    New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null

    if (-not $NoRestore) {
        & dotnet restore $projectPath --runtime $Runtime --locked-mode --nologo
        if ($LASTEXITCODE -ne 0) {
            throw "dotnet restore failed with exit code $LASTEXITCODE."
        }
    }

    & dotnet publish $projectPath `
        --configuration $Configuration `
        --runtime $Runtime `
        --self-contained true `
        --no-restore `
        --nologo `
        --output $packageDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed with exit code $LASTEXITCODE."
    }

    Copy-RequiredFile -Source (Join-Path $repositoryRoot "LICENSE") -Destination (Join-Path $packageDirectory "LICENSE.txt")
    Copy-RequiredFile -Source (Join-Path $repositoryRoot "THIRD_PARTY_NOTICES.md") -Destination (Join-Path $packageDirectory "THIRD_PARTY_NOTICES.txt")
    Copy-RequiredFile -Source (Join-Path $repositoryRoot "assets\third-party\THREEJS_LICENSE.txt") -Destination (Join-Path $packageDirectory "THREEJS_LICENSE.txt")
    Copy-RequiredFile -Source (Join-Path $repositoryRoot "docs\RELEASE_GUIDE.md") -Destination (Join-Path $packageDirectory "README.md")
    Copy-RequiredFile -Source (Join-Path $repositoryRoot "docs\PRIVACY_AND_OFFLINE.md") -Destination (Join-Path $packageDirectory "PRIVACY_AND_OFFLINE.md")
    Copy-RequiredFile -Source (Join-Path $repositoryRoot "docs\BEFORE_YOU_CUT.md") -Destination (Join-Path $packageDirectory "BEFORE_YOU_CUT.md")

    $nugetOutput = @(& dotnet nuget locals global-packages --list)
    $nugetExitCode = $LASTEXITCODE
    $globalPackagesLine = $nugetOutput |
        Where-Object { $_ -match "^global-packages:\s*" } |
        Select-Object -First 1
    $globalPackagesCandidates = @(
        $(if (-not [string]::IsNullOrWhiteSpace($env:NUGET_PACKAGES)) { $env:NUGET_PACKAGES }),
        $(if ($nugetExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($globalPackagesLine)) {
            ($globalPackagesLine -replace "^global-packages:\s*", "").Trim()
        }),
        (Join-Path $env:USERPROFILE ".nuget\packages")
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    $packageLockPath = Join-Path $repositoryRoot "packages.lock.json"
    $packageLock = Get-Content -LiteralPath $packageLockPath -Raw | ConvertFrom-Json
    $webViewVersions = @($packageLock.dependencies.PSObject.Properties | ForEach-Object {
        $packageProperty = $_.Value.PSObject.Properties |
            Where-Object { $_.Name -eq "Microsoft.Web.WebView2" } |
            Select-Object -First 1
        if ($null -ne $packageProperty -and -not [string]::IsNullOrWhiteSpace($packageProperty.Value.resolved)) {
            [string]$packageProperty.Value.resolved
        }
    } | Sort-Object -Unique)
    if ($webViewVersions.Count -ne 1) {
        throw "packages.lock.json must resolve exactly one Microsoft.Web.WebView2 version. Found: $($webViewVersions -join ', ')"
    }
    $webViewVersion = $webViewVersions[0]
    $webViewPackage = $globalPackagesCandidates |
        ForEach-Object { Join-Path $_ "microsoft.web.webview2\$webViewVersion" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
        Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($webViewPackage)) {
        throw "Could not locate the locked Microsoft.Web.WebView2 $webViewVersion package in the NuGet cache."
    }
    Copy-RequiredFile -Source (Join-Path $webViewPackage "LICENSE.txt") -Destination (Join-Path $packageDirectory "WEBVIEW2_LICENSE.txt")
    Copy-RequiredFile -Source (Join-Path $webViewPackage "NOTICE.txt") -Destination (Join-Path $packageDirectory "WEBVIEW2_THIRD_PARTY_NOTICES.txt")

    $dependencyManifestPath = Join-Path $packageDirectory "CabinetCrafter.deps.json"
    $dependencyManifest = Get-Content -LiteralPath $dependencyManifestPath -Raw | ConvertFrom-Json
    $runtimeTargetName = [string]$dependencyManifest.runtimeTarget.name
    $runtimeTarget = $dependencyManifest.targets.PSObject.Properties |
        Where-Object { $_.Name -eq $runtimeTargetName } |
        Select-Object -First 1
    if ($null -eq $runtimeTarget) {
        throw "CabinetCrafter.deps.json does not contain its declared runtime target '$runtimeTargetName'."
    }
    $applicationDependencyNode = $runtimeTarget.Value.PSObject.Properties |
        Where-Object { $_.Name -like "CabinetCrafter/*" } |
        Select-Object -First 1
    if ($null -eq $applicationDependencyNode) {
        throw "CabinetCrafter.deps.json does not contain the CabinetCrafter application dependency node."
    }
    $runtimeDependencies = @($applicationDependencyNode.Value.dependencies.PSObject.Properties)

    $coreRuntimePackageId = "Microsoft.NETCore.App.Runtime.$Runtime"
    $windowsDesktopPackageId = "Microsoft.WindowsDesktop.App.Runtime.$Runtime"
    $coreRuntimeDependencyName = "runtimepack.$coreRuntimePackageId"
    $windowsDesktopDependencyName = "runtimepack.$windowsDesktopPackageId"
    $coreRuntimeDependency = $runtimeDependencies |
        Where-Object { $_.Name -eq $coreRuntimeDependencyName } |
        Select-Object -First 1
    $windowsDesktopDependency = $runtimeDependencies |
        Where-Object { $_.Name -eq $windowsDesktopDependencyName } |
        Select-Object -First 1
    if ($null -eq $coreRuntimeDependency -or $null -eq $windowsDesktopDependency) {
        throw "The published dependency manifest must declare both '$coreRuntimeDependencyName' and '$windowsDesktopDependencyName'."
    }

    $coreRuntimeVersion = [string]$coreRuntimeDependency.Value
    $windowsDesktopVersion = [string]$windowsDesktopDependency.Value
    $coreRuntimePackage = $globalPackagesCandidates |
        ForEach-Object { Join-Path $_ "$($coreRuntimePackageId.ToLowerInvariant())\$coreRuntimeVersion" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
        Select-Object -First 1
    $windowsDesktopPackage = $globalPackagesCandidates |
        ForEach-Object { Join-Path $_ "$($windowsDesktopPackageId.ToLowerInvariant())\$windowsDesktopVersion" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
        Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($coreRuntimePackage)) {
        throw "Could not locate the resolved $coreRuntimePackageId $coreRuntimeVersion package in the NuGet cache."
    }
    if ([string]::IsNullOrWhiteSpace($windowsDesktopPackage)) {
        throw "Could not locate the resolved $windowsDesktopPackageId $windowsDesktopVersion package in the NuGet cache."
    }

    Copy-RequiredFile -Source (Join-Path $coreRuntimePackage "LICENSE.TXT") -Destination (Join-Path $packageDirectory "DOTNET_RUNTIME_LICENSE.txt")
    Copy-RequiredFile -Source (Join-Path $coreRuntimePackage "THIRD-PARTY-NOTICES.TXT") -Destination (Join-Path $packageDirectory "DOTNET_RUNTIME_THIRD_PARTY_NOTICES.txt")
    Copy-RequiredFile -Source (Join-Path $windowsDesktopPackage "LICENSE") -Destination (Join-Path $packageDirectory "WINDOWS_DESKTOP_RUNTIME_LICENSE.txt")

    $runtimePackageText = @(
        "$coreRuntimePackageId $coreRuntimeVersion",
        "$windowsDesktopPackageId $windowsDesktopVersion"
    ) -join "`n"
    [System.IO.File]::WriteAllText(
        (Join-Path $packageDirectory "DOTNET_RUNTIME_PACKAGES.txt"),
        $runtimePackageText + "`n",
        (New-Object System.Text.UTF8Encoding($false)))
}

if (-not (Test-Path -LiteralPath $packageDirectory -PathType Container)) {
    throw "Release package directory does not exist: $packageDirectory"
}

Write-ReleaseManifest -PackageDirectory $packageDirectory

& node (Join-Path $repositoryRoot "tests\publish-smoke.mjs") $packageDirectory
if ($LASTEXITCODE -ne 0) {
    throw "Release package validation failed with exit code $LASTEXITCODE."
}

$debugFiles = @(Get-ChildItem -LiteralPath $packageDirectory -Recurse -File | Where-Object {
    $_.Extension -in @(".pdb", ".cs", ".csproj", ".sln", ".user", ".suo")
})
if ($debugFiles.Count -gt 0) {
    throw "Release contains source or debug files: $($debugFiles.FullName -join ', ')"
}

if (-not $SkipArchive) {
    foreach ($existingOutput in @($archivePath, $checksumPath)) {
        if (Test-Path -LiteralPath $existingOutput) {
            Remove-Item -LiteralPath $existingOutput -Force
        }
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $packageDirectory,
        $archivePath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $true)

    $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $expectedPrefix = "$packageName/"
        $invalidEntries = @($archive.Entries | Where-Object {
            $normalized = $_.FullName.Replace("\", "/")
            -not $normalized.StartsWith($expectedPrefix, [System.StringComparison]::Ordinal) -or
            $normalized.Contains("../") -or
            $normalized.StartsWith("/")
        })
        if ($invalidEntries.Count -gt 0) {
            throw "Archive contains entries outside the versioned root: $($invalidEntries.FullName -join ', ')"
        }
    }
    finally {
        $archive.Dispose()
    }

    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksumLine = "$hash  $([System.IO.Path]::GetFileName($archivePath))`n"
    [System.IO.File]::WriteAllText(
        $checksumPath,
        $checksumLine,
        (New-Object System.Text.UTF8Encoding($false)))
}

Write-GitHubOutput -Name "version" -Value $version
Write-GitHubOutput -Name "package_name" -Value $packageName
Write-GitHubOutput -Name "package_dir" -Value $packageDirectory
Write-GitHubOutput -Name "archive_path" -Value $archivePath
Write-GitHubOutput -Name "checksum_path" -Value $checksumPath

Write-Host "Release package validated: $packageDirectory"
if (-not $SkipArchive) {
    Write-Host "Release archive: $archivePath"
    Write-Host "SHA-256: $checksumPath"
}
