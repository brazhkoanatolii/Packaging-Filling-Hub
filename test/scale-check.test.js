import test from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  calculateResult,
  getVilniusDate,
  validateScaleCheck
} from "../src/domain/scale-check.js";
import { MODULES, SCALES } from "../src/config/app-config.js";
import { JournalService } from "../src/services/journal-service.js";

const journal = { nominal: 50, tolerance: 0.05 };

test("вес на границе допуска принимается", () => {
  assert.equal(calculateResult(49.95, 50, 0.05), "В пределах допуска");
  assert.equal(calculateResult(50.05, 50, 0.05), "В пределах допуска");
});

test("вес за границей допуска отмечается", () => {
  assert.equal(calculateResult(49.94, 50, 0.05), "Вне допуска");
  assert.equal(calculateResult(50.06, 50, 0.05), "Вне допуска");
});

test("нулевое значение не считается пустым", () => {
  const value = validateScaleCheck({
    date: "2026-09-17",
    scaleName: "WTC 600 (F10)",
    actual: 0,
    condition: "Нерабочие",
    performer: "Anatolii Brazhko",
    note: "Тест"
  }, journal);
  assert.equal(value.actual, 0);
  assert.equal(value.result, "Вне допуска");
});

test("отклонение считается так же, как в Google Sheets: номинал минус факт", () => {
  const value = validateScaleCheck({
    date: "2026-09-18",
    scaleName: "WTC 600 (F10)",
    actual: 49.98,
    condition: "Рабочие",
    performer: "Anatolii Brazhko"
  }, journal);
  assert.equal(value.deviation, 0.02);
});

test("исполнитель обязателен перед каждой записью", () => {
  assert.throws(() => validateScaleCheck({
    date: "2026-09-17",
    scaleName: "WTC 600 (F10)",
    actual: 50,
    condition: "Рабочие",
    performer: ""
  }, journal), error => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.fields.performer, "Выберите исполнителя");
    return true;
  });
});

test("дата формируется в часовом поясе Europe/Vilnius", () => {
  const nearMidnightUtc = new Date("2026-01-01T22:30:00.000Z");
  assert.equal(getVilniusDate(nearMidnightUtc), "2026-01-02");
});

test("быстрый обход содержит все 13 весов из рабочего листа", () => {
  assert.equal(SCALES.length, 13);
  assert.deepEqual(SCALES.map(scale => scale.name), Array.from({ length: 13 }, (_, index) => `WTC 600 (F${index + 1})`));
});

test("разделы расположены в согласованном рабочем порядке", () => {
  assert.deepEqual(MODULES.map(module => module.id), [
    "dashboard", "attendance", "journals",
    "specifications", "cyclones", "personnel",
    "vacations", "statistics", "settings"
  ]);
  assert.notEqual(MODULES.find(module => module.id === "vacations").managerOnly, true);
  assert.equal(MODULES.find(module => module.id === "statistics").managerOnly, true);
  assert.equal(MODULES.find(module => module.id === "settings").managerOnly, true);
});

test("пакет весов полностью проверяется до создания первой записи", async () => {
  const saved = [];
  const repository = { async save(record) { saved.push(record); return record; } };
  const service = new JournalService(repository, { id: "scale-check-50g", nominal: 50, tolerance: 0.05 });
  const valid = { date: "2026-09-18", scaleName: "WTC 600 (F1)", actual: 50, condition: "Рабочие", performer: "Тест" };
  await assert.rejects(service.createBatch([valid, { ...valid, scaleName: "WTC 600 (F2)", actual: "" }], { title: "Старший механик" }), ValidationError);
  assert.equal(saved.length, 0);
});
