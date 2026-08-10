# Privacy And Offline Use

Cabinet Crafter is a local Windows application. It does not require an account and the application code does not send analytics, telemetry, designs, hardware definitions, or fabrication output to a Cabinet Crafter service.

## Information Kept On This Computer

Project files and exports are written only to locations you select. The desktop application also uses:

`%LOCALAPPDATA%\CabinetCrafter`

This folder can contain:

- `autosave.cabinet.json`, used for crash and restart recovery;
- `recent-projects.json`, containing paths to recently opened project files; and
- `BrowserData`, the private WebView2 profile that stores local preferences such as theme, display units, learning progress, browser-mode recovery data, and user presets.

Cabinet Crafter does not copy project or export contents to the Windows clipboard unless you explicitly use an operating-system or application copy action.

## Network Behaviour

The bundled workspace, help, Three.js code, and project processing run locally. Cabinet Crafter does not include an update checker or an application network service.

Microsoft Edge WebView2 is a separate Microsoft runtime. Windows or Microsoft Edge may update that runtime and may use network services under Microsoft's settings and policies. Cabinet Crafter does not control those operating-system updates.

GitHub is involved only when you choose to visit the source repository or download a release.

## Removing Local Data

Close Cabinet Crafter first. Uninstalling the portable application means removing the extracted application folder. To remove recovery history and local preferences as well, delete only this exact folder:

`%LOCALAPPDATA%\CabinetCrafter`

Removing that folder does not delete project files or exports saved elsewhere. It does remove local recovery data, the recent-project list, learning progress, preferences, and user presets.

## Shared Or Managed Computers

Project paths and recovery data can reveal filenames and design contents to another person using the same Windows account. On a shared computer, save projects in an appropriate protected location and remove the local data folder when the work is complete.
