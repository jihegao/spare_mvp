import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportDiagnostics } from "./diagnostics.mjs";
import { assertReleaseIntegrity, dockerAvailable, loadManifest, runtimePaths, runCommand, startServices, stopServices } from "./service-manager.mjs";

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
let launcherWindow;
let businessWindow;
let activeRuntime;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();

app.on("second-instance", () => {
  const target = businessWindow || launcherWindow;
  if (target) {
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
  }
});

function paths() {
  const resourcesPath = app.isPackaged ? process.resourcesPath : path.resolve(desktopRoot, "../dist");
  return runtimePaths(resourcesPath, app.getPath("appData"));
}

function sendProgress(message, percent) {
  launcherWindow?.webContents.send("runtime:progress", { message, percent });
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 760,
    height: 540,
    minWidth: 680,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#eef4f8",
    webPreferences: {
      preload: path.join(desktopRoot, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  launcherWindow.loadFile(path.join(desktopRoot, "renderer", "index.html"));
  launcherWindow.once("ready-to-show", () => launcherWindow.show());
}

function createBusinessWindow(frontendUrl) {
  businessWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  businessWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  businessWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const target = new URL(targetUrl);
    if (!["127.0.0.1", "localhost"].includes(target.hostname)) event.preventDefault();
  });
  businessWindow.on("close", async (event) => {
    if (quitting) return;
    event.preventDefault();
    const result = await dialog.showMessageBox(businessWindow, {
      type: "question",
      title: "关闭平台",
      message: "如何处理本机仿真服务？",
      detail: "后台继续可保留正在运行的任务；停止服务不会关闭整台机器的 Docker。",
      buttons: ["后台继续", "停止服务并退出", "取消"],
      defaultId: 0,
      cancelId: 2,
    });
    if (result.response === 0) businessWindow.hide();
    if (result.response === 1) {
      try {
        await stopServices(paths(), activeRuntime.manifest, activeRuntime.state);
      } catch (error) {
        await dialog.showErrorBox("停止服务失败", error.message);
        return;
      }
      quitting = true;
      app.quit();
    }
  });
  businessWindow.loadURL(frontendUrl);
  launcherWindow?.hide();
}

function assertLauncherSender(event) {
  const url = event.senderFrame?.url || "";
  if (!url.startsWith("file://")) throw new Error("拒绝非启动页 IPC 请求");
}

async function currentStatus() {
  const runtimePathsValue = paths();
  const docker = await dockerAvailable();
  return {
    docker,
    packaged: app.isPackaged,
    resourcesReady: existsSync(runtimePathsValue.manifestFile),
    resumeInstall: process.argv.includes("--resume-install"),
    status: docker ? "ready" : "runtime_missing",
  };
}

async function startRuntime() {
  const runtimePathsValue = paths();
  sendProgress("正在校验发布包", 15);
  const manifest = await loadManifest(runtimePathsValue);
  await assertReleaseIntegrity(runtimePathsValue, manifest);
  if (!(await dockerAvailable())) throw new Error("Docker Desktop 尚未就绪，请先安装运行环境");
  activeRuntime = await startServices(runtimePathsValue, manifest, sendProgress);
  activeRuntime.manifest = manifest;
  createBusinessWindow(activeRuntime.state.frontendUrl);
  return activeRuntime.state;
}

async function installRuntime() {
  const runtimePathsValue = paths();
  if (!existsSync(runtimePathsValue.runtimeInstaller)) throw new Error("运行环境安装脚本缺失");
  const command = [
    "Start-Process", "powershell.exe", "-Verb", "RunAs", "-Wait", "-ArgumentList",
    `'-NoProfile','-ExecutionPolicy','Bypass','-File','${runtimePathsValue.runtimeInstaller.replaceAll("'", "''")}','-AppExecutable','${process.execPath.replaceAll("'", "''")}'`,
  ].join(" ");
  await runCommand("powershell.exe", ["-NoProfile", "-Command", command]);
  return currentStatus();
}

app.whenReady().then(async () => {
  await mkdir(paths().stateRoot, { recursive: true });
  createLauncherWindow();
  if (process.argv.includes("--resume-install")) sendProgress("正在继续安装", 10);
});

ipcMain.handle("runtime:get-status", async (event) => { assertLauncherSender(event); return currentStatus(); });
ipcMain.handle("runtime:start", async (event) => { assertLauncherSender(event); return startRuntime(); });
ipcMain.handle("runtime:install", async (event) => { assertLauncherSender(event); return installRuntime(); });
ipcMain.handle("runtime:diagnostics", async (event) => {
  assertLauncherSender(event);
  if (!activeRuntime) throw new Error("服务尚未启动");
  return exportDiagnostics(paths(), activeRuntime.manifest, activeRuntime.state);
});
ipcMain.handle("runtime:open-diagnostics", async (event) => {
  assertLauncherSender(event);
  await shell.openPath(paths().diagnosticsDir);
});

app.on("activate", () => {
  if (businessWindow) businessWindow.show();
  else if (launcherWindow) launcherWindow.show();
  else createLauncherWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
