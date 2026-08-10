# Contributing To Cabinet Crafter

Thank you for helping improve Cabinet Crafter. Bug reports, fabrication-domain feedback, documentation fixes, accessibility improvements, tests, and focused code changes are welcome.

## Before Starting A Change

- Search the issue tracker for related work and open an issue before a large or compatibility-sensitive change.
- Keep fabrication behaviour fail-closed: production output must not bypass errors, warnings, material checks, or sheet validation.
- Do not include personal project files, secrets, signing credentials, generated build folders, or third-party material you do not have the right to submit.

## Development Checks

Install the .NET SDK selected by `global.json`. Node.js 20 or later is required for the JavaScript contracts.

```powershell
dotnet restore CabinetCrafter.csproj --runtime win-x64 --locked-mode
npm test
dotnet build CabinetCrafter.csproj --configuration Release --runtime win-x64 --no-restore
```

For a release-related change, also follow [Maintainer Release Process](docs/RELEASING.md) and build the portable candidate with `tools\build-release.cmd`.

Do not commit `bin/`, `obj/`, `artifacts/`, `node_modules/`, or `tools/tmp/`. See [Repository And Build Folder Guide](docs/REPOSITORY_STRUCTURE.md) for the distinction between source, staging, and public release assets.

## Tests And Documentation

- Add or update deterministic tests for behaviour changes.
- Update the relevant canonical document under `docs/` when a contract, workflow, parameter, export, or limitation changes.
- Keep first-time guidance plain and power-user detail discoverable.
- Treat exported geometry as safety-relevant data and include regression fixtures for changes that affect dimensions, operations, nesting, or cost totals.

## Inbound Licence

Cabinet Crafter's original work is distributed under the MIT License. By submitting a contribution, you agree that your contribution is provided under the project's [MIT License](LICENSE), and you confirm that you have the right to provide it on those terms.

Identify any third-party material explicitly and preserve all required copyright, licence, and notice information. Do not submit code, artwork, documentation, hardware data, or other material under terms that are incompatible with this repository and its distribution model.

## Security

Do not open a public issue containing exploit details. Follow [SECURITY.md](SECURITY.md) for vulnerability reporting.
