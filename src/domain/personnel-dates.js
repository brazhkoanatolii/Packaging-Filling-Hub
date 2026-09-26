function parseIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? { year, month, day } : null;
}

function asLocalDate(value) {
  const parsed = parseIsoDate(value);
  return parsed ? new Date(parsed.year, parsed.month - 1, parsed.day) : null;
}

export function completedYears(value, reference = new Date()) {
  const date = asLocalDate(value);
  if (!date || !Number.isFinite(reference?.getTime?.())) return null;
  let years = reference.getFullYear() - date.getFullYear();
  const anniversaryDay = Math.min(date.getDate(), new Date(reference.getFullYear(), date.getMonth() + 1, 0).getDate());
  if (new Date(reference.getFullYear(), date.getMonth(), anniversaryDay) > reference) years -= 1;
  return years >= 0 ? years : null;
}

export function formatPersonnelAge(value, reference = new Date()) {
  const years = completedYears(value, reference);
  return years === null ? "Не указана" : `${years} полных лет`;
}

export function formatPersonnelExperience(value, reference = new Date()) {
  const date = asLocalDate(value);
  if (!date || !Number.isFinite(reference?.getTime?.())) return "Не указан";
  let years = reference.getFullYear() - date.getFullYear();
  let months = reference.getMonth() - date.getMonth();
  if (reference.getDate() < date.getDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  return years < 0 ? "Не указан" : `${years} г. ${months} мес.`;
}
