export const DEFAULT_CURRENT_MONTE_CARLO_SETTINGS = Object.freeze({
  samples: 4,
  parallelCores: 4,
  seed: 20260621
});

export const DEFAULT_VISUALIZATION_SESSION_SETTINGS = Object.freeze({
  seed: 20260621,
  frameSampleEverySteps: 1,
  playbackSpeed: 1
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonemptyText(value) {
  return String(value || "").trim();
}

export function experimentPlanFingerprint(plan) {
  const config = isRecord(plan?.config) ? plan.config : {};
  return nonemptyText(
    plan?.canonical_fingerprint
    || plan?.canonicalFingerprint
    || plan?.plan_fingerprint
    || plan?.planFingerprint
    || plan?.fingerprint
    || config.planFingerprint
    || config.plan_fingerprint
    || config.fingerprint
  );
}

export function isRunnableFrozenExperimentPlan(plan) {
  const config = isRecord(plan?.config) ? plan.config : {};
  return nonemptyText(plan?.status).toLowerCase() === "frozen"
    && Boolean(nonemptyText(plan?.experiment_plan_id))
    && isRecord(config.projectJson)
    && Boolean(experimentPlanFingerprint(plan));
}

export function buildRunContextOptions({
  projectId,
  projectName,
  projectJson,
  plans = [],
  module = ""
}) {
  const normalizedProjectId = nonemptyText(projectId);
  const currentProjectOption = {
    key: `current-project:${normalizedProjectId || "none"}`,
    name: `当前项目：${nonemptyText(projectName) || "未选择项目"}`,
    kind: "current-project",
    projectId: normalizedProjectId,
    projectJson: isRecord(projectJson) ? projectJson : {},
    plan: null,
    module
  };
  const frozenPlanOptions = plans
    .filter(isRunnableFrozenExperimentPlan)
    .map((plan) => {
      const config = plan.config;
      const experimentPlanId = nonemptyText(plan.experiment_plan_id);
      return {
        key: experimentPlanId,
        name: nonemptyText(config.name) || experimentPlanId,
        kind: "experiment-plan",
        projectId: normalizedProjectId,
        experimentPlanId,
        planFingerprint: experimentPlanFingerprint(plan),
        projectJson: config.projectJson,
        plan,
        module
      };
    });
  return [currentProjectOption, ...frozenPlanOptions];
}

export function buildBackendRunContext(context) {
  if (context?.kind === "current-project") {
    if (!isRecord(context.projectJson)) throw new Error("当前项目运行上下文缺少 Project draft");
    return {
      kind: "current_project",
      project: context.projectJson
    };
  }
  if (context?.kind === "experiment-plan") {
    const projectId = nonemptyText(context.projectId);
    const experimentPlanId = nonemptyText(context.experimentPlanId || context.plan?.experiment_plan_id || context.key);
    const planFingerprint = nonemptyText(context.planFingerprint || experimentPlanFingerprint(context.plan));
    if (!projectId || !experimentPlanId) throw new Error("冻结方案运行上下文缺少项目或方案标识");
    return {
      kind: "frozen_plan",
      projectId,
      experimentPlanId,
      ...(planFingerprint ? { planFingerprint } : {})
    };
  }
  throw new Error("未选择有效的运行上下文");
}

function strictInteger(value, label, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") {
    throw new Error(`冻结方案缺少${label}`);
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(`冻结方案${label}必须是 ${min}-${max} 之间的整数`);
  }
  return numeric;
}

export function frozenMonteCarloSettings(context) {
  if (context?.kind !== "experiment-plan") {
    throw new Error("当前运行上下文不是冻结方案");
  }
  const config = isRecord(context.plan?.config) ? context.plan.config : {};
  return {
    samples: strictInteger(config.samples, "样本数", { min: 1, max: 1000 }),
    parallelCores: strictInteger(config.parallelCores, "并行核心数", { min: 1, max: 32 }),
    seed: strictInteger(config.seed, "随机种子", { min: 0, max: 4294967295 })
  };
}

export function monteCarloSettingsForContext(context, currentSettings = DEFAULT_CURRENT_MONTE_CARLO_SETTINGS) {
  if (context?.kind === "experiment-plan") return frozenMonteCarloSettings(context);
  return {
    samples: strictInteger(currentSettings.samples, "样本数", { min: 1, max: 1000 }),
    parallelCores: strictInteger(currentSettings.parallelCores, "并行核心数", { min: 1, max: 32 }),
    seed: strictInteger(currentSettings.seed, "随机种子", { min: 0, max: 4294967295 })
  };
}

export function buildVisualizationSessionRequest(context, settings = DEFAULT_VISUALIZATION_SESSION_SETTINGS) {
  return {
    context: buildBackendRunContext(context),
    seed: strictInteger(settings.seed, "随机种子", { min: 0, max: 4294967295 }),
    frameSampleEverySteps: strictInteger(settings.frameSampleEverySteps, "帧采样间隔", { min: 1, max: 1000000 }),
    playbackSpeed: Number(settings.playbackSpeed) > 0 ? Number(settings.playbackSpeed) : 1
  };
}

export function shouldInvalidateVisualizationSession(field) {
  return field === "context" || field === "seed" || field === "frameSampleEverySteps";
}

export function stableRunContextFingerprint(context) {
  return stableStringify(buildBackendRunContext(context));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
