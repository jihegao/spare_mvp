export function seriesReliability(values) {
  return values.reduce((product, value) => product * Number(value), 1);
}

export function parallelReliability(values) {
  const failureProduct = values.reduce((product, value) => product * (1 - Number(value)), 1);
  return 1 - failureProduct;
}

export function kOfNReliability(k, values) {
  const probabilities = values.map(Number);
  let probability = 0;
  for (let mask = 0; mask < 2 ** probabilities.length; mask += 1) {
    let successes = 0;
    let term = 1;
    for (let index = 0; index < probabilities.length; index += 1) {
      const success = Boolean(mask & (1 << index));
      successes += success ? 1 : 0;
      term *= success ? probabilities[index] : 1 - probabilities[index];
    }
    if (successes >= k) probability += term;
  }
  return probability;
}

export function evaluateReliabilityGroup(group, nodeReliabilityById) {
  const values = group.children.map((id) => nodeReliabilityById[id]);
  if (group.type === "parallel") return parallelReliability(values);
  if (group.type === "k_of_n") return kOfNReliability(group.k || 1, values);
  return seriesReliability(values);
}

export function evaluateBottomUpReliability(project, nodeResults) {
  const reliabilityById = Object.fromEntries(nodeResults.map((row) => [row.nodeId, row.reliability]));
  const rootGroup = project.reliabilityGroups?.find((group) => group.parentNodeId === project.rootId);
  if (!rootGroup) return seriesReliability(nodeResults.map((row) => row.reliability));
  return evaluateReliabilityGroup(rootGroup, reliabilityById);
}
