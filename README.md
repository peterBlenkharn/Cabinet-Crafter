# Cabinet Crafter

Cabinet Crafter is an offline Windows application for taking an arcade cabinet from a parametric design through hardware planning, fabrication checks, sheet layouts, costing, and production exports.

The project's original source code and documentation are open source under the [MIT License](LICENSE). Third-party components retain their upstream licence terms, recorded in [Third-Party Notices](THIRD_PARTY_NOTICES.md).

## Download for Windows

**[Download the latest published Windows x64 release](../../releases/latest)**

In the release's **Assets** section, download:

- `CabinetCrafter-<version>-win-x64.zip` - the application; and
- `CabinetCrafter-<version>-win-x64.zip.sha256` - the optional but recommended integrity check.

Do not choose GitHub's automatically generated **Source code (zip)** file unless you want the source rather than a runnable application. GitHub Releases are the normal public download location; GitHub Actions artifacts are short-lived test outputs for maintainers.

Cabinet Crafter is portable: there is no installer and normal use does not require administrator access. Extract the entire ZIP, open the versioned folder, and run `CabinetCrafter.exe`. Do not run it from inside the ZIP or move the executable away from its supporting files.

The package includes its own .NET runtime. It targets Windows x64, with an up-to-date Windows 11 x64 machine as the recommended path. A Microsoft Edge WebView2 Runtime is also required; it is normally already installed and can be obtained from the [official Microsoft WebView2 page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) if needed. There is not currently a native ARM64 release.

For verification, Windows warnings, updates, and troubleshooting, follow the [Windows Release Guide](docs/RELEASE_GUIDE.md).

## What the SHA-256 files are for

SHA-256 produces a digital fingerprint of a file. If one byte changes because a download is incomplete, damaged, or replaced, the fingerprint changes too.

- The external `.zip.sha256` file lets you compare the downloaded ZIP with the value published beside it.
- The `RELEASE_MANIFEST.sha256` file inside the extracted application records a fingerprint for every packaged file.
- The `.spdx.json` release asset is a software bill of materials for dependency and licence auditing; it is not another application download.

A matching checksum confirms that your file matches the file published with that release. It does not by itself prove who published the file; an Authenticode digital signature provides publisher identity when release signing is configured.

## The five-stage workflow

1. **Design** - choose a cabinet form, set dimensions, tune parts, and preview the result in 3D.
2. **Hardware** - lay out controls, select real components, review clearances, and enter component quantities and costs.
3. **Review** - resolve manufacturability errors and consciously acknowledge warnings before production output.
4. **Sheets** - assign materials and thicknesses, define purchasable sheet sizes and costs, and inspect or adjust the nesting plan.
5. **Export** - produce drawings, SVG/DXF sheet files, cut lists, labels, drilling templates, assembly guidance, and a total bill of materials.

The same workspace also provides exact numeric entry, millimetre/inch display, undo/redo, autosave recovery, named project files, recent projects, reusable presets, contextual help, and detailed controls for power users.

Fabrication output is not direct machine control. Validate dimensions, materials, tooling, CAM settings, machine behaviour, and a representative test cut before committing stock. Read [Before You Cut](docs/BEFORE_YOU_CUT.md) and [Implementation Status](docs/IMPLEMENTATION_STATUS.md) before treating advanced features as production complete.

## Documentation

- [Documentation Index](docs/INDEX.md) - the complete user and technical documentation map.
- [Windows Release Guide](docs/RELEASE_GUIDE.md) - download, verify, extract, start, update, uninstall, and troubleshoot.
- [Repository And Build Folder Guide](docs/REPOSITORY_STRUCTURE.md) - what `bin`, `obj`, `artifacts`, `Debug`, `Release`, and `staging` mean.
- [Privacy And Offline Use](docs/PRIVACY_AND_OFFLINE.md) - local data and removal behaviour.
- [Before You Cut](docs/BEFORE_YOU_CUT.md) - fabrication safety checklist.
- [Architecture](docs/ARCHITECTURE.md) - desktop shell, local web workspace, and data ownership.
- [Contributing](CONTRIBUTING.md) - checks, generated-file hygiene, and inbound MIT licensing.
- [Maintainer Release Process](docs/RELEASING.md) - versioning, checks, signing, SBOM, and tag publication.
- [Security Policy](SECURITY.md) and [Changelog](docs/CHANGELOG.md).

## Build and run from source

To build and open the application, install the .NET SDK selected by `global.json` and the Microsoft Edge WebView2 Runtime. Node.js 20 or later is needed for the test suite; PowerShell 7 or Windows PowerShell 5.1 is needed for release packaging. Restore is locked by `packages.lock.json`.

From a source checkout:

```powershell
dotnet restore CabinetCrafter.csproj --locked-mode
dotnet run --project CabinetCrafter.csproj
```

Run the complete automated test suite with:

```powershell
npm test
```

## Build a release candidate

```powershell
dotnet restore CabinetCrafter.csproj --runtime win-x64 --locked-mode
.\tools\build-release.cmd
```

That command creates only generated output:

| Path | Meaning |
| --- | --- |
| `artifacts/release/staging/CabinetCrafter-<version>-win-x64/` | Exact unpacked candidate used for validation and local smoke testing. |
| `artifacts/release/CabinetCrafter-<version>-win-x64.zip` | Portable file to attach to the GitHub Release. |
| `artifacts/release/CabinetCrafter-<version>-win-x64.zip.sha256` | SHA-256 fingerprint published beside the ZIP. |

The packaging script includes the self-contained .NET runtime, application assets, end-user guidance, licences, and notices. It rejects source/debug files, checks the local JavaScript dependency graph, writes and verifies the internal release manifest, and creates a ZIP with one versioned root folder.

A tag named exactly `v<project-version>`, such as `v2.0.0`, runs the GitHub release workflow. The workflow repeats the checks, optionally Authenticode-signs the executable, generates an SPDX bill of materials, and publishes the versioned files under GitHub Releases. See the [maintainer process](docs/RELEASING.md) before tagging.

## Repository at a glance

| Location | Purpose |
| --- | --- |
| Root C# and project files | WPF/WebView2 desktop host and build metadata. |
| `wwwroot/` | The bundled Three.js modelling interface and fabrication logic. |
| `assets/` | Source icons and visual assets. |
| `docs/` | User, contributor, architecture, fabrication, and release guidance. |
| `tests/` | Headless contracts, regression coverage, and package smoke checks. |
| `tools/` | Release and performance tooling. |
| `.github/workflows/` | Pull-request, continuous-integration, and tagged-release automation. |
| `bin/`, `obj/`, `artifacts/`, `tools/tmp/` | Disposable generated output; do not commit these folders. |

The [Repository And Build Folder Guide](docs/REPOSITORY_STRUCTURE.md) explains the generated folders and which output, if any, should be given to users.

## Licence and support

Copyright (c) 2026 Peter Blenkharn. CumberlandQuail is the publisher name.

Cabinet Crafter's original work is provided under the [MIT License](LICENSE). Bundled and redistributed components keep their original terms; see [Third-Party Notices](THIRD_PARTY_NOTICES.md) and the SPDX inventory attached to each official release.

Use [GitHub Issues](../../issues) for reproducible bugs and feature requests. Report security problems through the process in [SECURITY.md](SECURITY.md), without publishing exploit details or private project data.
