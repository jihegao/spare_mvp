const ALLOWED_DURATION_DISTRIBUTIONS = Object.freeze([
  "固定值",
  "指数分布",
  "正态分布",
  "均匀分布"
]);

export function allowedSupportActivityDurationDistributions() {
  return [...ALLOWED_DURATION_DISTRIBUTIONS];
}

export function supportActivityJobFromBasicActivity(activity) {
  const profile = normalizeSupportActivityDurationProfile(activity?.durationProfile || activity?.durationDistribution, activity?.durationMinutes);
  const personnel = Array.isArray(activity?.personnel)
    ? activity.personnel.map((item) => ({
      professional: String(item?.professional || "").trim(),
      quantity: Math.max(1, Number(item?.quantity) || 1)
    })).filter((item) => item.professional)
    : [];
  const equipment = structuredResourceRequirements(activity?.equipment);
  const spare = structuredResourceRequirements(activity?.spare);
  return {
    activityCode: String(activity?.activityCode || activity?.id || "").trim(),
    workName: String(activity?.workName || activity?.name || activity?.activityName || "").trim(),
    applicableAircraft: String(activity?.applicableAircraft || activity?.aircraftModel || "").trim(),
    durationProfile: profile,
    durationMinutes: durationMinutesFromProfile(profile, activity?.durationMinutes),
    ...(activity?.personnelProfessional ? { personnelProfessional: String(activity.personnelProfessional).trim() } : {}),
    ...(activity?.equipmentModel ? { equipmentModel: String(activity.equipmentModel).trim() } : {}),
    personnel,
    equipment,
    spare,
    predecessors: Array.isArray(activity?.predecessors) ? [...activity.predecessors] : []
  };
}

function structuredResourceRequirements(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    model: String(item?.model || "").trim(),
    name: String(item?.name || "").trim(),
    quantity: Math.max(1, Number(item?.quantity) || 1)
  })).filter((item) => item.model || item.name);
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
