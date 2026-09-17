const ALLOWED_STATES = new Set(["Рабочие", "Нерабочие"]);

export class ValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

export class ConflictError extends Error {
  constructor(message, currentRecord) {
    super(message);
    this.name = "ConflictError";
    this.currentRecord = currentRecord;
  }
}

export function makeId(prefix = "record") {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

export function validateScaleCheck(input, journal) {
  const fields = {};
  const actual = Number(input.actual);

  if (!input.date) fields.date = "Укажите дату проверки";
  if (!input.scaleName) fields.scaleName = "Выберите весы";
  if (input.actual === "" || input.actual === null || input.actual === undefined) {
    fields.actual = "Введите фактический вес";
  } else if (!Number.isFinite(actual) || actual < 0) {
    fields.actual = "Введите корректное положительное число";
  }
  if (!ALLOWED_STATES.has(input.condition)) fields.condition = "Выберите состояние весов";
  if (!input.performer) fields.performer = "Выберите исполнителя";

  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Проверьте заполнение формы", fields);
  }

  return {
    date: input.date,
    scaleName: input.scaleName.trim(),
    nominal: journal.nominal,
    actual,
    deviation: round(actual - journal.nominal, 3),
    condition: input.condition,
    result: calculateResult(actual, journal.nominal, journal.tolerance),
    performer: input.performer,
    note: String(input.note ?? "").trim()
  };
}

export function calculateResult(actual, nominal, tolerance) {
  return Math.abs(Number(actual) - Number(nominal)) <= Number(tolerance) + Number.EPSILON
    ? "В пределах допуска"
    : "Вне допуска";
}

export function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
}

export function getVilniusDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Vilnius",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Vilnius",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

