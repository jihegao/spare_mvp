import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../packaging/green/GreenExtractor.cs", import.meta.url), "utf8");
const uninstaller = await readFile(new URL("../packaging/green/GreenUninstaller.cs", import.meta.url), "utf8");
const builder = await readFile(new URL("../packaging/green/Build-GreenPackage.ps1", import.meta.url), "utf8");
const portablePackager = await readFile(new URL("../scripts/portable-package.py", import.meta.url), "utf8");

test("green extractor stages the embedded tar before invoking Windows tar", () => {
  assert.match(source, /Path\.GetTempPath\(\)/);
  assert.match(source, /new FileStream\(temporaryPayload, FileMode\.CreateNew, FileAccess\.ReadWrite, FileShare\.Read\)/);
  assert.match(source, /sha\.TransformBlock\(buffer/);
  assert.doesNotMatch(source, /FileMode\.Open, FileAccess\.Read, FileShare\.Read/);
  assert.match(source, /ValidateArchiveEntries\(temporaryPayload, destination\)/);
  assert.match(source, /RunTar\(temporaryPayload, destination, "-xf", false\)/);
  assert.match(source, /RunTar\(archive, destination, "-tf", true\)/);
  assert.match(source, /RunTar\(archive, destination, "-tvf", true\)/);
  assert.match(source, /line\[0\] != '-' && line\[0\] != 'd'/);
  assert.match(source, /Path\.IsPathRooted\(normalized\)/);
  assert.match(source, /part == "\.\."/);
  assert.match(source, /FileAttributes\.ReparsePoint/);
  assert.match(source, /operation \+ " " \+ QuoteArgument\(archive\)/);
  assert.match(source, /WorkingDirectory = destination/);
  assert.doesNotMatch(source, /temporaryPayload[\s\S]{0,120}" -C /);
  assert.match(source, /File\.Delete\(temporaryPayload\)/);
  assert.doesNotMatch(source, /RedirectStandardInput/);
  assert.doesNotMatch(source, /StandardInput\.BaseStream\.Write/);
  assert.match(source, /\.extracting-/);
  assert.match(source, /Directory\.Move\(ownedStaging, destination\)/);
  assert.match(source, /Directory\.Delete\(ownedStaging, true\)/);
  assert.match(source, /ownedDestination = destination/);
  assert.match(source, /Directory\.Delete\(ownedDestination, true\)/);
  assert.match(source, /shortcutChange = CreateDesktopShortcut\(launcher, destination, predecessor\);[\s\S]{0,1200}ownedDestination = null;/);
  assert.match(source, /Directory\.Exists\(destination\) \|\| File\.Exists\(destination\)/);
});

test("green extractor creates a current-user desktop shortcut for the extracted launcher", () => {
  assert.match(source, /Environment\.SpecialFolder\.DesktopDirectory/);
  assert.doesNotMatch(source, /WScript\.Shell|CreateShortcut|BindingFlags\.InvokeMember/);
  assert.match(source, /ShellLinkFile\.Write\(temporaryPath, launcher, destination, ProductName, launcher, 0\)/);
  assert.match(source, /SpareMvpDesktop\.exe/);
  assert.match(source, /CreateDesktopShortcut\(launcher, destination, predecessor\)/);
  assert.match(source, /备件规划及任务可靠度验证评估平台 V2\.0/);
  assert.match(source, /ShortcutFileName = ProductName \+ "\.lnk"/);
  assert.match(source, /SetDescription\(description\)/);
  assert.match(source, /MigrateOwnedLegacyShortcut\(launcher, destination, predecessor, shortcutChange\)/);
  assert.match(source, /IsExpectedPredecessorShortcut\(legacyShortcutPath, predecessor, LegacyShortcutDescription\)/);
  assert.match(source, /String\.IsNullOrWhiteSpace\(details\[2\]\)/);
  assert.match(source, /String\.Equals\(details\[3\], expectedDescription, StringComparison\.Ordinal\)/);
  assert.match(source, /String\.Equals\(details\[4\], Path\.GetFullPath\(expectedLauncher\) \+ ",0", StringComparison\.OrdinalIgnoreCase\)/);
  const createShortcut = source.slice(
    source.indexOf("private static ShortcutChange CreateDesktopShortcut"),
    source.indexOf("private static void MigrateOwnedLegacyShortcut")
  );
  assert.ok(createShortcut.indexOf("File.Exists(shortcutPath)") < createShortcut.indexOf("ShellLinkFile.Write"));
  assert.ok(createShortcut.indexOf("!IsOwnedShortcut(shortcutPath, launcher, destination, ProductName)") < createShortcut.indexOf("ShellLinkFile.Write"));
  assert.match(createShortcut, /IsExpectedPredecessorShortcut\(shortcutPath, predecessor, ProductName\)/);
  assert.match(createShortcut, /return ShortcutChange\.NotApplied/);
  assert.match(createShortcut, /File\.Replace\(temporaryPath, shortcutPath, backupPath\)/);
  assert.match(createShortcut, /File\.Move\(temporaryPath, shortcutPath\)/);
  assert.match(createShortcut, /Path\.Combine\(desktop, "spare-mvp-shortcut-installing-" \+ Guid\.NewGuid\(\)\.ToString\("N"\) \+ "\.lnk"\)/);
  assert.doesNotMatch(createShortcut, /shortcutPath \+ "\.installing-/);
  assert.ok(createShortcut.indexOf("return ShortcutChange.NotApplied") < createShortcut.indexOf("ShellLinkFile.Write"));
  assert.match(source, /shortcutChange\.RollBack\(\)/);
  assert.match(source, /shortcutChange\.Commit\(\)/);
});

test("green extractor only redirects a shortcut for an explicitly bound predecessor", () => {
  assert.match(source, /ReadOption\(args, "--replace-installation"\)/);
  assert.match(source, /ReadOption\(args, "--replace-installation-id"\)/);
  assert.match(source, /InstallationId\(root\)/);
  assert.match(source, /"spare-mvp-installation-v1\\0" \+ normalized/);
  assert.match(source, /"spare_mvp", "instances", normalizedIdentity, "data-root-binding\.json"/);
  assert.match(source, /ReadJsonStringField\(binding, "installation_id"\)/);
  assert.match(source, /PathsEqual\(ReadJsonStringField\(binding, "package_root"\), root\)/);
  assert.match(source, /File\.Exists\(Path\.Combine\(root, "manifest\.json"\)\)/);
  assert.match(source, /File\.Exists\(Path\.Combine\(root, "scripts", "start-portable\.ps1"\)\)/);
  assert.match(source, /IsOwnedShortcut\(shortcutPath, Path\.Combine\(predecessor\.Root, "SpareMvpDesktop\.exe"\), predecessor\.Root, expectedDescription\)/);
  assert.match(source, /File\.Move\(legacyShortcutPath, backupPath\)/);
  assert.match(source, /File\.Move\(legacyBackupPath, legacyPath\)/);
  assert.match(source, /属于其他安装或已被修改，已保留且未创建新快捷方式/);
});

test("shortcut IO uses the native Unicode Shell Link interfaces", () => {
  for (const [label, program] of [["extractor", source], ["uninstaller", uninstaller]]) {
    assert.doesNotMatch(program, /WScript\.Shell|GetTypeFromProgID|InvokeMember/, label);
    assert.match(program, /Guid\("00021401-0000-0000-C000-000000000046"\)/, label);
    assert.match(program, /Guid\("000214F9-0000-0000-C000-000000000046"\)/, label);
    assert.match(program, /Guid\("0000010B-0000-0000-C000-000000000046"\)/, label);
    assert.match(program, /interface IShellLinkW/, label);
    assert.match(program, /interface IPersistFile/, label);
    assert.match(program, /MarshalAs\(UnmanagedType\.LPWStr\)/, label);
    assert.match(program, /\(\(IPersistFile\)link\)\.Load\(shortcutPath, 0\)/, label);
    assert.match(program, /link\.GetPath\(target, target\.Capacity, out findData, 4\)/, label);
    assert.match(program, /link\.GetWorkingDirectory\(workingDirectory, workingDirectory\.Capacity\)/, label);
    assert.match(program, /link\.GetArguments\(arguments, arguments\.Capacity\)/, label);
    assert.match(program, /link\.GetDescription\(description, description\.Capacity\)/, label);
    assert.match(program, /link\.GetIconLocation\(iconPath, iconPath\.Capacity, out iconIndex\)/, label);
  }
  assert.match(source, /link\.SetPath\(targetPath\)/);
  assert.match(source, /link\.SetWorkingDirectory\(workingDirectory\)/);
  assert.match(source, /link\.SetArguments\(""\)/);
  assert.match(source, /link\.SetDescription\(description\)/);
  assert.match(source, /link\.SetIconLocation\(iconPath, iconIndex\)/);
  assert.match(source, /\(\(IPersistFile\)link\)\.Save\(shortcutPath, true\)/);
});

test("green package builds a guarded uninstaller into the sealed payload", () => {
  assert.match(builder, /GreenUninstaller\.cs/);
  assert.match(builder, /Uninstall-SpareMvp\.exe/);
  assert.match(builder, /Green uninstaller compilation failed/);
  assert.match(uninstaller, /stop-portable\.ps1/);
  assert.match(uninstaller, /WaitForExit\(60000\)/);
  assert.match(uninstaller, /Process\.GetProcessesByName/);
  assert.match(uninstaller, /MainModule\.FileName/);
  assert.match(uninstaller, /Directory\.Delete\(installationRoot, true\)/);
  assert.match(uninstaller, /FileAttributes\.ReparsePoint/);
  assert.match(uninstaller, /"Uninstall-SpareMvp\.exe"/);
  assert.match(uninstaller, /"manifest\.json"/);
  assert.match(uninstaller, /IsOwnedShortcut/);
  assert.match(uninstaller, /ReadShortcutDetails/);
  assert.match(uninstaller, /WorkingDirectory/);
  assert.match(uninstaller, /Arguments/);
  assert.match(uninstaller, /MessageBoxDefaultButton\.Button2/);
  assert.match(uninstaller, /MessageBoxDefaultButton\.Button3/);
  assert.match(uninstaller, /最终确认永久删除用户数据/);
  assert.match(uninstaller, /permanentDeleteAnswer == DialogResult\.Yes/);
  assert.match(uninstaller, /最终确认永久删除用户数据：[\s\S]{0,350}lifecycle\.DataRoot[\s\S]{0,350}MessageBoxDefaultButton\.Button2/);
  assert.match(uninstaller, /-RemoveInstanceState/);
  assert.match(uninstaller, /-DeleteSharedData/);
  assert.match(uninstaller, /!lifecycle\.BindingExists && HasLegacyUserState/);
  assert.match(uninstaller, /Directory\.GetFileSystemEntries\(legacy\)\.Length != 0/);
  assert.match(uninstaller, /项目数据库和用户数据已保留/);
  assert.match(uninstaller, /ShortcutFileName = ProductName \+ "\.lnk"/);
  assert.match(uninstaller, /DesktopShortcutPath\(LegacyShortcutFileName\)/);
  assert.match(uninstaller, /String\.Equals\(details\[3\], expectedDescription, StringComparison\.Ordinal\)/);
  assert.match(uninstaller, /String\.Equals\(details\[4\], Path\.GetFullPath\(expectedLauncher\) \+ ",0", StringComparison\.OrdinalIgnoreCase\)/);
  const removal = uninstaller.slice(
    uninstaller.indexOf("private static int RemoveInstalledFiles"),
    uninstaller.indexOf("private static bool IsOwnedShortcut")
  );
  const directoryDelete = removal.indexOf("Directory.Delete(installationRoot, true)");
  const currentOwnershipCheck = removal.indexOf("IsOwnedShortcut(shortcutPath, expectedLauncher, ProductName)");
  const currentDelete = removal.indexOf("File.Delete(shortcutPath)");
  const legacyOwnershipCheck = removal.indexOf("IsOwnedShortcut(legacyShortcutPath, expectedLauncher, LegacyShortcutDescription)");
  const legacyDelete = removal.indexOf("File.Delete(legacyShortcutPath)");
  assert.ok(directoryDelete >= 0 && currentOwnershipCheck > directoryDelete && currentDelete > currentOwnershipCheck);
  assert.ok(legacyOwnershipCheck > directoryDelete && legacyDelete > legacyOwnershipCheck);
  assert.ok(removal.indexOf("File.Exists(shortcutPath) || File.Exists(legacyShortcutPath)") > legacyDelete);
  assert.match(uninstaller, /备件规划及任务可靠度验证评估平台 V2\.0/);
  assert.match(portablePackager, /'Uninstall-SpareMvp\.exe'/);
});

test("shortcut ownership rejects every user-visible or routing mutation", () => {
  const expected = {
    target: "C:\\App\\SpareMvpDesktop.exe",
    workingDirectory: "C:\\App",
    arguments: "",
    description: "备件规划及任务可靠度验证评估平台 V2.0",
    iconLocation: "C:\\App\\SpareMvpDesktop.exe,0",
  };
  const isOwned = (details) =>
    details.target.toLowerCase() === expected.target.toLowerCase() &&
    details.workingDirectory.toLowerCase() === expected.workingDirectory.toLowerCase() &&
    details.arguments.trim() === "" &&
    details.description === expected.description &&
    details.iconLocation.toLowerCase() === expected.iconLocation.toLowerCase();

  assert.equal(isOwned(expected), true);
  for (const [field, value] of [
    ["target", "C:\\Other\\SpareMvpDesktop.exe"],
    ["workingDirectory", "C:\\Other"],
    ["arguments", "--custom"],
    ["description", "用户修改的快捷方式"],
    ["iconLocation", "C:\\Icons\\custom.ico,0"],
  ]) {
    assert.equal(isOwned({ ...expected, [field]: value }), false, field);
  }
});
