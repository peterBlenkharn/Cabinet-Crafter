using System.IO;
using System.Windows;

namespace CabinetCrafter;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        if (e.Args.Any(argument => string.Equals(argument, "--smoke-test", StringComparison.OrdinalIgnoreCase)))
        {
            var webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            var required = new[]
            {
                "index.html",
                "style.css",
                Path.Combine("js", "app.js"),
                Path.Combine("js", "fabrication.js"),
                Path.Combine("js", "export.js"),
                Path.Combine("js", "lib", "three.module.js")
            };
            var missing = required.Where(relativePath => !File.Exists(Path.Combine(webRoot, relativePath))).ToArray();
            Shutdown(missing.Length == 0 ? 0 : 2);
            return;
        }

        var integrationSmokeTest = e.Args.Any(argument =>
            string.Equals(argument, "--integration-smoke-test", StringComparison.OrdinalIgnoreCase));
        base.OnStartup(e);
        new MainWindow(integrationSmokeTest).Show();
    }
}
