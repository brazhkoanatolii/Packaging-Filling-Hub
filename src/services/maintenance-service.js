import { CycloneService, cycloneStatistics } from "./cyclone-service.js";
import { getVilniusDate, makeId } from "../domain/scale-check.js";

export class MaintenanceService extends CycloneService {
  async snapshot() { return { ...await super.snapshot(), machines: await this.repository.machines(), performers: await this.repository.performers() }; }
  async create(input, account, names) {
    if (!["manager", "senior"].includes(account?.role)) throw new Error("Войдите в рабочую учётную запись");
    const machine = String(input.machine || "");
    if (!(await this.repository.machines()).some(m => m.id === machine)) throw new Error("Выберите станок из рабочего журнала");
    const date = String(input.date || "");
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > getVilniusDate()) throw new Error("Выберите существующую дату не позже сегодняшней");
    const performer = String(input.performer || "").trim();
    if (!names.includes(performer) || !(await this.repository.performers()).includes(performer)) throw new Error("Выберите исполнителя из справочника журнала ТО");
    const note = String(input.note || "").trim();
    if (note.length > 5000) throw new Error("Примечание должно быть не длиннее 5000 символов");
    return this.repository.create({ id: makeId("maintenance"), machine, date, performer, note, createdAt: new Date().toISOString() });
  }
}

export function maintenanceStatistics(records, year, machines = []) {
  const confirmed = records.filter(r => r.syncState === "synced");
  const years = new Map(), people = new Map();
  for (const r of confirmed) {
    const y = Number(r.date.slice(0, 4));
    years.set(y, (years.get(y) || 0) + 1);
    const p = people.get(r.performer) || { name: r.performer, total: 0, year: 0 };
    p.total++; if (y === year) p.year++;
    people.set(r.performer, p);
  }
  return { ...cycloneStatistics(confirmed, year), all: confirmed.length,
    years: [...years].sort((a,b) => a[0]-b[0]), people: [...people.values()].sort((a,b) => b.total-a.total),
    machines: machines.map(m => {
      const rows = confirmed.filter(r => r.machine === m.id);
      return { ...m, total: rows.length, year: rows.filter(r => Number(r.date.slice(0,4)) === year).length, last: rows.map(r => r.date).sort().at(-1) || null };
    }) };
}
