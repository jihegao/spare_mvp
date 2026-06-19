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
