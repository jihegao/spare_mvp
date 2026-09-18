# Issue 366: opening a new experiment plan

Measured 2026-09-18 on the same local Node.js 22 runtime and F35 Project, five fresh app instances per revision. The existing `frontend-app-runtime` harness dispatches the actual add-button click and waits for its asynchronous tasks; the editor HTML must contain the save action after each sample. Backend responses and DOM are simulated by that harness, so these numbers do not measure browser painting, network latency, or saving a plan.

The local SQLite database was opened with `mode=ro`. Its Project payload passed through `ProjectJsonExporter` and was transferred in memory; no private Project data is included in this evidence. Temporary wrappers timed the real clone/default/preview/render functions. Input identity was normalized to the harness project ID only.

| Measurement (ms) | Before median | After median |
|---|---:|---:|
| totalMs | 43.967 | 9.324 |
| cloneScenario | 4.412 | 4.183 |
| ensureMonteCarloSweepDefaults | 0.164 | 0.162 |
| ensureExperimentPlanDraftDefaults | 0.214 | 0.203 |
| updatePreviewResultsThroughApiClient | 34.083 | 0.000 |
| render | 0.488 | 0.388 |

| Sample | Before click (ms) | After click (ms) |
|---|---:|---:|
| 1 | 68.609 | 11.683 |
| 2 | 44.927 | 9.475 |
| 3 | 43.477 | 9.324 |
| 4 | 43.446 | 9.049 |
| 5 | 43.967 | 9.201 |

Opening the branch used to calculate both legacy preview simulations synchronously even though the configuration editor does not display their results. The change removes that call from branch creation, preserving copying/default initialization and the existing save, snapshot, plan creation, and preflight API chain. Other explicit preview/analysis paths are unchanged.

This confirms a local avoidable CPU cost; it does not reproduce or resolve an unmeasured seconds-long delay in a deployed browser. No 60-second acceptance threshold applies to this work item. Existing runtime tests cover editing and saving the isolated draft; the added boundary regression rejects implicit simulation during branch creation.

## 真实浏览器完整创建链路复测

随后在本机 F35 案例上定位保存链路：预检对同一实验分支重复调用 `ProjectJsonExporter`。现仅在输入确为同一计划分支且项目身份未被补写时，复用同一次已验证导出；仍由 `SimulationAdapter` 编译，缺少分支或身份需修正时保留原路径，复用结果深拷贝隔离。

环境：Linux 6.8、AMD Ryzen Threadripper PRO 3995WX、Python 3.12.13、Mesa 3.5.1、Solara 1.57.5、jsonschema 4.26.0、NumPy 2.4.6、Chromium，源 SQLite 只读备份到独立临时库。主分支 `0a3dd80` 与候选集成 `3d8124c281ea242bde6606e09a7f7ec0b66896e9` 各用相同初始备份，串行各执行五次真实浏览器“新增→保存→API预检→列表显示”，测试期间不运行本任务其他测试或仿真。候选包含本 PR 代码 `f44fe17` 及其他已评审界面改动；不是目标 Windows 主机性能证明。

| 阶段 | 基线中位数 | 候选中位数 | 基线范围 | 候选范围 |
| --- | ---: | ---: | ---: | ---: |
| 新增至编辑器显示 | 86.47 ms | 31.80 ms | 72.91–174.54 ms | 27.90–61.18 ms |
| 保存至方案列表显示 | 2987.19 ms | 2509.80 ms | 2947.15–3557.24 ms | 2504.29–2645.55 ms |
| 完整链路 | 3094.24 ms | 2539.69 ms | 3043.67–3630.16 ms | 2538.03–2706.73 ms |
| 编译预检 HTTP 请求 | 1585.12 ms | 923.83 ms | — | — |

完整链路中位数降低约 17.9%。两组各五次创建均返回 HTTP 200，列表重新加载成功，临时数据库方案数均增加五条。原始案例、私有运行库及详细请求内容未提交。第 9 项没有秒数门槛；本记录证明本机同案例改善与落库正确，不将第 13 项的 60 秒门槛套用到创建。

独立评审及七项增量回归覆盖冻结分支与快照/实时项目不同、无分支回退、缺项目 ID、非法导出/编译阻断、跨项目拒绝、深拷贝隔离。Exporter、Project contract、Adapter、canonical input fixtures 共 136 项通过。

此前误用系统 Python 3.10 的诊断计时已被上述锁定环境复测取代，不作为最终性能结论。
