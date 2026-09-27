import test from "node:test";
import assert from "node:assert/strict";
import { SHIFT_TEAMS } from "../src/config/workforce-config.js";
import { getScaleControlReminder } from "../src/domain/scale-control-reminder.js";

test("напоминание первого дня смены исчезает после четырёх разных весов", () => {
  const team = SHIFT_TEAMS[0];
  const date = "2026-09-27";
  assert.deepEqual(getScaleControlReminder({ date, team, records: [] }), { day: 1, recordCount: 0, minimum: 4 });
  const repeatedScale = Array.from({ length: 4 }, (_, index) => ({ id: String(index), date, scaleName: "WTC 600 (F1)" }));
  assert.deepEqual(getScaleControlReminder({ date, team, records: repeatedScale }), { day: 1, recordCount: 1, minimum: 4 });
  const differentScales = Array.from({ length: 4 }, (_, index) => ({ id: String(index), date, scaleName: `WTC 600 (F${index + 1})` }));
  assert.equal(getScaleControlReminder({ date, team, records: differentScales }), null);
});

test("во второй день смены напоминание есть только если в первый не было проверок", () => {
  const team = SHIFT_TEAMS[0];
  const date = "2026-09-28";
  assert.deepEqual(getScaleControlReminder({ date, team, records: [] }), { day: 2, recordCount: 0, minimum: 4, firstDayRecordCount: 0 });
  assert.equal(getScaleControlReminder({ date, team, records: [{ date: "2026-09-27", scaleName: "WTC 600 (F1)" }] }), null);
});
