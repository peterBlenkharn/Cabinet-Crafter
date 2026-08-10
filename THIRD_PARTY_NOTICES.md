# Third-Party Notices

Except for the third-party components identified below, the original Cabinet Crafter source code, documentation, and original artwork are Copyright (c) 2026 Peter Blenkharn and licensed under the MIT License.

The application also contains or redistributes the following third-party software. The release packaging process includes the exact upstream licence files and available notice files beside the application. Those upstream files control if this summary differs from them.

## Three.js r160

Bundled files:

- `wwwroot/js/lib/three.module.js`
- `wwwroot/js/lib/orbit-controls.js`

Copyright (c) 2010-2023 Three.js Authors

Three.js is licensed under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Project: <https://threejs.org/>

The Windows release contains `THREEJS_LICENSE.txt`, copied from the tagged Three.js r160 source.

## Microsoft Edge WebView2 SDK 1.0.4022.49

The desktop application redistributes the Microsoft Edge WebView2 loader and managed SDK assemblies from the `Microsoft.Web.WebView2` NuGet package.

The release contains:

- `WEBVIEW2_LICENSE.txt`, copied from the restored NuGet package.
- `WEBVIEW2_THIRD_PARTY_NOTICES.txt`, copied from the restored NuGet package.

Project: <https://developer.microsoft.com/microsoft-edge/webview2/>

## Microsoft .NET 9 Runtime

The Windows release is self-contained and redistributes the exact .NET Core and Windows Desktop runtime packs declared by the published application's dependency manifest. The release contains:

- `DOTNET_RUNTIME_PACKAGES.txt`, listing the exact runtime-pack IDs and versions;
- `DOTNET_RUNTIME_LICENSE.txt`, copied from the resolved `Microsoft.NETCore.App.Runtime` package;
- `DOTNET_RUNTIME_THIRD_PARTY_NOTICES.txt`, copied from that same package; and
- `WINDOWS_DESKTOP_RUNTIME_LICENSE.txt`, copied from the resolved `Microsoft.WindowsDesktop.App.Runtime` package.

Project: <https://dotnet.microsoft.com/>

## Machine-Readable Inventory

Official GitHub releases include an SPDX JSON software bill of materials for software components detected in the staged release. `RELEASE_MANIFEST.sha256` is the complete inventory and hash record for packaged files. The SPDX document supplements, and does not replace, that manifest or the licence and notice files above.
