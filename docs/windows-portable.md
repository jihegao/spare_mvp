# Windows 交付

提供浏览器兼容、静态文件类型、健康检查、自动端口选择和启动诊断。
本次只提交代码，不包含新增业务案例数据。Python runtime、SQLite、账号会话和运行产物保留在本地。

## 打包

在仓库根目录的 PowerShell 执行，指定已安装 pyproject.toml 依赖的 Windows Python runtime：

```powershell
./scripts/build-portable.ps1 -RuntimeSource 'D:\runtime' -Destination './dist/SPARE'
./dist/SPARE/scripts/test-port-selection.ps1
./dist/SPARE/scripts/verify-portable-package.ps1 -PackageRoot './dist/SPARE'
```

目标目录必须不存在。默认从仓库已有最小模板、大型模板初始化数据库。
可用 `-ProjectFile 'D:\private\project.json' -ExperimentConfig 'D:\private\experiment.json'` 加载本地案例与实验设置。
初始化通过 BackendApi / ContractRepository 保存项目并创建、冻结实验；不迁移历史账号、会话或旧快照。
新增案例文件无需放入仓库或上传 GitHub。Project 应先通过现有 ProjectJsonExporter 规范化；实验设置单独保存。

构建后双击包内 `Start-Platform.vbs` 或 `Start-Platform.cmd`，结束时运行 `Stop-Platform.cmd`。
日志位于 `data/logs`，实际地址位于 `data/active-ports.json`。登录使用仓库既有初始化逻辑。
运行环境来自指定目录，脚本不联网安装依赖。完整业务验收仍需本地案例加载、分析与 Excel 导出。
