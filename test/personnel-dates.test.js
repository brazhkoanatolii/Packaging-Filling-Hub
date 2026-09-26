import test from "node:test";
import assert from "node:assert/strict";
import { completedYears, formatPersonnelAge, formatPersonnelExperience } from "../src/domain/personnel-dates.js";

const today = new Date(2026, 8, 26);

test("возраст считает только полные годы", () => {
  assert.equal(completedYears("1999-02-28", today), 27);
  assert.equal(completedYears("2000-09-27", today), 25);
  assert.equal(formatPersonnelAge("2000-09-26", today), "26 полных лет");
});

test("стаж показывает завершённые годы и месяцы", () => {
  assert.equal(formatPersonnelExperience("2023-11-21", today), "2 г. 10 мес.");
  assert.equal(formatPersonnelExperience("2026-09-27", today), "Не указан");
});
