import { getVilniusDate, makeId } from "../domain/scale-check.js";

export const PACKAGING_FIELDS = Object.freeze([
  { key: "garantBox430", label: "Коробки с логотипом GARANT 430×285×255, шт" },
  { key: "garantBox570", label: "Коробки с логотипом Garant (узкая) 570×210×249, шт" },
  { key: "dochemsPaper", label: "Бумага Dochems 37 GSM, рул" },
  { key: "killaCanClear", label: "Банка килла прозрачная, шт" },
  { key: "killaCanGreen", label: "Банка килла зелёная, шт" },
  { key: "killaLidGreen", label: "Крышка килла зелёная, шт" },
  { key: "dzCanClear", label: "Банка ДЗ прозрачная, шт" },
  { key: "dzCanGreen", label: "Банка ДЗ зелёная, шт" },
  { key: "dzLidBlack", label: "Крышка ДЗ чёрная, шт" },
  { key: "dzLidWhite", label: "Крышка ДЗ белая, шт" }
]);

export class PackagingService {
  constructor(repository) { this.repository = repository; this.error = null; }
  async snapshot() { return { records: await this.repository.list(), operations: await this.repository.pending(), lastReadAt: await this.repository.lastReadAt(), error: this.error }; }
  async refresh() { try { await this.repository.refresh(); this.error = null; } catch (error) { this.error = error.message; } return this.snapshot(); }
  async sync() { try { await this.repository.sync(); this.error = null; } catch (error) { this.error = error.message; } return this.refreshPreservingError(); }
  async refreshPreservingError() { const writeError = this.error; await this.refresh(); if (writeError) this.error = writeError; return this.snapshot(); }

  async create(input, account) {
    if (!["manager", "senior"].includes(account?.role)) throw new Error("Войдите в рабочую учётную запись");
    const date = String(input.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > getVilniusDate()) throw new Error("Дата должна быть сегодняшней или более ранней");
    const values = Object.fromEntries(PACKAGING_FIELDS.map(({ key, label }) => {
      const raw = String(input[key] ?? "").trim().replace(",", ".");
      const value = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Поле «${label}» должно быть неотрицательным числом`);
      return [key, value];
    }));
    if (!Object.values(values).some(value => value > 0)) throw new Error("Укажите расход хотя бы по одному виду упаковки");
    return this.repository.create({ id: makeId("packaging"), date, values, author: account.title, createdAt: new Date().toISOString() });
  }
}
