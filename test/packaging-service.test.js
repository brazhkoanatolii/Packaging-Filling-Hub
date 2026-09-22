import test from "node:test";
import assert from "node:assert/strict";
import { getVilniusDate } from "../src/domain/scale-check.js";
import { PackagingService } from "../src/services/packaging-service.js";

class MemoryRepository {
  records = [];
  async list() { return structuredClone(this.records); }
  async save(record) {
    const value = { ...record, syncState: "pending" };
    this.records = [...this.records.filter(item => item.id !== value.id), value];
    return structuredClone(value);
  }
  async exportDaily(date) { this.exportedDate = date; return { ok: true, date }; }
}

test("расход упаковки суммируется в одной дневной записи без выбора автора", async () => {
  const repository = new MemoryRepository();
  const service = new PackagingService(repository);
  const input = { date: getVilniusDate(), item: "garantBox430", quantity: "12" };
  await service.add(input);
  const record = await service.add({ ...input, quantity: "8" });
  assert.equal(record.values.garantBox430, 20);
  assert.equal(record.author, undefined);
});

test("расход упаковки принимает только целое положительное количество", async () => {
  const service = new PackagingService(new MemoryRepository());
  const base = { date: getVilniusDate(), item: "garantBox430" };
  for (const quantity of ["", "0", "1.5", "-2"]) {
    await assert.rejects(service.add({ ...base, quantity }, { title: "Начальник участка" }), /целым положительным числом/);
  }
});

test("суточная передача разрешена только после окончания дня", async () => {
  const repository = new MemoryRepository();
  const service = new PackagingService(repository);
  const yesterday = new Date(`${getVilniusDate()}T12:00:00`); yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().slice(0, 10);
  await service.exportDaily(date);
  assert.equal(repository.exportedDate, date);
  await assert.rejects(service.exportDaily(getVilniusDate()), /завершённый день/);
});
