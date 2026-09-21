using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

internal static class GreenExtractor
{
    private const string Magic = "SPAREPKG";
    private const int FooterSize = 48;
    private const string ShortcutFileName = "spare_mvp 2.0.lnk";

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        bool unattended = args.Length >= 2 && args[0] == "--extract-to";
        bool noLaunch = Array.IndexOf(args, "--no-launch") >= 0;
        string unattendedParent = unattended ? args[1] : null;
        string ownedStaging = null;
        string ownedDestination = null;
        try
        {
            string executable = Application.ExecutablePath;
            long payloadLength;
            byte[] expectedHash = new byte[32];
            using (FileStream source = File.OpenRead(executable))
            {
                if (source.Length <= FooterSize) throw new InvalidDataException("安装包没有内置绿色版数据。");
                source.Seek(-FooterSize, SeekOrigin.End);
                ReadExactly(source, expectedHash, 0, expectedHash.Length);
                byte[] lengthBytes = new byte[8];
                ReadExactly(source, lengthBytes, 0, lengthBytes.Length);
                payloadLength = BitConverter.ToInt64(lengthBytes, 0);
                byte[] magicBytes = new byte[8];
                ReadExactly(source, magicBytes, 0, magicBytes.Length);
                if (Encoding.ASCII.GetString(magicBytes) != Magic || payloadLength <= 0 || payloadLength > source.Length - FooterSize)
                    throw new InvalidDataException("安装包尾部信息无效。");
            }

            string parent = unattendedParent;
            if (!unattended)
            {
                using (FolderBrowserDialog dialog = new FolderBrowserDialog())
                {
                    dialog.Description = "选择 spare_mvp 2.0 绿色版的解压位置";
                    dialog.SelectedPath = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    if (dialog.ShowDialog() != DialogResult.OK) return 0;
                    parent = dialog.SelectedPath;
                }
            }
            if (String.IsNullOrWhiteSpace(parent)) throw new ArgumentException("解压位置不能为空。");
            string destination = Path.Combine(parent, "spare-mvp-2.0-green");
            if (Directory.Exists(destination) || File.Exists(destination))
                throw new IOException("目标目录已存在：" + destination + "\r\n请选择其他目录，避免覆盖或删除已有内容。");
            ownedStaging = destination + ".extracting-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(ownedStaging);

            if (unattended)
            {
                VerifyPayload(executable, payloadLength, expectedHash, delegate { });
                ExtractPayload(executable, payloadLength, expectedHash, ownedStaging, delegate { });
            }
            else
            {
                using (ProgressForm progress = new ProgressForm())
                {
                    progress.Show();
                    progress.UpdateState("正在校验安装包…");
                    VerifyPayload(executable, payloadLength, expectedHash, progress.Pulse);
                    progress.UpdateState("正在解压完整运行环境，请勿关闭…");
                    ExtractPayload(executable, payloadLength, expectedHash, ownedStaging, progress.Pulse);
                    progress.Close();
                }
            }
            string stagedLauncher = Path.Combine(ownedStaging, "SpareMvpDesktop.exe");
            if (!File.Exists(stagedLauncher)) throw new FileNotFoundException("解压后未找到桌面启动器。", stagedLauncher);
            Directory.Move(ownedStaging, destination);
            ownedDestination = destination;
            ownedStaging = null;
            string launcher = Path.Combine(destination, "SpareMvpDesktop.exe");
            if (!File.Exists(launcher)) throw new FileNotFoundException("解压后未找到桌面启动器。", launcher);
            CreateDesktopShortcut(launcher, destination);
            // Shortcut creation completes the owned extraction transaction.
            // A later launch failure leaves the complete package for manual use.
            ownedDestination = null;
            if (!noLaunch) Process.Start(new ProcessStartInfo(launcher) { WorkingDirectory = destination, UseShellExecute = true });
            if (!unattended) MessageBox.Show("绿色版已解压到：\r\n" + destination + "\r\n\r\n桌面快捷方式已创建，平台正在启动。", "spare_mvp 2.0", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception error)
        {
            if (!String.IsNullOrWhiteSpace(ownedStaging))
            {
                try { if (Directory.Exists(ownedStaging)) Directory.Delete(ownedStaging, true); }
                catch { }
            }
            if (!String.IsNullOrWhiteSpace(ownedDestination))
            {
                try { if (Directory.Exists(ownedDestination)) Directory.Delete(ownedDestination, true); }
                catch { }
            }
            if (unattended)
            {
                try { File.WriteAllText(Path.Combine(unattendedParent ?? ".", "spare-mvp-green-extract-error.log"), error.ToString(), Encoding.UTF8); }
                catch { }
            }
            else MessageBox.Show(error.Message, "绿色版解压失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static void CreateDesktopShortcut(string launcher, string destination)
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        if (String.IsNullOrWhiteSpace(desktop) || !Directory.Exists(desktop))
            throw new DirectoryNotFoundException("无法找到当前用户的桌面目录。");
        string shortcutPath = Path.Combine(desktop, ShortcutFileName);
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) throw new PlatformNotSupportedException("Windows Script Host 不可用，无法创建桌面快捷方式。");
        object shell = null;
        object shortcut = null;
        try
        {
            shell = Activator.CreateInstance(shellType);
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            Type shortcutType = shortcut.GetType();
            shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { launcher });
            shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { destination });
            shortcutType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "spare_mvp 2.0 绿色桌面版" });
            shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { launcher + ",0" });
            shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
        finally
        {
            if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
            if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
        }
    }

    private static void VerifyPayload(string executable, long payloadLength, byte[] expectedHash, Action pulse)
    {
        using (FileStream source = File.OpenRead(executable))
        using (SHA256 sha = SHA256.Create())
        {
            long payloadOffset = source.Length - FooterSize - payloadLength;
            source.Position = payloadOffset;
            byte[] buffer = new byte[1024 * 1024];
            long remaining = payloadLength;
            while (remaining > 0)
            {
                int read = source.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                if (read <= 0) throw new EndOfStreamException("安装包数据不完整。");
                sha.TransformBlock(buffer, 0, read, null, 0);
                remaining -= read;
                pulse();
            }
            sha.TransformFinalBlock(new byte[0], 0, 0);
            if (!FixedTimeEquals(sha.Hash, expectedHash)) throw new InvalidDataException("安装包数据校验失败，请重新获取文件。");
        }
    }

    private static void ExtractPayload(string executable, long payloadLength, byte[] expectedHash, string destination, Action pulse)
    {
        string temporaryPayload = Path.Combine(Path.GetTempPath(), "spare-mvp-" + Guid.NewGuid().ToString("N") + ".tar");
        try
        {
            using (FileStream source = File.OpenRead(executable))
            using (FileStream payload = new FileStream(temporaryPayload, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read))
            using (SHA256 sha = SHA256.Create())
            {
                source.Position = source.Length - FooterSize - payloadLength;
                byte[] buffer = new byte[1024 * 1024];
                long remaining = payloadLength;
                while (remaining > 0)
                {
                    int read = source.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                    if (read <= 0) throw new EndOfStreamException("安装包数据不完整。");
                    payload.Write(buffer, 0, read);
                    sha.TransformBlock(buffer, 0, read, null, 0);
                    remaining -= read;
                    pulse();
                }
                sha.TransformFinalBlock(new byte[0], 0, 0);
                if (!FixedTimeEquals(sha.Hash, expectedHash))
                    throw new InvalidDataException("复制后的安装包数据校验失败，请重新获取文件。");
                payload.Flush();
                // This same handle remains open from creation and hashing
                // through extraction. FileShare.Read lets tar read the file
                // while preventing another writer or deleter from opening it.
                ValidateArchiveEntries(temporaryPayload, destination);
                RunTar(temporaryPayload, destination, "-xf", false);
                AssertNoReparsePoints(destination);
            }
        }
        finally
        {
            try { if (File.Exists(temporaryPayload)) File.Delete(temporaryPayload); }
            catch { }
        }
    }

    private static void ValidateArchiveEntries(string archive, string destination)
    {
        string listing = RunTar(archive, destination, "-tf", true);
        foreach (string raw in listing.Split(new string[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries))
        {
            string entry = raw.Trim();
            if (!IsSafeArchivePath(destination, entry))
                throw new InvalidDataException("安装包包含越界路径，拒绝解压：" + entry);
        }
        string verbose = RunTar(archive, destination, "-tvf", true);
        foreach (string raw in verbose.Split(new string[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries))
        {
            string line = raw.TrimStart();
            if (line.Length == 0) continue;
            if (line[0] != '-' && line[0] != 'd')
                throw new InvalidDataException("安装包包含链接或其他不支持的条目类型，拒绝解压。");
        }
    }

    private static bool IsSafeArchivePath(string destination, string entry)
    {
        if (String.IsNullOrWhiteSpace(entry) || entry.IndexOf('\0') >= 0) return false;
        string normalized = entry.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar);
        while (normalized.StartsWith("." + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            normalized = normalized.Substring(2);
        normalized = normalized.TrimEnd(Path.DirectorySeparatorChar);
        if (normalized.Length == 0 || normalized == ".") return true;
        if (Path.IsPathRooted(normalized) || normalized.IndexOf(':') >= 0) return false;
        foreach (string part in normalized.Split(Path.DirectorySeparatorChar))
            if (part == "..") return false;
        string root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string candidate = Path.GetFullPath(Path.Combine(destination, normalized));
        return candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase);
    }

    private static string RunTar(string archive, string destination, string operation, bool captureOutput)
    {
        ProcessStartInfo info = new ProcessStartInfo("tar.exe", operation + " " + QuoteArgument(archive))
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = destination,
            RedirectStandardOutput = captureOutput,
            RedirectStandardError = true
        };
        using (Process tar = Process.Start(info))
        {
            string output = captureOutput ? tar.StandardOutput.ReadToEnd() : "";
            string error = tar.StandardError.ReadToEnd();
            tar.WaitForExit();
            if (tar.ExitCode != 0) throw new InvalidOperationException("系统解压程序失败：" + error.Trim());
            return output;
        }
    }

    private static void AssertNoReparsePoints(string destination)
    {
        Queue<string> pending = new Queue<string>();
        pending.Enqueue(destination);
        while (pending.Count != 0)
        {
            string directory = pending.Dequeue();
            foreach (string entry in Directory.GetFileSystemEntries(directory))
            {
                FileAttributes attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("安装包解压出了重解析点，拒绝安装：" + entry);
                if ((attributes & FileAttributes.Directory) != 0) pending.Enqueue(entry);
            }
        }
    }

    private static string QuoteArgument(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void ReadExactly(Stream stream, byte[] buffer, int offset, int count)
    {
        while (count > 0)
        {
            int read = stream.Read(buffer, offset, count);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
            count -= read;
        }
    }

    private static bool FixedTimeEquals(byte[] left, byte[] right)
    {
        if (left == null || right == null || left.Length != right.Length) return false;
        int different = 0;
        for (int index = 0; index < left.Length; index++) different |= left[index] ^ right[index];
        return different == 0;
    }

    private sealed class ProgressForm : Form
    {
        private readonly Label status = new Label();
        private DateTime lastPulse = DateTime.MinValue;

        internal ProgressForm()
        {
            Text = "spare_mvp 2.0 绿色版";
            Width = 460;
            Height = 150;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ControlBox = false;
            status.AutoSize = false;
            status.Left = 24;
            status.Top = 18;
            status.Width = 400;
            status.Height = 28;
            status.Text = "正在准备…";
            ProgressBar bar = new ProgressBar();
            bar.Left = 24;
            bar.Top = 55;
            bar.Width = 400;
            bar.Height = 22;
            bar.Style = ProgressBarStyle.Marquee;
            bar.MarqueeAnimationSpeed = 25;
            Controls.Add(status);
            Controls.Add(bar);
        }

        internal void UpdateState(string value)
        {
            status.Text = value;
            Refresh();
            Application.DoEvents();
        }

        internal void Pulse()
        {
            if ((DateTime.UtcNow - lastPulse).TotalMilliseconds < 100) return;
            lastPulse = DateTime.UtcNow;
            Application.DoEvents();
        }
    }
}
