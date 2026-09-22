import { getVilniusDate } from "../domain/scale-check.js";
export const PACKAGING_FIELDS = Object.freeze([
  { key: "garantBox430", label: "Коробки с логотипом GARANT (широкая) 430×285×255, шт" }, { key: "garantBox570", label: "Коробки с логотипом Garant (узкая) 570×210×249, шт" }, { key: "dochemsPaper", label: "Бумага Dochems 37 GSM, рул" }, { key: "killaCanClear", label: "Банка килла прозрачная, шт" }, { key: "killaCanGreen", label: "Банка килла зелёная, шт" }, { key: "killaLidGreen", label: "Крышка килла зелёная, шт" }, { key: "dzCanClear", label: "Банка ДЗ прозрачная, шт" }, { key: "dzCanGreen", label: "Банка ДЗ зелёная, шт" }, { key: "dzLidBlack", label: "Крышка ДЗ чёрная, шт" }, { key: "dzLidWhite", label: "Крышка ДЗ белая, шт" }
]);
const emptyValues = () => Object.fromEntries(PACKAGING_FIELDS.map(field => [field.key, 0]));
export class PackagingService {
  constructor(repository) { this.repository = repository; this.error = null; }
  async snapshot() { return { records: await this.repository.list(), operations: await this.repository.pending(), lastReadAt: await this.repository.lastReadAt(), error: this.error }; }
  async refresh() { try { await this.repository.refresh(); this.error = null; } catch (error) { this.error = error.message; } return this.snapshot(); }
  async sync() { try { await this.repository.sync(); this.error = null; } catch (error) { this.error = error.message; } const writeError = this.error; await this.refresh(); if (writeError) this.error = writeError; return this.snapshot(); }
  async add(input) { const date = validDate(input.date); const item = PACKAGING_FIELDS.find(field => field.key === input.item); if (!item) throw new Error("Выберите вид упаковки"); const quantity = positiveInteger(input.quantity); const current = (await this.repository.list()).find(record => record.date === date); return this.repository.save({ ...(current || {}), id: current?.id || `packaging-day-${date}`, date, values: { ...emptyValues(), ...(current?.values || {}), [item.key]: Number(current?.values?.[item.key] || 0) + quantity } }); }
  async update(record, input) { return this.repository.save({ ...record, date: validDate(input.date), values: values(input) }); }
  async remove(record) { if (!record?.id) throw new Error("Не найдена дневная запись"); return this.repository.remove(record); }
}
function validDate(value) { const date = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > getVilniusDate()) throw new Error("Дата должна быть сегодняшней или более ранней"); return date; }
function positiveInteger(value) { const text = String(value ?? "").trim(); if (!/^\d+$/.test(text) || Number(text) <= 0) throw new Error("Количество указывается целым положительным числом"); return Number(text); }
function values(input) { const result = Object.fromEntries(PACKAGING_FIELDS.map(field => { const n = Number(String(input[field.key] ?? "").replace(",", ".")); if (!Number.isFinite(n) || n < 0) throw new Error(`Поле «${field.label}» должно быть неотрицательным числом`); return [field.key, n]; })); if (!Object.values(result).some(n => n > 0)) throw new Error("Укажите расход хотя бы по одному виду упаковки"); return result; }
