# Windows 绿色桌面版

最终离线交付文件为 `spare-mvp-2.0-green.exe`。它是普通用户权限运行的自解压包：用户选择目录后，程序解压完整平台并启动 `SpareMvpDesktop.exe`。该路线不安装或调用 Docker Desktop、WSL，不启用 Windows 可选功能，不接受第三方许可，也不安排 Windows 重启。

解压目录同时包含：

- `SpareMvpDesktop.exe` 及 Electron/Chromium 桌面资源；
- `runtime/python.exe` 和锁定的 Windows x64 Python 依赖；
- `app/` 中的后端、前端、模型和契约；
- `data/spare_mvp.sqlite3` 基线数据库及后续本机状态；
- `assets/` 中经哈希锁定的 Solara 离线资源；
- `scripts/start-portable.ps1`、`stop-portable.ps1`、进程所有权校验、端口选择和完整性校验脚本；
- `Start-Platform.cmd/.vbs` 与 `Stop-Platform.cmd` 浏览器备用入口。

桌面启动器不得复制第二套业务启动逻辑。它调用包内 `start-portable.ps1 -AutoSelectPorts -NoBrowser`，读取 `data/active-ports.json`，在后端和 Solara 健康检查通过后打开内置业务窗口。退出时只允许停止通过解释器路径、创建时间、服务命令和实例标识共同确认属于当前绿色包的 Python 进程。

桌面程序启动前使用包内 Python 执行 `portable-package.py verify`。`manifest.json` 覆盖应用、运行时、桌面二进制和离线资源；`data/` 是本机可变状态，不参与静态哈希。诊断包只收集发布清单、活动端口和 `data/logs/*.log`，不得收集账号凭据或项目正文。

## 构建

先按 [`windows-portable.md`](windows-portable.md) 生成一个全新的原生便携包；不得把已经运行并产生用户数据的验收目录直接作为发布输入。再生成 Electron Windows 目录包，并在 Windows 上封装绿色自解压文件：

```powershell
npx electron-builder --win dir --x64 -c.win.signAndEditExecutable=false
./packaging/green/Build-GreenPackage.ps1 `
  -PortablePackage 'D:\build\spare-portable' `
  -DesktopDirectory '.\dist\desktop-installer\win-unpacked' `
  -Destination '.\dist\spare-mvp-2.0-green.exe'
```

封装脚本在临时目录合并便携包和桌面目录，重新生成并验证 `manifest.json`，然后创建单文件自解压包及相邻的 `.manifest.json`。目标文件存在时构建失败，不覆盖既有候选。

自解压器要求 Windows 自带 `tar.exe`，解压前校验内置 payload 的 SHA-256；目标目录存在且非空时拒绝覆盖。发布仍需单独记录整个 EXE 的 SHA-256，因为内置哈希只用于传输损坏检测，不替代代码签名或外部发布校验。

## 验收

正式验收必须在 4700-4 的新目录进行，不能覆盖已有 Docker 版或便携版，也不能复用已修改的 SQLite。至少验证：无管理员弹窗、未调用 Docker/WSL、中文和空格路径、端口冲突回退、完整性失败阻断、异常启动日志、桌面窗口真实业务流程、停止后的进程和端口清理，以及解压前后 EXE/manifest 哈希留证。浏览器/API/静态资源通过不等于完整业务验收。
