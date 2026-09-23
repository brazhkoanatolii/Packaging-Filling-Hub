import { getVilniusDate, makeId } from "../domain/scale-check.js";

const LINES = Object.freeze(["A", "B", "D", "F", "H", "K", "L", "M"]);
const CACHE_KEY = "productionJournalCache";
const PARTICIPANT_SEPARATOR = " + ";

export class ProductionService {
  constructor(store, repository) { this.store = store; this.repository = repository; }

  async snapshot() {
    const cached = await this.store.preference(CACHE_KEY, null);
    return { records: cached?.records ?? [], source: cached ? "cache" : "loading", cachedAt: cached?.cachedAt ?? null, error: null };
  }

  async refresh() {
    try {
      const records = normalizeRecords(await this.repository.list());
      const cachedAt = new Date().toISOString();
      await this.store.setPreference(CACHE_KEY, { records, cachedAt });
      return { records, source: "google", cachedAt, error: null };
    } catch (error) {
      const cached = await this.snapshot();
      return { ...cached, error: error.message };
    }
  }

  async create(input, { packers = [], operators = [] } = {}) {
    const record = validateProductionRecord(input, { packers, operators });
    const saved = normalizeRecord(await this.repository.create(record));
    const current = await this.snapshot();
    const records = [saved, ...current.records.filter(item => item.id !== saved.id)];
    await this.store.setPreference(CACHE_KEY, { records, cachedAt: new Date().toISOString() });
    return saved;
  }

  async update(id, input, people = {}) {
    const record = validateProductionRecord({ ...input, requestId: id }, people);
    const saved = normalizeRecord(await this.repository.update(id, record));
    const current = await this.snapshot();
    await this.store.setPreference(CACHE_KEY, { records: [saved, ...current.records.filter(item => item.id !== id)], cachedAt: new Date().toISOString() });
    return saved;
  }

  async remove(id) {
    if (!String(id || "").trim()) throw new Error("Не найдена запись для удаления");
    await this.repository.remove(String(id));
    const current = await this.snapshot();
    await this.store.setPreference(CACHE_KEY, { records: current.records.filter(item => item.id !== id), cachedAt: new Date().toISOString() });
  }
}

export { LINES };

function validateProductionRecord(input, { packers, operators }) {
  const date = String(input.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > getVilniusDate()) throw new Error("Дата должна быть сегодняшней или более ранней");
  const time = validTime(input.time, "окончания");
  const startTime = validTime(input.startTime, "начала");
  const text = (key, label, limit = 180) => {
    const value = String(input[key] || "").trim();
    if (!value) throw new Error(`Заполните поле «${label}»`);
    if (value.length > limit) throw new Error(`Поле «${label}» слишком длинное`);
    return value;
  };
  const numeric = (key, label, positive = false) => {
    const value = Number(String(input[key] ?? "").replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || (positive && value <= 0)) throw new Error(`Поле «${label}» должно быть ${positive ? "положительным" : "неотрицательным"} числом`);
    return value;
  };
  const packer = text("packer", "Упаковщик");
  const operator = text("operator", "Механик-оператор");
  const operatorSecond = String(input.operatorSecond || "").trim();
  if (operatorSecond.length > 180) throw new Error("Поле «Второй механик-оператор» слишком длинное");
  if (!packers.includes(packer)) throw new Error("Выберите присутствующего упаковщика");
  if (!operators.includes(operator)) throw new Error("Выберите присутствующего механика-оператора");
  if (operatorSecond && !operators.includes(operatorSecond)) throw new Error("Выберите присутствующего второго механика-оператора");
  if (operatorSecond && operatorSecond === operator) throw new Error("Второй механик-оператор должен отличаться от первого");
  const line = text("machineLine", "Линия (машина)", 4).toUpperCase();
  if (!LINES.includes(line)) throw new Error("Выберите линию из рабочего списка");
  const shift = text("shift", "Смена", 2).toUpperCase();
  if (!["A", "B"].includes(shift)) throw new Error("Смена должна быть определена из табеля");
  const note = String(input.note || "").trim();
  if (note.length > 5000) throw new Error("Примечание не должно превышать 5000 символов");
  return {
    requestId: String(input.requestId || makeId("production-request")), date, startTime, time,
    product: text("product", "Продукт"), strength: numeric("strength", "Крепость", true),
    quantity: numeric("quantity", "Количество готовой продукции", true), scrapKg: numeric("scrapKg", "Брак продукции"),
    canScrapKg: numeric("canScrapKg", "Вес бракованных банок"), packer,
    operator: [operator, operatorSecond].filter(Boolean).join(PARTICIPANT_SEPARATOR), machineLine: line, shift, note
  };
}

function validTime(value, label) {
  const time = String(value || "");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Укажите время ${label} в формате ЧЧ:ММ`);
  return time;
}

function normalizeRecords(records) { return records.map(normalizeRecord).filter(Boolean); }
function normalizeRecord(value) {
  if (!value?.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.date || ""))) return null;
  const operator = String(value.operator || "");
  return { ...value, id: String(value.id), date: String(value.date), startTime: String(value.startTime || ""), time: String(value.time || ""), product: String(value.product || ""), line: String(value.line || value.machineLine || ""), shift: String(value.shift || "").toUpperCase(), strength: Number(value.strength), quantity: Number(value.quantity), scrapKg: Number(value.scrapKg), canScrapKg: Number(value.canScrapKg), packer: String(value.packer || ""), operator, operators: splitParticipants(operator), seniorMechanic: String(value.seniorMechanic || ""), mechanic: String(value.mechanic || ""), note: String(value.note || "") };
}

function splitParticipants(value) {
  return [...new Set(String(value || "").split(/\s+\+\s+/).map(item => item.trim()).filter(Boolean))].slice(0, 2);
}
