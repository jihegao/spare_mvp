# 轻量 Mesa 实验层设计讨论稿

**日期**：2026-07-03
**状态**：讨论稿，已按“前端建模 + Mesa 分析”产品定位更新；2026-07-04 收敛为蒙特卡洛实验直达 Mesa 页面，并将四个结果分析页同步改为独立 Mesa 会话页面。
**主题**：形成按项目启动、读取前端建模数据、从蒙特卡洛实验和四个结果分析入口直达的 Mesa 分析页面，优先服务 Monte Carlo 设置、主要指标统计和会话内分析摘要。

## 背景

当前产品主线已经形成正式运行链路：

```text
RunIntent -> /api/runs -> RunService -> SimulationAdapter -> aircraft_support_v1 -> SQLite + artifacts
```

这条链路承担运行身份、状态机、结果账本、artifact manifest、projection payload、current result 和权限审计等职责。新定位下，面向建模人员的主线体验调整为“前端建模 + Mesa 分析”：用户在前端完成建模后，直接进入 Mesa 分析页面配置实验并查看统计结果。

本讨论稿提出一个独立的 Mesa 分析层。它按项目进行：用户先在项目中录入建模数据，再从项目启动仿真分析。分析层读取该项目当前建模数据，运行 Mesa 模型并返回即时摘要。页面结果按产品能力呈现。

## 目标

1. 建立“前端建模 + Mesa 分析”的蒙特卡洛实验直达入口，移除实验列表、添加/编辑页和独立 Mesa 分析导航链路。
2. 从项目启动仿真分析；分析层读取项目当前建模数据，不修改项目、不发布快照、不创建 run。
3. 支持建模从粗到细、从简单到复杂逐步进入仿真：数据粒度不足时给出可运行范围和缺口，而不是伪造完整分析。
4. 独立运行 `aircraft_support_v1` Mesa 核心或后续等价模型核心。
5. 支持单次实验和最小携行清单搜索，用于探索在给定置信度水平下满足任务要求的各类备件数量。
6. 页面直接展示当前会话的分析结果；后续是否持久化由产品结果账本另行设计。
7. 保留 fail-closed 校验，非法项目数据不能伪造实验结果。
8. 四个结果分析页（备件短板、飞机转场携行清单、任务可靠度、停机因素）与蒙特卡洛实验详情一样走独立 Mesa 会话页面；它们不读取 current result，不触发 `/api/runs`，不解锁正式 projection KPI。

## 非目标

1. 不接入 `/api/runs`。
2. 不写 SQLite。
3. 不创建 `Run`、`Result`、`ArtifactManifest`、`AnalysisTask` 或 `MonteCarloExperiment`。
4. 不生成正式 `monte_carlo_base`、`analysis_projection_*` 或 `visualization_state_series` artifact。
5. 不接入前端 current result，也不解锁正式 KPI、表格或图形。
6. 不恢复已删除的 `independent-mesa/GLM`、`independent-mesa/GPT` 或旁路服务。
7. 不把小样本实验解释为工程级校准结论。
8. 不把四个结果分析页的会话内 Mesa 输出写成 `completed` current result，也不生成 `analysis_projection_*` artifact。

## 核心边界

### 读取边界

轻量实验层的主输入是“项目当前建模数据”。项目数据可以来自：

- 前端/后端当前 Project draft 的只读快照。
- 已导出的 `project-v0` Project JSON。
- 已发布或草稿态 `modeling-import-v1` 包，经 `modeling_import_to_project()` 转成 Project。

`tests/fixtures/simulation_analysis_cases/*.json` 只作为测试和验收样例，不是用户真实实验入口。真实实验应从某个项目启动，fixture 只用来证明轻量层在已知项目数据上可复现。

读取时允许复用当前校验和编译函数：

- `validate_modeling_import_package()`
- `modeling_import_to_project()`
- `SimulationAdapter.compile_scenario(..., model_family="aircraft_support_v1")`

但轻量层只消费编译后的 `scenario["simulation_inputs"]`。不得继续调用 `run_scenario()` 或 `run_monte_carlo_scenario()`，因为这些函数会写正式 artifact。

### 建模粒度边界

轻量实验必须显式记录当前项目的建模粒度。建模可以从粗到细逐步完善，实验能力随数据粒度解锁：

| 粒度 | 项目建模数据 | 允许的轻量实验 | 结果边界 |
| --- | --- | --- | --- |
| 粗粒度 | 基本任务、装备数量、初始可用、基础备件类别 | 单次 baseline、粗略短缺检查 | 只能判断当前简化模型下是否明显不足。 |
| 中粒度 | 保障节点、库存、保障活动、运输策略 | 最小携行清单搜索、保障瓶颈解释 | 可以探索各备件类别独立数量，但置信度只代表当前样本和规则。 |
| 细粒度 | 组件故障分布、寿命、RBD、作业 DAG、任务周期 | 更稳定的最小携行组合、风险项解释 | 可以比较候选清单和约束余量，但仍不是工程校准结论。 |

如果项目缺少某个实验所需字段，轻量层应返回“当前项目建模粒度不足”的结构化错误，说明缺失字段和需要回到哪个建模页面补数据。

### 运行边界

运行只实例化模型核心：

```python
model = AircraftSupportV1Model(inputs)
result = model.run()
```

`result` 只在内存中使用，结构可以包含：

- `metrics`
- `frames`
- `events`

轻量层的主变量实验不是全局 `failureRates`、`spareMultipliers` 或 `supportCapacities` sweep，而是最小携行清单搜索。搜索通过复制 `inputs`、只按机场绑定基层保障点的“保障点 × 备件类别”独立修改库存数量、切换 seed、重复调用模型核心完成；上级库和其他保障点库存保持 Project 原值，只作为调运资源参与仿真。聚合结果只保留在内存中。

当前四个结果分析页的实现入口是 `POST /api/mesa-analysis-runs`。请求携带当前 Project、`analysis_type`、页面会话设置和 `model_family=aircraft_support_v1`；后端通过 `SimulationAdapter.compile_scenario_with_gate(..., model_family="aircraft_support_v1")` 编译后，只消费 `scenario["simulation_inputs"]` 并直接运行 `AircraftSupportV1Model`。前端不得调用 `runMonteCarlo()`、`runSimulation()`、`singleResult` 或 preview fixture 兜底；后端不可用或编译失败时只能返回/展示 `blocked`。

### 输出边界

默认输出方式：

- CLI 打印摘要 JSON。
- Python API 返回 dict。
- HTTP API 返回会话内 dict，例如 `source=lite_mesa_aircraft_support_v1`、`status=session_complete`、`sample_count`、`seed_list`、页面 `metrics` 与 `rows`。
- 测试中断言关键指标。

默认禁止：

- 写 `runs/`。
- 写 `outputs/`。
- 写 SQLite。
- 写 artifact manifest。
- 写样本明细文件。
- 通过 `/api/runs`、`RunService.run_scenario()` 或 `RunService.run_monte_carlo_scenario()` 生成正式结果。
- 生成或复用正式 `analysis_projection_*` artifact 作为四页当前主流程输出。

可选调试模式可以设计为 `--debug-dump /tmp/...`，但必须显式开启，且不能作为产品结果来源。

## 建议目录

```text
src/spare_mvp_mesa_experiments/
  __init__.py
  project_loader.py
  compiler.py
  runner.py
  carry_list_search.py
  analyses.py
  catalog.py

scripts/run-mesa-experiment-lite.py

tests/test_mesa_experiments_lite.py
```

职责划分：

| 文件 | 职责 |
| --- | --- |
| `project_loader.py` | 读取 modeling-import case 或 project JSON，返回规范化 Project。 |
| `compiler.py` | Project -> `aircraft_support_v1` simulation inputs；封装 fail-closed 错误。 |
| `runner.py` | 单次运行和携行清单候选解的内存执行。 |
| `carry_list_search.py` | 在给定置信度目标下搜索各备件类别的最小携行数量。 |
| `analyses.py` | 轻量分析投影纯函数，不依赖 artifact id。 |
| `catalog.py` | 内置实验定义、备件类别和候选数量范围。 |
| `scripts/run-mesa-experiment-lite.py` | 面向人和 agent 的 CLI。 |

## 项目内轻量仿真分析定义

以下不是固定产品菜单，也不是脱离项目的样例库；它们是项目启动仿真分析时可选择的轻量实验类型。每个实验都以当前项目建模数据为输入，并报告所使用的建模粒度。

### `project_baseline_at_current_granularity`

输入：当前项目建模数据。

用途：

- 验证当前项目在已有建模粒度下能否编译并运行 Mesa 核心。
- 作为后续最小携行清单搜索的基线。
- 固定 seed 后输出稳定。

输出摘要：

- mission success rate
- ready rate
- spare consumed total
- shortage events
- completed / cancelled sorties

测试样例：

- `tests/fixtures/simulation_analysis_cases/minimal_single_aircraft.json`
- `tests/fixtures/simulation_analysis_cases/canonical_platform_case.json`


### `minimum_carry_list_search`

输入：当前项目建模数据，至少需要备件类别、任务要求、机场绑定的基层保障点、各保障点库存、调运关系、基础故障/保障规则。

用途：

- 探索在一定置信度水平下满足任务要求的基层级最小备件携行清单。
- 只优化机场绑定的基层保障点库存；上级库、侧向保障点和其他保障点库存保持 Project 原值，只通过调运规则参与仿真。
- 每个“基层保障点 × 备件类别”的数量都是独立决策变量，不使用全局备件倍率替代。
- 输出各基层保障点、各备件类别的建议数量、相对 Project 基准的补充/削减量、通过率、约束余量和仍然不确定的风险项。

决策变量：

```json
{
  "spareQuantities": {
    "carrier_deck": {
      "发动机备件": [0, 1, 2, 3, 4],
      "航电模块": [0, 1, 2, 3, 4],
      "液压备件": [0, 1, 2, 3, 4]
    }
  }
}
```

第一层 key 是机场绑定的基层保障点 id；第二层 key 是该基层保障点可携行或可消耗的备件类别。基层保障点来自项目建模数据中的机场绑定关系和保障点层级标识；如果项目无法明确识别机场绑定基层保障点，搜索必须 fail closed，要求回到保障节点建模补齐绑定关系或由用户显式选择。

备件类别来自项目建模数据，例如：

- `components[].spareType`
- `supportNodes[].inventory` 的备件 key
- `supportActivities[].jobs[].spare[].name`
- 后续显式维护的携行清单类别字典

Project 当前配置库存是搜索基准 `q0`。搜索允许围绕 `q0` 补缺和削减：

- 如果 `q0` 不满足置信度目标，逐步补充基层级库存，寻找满足解。
- 如果 `q0` 已满足置信度目标，逐步削减基层级库存，直到再减就不满足。
- 上级库、侧向保障点、其他机场保障点和运输策略在每个候选中保持 Project 原值，作为可调运资源和网络约束参与仿真。

搜索目标：

```text
minimize sum(q[base_support_node_id][spare_type])
subject to confidence(success_predicate(samples)) >= confidence_target
```

默认成功判定：

```text
mission_success_rate >= basicMission.successPoint
sortie_completion_rate 覆盖 basicMission.minRequiredSorties / equipment.minRequiredSorties
cancelled_sorties == 0 或 cancelled_sorties_rate <= configured_tolerance
```

默认置信度：

```text
confidence_target = 0.9
```

搜索策略分两层：

1. 小保障点数、小类别数或小上界时，使用围绕 `q0` 的全组合网格搜索，返回满足约束的 Pareto frontier 和总量最小解。
2. 类别数较多时，先评估 `q0`，再做双向贪心搜索：不满足时每轮补充对通过率提升最大的“基层保障点 × 备件类别”，满足后再逐项回退，剔除冗余数量。

关键约束：

- 不允许把所有备件乘以同一个倍率作为结果。
- 不允许优化上级库、侧向保障点或其他保障点库存；这些库存只能作为调运资源影响基层级候选的仿真结果。
- 不允许只做单因素敏感性后人工读数。
- 不允许把未测试的类别数量推断为满足置信度。
- 每个候选向量必须运行固定 seed 集或显式 seed 规则，才能比较。
- 结果必须报告相对 Project 基准的变化量：补充、削减或保持。

关注：

- 哪些基层保障点和备件类别是真正约束项。
- 满足 0.9 / 0.95 等置信度时，最小数量组合是否稳定。
- 哪些类别存在替代或耦合效应。
- 结果只表示当前模型和样本下的估计，不代表真实工程保证。

### `carry_list_probe`

输入：当前项目建模数据，以及 `minimum_carry_list_search` 产生的候选清单和样本摘要。

用途：

- 作为 `minimum_carry_list_search` 的解释层。
- 不生成正式报告。
- 不创建 analysis task。

关注：

- 每个基层保障点、每一类备件的边际贡献。
- 最小满足解附近的风险项。
- 支撑目标置信度的备选清单。
- 建模假设和不确定性说明。

## 轻量分析函数

`analyses.py` 只提供纯函数：

```python
def spare_shortfall(samples: list[dict]) -> dict: ...
def carry_list(samples: list[dict], *, confidence_target: float = 0.9) -> dict: ...
def carry_list_search(candidates: list[dict], *, confidence_target: float = 0.9) -> dict: ...
def mission_reliability(samples: list[dict]) -> dict: ...
def downtime_factors(samples: list[dict]) -> dict: ...
```

这些函数不得依赖：

- `run_id`
- `artifact_id`
- `artifact_manifest_id`
- `base_artifact_id`
- 前端 current result 状态

返回值只描述当前内存样本支持的轻量结论，并必须包含：

- experiment name
- varied parameters
- sample count
- seed list
- primary metrics
- limitations

## CLI 草案

```bash
.abm-mesa-test-env/bin/python scripts/run-mesa-experiment-lite.py \
  --project-json path/to/project.json \
  --experiment minimum_carry_list_search \
  --confidence 0.9 \
  --format json
```

可选参数：

```text
--project-json /path/to/project.json
--modeling-import-json /path/to/modeling-import.json
--experiment <catalog experiment id>
--seed 20260621
--samples 9
--confidence 0.9
--max-spare-quantity 4
--format json|table
--debug-dump /tmp/spare-mvp-lite-run
```

默认行为：

- 不写任何输出文件。
- 只打印摘要。
- 遇到编译错误直接返回非零退出码。

前端应从项目页或仿真分析入口启动，并把当前 Project draft 作为输入传入 Mesa 分析层。当前页面先展示会话内结果，暂不创建 run 或 result 账本。

## 验收标准

1. 当前项目建模数据能在内存中完成 `project_baseline_at_current_granularity`。
2. 6P 两个 fixture 作为项目数据样例，均能通过项目入口语义完成 baseline。
3. `minimum_carry_list_search` 能返回按“机场绑定基层保障点 × 备件类别”独立变化的总量最小满足解，并报告相对 Project 基准的补充/削减量。
4. 同一 seed 的核心指标稳定。
5. 非法 Project、非法 modeling-import 或建模粒度不足时 fail closed，并指出缺失字段。
6. 当前页面运行后 `runs/`、`outputs/`、SQLite 数据库和 artifact manifest 不发生新增写入。
7. 文档和页面明确产品定位为“前端建模 + Mesa 分析”，页面结果按 Mesa 分析能力呈现。

## 测试建议

最小测试集：

1. loader 读取 Project JSON，并能读取两个 6P case 作为项目数据样例。
2. compiler 输出 `aircraft-support-v1-input-v0`。
3. single runner 返回 metrics，且不写文件。
4. 最小携行清单搜索能够只改变基层保障点的各类备件数量，保持上级/其他保障点库存不参与优化，并返回满足置信度的总量最小解。
5. 建模粒度不足或 invalid support activity predecessor 返回结构化错误。
6. monkeypatch 文件写入路径，确认默认运行不调用 artifact writer。

建议命令：

```bash
PYTHONDONTWRITEBYTECODE=1 .abm-mesa-test-env/bin/python -m unittest tests.test_mesa_experiments_lite -v
```

## 需要进一步讨论的问题

1. 项目启动入口先使用导出的 Project JSON，还是允许只读读取当前本地后端 Project draft？
2. 轻量实验是否只保留 CLI，还是也提供 Python API 给 notebook / agent 调用？
3. 是否允许显式 `--debug-dump`，还是严格禁止任何结果落盘？
4. 置信度默认值先采用 0.9，还是在 CLI 必填？
5. 后续是否引入重量、体积、成本等加权成本；第一版目标函数已固定为基层级携行总量最小。
6. 每类备件数量围绕 Project 基准补缺/削减时，搜索上界来自项目建模中的库存/携行候选范围、用户输入，还是按缺省 `0..4` 起步？
7. 粗/中/细三档建模粒度是否足够，还是需要与现有 `level0` / `level1` validationLevel 直接绑定？
8. `analyses.py` 是从当前 adapter 中抽纯函数，还是先实现一套更粗的轻量摘要？
9. 内置实验类型先只做 project baseline + `minimum_carry_list_search`，还是保留其他敏感性实验为 future？
10. 是否把 `SimulationAdapter.compile_scenario()` 继续作为编译入口，还是抽出不带产品语义的 compiler helper？
11. 后续是否需要把当前会话结果升级为可保存的 Mesa 分析结果账本？

## 推荐落地顺序

1. 讨论并确认“项目启动、只读项目建模数据、不保存结果”的边界。
2. 新增轻量包骨架和只读 Project loader。
3. 新增建模粒度检查，返回当前项目可运行的实验类型和缺失字段。
4. 新增 compiler helper，只返回 `simulation_inputs`。
5. 新增 project baseline runner。
6. 新增最小携行清单搜索 runner。
7. 新增轻量分析函数。
8. 新增 CLI。
9. 补测试并验证不落盘。
