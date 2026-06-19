# spare_mvp 可靠性分配功能设计方案

## 1. 背景与目标

`spare_mvp` 当前已经具备任务建模、任务剖面建模、装备组成建模、装备故障建模、装备可靠性框图、蒙特卡洛实验和结果分析等原型能力。现有原型中，装备故障建模页面已经维护失效率、MTBF、寿命限制以及 RMS 指标字段，包括可靠度、维修度、保障性、MTTR、MLDT 和固有可用度；可靠性框图页面也已经表达串联、并联和备用关系。

本设计目标是在现有原型基础上实现一个可靠性分配功能，使系统能够将装备级 RMS 指标按照装备组成关系、可靠性逻辑结构和任务剖面信息，分解为系统级、分系统级和 LRU 级 RMS 指标，并将分配结果写回装备模型，供后续仿真验证、蒙特卡洛评估和备件保障分析使用。

目标闭环如下：

```text
装备级 RMS 指标输入
  -> 装备组成树 / 可靠性框图 / 任务剖面编译
  -> 系统级与 LRU 级指标分配
  -> 自底向上校核
  -> 人工调整与版本管理
  -> 发布到装备模型
  -> 仿真验证与结果回流
```

该功能不应只生成一张静态表，而应成为可解释、可复算、可校核、可追溯、可进入仿真验证的 RMS 指标分配闭环。

---

## 2. 当前基础与缺口

### 2.1 已具备能力

当前仓库已有以下基础：

1. 装备组成建模页面：维护装备组成树、组件名称、父节点、备件类型、连接类型等字段。
2. 装备故障建模页面：维护数量、n 中取 k、故障模型、失效率、MTBF、寿命限制和 RMS 指标。
3. 可靠性框图页面：展示整机、组件及串联、并联、备用等可靠性关系。
4. 任务剖面建模页面：维护复合任务、周期任务、任务波次、任务时间、重复周期等信息。
5. 蒙特卡洛实验与结果分析页面：已有仿真运行、结果展示和指标分析的原型结构。

### 2.2 主要缺口

当前原型距离真实可靠性分配功能仍有以下缺口：

1. “结果导入”页面仍是静态表格，没有实际分配算法。
2. 装备组成、可靠性框图和任务剖面尚未形成统一计算模型。
3. 组件 RMS 字段缺少 target、prediction、actual 的区分。
4. 可靠性框图和组件表重复保存失效率、MTBF，存在数据不一致风险。
5. 任务剖面没有编译为各系统、LRU 的任务使用暴露时间。
6. 仿真引擎当前主要用 `failureRate` 作为每步故障概率，尚未真正使用 MTBF、MTTR、MLDT 等 RMS 指标。
7. 缺少方案版本、输入快照、算法版本、校核结果和发布记录。

---

## 3. 功能定位

### 3.1 功能名称

建议命名为：

```text
RMS 指标分配方案管理
```

或在页面中使用更直观名称：

```text
可靠性分配 / RMS 分配
```

### 3.2 所属模块

建议放在：

```text
系统管理
  -> 装备RMS指标分配

```


### 3.3 主要用户

1. 可靠性工程师：输入装备级 RMS 指标，选择分配方法，校核分配结果。
2. 总体设计人员：查看系统级指标约束与薄弱环节。
3. 保障性分析人员：查看 LRU 级 MTTR、MLDT、保障需求权重和备件保障压力。
4. 仿真分析人员：将分配结果发布到仿真场景并验证任务可靠度。

---

## 4. RMS 指标口径

### 4.1 可靠性 R

可靠性表示装备、系统或 LRU 在规定任务时间内完成规定功能的概率。

输入形式可以支持：

```text
R(T) >= 0.95
```

或：

```text
MTBF >= 500 h
```

内部统一转换为累计风险预算：

```text
H(T) = -ln R(T)
```

指数失效模型下：

```text
R(t) = exp(-lambda * t)
MTBF = 1 / lambda
```

其中：

- `R(t)`：任务时间 t 内可靠度；
- `lambda`：失效率；
- `MTBF`：平均无故障工作时间。

### 4.2 维修性 M

维修性表示装备或 LRU 在规定维修时间内修复成功的概率：

```text
M(t_m) = P(T_repair <= t_m)
```

指数维修时间模型下：

```text
M(t_m) = 1 - exp(-t_m / MTTR)
```

系统应支持两种输入：

```text
M(2h) >= 0.90
```

或：

```text
MTTR <= 1.5h
```

### 4.3 保障性 S

保障性表示在规定保障延迟时间内完成保障响应、备件供应或维修支援的概率：

```text
S(t_s) = P(T_logistics_delay <= t_s)
```

可由 MLDT 或保障延迟分布表达：

```text
MLDT = Mean Logistics Delay Time
```

保障性分配不能只依赖装备结构，还需要库存、补给周期、保障层级、保障资源容量和运输时间等信息。因此在 MVP 中，保障性分配可先作为设计目标，最终通过备件保障仿真和蒙特卡洛实验验证。

### 4.4 可用度 A

固有可用度建议作为派生指标，不单独分配：

```text
Ai = MTBF / (MTBF + MTTR)
```

如果考虑保障延迟，应使用作战可用度或使用可用度：

```text
Ao ≈ MTBF / (MTBF + MTTR + MLDT + other_delay)
```

因此系统中应区分：

1. `inherentAvailability`：固有可用度，只由 MTBF 和 MTTR 推导。
2. `operationalAvailability`：使用/作战可用度，可考虑 MLDT、资源等待、备件短缺等延迟。

---

## 5. 数据模型设计

### 5.1 EquipmentNode

装备节点是 RMS 分配的基本对象，覆盖装备、系统、分系统、设备和 LRU。

```json
{
  "id": "avionics-computer-1",
  "name": "任务计算机",
  "level": "LRU",
  "parentId": "avionics-system",
  "quantity": 2,
  "spareType": "任务计算机LRU",
  "failureModel": {
    "distribution": "exponential",
    "baselineMtbfHours": 1200
  },
  "repairModel": {
    "distribution": "lognormal",
    "baselineMttrHours": 1.5
  },
  "rms": {
    "target": {},
    "prediction": {},
    "actual": {}
  }
}
```

建议支持以下层级：

```text
装备
  -> 系统
      -> 分系统 / 设备
          -> LRU
```

### 5.2 RMS target / prediction / actual

RMS 指标必须区分三类数据：

```json
{
  "rms": {
    "target": {
      "reliability": 0.985,
      "mtbfHours": 985.4,
      "mttrHours": 1.4,
      "mldtHours": 2.1,
      "allocationPlanId": "RMS-PLAN-001",
      "allocationPlanVersion": 3
    },
    "prediction": {
      "mtbfHours": 820,
      "mttrHours": 1.8
    },
    "actual": {
      "mtbfHours": 790,
      "source": "field-data"
    }
  }
}
```

含义：

1. `target`：分配得到的设计目标。
2. `prediction`：当前设计预测或供应商预计值。
3. `actual`：试验、使用或历史数据。

发布分配方案时只能写入 `target`，不能覆盖 `prediction` 和 `actual`。

### 5.3 ReliabilityGroup

可靠性逻辑组用于表达兄弟节点之间的可靠性结构。

```json
{
  "id": "avionics-redundancy-group",
  "parentNodeId": "avionics-system",
  "type": "k_of_n",
  "children": [
    "avionics-computer-1",
    "avionics-computer-2"
  ],
  "k": 1,
  "n": 2,
  "coverageProbability": 1.0
}
```

支持类型：

```text
series
parallel
k_of_n
active_standby
warm_standby
cold_standby
```

不建议继续把 `connectionType` 仅挂在组件自身，因为串联、并联、备用关系描述的是多个子节点之间的组合逻辑。

### 5.4 MissionExposure

任务剖面需要编译为节点级任务暴露矩阵。

```json
{
  "nodeId": "avionics-system",
  "missionPhaseId": "phase-sortie",
  "state": "active",
  "durationHours": 3.0,
  "dutyCycle": 1.0,
  "environmentFactor": 1.3,
  "loadFactor": 1.2,
  "equivalentHours": 4.68
}
```

等效暴露时间：

```text
tau_i = sum(phase_duration * duty_cycle * environment_factor * load_factor)
```

如果 LRU 没有单独配置任务使用模式，则继承父系统暴露参数；如果 LRU 有覆盖配置，则以 LRU 自身配置为准。

### 5.5 RmsAllocationPlan

可靠性分配方案是独立对象。

```json
{
  "schema_version": "rms-allocation-plan-v1",
  "plan_id": "RMS-PLAN-001",
  "name": "近海巡逻任务RMS分配方案",
  "status": "draft",
  "project_id": "carrier-day-night",
  "equipment_snapshot": {
    "root_id": "aircraft-root",
    "version": "equipment-v12",
    "sha256": "..."
  },
  "mission_profile_snapshot": {
    "profile_id": "MP-01",
    "version": "mission-profile-v8",
    "sha256": "..."
  },
  "targets": {
    "reliability": {
      "value": 0.95,
      "at_hours": 3
    },
    "maintainability": {
      "value": 0.90,
      "within_hours": 2
    },
    "supportability": {
      "value": 0.90,
      "within_hours": 4
    }
  },
  "methods": {
    "reliability": "agree",
    "maintainability": "weighted_mttr",
    "supportability": "demand_weighted"
  },
  "node_inputs": {},
  "results": {},
  "verification": {},
  "algorithm_version": "rms-engine-1.0.0"
}
```

### 5.6 方案状态

建议状态机：

```text
draft       草稿
calculated  已计算
validated   已校核
published   已发布
stale       已失效
superseded  已替代
```

以下情况应自动标记为 `stale`：

1. 装备组成树变化；
2. 可靠性框图变化；
3. 任务剖面变化；
4. 算法版本变化；
5. RMS 顶层目标变化；
6. 用户修改已发布节点目标。

---

## 6. 可靠性分配算法

### 6.1 统一思路

所有可靠性分配方法最终都转换为风险预算分配。

装备目标可靠度：

```text
R_E
```

装备累计风险预算：

```text
H_E = -ln(R_E)
```

节点风险预算：

```text
H_i = H_E * w_i
```

其中 `w_i` 为节点风险权重，且满足：

```text
sum(w_i) = 1
```

节点任务可靠度：

```text
R_i = exp(-H_i)
```

节点失效率：

```text
lambda_i = H_i / tau_i
```

节点 MTBF：

```text
MTBF_i = 1 / lambda_i
```

其中 `tau_i` 是任务剖面编译得到的节点等效暴露时间。

### 6.2 等分配法

对于全串联系统，有 n 个子节点：

```text
H_i = H_E / n
R_i = exp(-H_i)
```

等价于：

```text
R_i = R_E ^ (1/n)
```

注意：等分配是等风险预算，不是等 MTBF。不同节点如果暴露时间不同，得到的 MTBF 要求也不同。

### 6.3 比例分配法

根据已有基线失效率和任务暴露时间计算初始风险：

```text
q_i = lambda_i_baseline * tau_i
```

归一化：

```text
w_i = q_i / sum(q_j)
```

得到：

```text
H_i = H_E * w_i
```

比例分配法适合已有相似产品、历史数据或供应商预测数据的场景。

### 6.4 评分分配法

评分因素可以包括：

1. 复杂度；
2. 技术成熟度；
3. 环境严酷度；
4. 任务重要度；
5. 改进难度；
6. 历史故障贡献；
7. 供应商能力；
8. 可维修性约束。

建议先计算风险因子：

```text
q_i = exp(
  alpha_c * z(complexity_i)
  + alpha_e * z(environment_i)
  + alpha_m * z(maturity_risk_i)
  - alpha_I * z(importance_i)
)
```

再归一化：

```text
w_i = q_i / sum(q_j)
```

方向约定：

1. 复杂度越高，允许分配更大的风险预算；
2. 环境越严酷，允许分配更大的风险预算；
3. 技术成熟度越低，允许分配更大的风险预算；
4. 任务重要度越高，风险预算应更小，即可靠性目标更严格；
5. 任务占空比已经体现在 `tau_i` 中，不应在评分中重复计算。

### 6.5 AGREE 分配法

AGREE 方法适合串联系统、指数失效假设和任务时间明确的场景。

简化表达：

```text
lambda_i = n_i * [-ln(R_s(T))] / (N * E_i * t_i)
```

其中：

- `R_s(T)`：系统在任务时间 T 内的目标可靠度；
- `n_i`：第 i 个子系统中的模块数；
- `N`：系统总模块数；
- `E_i`：子系统失效导致系统失效的概率或重要度；
- `t_i`：子系统工作时间。

适用性检查：

1. 父节点是否为串联结构；
2. 子节点是否有明确工作时间；
3. 是否可以提供模块数量或复杂度因子；
4. 是否存在并联、备用、k 中取 n 结构；
5. 是否存在非指数分布且无法等效转换。

如果不适用，应返回明确错误：

```json
{
  "applicable": false,
  "code": "AGREE_REDUNDANCY_NOT_SUPPORTED",
  "message": "当前节点包含1中取2冗余结构，请改用数值分配法"
}
```

---

## 7. 复杂可靠性结构处理

### 7.1 串联系统

```text
R_series = product(R_i)
```

累计风险可直接相加：

```text
H_series = sum(H_i)
```

### 7.2 并联系统

对于 n 个同型并联节点：

```text
R_parallel = 1 - product(1 - R_i)
```

如果所有子节点相同：

```text
R_i = 1 - (1 - R_parallel)^(1/n)
```

### 7.3 k 中取 n

同型节点下：

```text
R_k_n = sum(j=k..n) C(n,j) * R^j * (1-R)^(n-j)
```

一般使用数值二分法反求满足父节点目标的子节点可靠度。

### 7.4 备用结构

备用结构需要额外参数：

1. 热备用、温备用或冷备用；
2. 切换成功概率；
3. 备用期间失效率；
4. 检测覆盖率；
5. 故障发现延迟。

若参数缺失，系统可使用“理想备用假设”，但必须在结果中标记：

```json
{
  "warning": "STANDBY_IDEAL_ASSUMPTION",
  "message": "备用结构缺少切换成功概率，当前按理想备用计算"
}
```

### 7.5 通用数值求解

对于混合结构，使用统一数值求解框架。

先为子节点生成相对风险因子：

```text
q_i
```

设：

```text
H_i(c) = c * q_i
R_i(c) = exp(-H_i(c))
```

通过 RBD 评价器计算父节点可靠度：

```text
R_parent(c)
```

求解目标：

```text
R_parent(c) = R_target
```

使用二分法查找 `c`，得到每个子节点的目标可靠度、失效率和 MTBF。

---

## 8. 维修性分配算法

### 8.1 系统 MTTR 聚合

系统级 MTTR 可按故障贡献加权：

```text
MTTR_parent = sum(a_i * MTTR_i) / sum(a_i)
```

其中 `a_i` 是第 i 个节点对系统失效的贡献权重。

在串联系统中，可取：

```text
a_i = lambda_i
```

在冗余结构中，应使用有效系统失效贡献或 RBD 重要度修正。

### 8.2 LRU MTTR 分配

设节点维修难度因子为：

```text
g_i
```

令：

```text
MTTR_i = c * g_i
```

则：

```text
c = MTTR_parent * sum(a_i) / sum(a_i * g_i)
```

### 8.3 约束条件

需要支持：

1. 已锁定 MTTR；
2. 最小拆装时间；
3. 最大允许维修时间；
4. 维修级别；
5. 是否 LRU 可更换；
6. 是否需要专用工具；
7. 是否需要测试台；
8. 是否可现场修复。

如果锁定节点已经导致父系统目标不可达，应返回不可行结果。

---

## 9. 保障性分配算法

### 9.1 保障需求权重

保障性分配可先以 LRU 预期保障需求为权重：

```text
d_i = lambda_i * tau_i * quantity_i * criticality_i
```

其中：

- `lambda_i`：节点失效率；
- `tau_i`：任务等效暴露时间；
- `quantity_i`：装机数量；
- `criticality_i`：任务关键度。

### 9.2 MLDT 聚合

父节点 MLDT 可初步定义为：

```text
MLDT_parent = sum(d_i * MLDT_i) / sum(d_i)
```

### 9.3 LRU MLDT 分配

设保障难度因子为：

```text
h_i
```

令：

```text
MLDT_i = c * h_i
```

则：

```text
c = MLDT_parent * sum(d_i) / sum(d_i * h_i)
```

保障难度因子可以来自：

1. 库存可获得性；
2. 供应周期；
3. 保障层级；
4. 运输距离；
5. 通用化程度；
6. 专用工具；
7. 专业人员要求；
8. 备件体积、重量和装卸难度。

### 9.4 仿真验证要求

保障性具有明显非线性，因为共享库存、资源队列、备件短缺和运输竞争会相互耦合。因此 RMS 分配中的 S 和 MLDT 只是设计目标，必须通过备件保障仿真或蒙特卡洛实验验证。

---

## 10. 自底向上校核

每次分配完成后，系统必须根据分配后的 LRU 指标自底向上重新计算装备级指标。

校核输出：

```json
{
  "equipmentTarget": {
    "reliability": 0.95,
    "mttrHours": 1.5,
    "mldtHours": 2.0
  },
  "calculated": {
    "reliability": 0.9500003,
    "mttrHours": 1.498,
    "mldtHours": 2.07
  },
  "margin": {
    "reliability": 0.0000003,
    "mttrHours": 0.002,
    "mldtHours": -0.07
  },
  "status": "supportability_not_met",
  "warnings": []
}
```

校核内容：

1. 每个父节点是否可由子节点聚合回目标；
2. 装备级 R、M、S 是否满足要求；
3. 是否存在违反上下限约束的 LRU；
4. 是否存在缺失任务暴露的节点；
5. 是否存在方法不适用情况；
6. 是否存在被锁定节点导致目标不可达；
7. 是否存在使用理想备用、默认环境系数等假设；
8. 是否存在装备树或任务剖面变更导致方案失效；
9. 哪些 LRU 对装备指标最敏感。

---

## 11. 前端页面设计

### 11.1 页面结构

建议将现有“结果导入”页面替换为 RMS 分配工作台。

```text
┌──────────────────────────────────────────────┐
│ 顶部：方案名称 / 状态 / 输入快照 / 操作按钮       │
├──────────────┬─────────────────┬─────────────┤
│ 装备组成树     │ 指标输入与方法设置   │ 校核与摘要     │
│              │                 │             │
│ 装备          │ 装备级 R/M/S      │ 总体达成状态   │
│ 系统          │ 方法选择          │ 风险 LRU       │
│ 分系统        │ 评分因子          │ 警告           │
│ LRU           │ 约束上下限        │ 发布差异       │
├──────────────┴─────────────────┴─────────────┤
│ 下方：节点级分配结果表 / 任务暴露矩阵 / 敏感度分析 │
└──────────────────────────────────────────────┘
```

### 11.2 顶部操作

按钮：

```text
保存草稿
计算分配
自底向上校核
发布到装备模型
另存为方案
导出结果
```

### 11.3 目标输入区

字段：

1. 装备级任务可靠度 `R(T)`；
2. 任务时间 `T`；
3. 装备级 MTBF；
4. 维修性 `M(t)`；
5. MTTR 目标；
6. 保障性 `S(t)`；
7. MLDT 目标；
8. 固有可用度目标；
9. 使用可用度目标；
10. 适用任务剖面。

### 11.4 方法设置区

字段：

1. 可靠性分配方法：等分配、比例分配、AGREE、评分分配、数值求解；
2. 维修性分配方法：等分配、故障贡献加权、维修难度加权；
3. 保障性分配方法：需求权重、保障难度加权；
4. 是否允许覆盖锁定节点；
5. 是否启用上下限约束；
6. 是否允许使用默认任务暴露参数；
7. 是否允许理想备用假设。

### 11.5 结果表

字段：

| 层级 | 节点     | 父节点 | 结构 | 暴露时间 | R目标 | 失效率 | MTBF | MTTR | MLDT |    Ai | 状态 |
| ---- | -------- | ------ | ---- | -------: | ----: | -----: | ---: | ---: | ---: | ----: | ---- |
| 系统 | 航电系统 | 整机   | 并联 |     3.6h | 0.982 |  0.005 | 200h | 1.3h | 2.1h | 0.993 | 满足 |

### 11.6 校核面板

显示：

1. 装备级目标值；
2. 自底向上计算值；
3. 裕度；
4. 不满足项；
5. 不可行原因；
6. 假设条件；
7. 关键 LRU 排名；
8. 发布前后变化。

---

## 12. 前端模块拆分

建议新增以下文件：

```text
front/rms-allocation-engine.mjs
front/rms-allocation-model.mjs
front/rbd-evaluator.mjs
front/mission-exposure-compiler.mjs
front/rms-allocation-workbench.mjs
```

职责：

### 12.1 rms-allocation-model.mjs

负责：

1. 默认方案生成；
2. 方案校验；
3. 装备树规范化；
4. RMS target / prediction / actual 转换；
5. 结果对象构造。

### 12.2 mission-exposure-compiler.mjs

负责：

1. 从任务剖面读取任务阶段、波次、周期和任务时间；
2. 根据节点使用规则生成节点级暴露矩阵；
3. 计算等效暴露时间；
4. 输出缺失使用规则警告。

### 12.3 rbd-evaluator.mjs

负责：

1. 串联可靠度计算；
2. 并联可靠度计算；
3. k 中取 n 可靠度计算；
4. 备用结构可靠度计算；
5. 自底向上 RBD 聚合；
6. 数值反求。

### 12.4 rms-allocation-engine.mjs

负责：

1. 等分配法；
2. 比例分配法；
3. AGREE 分配法；
4. 评分分配法；
5. 维修性分配；
6. 保障性分配；
7. 自底向上校核；
8. 不可行诊断。

### 12.5 rms-allocation-workbench.mjs

负责：

1. 页面渲染；
2. 表单输入；
3. 节点选择；
4. 结果表；
5. 校核面板；
6. 发布操作。

---

## 13. 核心接口设计

### 13.1 计算入口

```js
export function calculateRmsAllocation(plan, project) {
  const model = validateAndBuildAllocationModel(plan, project);

  const exposure = compileMissionExposure(
    project.missionProfile,
    project.missionPhases,
    model.equipmentTree
  );

  const reliability = allocateReliability(model, exposure);
  const maintainability = allocateMaintainability(model, reliability);
  const supportability = allocateSupportability(
    model,
    reliability,
    project.supportNodes
  );

  return verifyAllocation({
    model,
    exposure,
    reliability,
    maintainability,
    supportability
  });
}
```

### 13.2 发布入口

```js
export function publishRmsAllocation(project, allocationResult) {
  const nextProject = cloneProject(project);

  for (const nodeResult of allocationResult.nodeResults) {
    const node = findEquipmentNode(nextProject, nodeResult.nodeId);
    node.rms ||= {};
    node.rms.target = {
      reliability: nodeResult.reliability,
      failureRate: nodeResult.failureRate,
      mtbfHours: nodeResult.mtbfHours,
      mttrHours: nodeResult.mttrHours,
      mldtHours: nodeResult.mldtHours,
      inherentAvailability: nodeResult.inherentAvailability,
      allocationPlanId: allocationResult.planId,
      allocationPlanVersion: allocationResult.planVersion
    };
  }

  return nextProject;
}
```

### 13.3 校核入口

```js
export function verifyAllocation({ model, exposure, reliability, maintainability, supportability }) {
  const bottomUpReliability = evaluateRbdBottomUp(model.rbd, reliability.nodeTargets);
  const bottomUpMaintainability = aggregateMttr(model, maintainability.nodeTargets);
  const bottomUpSupportability = aggregateMldt(model, supportability.nodeTargets);

  return {
    status: buildStatus(bottomUpReliability, bottomUpMaintainability, bottomUpSupportability),
    calculated: {
      reliability: bottomUpReliability,
      mttrHours: bottomUpMaintainability,
      mldtHours: bottomUpSupportability
    },
    nodeResults: mergeNodeResults(reliability, maintainability, supportability),
    warnings: collectWarnings(model, exposure),
    assumptions: collectAssumptions(model, exposure)
  };
}
```

---

## 14. 后端 API 设计

当前可以先在前端实现本地计算 MVP，后续进入真实系统时增加后端接口。

建议 API：

```text
POST /rms-allocation-plans
GET  /rms-allocation-plans/{plan_id}
PUT  /rms-allocation-plans/{plan_id}

POST /rms-allocation-plans/{plan_id}/validate
POST /rms-allocation-plans/{plan_id}/calculate
POST /rms-allocation-plans/{plan_id}/verify
POST /rms-allocation-plans/{plan_id}/publish
```

### 14.1 calculate 请求

```json
{
  "project_id": "carrier-day-night",
  "plan_id": "RMS-PLAN-001",
  "equipment_version": "equipment-v12",
  "mission_profile_version": "mission-profile-v8",
  "methods": {
    "reliability": "agree",
    "maintainability": "weighted_mttr",
    "supportability": "demand_weighted"
  }
}
```

### 14.2 calculate 响应

```json
{
  "ok": true,
  "algorithm_version": "rms-engine-1.0.0",
  "plan_status": "calculated",
  "node_results": [],
  "verification": {},
  "warnings": [],
  "assumptions": []
}
```

### 14.3 publish 响应

```json
{
  "ok": true,
  "plan_status": "published",
  "published_project_version": "project-v18",
  "updated_node_count": 18,
  "artifact_manifest_id": "artifact-rms-plan-001-v3"
}
```

---

## 15. 与仿真引擎衔接

当前仿真逻辑需要升级，使仿真真正消费 RMS 分配结果。

### 15.1 故障概率转换

不能直接把 `failureRate` 当作每步故障概率，而应根据步长计算：

```text
p_failure_step = 1 - exp(-lambda * delta_t)
```

其中：

- `lambda = 1 / MTBF`；
- `delta_t` 是仿真步长，以小时为单位。

### 15.2 维修时间生成

维修活动持续时间应根据 MTTR 或维修时间分布生成。

简化 MVP：

```text
repair_duration = round(MTTR / tick_hours)
```

后续可使用指数、对数正态或三角分布。

### 15.3 保障延迟生成

MLDT 可影响：

1. 备件到达延迟；
2. 维修排队延迟；
3. 保障设备等待；
4. 人员等待；
5. 后方调运时间。

简化 MVP：

```text
logistics_delay_steps = round(MLDT / tick_hours)
```

更真实版本应由库存、补给、保障组织和资源容量共同决定。

### 15.4 仿真结果回流

仿真完成后应产生对比分表：

| 节点   | 分配目标 MTBF | 仿真估计 MTBF | 分配 MTTR | 仿真平均维修时间 | 是否满足 |
| ------ | ------------: | ------------: | --------: | ---------------: | -------- |
| 发动机 |          950h |          910h |      2.0h |             2.3h | 风险     |

结果用于支持下一轮 RMS 分配调整。

---

## 16. 数据契约与文件

建议新增：

```text
contracts/rms_allocation_plan.schema.json
contracts/rms_allocation_result.schema.json
contracts/mission_exposure.schema.json
```

### 16.1 rms_allocation_plan.schema.json

约束：

1. 方案 ID、名称、状态；
2. 装备快照；
3. 任务剖面快照；
4. 顶层 RMS 目标；
5. 分配方法；
6. 节点评分和约束；
7. 算法版本。

### 16.2 rms_allocation_result.schema.json

约束：

1. 节点级分配结果；
2. 自底向上校核结果；
3. 不可行原因；
4. 警告；
5. 假设条件；
6. 发布记录。

### 16.3 mission_exposure.schema.json

约束：

1. 任务阶段；
2. 节点 ID；
3. 状态；
4. 时长；
5. 占空比；
6. 环境系数；
7. 负载系数；
8. 等效暴露时间。

---

## 17. 实施路线

### 17.1 第一阶段：RMS 分配 MVP

目标：先实现可运行、可校核的串联系统分配。

范围：

1. RMS 分配方案对象；
2. 任务暴露矩阵；
3. 串联系统 RBD 评价；
4. 等分配法；
5. 比例分配法；
6. AGREE 分配法；
7. 简化评分分配法；
8. MTTR 加权分配；
9. MLDT 需求加权分配；
10. 自底向上校核；
11. 发布到 `rms.target`。

验收：

1. 串联系统分配后能反算回装备级可靠度目标；
2. 不同任务暴露时间会产生不同 MTBF 要求；
3. AGREE 遇到不适用结构会拒绝计算；
4. 发布只写入 `target`，不覆盖预测值和实测值。

### 17.2 第二阶段：复杂结构和约束求解

范围：

1. 并联结构；
2. k 中取 n；
3. 主动备用、热备用、温备用、冷备用；
4. 数值反求；
5. 固定节点；
6. 上下限约束；
7. 不可行诊断；
8. 敏感度分析。

验收：

1. 并联结构可反求子节点可靠度；
2. k 中取 n 结构可通过数值求解满足父节点目标；
3. 固定节点导致不可达时，系统能明确返回不可行原因；
4. 备用结构缺少参数时能显式提示假设条件。

### 17.3 第三阶段：保障性与仿真闭环

范围：

1. MLDT 与库存、补给、运输时间联动；
2. 仿真引擎消费 MTBF、MTTR、MLDT；
3. 蒙特卡洛验证 RMS 目标达成情况；
4. 分配目标、设计预测和仿真评估对比；
5. 仿真结果回流到方案调整。

验收：

1. 改变 LRU MTBF 会影响任务可靠度仿真结果；
2. 改变 MTTR 会影响维修排队和可用度；
3. 改变 MLDT 会影响备件等待和任务延误；
4. 蒙特卡洛结果能判断 RMS 分配目标是否支撑任务可靠度目标。

---

## 18. 测试设计

### 18.1 单元测试

新增测试文件：

```text
tests/rms-allocation-engine.test.mjs
tests/rbd-evaluator.test.mjs
tests/mission-exposure-compiler.test.mjs
```

测试项：

1. `-ln(R)` 风险预算转换；
2. 等分配法；
3. 比例分配法；
4. AGREE 适用性检查；
5. AGREE 计算结果；
6. 并联可靠度计算；
7. k 中取 n 可靠度计算；
8. 数值反求收敛；
9. MTTR 加权聚合；
10. MLDT 加权聚合；
11. 固有可用度推导；
12. 输入缺失警告；
13. 方案 stale 判断。

### 18.2 前端契约测试

扩展现有前端测试，检查：

1. RMS 分配页面可达；
2. 页面包含装备树、目标输入、方法选择、结果表和校核面板；
3. 结果导入页面不再只是静态表；
4. 发布按钮不会覆盖 prediction 和 actual；
5. 任务可靠度模块具有指标分配入口。

### 18.3 集成测试

构造最小项目：

```text
整机
  -> 系统 A
  -> 系统 B
  -> 系统 C
```

目标：

```text
R_equipment(3h) = 0.95
```

检查：

1. 等分配结果满足 `R_A * R_B * R_C = 0.95`；
2. 如果系统 A 暴露时间更长，则系统 A 的 MTBF 要求高于暴露时间较短的系统；
3. 发布后组件 `rms.target` 更新；
4. 再次校核返回 validated。

---

## 19. 风险与注意事项

### 19.1 不要把分配结果当成真实能力

分配结果是设计目标，不等于装备已经达到该能力。必须通过预测、试验、历史数据或仿真验证。

### 19.2 不要混淆 Ai 和 Ao

固有可用度只由 MTBF 和 MTTR 决定；考虑保障延迟时应使用作战可用度或使用可用度。

### 19.3 不要对所有结构套用 AGREE

AGREE 适合特定假设条件。对于冗余、备用和复杂结构，应使用 RBD 数值反求。

### 19.4 不要绕过数据契约

RMS 分配方案、输入快照、算法版本、发布记录必须持久化，不能只依赖浏览器内存。

### 19.5 不要覆盖供应商预测或实测数据

发布分配目标只能更新 `rms.target`，不能覆盖 `rms.prediction` 和 `rms.actual`。

---

## 20. 最小可交付清单

MVP PR 可以包含：

1. `front/rms-allocation-engine.mjs`
2. `front/rbd-evaluator.mjs`
3. `front/mission-exposure-compiler.mjs`
4. `front/rms-allocation-workbench.mjs`
5. `contracts/rms_allocation_plan.schema.json`
6. `contracts/rms_allocation_result.schema.json`
7. `contracts/mission_exposure.schema.json`
8. `tests/rms-allocation-engine.test.mjs`
9. `tests/rbd-evaluator.test.mjs`
10. `tests/mission-exposure-compiler.test.mjs`
11. `docs/rms-allocation-design.md`
12. 修改 `front/feature-catalog.mjs`，加入 RMS 分配页面入口
13. 修改 `front/app.js`，接入 RMS 分配工作台
14. 修改 `docs/README.md`，说明当前 RMS 分配能力边界

---

## 21. 验收标准

功能完成后应满足：

1. 用户可以输入装备级 R、M、S、MTBF、MTTR、MLDT 目标。
2. 系统可以读取装备组成树、可靠性结构和任务剖面。
3. 系统可以生成任务暴露矩阵。
4. 系统支持等分配法、比例分配法、AGREE 分配法和评分分配法。
5. 系统可以将装备级指标分解到系统和 LRU 级。
6. 系统可以自底向上校核分配结果。
7. 系统可以显示不可行原因、警告和假设条件。
8. 系统可以保存多个分配方案。
9. 系统可以标记方案过期。
10. 系统可以发布分配结果到装备模型 `rms.target`。
11. 发布不覆盖预测值和实测值。
12. 仿真场景可以选择使用 RMS target 作为输入。
13. 蒙特卡洛实验可以验证分配目标对任务可靠度、可用度和备件保障压力的影响。

---

## 22. 结论

`spare_mvp` 中的可靠性分配功能应作为连接“装备建模、任务剖面、可靠性框图、RMS 指标、仿真验证”的核心桥梁。它的关键不是简单生成 LRU 指标表，而是建立一个完整的工程闭环：

```text
指标输入
  -> 结构建模
  -> 任务暴露
  -> 算法分配
  -> 反向校核
  -> 方案发布
  -> 仿真验证
  -> 方案迭代
```

第一阶段建议优先完成串联系统、任务暴露矩阵、等分配、比例分配、AGREE、评分分配和自底向上校核。第二阶段再扩展并联、k 中取 n、备用和约束求解。第三阶段将 MTBF、MTTR、MLDT 真正接入仿真引擎，使 RMS 分配结果能够影响任务可靠度、战备完好率、停机因素和备件保障结果。
