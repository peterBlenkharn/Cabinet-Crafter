using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using CabinetCrafter;

const int binarySize = 8 * 1024 * 1024;
var testDirectory = Path.Combine(Path.GetTempPath(), $"cabinet-crafter-native-io-{Guid.NewGuid():N}");
Directory.CreateDirectory(testDirectory);

try
{
    var flags = BindingFlags.NonPublic | BindingFlags.Static;
    var hostType = typeof(MainWindow);
    var writeText = hostType.GetMethod("WriteUtf8AtomicallyAsync", flags)
        ?? throw new MissingMethodException(hostType.FullName, "WriteUtf8AtomicallyAsync");
    var writeBinary = hostType.GetMethod("WriteBase64AtomicallyAsync", flags)
        ?? throw new MissingMethodException(hostType.FullName, "WriteBase64AtomicallyAsync");

    var textPath = Path.Combine(testDirectory, "project.cabinet.json");
    await File.WriteAllTextAsync(textPath, "old");
    var text = $"{{\"project\":\"Cabinet alpha α\",\"payload\":\"{string.Concat(Enumerable.Repeat("abc123", 10_000))}\"}}";
    await InvokeAsync(writeText, textPath, text, CancellationToken.None);
    var textResult = await File.ReadAllTextAsync(textPath);
    if (!string.Equals(textResult, text, StringComparison.Ordinal))
    {
        throw new InvalidDataException("UTF-8 atomic replacement did not round-trip.");
    }

    var sourceBytes = new byte[binarySize];
    new Random(12345).NextBytes(sourceBytes);
    var base64 = Convert.ToBase64String(sourceBytes);
    var warmupPath = Path.Combine(testDirectory, "warmup.bin");
    await InvokeAsync(writeBinary, warmupPath, Convert.ToBase64String([1, 2, 3, 4]), 1024L, CancellationToken.None);

    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
    var allocationBefore = GC.GetTotalAllocatedBytes(true);
    var stopwatch = Stopwatch.StartNew();
    var binaryPath = Path.Combine(testDirectory, "fabrication.zip");
    await File.WriteAllBytesAsync(binaryPath, [9, 8, 7]);
    await InvokeAsync(writeBinary, binaryPath, base64, (long)binarySize * 2, CancellationToken.None);
    stopwatch.Stop();
    var allocatedBytes = GC.GetTotalAllocatedBytes(true) - allocationBefore;
    if (allocatedBytes >= binarySize / 2)
    {
        throw new InvalidDataException(
            $"Streamed binary write allocated {allocatedBytes} bytes for a {binarySize} byte output.");
    }

    await using (var output = new FileStream(binaryPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.SequentialScan))
    {
        var outputHash = await SHA256.HashDataAsync(output);
        var sourceHash = SHA256.HashData(sourceBytes);
        if (!outputHash.AsSpan().SequenceEqual(sourceHash))
        {
            throw new InvalidDataException("Streamed base64 output did not match its source bytes.");
        }
    }

    var guardedPath = Path.Combine(testDirectory, "guarded.zip");
    await File.WriteAllBytesAsync(guardedPath, [9, 8, 7]);
    var limitRejected = false;
    try
    {
        await InvokeAsync(writeBinary, guardedPath, base64, 1024L, CancellationToken.None);
    }
    catch (InvalidDataException)
    {
        limitRejected = true;
    }
    byte[] expectedGuard = [9, 8, 7];
    if (!limitRejected || !(await File.ReadAllBytesAsync(guardedPath)).AsSpan().SequenceEqual(expectedGuard))
    {
        throw new InvalidDataException("A rejected binary export changed its existing destination.");
    }

    var whitespaceSource = sourceBytes.AsSpan(0, 128 * 1024).ToArray();
    var compactBase64 = Convert.ToBase64String(whitespaceSource);
    var wrappedBase64 = new StringBuilder(compactBase64.Length + compactBase64.Length / 38);
    for (var offset = 0; offset < compactBase64.Length; offset += 76)
    {
        var count = Math.Min(76, compactBase64.Length - offset);
        wrappedBase64.Append(compactBase64, offset, count).Append("\r\n");
    }
    var whitespacePath = Path.Combine(testDirectory, "whitespace.bin");
    await InvokeAsync(writeBinary, whitespacePath, wrappedBase64.ToString(), (long)whitespaceSource.Length * 2, CancellationToken.None);
    if (!(await File.ReadAllBytesAsync(whitespacePath)).AsSpan().SequenceEqual(whitespaceSource))
    {
        throw new InvalidDataException("Whitespace-tolerant base64 decoding changed its output.");
    }

    var invalidPath = Path.Combine(testDirectory, "invalid.zip");
    await File.WriteAllBytesAsync(invalidPath, [5, 4, 3]);
    var invalidRejected = false;
    try
    {
        await InvokeAsync(writeBinary, invalidPath, "not valid base64!", 1024L, CancellationToken.None);
    }
    catch (InvalidDataException)
    {
        invalidRejected = true;
    }
    byte[] expectedInvalid = [5, 4, 3];
    if (!invalidRejected || !(await File.ReadAllBytesAsync(invalidPath)).AsSpan().SequenceEqual(expectedInvalid))
    {
        throw new InvalidDataException("Invalid base64 changed its existing destination.");
    }

    var temporaryFiles = Directory.EnumerateFiles(testDirectory, "*.tmp").Count();
    if (temporaryFiles != 0)
    {
        throw new InvalidDataException($"Atomic writes left {temporaryFiles} temporary files.");
    }

    Console.WriteLine(
        $"NATIVE_IO_SMOKE_OK binaryBytes={binarySize} elapsedMs={stopwatch.Elapsed.TotalMilliseconds:F1} "
        + $"allocatedBytes={allocatedBytes} allocationRatio={(double)allocatedBytes / binarySize:F3} tempFiles={temporaryFiles}");
}
finally
{
    if (Directory.Exists(testDirectory)) Directory.Delete(testDirectory, true);
}

static async Task InvokeAsync(MethodInfo method, params object?[] arguments)
{
    var task = method.Invoke(null, arguments) as Task
        ?? throw new InvalidOperationException($"{method.Name} did not return a task.");
    await task;
}
