# 备件规划与任务可靠度验证评估平台原型

本仓库当前是基于 `docs/3概要设计方案.docx` 重构出的 Ontology + Mesa ABM + 静态前端原型。当前开发分支已经包含登录、项目列表着陆页、四级功能导航、Mesa 可视化嵌入、蒙特卡洛扫参与结果分析页、以及 ship_front / 备件_front 对齐页面。

## 项目文档入口

统一文档入口见 [`docs/README.md`](docs/README.md)。常用文档：

- [`docs/3概要设计方案.md`](docs/3概要设计方案.md)：原始概要设计的 Markdown 转换稿。
- [`docs/ontology-mesa-rebuild-plan.md`](docs/ontology-mesa-rebuild-plan.md)：Ontology + Mesa 重构边界和当前状态。
- [`docs/superpowers/specs/2026-06-17-four-level-function-page-design.md`](docs/superpowers/specs/2026-06-17-four-level-function-page-design.md)：四级功能页面化设计规格。
- [`docs/superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md`](docs/superpowers/plans/2026-06-17-local-aviation-ship-front-integration.md)：本轮前端集成实现记录。
- [`agent.md`](agent.md)：后续 agent 协作规则和 subagent 使用约定。

## 已覆盖范围

- 前端建模：任务剖面、基本任务、任务阶段、装备、组件、保障节点、保障活动字段。
- 可靠性框图：树状展示串联、并联、备用关系及组件故障参数。
- 保障活动建模：按保障节点展示飞行前保障、修复性维修、预防性维修、再次出动准备甘特图。
- 可视化仿真：单次仿真的任务态势、机场保障视图、指标和事件流。
- 蒙特卡洛实验：样本数、随机种子、故障率、备件倍数、保障容量扫参；配置页只保留参数和启动按钮，评估结果统一在“结果分析 / 蒙特卡洛实验结果展示”中查看。
- 结果分析：备件短板分析、飞机转场携行清单、飞机任务可靠性分析、停机因素分析。

## 本地运行

```bash
npm test
python3 -m http.server 4173
```

打开：

```text
http://127.0.0.1:4173/front/index.html
```

## 本体校验

```bash
python3 /Users/gaojihe/.codex/skills/ontology-mesa-modeling/scripts/normalize_ontology.py \
  --input ontology/spare_mvp.ontology.json \
  --output ontology/spare_mvp.normalized.json \
  --report ontology/spare_mvp.validation.json
```

当前本体包含 8 个实体、13 条关系、39 个属性，校验报告见 `ontology/spare_mvp.validation.json`。

## Mesa 烟测

需要 Python 3.10+。本机验证使用 Python 3.12 和 `mesa-abm-skill` runner：

```bash
/opt/homebrew/bin/python3.12 /Users/gaojihe/.codex/skills/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/model.py \
  --config scenarios/spare-planning-smoke/experiment.json \
  --output-dir runs/spare-planning-smoke/latest \
  --install-dir .abm-mesa-env

/opt/homebrew/bin/python3.12 /Users/gaojihe/.codex/skills/mesa-abm-skill/scripts/run_mesa_experiment.py \
  --model src/spare_mvp_abm/model.py \
  --config scenarios/mission-reliability-smoke/experiment.json \
  --output-dir runs/mission-reliability-smoke/latest \
  --install-dir .abm-mesa-env
```

`runs/` 下的原始 CSV/JSON 输出默认不提交；场景配置和模型代码是可复现实验入口。

## 边界

该原型是可交互、可运行的第一版，不是校准后的工程级仿真平台。小样本结果只能解释“在当前规则和参数下的模型行为”，不能直接声称真实最优方案。
