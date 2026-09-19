const title = document.querySelector("#status-title");
const detail = document.querySelector("#status-detail");
const progress = document.querySelector(".progress");
const progressBar = document.querySelector("#progress-bar");
const primary = document.querySelector("#primary-action");
const diagnostics = document.querySelector("#diagnostics-action");
const errorMessage = document.querySelector("#error-message");
let resumeAttempted = false;

function updateProgress(message, percent) {
  title.textContent = message;
  progress.setAttribute("aria-valuenow", String(percent));
  progressBar.style.width = `${percent}%`;
  document.querySelectorAll("[data-step]").forEach((step, index) => {
    step.classList.toggle("active", percent >= [5, 45, 90][index]);
    step.classList.toggle("done", percent >= [45, 90, 100][index]);
  });
}

function showError(error, actionLabel, action) {
  document.body.classList.add("failed");
  errorMessage.hidden = false;
  errorMessage.textContent = error?.message || String(error);
  primary.hidden = false;
  primary.textContent = actionLabel;
  primary.onclick = action;
}

function desktopBridge() {
  const bridge = window.spareDesktop;
  if (!bridge) throw new Error("桌面启动桥接加载失败，请安装修复版客户端");
  return bridge;
}

async function start() {
  document.body.classList.remove("failed");
  errorMessage.hidden = true;
  primary.hidden = true;
  updateProgress("正在检查运行环境", 8);
  detail.textContent = "正在检查 Docker Desktop 和离线发布资源。";
  try {
    const status = await desktopBridge().getStatus();
    if (!status.resourcesReady) throw new Error("安装包资源不完整，请重新安装客户端");
    if (!status.docker) {
      if (status.resumeInstall && !resumeAttempted) {
        resumeAttempted = true;
        await installRuntime();
        return;
      }
      detail.textContent = "首次使用需要启用 WSL2 并安装 Docker Desktop，过程中可能要求管理员确认和重启。";
      showError(new Error("本机 Docker Desktop 尚未就绪"), "安装运行环境", installRuntime);
      return;
    }
    await desktopBridge().start();
  } catch (error) {
    detail.textContent = "服务未能启动。可以重试或打开诊断目录。";
    showError(error, "重试", start);
  }
}

async function installRuntime() {
  primary.disabled = true;
  updateProgress("正在安装运行环境", 20);
  detail.textContent = "请在系统提示中确认管理员权限；如需重启，登录后安装会继续。";
  try {
    const status = await desktopBridge().installRuntime();
    if (status.docker) await start();
    else showError(new Error("请完成 Docker Desktop 首次启动和许可确认后重试"), "重新检查", start);
  } catch (error) {
    showError(error, "重试安装", installRuntime);
  } finally {
    primary.disabled = false;
  }
}

if (window.spareDesktop) {
  window.spareDesktop.onProgress(({ message, percent }) => updateProgress(message, percent));
  diagnostics.addEventListener("click", () => window.spareDesktop.openDiagnostics());
} else {
  diagnostics.disabled = true;
}
start();
