import test from "node:test";
import assert from "node:assert/strict";
import { getVilniusDate } from "../src/domain/scale-check.js";
import { ProductionService } from "../src/services/production-service.js";

class MemoryStore {
  values = new Map();
  async preference(key, fallback) { return this.values.get(key) ?? fallback; }
  async setPreference(key, value) { this.values.set(key, structuredClone(value)); }
}

class MemoryRepository {
  async create(record) { return { ...record, id: "production-1" }; }
}

const people = {
  packers: ["Упаковщик 1"],
  operators: ["Оператор 1", "Оператор 2"]
};

function record(overrides = {}) {
  return {
    requestId: "request-1", date: getVilniusDate(), startTime: "07:30", time: "10:00",
    product: "Test", strength: "40", quantity: "2400", scrapKg: "0", canScrapKg: "0",
    packer: "Упаковщик 1", operator: "Оператор 1", machineLine: "A", shift: "A", note: "",
    ...overrides
  };
}

test("личная запись упаковщика может содержать двух разных механиков-операторов", async () => {
  const service = new ProductionService(new MemoryStore(), new MemoryRepository());
  const saved = await service.create(record({ operatorSecond: "Оператор 2" }), people);
  assert.equal(saved.packer, "Упаковщик 1");
  assert.equal(saved.operator, "Оператор 1 + Оператор 2");
  assert.deepEqual(saved.operators, ["Оператор 1", "Оператор 2"]);
});

test("одного механика-оператора нельзя выбрать дважды", async () => {
  const service = new ProductionService(new MemoryStore(), new MemoryRepository());
  await assert.rejects(service.create(record({ operatorSecond: "Оператор 1" }), people), /должен отличаться/);
});
