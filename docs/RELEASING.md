# Maintainer Release Process

Status: maintainer reference  
Last updated: 2026-08-10

This process builds the same versioned win-x64 package locally and in GitHub Actions. The application does not contain a repository URL, signing identity, or credential.

Generated folders are explained in [Repository And Build Folder Guide](REPOSITORY_STRUCTURE.md). Do not commit `bin/`, `obj/`, `artifacts/`, or `tools/tmp/`. The public repository is the source distribution; the versioned ZIP attached to a GitHub Release is the Windows binary distribution.

## Local Candidate

1. Update `<Version>` in `CabinetCrafter.csproj`.
2. Run `dotnet restore CabinetCrafter.csproj --runtime win-x64 --locked-mode`.
3. Run `npm test`.
4. Run `.\tools\build-release.cmd`.
5. Extract the generated ZIP and confirm it has one versioned root folder.
6. Compare the ZIP with its `.sha256` file.
7. Run the extracted executable, complete the smoke route, and inspect the end-user documents.

The script fails when required runtime assets, local JavaScript module dependencies, licences, notices, end-user documents, or clean-package constraints are missing. It derives the WebView2 version from `packages.lock.json`, derives the exact .NET Core and Windows Desktop runtime packs from the published dependency manifest, and copies their upstream licences and available notices from those resolved packages. It also packages the tagged Three.js licence and writes `RELEASE_MANIFEST.sha256` in ordinal path order, verifying every other packaged file against that manifest. The release workflow regenerates and verifies this complete file manifest after optional executable signing and before SBOM generation. The SPDX document inventories software components detected by the SBOM tool; it is not a replacement for the file manifest.

## GitHub Release

Create and push a tag that exactly matches the project version with a `v` prefix. Version `2.0.0` therefore uses tag `v2.0.0`.

The release workflow:

1. confirms that the tag and project version match;
2. runs the complete Node test suite;
3. restores NuGet in locked mode;
4. publishes and validates the staged self-contained application;
5. optionally signs `CabinetCrafter.exe`;
6. runs the packaged startup smoke;
7. creates an SPDX JSON SBOM;
8. creates the rooted ZIP and SHA-256 files; and
9. publishes the files through GitHub Releases.

The workflow derives the repository and release destination from GitHub Actions context. No repository URL is hard-coded.

GitHub also adds generic **Source code (zip)** and **Source code (tar.gz)** downloads. Those are source snapshots, not the portable Windows build. End-user documentation must point to `CabinetCrafter-<version>-win-x64.zip`. Actions artifacts are temporary workflow evidence and must not be presented as the canonical public download.

## Optional Authenticode Signing

Signing is skipped when no signing secrets are present. Configure all required values in GitHub Actions repository secrets:

| Secret | Purpose |
| --- | --- |
| `WINDOWS_SIGNING_CERTIFICATE_BASE64` | Base64-encoded PFX certificate file. |
| `WINDOWS_SIGNING_CERTIFICATE_PASSWORD` | Password for the PFX file. |
| `WINDOWS_SIGNING_TIMESTAMP_URL` | Optional trusted RFC 3161 timestamp service URL. |

If only one required signing secret is present, the workflow fails instead of silently publishing an unexpectedly unsigned package. The temporary PFX is removed in the signing step's `finally` block.

The maintainer must choose, purchase, protect, renew, and revoke the appropriate code-signing certificate. This repository intentionally provides no signing credential or assumed timestamp provider.

## Release Review

- Confirm the repository is public, the root README download link reaches the latest published release, and GitHub Issues and Private Vulnerability Reporting are configured as intended.
- Confirm the target .NET version and Windows editions remain within their upstream support lifecycles; prefer an LTS runtime for a long-lived public release.
- Confirm all release files use the intended version.
- Confirm the ZIP checksum and SBOM checksum.
- Confirm the executable signature when signing is configured.
- Confirm `LICENSE.txt`, all third-party notices, the end-user `README.md`, privacy guidance, and the fabrication safety checklist are present.
- Confirm `RELEASE_MANIFEST.sha256` is present and that the package smoke check reports every manifest hash as verified.
- Test on a representative clean Windows x64 system with WebView2.
- Test the complete first-time route from the public Releases page: choose the correct asset, verify it, extract it, start it, save a project, and create an export.
- Do not publish a package that was manually changed after its checksums or SBOM were generated.
