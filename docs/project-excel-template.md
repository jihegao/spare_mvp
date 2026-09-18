# Project Excel 标准模板

项目数据管理提供“下载 Excel 模板”，保留 JSON 上传及旧 Project-sheet Excel 导入，并支持拖入 `.xlsx` 预览。下载入口为 `GET /api/projects/excel-template`，限定系统管理员/数据管理员。文件名为 `Project标准模板-v1.xlsx`，示例来自受审 `exports/project-case-large.json`，经过 `ProjectJsonExporter` 和 `SimulationAdapter.compile_scenario_with_gate` 后生成，不使用本地数据库或用户案例。

## 字段与工作表

工作簿先列填写说明、字段说明和项目身份，再按任务、装备、保障组织、保障活动排列。全部子表由 clean Project schema 的属性、引用和数组结构生成，当前为 70 个数据子表。字段说明包含所有映射字段的类型、必填/条件要求、枚举、单位/范围和 ID 引用说明。新增 schema 字段会自动进入映射；未约定的根字段不能被 exporter 静默裁掉后通过预览。

对象的直接字段作为列；嵌套对象和数组拆成子表，通过工作簿内部“记录ID/父记录ID”关联，数组“顺序”从 0 连续编号。业务 `id`、`productId`、任务引用与前驱 DAG 仍按稳定业务 ID 填写，不用显示名称猜测关联。

`@object`、`@array` 标记已存在的对象/数组，子项在子表填写；保留标记而无子项表示空对象/空数组。开放字典和递归更深层结构在“扩展字段”表逐项表达，父记录指向对象，字段或序号指向成员，节点类型明确区分对象、数组和标量。无需在单元格编写 JSON。

空白代表字段缺省，`@empty` 代表空文本，`@null` 代表 null；以 `@`、`~` 或 `=` 开头的原文加 `~` 前缀。布尔值、普通数量保持 Excel 原生类型。超过 Excel 有效位数的数字使用 `@integer:`/`@number:` 保真标记。超过单元格文本容量（包括转义前缀）或非有限数值直接报错，不能静默截断。扩展字段的对象键允许空字符串及以 `=` 开头的字面量；空字符串键在“字段或序号”列留空，真正公式单元格仍会被拒绝。对象/数组节点的“值”列必须留空，避免填写内容被忽略。

## 预览、确认与兼容

工作簿协议是 `project-xlsx-v1`，填写说明记录 clean schema 指纹。不支持的版本/字段指纹、缺表/缺列、未知表、重复记录 ID、缺父记录、数组顺序断裂、损坏文件、公式、文件/解压/行列/单元格超限都会阻断导入。字段改变后须重新下载模板迁移；旧 `Project` sheet + 根数组 sheet 格式仍走原有解析器，复杂 JSON 单元格仅作为历史兼容。

上传预览不写入项目。解析结果经过 Project schema、关系检查、`ProjectJsonExporter(target="aircraft_support_v1")` 和公开 `SimulationAdapter.compile_scenario_with_gate`。成功响应显示模板版本、对象数量及 `compile_status=compiled`；失败显示 sheet、行、列、字段路径、原因和引用值，确认按钮禁用。

确认仍使用现有覆盖/新建 API，保持权限、版本冲突、create-only、审计边界。项目身份/版本在“新建”操作时按现有规则重建。Excel 层只负责 Project 编解码，没有新增 Project-to-model 编译器。

## 验证

`tests/test_project_xlsx_template.py::canonical_complete_project` 是确定性完整夹具生成器：基于受审大案例，经 exporter 输出四域及多层组织、任务引用、资源需求、前驱 DAG，并补充中文、CR/LF/TAB、空值、布尔值、0、高精度数据。真实 OOXML 往返后逐值相等，clean Project 再编译，并校验 canonical `simulation_inputs` schema。共享写出器对 XML 原始 CR 编码为 `&#13;`，在有/无 lxml 的 openpyxl 环境均不丢失回车。

自动化覆盖模板字段完整性、输入异常定位、预览零写入、公有 compiler gate、HTTP 鉴权/下载/预览/新建冲突和浏览器运行时下载/拖放/确认。真实浏览器的下载、上传、新建/覆盖应使用同一生成文件验证；自动化 codec 测试不替代 Excel/WPS/LibreOffice 原生打开和目标 Windows 业务验收。
