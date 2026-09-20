import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../packaging/green/GreenExtractor.cs", import.meta.url), "utf8");
const uninstaller = await readFile(new URL("../packaging/green/GreenUninstaller.cs", import.meta.url), "utf8");
const builder = await readFile(new URL("../packaging/green/Build-GreenPackage.ps1", import.meta.url), "utf8");
const portablePackager = await readFile(new URL("../scripts/portable-package.py", import.meta.url), "utf8");

test("green extractor stages the embedded tar before invoking Windows tar", () => {
  assert.match(source, /Path\.GetTempPath\(\)/);
  assert.match(source, /new FileStream\(temporaryPayload, FileMode\.CreateNew/);
  assert.match(source, /"-xf \\"" \+ temporaryPayload/);
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
  assert.match(source, /CreateDesktopShortcut\(launcher, destination\);[\s\S]{0,400}ownedDestination = null;/);
  assert.match(source, /Directory\.Exists\(destination\) \|\| File\.Exists\(destination\)/);
});

test("green extractor creates a current-user desktop shortcut for the extracted launcher", () => {
  assert.match(source, /Environment\.SpecialFolder\.DesktopDirectory/);
  assert.match(source, /Type\.GetTypeFromProgID\("WScript\.Shell"\)/);
  assert.match(source, /CreateShortcut/);
  assert.match(source, /TargetPath/);
  assert.match(source, /SpareMvpDesktop\.exe/);
  assert.match(source, /CreateDesktopShortcut\(launcher, destination\)/);
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
  assert.match(portablePackager, /'Uninstall-SpareMvp\.exe'/);
});
