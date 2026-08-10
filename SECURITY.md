# Security Policy

## Supported Releases

Security fixes target the latest published Cabinet Crafter release. Older releases and unbuilt source snapshots may not receive fixes.

## Reporting A Vulnerability

Use GitHub Private Vulnerability Reporting for this repository when it is available. Include:

- the affected Cabinet Crafter version;
- Windows and WebView2 Runtime versions;
- a minimal reproduction;
- the expected and observed result;
- the likely impact; and
- any suggested mitigation.

Do not include secrets, personal project files, or dangerous machine instructions. If private vulnerability reporting is not enabled, open a public issue that asks the maintainer for a private reporting route, but do not publish exploit details in that issue.

No response or resolution time is guaranteed. The maintainer will assess reports according to reproducibility, impact, and the safety of users and their fabrication output.

## Scope

Relevant issues include unsafe file handling, untrusted project or hardware-definition parsing, export path escapes, script execution, tampered release packages, sensitive local-data exposure, and manufacturing output that can be changed without a visible validation failure.

General feature requests, expected local project contents, and fabrication advice without a software security impact belong in the normal issue tracker.

## Verifying A Release

Download releases only from the [latest published GitHub Release](../../releases/latest). Choose the versioned `CabinetCrafter-<version>-win-x64.zip`, not GitHub's generic source-code archive, and compare it with its published SHA-256 checksum before extraction. A checksum confirms file integrity against the published release; it does not prove publisher identity. Authenticode publisher verification is available only when the release workflow has been configured with a valid signing certificate.
