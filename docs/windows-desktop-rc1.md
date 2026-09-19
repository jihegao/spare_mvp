# Windows Desktop RC1

Desktop RC1 将现有 Web 界面和 Python 仿真服务封装为 Electron 客户端与本机 Docker Compose 服务。它与 [`windows-portable.md`](windows-portable.md) 的 app-local Python 便携包是两条独立交付路线；两者不共享运行数据库，也不能互相覆盖。

## 用户路径

用户双击 `spare-mvp-2.0-desktop-rc1-setup.exe` 安装客户端。首次启动时，客户端先校验发布清单和离线容器镜像，再检查 Docker Desktop。运行环境缺失时，用户可在启动页选择安装；系统会请求管理员授权、启用 WSL2 所需 Windows 功能、安装包内 WSL MSI 和 Docker Desktop。需要重启时，安装器写入当前用户 `RunOnce`，但不自动重启；客户端明确显示“保存工作并重启 Windows”，用户再次确认后才安排 60 秒倒计时，重新登录后继续。Docker Desktop 的许可确认由用户在首次启动时显式完成，脚本不代替用户接受许可。

Docker 就绪后，客户端只启动 Compose project `spare-mvp-desktop-rc1`，动态选择本机端口并仅绑定 `127.0.0.1`。关闭窗口可选择后台继续，或只停止本产品容器；不得关闭整机 Docker。业务数据保存在命名卷 `spare-mvp-desktop-rc1-data`，导出和诊断文件保存在用户 AppData 的 `spare-mvp-desktop` 目录。卸载客户端默认保留这些运行数据。

## 发布资源

Electron 的 `extraResources/desktop-resources` 必须包含：

- `runtime/compose.yaml`；
- `runtime/spare-mvp-image.tar`；
- `prerequisites/install-runtime.ps1`；
- `prerequisites/Docker Desktop Installer.exe`；
- `prerequisites/wsl.msi`；
- `release-manifest.json`，固定源码提交、镜像 tag、镜像 tar SHA-256 和先决条件版本/哈希。

启动窗口保持 `sandbox: true` 和 `contextIsolation: true`，其 IPC 桥接必须使用沙箱支持的 CommonJS `preload.cjs`。桥接未加载时，启动页必须显示可见错误，不能停留在静态“正在检查运行环境”状态；Docker 就绪检查必须有有限超时。

管理员安装进程必须通过 `-EncodedCommand` 接收无歧义参数，并将真实退出码返回客户端。安装脚本从启动起持续更新 `C:\ProgramData\SpareMvpDesktop\install-state.json`，失败时保留具体原因；Docker Desktop 探测同时覆盖用户目录和 `Program Files`。

Python 镜像从固定 digest 的 `python:3.13.15-slim` 构建，并通过 `packaging/requirements-linux.lock` 的哈希锁安装依赖。数据库初始化只在命名卷中数据库不存在时执行；已存在数据库先做 `PRAGMA quick_check`，不会被基线 fixture 覆盖。

## 安全与兼容边界

渲染进程关闭 Node integration，启用 context isolation 与 sandbox；只有本地启动页可调用受限 preload IPC。业务窗口禁止弹窗和离开 `localhost` / `127.0.0.1`。镜像导入前必须校验 SHA-256，Compose 不允许使用 `latest`，服务端口不对局域网开放。

首批目标是 Windows 10 22H2 x64 专业版/企业版、已开启硬件虚拟化的机器。内存、磁盘、Windows 功能和发布文件证据由 `Test-DesktopPrerequisites.ps1` 只读采集。发布到目标机不等同于安装或业务验收；启用系统组件、安装 Docker、重启和 Docker 许可确认必须由用户明确发起。

## 验收

发布候选至少依次通过：源码契约测试、固定镜像构建、Compose 健康检查、真实浏览器业务闭环、镜像导出后哈希校验、Windows 安装包构建、目标机文件哈希复核和目标机只读预检。正式发布还需在干净 Windows 10 实机完成断网安装、重启续装、登录、建模保存、可视化推进、Monte Carlo 和 XLSX 导出；只读预检或已有 Docker 主机上的容器验证不能替代该验收。
