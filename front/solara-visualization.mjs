export const DEFAULT_SOLARA_VISUALIZATION_URL = "http://127.0.0.1:8765";
export const SOLARA_VISUALIZATION_URL_STORAGE_KEY = "spare-mvp:solaraVisualizationUrl";

const VISUALIZATION_EVENT_TYPE_LABELS = {
  run_started: "推演开始",
  simulation_stopped: "推演结束",
  state_frame: "状态采样",
  mission_assigned: "任务成员分配",
  mission_started: "任务启动",
  mission_launched: "任务启动",
  mission_launch: "任务启动",
  mission_finished: "任务结束",
  mission_returned: "任务返场",
  mission_failed_returned: "任务故障返场",
  mission_failed_after_return: "任务返场后判定失败",
  mission_returned_with_component_failure: "任务返场后维修",
  mission_failed_minimum_aircraft: "任务失败",
  mission_cancelled: "任务取消",
  mission_success_point_succeeded: "任务判定成功",
  mission_success_point_failed: "任务判定失败",
  preflight_created: "飞行前保障创建",
  preflight_completed: "飞行前保障完成",
  postflight_completed: "航后保障完成",
  preventive_created: "预防性维修创建",
  preventive_completed: "预防性维修完成",
  job_started: "保障作业开始",
  support_started: "保障作业开始",
  support_job_preflight: "飞行前保障",
  support_job_postflight: "航后保障",
  support_job_repair: "修复性维修",
  support_job_preventive: "预防性维修",
  personnel_delay: "保障人员不足",
  equipment_shortage: "保障设备短缺",
  spare_shortage: "备件短缺",
  spare_consumed: "备件消耗",
  transport_dispatched: "备件调运",
  transport_arrived: "备件到达",
  transport_replenished: "备件补充",
  component_failed: "部件故障",
  aircraft_failed: "飞机故障",
  aircraft_failure: "飞机故障",
  repair_completed: "修复性维修完成",
  repair_finished: "修复性维修完成"
};

const VISUALIZATION_JOB_STATE_LABELS = {
  waiting: "等待中",
  queued: "排队中",
  pending: "待执行",
  running: "执行中",
  active: "执行中",
  blocked: "受阻",
  delayed: "延误",
  completed: "已完成",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消"
};

const VISUALIZATION_MISSION_STATUS_LABELS = {
  scheduled: "计划中",
  preparing: "准备中",
  ready: "待执行",
  launched: "执行中",
  flying: "执行中",
  delayed: "延误",
  completed: "已完成",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消"
};

const VISUALIZATION_SHORTAGE_REASON_LABELS = {
  personnel_capacity: "保障人员数量不足",
  equipment_capacity: "保障设备可用数量不足",
  in_transit: "所需备件正在调运途中",
  spare_shortage: "所需备件库存不足",
  equipment_shortage: "所需保障设备不足"
};

export function resolveSolaraVisualizationBaseUrl({
  locationRef = globalThis.location,
  storage = globalThis.localStorage
} = {}) {
  const fromSearch = queryValue(locationRef?.search || "", "solaraUrl");
  const fromHash = queryValue(hashQuery(locationRef?.hash || ""), "solaraUrl");
  const fromStorage = safeStorageGet(storage, SOLARA_VISUALIZATION_URL_STORAGE_KEY);
  const configuredUrl = fromSearch || fromHash || fromStorage;
  return normalizeSolaraVisualizationUrl(configuredUrl || managedSolaraVisualizationUrl(locationRef));
}

function managedSolaraVisualizationUrl(locationRef) {
  const hostname = String(locationRef?.hostname || "").trim();
  if (!hostname) return DEFAULT_SOLARA_VISUALIZATION_URL;
  const protocol = locationRef?.protocol === "https:" ? "https:" : "http:";
  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return `${protocol}//${host}:8765`;
}

export function buildSolaraVisualizationUrl(baseUrl, context = {}) {
  const normalizedBase = normalizeSolaraVisualizationUrl(baseUrl || DEFAULT_SOLARA_VISUALIZATION_URL);
  let url;
  try {
    url = new URL(normalizedBase);
  } catch {
    url = new URL(DEFAULT_SOLARA_VISUALIZATION_URL);
  }
  url.search = "";
  const visualizationSessionId = String(
    context.visualizationSessionId || context.visualization_session_id || ""
  ).trim();
  if (visualizationSessionId) {
    url.searchParams.set("visualization_session_id", visualizationSessionId);
  }
  const visualizationSessionToken = String(
    context.visualizationSessionToken || context.visualization_session_token || ""
  ).trim();
  if (visualizationSessionToken) {
    url.searchParams.set("visualization_session_token", visualizationSessionToken);
  }
  const playbackSpeed = Number(context.playbackSpeed ?? context.playback_speed);
  if (Number.isFinite(playbackSpeed) && playbackSpeed > 0) {
    url.searchParams.set("playback_speed", String(playbackSpeed));
  }
  return url.toString();
}

export function normalizeSolaraVisualizationUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return DEFAULT_SOLARA_VISUALIZATION_URL;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return DEFAULT_SOLARA_VISUALIZATION_URL;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SOLARA_VISUALIZATION_URL;
  }
}

export function visualizationEventTypeLabel(eventType) {
  const type = normalizedKey(eventType);
  if (VISUALIZATION_EVENT_TYPE_LABELS[type]) return VISUALIZATION_EVENT_TYPE_LABELS[type];
  if (type.includes("shortage")) return "保障资源短缺";
  if (type.includes("fail")) return "故障事件";
  if (type.includes("cancel")) return "任务取消";
  if (type.includes("mission") && (type.includes("launch") || type.includes("start"))) return "任务启动";
  if (type.includes("mission") && (type.includes("return") || type.includes("finish") || type.includes("complete"))) return "任务结束";
  if (type.includes("repair")) return "维修事件";
  if (type.includes("support") || type.includes("job")) return "保障作业";
  if (type.includes("transport") || type.includes("spare")) return "备件保障";
  return "仿真事件";
}

export function visualizationJobStateLabel(state) {
  return VISUALIZATION_JOB_STATE_LABELS[normalizedKey(state)] || "未知状态";
}

export function visualizationMissionStatusLabel(status) {
  return VISUALIZATION_MISSION_STATUS_LABELS[normalizedKey(status)] || "未知状态";
}

export function visualizationShortageReasonLabel(reason, { spareType = "" } = {}) {
  const normalized = String(reason || "").trim();
  if (!normalized) return "保障资源暂不可用";
  if (normalized.startsWith("spare:")) {
    const spare = normalized.slice("spare:".length) || spareType;
    return `${displayEntity(spare, "备件")}库存不足`;
  }
  return VISUALIZATION_SHORTAGE_REASON_LABELS[normalizedKey(normalized)] || "保障资源暂不可用";
}

export function localizeVisualizationEvent(event = {}) {
  const eventType = String(event.event_type || event.event || "");
  const details = event.details && typeof event.details === "object" ? event.details : {};
  const eventLabel = visualizationEventTypeLabel(eventType);
  const internalId = String(details.job_id || details.mission_id || event.mission_id || event.job_id || event.event_id || "");
  return {
    ...event,
    event_label: eventLabel,
    localized_message: localizedVisualizationEventMessage(eventType, event, details, eventLabel),
    internal_id: internalId
  };
}

function localizedVisualizationEventMessage(eventType, event, details, eventLabel) {
  const type = normalizedKey(eventType);
  const rawMessage = String(event.message || "");
  const identifiers = parseEventMessage(rawMessage);
  const aircraftId = details.tail_number || event.tail_number || identifiers.first;
  const resource = displayEntity(details.resource_name || details.resource_id || identifiers.last, "保障节点");
  const spare = displayEntity(details.spare_name || details.spare_type || identifiers.middle, "备件");
  const quantity = finiteDisplay(details.quantity ?? details.required_quantity ?? identifiers.quantity);
  const aircraftSuffix = identifierSuffix("飞机编号", aircraftId);
  const taskName = displayTaskName(details.task_name || details.basic_task_name || event.task_name);
  const taskPrefix = taskName ? `${taskName}：` : "";

  if (type === "run_started") return "推演已开始。";
  if (type === "simulation_stopped") return `推演已结束；停止条件：${stopReasonLabel(details.reason)}。`;
  if (type === "spare_shortage") return `${spare}库存不足，保障作业等待备件补给；保障节点：${resource}。`;
  if (type === "equipment_shortage") return `保障设备可用数量不足，保障作业等待设备；保障节点：${resource}。`;
  if (type === "personnel_delay") return `保障人员数量不足，保障作业等待人员；保障节点：${resource}。`;
  if (type === "job_started") return `保障作业已开始${identifiers.middle ? `：${displayEntity(identifiers.middle, "作业内容")}` : ""}。`;
  if (type === "spare_consumed") return `保障作业已消耗 ${quantity || "所需"} 件${spare}。`;
  if (type === "transport_dispatched") return `${quantity || "所需"} 件${spare}已发起调运。`;
  if (type === "transport_arrived") return `${quantity || "所需"} 件${spare}已到达${resource}。`;
  if (type === "transport_replenished") return `${quantity || "所需"} 件${spare}已完成库存补充。`;
  if (type === "component_failed") return `飞机发生部件故障${identifiers.last ? `：${displayEntity(identifiers.last, "故障部件")}` : ""}。${aircraftSuffix}`;
  if (type === "aircraft_failed" || type === "aircraft_failure") return `飞机故障已影响整机可用状态。${aircraftSuffix}`;
  if (type === "mission_failed_returned") return `飞机因故障提前返场并转入维修。${aircraftSuffix}`;
  if (type === "mission_failed_after_return") return `飞机返场后判定任务失败并转入维修。${aircraftSuffix}`;
  if (type === "mission_returned_with_component_failure") return `飞机返场后发现部件故障，已转入维修。${aircraftSuffix}`;
  if (type === "mission_returned") return `飞机已完成返场并进入航后保障。${aircraftSuffix}`;
  if (type === "mission_failed_minimum_aircraft") return `${taskPrefix}可用飞机数量低于最低要求，任务判定失败。`;
  if (type === "mission_launched" || type === "mission_started") return `${taskPrefix}任务已启动${quantity ? `，投入 ${quantity} 架飞机` : ""}。`;
  if (type === "mission_launch") return `任务已启动。${aircraftSuffix}`;
  if (type === "mission_cancelled") return `${taskPrefix}就绪飞机数量不足，任务已取消。`;
  if (type === "mission_success_point_succeeded") return `${taskPrefix}任务在成功判定点达到要求，判定成功。`;
  if (type === "mission_success_point_failed") return `${taskPrefix}任务在成功判定点未达到要求，判定失败。`;
  if (type === "preflight_created") return `${taskPrefix}已创建飞行前保障作业。`;
  if (type === "preflight_completed") return `飞机已完成飞行前保障。${aircraftSuffix}`;
  if (type === "postflight_completed") return `飞机已完成航后保障。${aircraftSuffix}`;
  if (type === "preventive_created") return `飞机已进入预防性维修。${aircraftSuffix}`;
  if (type === "preventive_completed") return `飞机已完成预防性维修并恢复可用。${aircraftSuffix}`;
  if (type === "repair_completed" || type === "repair_finished") return `飞机已完成修复性维修并恢复可用。${aircraftSuffix}`;
  if (type === "state_frame") return "已记录当前推演状态。";
  return `已记录${eventLabel}。`;
}

function parseEventMessage(message) {
  const tokens = String(message || "").trim().split(/\s+/).filter(Boolean);
  const quantity = tokens.find((token) => /^\d+(?:\.\d+)?$/.test(token)) || "";
  return {
    first: tokens[0] || "",
    middle: tokens.length > 2 ? tokens.slice(2, -1).join(" ") : "",
    last: tokens.at(-1) || "",
    quantity
  };
}

function displayEntity(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  if (/[^\x00-\x7F]/.test(text)) return text;
  return fallback;
}

function displayTaskName(value) {
  const text = String(value || "").trim();
  return text && /[^\x00-\x7F]/.test(text) ? text : "";
}

function identifierSuffix(label, value) {
  const text = String(value || "").trim();
  return text ? ` ${label}：${text}` : "";
}

function finiteDisplay(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function stopReasonLabel(reason) {
  const labels = {
    duration_reached: "达到设定推演时长",
    all_missions_resolved: "全部任务已完成判定",
    no_active_entities: "没有可继续推进的活动对象"
  };
  return labels[normalizedKey(reason)] || "达到终止条件";
}

function normalizedKey(value) {
  return String(value || "").trim().toLowerCase();
}

function queryValue(search, key) {
  const raw = String(search || "");
  const query = raw.startsWith("?") ? raw.slice(1) : raw;
  if (!query) return "";
  return new URLSearchParams(query).get(key) || "";
}

function hashQuery(hash) {
  const raw = String(hash || "");
  const index = raw.indexOf("?");
  return index >= 0 ? raw.slice(index + 1) : "";
}

function safeStorageGet(storage, key) {
  try {
    return storage?.getItem?.(key) || "";
  } catch {
    return "";
  }
}

function toSnakeCase(key) {
  return String(key).replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}
