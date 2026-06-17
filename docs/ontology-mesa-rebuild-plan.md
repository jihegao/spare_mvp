# Ontology + Mesa 重构工作计划

来源文档：`docs/3概要设计方案.md`，原始文档：`docs/3概要设计方案.docx`。

## 目标

把概要设计中的“任务、装备、保障、备件、实验、指标”先整理成轻量本体，再映射为可运行的 Mesa ABM。第一阶段不追求完整平台复刻，而是用最小可运行模型证明三件事：

1. 文档中的核心实体和关系能被结构化表达、校验和追踪来源。
2. 本体结构能生成或驱动一个 Mesa 模型骨架。
3. 备件规划和任务可靠度两个核心问题能通过小规模 CSV/JSON 实验证据来解释。

## 技能约束

### ontology-mesa-modeling

- 本体只表达结构，不直接等同于行为规则。
- 优先使用 JSON 本体 IR，实体、属性、关系、基数都要能校验。
- 先做 3-8 个核心实体的轻量本体，再逐步扩展。
- 每条 Mesa 行为规则必须能追溯到本体元素，或者显式标注为建模者新增假设。

### mesa-abm-skill

- 先有可运行批实验，再考虑 SolaraViz 可视化。
- Mesa 模型必须有 `mesa.Model` 子类、`step()`、`snapshot() -> dict` 和可复现实验 seed。
- 输出以 per-step CSV 和 `summary.json` 为主，可视化只用于检查和调试。
- 每次解释必须说明实验问题、参数、seed、步数、主指标、随机波动和局限。

## 文档抽取结果

当前 Markdown 已保留：

- 系统范围、CSCI 体系结构、执行方案、接口设计、功能原理、项目数据组织。
- 6 个表格，包括平台部件组成、内部接口关系、建模数据表关联关系。
- 21 个内嵌图片资源，位于 `docs/assets/3概要设计方案/`。

需要人工复核的转换点：

- 公式在 docx 中没有完全转成可编辑 Markdown 表达式，需要后续从原图或公式对象补录。
- WMF 图形已保留为源文件，但不一定能在所有 Markdown 浏览器中直接显示。

## 第一版领域边界

优先建模两个闭环：

1. 备件规划：任务需求产生装备使用，装备故障产生维修活动和备件需求，库存满足或短缺影响恢复时间，最终输出备件利用率、备件满足率和短板清单。
2. 任务可靠度：任务剖面驱动装备出动，装备不可用、保障延迟和资源短缺影响任务成功，最终输出战备完好率、任务可靠度、出动架次率和波次时间。

暂不做：

- 完整 Web 平台和权限系统。
- 重型 OWL 推理或 RDF/SPARQL 工作流。
- 大样本并行 Monte Carlo 调度平台。
- 只靠动画或截图证明仿真正确性。

## 候选本体

第一版核心实体控制在 8 个：

| 实体 ID | 中文名 | 用途 |
| --- | --- | --- |
| `mission_profile` | 任务剖面 | 长周期任务、多机集群任务、重复周期和结束条件 |
| `basic_mission` | 基本任务 | 成功点、出发时间、返回时间、优先级、最小出动数量 |
| `mission_phase` | 任务阶段 | 任务状态、转移条件、阶段时限 |
| `combat_unit` | 基本作战单元 | 装备类型、数量、部署位置 |
| `equipment` | 装备 | 飞机或其他可执行任务的装备实例 |
| `component` | 产品/组件 | 安装在装备上的部件、故障模型和寿命参数 |
| `support_activity` | 保障活动 | 飞行前保障、维修、预防性维修、再次出动准备 |
| `support_node` | 保障节点 | 机场、保障点、库存位置、调运策略承载点 |

第一版关系来自文档“表 5 关联关系”：

| 源 | 关系 | 目标 | Mesa 映射 |
| --- | --- | --- | --- |
| 基本任务 | 归属于 | 任务剖面 | `basic_mission -> mission_profile` |
| 任务阶段 | 归属于 | 基本任务 | `mission_phase -> basic_mission` |
| 基本作战单元 | 部署在 | 机场 | `combat_unit -> support_node` |
| 装备 | 隶属于 | 基本作战单元 | `equipment -> combat_unit` |
| 装备 | 临时包含在 | 基本任务 | `equipment -> basic_mission` |
| 任务阶段 | 通知退出编队 | 装备 | `mission_phase -> equipment` |
| 产品 | 安装在 | 装备 | `component -> equipment` |
| 装备 | 创建 | 保障活动 | `equipment -> support_activity` |
| 保障活动 | 临时存放在 | 机场 | `support_activity -> support_node` |
| 保障单元 | 通知执行 | 保障活动 | 先归入 `support_node -> support_activity` |
| 保障活动 | 完成基础机维修 | 产品 | `support_activity -> component` |
| 保障活动 | 更新库存、查询延误时间 | 保障点 | `support_activity -> support_node` |
| 保障点 | 查询触发条件 | 调用策略 | 第一版作为 `support_node.policy` 属性 |
| 保障活动 | 改变任务状态 | 装备 | `support_activity -> equipment` |

## Mesa 行为模型 v0

### Agent 和状态

- `EquipmentAgent`：`idle`、`preparing`、`sortie`、`failed`、`repairing`、`ready`。
- `MissionAgent`：管理任务阶段、最低出动数量、成功/失败判定。
- `SupportNodeAgent`：持有库存、维修队列、保障人员和保障设备容量。
- `SupportActivity` 可先作为事件对象，不一定独立成 Agent。

### 时间推进

每个 tick 表示一个固定仿真时间片。第一版按以下顺序执行：

1. 任务阶段触发装备准备和出动需求。
2. 装备按故障概率或寿命阈值进入故障状态。
3. 故障装备创建维修保障活动。
4. 保障节点检查人员、设备、备件库存。
5. 库存满足则维修推进，库存不足则记录短缺和等待时间。
6. 更新装备状态、任务状态和指标快照。

### 指标

`snapshot()` 至少输出：

- `ready_rate`：可用装备数 / 装备总数。
- `mission_success_rate`：成功任务数 / 已结束任务数。
- `sortie_rate`：累计成功出动架次 / 计划出动架次。
- `spare_fill_rate`：备件满足次数 / 备件需求次数。
- `spare_utilization`：消耗备件数量 / 初始备件数量。
- `shortage_events`：备件不足事件数。
- `repair_backlog`：待维修队列长度。
- `mean_launch_time`、`mean_recovery_time`、`mean_turnaround_time`。

## 目录建议

```text
docs/
  3概要设计方案.docx
  3概要设计方案.md
  ontology-mesa-rebuild-plan.md
  assets/3概要设计方案/
ontology/
  spare_mvp.ontology.json
  spare_mvp.normalized.json
  spare_mvp.validation.json
scenarios/
  spare-planning-smoke/
    scenario.md
    experiment.json
  mission-reliability-smoke/
    scenario.md
    experiment.json
src/
  spare_mvp_abm/
    __init__.py
    model.py
    ontology_loader.py
tests/
  test_ontology_contract.py
  test_model_smoke.py
  test_reproducibility.py
runs/
  .gitkeep
```

`runs/` 后续应默认忽略大体量实验输出，只提交小型示例或摘要。

## 里程碑

### M0 文档基线

交付：

- `docs/3概要设计方案.md`
- `docs/assets/3概要设计方案/`
- 本计划文档

验收：

- Markdown 能读到核心章节、表格和图片链接。
- 工作区只新增文档与图片资源，不引入运行代码。

### M1 本体 IR

交付：

- `ontology/spare_mvp.ontology.json`
- `ontology/spare_mvp.normalized.json`
- `ontology/spare_mvp.validation.json`

验收：

- 实体 ID、关系 ID 唯一。
- 关系端点全部引用已定义实体。
- 每个核心实体至少有一个标识属性。
- 表 5 的关系都能追踪到本体关系或明确降级为属性/策略。

推荐命令：

```bash
python3 /Users/gaojihe/.codex/skills/ontology-mesa-modeling/scripts/normalize_ontology.py \
  --input ontology/spare_mvp.ontology.json \
  --output ontology/spare_mvp.normalized.json \
  --report ontology/spare_mvp.validation.json
```

### M2 结构烟测模型

交付：

- 一个由本体生成或手写的最小 Mesa 结构模型。
- 小步数、单 seed 的结构运行结果。

验收：

- 模型能创建实体代理和关系索引。
- `snapshot()` 能输出实体数量、关系数量、活动数量等结构指标。
- 运行输出 `run_000.csv` 和 `summary.json`。

### M3 备件规划 v0

交付：

- 替换通用激活规则，加入库存消耗、短缺等待、维修恢复。
- `spare-planning-smoke` 场景包。

验收：

- 至少有一个确定性 smoke：固定 seed、固定库存，结果可复现。
- 至少有一个小 sweep：改变初始备件数量或故障率。
- 输出能解释备件满足率、利用率、短缺事件和维修积压。

### M4 任务可靠度 v0

交付：

- 加入任务阶段、最低出动数量、任务成功/失败判定。
- `mission-reliability-smoke` 场景包。

验收：

- 至少有一个确定性 smoke。
- 至少有一个小 sweep：改变保障容量、故障率或最低出动数量。
- 输出能解释战备完好率、任务可靠度、出动架次率和波次时间。

### M5 证据与解释

交付：

- `runs/<scenario>/<timestamp>/run_*.csv`
- `runs/<scenario>/<timestamp>/summary.json`
- 简短实验解释 Markdown。

验收：

- 每个解释都说明实验问题、参数、seed、步数、主指标和局限。
- 不从小样本 sweep 直接声称“最优方案”，只说“在该模型和参数下表现更好/更差”。

### M6 可视化检查

交付：

- 可选 SolaraViz 入口。

验收：

- 只在批实验通过后添加。
- 可视化用于检查状态流转，不作为唯一证据。

## 下一步建议

下一步直接做 M1：从 `docs/3概要设计方案.md` 手工整理 `ontology/spare_mvp.ontology.json`，再调用 `normalize_ontology.py` 生成规范化文件和校验报告。M1 完成后再进入 Mesa 结构烟测，避免先写仿真代码导致实体和关系口径漂移。
