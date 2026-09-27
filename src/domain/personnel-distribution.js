function unique(values) {
  return [...new Set((values ?? []).map(value => String(value || "").trim()).filter(Boolean))];
}

export function shuffle(values, random = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function distributePersonnel({ lines = [], operatorIds = [], packerIds = [] }, random = Math.random) {
  const selectedLines = unique(lines);
  const operators = shuffle(unique(operatorIds), random);
  const packers = shuffle(unique(packerIds), random);
  return {
    lines: selectedLines.map((line, index) => ({ line, operatorId: operators[index] || "", packerId: packers[index] || "" })),
    unassignedOperatorIds: operators.slice(selectedLines.length),
    unassignedPackerIds: packers.slice(selectedLines.length)
  };
}
