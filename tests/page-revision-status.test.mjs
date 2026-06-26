import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PAGE_REVISION_REPORT_URL = new URL("../reports/2026-06-19-page-revision-suggestions/README.md", import.meta.url);
const IMPORTED_SAMPLE_REPORT_URL = new URL("../reports/2026-06-21-imported-sample-debug/README.md", import.meta.url);
const FRONT_APP_URL = new URL("../front/app.js", import.meta.url);

test("6/19 page revision report marks each item with repair status and test evidence", async () => {
  const report = await readFile(PAGE_REVISION_REPORT_URL, "utf8");
  assert.match(report, /## 2026-06-21 状态审计/);

  for (let index = 1; index <= 18; index += 1) {
    assert.match(report, new RegExp(`\\| ${index} \\|`), `missing status row for item ${index}`);
  }

  assert.match(report, /\| 1 \| 项目列表页 \| Fixed locally \|/);
  assert.match(report, /\| 6 \| 建模表单管理 \| Closed by decision \|/);
  assert.match(report, /\| 9 \| 复合任务建模 \| Fixed locally \|/);
  assert.match(report, /保障活动图 \/ Gantt chart/);
  assert.match(report, /飞机节点可点击，可新增叶子节点/);
  assert.match(report, /工作项目清单按装备构型叶子节点隔离/);
  assert.match(report, /\| 18 \| 后勤保障活动建模 \| Fixed locally \|/);
  assert.match(report, /tests\/frontend-contract\.test\.mjs/);
  assert.match(report, /tests\/equipment-tree-model\.test\.mjs/);
  assert.match(report, /tests\/page-revision-status\.test\.mjs/);
});

test("6/19 open or partial items are represented in today's imported-sample defect report", async () => {
  const report = await readFile(IMPORTED_SAMPLE_REPORT_URL, "utf8");
  const expectedHeadings = [
    "### 10. Composite task timeline merges same basic task across different formations",
    "### 11. Composite task basic-task rows cannot edit required and minimum equipment quantities",
    "### 12. Basic mission support activity should be a single-select sourced from same-aircraft operations support plans",
    "### 13. Operations support activity tree lacks imported plan-name hierarchy and auto-created phase nodes",
    "### 14. Preventive maintenance activity tree includes work-item names below the activity leaf",
    "### 15. Corrective maintenance equipment configuration tree cannot select equipment components",
    "### 16. Support resource lists cannot add or edit resources, and spare names/models are not sourced from LRU components",
    "### 17. Support activity job-list edit buttons do not open editors",
    "### 18. Support organization details remain read-only and tree add/delete constraints are incomplete"
  ];

  for (const heading of expectedHeadings) {
    assert.match(report, new RegExp(escapeRegExp(heading)));
  }
});

test("page revision #9 composite timeline splits same basic task by formation", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /const groupName = row\.groupName \|\| "未指定编队";/);
  assert.match(source, /const key = `\$\{taskName\} \/ \$\{groupName\}`;/);
});

test("page revision #9 composite task item quantities are editable per task item", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /taskItems\.\$\{index\}\.equipmentQuantity/);
  assert.doesNotMatch(source, /taskItems\.\$\{index\}\.requiredEquipmentQuantity/);
  assert.match(source, /taskItems\.\$\{index\}\.minRequiredSystems/);
  assert.match(source, /taskItems\.\$\{index\}\.equipmentType/);
  assert.doesNotMatch(source, /<td><input readonly value="\$\{htmlEscape\(basicTask\?\.equipmentType/);
});

test("page revision #8 basic mission support activity is a same-aircraft single select", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /supportActivityPlanSelect\(`\$\{missionPath\}\.supportActivityName`, selectedMission\.task\?\.equipmentType\)/);
  assert.match(source, /function operationsSupportActivityOptions\(aircraftModel = ""\)/);
  assert.match(source, /supportActivityAircraftModel\(activity\) === targetModel/);
});

test("page revision #15 operations support activity tree stops at activity-plan leaf", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /data-select-support-activity-plan/);
  assert.match(source, /data-support-activity-plan-add/);
  assert.match(source, /data-support-activity-gantt/);
  assert.match(source, /function buildSupportActivityGanttRows/);
  assert.doesNotMatch(source, /const phaseNames = \["飞行前准备", "再次出动准备", "飞行后检查"\];/);
  assert.match(source, /id: `operations-plan:\$\{model\}:\$\{option\.value\}`/);
});

test("page revision #16 preventive maintenance tree stops at activity leaf", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /data-select-preventive-aircraft-model/);
  assert.match(source, /data-select-preventive-activity-plan/);
  assert.match(source, /data-preventive-activity-plan-add/);
  assert.match(source, /data-preventive-activity-plan-delete/);
  assert.match(source, /function addPreventiveMaintenanceActivityPlan\(\)/);
  assert.match(source, /function deletePreventiveMaintenanceActivityPlan/);
  assert.doesNotMatch(source, /children: type\.includes\("预防性"\) \? \[\] : supportActivityJobs/);
});

test("page revision #17 corrective maintenance equipment config tree selects components", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /data-select-corrective-component/);
  assert.match(source, /selectedCorrectiveComponentId === componentId/);
  assert.match(source, /function selectedCorrectiveComponent\(\)/);
  assert.match(source, /function correctiveMaintenanceActivityForComponent/);
  assert.match(source, /function ensureCorrectiveMaintenanceActivityForComponent/);
  assert.match(source, /renderSupportActivityJobTable\(componentActivity, "corr_repair"\)/);
  assert.doesNotMatch(source, /renderSupportActivityJobTable\(activity, "corr_repair"\)/);
});

test("page revision #11-13 support resource lists add/edit and derive spares from LRU components", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /data-support-resource-add/);
  assert.match(source, /function addSupportResource\(activeResourceType\)/);
  assert.match(source, /function lruSpareRows\(\)/);
  assert.match(source, /component\.productType === "LRU" \|\| component\.spareType === "LRU"/);
});

test("page revision #15-17 support activity job-list edit buttons open editors", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /function renderSupportActivityJobEditor\(selectedJob\)/);
  assert.match(source, /data-support-activity-job-field/);
  assert.match(source, /function updateSupportActivityJobField\(key, fieldName, value\)/);
});

test("page revision #10 support organization details are editable with add/delete and depth constraints", async () => {
  const source = await readFile(FRONT_APP_URL, "utf8");
  assert.match(source, /data-support-org-add-node/);
  assert.match(source, /data-support-org-delete-node/);
  assert.match(source, /function supportOrgNodeDepth\(id, nodes = supportOrganizationTree\(\), depth = 1\)/);
  assert.match(source, /data-support-org-field="name"/);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
