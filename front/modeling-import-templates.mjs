export const MODELING_IMPORT_TEMPLATES = [
  {
    id: "minimal-single-aircraft",
    label: "最小单机建模粒度",
    path: "/import-templates/minimal_single_aircraft.json"
  },
  {
    id: "canonical-platform-case",
    label: "平台标准案例",
    path: "/import-templates/canonical_platform_case.json"
  },
  {
    id: "max-granularity-multi-aircraft",
    label: "最大多机建模粒度",
    path: "/import-templates/max_granularity_multi_aircraft.json"
  }
];

export async function loadModelingImportTemplate(templateId = "canonical-platform-case", fetchJson = defaultFetchJson) {
  const template = MODELING_IMPORT_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`unknown modeling import template: ${templateId}`);
  }
  return fetchJson(template.path);
}

async function defaultFetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`failed to load modeling import template: ${response.status}`);
  }
  return response.json();
}
