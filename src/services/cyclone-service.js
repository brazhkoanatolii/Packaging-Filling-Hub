import { getVilniusDate, makeId } from "../domain/scale-check.js";

export class CycloneService {
  constructor(repository) { this.repository = repository; this.error = null; }

  async snapshot() {
    return { records: await this.repository.list(), operations: await this.repository.pending(),
      lastReadAt: await this.repository.lastReadAt(), error: this.error };
  }

  async refresh() {
    try { await this.repository.refresh(); this.error = null; }
    catch (error) { this.error = error.message; }
    return this.snapshot();
  }

  async sync() {
    try { await this.repository.sync(); this.error = null; }
    catch (error) { this.error = error.message; }
    return this.refreshPreservingError();
  }

  async refreshPreservingError() {
    const writeError = this.error;
    await this.refresh();
    if (writeError) this.error = writeError;
    return this.snapshot();
  }

  async create(input, account, names) {
    if (!["manager", "senior"].includes(account?.role)) throw new Error("Войдите в рабочую учётную запись");
    const date = String(input.date || "");
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > getVilniusDate()) throw new Error("Выберите существующую дату не позже сегодняшней");
    const performer = String(input.performer || "").trim();
    if (!names.includes(performer)) throw new Error("Выберите исполнителя из справочника персонала");
    return this.repository.create({ id: makeId("cyclone"), date, performer, createdAt: new Date().toISOString() });
  }
}

export function cycloneStatistics(records, year) {
  const months = Array(12).fill(0);
  const people = new Map();
  for (const record of records) {
    if (record.syncState !== "synced" || !record.date.startsWith(`${year}-`)) continue;
    months[Number(record.date.slice(5, 7)) - 1]++;
    people.set(record.performer, (people.get(record.performer) || 0) + 1);
  }
  return { months, total: months.reduce((sum, count) => sum + count, 0), people: [...people].sort((a, b) => b[1] - a[1]) };
}
