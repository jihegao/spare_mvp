const ALLOWED_DURATION_DISTRIBUTIONS = Object.freeze([
  "固定值",
  "指数分布",
  "正态分布",
  "均匀分布"
]);

export function allowedSupportActivityDurationDistributions() {
  return [...ALLOWED_DURATION_DISTRIBUTIONS];
}

export function supportActivityJobs(activity) {
  if (Array.isArray(activity?.jobs)) return activity.jobs;
  if (activity?.activityType === "后勤保障") return [];
  return [{
    activityCode: "BA-001",
    workName: activity?.activityType || "保障作业",
    predecessors: [],
    durationMinutes: Number(activity?.durationHours || 1) * 60
  }];
}

export function deleteSupportActivityJobAt(activity, index) {
  const jobs = supportActivityJobs(activity).slice();
  if (!activity || !Number.isInteger(index) || index < 0 || index >= jobs.length) return false;
  jobs.splice(index, 1);
  activity.jobs = jobs;
  return true;
}

export function deleteSupportActivityJobsAtIndexes(activity, indexes) {
  const selectedIndexes = new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0));
  if (!activity || selectedIndexes.size === 0) return false;
  const jobs = supportActivityJobs(activity);
  const nextJobs = jobs.filter((_, index) => !selectedIndexes.has(index));
  if (nextJobs.length === jobs.length) return false;
  activity.jobs = nextJobs;
  return true;
}

export function supportActivityJobFromBasicActivity(activity) {
  const profile = normalizeSupportActivityDurationProfile(activity?.durationProfile || activity?.durationDistribution, activity?.durationMinutes);
  return {
    activityCode: String(activity?.activityCode || activity?.id || "").trim(),
    workName: String(activity?.workName || activity?.name || activity?.activityName || "").trim(),
    applicableAircraft: String(activity?.applicableAircraft || activity?.aircraftModel || "").trim(),
    durationProfile: profile,
    durationMinutes: durationMinutesFromProfile(profile, activity?.durationMinutes),
    personnel: String(activity?.personnel || activity?.personnelDemand || "").trim(),
    equipment: String(activity?.equipment || activity?.equipmentDemand || "").trim(),
    spare: String(activity?.spare || activity?.spareDemand || "").trim(),
    predecessors: Array.isArray(activity?.predecessors) ? [...activity.predecessors] : []
  };
}

export function normalizeSupportActivityDurationProfile(profile, fallbackMinutes = 30) {
  const source = profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
  const distributionType = ALLOWED_DURATION_DISTRIBUTIONS.includes(source.distributionType)
    ? source.distributionType
    : "固定值";
  const fallbackValue = positiveNumber(fallbackMinutes, 30);
  if (distributionType === "指数分布") {
    return { distributionType, mean: positiveNumber(source.mean ?? source.value, fallbackValue) };
  }
  if (distributionType === "正态分布") {
    return {
      distributionType,
      mean: positiveNumber(source.mean ?? source.value, fallbackValue),
      stdDev: positiveNumber(source.stdDev, Math.max(1, Math.round(fallbackValue * 0.2)))
    };
  }
  if (distributionType === "均匀分布") {
    const min = positiveNumber(source.min, Math.max(1, Math.round(fallbackValue * 0.8)));
    const max = positiveNumber(source.max, Math.max(min, Math.round(fallbackValue * 1.2)));
    return { distributionType, min, max: Math.max(min, max) };
  }
  return { distributionType: "固定值", value: positiveNumber(source.value ?? source.mean, fallbackValue) };
}

function durationMinutesFromProfile(profile, fallbackMinutes) {
  if (profile?.distributionType === "指数分布") return positiveNumber(profile.mean, fallbackMinutes);
  if (profile?.distributionType === "正态分布") return positiveNumber(profile.mean, fallbackMinutes);
  if (profile?.distributionType === "均匀分布") return Math.round((positiveNumber(profile.min, fallbackMinutes) + positiveNumber(profile.max, fallbackMinutes)) / 2);
  return positiveNumber(profile?.value, fallbackMinutes);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : Number(fallback || 0);
}
