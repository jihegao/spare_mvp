# GLM Independent Mesa 四类独立分析设计

**日期**: 2026-06-22
**主题**: 基于 `independent-mesa/GLM` 的输入数据与可视化仿真,实现独立的备件短板分析、飞机转场携行清单分析、任务可靠度评估、停机因素分析

## 目标

在 `independent-mesa/GLM` 已跑通的单场景帧导出与 Monte Carlo sweep 基础上,新开四个独立分析模块,各自:
1. 反应该分析的内在逻辑(算法步骤、公式、判定规则)
2. 有参数配置区(用户可调节关键参数,前端筛选不同参数组合)
3. 输出关键分析结果(KPI 卡 + 表格 + SVG 图)

四个分析与 spare_mvp 主仓库的 `analysis_projection_*` 类型对齐(备件短板/转场携行/任务可靠度/停机因素),但 payload schema 独立,不接 backend/HTTP,纯 Python + 静态 HTML。

## 架构决策

| 决策点 | 选择 |
|--------|------|
| 交互模式 | 预计算 + 前端筛选:CLI 一次跑参数网格,结果全部嵌入 HTML;前端控件切换组合查看,无需后端 |
| 输出形式 | 4 份独立 HTML + 4 份 JSON,落 `independent-mesa/GLM/output/analyses/`,与现有 `single-run/visualization.html`、`sweep/monte_carlo.html` 同模式 |
| 数据来源 | 每个分析内部实例化 `IndependentMesaModel`/`MonteCarloRunner` 跑自己的样本,参数改动反映到仿真 |
| HTML 布局 | 共享 `base.py` 脚手架,三栏布局:左侧参数配置区 + 右侧 KPI/表格/SVG/逻辑说明 |
| 测试 | pytest,固定 seed 可复现,放在 `independent-mesa/GLM/tests/test_analyses.py` |

## 目录布局

```
independent-mesa/GLM/
├── independent_mesa/
│   ├── analyses/
│   │   ├── __init__.py
│   │   ├── base.py                  # 共享:HTML scaffold/参数网格/公共工具
│   │   ├── spare_shortfall.py       # 备件短板分析
│   │   ├── carry_list.py            # 飞机转场携行清单分析
│   │   ├── mission_reliability.py   # 任务可靠度评估
│   │   └── downtime_factors.py      # 停机因素分析
│   └── ...existing...
├── run_analysis.py                  # CLI 入口:--type {spare_shortfall|carry_list|mission_reliability|downtime_factors} [--all] [--samples N]
├── output/analyses/
│   ├── spare_shortfall.json + .html
│   ├── carry_list.json + .html
│   ├── mission_reliability.json + .html
│   └── downtime_factors.json + .html
└── tests/
    └── test_analyses.py             # 4 类分析的 pytest 用例
```

每个 analysis 模块统一三件套接口:
- `Config` dataclass:参数 schema(name/type/default/label/range/options)
- `run(import_package, config) -> dict`:执行分析,返回 payload
- `build_html(payload, config) -> str`:渲染独立 HTML

`base.py` 提供:
- HTML 脚手架(顶部标题/状态、左侧参数配置区、右侧 KPI 卡 + 表格 + SVG 图、底部逻辑说明区)
- 参数网格枚举工具(`iter_configs(Config) -> list[Config]`)
- SVG 渲染辅助(柱状图、折线图、饼图、RBD 树状图)
- 公共样式常量(颜色、字号)

## 共享 HTML 脚手架

每个 analysis HTML 三栏布局:

```
┌─────────────────────────────────────────────────────────┐
│  Header: 标题 + 当前选中参数摘要                          │
├──────────────┬──────────────────────────────────────────┤
│ 参数配置区    │  KPI 卡(2x2 grid)                        │
│ (下拉/滑块)   │  ──────────────────────────────────────  │
│              │  关键结果表格                              │
│              │  ──────────────────────────────────────  │
│              │  SVG 图(柱状/折线/饼图)                   │
│              │  ──────────────────────────────────────  │
│              │  内在逻辑说明(算法步骤 + 公式)             │
├──────────────┴──────────────────────────────────────────┤
│  Footer: payload 源 + 样本数 + 生成时间                    │
└─────────────────────────────────────────────────────────┘
```

参数配置区控件绑定到嵌入的 payload 索引:改下拉 → 触发 JS `setConfig()` → 从 `payloads[configKey]` 取对应结果 → 重渲染 KPI/表格/SVG。无需后端。

## 每个 analysis 的内在逻辑

### 1. 备件短板分析 `spare_shortfall.py`

**逻辑**: 在任务节奏下,逐 spare type 跑 N 个 Monte Carlo 样本,统计每个 spare type 的短缺事件,算满足率和短缺概率,按风险阈值分级,找出短板备件。

**参数配置区(预计算网格)**:

| 参数 | 默认 | 网格 | 驱动 |
|---|---|---|---|
| `samples` | 60 | [30, 60, 100] | 仿真 |
| `mission_steps` | 48 | [24, 48, 96] | 仿真 |
| `spare_multiplier` | 1.0 | [0.75, 1.0, 1.25] | 仿真 |
| `risk_critical_threshold` | 0.20 | 固定 | 后处理 |
| `risk_shortage_threshold` | 0.01 | 固定 | 后处理 |

仿真组合 = 3×3×3 = 27。

**算法**:
1. 从 `equipmentAssets` 抽 spare_type → failure_rate 映射;从 `supportResources` 抽初始 inventory
2. 对每个 `spare_multiplier`:对每个样本实例化 `IndependentMesaModel`,把所有节点的 `inventory[k] *= spare_multiplier`,跑 `mission_steps` 步
3. 从 `event_log` 数 `spare_shortage` 事件按 spare_type 分组;从 `support_network.nodes[].inventory` 差量算实际消耗
4. 对每个 spare_type:
   - `fill_rate = 1 - (samples_with_shortage / total_samples)`
   - `shortage_probability = 1 - fill_rate`
   - `risk_level` 按阈值判: `>= 0.20` → 严重, `> 0.01` → 短缺, 否则 关注
5. 排序: `shortage_probability` 降序

**关键结果**:
- KPI 卡:短板备件数(风险 ≠ 关注)、最低满足率、最高短缺概率、建议优先补充(前 2 名)
- 表格:每个 spare_type 的 base_count/stock/shortage/satisfy/shortage_probability/risk_level
- SVG 图:每个 spare_type 的满足率柱状图,按风险等级着色(严重红/短缺橙/关注绿)
- 逻辑说明区:展示 5 步算法流程 + 风险阈值含义

### 2. 飞机转场携行清单分析 `carry_list.py`

**逻辑**: 飞机转场到前出保障点,按转场时长/飞机数/目标成功概率,用 Poisson 模型算每个 spare type 的最小携行量 K,使 P(demand ≤ K) ≥ target_P。

**参数配置区**:

| 参数 | 默认 | 网格 | 驱动 |
|---|---|---|---|
| `transit_hours` | 4 | [2, 4, 8] | 公式 |
| `transit_aircraft_count` | 2 | [1, 2, 3] | 公式 |
| `target_success_probability` | 0.95 | [0.90, 0.95, 0.99] | 公式 |
| `priority_rule` | "connection" | 固定 | 后处理 |

公式组合 = 3×3×3 = 27,无仿真调用,Poisson CDF 直接计算。

**算法**:
1. 从 `equipmentAssets` 抽 spare_type → failure_rate → connection_type 映射
2. 对每个 (transit_hours, aircraft_count, target_P):对每个 spare_type:
   - `expected_demand_lambda = failure_rate × transit_hours × aircraft_count`(Poisson λ)
   - 用 Poisson CDF 找最小 K: `F(K; λ) = Σ_{i≤K} e^-λ λ^i/i! ≥ target_P`
   - `multiplier = K / max(1, round(λ))`(携行倍率,基于需求均值归一)
   - `qty = K`(携行件数)
   - `priority` 按 connection_type: 串联→高, 并联/备用→中, 其他→低
3. 排序: `qty` 降序

**关键结果**:
- KPI 卡:总携行件数、最高倍率、高优先级备件(前 2)、优化条件
- 表格:每个 spare_type 的 multiplier/qty/priority/satisfy/delay
- SVG 图:每个 spare_type 的 K 值柱状图,按优先级着色(高红/中橙/低绿)
- 逻辑说明区:Poisson 模型公式 `P(X≤K) = Σ e^-λ λ^i/i!` + 优先级判定规则

### 3. 任务可靠度评估 `mission_reliability.py`

**逻辑**: 用 `reliability.py` 在 RBD 上算系统级可靠度 R(system, dt),结合仿真出动架次率,对照目标可靠度判定目标达成状态。

**参数配置区**:

| 参数 | 默认 | 网格 | 驱动 |
|---|---|---|---|
| `mission_duration_hours` | 24 | [12, 24, 48] | 仿真 + RBD |
| `target_reliability` | 0.95 | [0.90, 0.95, 0.99] | 后处理 |
| `samples` | 30 | [20, 30, 50] | 仿真 |
| `redundancy_enabled` | true | [true, false] | 后处理(RBD) |

仿真组合 = 3×3 = 9(samples × mission_duration),RBD 评估在后处理阶段按 (duration, redundancy) 网格计算。

**算法**:
1. 从 `reliabilityBlockDiagram` 构建 blocks;从 `equipmentAssets` 抽 failure_rate
2. 对每个 mission_duration: 用 `evaluate_system_reliability(blocks, dt=duration_hours)` 算 R(system)
   - 若 `redundancy_enabled=false`,把并联/备用临时改串联再算
3. 对每个样本: 跑 `IndependentMesaModel` `steps = mission_duration_hours × 2` 步,记 `sortie_completion_rate`
4. `mission_success_probability = R(system) × mean(sortie_completion_rate)`, `target_met = probability ≥ target_reliability`
5. `state` = 满足(>=target) / 风险(<0.7) / 关注(中间)

**关键结果**:
- KPI 卡:任务成功概率、出动架次率、目标达成、可靠度趋势
- 表格:每个 RBD block 的 name/connection_type/failure_rate/mtbf/reliability_at_dt
- SVG 图:RBD 树状图(节点按可靠度着色)+ 可靠度 vs mission_duration 折线图
- 逻辑说明区:串联 `R = ∏ R_i` / 并联 `R = 1 - ∏(1-R_i)` / 备用 `R = R_1 + (1-R_1) R_2 w` 公式 + 系统级合成规则

### 4. 停机因素分析 `downtime_factors.py`

**逻辑**: 从仿真的 `event_log` + `activity_jobs` 时间线,把每起停机事件按根因归到 4 类(装备故障/备件短缺/资源延误/计划延误),算每类贡献占比。

**参数配置区**:

| 参数 | 默认 | 网格 | 驱动 |
|---|---|---|---|
| `samples` | 50 | [20, 50, 100] | 仿真 |
| `mission_steps` | 48 | [24, 48, 96] | 仿真 |
| `resource_delay_threshold_minutes` | 30 | [15, 30, 60] | 后处理 |
| `schedule_delay_threshold_minutes` | 20 | [10, 20, 40] | 后处理 |

仿真组合 = 3×3 = 9,后处理阈值在已采集事件上筛选,不重跑仿真。

**算法**:
1. 对每个 (samples, mission_steps) 仿真组合: 对每个样本实例化 `IndependentMesaModel`, 跑 `mission_steps`, 采集 `event_log`、`activity_jobs`、`all_waves` 的原始时间线
2. 对每个 (resource_threshold, schedule_threshold) 后处理组合: 在已采集时间线上应用阈值,因素分类计数:
   - **failure(装备故障)**: 数 `lru_failure` 事件 + 飞机进 `maintenance` 阶段次数
   - **spare_shortage(备件短缺)**: 数 `spare_shortage` 事件
   - **resource_delay(资源延误)**: 数 `job.waiting` 时长 > `resource_delay_threshold` 的作业
   - **schedule_delay(计划延误)**: 数 `wave.delayed` 且延误时长 > `schedule_delay_threshold` 的波次
3. `contribution = factor_count / total_count`, 排序降序;`total_downtime_minutes` 按因素累加
4. 跨样本取均值

**关键结果**:
- KPI 卡:停机因素总次数、首要因素、次要因素、总停机时长
- 表格:每个 factor 的 label/count/contribution/contributionLabel/total_downtime_minutes
- SVG 图:停机因素贡献占比饼图(4 类) + 跨样本堆叠柱状图
- 逻辑说明区:4 类根因判定规则 + 阈值含义

## CLI 入口 `run_analysis.py`

```bash
# 跑单个分析(用默认参数网格)
.abm-mesa-test-env/bin/python run_analysis.py --type spare_shortfall

# 跑全部 4 个
.abm-mesa-test-env/bin/python run_analysis.py --all

# 自定义样本数(覆盖默认 samples 字段)
.abm-mesa-test-env/bin/python run_analysis.py --type downtime_factors --samples 100
```

每个分析落两份到 `output/analyses/`:
- `{type}.json`: payload + 全部参数组合结果
- `{type}.html`: 嵌入 payload 的可视化页

## JSON payload schema

每个 analysis 的 JSON 顶层结构统一:

```json
{
  "analysis_type": "spare_shortfall",
  "generated_at": "2026-06-22T...",
  "data_source": "independent-mesa/GLM/data/import_package.json",
  "config_schema": [...],              // 参数定义,前端动态生成控件
  "default_config": {...},             // 默认选中参数
  "results": {                         // 全部参数组合的结果
    "<config_key>": {
      "config": {...},
      "metrics": [["label", "value"], ...],
      "rows": [...],
      "charts": {...}                  // SVG 渲染所需数据点
    }
  },
  "logic_summary": [...]               // 内在逻辑说明步骤
}
```

`config_key` 是参数组合的确定性 hash,前端控件选中后直接 `results[config_key]` 取值。

## 测试策略 `tests/test_analyses.py`

跟现有 GLM tests 同模式,pytest,固定 seed 可复现:

- `test_spare_shortfall`: 3 个 spare_type 都有 row;`spare_multiplier=1.25` 时满足率 ≥ 0.75;风险等级按阈值判定
- `test_carry_list`: Poisson K 随 target_P 单调不减;qty ≥ 1;优先级按 connection_type 正确分流
- `test_mission_reliability`: R(system) ∈ (0,1];`target_reliability=0.5` 时 `target_met=true`;`redundancy_enabled=false` 时 R 降
- `test_downtime_factors`: 4 类 factor 都有 row;contribution 之和 ≈ 1(误差 0.01)
- `test_html_builds`: 4 个 `build_html()` 返回非空字符串且包含 KPI 标签
- `test_cli`: `run_analysis.py --type X` 产出 JSON + HTML 文件
- `test_config_grid`: `iter_configs()` 返回的组合数与预期一致

## 非目标

- 不接 spare_mvp backend/HTTP,纯 Python + 静态 HTML
- 不做置信区间/分布统计/异常样本钻取(沿用 M8.0 边界)
- 不做报告导出 PDF/Excel
- 不复用 spare_mvp 的 `analysis_projection_*` artifact 协议(独立 payload schema,字段名对齐 adapter 方便对照但非契约)
- 不实现参数热编辑后重跑仿真(改参数只在前端筛选预计算结果)

## 性能预算

仿真调用次数(默认参数):
- `spare_shortfall`: 27 仿真组合 × 60 样本 = 1620 次
- `carry_list`: 0 仿真调用(Poisson 公式直接计算)
- `mission_reliability`: 9 仿真组合 × 30 样本 = 270 次 + RBD 评估(廉价)
- `downtime_factors`: 9 仿真组合 × 50 样本 = 450 次 + 后处理筛选(廉价)

总仿真调用 ≈ 2340 次,与现有 `run_sweep.py`(27×24=648 次)同量级。`--samples N` 可全局缩减样本数;前端筛选预计算结果不产生额外仿真调用。

## 验证

- `cd independent-mesa/GLM && PYTHONPATH=. ../../.abm-mesa-test-env/bin/python -m pytest tests/test_analyses.py -v`
- `.abm-mesa-test-env/bin/python run_analysis.py --all` 产出 4 份 JSON + 4 份 HTML
- 浏览器打开 `output/analyses/{type}.html`,改参数配置区控件,KPI/表格/SVG 同步刷新
