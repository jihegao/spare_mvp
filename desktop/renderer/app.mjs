const title = document.querySelector("#status-title");
const detail = document.querySelector("#status-detail");
const progress = document.querySelector(".progress");
const progressBar = document.querySelector("#progress-bar");
const primary = document.querySelector("#primary-action");
const errorMessage = document.querySelector("#error-message");

function updateProgress(message, percent) {
  title.textContent = message;
  progress.setAttribute("aria-valuenow", String(percent));
  progressBar.style.width = `${percent}%`;
  document.querySelectorAll("[data-step]").forEach((step, index) => {
    step.classList.toggle("active", percent >= [5, 45, 90][index]);
    step.classList.toggle("done", percent >= [45, 90, 100][index]);
  });
}

function showError(error, actionLabel = "重试") {
  document.body.classList.add("failed");
  errorMessage.hidden = false;
  errorMessage.textContent = error?.message || String(error);
  primary.hidden = false;
  primary.textContent = actionLabel;
  primary.onclick = start;
}

function desktopBridge() {
  const bridge = window.spareDesktop;
  if (!bridge) throw new Error("桌面启动桥接加载失败，请重新解压绿色版");
  return bridge;
}

async function start() {
  document.body.classList.remove("failed");
  errorMessage.hidden = true;
  primary.hidden = true;
  updateProgress("正在校验内置运行环境", 8);
  detail.textContent = "正在检查包内 Python、应用文件、SQLite 数据和离线前端资源。";
  try {
    const status = await desktopBridge().getStatus();
    if (!status.resourcesReady) {
      throw new Error("绿色版文件不完整，请重新解压完整安装包后再启动");
    }
    detail.textContent = status.running
      ? "检测到本绿色版服务正在运行，正在重新打开工作区。"
      : "无需 Docker、WSL 或管理员权限，正在启动包内服务。";
    await desktopBridge().start();
  } catch (error) {
    detail.textContent = "本机服务未能启动，请重试。";
    showError(error);
  }
}

if (window.spareDesktop) {
  window.spareDesktop.onProgress(({ message, percent }) => updateProgress(message, percent));
}
start();
