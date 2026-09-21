# Windows 绿色桌面版

> **当前交付状态（2026-09-21）**：源码 `2252f03ae2ce21e1780638ee9b9e298b6516e174` 已完成 Windows 原生构建、隔离解压、安装、启动和基础 HTTP 冒烟，旧候选的 SQLite 句柄故障已经修复。该证据只覆盖 build/install/start/basic smoke；卸载、重装、数据生命周期、完整业务流程、#366 最终矩阵和正式发布仍未通过，不得据此关闭 issue 或标记 V2 正式发布。

最终离线交付文件为 `spare-mvp-2.0-green.exe`。它是普通用户权限运行的自解压包：用户选择目录后，程序解压完整平台并启动 `SpareMvpDesktop.exe`。该路线不安装或调用 Docker Desktop、WSL，不启用 Windows 可选功能，不接受第三方许可，也不安排 Windows 重启。

解压目录同时包含：

- `SpareMvpDesktop.exe` 及 Electron/Chromium 桌面资源；
- `runtime/python.exe` 和锁定的 Windows x64 Python 依赖；
- `app/` 中的后端、前端、模型和契约；
- `data/spare_mvp.sqlite3` 作为首次初始化或旧版迁移的来源，业务库切换到安装目录之外；
- `assets/` 中经哈希锁定的 Solara 离线资源；
- `scripts/start-portable.ps1`、`stop-portable.ps1`、进程所有权校验、端口选择和完整性校验脚本；
- `Uninstall-SpareMvp.exe` 卸载程序；
- `Start-Platform.cmd/.vbs` 与 `Stop-Platform.cmd` 浏览器备用入口。

解压成功后，自解压器自动在当前用户桌面创建 `备件规划及任务可靠度验证评估平台 V2.0.lnk`，目标为当前解压目录中的 `SpareMvpDesktop.exe`，工作目录也绑定到该解压目录。若同名新快捷方式已存在，仅在目标、工作目录、空参数、说明和图标都证明它属于本次安装时刷新；否则保留原链接并停止解压事务。升级时仅在旧名称 `spare_mvp 2.0.lnk` 的上述属性都匹配旧版自有标记时删除旧快捷方式；用户修改、用户自建或已被其他安装接管的快捷方式保持不变。

桌面启动器不得复制第二套业务启动逻辑。它调用包内 `start-portable.ps1 -AutoSelectPorts -NoBrowser`，通过公共路径解析器读取本安装实例的 `active-ports.json`，在后端和 Solara 健康检查通过后打开内置业务窗口。退出时只允许停止通过解释器路径、创建时间、服务命令和实例标识共同确认属于当前绿色包的 Python 进程。

PowerShell 主进程退出即代表启动脚本完成；不能等待所有后代继承的 stdout/stderr 管道关闭，因为后端和 Solara 会作为受管后台进程继续运行。桌面启动器随后按活动状态文件和 HTTP 健康检查确认服务，而不是把管道关闭误当成服务生命周期。

桌面程序启动前使用包内 Python 执行 `portable-package.py verify-cached --progress --cache-path <实例缓存路径>`。首次启动完整校验 `manifest.json` 覆盖的应用、运行时、桌面二进制和离线资源；后续启动扫描清单并重新哈希可执行、可导入内容、应用/离线动态资源和发行来源证据，即使大小及 mtime 不变也不能跳过这些内容。清单或元数据变化触发完整 SHA-256；未提供缓存路径时执行完整校验。业务数据及实例运行态不参与静态发布哈希。启动页显示已校验文件数，完整性进程最多允许 10 分钟。诊断包生成接口保留，收集发布清单、活动状态和实例日志；“打开诊断目录”入口及专属调用链已经移除，诊断不得收集账号凭据或项目正文。

## 构建

先按 [`windows-portable.md`](windows-portable.md) 生成一个全新的原生便携包；不得把已经运行并产生用户数据的验收目录直接作为发布输入。再生成 Electron Windows 目录包，并在 Windows 上封装绿色自解压文件：

当前 Linux 交叉构建必须将 Electron zip 缓存与 electron-builder 工具缓存分开，并且不得设置 `ELECTRON_BUILDER_CACHE`：锁定的 `app-builder-lib 26.0.20` 会把该变量的值拼入 artifact 名称，导致内置 `winCodeSign` 元数据无法匹配。使用任务独占的 `XDG_CACHE_HOME`，其中预置并验证 `electron-builder/winCodeSign/winCodeSign-2.6.0/`；其官方归档 `winCodeSign-2.6.0.7z` 为 5,635,384 bytes，SHA-256 为 `cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4`，并匹配锁定 app-builder 内置的 SHA-512 `6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA==`。`electron_config_cache` 与 `ELECTRON_CACHE` 同时指向另一个任务独占的 Electron zip 缓存：前者供 `electron@38.1.2` 的 npm lifecycle 读取构建主机 zip，后者供 electron-builder 读取 Windows 目标 zip。

```bash
unset ELECTRON_BUILDER_CACHE
export XDG_CACHE_HOME=/path/to/task-owned/xdg-cache
export ELECTRON_CACHE=/path/to/task-owned/electron-cache
export electron_config_cache=/path/to/task-owned/electron-cache
cd desktop
npm run dist:win
cd ..
```

```powershell
./packaging/green/Build-GreenPackage.ps1 `
  -PortablePackage 'D:\build\spare-portable' `
  -DesktopDirectory '.\dist\desktop-installer\win-unpacked' `
  -Destination '.\dist\spare-mvp-2.0-green.exe'
```

`npm run dist:win` 是受审的唯一 Electron 目录包构建入口。它在调用锁定的 `electron-builder 26.0.20` 前，先校验 `app-builder-lib` 依赖收集器的版本、完整文件 SHA-256 和预期源码片段，再幂等应用仅等待 stdout 写流完成的本地补丁；任一内容漂移都会失败关闭。构建完成后生成 `desktop-build-provenance.json`，绑定源码提交、受审 desktop 源文件、`app.asar` 和桌面 EXE 的 SHA-256；绿色封装器要求 portable source manifest、green source manifest 和该证明使用同一提交，并重新核对制品哈希。该步骤不改变依赖收集命令、生产依赖闭包、ASAR 配置、Windows 可执行文件资源编辑或重试行为，构建不得用直接调用 `electron-builder` 或关闭 `signAndEditExecutable` 绕过。

从无 `.git` 的受控源码归档构建时，先在原 checkout 运行 `green-source-manifest.py --root <文件>`，再向封装命令传入 `-GreenSourceManifest <文件>`；封装器会核对受审文件集合和逐文件 SHA-256。

封装脚本在临时目录合并便携包和桌面目录，重新生成并验证 `manifest.json`，然后创建单文件自解压包及相邻的 `.manifest.json`。目标文件存在时构建失败，不覆盖既有候选。

自解压器要求 Windows 自带 `tar.exe`，解压前校验内置 payload 的 SHA-256；目标目录存在且非空时拒绝覆盖。发布仍需单独记录整个 EXE 的 SHA-256，因为内置哈希只用于传输损坏检测，不替代代码签名或外部发布校验。

默认交付方式是双击并选择目录。自动化验收可运行 `spare-mvp-2.0-green.exe --extract-to <父目录> --no-launch`；它仍执行同一 payload 哈希校验和解压逻辑，只省略交互窗口与自动启动。失败时在父目录写入 `spare-mvp-green-extract-error.log` 并返回非零退出码。

## 卸载

运行解压目录根部的 `Uninstall-SpareMvp.exe`。默认卸载保留安装外的业务数据库、结果及迁移备份，只删除本安装程序和实例临时状态。永久删除用户数据需要单独选择及最终二次确认，显示绝对路径和不可恢复提示，默认取消；共享数据仍被其他安装绑定或占用时拒绝永久删除。旧安装目录尚有未证明已迁移的数据且没有绑定时，卸载失败关闭，须先完成迁移。

卸载器调用受管的 `stop-portable.ps1`；服务无法按进程所有权规则安全停止时拒绝删除。随后只关闭可执行路径精确位于当前安装目录的 `SpareMvpDesktop.exe` 进程，再由临时工作副本删除本安装目录。

新旧名称的桌面快捷方式均仅在删除紧前重新读取目标、工作目录、参数、说明和图标，并确认仍精确属于本次安装时删除。如果等待安装目录删除期间快捷方式被用户修改或被另一套绿色版接管，卸载器保留该快捷方式并在完成消息中说明。卸载器不扫描或删除其他目录、其他安装、用户桌面文件或非本包拥有的进程。

启动检查页只显示真实校验、服务启动、工作区加载进度和可操作错误，不显示旧品牌或环境宣传文案。系统数据 JSON 下载名为 `system-data-<页签>-<日期>.json`，项目 JSON 下载名为 `project-<项目ID>-<日期>.json`；兼容用的浏览器存储键和 `spare-mvp-system-data-export-v1` schemaVersion 保持不变。分析结果 Excel 的 Creator 属性为“备件规划及任务可靠度验证评估平台”。

## 验收

正式验收必须在 4700-4 的新目录进行，不能覆盖已有 Docker 版或便携版，也不能复用已修改的 SQLite。至少验证：无管理员弹窗、未调用 Docker/WSL、中文和空格路径、桌面快捷方式目标与工作目录、端口冲突回退、完整性失败阻断、异常启动日志、桌面窗口真实业务流程、停止后的进程和端口清理，以及解压前后 EXE/manifest 哈希留证。卸载验收需要先向独立业务数据根写入可识别的临时记录和结果，确认取消卸载不改变目录、默认卸载保留用户数据、重装仍可发现原数据；另测显式永久删除的二次确认，以及其他安装绑定/占用和相邻路径保护。浏览器/API/静态资源通过不等于完整业务验收。


## 安全交付技术契约（G0）

范围为 [#380](https://github.com/jihegao/spare_mvp/pull/380)、[#381](https://github.com/jihegao/spare_mvp/issues/381)、[#382](https://github.com/jihegao/spare_mvp/issues/382)、[#379](https://github.com/jihegao/spare_mvp/issues/379) 和 [#366](https://github.com/jihegao/spare_mvp/issues/366) 的本轮剩余验收。代码基点为 `33974c58053da36000de05014b7856aa4352699b`，对应 main 基点 `5352a0d7757cbac012c75d516d1a7ac4ff15aa2a`。可开发、提交、推送及准备 PR；完成终点为原生 Windows 隔离验收和待发布交接。不得据此合并、正式发布、切换既有服务或关闭 issue；不操作 4700-3。

### 路径、身份与写入权

- 程序、Electron、Python、应用和离线资源留在安装目录，静态清单不包含业务数据及运行态。
- 生产业务数据默认位于 `%LOCALAPPDATA%\spare_mvp\data`，当前用户的多个安装默认共用；数据库、应保留配置及迁移备份在此生命周期内管理。隔离验收显式指定独立数据根。
- 唯一解析入口为 `scripts/portable-paths.py`：`--package-root` 必填，`--data-root` 可选；数据根选择顺序为显式参数、`SPARE_MVP_DATA_ROOT`、当前安装已绑定的数据根、生产默认值。覆盖路径必须为绝对路径。启动、停止、桌面、备份恢复与诊断消费该入口，不各自推导用户目录。
- 解析结果以 JSON 输出 `package_root`、`installation_id`、`data_root`、`database`、`instance_root`、`state_file`、`pid_root`、`logs_dir`、`evidence_dir`、`diagnostics_dir`、`integrity_cache`、`output_root`、`matplotlib_root`、`startup_lock`、`startup_mutex`、`binding_inventory_mutex`、`data_lock`、`data_mutex`、`binding_file`、`binding_exists`、`binding_matches_selected`、`data_root_source`、`other_bindings`、`conflicting_bindings` 和 `binding_scan_errors`。安装身份由规范化真实安装路径稳定派生；实例状态根位于 `%LOCALAPPDATA%\spare_mvp\instances\<installation_id>`。路径规范化及越界校验只在公共入口实现；全局 binding inventory mutex 将持锁后的最终扫描、迁移和 binding 发布串行化，防止并发创建父子嵌套数据根。
- 当前安装的数据根绑定随实例元数据保留，保证无环境变量的停止及卸载仍定位同一数据。端口、PID、启动锁、日志、验收证据、诊断与校验缓存按安装实例隔离；不得通过另一实例的活动端口文件复用或停止其服务。
- **共享写锁**以规范化业务数据根为键，使用以规范化数据根派生的 `Global\SpareMvpData_<hash>` named mutex；须覆盖初始化、迁移、恢复及后端运行整个写入期。实例局部启动锁只防止本安装重复启动，不替代跨安装写互斥。其他安装占用时失败关闭，不终止对方。
- 用户导出位置由用户选择，永不纳入卸载删除范围。诊断排除凭据和项目正文。

### 迁移、运行与卸载

- 旧安装 `data/` 迁移必须先停止可证明属于旧实例的写入者，取得共享写权，使用 SQLite backup 生成一致副本，验证 `quick_check` 和关键业务表记录一致，成功后才切换绑定。WAL/SHM 不通过复制活跃主库绕过；旧副本保留可恢复。
- 目标已有业务库时禁止覆盖或自动合并。未绑定安装的源库与目标库先经 SQLite backup 比较一致快照：相同快照直接复用且不保留冗余备份；不同快照必须先将源库保存在共享 `migration-backups`，校验并写入摘要/journal。旧安装有使用痕迹时随后返回非零，保持目标库与绑定不变，等待人工解决冲突；洁净新包可在源库备份成功后复用现有共享库。备份失败不绑定。迁移中断不切换绑定；重试不能把半成品当成功库。全新数据库使用仓库既有初始化/fixture 边界，不把运行数据库提交或封入制品。
- 复用运行状态须同时验证后端、Solara 和实例身份。部分服务失效时仅受控停止本实例拥有的残余服务并重启；所有权无法证明时保留记录并报错。
- 解压失败只清理本次创建并拥有的半成品目标及临时 payload；既有安装、已有空目录所有权之外内容和业务数据不得删除。随后可在同一父目录重试。
- 默认卸载只删除本安装程序、实例临时状态及仍归本安装的快捷方式，保留业务数据。永久删除用户数据为独立二次确认，显示绝对路径和不可恢复说明，默认取消；数据仍被其他安装绑定或占用时禁止永久删除。不得停止另一安装或删除其状态、其他用户数据或用户导出。
- #382 已删除“打开诊断目录”按钮、专属 renderer/bridge/IPC 调用链及相关错误引导；现有诊断包生成、日志记录和隐私边界保持不变，未扩建诊断中心。

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

以下仓库内原生候选证据文件仍**待汇总、待验证**；G3 首个失败候选的目标机证据根与身份见下文，Linux 代码门不替代原生证据。只在证据绑定最终候选源码 SHA、包/清单 SHA-256、目标主机、实际路径、运行时版本和执行时间后更新。证据写入 `docs/evidence/desktop-safe-delivery/`；不得保存凭据、用户项目正文或完整运行数据库。

| 证据文件 | 最低内容与关闭条件 |
| --- | --- |
| `candidate.json` | 源码/包/清单身份、文件数和体积、Python/Electron 版本、离线构建来源；不得将未执行测试标 passed。 |
| `data-lifecycle.json` | 新安装、旧库一致迁移、目标冲突、中断重试、重装发现、共享写锁、取消/默认/永久卸载、相邻安装与快捷方式保护；记录前后关键表摘要及 `quick_check`。 |
| `integrity-and-startup.json` | 原生 Windows 首次/后续启动耗时的同环境前后对照；payload/manifest/可执行内容篡改，包括保持大小/mtime；双服务健康、端口冲突、解压失败重试、全离线启动与停止清理。 |
| `issue-366.json` | 1/2/4/5/11 逐页专项、3 默认数据库长名称；9 创建实验点击/请求/数据库/响应/可操作分段前后对照，不套 60 秒指标。 |
| `electron-business.json` | 最终 Electron 包真实业务与五个原有独立入口 F35 50 样本，逐页点击到结果显示 ≤60 秒；同方案/输入指纹，各自成功失败数及资源/超时证据。 |
| `handoff.md` | 各门通过/失败/阻塞、复核人、候选路径/哈希、保留数据及回滚位置、待授权的正式合并与发布步骤。 |

原生验收使用 4700-4 新目录及独立数据根；保留现有 V2 安装、数据库与服务。最终综合验收绑定同一个候选；静态测试、Linux 测试、历史 Edge 数字不能替代该包验收。

本地契约检查入口（执行结果见下文，不能替代 Windows 验收）：

```bash
node --test tests/green-extractor-contract.test.mjs tests/desktop-runtime-contract.test.mjs
python -m unittest tests.test_portable_paths tests.test_portable_package tests.test_portable_runtime_manifest tests.test_desktop_database_initializer -v
npm test
git diff --check
```

Python 使用仓库 Python ≥3.12 的测试环境；原生目标使用包内锁定 Python。Windows 进程所有权检查为 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\test_portable_process.ps1`。原生迁移、卸载及 Electron 交互另按上表执行，不以源码正则契约测试代替。

### G1/G2 本机代码门记录（2026-09-20）

集成分支为 `codex/desktop-safe-delivery`。下表仅记录 Linux checkout 的代码检查和测试，不代表原生运行结果；#366 的本机条件通过由专项验收汇总，不能自动关闭 issue。

| 代码门 | 绑定提交与结果 |
| --- | --- |
| G1 数据生命周期、完整性和发行接线 | `6d6ec205f6eb90cd5fb7df4c4320162077de968d`：上述 4 个 Python unittest 模块 **53/53 通过**；桌面与解压 Node 契约 **2 个文件通过**；`git diff HEAD^ HEAD --check` 通过。Tech lead 给予 Linux 技术签字。 |
| G1 独立故障复现 | 在上述提交独立用 CLI 验证 WAL 已提交行进入一致性备份；旧库冲突备份后非零、目标 SHA 不变；静态确认 PowerShell 非零分支位于写 binding 之前。另验证备份失败阻断、洁净复用、已有备份复用及相同快照不保留冗余备份。更早轮次签字不作为当前最终结论。 |
| G1 来源清单 | `portable-paths.py`、`portable-data.py`、`portable-data-guard.py` 均进入发行 allowlist，真实 staging 测试和 `source_manifest()` 逐文件内容 SHA 校验通过；未据此生成候选包。 |
| G2 / #382 | 作者提交 `cc2819c0354a34c4ff651c30ce2a4a7d791fcbaa` 集成为 `4c9e29b7c169f3b30f2ecedb09a3c77d45d3109e`。删除按钮、专属 renderer/bridge/IPC/样式/错误引导；`exportDiagnostics` 和诊断实现保持不变。桌面契约单独通过，Tech lead 给予代码与 Linux 测试技术签字。 |
| G2 Node 回归 | 在 `4c9e29b` 执行 `npm test`，**38/39 个文件通过**；唯一失败文件 `e2e-contract-flow.test.mjs` 因沙箱 `spawnSync Python EPERM` 未完成。用仓库 `.abm-mesa-test-env/bin/python` 在允许子进程的环境单独复跑，该文件 **3/3 用例通过**。全部 39 个文件有通过证据，但不是单次 `npm test` 全绿。`diff-check` 通过。 |

| #366 条目 | G2 本机专项状态 | 最终候选关闭条件 |
| --- | --- | --- |
| 1 / 2 / 5 / 11 | 本机条件通过；未在最终 Electron 包验收。 | 在同一候选逐页复核交互、实际数据及首末页边界，并保留证据。 |
| 3 默认数据库长名称 | 阻塞：尚缺默认数据库专项验证。 | 使用候选默认数据库确认长名称可见性。 |
| 4 树宽调整 | 有约 4px 裁切风险，待候选确认。 | 在候选实际窗口/缩放下复现；如不符合则修复并复验。 |
| 9 创建实验 | 功能回归通过；分段性能及同案例前后对照未验。 | 分别记录点击、请求处理、数据库、响应和页面可操作耗时；不套用第 13 项 60 秒阈值。 |

**G2 截止时原生 Windows 项目全部未验证**：包含共享 mutex 全运行期与多安装互斥、PowerShell 迁移/恢复/停止、.NET 解压与卸载、相邻绑定保护、离线业务、包体及启动前后数据、最终 Electron 五入口性能和 #366 最终矩阵。之后 G3 的实际尝试及失败记录如下；Linux 通过不得回填为原生通过。

### G3 原生候选失败记录（2026-09-20）

首个候选基于源码 `6a75cd37053b2147a675b65bf43922045fa61448` 在 4700-4 隔离构建并尝试启动，**失败，不可发布**。此记录保留旧候选结论；后续修复只能通过新源码 SHA、新候选及重新验收取得通过，不能覆盖旧记录。

| 身份 | 值 |
| --- | --- |
| EXE | `C:\Users\user\Models\spare_mvp-desktop-g3-build-6a75cd3\output\spare-mvp-2.0-green-6a75cd3.exe` |
| EXE 大小 / SHA-256 | `861864496` bytes / `9114e2fa8f04e8171cef600ef8cacb871e97a59a00cee45bc77d6403f4f941cc` |
| sidecar SHA-256 | `12d55c4b98a5a76dada6232b8e438d19d08897286e3da9dba0d35f3a99d184ce` |
| portable manifest SHA-256 | `6ae3b12419ead44088955a40ed2483e29f56fcf4bc2324eff928f801d4ae88cd` |
| runtime manifest SHA-256 | `085b533b4b0d4db47157f4a01e0c54868a2d17483e0984bbc19c4d8471cdc19b` |
| 原生证据根 | `C:\Users\user\Models\spare_mvp-desktop-g3-evidence-6a75cd3` |

原生阶段 A 已完成候选/sidecar 哈希核对、隔离解压（约 21 秒，18,812 个实际文件）、全量完整性校验（18,810 个不可变文件）、进程归属测试（17 assertions）和快捷方式目标核对；backend 与 Solara 尚未启动，未执行 GUI、重装、卸载、篡改或第二安装测试。

首次数据库迁移失败时，journal 已为 `ready`，目标库与 `.migrating-*` 是同 FileID 的 NTFS 硬链接。原始日志仅保留 traceback 首行，未捕获完整异常；这些现象与源码高度指向 `temporary.unlink()` 的 `PermissionError / WinError 32`，不视为完整异常日志证据。代码审查发现 8 处连接只使用 `with sqlite3.connect(...)` 事务上下文，没有显式关闭连接；事务提交不等于关闭文件句柄。修复须在哈希、发布硬链接及清理之前关闭相关连接，同时保留 ready journal 和目标不覆盖的顺序。

13:27:54 +08:00 的目标机核对结果由隔离验收记录提供：候选包进程为 0，4173/8765 无监听，`active-ports` 不存在；既有 ShipSupportSystem PID 7324 的路径/命令行未变，5001 仍归其所有；相邻测试父目录不存在，候选 EXE/sidecar 哈希未变。这里的“无运行残留”不表示删除诊断文件：失败数据根的 ready journal 及两个同 FileID 硬链接仍保留，供故障分析；按停止指令，证据根中两个自有临时验收脚本也仍保留。未操作 4700-3，未切换既有服务。

作者修复 `f57fa83ec61ea1828351311a57f69026be50e66b` 集成为 `b0b0edb615b80855297d68ef2268766eca65347a`：8 处连接统一显式关闭，写连接保留 commit；关闭后再执行 hash、ready journal、link、unlink，原有 ready-before-link 和不覆盖目标的保护顺序不变。异常分支也显式关闭，相关测试夹具同步修正。

该修复在 Linux 通过联合 Python **54/54**、桌面/解压 Node **2 个文件**及 `diff-check`。Tech lead 独立强持有 **22 个真实 SQLite 连接**，覆盖迁移、既有复用、相同快照、冲突备份及重试、校验异常，断言 link/unlink 时所有连接已显式关闭，且无 `.migrating-*` / `.compare-*` 残留。3 个生命周期脚本的 `source_manifest()` 内容 SHA 校验通过，修复后 `portable-data.py` SHA-256 为 `2fe4739f3d9aaf1867f645b54956ea369d243dd5a1da2fb06e4ad9b32c9faeb4`。

这些 Linux 回归只证明连接生命周期与原有保护回归；必须从包含修复的新源码 SHA 重建新候选，不能替换旧 EXE 后沿用其身份或验收记录。原生新候选仍须重新完成首次启动、迁移/重试、备份完整性、无临时残留及后续综合验收。旧候选 G3 保持失败，新候选原生项目待验。

### G4 修复后候选基础冒烟（2026-09-21）

修复后候选绑定源码 `2252f03ae2ce21e1780638ee9b9e298b6516e174`。Windows 原生构建成功，隔离短路径中校验 18,810 个不可变文件；backend `127.0.0.1:4173`、Solara `127.0.0.1:8765`、前端、API 和工作区均返回 HTTP 200，停止后无候选 PID 或端口残留。

自解压文件为 `spare-mvp-2.0-green-2252f03.exe`，大小 `861873200` bytes，SHA-256 为 `f9465142aefbd84d85e384aaa02e5665c9335b53a21c4ad02f55a0403bd391c5`。该记录证明构建、安装、启动和基础冒烟，不证明 GUI 业务操作、卸载/重装、永久删除保护、第二安装互斥、断网完整业务或五入口性能已通过。

### 后续任务边界

#383 在本轮桌面候选综合门通过后实施：六页使用后端持有的任务，切页或刷新重连同一 `task_id`，不要求退出应用或重启服务续算；独立 RBD 采用 Python 等价迁植和现有 JS 差分验证，不能降级为页面 Worker。保持唯一 Project 编译入口和当前计算/结果口径，不新增一键全部分析。#364 先更新 V2 基线，性能优化不进入本轮发布阻断修复。
