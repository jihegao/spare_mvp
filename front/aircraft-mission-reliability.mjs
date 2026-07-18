const READY = "ready";
const BLOCKED = "blocked";

/**
 * Return the aircraft and mission choices that can be evaluated entirely in the
 * browser. Basic missions are authoritative when they exist; the legacy
 * missionProfile object is only exposed as a fallback.
 */
export function aircraftMissionReliabilityOptions(project = {}) {
  const aircraftModels = uniqueStrings([
    ...(Array.isArray(project.components)
      ? project.components.map((component) => component?.aircraftModel)
      : []),
    ...(Array.isArray(project.equipment?.wholeMachineModels)
      ? project.equipment.wholeMachineModels
      : []),
    project.equipment?.model,
    project.equipment?.aircraftModel,
    ...(Array.isArray(project.equipment)
      ? project.equipment.flatMap((item) => [item?.model, item?.aircraftModel])
      : [])
  ]).map((model) => ({ value: model, label: model }));

  const basicMissions = validObjectRows(project.basicMissions);
  const missionSources = basicMissions.length
    ? basicMissions.map((mission) => ({ mission, source: "basicMissions" }))
    : legacyMissionSources(project);
  const missionProfiles = missionSources.map(({ mission, source }, index) => {
    const value = missionIdentity(mission, `${source}-${index + 1}`);
    return {
      value,
      id: value,
      label: mission.name || mission.basicTaskName || mission.missionName || value,
      name: mission.name || mission.basicTaskName || mission.missionName || value,
      durationHours: missionDurationHours(mission),
      ...(cleanText(mission.aircraftModel ?? mission.equipmentType)
        ? { aircraftModel: cleanText(mission.aircraftModel ?? mission.equipmentType) }
        : {}),
      source
    };
  });

  return {
    aircraftModels,
    missionProfiles,
    // Explicit aliases make the return value convenient for native select
    // controls without forcing consumers to rename domain objects.
    aircraftModelOptions: aircraftModels,
    missionProfileOptions: missionProfiles
  };
}

/**
 * Return a compute-ready project for one aircraft model. Explicit RBD input is
 * authoritative. Older clean Projects can omit it, so derive a complete,
 * single-root series tree from components without mutating the Project JSON.
 */
export function aircraftMissionReliabilityProject(project = {}, aircraftModel = "") {
  const explicit = project.reliabilityBlockDiagram;
  if (explicit && Array.isArray(explicit.nodes) && explicit.nodes.length) return project;

  const allComponents = validObjectRows(project.components).filter((component) => cleanText(component.id));
  const model = cleanText(aircraftModel);
  const modelComponents = model
    ? allComponents.filter((component) => cleanText(component.aircraftModel) === model)
    : allComponents;
  const directlySelected = modelComponents.length
    ? modelComponents
    : allComponents.filter((component) => !cleanText(component.aircraftModel));
  if (!directlySelected.length) return project;

  const byId = new Map(allComponents.map((component) => [cleanText(component.id), component]));
  const includedIds = new Set(directlySelected.map((component) => cleanText(component.id)));
  for (const component of directlySelected) {
    let parentId = cleanText(component.parentId);
    const visited = new Set();
    while (parentId && byId.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      includedIds.add(parentId);
      parentId = cleanText(byId.get(parentId)?.parentId);
    }
  }
  let addedGenericDescendant = true;
  while (addedGenericDescendant) {
    addedGenericDescendant = false;
    for (const component of allComponents) {
      const id = cleanText(component.id);
      const parentId = cleanText(component.parentId);
      if (!includedIds.has(id) && !cleanText(component.aircraftModel) && includedIds.has(parentId)) {
        includedIds.add(id);
        addedGenericDescendant = true;
      }
    }
  }

  const components = allComponents.filter((component) => includedIds.has(cleanText(component.id)));
  const roots = components.filter((component) => {
    const parentId = cleanText(component.parentId);
    return !parentId || !includedIds.has(parentId);
  });
  const syntheticRootId = uniqueDerivedRootId(includedIds, model);
  const needsSyntheticRoot = roots.length !== 1;
  const rootId = needsSyntheticRoot ? syntheticRootId : cleanText(roots[0].id);
  const nodes = components.map((component) => {
    const id = cleanText(component.id);
    const parentId = cleanText(component.parentId);
    const isRoot = !needsSyntheticRoot && id === rootId;
    return {
      id,
      componentId: id,
      name: isRoot && model ? model : (cleanText(component.name) || id),
      type: component.productType || (isRoot ? "system" : "component"),
      aircraftModel: cleanText(component.aircraftModel),
      parentId: needsSyntheticRoot && roots.includes(component)
        ? syntheticRootId
        : (parentId && includedIds.has(parentId) ? parentId : null),
      relation: "series",
      derivedFromComponents: true,
      structuralRoot: isRoot && !hasReliabilityParameters(component)
    };
  });
  if (needsSyntheticRoot) {
    nodes.unshift({
      id: syntheticRootId,
      name: model || project.equipment?.model || "整机",
      type: "system",
      parentId: null,
      relation: "series",
      derivedFromComponents: true,
      structuralRoot: true
    });
  }
  const edges = nodes
    .filter((node) => cleanText(node.parentId))
    .map((node) => ({ from: cleanText(node.parentId), to: node.id, relation: "series" }));

  return {
    ...project,
    reliabilityBlockDiagram: {
      source: "components",
      rootId,
      nodes,
      edges
    }
  };
}

/**
 * Evaluate an aircraft reliability block diagram for one mission duration.
 * Validation failures are values (`status: "blocked"`), not thrown exceptions.
 */
export function evaluateAircraftMissionReliability(project = {}, selection = {}) {
  const options = aircraftMissionReliabilityOptions(project);
  const aircraftModel = cleanText(selection.aircraftModel);
  const missionProfileId = cleanText(selection.missionProfileId);

  if (!aircraftModel) return blockedResult("AIRCRAFT_REQUIRED", "请选择飞机型号后再计算任务可靠度。", selection);
  if (!options.aircraftModels.some((option) => option.value === aircraftModel)) {
    return blockedResult("AIRCRAFT_NOT_FOUND", `飞机型号“${aircraftModel}”不在当前项目中。`, selection);
  }
  if (!missionProfileId) return blockedResult("MISSION_REQUIRED", "请选择任务剖面后再计算任务可靠度。", selection);

  const mission = options.missionProfiles.find((option) => option.value === missionProfileId);
  if (!mission) return blockedResult("MISSION_NOT_FOUND", `任务剖面“${missionProfileId}”不在当前项目中。`, selection);
  if (mission.aircraftModel && mission.aircraftModel !== aircraftModel) {
    return blockedResult("MISSION_AIRCRAFT_MISMATCH", `任务剖面“${mission.name}”适用于 ${mission.aircraftModel}，与所选飞机 ${aircraftModel} 不一致。`, selection);
  }

  const explicitDuration = selection.durationHours;
  const durationHours = explicitDuration === undefined || explicitDuration === null || explicitDuration === ""
    ? mission.durationHours
    : Number(explicitDuration);
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    return blockedResult("INVALID_DURATION", "任务时长必须是大于 0 的有限小时数。", {
      ...selection,
      durationHours
    });
  }

  const effectiveProject = aircraftMissionReliabilityProject(project, aircraftModel);
  const diagram = effectiveProject.reliabilityBlockDiagram;
  if (!diagram || !Array.isArray(diagram.nodes) || diagram.nodes.length === 0) {
    return blockedResult("NO_RBD", "当前项目没有可计算的可靠性框图节点。", {
      ...selection,
      durationHours
    });
  }

  const graph = normalizeGraph(diagram, aircraftModel);
  if (!graph.ok) return blockedResult(graph.code, graph.message, { ...selection, durationHours }, graph.details);

  const components = validObjectRows(effectiveProject.components).filter((component) => {
    const model = cleanText(component.aircraftModel);
    return !model || model === aircraftModel;
  });
  const componentIndex = indexComponents(components);
  const evaluated = new Map();
  const evaluating = new Set();

  function evaluateNode(nodeId, depth = 0) {
    if (evaluated.has(nodeId)) return evaluated.get(nodeId);
    if (evaluating.has(nodeId)) {
      return { error: validationError("RBD_CYCLE", `可靠性框图在节点“${nodeId}”处存在循环。`, nodeId) };
    }
    evaluating.add(nodeId);
    const node = graph.byId.get(nodeId);
    const childIds = graph.childrenById.get(nodeId) || [];
    const component = findComponent(node, componentIndex);
    let value;

    if (childIds.length) {
      const relationResult = resolveGroupRelation(node, childIds, graph.edgeRelationByPair, component);
      if (!relationResult.ok) {
        value = { error: validationError(relationResult.code, relationResult.message, nodeId) };
      } else {
        const children = childIds.map((childId) => evaluateNode(childId, depth + 1));
        const failedChild = children.find((child) => child.error);
        if (failedChild) {
          value = failedChild;
        } else {
          const intrinsic = evaluateDerivedIntrinsicReliability(node, component, durationHours);
          if (!intrinsic.ok) {
            value = { error: validationError(intrinsic.code, intrinsic.message, nodeId) };
            evaluating.delete(nodeId);
            evaluated.set(nodeId, value);
            return value;
          }
          const childReliabilities = children.map((child) => child.reliability);
          const reliabilityInputs = intrinsic.enabled
            ? [intrinsic.reliability, ...childReliabilities]
            : childReliabilities;
          value = {
            node,
            depth,
            type: nodeType(node, true),
            relation: relationResult.relation,
            relationLabel: relationLabel(relationResult.relation, relationResult.k, childIds.length),
            parameter: intrinsic.enabled
              ? `自身 ${intrinsic.parameter}；${relationParameter(relationResult.relation, relationResult.k, childIds.length)}`
              : relationParameter(relationResult.relation, relationResult.k, childIds.length),
            parameters: relationResult.relation === "k_out_of_n"
              ? { k: relationResult.k, n: childIds.length }
              : (intrinsic.enabled ? { intrinsic: intrinsic.parameters } : {}),
            baseReliability: intrinsic.enabled ? intrinsic.reliability : undefined,
            reliability: boundedProbability(combineReliabilities(relationResult.relation, reliabilityInputs, relationResult.k)),
            children
          };
        }
      }
    } else {
      const leaf = evaluateLeaf(node, component, durationHours);
      if (!leaf.ok) {
        value = { error: validationError(leaf.code, leaf.message, nodeId) };
      } else {
        const redundancy = resolveLeafRedundancy(node, component);
        if (!redundancy.ok) {
          value = { error: validationError(redundancy.code, redundancy.message, nodeId) };
        } else {
          const reliability = redundancy.enabled
            ? kOutOfNReliability(redundancy.k, Array(redundancy.n).fill(leaf.reliability))
            : leaf.reliability;
          value = {
            node,
            depth,
            type: nodeType(node, false),
            relation: redundancy.enabled ? "k_out_of_n" : "leaf",
            relationLabel: redundancy.enabled ? relationLabel("k_out_of_n", redundancy.k, redundancy.n) : "叶产品",
            parameter: redundancy.enabled
              ? `${leaf.parameter}；${redundancy.n} 中取 ${redundancy.k}`
              : leaf.parameter,
            parameters: {
              ...leaf.parameters,
              ...(redundancy.enabled ? { k: redundancy.k, n: redundancy.n } : {})
            },
            baseReliability: redundancy.enabled ? leaf.reliability : undefined,
            reliability: boundedProbability(reliability),
            children: []
          };
        }
      }
    }

    evaluating.delete(nodeId);
    evaluated.set(nodeId, value);
    return value;
  }

  const root = evaluateNode(graph.rootId, 0);
  if (root.error) {
    return blockedResult(root.error.code, root.error.message, { ...selection, durationHours }, root.error);
  }

  const rows = flattenRows(root, durationHours);
  const reliability = boundedProbability(root.reliability);
  return {
    status: READY,
    ok: true,
    code: "READY",
    message: "任务可靠度计算完成。",
    aircraftModel,
    missionProfileId,
    missionProfile: {
      id: mission.id,
      name: mission.name,
      durationHours,
      ...(mission.aircraftModel ? { aircraftModel: mission.aircraftModel } : {})
    },
    reliability,
    aircraftReliability: reliability,
    failureProbability: boundedProbability(1 - reliability),
    durationHours,
    rows,
    rbdSnapshot: {
      aircraftModel,
      missionProfileId,
      durationHours,
      rootId: graph.rootId,
      nodes: cloneJsonValue(graph.nodes),
      edges: cloneJsonValue(graph.edges),
      components: cloneJsonValue(components)
    }
  };
}

function normalizeGraph(diagram, aircraftModel) {
  const allNodeIds = new Set(diagram.nodes
    .filter((node) => node && typeof node === "object" && !Array.isArray(node))
    .map((node) => cleanText(node.id))
    .filter(Boolean));
  const rawNodes = diagram.nodes.filter((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return true;
    const model = cleanText(node.aircraftModel);
    return !model || model === aircraftModel;
  });
  const nodes = [];
  const byId = new Map();
  for (const rawNode of rawNodes) {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      return invalidGraph("INVALID_RBD_NODE", "可靠性框图包含非对象节点。");
    }
    const id = cleanText(rawNode.id);
    if (!id) return invalidGraph("INVALID_RBD_NODE", "可靠性框图节点必须具有非空 id。");
    if (byId.has(id)) return invalidGraph("INVALID_RBD_NODE", `可靠性框图节点 id“${id}”重复。`, { nodeId: id });
    const node = { ...rawNode, id };
    nodes.push(node);
    byId.set(id, node);
  }
  if (!nodes.length) return invalidGraph("INVALID_RBD_NODE", `飞机型号“${aircraftModel}”没有可靠性框图节点。`);

  const edges = [];
  const parentSets = new Map(nodes.map((node) => [node.id, new Set()]));
  const childrenById = new Map(nodes.map((node) => [node.id, []]));
  const edgeRelationByPair = new Map();
  const addEdge = (from, to, rawEdge = {}) => {
    if (!byId.has(from) || !byId.has(to)) {
      return invalidGraph("INVALID_RBD_NODE", `可靠性框图连线引用了不存在的节点“${!byId.has(from) ? from : to}”。`);
    }
    const pair = `${from}\u0000${to}`;
    if (!edges.some((edge) => `${edge.from}\u0000${edge.to}` === pair)) {
      const relation = relationFromValue(rawEdge.relation ?? rawEdge.logic ?? rawEdge.type ?? rawEdge.connectionType);
      edges.push({ from, to, ...(relation ? { relation } : {}) });
      parentSets.get(to).add(from);
      childrenById.get(from).push(to);
      if (relation) edgeRelationByPair.set(pair, relation);
    }
    return null;
  };

  for (const rawEdge of Array.isArray(diagram.edges) ? diagram.edges : []) {
    if (!rawEdge || typeof rawEdge !== "object" || Array.isArray(rawEdge)) {
      return invalidGraph("INVALID_RBD_NODE", "可靠性框图包含无效连线。");
    }
    const from = cleanText(rawEdge.from ?? rawEdge.source ?? rawEdge.parentId);
    const to = cleanText(rawEdge.to ?? rawEdge.target ?? rawEdge.childId);
    if (!from || !to) return invalidGraph("INVALID_RBD_NODE", "可靠性框图连线必须同时指定起点和终点。");
    if ((!byId.has(from) && allNodeIds.has(from)) || (!byId.has(to) && allNodeIds.has(to))) continue;
    const failure = addEdge(from, to, rawEdge);
    if (failure) return failure;
  }

  for (const node of nodes) {
    const parentId = cleanText(node.parentId);
    if (!parentId) continue;
    if (!byId.has(parentId) && allNodeIds.has(parentId)) continue;
    const failure = addEdge(parentId, node.id, {
      type: node.parentRelation
    });
    if (failure) return failure;
  }

  for (const [nodeId, parents] of parentSets) {
    if (parents.size > 1) {
      return invalidGraph("INVALID_RBD_NODE", `节点“${nodeId}”具有多个父节点，不能按树形框图计算。`, { nodeId });
    }
  }
  const colors = new Map();
  function visit(nodeId) {
    const color = colors.get(nodeId) || 0;
    if (color === 1) return true;
    if (color === 2) return false;
    colors.set(nodeId, 1);
    if ((childrenById.get(nodeId) || []).some(visit)) return true;
    colors.set(nodeId, 2);
    return false;
  }
  if (nodes.some((node) => visit(node.id))) return invalidGraph("RBD_CYCLE", "可靠性框图中存在循环节点关系。");
  const roots = nodes.filter((node) => parentSets.get(node.id).size === 0);
  if (roots.length !== 1) {
    return invalidGraph("INVALID_RBD_NODE", `可靠性框图必须且只能有一个根节点，当前为 ${roots.length} 个。`);
  }
  if (colors.size !== nodes.length) return invalidGraph("INVALID_RBD_NODE", "可靠性框图包含无法从根节点到达的节点。");

  return { ok: true, nodes, byId, edges, childrenById, edgeRelationByPair, rootId: roots[0].id };
}

function resolveGroupRelation(node, childIds, edgeRelationByPair, component) {
  const explicit = relationFromValue(
    node.relation ?? node.logic ?? node.gateType ?? node.connectionType ?? groupTypeValue(node.type)
  );
  const edgeRelations = uniqueStrings(childIds.map((childId) => edgeRelationByPair.get(`${node.id}\u0000${childId}`)));
  if (edgeRelations.length > 1) {
    return { ok: false, code: "INVALID_RELATION", message: `节点“${node.name || node.id}”的子连线混用了多种逻辑关系。` };
  }
  const relation = explicit || edgeRelations[0] || relationFromKOutOfN(node, component);
  if (!relation) {
    return { ok: false, code: "MISSING_RELATION", message: `节点“${node.name || node.id}”缺少串联、并联或 k-out-of-n 关系。` };
  }
  if (explicit && edgeRelations[0] && explicit !== edgeRelations[0]) {
    return { ok: false, code: "INVALID_RELATION", message: `节点“${node.name || node.id}”与其连线的逻辑关系不一致。` };
  }
  if (relation === "k_out_of_n") {
    const config = kOutOfNConfig(node, component, childIds.length);
    if (!config.ok || config.n !== childIds.length) {
      return {
        ok: false,
        code: "INVALID_RELATION",
        message: `节点“${node.name || node.id}”的 k-out-of-n 参数必须满足 1 ≤ k ≤ n，且 n 等于子节点数。`
      };
    }
    return { ok: true, relation, k: config.k };
  }
  return { ok: true, relation };
}

function evaluateLeaf(node, component, durationHours) {
  const source = component ? { ...component, ...node } : node;
  const distribution = node.failureDistribution ?? component?.failureDistribution;
  const type = canonicalDistribution(distribution?.distributionType ?? distribution?.type);
  const parsed = parseParameterText(distribution?.parameters);
  const params = {
    ...(distribution && typeof distribution.parameters === "object" && !Array.isArray(distribution.parameters)
      ? distribution.parameters
      : {}),
    ...parsed,
    ...(distribution || {})
  };

  if (distribution && !type) {
    return { ok: false, code: "INVALID_LEAF_PARAMETERS", message: `叶产品“${node.name || node.id}”使用了不支持的失效分布。` };
  }
  if (type === "exponential") {
    const rawRate = firstPresent(params.rate, params.lambda, source.failureRate);
    const fallbackMtbf = firstPresent(source.mtbfHours?.value, source.mtbfHours, source.mtbf?.value, source.mtbf);
    if (rawRate === undefined && positiveFinite(fallbackMtbf)) {
      const converted = convertTime(fallbackMtbf, source.mtbfHours?.unit ?? source.mtbf?.unit ?? source.mtbfUnit ?? source.timeUnit ?? "h");
      if (!converted.ok) return unitFailure(node, converted.unit);
      return exponentialLeaf(1 / converted.value, durationHours, node, "由 MTBF 换算");
    }
    const converted = convertRate(rawRate, params.rateUnit ?? params.unit ?? source.failureRateUnit ?? source.rateUnit ?? "1/h");
    if (!converted.ok) return converted.reason === "unit" ? unitFailure(node, converted.unit) : parameterFailure(node, "指数分布速率必须是大于或等于 0 的有限数。");
    return exponentialLeaf(converted.value, durationHours, node, "指数分布");
  }
  if (type === "normal") {
    const unit = params.timeUnit ?? params.unit ?? "h";
    const mean = convertTime(firstPresent(params.mean, params.mu), unit);
    let stdRaw = firstPresent(params.stdDev, params.standardDeviation, params.sigma);
    if (stdRaw === undefined && Number.isFinite(Number(params.variance)) && Number(params.variance) >= 0) {
      stdRaw = Math.sqrt(Number(params.variance));
    }
    const stdDev = convertTime(stdRaw, unit);
    if (!mean.ok || !stdDev.ok) {
      const failed = !mean.ok ? mean : stdDev;
      return failed.reason === "unit" ? unitFailure(node, failed.unit) : parameterFailure(node, "正态分布必须提供正均值和正标准差（或方差）。");
    }
    if (mean.value <= 0 || stdDev.value <= 0) return parameterFailure(node, "正态分布必须提供正均值和正标准差（或方差）。");
    const reliability = 1 - normalCdf((durationHours - mean.value) / stdDev.value);
    return successLeaf(reliability, `正态分布 μ=${mean.value} h, σ=${stdDev.value} h`, {
      distribution: "normal", meanHours: mean.value, stdDevHours: stdDev.value
    });
  }
  if (type === "uniform") {
    const unit = params.timeUnit ?? params.unit ?? "h";
    const minimum = convertTime(firstPresent(params.min, params.minimum), unit);
    const maximum = convertTime(firstPresent(params.max, params.maximum), unit);
    if (!minimum.ok || !maximum.ok) {
      const failed = !minimum.ok ? minimum : maximum;
      return failed.reason === "unit" ? unitFailure(node, failed.unit) : parameterFailure(node, "均匀分布必须提供有限的最小值和最大值。");
    }
    if (minimum.value < 0 || maximum.value <= minimum.value) return parameterFailure(node, "均匀分布必须满足 0 ≤ min < max。");
    const reliability = durationHours < minimum.value
      ? 1
      : durationHours >= maximum.value
        ? 0
        : (maximum.value - durationHours) / (maximum.value - minimum.value);
    return successLeaf(reliability, `均匀分布 [${minimum.value}, ${maximum.value}] h`, {
      distribution: "uniform", minHours: minimum.value, maxHours: maximum.value
    });
  }
  if (type === "fixed") {
    const lifetime = convertTime(firstPresent(params.value, params.lifetime, source.mtbfHours), params.timeUnit ?? params.unit ?? source.mtbfUnit ?? "h");
    if (!lifetime.ok) return lifetime.reason === "unit" ? unitFailure(node, lifetime.unit) : parameterFailure(node, "固定分布必须提供大于 0 的寿命值。");
    if (lifetime.value <= 0) return parameterFailure(node, "固定分布必须提供大于 0 的寿命值。");
    return successLeaf(durationHours < lifetime.value ? 1 : 0, `固定寿命 ${lifetime.value} h`, {
      distribution: "fixed", lifetimeHours: lifetime.value
    });
  }

  const failureRate = firstPresent(source.failureRate?.value, source.failureRate);
  if (failureRate !== undefined && typeof failureRate !== "object") {
    const converted = convertRate(failureRate, source.failureRate?.unit ?? source.failureRateUnit ?? source.rateUnit ?? "1/h");
    if (!converted.ok) return converted.reason === "unit" ? unitFailure(node, converted.unit) : parameterFailure(node, "失效率必须是大于或等于 0 的有限数。");
    return exponentialLeaf(converted.value, durationHours, node, "失效率");
  }
  const mtbf = firstPresent(source.mtbfHours?.value, source.mtbfHours, source.mtbf);
  if (mtbf !== undefined && typeof mtbf !== "object") {
    const converted = convertTime(mtbf, source.mtbfHours?.unit ?? source.mtbfUnit ?? source.timeUnit ?? "h");
    if (!converted.ok) return converted.reason === "unit" ? unitFailure(node, converted.unit) : parameterFailure(node, "MTBF 必须是大于 0 的有限数。");
    if (converted.value <= 0) return parameterFailure(node, "MTBF 必须是大于 0 的有限数。");
    return exponentialLeaf(1 / converted.value, durationHours, node, "MTBF");
  }
  const fixedReliability = Number(source.reliability);
  if (source.reliability !== undefined && source.reliability !== "") {
    if (!Number.isFinite(fixedReliability) || fixedReliability < 0 || fixedReliability > 1) {
      return parameterFailure(node, "固定可靠度必须位于 0 到 1 之间。");
    }
    return successLeaf(fixedReliability, `固定可靠度 ${fixedReliability}`, {
      distribution: "fixed_reliability", value: fixedReliability
    });
  }
  return { ok: false, code: "MISSING_LEAF_PARAMETERS", message: `叶产品“${node.name || node.id}”缺少失效率、MTBF 或失效分布参数。` };
}

function exponentialLeaf(ratePerHour, durationHours, node, label) {
  if (!Number.isFinite(ratePerHour) || ratePerHour < 0) return parameterFailure(node, "指数分布速率必须是大于或等于 0 的有限数。");
  return successLeaf(Math.exp(-ratePerHour * durationHours), `${label} λ=${ratePerHour}/h`, {
    distribution: "exponential", ratePerHour
  });
}

function successLeaf(reliability, parameter, parameters) {
  return { ok: true, reliability: boundedProbability(reliability), parameter, parameters };
}

function parameterFailure(node, detail) {
  return { ok: false, code: "INVALID_LEAF_PARAMETERS", message: `叶产品“${node.name || node.id}”参数非法：${detail}` };
}

function unitFailure(node, unit) {
  return { ok: false, code: "INVALID_UNIT", message: `叶产品“${node.name || node.id}”使用了无法识别的单位“${unit}”。` };
}

function resolveLeafRedundancy(node, component) {
  const config = kOutOfNConfig(node, component, Number(component?.quantity ?? node.quantity ?? 1));
  const requested = Boolean(node.kOutOfN?.enabled || component?.kOutOfN?.enabled || relationFromValue(node.relation ?? node.logic) === "k_out_of_n");
  if (!requested) return { ok: true, enabled: false };
  if (!config.ok) {
    return { ok: false, code: "INVALID_RELATION", message: `叶产品“${node.name || node.id}”的 k-out-of-n 参数必须满足 1 ≤ k ≤ n。` };
  }
  return { ok: true, enabled: true, k: config.k, n: config.n };
}

function evaluateDerivedIntrinsicReliability(node, component, durationHours) {
  if (!node.derivedFromComponents || node.structuralRoot) return { ok: true, enabled: false };
  const leaf = evaluateLeaf(node, component, durationHours);
  if (!leaf.ok) return leaf;
  const redundancy = resolveLeafRedundancy(node, component);
  if (!redundancy.ok) return redundancy;
  const reliability = redundancy.enabled
    ? kOutOfNReliability(redundancy.k, Array(redundancy.n).fill(leaf.reliability))
    : leaf.reliability;
  return {
    ok: true,
    enabled: true,
    reliability: boundedProbability(reliability),
    parameter: redundancy.enabled
      ? `${leaf.parameter}；${redundancy.n} 中取 ${redundancy.k}`
      : leaf.parameter,
    parameters: {
      ...leaf.parameters,
      ...(redundancy.enabled ? { k: redundancy.k, n: redundancy.n } : {})
    }
  };
}

function kOutOfNConfig(node, component, fallbackN) {
  const source = node.kOutOfN ?? component?.kOutOfN ?? {};
  const n = Number(source.n ?? node.n ?? component?.quantity ?? fallbackN);
  const k = Number(source.k ?? node.k);
  const ok = Number.isInteger(n) && Number.isInteger(k) && n >= 1 && k >= 1 && k <= n;
  return { ok, n, k };
}

function combineReliabilities(relation, values, k) {
  if (relation === "parallel") return 1 - values.reduce((product, value) => product * (1 - value), 1);
  if (relation === "k_out_of_n") return kOutOfNReliability(k, values);
  return values.reduce((product, value) => product * value, 1);
}

function kOutOfNReliability(k, values) {
  // Dynamic programming avoids the 2^n state enumeration used by the diagram
  // preview helper and remains stable for realistic redundancy counts.
  const exact = Array(values.length + 1).fill(0);
  exact[0] = 1;
  values.forEach((reliability, index) => {
    for (let successes = index + 1; successes >= 0; successes -= 1) {
      exact[successes] = (exact[successes] || 0) * (1 - reliability)
        + (successes > 0 ? exact[successes - 1] * reliability : 0);
    }
  });
  return exact.slice(k).reduce((sum, probability) => sum + probability, 0);
}

function flattenRows(root, durationHours) {
  const rows = [];
  function append(result) {
    const reliability = boundedProbability(result.reliability);
    rows.push({
      level: result.depth,
      depth: result.depth,
      nodeId: result.node.id,
      name: result.node.name || result.node.id,
      type: result.type,
      nodeType: result.type,
      relation: result.relation,
      relationLabel: result.relationLabel,
      parameter: result.parameter,
      parameterLabel: result.parameter,
      parameters: result.parameters,
      durationHours,
      reliability,
      failureProbability: boundedProbability(1 - reliability),
      ...(result.baseReliability === undefined ? {} : { baseReliability: result.baseReliability })
    });
    result.children.forEach(append);
  }
  append(root);
  return rows;
}

function blockedResult(code, message, selection = {}, details = {}) {
  return {
    status: BLOCKED,
    ok: false,
    code,
    message,
    aircraftModel: cleanText(selection.aircraftModel),
    missionProfileId: cleanText(selection.missionProfileId),
    missionProfile: null,
    reliability: null,
    aircraftReliability: null,
    failureProbability: null,
    durationHours: Number.isFinite(Number(selection.durationHours)) ? Number(selection.durationHours) : null,
    rows: [],
    rbdSnapshot: null,
    errors: [{ code, message, ...details }]
  };
}

function indexComponents(components) {
  const byId = new Map();
  const byName = new Map();
  components.forEach((component) => {
    const id = cleanText(component.id);
    const name = cleanText(component.name);
    if (id) byId.set(id, component);
    if (name && !byName.has(name)) byName.set(name, component);
  });
  return { byId, byName };
}

function findComponent(node, index) {
  for (const id of [node.componentId, node.productId, node.equipmentId, node.id]) {
    if (index.byId.has(cleanText(id))) return index.byId.get(cleanText(id));
  }
  return index.byName.get(cleanText(node.name));
}

function missionDurationHours(mission) {
  const minutes = Number(mission?.taskDurationMinutes);
  if (Number.isFinite(minutes) && minutes > 0) return minutes / 60;
  const phases = validObjectRows(mission?.missionPhases);
  if (phases.length) {
    const values = phases.map((phase) => Number(phase.limitHours ?? phase.durationHours));
    if (values.every((value) => Number.isFinite(value) && value >= 0)) {
      return values.reduce((sum, value) => sum + value, 0);
    }
    return NaN;
  }
  for (const value of [mission?.durationHours, mission?.missionHours]) {
    const hours = Number(value);
    if (Number.isFinite(hours) && hours > 0) return hours;
  }
  return NaN;
}

function legacyMissionSources(project) {
  if (validObjectRows(project.missionProfiles).length) {
    return validObjectRows(project.missionProfiles).map((mission) => ({ mission, source: "missionProfiles" }));
  }
  const profile = project.missionProfile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return [];
  const nestedBasics = validObjectRows(profile.basicMissions);
  return nestedBasics.length
    ? nestedBasics.map((mission) => ({ mission, source: "missionProfile.basicMissions" }))
    : [{ mission: profile, source: "missionProfile" }];
}

function missionIdentity(mission, fallback) {
  return cleanText(mission.id ?? mission.missionProfileId ?? mission.profileId ?? mission.missionId ?? mission.taskNo ?? mission.name) || fallback;
}

function canonicalDistribution(value) {
  const text = cleanText(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (!text) return "";
  if (text.includes("指数") || text.includes("exponential")) return "exponential";
  if (text.includes("正态") || text.includes("normal") || text.includes("gaussian")) return "normal";
  if (text.includes("均匀") || text.includes("uniform")) return "uniform";
  if (text.includes("固定") || text.includes("fixed") || text.includes("constant")) return "fixed";
  return "";
}

function relationFromValue(value) {
  const text = cleanText(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (!text) return "";
  if (text.includes("koutofn") || text.includes("k/n") || text.includes("中取")) return "k_out_of_n";
  if (text.includes("parallel") || text.includes("并联")) return "parallel";
  if (text.includes("series") || text.includes("串联")) return "series";
  return "";
}

function relationFromKOutOfN(node, component) {
  return node.kOutOfN?.enabled || component?.kOutOfN?.enabled ? "k_out_of_n" : "";
}

function groupTypeValue(type) {
  const text = cleanText(type).toLowerCase();
  return text.includes("series") || text.includes("parallel") || text.includes("k-out") || text.includes("串") || text.includes("并") || text.includes("中取")
    ? type
    : "";
}

function relationLabel(relation, k, n) {
  if (relation === "parallel") return "并联";
  if (relation === "k_out_of_n") return `${n} 中取 ${k}`;
  if (relation === "series") return "串联";
  return "叶产品";
}

function relationParameter(relation, k, n) {
  if (relation === "k_out_of_n") return `至少 ${n} 个子节点中的 ${k} 个成功`;
  return `${n} 个子节点${relation === "parallel" ? "并联" : "串联"}`;
}

function nodeType(node, hasChildren) {
  if (hasChildren) return cleanText(node.type) || "group";
  return cleanText(node.type) || "product";
}

function parseParameterText(value) {
  if (typeof value !== "string") return {};
  const parsed = {};
  const pattern = /([A-Za-z\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)\s*=\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  for (const match of value.matchAll(pattern)) parsed[match[1]] = Number(match[2]);
  return parsed;
}

function convertTime(rawValue, rawUnit) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return { ok: false, reason: "parameter" };
  const unit = normalizedUnit(rawUnit);
  const factors = new Map([
    ["", 1], ["h", 1], ["hr", 1], ["hrs", 1], ["hour", 1], ["hours", 1], ["小时", 1],
    ["min", 1 / 60], ["mins", 1 / 60], ["minute", 1 / 60], ["minutes", 1 / 60], ["分钟", 1 / 60],
    ["d", 24], ["day", 24], ["days", 24], ["天", 24]
  ]);
  if (!factors.has(unit)) return { ok: false, reason: "unit", unit: rawUnit };
  return { ok: true, value: value * factors.get(unit) };
}

function convertRate(rawValue, rawUnit) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) return { ok: false, reason: "parameter" };
  const unit = normalizedUnit(rawUnit).replace("per", "1/");
  const factors = new Map([
    ["", 1], ["1/h", 1], ["/h", 1], ["h^-1", 1], ["h-1", 1], ["1/hour", 1], ["failures/hour", 1], ["次/小时", 1], ["小时^-1", 1],
    ["1/min", 60], ["/min", 60], ["min^-1", 60], ["1/minute", 60], ["次/分钟", 60],
    ["1/d", 1 / 24], ["/d", 1 / 24], ["d^-1", 1 / 24], ["1/day", 1 / 24], ["次/天", 1 / 24]
  ]);
  if (!factors.has(unit)) return { ok: false, reason: "unit", unit: rawUnit };
  return { ok: true, value: value * factors.get(unit) };
}

function normalizedUnit(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "").replace("／", "/");
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return 0.5 * (1 + erf);
}

function boundedProbability(value) {
  if (!Number.isFinite(value)) return NaN;
  return Math.max(0, Math.min(1, value));
}

function positiveFinite(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function hasReliabilityParameters(component) {
  return Boolean(
    component?.failureDistribution
    || component?.failureRate !== undefined
    || component?.mtbfHours !== undefined
    || component?.mtbf !== undefined
    || component?.reliability !== undefined
  );
}

function uniqueDerivedRootId(componentIds, aircraftModel) {
  const suffix = cleanText(aircraftModel).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "aircraft";
  const base = `aircraft-reliability-root-${suffix}`;
  if (!componentIds.has(base)) return base;
  let index = 2;
  while (componentIds.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function validObjectRows(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function invalidGraph(code, message, details = {}) {
  return { ok: false, code, message, details };
}

function validationError(code, message, nodeId) {
  return { code, message, ...(nodeId ? { nodeId } : {}) };
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}
