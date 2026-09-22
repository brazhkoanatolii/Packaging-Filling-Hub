import { getVilniusDate, makeId } from "../domain/scale-check.js";

const CACHE_KEY = "nonconformityJournalCache";

export class NonconformityService {
  constructor(store, repository) { this.store = store; this.repository = repository; }
  async snapshot() { const cached = await this.store.preference(CACHE_KEY, null); return { records: cached?.records ?? [], source: cached ? "cache" : "loading", cachedAt: cached?.cachedAt ?? null, error: null }; }
  async refresh() {
    try { const result = await this.repository.list(); const snapshot = { records: normalizeRecords(result.records), dictionary: normalizeDictionary(result.dictionary), cachedAt: new Date().toISOString() }; await this.store.setPreference(CACHE_KEY, snapshot); return { ...snapshot, source: "google", error: null }; }
    catch (error) { const cached = await this.snapshot(); return { ...cached, dictionary: cached.dictionary ?? { types: [] }, error: error.message }; }
  }
  async create(input, people) { return this.#save("create", input, people); }
  async update(id, input, people) { return this.#save("update", { ...input, id }, people); }
  async remove(id) { if (!id) throw new Error("Не найдена запись"); await this.repository.remove(id); const current = await this.snapshot(); await this.store.setPreference(CACHE_KEY, { ...current, records: current.records.filter(record => record.id !== id), cachedAt: new Date().toISOString() }); }
  async #save(method, input, people = []) {
    const record = validate(input, people); const saved = normalizeRecord(await this.repository[method](record)); const current = await this.snapshot();
    await this.store.setPreference(CACHE_KEY, { ...current, records: [saved, ...current.records.filter(item => item.id !== saved.id)], cachedAt: new Date().toISOString() }); return saved;
  }
}

function validate(input, people) {
  const text = (key, label, limit = 5000) => { const value = String(input[key] || "").trim(); if (!value) throw new Error(`Заполните поле «${label}»`); if (value.length > limit) throw new Error(`Поле «${label}» слишком длинное`); return value; };
  const date = String(input.date || getVilniusDate()); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > getVilniusDate()) throw new Error("Дата должна быть сегодняшней или более ранней");
  const shift = text("shift", "Смена", 2).toUpperCase(); if (!["A", "B"].includes(shift)) throw new Error("Смена должна быть определена из табеля");
  const responsible = text("responsible", "Ответственный", 180); if (people.length && !people.includes(responsible)) throw new Error("Выберите ответственного из присутствующих на смене");
  return { id: String(input.id || ""), requestId: String(input.requestId || makeId("nonconformity")), date, shift, category: text("category", "Категория", 180), type: text("type", "Вид несоответствия", 500), cause: text("cause", "Причина появления"), correctiveAction: text("correctiveAction", "Корректирующие действия"), responsible, status: text("status", "Отметка о выполнении", 100) };
}
function normalizeRecords(records = []) { return records.map(normalizeRecord).filter(Boolean); }
function normalizeRecord(record) { if (!record?.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(record.date || ""))) return null; return { id: String(record.id), requestId: String(record.requestId || ""), rowNumber: Number(record.rowNumber || 0), date: String(record.date), shift: String(record.shift || "").toUpperCase(), category: String(record.category || ""), type: String(record.type || ""), cause: String(record.cause || ""), correctiveAction: String(record.correctiveAction || ""), responsible: String(record.responsible || ""), status: String(record.status || "") }; }
function normalizeDictionary(value) { return { types: Array.from(new Set((value?.types ?? []).map(item => String(item || "").trim()).filter(Boolean))) }; }
