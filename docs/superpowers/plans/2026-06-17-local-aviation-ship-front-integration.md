# 本地航空保障与 ship_front 前端集成记录

日期：2026-06-17  
当前状态更新：2026-06-18

## 目标

将航空保障 Mesa 场景包和 `ship_front` / `备件_front` 参考原型纳入本仓库，并把 `spare_mvp` 前端改造成可登录、可选项目、可按四级功能进入的静态工作台。

## 当前实现状态

已完成：

1. 本地保存航空保障 Mesa 场景包，位置为 `src/spare_mvp_abm/aviation_support/`。
2. 本地保存 `ship_front` 和 `备件_front` 参考原型，位置为 `vendor/ship_front/` 和 `vendor/ship_front/备件_front/`。
3. 前端从旧的少量静态视图改为登录页、项目列表页、功能工作台和四级功能页面。
4. 登录后的默认着陆页是项目列表；从项目列表进入当前项目后进入仿真实验方案列表。
5. 非建模页面右上角显示当前方案名称，点击可回到对应模块的方案列表。
6. 仿真建模页面不显示右上角“当前方案”卡片；仿真建模和仿真实验页面不再显示“xxx入口”框，四级功能通过紧凑中文标签切换。
7. 可视化推演页面只保留一个可导航入口，直接嵌入 Mesa 航空保障可视化状态，不再显示外层“可视化实验启动与停止”标题和外层四级导航；旧的场景切换、结果展示 hash 兼容回流到可视化推演。
8. `仿真实验方案管理` 已包含 `方案列表` 和 `方案编辑`。
9. `保障组织建模` 已对齐 `vendor/ship_front` 的组织树、资源表和编辑面板。
10. `保障活动建模` 已对齐 `vendor/ship_front` 的活动方案、作业清单和网络图形态。
11. 两个模块的结果分析页面已对齐 `vendor/ship_front/备件_front` 的四个分析页形态。
12. Monte Carlo 配置页只保留参数配置和“启动”；启动后回方案列表并把当前方案状态置为“运行中”。
13. Monte Carlo 评估结果已经移动到 `结果分析 / 蒙特卡洛实验结果展示`。
14. Monte Carlo 扫参输入已真实绑定 `scenario.monteCarlo`，修改故障率、备件倍数和保障容量后会重算分组结果。
15. Ontology Playground 导出关系 ID 已加唯一性测试，重复关系已清理。
16. 页面侧 `Ontology 上下文` 面板和独立 ontology 可视化路由已经移除；项目级 ontology 关系图现在嵌入 `可视化推演` 的 Mesa 页面内部，通过 `Ontology视图` 标签展示，侧栏按建模对象、仿真实验、计算产物三层汇总节点数量。

## 主要文件

| 文件或目录 | 说明 |
| --- | --- |
| `front/feature-catalog.mjs` | 四级功能清单、导航归属和页面元数据。 |
| `front/app.js` | 静态工作台渲染、页面交互、Monte Carlo 配置和结果页。 |
| `front/styles.css` | 工作台、建模页、分析页和 Monte Carlo 页样式。 |
| `front/aviation-support-state.mjs` | 将 Mesa 可视化状态规范化为前端可渲染数据。 |
| `front/sim-engine.mjs` | 浏览器内单次仿真和 Monte Carlo 汇总逻辑。 |
| `front/ontology-context.mjs` | 项目级 ontology 定义、页面 focus context 构造辅助和 Ontology Playground 导出形态；当前可见图谱由 Mesa `Ontology视图` 消费，不再作为每个四级页面的右侧上下文面板。 |
| `src/spare_mvp_abm/aviation_support/` | 本地航空保障 Mesa 场景包。 |
| `vendor/ship_front/` | 舰载保障前端参考快照。 |
| `tests/frontend-contract.test.mjs` | 前端结构、页面流转和契约断言。 |
| `tests/sim-engine.test.mjs` | 仿真引擎和 Monte Carlo 结果断言。 |

## 验收证据

当前验证命令：

```bash
npm test
```

当前测试覆盖：

1. 四级功能目录数量、唯一 ID 和导航层级。
2. 登录后项目列表着陆页和方案名称回跳。
3. 结果分析四个页面的对齐结构。
4. 保障组织建模、保障活动建模的 ship_front 风格结构。
5. 可视化推演直嵌 Mesa 页面。
6. Monte Carlo 配置页只保留参数和启动动作。
7. Monte Carlo 扫参输入更新场景数组并重算结果。
8. Monte Carlo 结果页显示分组评估结果。
9. Ontology Playground 关系 ID 唯一。
10. 页面侧上下文面板和独立 ontology 路由已经移除。
11. 可视化推演页面嵌入 Mesa 飞机、任务、保障和 `Ontology视图`。
12. 用户可编辑文本进入模板前进行 HTML 转义。

## 浏览器验证口径

本地启动：

```bash
python3 -m http.server 4173
```

访问：

```text
http://127.0.0.1:4173/front/
```

建议检查：

1. 登录后先进入项目列表。
2. 进入当前项目后默认显示仿真实验方案列表。
3. 从左侧导航进入 `蒙特卡洛实验`。
4. 修改故障率扫描、备件倍数和保障容量。
5. 进入 `结果分析 / 蒙特卡洛实验结果展示`，确认参数组来自新输入。
6. 回到 Monte Carlo 配置页点击“启动”，确认回到方案列表且状态为“运行中”。
7. 进入 `可视化推演`，切换到 `Ontology视图`，确认页面显示项目级 ontology 关系图和三层节点汇总，而不是独立 ontology 页面或每个四级页面的右侧上下文面板。

## 文档维护复盘

本记录曾只更新了 Monte Carlo、结果分析和可视化入口状态，没有同步说明 ontology 表达方式已经从“每页右侧上下文图”收敛为“Mesa 内部项目级 Ontology视图”。根因不是代码缺少测试，而是文档约定只要求“同步更新相关文档”，没有形成可执行检查点：

1. `tests/frontend-contract.test.mjs` 已经断言页面侧上下文面板被移除、独立 ontology 路由被移除、Mesa 页面嵌入 `Ontology视图`。
2. 设计规格和实现记录没有被同一轮搜索并更新，导致文档仍容易让读者以为每个四级页面都有右侧 ontology 上下文面板。
3. 后续凡是测试中出现 `doesNotMatch` 删除旧 UI、移除路由、迁移入口或改变结果来源，必须同时搜索并更新 `README.md`、`docs/README.md`、对应设计规格和实现记录里的旧入口、旧标题、旧区域名。

## 边界

1. 当前仍是静态前端原型，状态保存在浏览器内存中，没有后端持久化。
2. Mesa 和浏览器内仿真用于说明规则和页面流转，不代表校准后的工程级仿真平台。
3. `vendor/` 目录只作为本地参考快照，运行时代码不得直接依赖外部原型路径。
4. 大样本并行调度、权限系统、真实任务队列和工程级校准不在当前切片内。
