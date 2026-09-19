using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class GreenUninstaller
{
    private const string ShortcutFileName = "spare_mvp 2.0.lnk";
    private const string LauncherFileName = "SpareMvpDesktop.exe";
    private const string WorkerArgument = "--remove";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        if (args.Length == 3 && args[0] == WorkerArgument) return RemoveInstalledFiles(args[1], args[2]);

        try
        {
            string installationRoot = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar));
            AssertInstallationRoot(installationRoot);
            DialogResult answer = MessageBox.Show(
                "将停止 spare_mvp 2.0，并永久删除此安装目录中的程序、项目和本机数据：\r\n\r\n" + installationRoot +
                "\r\n\r\n同时删除安装程序创建的桌面快捷方式。此操作无法撤销，是否继续？",
                "卸载 spare_mvp 2.0",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) return 0;

            StopOwnedServices(installationRoot);
            CloseDesktopProcesses(installationRoot);
            StartRemovalWorker(installationRoot, DesktopShortcutPath());
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "卸载失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void AssertInstallationRoot(string installationRoot)
    {
        string volumeRoot = Path.GetPathRoot(installationRoot);
        if (String.Equals(installationRoot.TrimEnd(Path.DirectorySeparatorChar), volumeRoot.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("拒绝把磁盘根目录作为卸载目标。");
        if ((new DirectoryInfo(installationRoot).Attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("安装目录是重解析点，为避免越界删除而拒绝卸载。");
        string[] required = {
            LauncherFileName,
            "Uninstall-SpareMvp.exe",
            "manifest.json",
            "green-source-manifest.json",
            Path.Combine("scripts", "stop-portable.ps1"),
            Path.Combine("runtime", "python.exe")
        };
        foreach (string relative in required)
        {
            if (!File.Exists(Path.Combine(installationRoot, relative)))
                throw new InvalidDataException("当前目录不是完整的 spare_mvp 2.0 绿色版，拒绝删除：" + relative);
        }
    }

    private static void StopOwnedServices(string installationRoot)
    {
        string stopScript = Path.Combine(installationRoot, "scripts", "stop-portable.ps1");
        ProcessStartInfo info = new ProcessStartInfo(
            "powershell.exe",
            "-NoLogo -NoProfile -ExecutionPolicy Bypass -File " + Quote(stopScript))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = installationRoot
        };
        using (Process process = Process.Start(info))
        {
            if (!process.WaitForExit(60000))
            {
                try { process.Kill(); } catch { }
                throw new TimeoutException("停止平台服务超时，未删除任何安装文件。");
            }
            if (process.ExitCode != 0) throw new InvalidOperationException("平台服务未能安全停止，未删除任何安装文件。");
        }
    }

    private static void CloseDesktopProcesses(string installationRoot)
    {
        string expectedLauncher = Path.GetFullPath(Path.Combine(installationRoot, LauncherFileName));
        List<Process> owned = new List<Process>();
        foreach (Process process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(LauncherFileName)))
        {
            try
            {
                if (String.Equals(Path.GetFullPath(process.MainModule.FileName), expectedLauncher, StringComparison.OrdinalIgnoreCase))
                    owned.Add(process);
                else process.Dispose();
            }
            catch
            {
                process.Dispose();
            }
        }
        foreach (Process process in owned)
        {
            using (process)
            {
                try
                {
                    if (process.HasExited) continue;
                    process.CloseMainWindow();
                    if (!process.WaitForExit(3000))
                    {
                        process.Kill();
                        process.WaitForExit(5000);
                    }
                }
                catch (Exception error)
                {
                    throw new InvalidOperationException("无法关闭当前安装目录中的桌面进程，未删除安装文件。", error);
                }
            }
        }
    }

    private static void StartRemovalWorker(string installationRoot, string shortcutPath)
    {
        string worker = Path.Combine(Path.GetTempPath(), "spare-mvp-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
        File.Copy(Application.ExecutablePath, worker, false);
        Process.Start(new ProcessStartInfo(worker, WorkerArgument + " " + Quote(installationRoot) + " " + Quote(shortcutPath))
        {
            UseShellExecute = true,
            WorkingDirectory = Path.GetTempPath()
        });
    }

    private static int RemoveInstalledFiles(string installationRoot, string shortcutPath)
    {
        try
        {
            Thread.Sleep(750);
            AssertInstallationRoot(installationRoot);
            bool shortcutExists = File.Exists(shortcutPath);
            bool removeShortcut = shortcutExists && IsOwnedShortcut(shortcutPath, Path.Combine(installationRoot, LauncherFileName));
            Exception lastError = null;
            for (int attempt = 0; attempt < 30 && Directory.Exists(installationRoot); attempt++)
            {
                try
                {
                    Directory.Delete(installationRoot, true);
                    lastError = null;
                }
                catch (Exception error)
                {
                    lastError = error;
                    Thread.Sleep(500);
                }
            }
            if (Directory.Exists(installationRoot))
                throw new IOException("无法删除安装目录，请关闭仍在使用其中文件的程序后重试。", lastError);
            if (removeShortcut && File.Exists(shortcutPath)) File.Delete(shortcutPath);
            string result = shortcutExists && !removeShortcut
                ? "spare_mvp 2.0 安装目录已删除。桌面快捷方式已被修改或指向其他安装，因此予以保留。"
                : "spare_mvp 2.0 已卸载，安装目录和桌面快捷方式已删除。";
            MessageBox.Show(result, "卸载完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
            ScheduleSelfDelete();
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "卸载失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool IsOwnedShortcut(string shortcutPath, string expectedLauncher)
    {
        try
        {
            string target = ReadShortcutTarget(shortcutPath);
            return !String.IsNullOrWhiteSpace(target) &&
                String.Equals(Path.GetFullPath(target), Path.GetFullPath(expectedLauncher), StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static string ReadShortcutTarget(string shortcutPath)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) throw new PlatformNotSupportedException("Windows Script Host 不可用，无法核对桌面快捷方式。");
        object shell = null;
        object shortcut = null;
        try
        {
            shell = Activator.CreateInstance(shellType);
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            return (string)shortcut.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null);
        }
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    private static string DesktopShortcutPath()
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        if (String.IsNullOrWhiteSpace(desktop)) throw new DirectoryNotFoundException("无法找到当前用户的桌面目录。");
        return Path.Combine(desktop, ShortcutFileName);
    }

    private static void ScheduleSelfDelete()
    {
        string command = "ping.exe 127.0.0.1 -n 2 >nul & del /f /q " + Quote(Application.ExecutablePath);
        Process.Start(new ProcessStartInfo("cmd.exe", "/d /c " + command) { UseShellExecute = false, CreateNoWindow = true });
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
