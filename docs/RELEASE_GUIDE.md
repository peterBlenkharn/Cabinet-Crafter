# Windows Release Guide

Cabinet Crafter is distributed as a portable Windows x64 ZIP. It has no installer and does not require administrator access for normal use.

## Choose The Correct Download

Open the latest published GitHub Release and expand its **Assets** section. Download the versioned `CabinetCrafter-<version>-win-x64.zip` application and the matching `.zip.sha256` file.

Do not download GitHub's automatically generated **Source code (zip)** or **Source code (tar.gz)** files when you want to run Cabinet Crafter. Those contain the repository source, not the built Windows application. GitHub Actions artifacts are temporary test outputs and are not the normal public download.

An accompanying `.spdx.json` file is the software bill of materials for auditing. It is not an additional application package.

## What SHA-256 Means

SHA-256 creates a fingerprint of a file. The matching `.zip.sha256` file records the fingerprint of the ZIP published beside it. If the ZIP is incomplete, damaged, or changed, the calculated fingerprint will not match.

A match confirms that the ZIP is identical to the file represented by the published checksum. It does not prove the publisher's identity. A valid Authenticode signature provides publisher identity when release signing has been configured.

## Install And Start

1. Put the versioned ZIP and its `.sha256` file in the same download folder.
2. Compare the ZIP's SHA-256 value with the published checksum. From PowerShell in the download folder, replace `2.0.0` below with the downloaded version and run:

   ```powershell
   $zip = "CabinetCrafter-2.0.0-win-x64.zip"
   $expected = ((Get-Content -LiteralPath "$zip.sha256" -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
   $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
   if ($actual -ne $expected) { throw "Checksum mismatch. Do not run or extract this download." }
   "Checksum verified: $actual"
   ```

   Continue only when PowerShell prints `Checksum verified`. A mismatch means the ZIP is damaged or does not match the published release.
3. Extract the complete ZIP. Do not run the application from inside the ZIP.
4. Open the extracted versioned folder.
5. Run `CabinetCrafter.exe`.

Keep the executable, DLLs, runtime files, notice files, and `wwwroot` folder together. Moving only the executable will produce an incomplete application.

The package includes the .NET runtime. A supported Microsoft Edge WebView2 Runtime is also required and is normally already present. If Cabinet Crafter reports that it is missing, install or repair it from the [official Microsoft WebView2 page](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

`RELEASE_MANIFEST.sha256` records a SHA-256 hash for every other packaged file. Cabinet Crafter's release checks verify that manifest before creating the ZIP. Keep it with the application if you archive or redistribute the extracted package.

## Windows Warnings

An unsigned build can trigger Microsoft Defender SmartScreen. Confirm that the download came from the project's published GitHub Release and that its SHA-256 checksum matches before choosing whether to run it. Do not ignore a checksum mismatch.

When a release is Authenticode-signed, inspect the file's Digital Signatures tab and confirm the expected publisher before running it. Signing is optional for community builds, so a signature may not be present.

## First Project

Open Help and choose **Build my first cabinet** for an end-to-end practice project. The shorter **Interface Tour** explains where the main controls are without confirming workflow stages. Save a named project early, complete Hardware and Review confirmation, validate material assignments and sheet layouts, then open Export.

Fabrication output is not direct machine control. Review [Before You Cut](BEFORE_YOU_CUT.md) before using exported geometry in CAM or a workshop.

## Update

1. Save open projects.
2. Download and verify the new version.
3. Extract it to a new folder rather than overwriting a running copy.
4. Open an existing `.cabinet.json` project in the new version.
5. Review the design and fabrication findings before exporting again.
6. Keep the previous application folder until representative projects have been checked.

Local preferences, recovery data, and recent-file paths remain in `%LOCALAPPDATA%\CabinetCrafter`. Portable project files remain wherever you saved them.

## Uninstall

Close Cabinet Crafter and remove its extracted application folder. For optional removal of recovery history and local preferences, follow [Privacy And Offline Use](PRIVACY_AND_OFFLINE.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Nothing opens | Extract the whole ZIP, confirm the checksum, and check whether Windows blocked the downloaded ZIP or executable. |
| WebView2 error | Install or repair the Microsoft Edge WebView2 Runtime, then restart Cabinet Crafter. |
| Blank or incomplete interface | Confirm that the `wwwroot` folder is beside the executable and was not removed by an incomplete copy or antivirus action. |
| A packaged file is reported as changed | Download and verify a fresh ZIP. Do not continue with a package that fails its published ZIP checksum or internal release-manifest check. |
| Project appears missing | Use Open and select the saved `.cabinet.json` file. The recent list stores paths, not duplicate project files. |
| Recovery prompt is unexpected | Review the timestamp and contents before accepting. Recovery is a local autosave, not a replacement for named saves. |
| Export is blocked | Open Review, resolve all errors, acknowledge reviewed warnings, and validate material and sheet choices when creating a package. |

If a repeatable fault remains, return to the GitHub repository from which the release was downloaded and report the Cabinet Crafter version, Windows version, WebView2 Runtime version, steps, and a minimal non-sensitive project through its issue tracker.

## Licence And Publisher

Copyright (c) 2026 Peter Blenkharn. CumberlandQuail is the publisher name. For personally signed official releases, the expected Authenticode signer is Peter Blenkharn.

Cabinet Crafter's original work is open-source software provided under the MIT License. The release includes the full terms in `LICENSE.txt`. Bundled and redistributed components retain their upstream terms, recorded in `THIRD_PARTY_NOTICES.txt` and the release's SPDX inventory.
