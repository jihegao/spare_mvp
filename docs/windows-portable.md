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

离线路径只解压本地 CPython 归档，通过 `pip --isolated --no-index --no-cache-dir --require-hashes` 安装本地 wheels，不调用公网下载分支；随后运行 `pip check`、核心依赖 import 和精确 distribution/wheel/归档校验。完成锁定安装和 import 验证后清理字节码，生成 `runtime-manifest.json`，记录完整 runtime 文件 SHA-256 并绑定 CPython 归档、runtime 规格和依赖锁。旧 bundle 缺少此清单时必须通过 `-OfflineSource` 从归档和 wheels 重新准备到新目录；不要对来源未知的已有 runtime 补写清单。无需预装 Python、管理员权限或全局执行策略调整。PowerShell 如限制脚本，可用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`，只作用于这次进程。

依赖升级须在专用 Windows 环境重新解析完整依赖、生成每个 wheel 的哈希锁、审查差异，再重做离线安装和业务验收；不要直接把开发机 `pip freeze` 当成锁。

## 候选源码和打包

Solara 浏览器资源也必须离线准备：Python wheels 不包含运行时 CDN 的全部 JS、动态 chunks、CSS 和字体。`packaging/solara-assets.lock.json` 锁定官方 npm 归档及每个输出文件 SHA-256；准备脚本只读取归档中的受审文件，不执行 npm 安装脚本。dist 保留生产动态资源（不含调试 sourcemap，以及两项仅被未压缩开发入口引用的长名称 dev chunks），并包括 Font Awesome、RequireJS、KaTeX 和 Mermaid。原包 webpack 配置将 `.min.js` 标为 production；app8 的动态加载器只请求 `692`、`872` 两个 `.min.js` chunks，app7 对应 `155`、`306`，准备和校验均检查该闭包。新版 runtime 准备脚本同时生成 `solara-cdn/`；已有已验证 runtime 可独立准备资源而无需重建：

```bash
python scripts/prepare-solara-assets.py --destination /tmp/spare-solara-cdn
# 断网复制：追加 --offline-source /path/to/reviewed-solara-cdn
python scripts/prepare-solara-assets.py --destination /tmp/spare-solara-cdn --verify
```

独立资源目录在构建时用 `-FrontendAssets 'D:\SPARE-solara-cdn'` 指定，默认使用 `DependencyBundle/solara-cdn`。缺失、额外或哈希不同的文件均阻断构建。资源和锁复制到包内不可变 `assets/`，随 manifest 校验；启动再次检查缓存，并设置 `SOLARA_ASSETS_PROXY_CACHE_DIR` 指向包内目录，`SOLARA_ASSETS_PROXY=true`。CDN 缓存 miss 的回源地址固定为本机不可用端口，不向公网回源；因此遗漏资源会明确失败，不会借用开发机缓存或网络。

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

`-DependencyBundle` 默认取 runtime 的父目录；构建环境必须具有匹配受审锁的 wheels、CPython 归档、依赖版本清单及 `runtime-manifest.json`。构建逐文件验证实际 `-RuntimeSource`，不能用 B bundle 的校验替代 A runtime 的内容检查；新增字节码、修改或缺少文件都会阻断。最终用户包的 `dependencies/` 只保留 `windows-runtime.json`、`requirements-windows.lock`、`installed-distributions.json` 和 `runtime-manifest.json`；`wheelhouse/` 与 `downloads/` 留在受控构建环境，不重复进入发行包。封包时用保留的规格、锁和 runtime manifest 重新核对复制后的 runtime。

绿色封装还要求 portable source manifest、green source manifest 与 Electron 的 `desktop-build-provenance.json` 使用同一源码提交；后者绑定受审 desktop 源文件、`app.asar` 和桌面 EXE 哈希。混用旧 portable 或旧 `win-unpacked` 会在封装前失败。

首次桌面启动对所有不可变文件执行 SHA-256，并在 `%LOCALAPPDATA%\spare_mvp\instances\<installation_id>\integrity-cache.json` 记录 manifest 哈希以及每个文件的路径、大小和 mtime。后续启动先逐项比对元数据，并始终重新哈希 `app/`、`assets/`、`scripts/`、Electron `resources/`、桌面主程序、源码清单和 Python 核心可执行/DLL；缓存缺失、损坏或任一元数据变化都会退回完整 SHA-256，校验失败则阻断启动。安装目录中的 `data/` 仅作为旧版数据迁移来源，不再承载活动状态，也不纳入发布 manifest；完整性缓存同样不替代外部 EXE 哈希或代码签名。

绿色自解压程序要求最终解压目录尚不存在；即使为空目录也拒绝覆盖，以免把目录所有权判断建立在无法证明的既有内容上。失败时只清理本次创建的 `.extracting-*` 暂存目录，保留既有目录、其他安装和业务数据，随后可在同一父目录重新选择新的目标重试。发行包内的本文件会复制为 `README-Windows.md`，两者内容来自同一受审来源。

默认发布包只使用受审 fixtures。既有 `-ProjectFile 'D:\private\project.json' -ExperimentConfig 'D:\private\experiment.json'` 保留给明确授权的本地案例包；通过现有 BackendApi / ContractRepository 初始化独立数据库，并非把原文件放进源码。Project 应先经过 `ProjectJsonExporter` clean 边界，实验配置单独保存。这类包含案例数据的本地包不能冒充默认公开基线。

## 启动、验证与验收边界

源清单采用 v2，覆盖应用、所有实际复制的启动脚本、入口、说明文件，并绑定构建脚本、数据库初始化器与依赖锁。修改这些文件后必须提交候选并重新生成清单；旧清单不能继续用于构建。暂存后的源码也在封包前再次核对，字节码文件纳入包完整性检查。

双击 `Start-Platform.vbs` / `Start-Platform.cmd`，停止运行 `Stop-Platform.cmd`。`scripts/portable-paths.py` 是唯一运行路径解析入口；端口状态、PID、日志、验收证据、诊断和完整性缓存在 `%LOCALAPPDATA%\spare_mvp\instances\<installation_id>` 下按安装隔离。启动器、停止器和验证脚本只消费解析结果，不向包内 `data/` 写运行状态。使用包自己的 Python，禁用用户 site-packages 和字节码写入。PID 旁的 `.pid.json` 保存创建时间、服务模块、解释器路径和本次启动标识；全部匹配后才停止该进程。身份未知时保留记录并报告，不终止进程。旧版只有 PID 的记录不能作为终止凭据。

新安装在迁移和发布数据根 binding 前取得全局 binding inventory mutex，并在锁内重新扫描所有安装的 binding；因此父目录和子目录候选不能通过并发启动绕过嵌套保护。

验证脚本先校验完整性及依赖闭包，再启动服务、校验健康端点、前端模块 MIME、Solara 静态资源并停止自己启动的实例。解析结果的 `evidence_dir/startup-smoke.json` 明确记录 **仅启动验收**，不宣称业务完成或机器已经断网。

本轮正式验收在 4700-4 的 `C:\Users\user\Models\spare_mvp-acceptance-<时间戳>-<提交>` 新建隔离环境完成，使用独立 runtime、数据库、端口和浏览器 profile，验证包内进程无公网依赖。已有 Windows 主机上的隔离环境验收不等同于全新操作系统验收。流程包括：安装、启动、登录、进入项目、建模保存、可视化推演推进、Monte Carlo、XLSX 导出。记录 Windows/Python 版本、候选 commit、包 manifest 哈希、断网证据、浏览器截图、MC 样本结果和下载文件；HTTP 200、仅 import 成功或联网主机的 `--no-index` 安装均不能替代完整验收。
