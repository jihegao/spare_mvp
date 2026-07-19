export const DOWNTIME_FACTOR_OPTIONS = Object.freeze([
  { value: "spare_shortage", label: "备件短缺" },
  { value: "failure", label: "装备故障" },
  { value: "equipment_shortage", label: "保障设备短缺" },
  { value: "preventive", label: "预防性维修" }
]);

const PHASE_LABELS = Object.freeze({
  preflight: "飞行前保障",
  flight: "任务执行",
  mission: "任务执行",
  repair: "修复性维修",
  corrective: "修复性维修",
  postflight: "飞行后保障",
  preventive: "预防性维修",
  waiting: "等待保障资源",
  transport: "备件运输"
});

const DESCRIPTION_LABELS = Object.freeze({
  failure: "装备发生故障，当前不可用并等待修复",
  equipment_shortage: "保障设备不足，当前作业正在等待资源",
  spare_shortage: "所需备件短缺，当前作业正在等待补给",
  preventive: "装备正在执行预防性维修"
});

const OPERATIONAL_EVENT_LABELS = Object.freeze({
  component_failed: "部件故障发生",
  aircraft_failed: "整机故障发生",
  failure: "故障发生",
  repair_started: "维修开始",
  job_started: "保障作业开始",
  spare_shortage: "等待所需备件",
  equipment_shortage: "等待保障设备",
  resource_waiting: "等待保障资源",
  transport_dispatched: "备件运输开始",
  transport_arrived: "备件运输完成",
  transport_replenished: "备件补给完成",
  repair_completed: "修复完成",
  mission_resumed: "任务恢复",
  mission_launched: "任务开始执行"
});

export function downtimeEventFactor(event) {
  const value = event?.factor ?? event?.event_type ?? event?.eventType ?? event?.reason ?? "";
  return String(value).trim();
}

export function downtimeFactorLabel(factor) {
  return DOWNTIME_FACTOR_OPTIONS.find((item) => item.value === String(factor || ""))?.label || "其他停机因素";
}

export function formatDowntimeSimulationTime(value) {
  if (value === null || value === undefined || value === "") return "暂无时间";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "暂无时间";
  const minute = Math.round(numeric);
  const day = Math.floor(minute / 1440) + 1;
  const minuteOfDay = minute % 1440;
  const hour = Math.floor(minuteOfDay / 60);
  const minuteWithinHour = minuteOfDay % 60;
  return `DAY_${day} ${String(hour).padStart(2, "0")}:${String(minuteWithinHour).padStart(2, "0")}`;
}

export function downtimeDisplayValue(value, fallback = "暂无数据") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function downtimeMissionPhaseLabel(value) {
  const phase = String(value || "").trim();
  if (!phase) return "";
  const mapped = PHASE_LABELS[phase.toLowerCase()];
  if (mapped) return mapped;
  return /[\u3400-\u9fff]/u.test(phase) ? phase : "其他阶段";
}

export function downtimeTaskLabel(event) {
  const missionName = firstText(
    event?.mission_name,
    event?.missionName,
    event?.basic_task_name,
    event?.basicTaskName,
    event?.task_label,
    event?.taskLabel
  );
  const missionId = firstText(event?.mission_id, event?.missionId, event?.task_id, event?.taskId);
  const phaseName = firstText(
    event?.mission_phase_name,
    event?.missionPhaseName,
    event?.phase_name,
    event?.phaseName,
    event?.task_name,
    event?.taskName,
    event?.mission_phase,
    event?.missionPhase,
    event?.phase_id,
    event?.phaseId
  );
  const phaseLabel = downtimeMissionPhaseLabel(phaseName);
  if (!missionName && !missionId) return phaseLabel ? `任务外事件；阶段：${phaseLabel}` : "不在任务阶段";
  const taskLabel = missionName || "任务名称未解析";
  return phaseLabel ? `${taskLabel}；阶段：${phaseLabel}` : `${taskLabel}；阶段：未记录`;
}

export function downtimeEventDescription(event) {
  const factor = downtimeEventFactor(event);
  const tailNumber = firstText(event?.tail_number, event?.tailNumber);
  const subject = tailNumber ? `飞机${tailNumber}` : "当前装备";
  const description = DESCRIPTION_LABELS[factor] || "记录到未识别的停机事件";
  return `${subject}${description}`;
}

export function downtimeOperationalEventLabel(value) {
  const eventType = String(value || "").trim().toLowerCase();
  return OPERATIONAL_EVENT_LABELS[eventType] || "未识别的停机事件";
}

export function downtimeEventDurationHours(event) {
  const hours = Number(event?.duration_hours ?? event?.durationHours);
  if (Number.isFinite(hours) && hours >= 0) return hours;
  const minutes = Number(event?.duration_minutes ?? event?.durationMinutes);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes / 60 : 0;
}

export function downtimeEventDisplayRow(event) {
  const details = event?.details && typeof event.details === "object" ? event.details : {};
  return {
    factor: downtimeEventFactor(event),
    factorLabel: downtimeFactorLabel(downtimeEventFactor(event)),
    equipmentName: downtimeDisplayValue(
      event?.equipment_name ?? event?.equipmentName ?? event?.aircraft_type ?? event?.aircraftType ?? event?.tail_number
    ),
    taskPhaseLabel: downtimeTaskLabel(event),
    supportNodeName: downtimeDisplayValue(event?.support_node_name ?? event?.supportNodeName, "未记录保障组织"),
    startTimeLabel: formatDowntimeSimulationTime(event?.start_minute ?? event?.startMinute ?? event?.start_time ?? event?.startTime),
    endTimeLabel: formatDowntimeSimulationTime(event?.end_minute ?? event?.endMinute ?? event?.end_time ?? event?.endTime),
    durationHours: downtimeEventDurationHours(event),
    description: downtimeEventDescription(event),
    specificDetails: downtimeFactorSpecificDetails(downtimeEventFactor(event), details)
  };
}

export function downtimeSnapshotResultLabel(value) {
  return {
    mission_delayed_by_spare_shortage: "任务因备件短缺延误",
    mission_delayed_by_equipment_shortage: "任务因保障设备短缺延误",
    aircraft_unavailable_for_preventive_maintenance: "飞机因预防性维修不可用",
    aircraft_unavailable_after_failure: "飞机故障后不可用",
    downtime_anomaly_recorded: "已记录停机异常"
  }[String(value || "")] || "已记录停机事件";
}

export function downtimeAircraftStateLabel(value) {
  return {
    available: "可用",
    maintenance: "维修中",
    repairing: "修复中",
    failed: "故障",
    waiting: "等待中",
    flying: "执行任务中",
    post_support: "飞行后保障中"
  }[String(value || "")] || "未知状态";
}

export function downtimeJobStateLabel(value) {
  return {
    waiting: "等待中",
    running: "执行中",
    completed: "已完成",
    observed: "已记录"
  }[String(value || "")] || "状态未识别";
}

const JOB_LABELS = Object.freeze({
  preflight: "飞行前保障作业",
  flight: "任务执行作业",
  mission: "任务执行作业",
  repair: "修复性维修作业",
  corrective: "修复性维修作业",
  postflight: "飞行后保障作业",
  preventive: "预防性维修作业",
  waiting: "等待保障资源",
  transport: "备件运输作业",
  spare_shortage: "备件短缺处置作业",
  equipment_shortage: "保障设备短缺处置作业",
  mission_delayed_by_spare_shortage: "任务因备件短缺延误",
  mission_delayed_by_equipment_shortage: "任务因保障设备短缺延误",
  aircraft_unavailable_for_preventive_maintenance: "飞机因预防性维修不可用",
  aircraft_unavailable_after_failure: "飞机故障后不可用",
  downtime_anomaly_recorded: "停机异常记录"
});

export function downtimeJobLabel(...values) {
  let mappedFallback = "";
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    if (/[\u3400-\u9fff]/u.test(text)) return text;
    mappedFallback ||= JOB_LABELS[text.toLowerCase()] || "";
  }
  return mappedFallback || "未记录作业名称";
}

function downtimeFactorSpecificDetails(factor, details) {
  if (factor === "spare_shortage") {
    return [
      ["备件", details.spare_name ?? details.spare_type],
      ["需求", details.required_quantity],
      ["可用", details.available_quantity],
      ["短缺", details.shortage_quantity],
      ["到货/等待结束", formatDowntimeSimulationTime(details.arrival_minute ?? details.wait_end_minute)]
    ];
  }
  if (factor === "failure") {
    return [
      ["故障部件", details.component_name],
      ["故障发生", formatDowntimeSimulationTime(details.failure_minute)],
      ["修复完成", formatDowntimeSimulationTime(details.repair_completed_minute)]
    ];
  }
  if (factor === "equipment_shortage") {
    return [
      ["保障设备", details.equipment_name ?? details.equipment_model],
      ["需求", details.required_quantity],
      ["可用", details.available_quantity],
      ["短缺", details.shortage_quantity],
      ["等待时长", formatDurationMinutes(details.wait_minutes)]
    ];
  }
  if (factor === "preventive") {
    return [
      ["维修项目", details.maintenance_item ?? details.maintenance_type],
      ["触发条件", localizePreventiveTrigger(details.trigger_condition ?? details.trigger_type)],
      ["计划开始", formatDowntimeSimulationTime(details.planned_start_minute)],
      ["实际完成", formatDowntimeSimulationTime(details.completed_minute)]
    ];
  }
  return [["事件信息", "未识别的停机事件"]];
}

function formatDurationMinutes(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes >= 0 ? `${minutes} 分钟` : "暂无数据";
}

function localizePreventiveTrigger(value) {
  const triggers = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!triggers.length) return "未记录触发条件";
  const labels = {
    calendar_time: "日历时间到期",
    flight_hours: "飞行小时到期",
    landings: "起落次数到期"
  };
  return triggers.map((trigger) => labels[trigger.toLowerCase()] || (/[\u3400-\u9fff]/u.test(trigger) ? trigger : "其他触发条件")).join("、");
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}
