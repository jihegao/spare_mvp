using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

internal static class GreenExtractor
{
    private const string Magic = "SPAREPKG";
    private const int FooterSize = 48;

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        bool unattended = args.Length >= 2 && args[0] == "--extract-to";
        bool noLaunch = Array.IndexOf(args, "--no-launch") >= 0;
        string unattendedParent = unattended ? args[1] : null;
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
            if (Directory.Exists(destination) && Directory.GetFileSystemEntries(destination).Length != 0)
                throw new IOException("目标目录已存在且不为空：" + destination + "\r\n请选择其他目录，避免覆盖已有数据。");
            Directory.CreateDirectory(destination);

            if (unattended)
            {
                VerifyPayload(executable, payloadLength, expectedHash, delegate { });
                ExtractPayload(executable, payloadLength, destination, delegate { });
            }
            else
            {
                using (ProgressForm progress = new ProgressForm())
                {
                    progress.Show();
                    progress.UpdateState("正在校验安装包…");
                    VerifyPayload(executable, payloadLength, expectedHash, progress.Pulse);
                    progress.UpdateState("正在解压完整运行环境，请勿关闭…");
                    ExtractPayload(executable, payloadLength, destination, progress.Pulse);
                    progress.Close();
                }
            }
            string launcher = Path.Combine(destination, "SpareMvpDesktop.exe");
            if (!File.Exists(launcher)) throw new FileNotFoundException("解压后未找到桌面启动器。", launcher);
            if (!noLaunch) Process.Start(new ProcessStartInfo(launcher) { WorkingDirectory = destination, UseShellExecute = true });
            if (!unattended) MessageBox.Show("绿色版已解压到：\r\n" + destination + "\r\n\r\n平台正在启动。", "spare_mvp 2.0", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception error)
        {
            if (unattended)
            {
                try { File.WriteAllText(Path.Combine(unattendedParent ?? ".", "spare-mvp-green-extract-error.log"), error.ToString(), Encoding.UTF8); }
                catch { }
            }
            else MessageBox.Show(error.Message, "绿色版解压失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
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

    private static void ExtractPayload(string executable, long payloadLength, string destination, Action pulse)
    {
        string temporaryPayload = Path.Combine(Path.GetTempPath(), "spare-mvp-" + Guid.NewGuid().ToString("N") + ".tar");
        try
        {
            using (FileStream source = File.OpenRead(executable))
            using (FileStream payload = new FileStream(temporaryPayload, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                source.Position = source.Length - FooterSize - payloadLength;
                byte[] buffer = new byte[1024 * 1024];
                long remaining = payloadLength;
                while (remaining > 0)
                {
                    int read = source.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                    if (read <= 0) throw new EndOfStreamException("安装包数据不完整。");
                    payload.Write(buffer, 0, read);
                    remaining -= read;
                    pulse();
                }
            }

            ProcessStartInfo info = new ProcessStartInfo(
                "tar.exe",
                "-xf \"" + temporaryPayload.Replace("\"", "\\\"") + "\" -C \"" + destination.Replace("\"", "\\\"") + "\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true
            };
            using (Process tar = Process.Start(info))
            {
                string error = tar.StandardError.ReadToEnd();
                tar.WaitForExit();
                if (tar.ExitCode != 0) throw new InvalidOperationException("系统解压程序失败：" + error.Trim());
            }
        }
        finally
        {
            try { if (File.Exists(temporaryPayload)) File.Delete(temporaryPayload); }
            catch { }
        }
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
