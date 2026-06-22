# Independent Mesa 消费导入示例项目数据 — 设计文档

**日期**: 2026-06-22
**主题**: 导出"导入示例项目"建模数据,在 spare_mvp 系统外新开一个独立 Mesa,强消费示例项目全部字段

## 背景与目标

spare_mvp 仓库内有一份完整的"导入示例项目"建模数据:`tests/fixtures/modeling_import_project.json`(`modeling-import-v1` schema)。该数据涵盖任务剖面、装备层级、多级保障点、保障活动作业网络、Monte Carlo 配置等域,但现有 Mesa 模型 `AviationSupportModel` 读的是另一份英文 `scenario_config.json`,并不消费这份导入包。

**目标**:搭建一个独立的 Mesa 项目,直接消费导入示例项目的全部字段(每个字段都驱动仿真行为),先跑通单场景帧导出,再加 Monte Carlo sweep 层。

## 决策记录

| 决策点 | 选择 |
|--------|------|
| Mesa 位置与独立程度 | 复用 `.abm-mesa-test-env` 虚拟环境;模型代码放在独立目录,不接入 backend/frontend |
| 模型代码 | 全新独立模型,专为 `modeling-import-v1` schema 设计,不继承现有模型简化假设 |
| 数据消费强度 | 强:每个字段都驱动仿真行为 |
| 产出模式 | 先单场景帧导出,再加 Monte Carlo sweep |
| 架构 | 方案 B:模型编排 + 领域模块 |

## 架构与目录布局

```
independent-mesa/
├── README.md                      # 运行说明
├── requirements.txt               # mesa, numpy, scipy, networkx
├── data/
│   └── import_package.json        # 从 tests/fixtures/modeling_import_project.json 拷入
├── output/
│   ├── single-run/                # 单场景 frames.json + metrics.json
│   └── sweep/                     # Monte Carlo sweep results.json
├── independent_mesa/
│   ├── __init__.py
│   ├── model.py                   # IndependentMesaModel(Model) — 编排层
│   ├── agents.py                  # AircraftAgent(Agent) — 飞机状态与装备快照
│   ├── mission_scheduler.py       # 复合任务+周期任务调度
│   ├── equipment.py               # 装备树+故障分布采样+kOutOfN+lifeLimit
│   ├── support_network.py         # 三级保障点+横向/纵向运输+备件库存
│   ├── activity_planner.py        # 保障活动作业网络(predecessors DAG)+工时分布采样
│   ├── reliability.py             # 可靠性框图(串/并/备用)计算
│   ├── monte_carlo.py             # sweep 运行器
│   └── frames.py                  # snapshot 序列化为 frames JSON
├── run_single.py                  # 单场景入口
├── run_sweep.py                   # sweep 入口
└── tests/
    ├── test_equipment.py
    ├── test_mission_scheduler.py
    ├── test_activity_planner.py
    ├── test_support_network.py
    ├── test_reliability.py
    ├── test_monte_carlo.py
    └── test_model_integration.py
```

**编排关系**:`IndependentMesaModel.__init__` 解析 import package,构建各领域模块实例;`step()` 按固定顺序驱动各模块。`AircraftAgent` 持有装备树快照(由 `equipment.py` 构建),作为 Mesa agent 参与可视化。

**数据流**:`import_package.json` → 各领域模块解析各自负责的子树 → Model 编排 → frames/sweep 结果写到 `output/`。

## 数据消费映射(字段 → 仿真行为)

### 任务剖面 → `mission_scheduler.py`
- `missionProfiles[0]` 提供 24h 总时长、4 个昼夜波次(2h 准备 + 4h 出动 + 1h 回收)
- `basicMission`(近海制空巡逻):5 架最低出动、180min 任务时长、50min 准备、0.95 成功点 → 驱动每次波次的 `required_aircraft` 和任务时长
- `compositeTasks`(昼间制空 day-cap / 夜间警戒 night-alert):`taskDispatchTime`/`firstWaveTime`/`recoveryTime`/`dailyRepeatCount`/`intervalHours` → 驱动波次时间轴
- `periodicTasks[0]`:`repeatCycleDays=7`、`weekdayAssignments`(周一~周日映射到 compositeTaskId)→ 驱动跨天周期编排(7 天一循环,每天按 weekday 选 composite task)
- `missionPhases`(甲板待命→飞行前准备→出动执行→回收检查)及 `limitHours` → 驱动飞机状态机阶段时长上限
- `combatUnit.members`(6 架 J-15/J-35,含 remainingLifeHours/takeoffLandingCount/deploymentLocation/status)→ 初始化每架飞机 agent

### 装备 → `equipment.py`
- `equipmentAssets` 树(aircraft-root → j15-engine → j15-engine-control 等 10 节点):构建父子树,每个 LRU/SRU 节点:
  - `failureDistribution`(指数 lambda / Weibull beta,eta / 正态 mean,sigma)→ 按 `failureModel`(随机/退化/寿命)选采样器
  - `failureRate`/`mtbfHours`/`lifeLimitHours` → 驱动故障到达 + 寿命上限停飞
  - `kOutOfN`(n=2,k=1 等)→ 驱动冗余失效判定(n 中 k 个坏才算系统失效)
  - `connectionType`(串联/并联/备用)→ 与可靠性框图联动
  - `specialRepairProfile`(repairTimeMinutes/repairRatio/replacementRatio)→ 驱动修复策略(修复 vs 换件,时长按比例)
  - `rms`(reliability/maintainability/supportability/mttr/mldt/availability)→ 飞机/系统级可用度指标采样源
- `equipment`(整机层):model/wholeMachineModels(J-15/J-35)/quantity/minRequiredSorties/preLifeRequirementHours → 驱动机队规模与出动门槛

### 保障资源 → `support_network.py`
- `supportResources`(carrier-deck / forward-sea-base / carrier-stock)三节点:
  - `capacity`/`personnelCapacity`/`equipmentCapacity` → 资源池容量
  - `inventory`(发动机备件/航电模块/液压备件)→ 初始备件库存
  - `transportPolicies`(from/to/transportMode/transportTimeHours/priority/capacity)→ 驱动横向/纵向运输:carrier-stock→carrier-deck 纵向补给(1h)、carrier-deck→forward-sea-base 横向调拨(2h)、carrier-deck→carrier-stock 返修(3h)
  - `lateralSupportNodes` → 横向支援可达图
  - `policy`/`organizationStrategy` → 驱动短缺时补货决策(优先高优先级任务 / 临界库存触发)
- `supportOrganization.tree` → 当前为空,保留为元数据,接口预留

### 保障活动 → `activity_planner.py`
- `supportActivities`(preflight / corrective / preventive / logistics-support)4 个活动:
  - `jobs`(每个活动含多个作业节点,如 OPS-001 机务检查→OPS-002 燃油加注):按 `predecessors` 构 DAG,拓扑排序调度
  - `durationProfile`(三角/均匀/正态/固定值/对数正态)→ 每次执行按分布采样实际工时
  - `personnel`/`servicePersonnel`/`facility`/`equipment`/`spare` → 资源占用与备件消耗
  - `durationHours`/`requiredPersonnel`/`requiredDevices`/`spareQuantity`/`priority` → 活动级约束
  - `corrective` 的 `repairDistribution`(对数正态 mu=5.1,sigma=0.35)/`repairTypes`(换件修复/功能复测)→ 修复性维修工时采样
  - `preventive` 的 `calendarDayInterval`/`runHourInterval`/`takeoffLandingInterval` 及 `floatRatio` → 预防性维修触发规则(按日历/飞行小时/起落次数,带浮动比例)

### 可靠性框图 → `reliability.py`
- `reliabilityBlockDiagram.nodes`(aircraft / engine / avionics / hydraulic)+ `edges`:按 `connectionType`(串联→概率相乘 / 并联→1-∏(1-p) / 备用→带切换冗余)计算系统级可靠度,作为飞机能否进入"任务就绪"的判定依据之一

### Monte Carlo → `monte_carlo.py`
- `monteCarlo`(failureRates[3] × spareMultipliers[3] × supportCapacities[3] = 27 组合)→ sweep 参数网格
- `analysisRequests.largeSample`(samples=24)→ 每组 24 个样本
- `experiment`(seed=20260621, parallelCores=4, stopCondition)→ 单次运行配置;parallelCores 驱动 sweep 并行

### 其他字段
- `airports`(航母甲板/前出海上保障点 distanceToMissionKm)→ 驱动任务往返时长
- `missionAreas`(近海制空/远海警戒 patrolRadiusKm/threatLevel)→ 任务环境元数据,影响故障率乘子(高威胁区放大)
- `projectInfo`/`source`/`lifecycle`/`changes`/`validation` → 治理元数据,写入输出结果头但不影响仿真行为

## 仿真动力学

### Agent 设计
- `AircraftAgent(Agent)`:每架飞机一个 agent,持有:
  - 标识:tail_number(J15-101 等)、aircraft_type(J-15/J-35)、index、deploymentLocation
  - 历史状态:remainingLifeHours、takeoffLandingCount(来自 combatUnit.members)
  - 动态状态:phase(idle/preparing/sortie/ready 等来自 missionPhases)、current_mission_id、scheduled_return_time
  - 装备树快照:由 `equipment.py` 构建的 systems 树(含每个 LRU 当前 health、累计运行小时、故障次数)
  - failed_lru:当前故障件引用
- 不设其他 Agent 类(保障点/活动作业作为领域模块内的数据对象,被调度资源,不具备自主 step 行为)

### step 循环
```
step():
  1. mission_scheduler.advance(sim_time)       # 按周编排选今日 compositeTask,按 firstWaveTime 触发波次
  2. return_due_aircraft()                     # 到 return_time 的飞机返航,采样故障,进入 post_support
  3. launch_due_missions()                     # 达到 planned_start 且 mission_ready 足够的波次起飞;不足 delayed,超 cancelMinutes 取消
  4. equipment.age_and_fail(aircraft, tick)    # 按各自分布采样故障;kOutOfN 冗余判定;lifeLimit 到期停飞
  5. activity_planner.dispatch(aircraft)       # 需保障飞机按活动类型创建 ActivityJob,按 predecessors DAG 排序
  6. support_network.allocate_and_advance(jobs)# 作业按 priority 排队,检查资源,占用推进;完成释放、消耗备件
  7. support_network.run_transport(sim_time)   # 在途补给到达;触发临界库存补货订单
  8. preventive_maintenance_check()            # 检查定检触发条件(日历/飞行小时/起落,带 floatRatio)
  9. reliability.evaluate(aircraft)            # 按可靠性框图计算系统级可靠度,影响 mission_ready 判定
 10. sim_time += tick_minutes; steps_run++
 11. sample frame if needed
```

### 关键动力学细节
- **故障采样**:`failureModel=随机` 用指数 `P(fail)=1-e^(-λΔt)`;`退化` 用 Weibull `F(t)=1-e^(-(t/η)^β)` 累积概率反演;`寿命` 用正态按剩余寿命分位。故障后按 `specialRepairProfile.repairRatio/replacementRatio` 决定修复(消耗工时)还是换件(消耗备件)
- **kOutOfN**:带 `enabled=true` 的 SRU 累计 k 个子 LRU 故障才判定 SRU 失效,影响 `reliability.evaluate`
- **保障作业 DAG**:用 networkx DiGraph,按 `predecessors` 拓扑排序,前序完成才启动后序;每作业 `durationProfile` 每次执行重新采样
- **运输补给**:库存触发 `criticalInventory` 阈值 → 在途订单(`due_time = sim_time + transportTimeHours`),到点增加目标库存;`triggerMode=周期性调运` 按周期触发横向调拨
- **预防性维修**:三条规则独立判定(日历/飞行小时/起落,各带 floatRatio 浮动),任一触发即生成定检作业
- **任务就绪判定**:需同时满足:无 failed_lru、`reliability.evaluate` 可靠度达标、`remainingLifeHours > preLifeRequirementHours(120)`、装备树无 lifeLimit 超期
- **威胁区影响**:`threatLevel=高` 对进入该区飞机 `lru_failure_multiplier` 放大(×1.3),`中` 放大(×1.1)

### 时间步与采样(可调)
- `tick_minutes` = `missionProfile.durationHours × 60 ÷ steps`,由 `--steps` 决定;若 steps > 总时长分钟数则 tick 缩到 1min
- 帧采样:`--sample-every N`(每 N tick 采一帧),始终保留首帧与末帧
- `run_single.py` 暴露 `--steps`、`--sample-every`、`--seed`
- `run_sweep.py` 支持 `--sample-every`,sweep 模式默认只存每组最终指标(帧太大),`--keep-frames` 保留每组末帧

### 产出
- 单场景:`output/single-run/frames.json`(每 N tick 的 visualization_state)+ `metrics.json`(出动完成率/延误率/取消率/备件满足率/资源利用率/LRU 故障数/修复 vs 换件比)
- sweep:`output/sweep/results.json`(27 组合 × 24 样本的指标均值/方差/分位数)

## 错误处理
- import package 加载时用 `modeling_import.validate_modeling_import_package()` 前置校验;失败报错退出
- 故障分布参数缺失:回退保守默认(指数 λ=mtbf 倒数 / Weibull β=2,η=mtbf / 正态 σ=mtbf×0.1),记 warning 到事件日志
- 资源/备件不足:作业排队等待,超 `max_departure_delay` 阈值则任务取消并记日志
- 运输订单目标节点不存在:跳过并记 warning
- DAG 存在环:启动时 networkx 检测,有环报错退出
- sweep 单样本异常:捕获记入该组 `failed_samples`,不中断整组

## 测试策略
- pytest,放在 `independent-mesa/tests/`,用 `.abm-mesa-test-env/bin/python -m pytest` 运行
- `test_equipment.py`:各分布采样器固定 seed 稳定、kOutOfN 冗余判定、lifeLimit 停飞、repairRatio/replacementRatio 分流
- `test_mission_scheduler.py`:周编排按 weekday 选对 compositeTask、波次时间轴、cancelMinutes 超时取消
- `test_activity_planner.py`:DAG 拓扑排序、predecessors 约束、durationProfile 采样区间合法
- `test_support_network.py`:三级节点库存增减、横向/纵向运输在途到达、临界库存触发补货、资源池占用/释放
- `test_reliability.py`:串联/并联/备用三种 connectionType 的可靠度计算
- `test_monte_carlo.py`:sweep 参数组合数 = 27、单样本跑通、异常隔离
- `test_model_integration.py`:端到端跑通,断言出动完成率在 [0,1]、备件消耗非负、无飞机状态非法;固定 seed 可复现

## 运行命令
```
# 单场景
.abm-mesa-test-env/bin/python run_single.py --steps 48 --sample-every 4 --seed 20260621

# Monte Carlo sweep
.abm-mesa-test-env/bin/python run_sweep.py --sample-every 4 --keep-frames

# 测试
.abm-mesa-test-env/bin/python -m pytest independent-mesa/tests/
```
