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
        if (args.Length == 4 && args[0] == WorkerArgument) return RemoveInstalledFiles(args[1], args[2], args[3] == "deleted");

        try
        {
            string installationRoot = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar));
            AssertInstallationRoot(installationRoot);
            LifecyclePaths lifecycle = ResolveLifecyclePaths(installationRoot);
            if (!lifecycle.BindingExists && HasLegacyUserState(installationRoot))
                throw new InvalidOperationException("检测到尚未安全迁出的安装目录内用户数据。请先启动一次平台完成数据迁移，再执行卸载。");
            DialogResult answer = MessageBox.Show(
                "将停止 spare_mvp 2.0，并删除当前安装的程序和实例临时状态：\r\n\r\n" + installationRoot +
                "\r\n\r\n项目数据库和用户数据默认保留在：\r\n" + lifecycle.DataRoot +
                "\r\n\r\n是否继续卸载程序？",
                "卸载 spare_mvp 2.0",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) return 0;

            DialogResult dataAnswer = MessageBox.Show(
                "是否同时永久删除以下用户数据？\r\n\r\n" + lifecycle.DataRoot +
                "\r\n\r\n选择“是”将永久删除项目数据库、运行结果和迁移备份，且无法恢复。" +
                "\r\n选择“否”将保留用户数据。选择“取消”将取消本次卸载。",
                "用户数据处理",
                MessageBoxButtons.YesNoCancel,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button3);
            if (dataAnswer == DialogResult.Cancel) return 0;
            bool deleteUserData = dataAnswer == DialogResult.Yes;

            RunStopScript(installationRoot, lifecycle.DataRoot, false, false);
            CloseDesktopProcesses(installationRoot);
            RunStopScript(installationRoot, lifecycle.DataRoot, true, deleteUserData);
            StartRemovalWorker(installationRoot, DesktopShortcutPath(), deleteUserData);
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
            Path.Combine("scripts", "portable-paths.py"),
            Path.Combine("scripts", "portable-data.py"),
            Path.Combine("scripts", "portable-data-guard.py"),
            Path.Combine("runtime", "python.exe")
        };
        foreach (string relative in required)
        {
            if (!File.Exists(Path.Combine(installationRoot, relative)))
                throw new InvalidDataException("当前目录不是完整的 spare_mvp 2.0 绿色版，拒绝删除：" + relative);
        }
    }

    private static void RunStopScript(string installationRoot, string dataRoot, bool removeInstanceState, bool deleteUserData)
    {
        string stopScript = Path.Combine(installationRoot, "scripts", "stop-portable.ps1");
        string arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File " + Quote(stopScript) +
            " -DataRoot " + Quote(dataRoot);
        if (removeInstanceState) arguments += " -RemoveInstanceState";
        if (deleteUserData) arguments += " -DeleteSharedData";
        ProcessStartInfo info = new ProcessStartInfo(
            "powershell.exe",
            arguments)
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

    private static LifecyclePaths ResolveLifecyclePaths(string installationRoot)
    {
        string dataRoot = ResolvePathField(installationRoot, "data_root");
        string instanceRoot = ResolvePathField(installationRoot, "instance_root");
        bool bindingExists = String.Equals(ResolvePathField(installationRoot, "binding_exists"), "True", StringComparison.OrdinalIgnoreCase);
        return new LifecyclePaths(dataRoot, instanceRoot, bindingExists);
    }

    private static string ResolvePathField(string installationRoot, string field)
    {
        string python = Path.Combine(installationRoot, "runtime", "python.exe");
        string resolver = Path.Combine(installationRoot, "scripts", "portable-paths.py");
        ProcessStartInfo info = new ProcessStartInfo(
            python,
            "-I -B " + Quote(resolver) + " --package-root " + Quote(installationRoot) + " --field " + Quote(field))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = installationRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        using (Process process = Process.Start(info))
        {
            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            if (!process.WaitForExit(30000))
            {
                try { process.Kill(); } catch { }
                throw new TimeoutException("解析用户数据目录超时，未删除任何文件。");
            }
            if (process.ExitCode != 0 || String.IsNullOrWhiteSpace(output))
                throw new InvalidOperationException("无法安全解析用户数据目录，未删除任何文件：" + error.Trim());
            return output.Trim();
        }
    }

    private static bool HasLegacyUserState(string installationRoot)
    {
        string legacy = Path.Combine(installationRoot, "data");
        string[] markers = {
            "active-ports.json", "integrity-cache.json", "pids", "logs", "outputs"
        };
        foreach (string marker in markers)
        {
            if (File.Exists(Path.Combine(legacy, marker)) || Directory.Exists(Path.Combine(legacy, marker))) return true;
        }
        return false;
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

    private static void StartRemovalWorker(string installationRoot, string shortcutPath, bool userDataDeleted)
    {
        string worker = Path.Combine(Path.GetTempPath(), "spare-mvp-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
        File.Copy(Application.ExecutablePath, worker, false);
        Process.Start(new ProcessStartInfo(worker, WorkerArgument + " " + Quote(installationRoot) + " " + Quote(shortcutPath) +
            " " + (userDataDeleted ? "deleted" : "preserved"))
        {
            UseShellExecute = true,
            WorkingDirectory = Path.GetTempPath()
        });
    }

    private static int RemoveInstalledFiles(string installationRoot, string shortcutPath, bool userDataDeleted)
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
            string dataResult = userDataDeleted ? "已按二次确认永久删除用户数据。" : "项目数据库和用户数据已保留。";
            string result = shortcutExists && !removeShortcut
                ? "spare_mvp 2.0 安装目录已删除。桌面快捷方式已被修改或指向其他安装，因此予以保留。" + dataResult
                : "spare_mvp 2.0 已卸载，安装目录和本安装拥有的桌面快捷方式已删除。" + dataResult;
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
            string[] details = ReadShortcutDetails(shortcutPath);
            string expectedWorkingDirectory = Path.GetDirectoryName(Path.GetFullPath(expectedLauncher));
            return !String.IsNullOrWhiteSpace(details[0]) &&
                String.Equals(Path.GetFullPath(details[0]), Path.GetFullPath(expectedLauncher), StringComparison.OrdinalIgnoreCase) &&
                !String.IsNullOrWhiteSpace(details[1]) &&
                String.Equals(Path.GetFullPath(details[1]), expectedWorkingDirectory, StringComparison.OrdinalIgnoreCase) &&
                String.IsNullOrWhiteSpace(details[2]);
        }
        catch
        {
            return false;
        }
    }

    private static string[] ReadShortcutDetails(string shortcutPath)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) throw new PlatformNotSupportedException("Windows Script Host 不可用，无法核对桌面快捷方式。");
        object shell = null;
        object shortcut = null;
        try
        {
            shell = Activator.CreateInstance(shellType);
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type shortcutType = shortcut.GetType();
            return new string[] {
                (string)shortcutType.InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null),
                (string)shortcutType.InvokeMember("WorkingDirectory", BindingFlags.GetProperty, null, shortcut, null),
                (string)shortcutType.InvokeMember("Arguments", BindingFlags.GetProperty, null, shortcut, null)
            };
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

    private sealed class LifecyclePaths
    {
        internal readonly string DataRoot;
        internal readonly string InstanceRoot;
        internal readonly bool BindingExists;

        internal LifecyclePaths(string dataRoot, string instanceRoot, bool bindingExists)
        {
            DataRoot = dataRoot;
            InstanceRoot = instanceRoot;
            BindingExists = bindingExists;
        }
    }
}
