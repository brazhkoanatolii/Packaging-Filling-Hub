import test from "node:test";
import assert from "node:assert/strict";
import {
  ValidationError,
  calculateResult,
  getVilniusDate,
  validateScaleCheck
} from "../src/domain/scale-check.js";

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
