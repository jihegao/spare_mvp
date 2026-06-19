export function compileMissionExposure(project, equipmentNodes) {
  const missionHours = Number(project.targets?.reliability?.atHours || project.missionProfile?.missionHours || 3);
  const phases = project.missionPhases?.length
    ? project.missionPhases
    : [{ id: "phase-sortie", name: "出动执行", state: "active", durationHours: missionHours }];
  const rows = [];
  const warnings = [];

  for (const node of equipmentNodes.filter((item) => item.parentId)) {
    const use = node.missionUse || {};
    const dutyCycle = Number(use.dutyCycle ?? 1);
    const environmentFactor = Number(use.environmentFactor ?? 1);
    const loadFactor = Number(use.loadFactor ?? 1);
    if (!node.missionUse) {
      warnings.push({
        code: "DEFAULT_EXPOSURE_USED",
        nodeId: node.id,
        message: `${node.name} 缺少任务使用规则，已使用默认任务暴露参数`
      });
    }

    for (const phase of phases) {
      const durationHours = Number(phase.durationHours ?? phase.limitHours ?? missionHours);
      const equivalentHours = durationHours * dutyCycle * environmentFactor * loadFactor;
      rows.push({
        nodeId: node.id,
        nodeName: node.name,
        missionPhaseId: phase.id,
        missionPhaseName: phase.name,
        state: phase.state || "active",
        durationHours,
        dutyCycle,
        environmentFactor,
        loadFactor,
        equivalentHours
      });
    }
  }

  const totalsByNode = rows.reduce((acc, row) => {
    acc[row.nodeId] ||= {
      nodeId: row.nodeId,
      nodeName: row.nodeName,
      equivalentHours: 0,
      phaseCount: 0
    };
    acc[row.nodeId].equivalentHours += row.equivalentHours;
    acc[row.nodeId].phaseCount += 1;
    return acc;
  }, {});

  return {
    rows,
    totalsByNode,
    warnings
  };
}
