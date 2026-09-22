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
}

test("расход упаковки суммируется за день и сохраняет выбранного ответственного", async () => {
  const repository = new MemoryRepository();
  const service = new PackagingService(repository);
  const input = { date: getVilniusDate(), item: "garantBox430", quantity: "12", author: "Viktor Mini" };
  await service.add(input, { title: "Начальник участка" });
  const record = await service.add({ ...input, quantity: "8", author: "Albert Krevski" }, { title: "Начальник участка" });
  assert.equal(record.values.garantBox430, 20);
  assert.equal(record.author, "Albert Krevski");
});

test("расход упаковки принимает только целое положительное количество", async () => {
  const service = new PackagingService(new MemoryRepository());
  const base = { date: getVilniusDate(), item: "garantBox430", author: "Viktor Mini" };
  for (const quantity of ["", "0", "1.5", "-2"]) {
    await assert.rejects(service.add({ ...base, quantity }, { title: "Начальник участка" }), /целым положительным числом/);
  }
});
