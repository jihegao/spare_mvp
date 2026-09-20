# Windows 绿色桌面版

> **当前交付状态**：本页原有构建与卸载说明描述 PR #380 初始实现；其中安装目录内 `data/`、整目录删除用户数据和元数据缓存说明尚不满足 #381/#379。下列 G0 契约是本轮实现与验收的约束，不代表功能或原生 Windows 验收已经完成。正式合并、发布和切换不在当前授权内。

最终离线交付文件为 `spare-mvp-2.0-green.exe`。它是普通用户权限运行的自解压包：用户选择目录后，程序解压完整平台并启动 `SpareMvpDesktop.exe`。该路线不安装或调用 Docker Desktop、WSL，不启用 Windows 可选功能，不接受第三方许可，也不安排 Windows 重启。

解压目录同时包含：

- `SpareMvpDesktop.exe` 及 Electron/Chromium 桌面资源；
- `runtime/python.exe` 和锁定的 Windows x64 Python 依赖；
- `app/` 中的后端、前端、模型和契约；
- `data/spare_mvp.sqlite3` 基线数据库及后续本机状态；
- `assets/` 中经哈希锁定的 Solara 离线资源；
- `scripts/start-portable.ps1`、`stop-portable.ps1`、进程所有权校验、端口选择和完整性校验脚本；
- `Uninstall-SpareMvp.exe` 卸载程序；
- `Start-Platform.cmd/.vbs` 与 `Stop-Platform.cmd` 浏览器备用入口。

解压成功后，自解压器自动在当前用户桌面创建 `spare_mvp 2.0.lnk`，目标为当前解压目录中的 `SpareMvpDesktop.exe`，工作目录也绑定到该解压目录。再次把另一套绿色版解压到其他位置时，新安装会接管同名桌面快捷方式，不复制第二套启动逻辑。

桌面启动器不得复制第二套业务启动逻辑。它调用包内 `start-portable.ps1 -AutoSelectPorts -NoBrowser`，读取 `data/active-ports.json`，在后端和 Solara 健康检查通过后打开内置业务窗口。退出时只允许停止通过解释器路径、创建时间、服务命令和实例标识共同确认属于当前绿色包的 Python 进程。

PowerShell 主进程退出即代表启动脚本完成；不能等待所有后代继承的 stdout/stderr 管道关闭，因为后端和 Solara 会作为受管后台进程继续运行。桌面启动器随后按活动状态文件和 HTTP 健康检查确认服务，而不是把管道关闭误当成服务生命周期。

桌面程序启动前使用包内 Python 执行 `portable-package.py verify-cached --progress`。首次启动完整校验 `manifest.json` 覆盖的应用、运行时、桌面二进制和离线资源；后续启动使用 fail-closed 元数据缓存并重新哈希关键运行文件，任何清单、路径、大小或 mtime 变化都会回退完整 SHA-256。`data/` 是本机可变状态，不参与静态发布哈希。启动页显示已校验文件数，完整性进程最多允许 10 分钟，不能因固定 180 秒超时误杀较慢磁盘上的正常校验。诊断包只收集发布清单、活动端口和 `data/logs/*.log`，不得收集账号凭据或项目正文。

## 构建

先按 [`windows-portable.md`](windows-portable.md) 生成一个全新的原生便携包；不得把已经运行并产生用户数据的验收目录直接作为发布输入。再生成 Electron Windows 目录包，并在 Windows 上封装绿色自解压文件：

```powershell
npx electron-builder --win dir --x64 -c.win.signAndEditExecutable=false
./packaging/green/Build-GreenPackage.ps1 `
  -PortablePackage 'D:\build\spare-portable' `
  -DesktopDirectory '.\dist\desktop-installer\win-unpacked' `
  -Destination '.\dist\spare-mvp-2.0-green.exe'
```

从无 `.git` 的受控源码归档构建时，先在原 checkout 运行 `green-source-manifest.py --root <文件>`，再向封装命令传入 `-GreenSourceManifest <文件>`；封装器会核对受审文件集合和逐文件 SHA-256。

封装脚本在临时目录合并便携包和桌面目录，重新生成并验证 `manifest.json`，然后创建单文件自解压包及相邻的 `.manifest.json`。目标文件存在时构建失败，不覆盖既有候选。

自解压器要求 Windows 自带 `tar.exe`，解压前校验内置 payload 的 SHA-256；目标目录存在且非空时拒绝覆盖。发布仍需单独记录整个 EXE 的 SHA-256，因为内置哈希只用于传输损坏检测，不替代代码签名或外部发布校验。

默认交付方式是双击并选择目录。自动化验收可运行 `spare-mvp-2.0-green.exe --extract-to <父目录> --no-launch`；它仍执行同一 payload 哈希校验和解压逻辑，只省略交互窗口与自动启动。失败时在父目录写入 `spare-mvp-green-extract-error.log` 并返回非零退出码。

## 卸载

运行解压目录根部的 `Uninstall-SpareMvp.exe`。确认窗口默认选择“否”，并明确提示卸载会永久删除整个绿色版目录，包括 `data/` 中的项目、数据库、日志和其他本机状态。确认后，卸载器先调用受管的 `stop-portable.ps1`；服务无法按进程所有权规则安全停止时拒绝删除。随后只关闭可执行路径精确位于当前安装目录的 `SpareMvpDesktop.exe` 进程，再由临时工作副本删除原安装目录。

桌面快捷方式仅在其目标仍精确指向本次安装的 `SpareMvpDesktop.exe` 时删除。如果同名快捷方式已被用户修改或被另一套绿色版接管，卸载器保留该快捷方式并在完成消息中说明。卸载器不扫描或删除其他目录、其他安装、用户桌面文件或非本包拥有的进程。

## 验收

正式验收必须在 4700-4 的新目录进行，不能覆盖已有 Docker 版或便携版，也不能复用已修改的 SQLite。至少验证：无管理员弹窗、未调用 Docker/WSL、中文和空格路径、桌面快捷方式目标与工作目录、端口冲突回退、完整性失败阻断、异常启动日志、桌面窗口真实业务流程、停止后的进程和端口清理，以及解压前后 EXE/manifest 哈希留证。卸载验收需要先写入可识别的临时 `data/` 文件，确认取消卸载不改变目录，再确认正式卸载删除整个目录和本安装拥有的快捷方式，同时不影响另一目录及其进程。浏览器/API/静态资源通过不等于完整业务验收。


## 安全交付技术契约（G0）

范围为 [#380](https://github.com/jihegao/spare_mvp/pull/380)、[#381](https://github.com/jihegao/spare_mvp/issues/381)、[#382](https://github.com/jihegao/spare_mvp/issues/382)、[#379](https://github.com/jihegao/spare_mvp/issues/379) 和 [#366](https://github.com/jihegao/spare_mvp/issues/366) 的本轮剩余验收。代码基点为 `33974c58053da36000de05014b7856aa4352699b`，对应 main 基点 `5352a0d7757cbac012c75d516d1a7ac4ff15aa2a`。可开发、提交、推送及准备 PR；完成终点为原生 Windows 隔离验收和待发布交接。不得据此合并、正式发布、切换既有服务或关闭 issue；不操作 4700-3。

### 路径、身份与写入权

- 程序、Electron、Python、应用和离线资源留在安装目录，静态清单不包含业务数据及运行态。
- 生产业务数据默认位于 `%LOCALAPPDATA%\spare_mvp\data`，当前用户的多个安装默认共用；数据库、应保留配置及迁移备份在此生命周期内管理。隔离验收显式指定独立数据根。
- 唯一解析入口为 `scripts/portable-paths.py`：`--package-root` 必填，`--data-root` 可选；数据根选择顺序为显式参数、`SPARE_MVP_DATA_ROOT`、当前安装已绑定的数据根、生产默认值。覆盖路径必须为绝对路径。启动、停止、桌面、备份恢复与诊断消费该入口，不各自推导用户目录。
- 解析结果以 JSON 输出 `package_root`、`installation_id`、`data_root`、`database`、`instance_root`、`state_file`、`pid_root`、`logs_dir`、`diagnostics_dir`、`integrity_cache`。安装身份由规范化真实安装路径稳定派生；实例状态根位于 `%LOCALAPPDATA%\spare_mvp\instances\<installation_id>`。路径规范化及越界校验只在公共入口实现。
- 当前安装的数据根绑定随实例元数据保留，保证无环境变量的停止及卸载仍定位同一数据。端口、PID、启动锁、日志、诊断与校验缓存按安装实例隔离；不得通过另一实例的活动端口文件复用或停止其服务。
- **共享写锁**以规范化业务数据根为键，位于共同协调路径或使用当前用户 named mutex；须覆盖初始化、迁移、恢复及后端运行整个写入期。实例局部启动锁只防止本安装重复启动，不替代跨安装写互斥。其他安装占用时失败关闭，不终止对方。
- 用户导出位置由用户选择，永不纳入卸载删除范围。诊断排除凭据和项目正文。

### 迁移、运行与卸载

- 旧安装 `data/` 迁移必须先停止可证明属于旧实例的写入者，取得共享写权，使用 SQLite backup 生成一致副本，验证 `quick_check` 和关键业务表记录一致，成功后才切换绑定。WAL/SHM 不通过复制活跃主库绕过；旧副本保留可恢复。
- 目标已有业务库且旧库也存在时禁止覆盖或自动合并；报告两个路径并保留原状。迁移中断不切换绑定；重试不能把半成品当成功库。全新数据库使用仓库既有初始化/fixture 边界，不把运行数据库提交或封入制品。
- 复用运行状态须同时验证后端、Solara 和实例身份。部分服务失效时仅受控停止本实例拥有的残余服务并重启；所有权无法证明时保留记录并报错。
- 解压失败只清理本次创建并拥有的半成品目标及临时 payload；既有安装、已有空目录所有权之外内容和业务数据不得删除。随后可在同一父目录重试。
- 默认卸载只删除本安装程序、实例临时状态及仍归本安装的快捷方式，保留业务数据。永久删除用户数据为独立二次确认，显示绝对路径和不可恢复说明，默认取消；数据仍被其他安装绑定或占用时禁止永久删除。不得停止另一安装或删除其状态、其他用户数据或用户导出。
- #382 删除“打开诊断目录”按钮和专属 renderer/bridge/IPC/错误引导；保留现有诊断包生成，不扩建诊断中心。

### 完整性与发行接口

- `portable-package.py verify-cached --root <安装目录> --cache-path <解析器给出的 integrity_cache>` 是桌面到校验器的接口；新增 `--cache-path`，缺省安全行为为执行完整校验且不写隐式缓存，不能回退到安装内 `data/`。校验器不得另行拼接 `%LOCALAPPDATA%`。
- 缓存命中仍校验全部可执行/可导入内容，包括 Python 库、扩展、Electron DLL、应用脚本和离线动态资源；相同大小及 mtime 不构成内容可信证明。无法证明等价保护时保留完整 SHA-256 校验。
- 构建环境完整验证 CPython 原始归档、wheelhouse、锁文件、运行时和离线资源；最终用户包移除仅用于构建的归档与 wheelhouse，保留来源/版本/哈希证据。先提交包体精简，再提交有证据的校验优化。
- 构建、安装 payload、运行文件和清单验证必须失败关闭；不以降低保护换取启动耗时改善。新增公共路径脚本须进入发行 allowlist 和来源清单。

### 文件租约与集成

| 所有者 | 独占修改范围 |
| --- | --- |
| lifecycle 组 | `scripts/portable-paths.py` 及其新测试；`scripts/start-portable.ps1`、`stop-portable.ps1`、`portable-process.ps1`、`initialize-case-database.py`、备份恢复脚本；`desktop/` 运行/UI/诊断代码；`packaging/green/GreenExtractor.cs`、`GreenUninstaller.cs`；桌面/解压/进程/初始化测试。 |
| integrity 组 | `scripts/portable-package.py`、`scripts/build-portable.ps1`、`packaging/green/Build-GreenPackage.ps1`、`green-source-manifest.py`、`source-files.txt`；portable package/runtime manifest 测试。 |
| Tech lead | 当前中文文档、证据索引、跨组接口决策和唯一集成分支。组提交经复核后由 Tech lead cherry-pick；共享文件调整先转交所有者，不并写。 |

lifecycle 组先交公共解析接口和测试；integrity 组按上述 JSON/cache 参数契约独立实现。#382 与 lifecycle 同属 desktop 文件，保持独立小提交。实现组交付提交 SHA、修改文件、命令/结果和未解决问题；测试代理与审查代理独立给出验收意见，不能用作者自测代替。

### 验收证据索引

以下全部为**待验证**，只在证据绑定最终候选源码 SHA、包/清单 SHA-256、目标主机、实际路径、运行时版本和执行时间后更新。证据写入 `docs/evidence/desktop-safe-delivery/`；不得保存凭据、用户项目正文或完整运行数据库。

| 证据文件 | 最低内容与关闭条件 |
| --- | --- |
| `candidate.json` | 源码/包/清单身份、文件数和体积、Python/Electron 版本、离线构建来源；不得将未执行测试标 passed。 |
| `data-lifecycle.json` | 新安装、旧库一致迁移、目标冲突、中断重试、重装发现、共享写锁、取消/默认/永久卸载、相邻安装与快捷方式保护；记录前后关键表摘要及 `quick_check`。 |
| `integrity-and-startup.json` | 原生 Windows 首次/后续启动耗时的同环境前后对照；payload/manifest/可执行内容篡改，包括保持大小/mtime；双服务健康、端口冲突、解压失败重试、全离线启动与停止清理。 |
| `issue-366.json` | 1/2/4/5/11 逐页专项、3 默认数据库长名称；9 创建实验点击/请求/数据库/响应/可操作分段前后对照，不套 60 秒指标。 |
| `electron-business.json` | 最终 Electron 包真实业务与五个原有独立入口 F35 50 样本，逐页点击到结果显示 ≤60 秒；同方案/输入指纹，各自成功失败数及资源/超时证据。 |
| `handoff.md` | 各门通过/失败/阻塞、复核人、候选路径/哈希、保留数据及回滚位置、待授权的正式合并与发布步骤。 |

原生验收使用 4700-4 新目录及独立数据根；保留现有 V2 安装、数据库与服务。最终综合验收绑定同一个候选；静态测试、Linux 测试、历史 Edge 数字不能替代该包验收。

本地契约检查入口（尚未因本契约新增而执行）：

```bash
node --test tests/green-extractor-contract.test.mjs tests/desktop-runtime-contract.test.mjs
python -m unittest tests.test_portable_package tests.test_portable_runtime_manifest tests.test_desktop_database_initializer -v
npm test
git diff --check
```

Python 使用仓库 Python ≥3.12 的测试环境；原生目标使用包内锁定 Python。Windows 进程所有权检查为 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\test_portable_process.ps1`。原生迁移、卸载及 Electron 交互另按上表执行，不以源码正则契约测试代替。

### 后续任务边界

#383 在本轮桌面候选综合门通过后实施：六页使用后端持有的任务，切页或刷新重连同一 `task_id`，不要求退出应用或重启服务续算；独立 RBD 采用 Python 等价迁植和现有 JS 差分验证，不能降级为页面 Worker。保持唯一 Project 编译入口和当前计算/结果口径，不新增一键全部分析。#364 先更新 V2 基线，性能优化不进入本轮发布阻断修复。
