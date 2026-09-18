# Windows 离线交付

目标为 Windows x64，使用固定 CPython 3.13.15 app-local runtime，不安装系统 Python、不改全局 PATH、注册表或其他项目环境。默认只从受审的 `project-minimum-001.json`、`project-case-large.json` 初始化新的 SQLite 运行库；不复制开发机数据库、账号会话或缓存。

## 依赖准备与真正离线安装

`packaging/windows-runtime.json` 固定官方 CPython NuGet URL 与 SHA-256；`packaging/requirements-windows.lock` 固定在 Windows x64 / CPython 3.13.15 上解析的 90 个 wheel 的版本和 SHA-256，包括 Mesa 3.5.1、Solara 1.57.5、NumPy、Pandas、SciPy、Matplotlib、openpyxl 及完整传递依赖。NuGet 是 [CPython 官方支持的应用本地发行方式](https://docs.python.org/3/using/windows.html#the-nuget-org-packages)，固定版本来源为 [python 3.13.15](https://www.nuget.org/packages/python/3.13.15)。wheel 只从官方 PyPI 获取。

先在联网 Windows 制备依赖输入，目标目录必须不存在：

```powershell
./scripts/prepare-windows-runtime.ps1 -Destination 'D:\SPARE-dependencies'
```

将完整 `D:\SPARE-dependencies` 和这份候选源码复制到断网 Windows，再执行：

```powershell
./scripts/prepare-windows-runtime.ps1 -Destination 'D:\SPARE-offline-runtime' -OfflineSource 'D:\SPARE-dependencies'
```

离线路径只解压本地 CPython 归档，通过 `pip --isolated --no-index --no-cache-dir --require-hashes` 安装本地 wheels，不调用公网下载分支；随后运行 `pip check`、核心依赖 import 和精确 distribution/wheel/归档校验。无需预装 Python、管理员权限或全局执行策略调整。PowerShell 如限制脚本，可用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`，只作用于这次进程。

依赖升级须在专用 Windows 环境重新解析完整依赖、生成每个 wheel 的哈希锁、审查差异，再重做离线安装和业务验收；不要直接把开发机 `pip freeze` 当成锁。

## 候选源码和打包

在 Git checkout 中直接构建；无 Git 的源码归档须在来源 checkout 生成清单，并与相同版本源码一起传输：

```bash
python scripts/portable-package.py source-manifest --root /tmp/spare-source-manifest.json
```

清单记录 commit 和文件哈希。发布前应提交候选变更，再生成清单。打包脚本只复制 Git 追踪、白名单允许的 `front/` 静态资源、`src/` Python、`contracts/` JSON/说明以及明确列出的三个受审 fixtures；不递归复制整个 `exports/` 或 `public/`。

```powershell
./scripts/build-portable.ps1 -RuntimeSource 'D:\SPARE-offline-runtime\runtime' -Destination './dist/SPARE'
# 源码归档无 Git 时追加：-SourceManifest 'D:\spare-source-manifest.json'
./dist/SPARE/scripts/test-port-selection.ps1
./dist/SPARE/scripts/verify-portable-package.ps1 -PackageRoot './dist/SPARE'
```

`-DependencyBundle` 默认取 runtime 的父目录；必须具有匹配受审锁的 wheels、CPython 归档、依赖版本清单。包包含应用、完整 runtime、wheelhouse/归档、启动停止脚本、说明、源码指纹及所有不可变文件的 SHA-256。`data/` 是可变运行状态，不参与后续静态完整性核对；验证脚本在启动前核对应用和 runtime 文件。

默认发布包只使用受审 fixtures。既有 `-ProjectFile 'D:\private\project.json' -ExperimentConfig 'D:\private\experiment.json'` 保留给明确授权的本地案例包；通过现有 BackendApi / ContractRepository 初始化独立数据库，并非把原文件放进源码。Project 应先经过 `ProjectJsonExporter` clean 边界，实验配置单独保存。这类包含案例数据的本地包不能冒充默认公开基线。

## 启动、验证与验收边界

双击 `Start-Platform.vbs` / `Start-Platform.cmd`，停止运行 `Stop-Platform.cmd`。日志在 `data/logs`，实际地址在 `data/active-ports.json`。使用包自己的 Python，禁用用户 site-packages 和字节码写入；只用包内 PID 文件且确认进程命令行归属后才停止服务。

验证脚本先校验完整性及依赖闭包，再启动服务、校验健康端点、前端模块 MIME、Solara 静态资源并停止自己启动的实例。`data/evidence/startup-smoke.json` 明确记录 **仅启动验收**，不宣称业务完成或机器已经断网。

本轮正式验收在 4700-4 的 `C:\Users\user\Models\spare_mvp-acceptance-<时间戳>-<提交>` 新建隔离环境完成，使用独立 runtime、数据库、端口和浏览器 profile，验证包内进程无公网依赖。已有 Windows 主机上的隔离环境验收不等同于全新操作系统验收。流程包括：安装、启动、登录、进入项目、建模保存、可视化推演推进、Monte Carlo、XLSX 导出。记录 Windows/Python 版本、候选 commit、包 manifest 哈希、断网证据、浏览器截图、MC 样本结果和下载文件；HTTP 200、仅 import 成功或联网主机的 `--no-index` 安装均不能替代完整验收。
