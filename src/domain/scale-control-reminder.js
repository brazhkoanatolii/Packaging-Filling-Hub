import { getScheduleDay } from "../services/workforce-service.js";

export const SCALE_REMINDER_MINIMUM = 4;

export function getScaleControlReminder({ date, team, records = [], minimum = SCALE_REMINDER_MINIMUM }) {
  if (!team || !getScheduleDay(team, date).scheduled) return null;
  const previousDate = dayBefore(date);
  const firstWorkDay = !getScheduleDay(team, previousDate).scheduled;
  const countFor = value => records.filter(record => record?.date === value && record?.status !== "Аннулировано").length;

  if (firstWorkDay) {
    const recordCount = countFor(date);
    return recordCount >= minimum ? null : { day: 1, recordCount, minimum };
  }

  const firstDayRecordCount = countFor(previousDate);
  return firstDayRecordCount === 0 ? { day: 2, recordCount: 0, minimum, firstDayRecordCount } : null;
}

export function dayBefore(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
