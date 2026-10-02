import test from "node:test";
import assert from "node:assert/strict";
import { lithuanianCalendarDay, lithuanianHolidays } from "../src/domain/lithuanian-calendar.js";
import { SHIFT_TEAMS } from "../src/config/workforce-config.js";
import { getScheduleDay } from "../src/services/workforce-service.js";

test("календарь Литвы включает переходящие праздники 2026 года", () => {
  const holidays = lithuanianHolidays(2026);
  assert.equal(holidays.some(item => item.date === "2026-04-05" && item.name === "Пасха"), true);
  assert.equal(holidays.some(item => item.date === "2026-04-06" && item.name === "Пасхальный понедельник"), true);
  assert.equal(holidays.some(item => item.date === "2026-05-03" && item.name === "День матери"), true);
  assert.equal(holidays.some(item => item.date === "2026-06-07" && item.name === "День отца"), true);
});

test("предпраздничный день отмечается и сокращает плановую смену на час", () => {
  const calendar = lithuanianCalendarDay("2026-07-05");
  const shift = getScheduleDay(SHIFT_TEAMS[0], "2026-07-05");
  assert.equal(calendar.isPreholiday, true);
  assert.equal(shift.scheduled, true);
  assert.equal(shift.accountingHours, 10);
  assert.equal(shift.shiftDurationHours, 11);
});
