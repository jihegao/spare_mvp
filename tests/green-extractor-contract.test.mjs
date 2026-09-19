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
  assert.match(uninstaller, /IsOwnedShortcut/);
  assert.match(uninstaller, /ReadShortcutTarget/);
  assert.match(uninstaller, /MessageBoxDefaultButton\.Button2/);
  assert.match(portablePackager, /'Uninstall-SpareMvp\.exe'/);
});
