import { FEATURE_PAGES } from "./feature-catalog.mjs";
import { defaultScenario } from "./sim-engine.mjs";

const OBJECT_LABELS = {
  scenarioId: "场景编号",
  activeModule: "当前模块",
  airports: "机场",
  missionAreas: "任务区",
  experiment: "实验方案",
  missionProfile: "任务剖面",
  basicMission: "基本任务",
  missionPhases: "任务阶段",
  combatUnit: "基本作战单元",
  equipment: "装备",
  components: "组件",
  supportNodes: "保障节点",
  spares: "备件",
  resources: "保障资源",
  supportActivities: "保障活动",
  reliabilityBlockDiagram: "可靠性框图",
  visualizationState: "可视化状态",
  runs: "运行记录",
  summary: "汇总结果",
  decisionOutputs: "决策输出"
};

const EXCLUDED_PROJECT_OBJECT_ROOTS = new Set(["equipment", "monteCarlo"]);

export const PROJECT_JSON_CONTRACT = buildProjectJsonContract(defaultScenario, FEATURE_PAGES);

export function buildProjectJsonContract(projectJson = defaultScenario, featurePages = FEATURE_PAGES) {
  const objects = new Map();
  const fields = [];

  for (const [key, value] of Object.entries(projectJson || {})) {
    if (isExcludedProjectObjectPath(key)) continue;
    registerObject(objects, key, value);
    collectFields(value, key, fields, objects);
  }

  for (const page of featurePages) {
    for (const dataObject of page.dataObjects || []) {
      const path = contractObjectPath(dataObject);
      if (isExcludedProjectObjectPath(path)) continue;
      if (!objects.has(path)) {
        registerObject(objects, path, undefined);
      }
    }
  }

  const objectList = [...objects.values()].map((item) => ({
    ...item,
    fieldPaths: fields
      .filter((field) => field.path === item.path || field.path.startsWith(`${item.path}.`))
      .map((field) => field.path)
  }));

  return {
    schemaVersion: "frontend-project-json-v0",
    source: "front/sim-engine.mjs:defaultScenario",
    objects: objectList,
    fields
  };
}

export function contractObjectPath(dataObjectPath) {
  return String(dataObjectPath || "scenario").split(".")[0];
}

function isExcludedProjectObjectPath(path) {
  return EXCLUDED_PROJECT_OBJECT_ROOTS.has(String(path || "").split(".")[0]);
}

function collectFields(value, path, fields, objects) {
  if (Array.isArray(value)) {
    if (value.length > 0 && isPlainObject(value[0])) {
      collectFields(value[0], path, fields, objects);
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (isPlainObject(childValue) || Array.isArray(childValue)) {
        registerObject(objects, childPath, childValue);
        collectFields(childValue, childPath, fields, objects);
      } else {
        fields.push({
          path: childPath,
          type: valueType(childValue),
          required: childValue !== null && childValue !== undefined
        });
      }
    }
    return;
  }

  fields.push({
    path,
    type: valueType(value),
    required: value !== null && value !== undefined
  });
}

function registerObject(objects, path, value) {
  if (!path || objects.has(path)) return;
  objects.set(path, {
    path,
    label: OBJECT_LABELS[path] || OBJECT_LABELS[path.split(".")[0]] || humanizePath(path),
    type: Array.isArray(value) ? "array" : isPlainObject(value) ? "object" : value === undefined ? "declared" : valueType(value),
    required: value !== undefined,
    source: value === undefined ? "feature-catalog:dataObjects" : "defaultScenario"
  });
}

function valueType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function humanizePath(path) {
  return path
    .split(".")
    .at(-1)
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase());
}
