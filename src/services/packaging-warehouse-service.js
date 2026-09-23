import { getVilniusDate } from "../domain/scale-check.js";

export class PackagingWarehouseService {
  constructor(repository) { this.repository = repository; this.records = []; this.summary = []; this.error = null; }
  snapshot() { return { records: [...this.records], summary: [...this.summary], error: this.error }; }
  async refresh() { try { const data = await this.repository.list(); this.records = data.records; this.summary = data.summary; this.error = null; } catch (error) { this.error = error.message; } return this.snapshot(); }
  async save(input, account) { const record = validate(input, account); await this.repository.save(record); return this.refresh(); }
  async remove(id) { await this.repository.remove(id); return this.refresh(); }
}

function validate(input, account) {
  const date = String(input?.date || ""); const type = String(input?.type || ""); const item = String(input?.item || "").trim(); const quantity = Number(input?.quantity); const note = String(input?.note || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > getVilniusDate()) throw new Error("Дата должна быть сегодняшней или более ранней");
  if (!["Приход", "Расход"].includes(type)) throw new Error("Выберите приход или расход");
  if (!item || !Number.isInteger(quantity) || quantity <= 0) throw new Error("Укажите наименование и целое положительное количество");
  if (note.length > 500) throw new Error("Примечание не должно превышать 500 символов");
  return { ...(input.id ? { id: input.id } : {}), date, type, item, quantity, note, author: String(account?.title || account?.id || "Рабочая учётная запись") };
}
