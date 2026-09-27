import test from "node:test";
import assert from "node:assert/strict";
import { SHIFT_TEAMS } from "../src/config/workforce-config.js";
import { getScaleControlReminder } from "../src/domain/scale-control-reminder.js";

test("напоминание первого дня смены исчезает после четырёх проверок", () => {
  const team = SHIFT_TEAMS[0];
  const date = "2026-09-27";
  assert.deepEqual(getScaleControlReminder({ date, team, records: [] }), { day: 1, recordCount: 0, minimum: 4 });
  const records = Array.from({ length: 4 }, (_, index) => ({ id: String(index), date }));
  assert.equal(getScaleControlReminder({ date, team, records }), null);
});

test("во второй день смены напоминание есть только если в первый не было проверок", () => {
  const team = SHIFT_TEAMS[0];
  const date = "2026-09-28";
  assert.deepEqual(getScaleControlReminder({ date, team, records: [] }), { day: 2, recordCount: 0, minimum: 4, firstDayRecordCount: 0 });
  assert.equal(getScaleControlReminder({ date, team, records: [{ date: "2026-09-27" }] }), null);
});
