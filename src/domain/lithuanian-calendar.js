const FIXED_HOLIDAYS = Object.freeze([
  [1, 1, "Новый год"],
  [2, 16, "День восстановления Литовского государства"],
  [3, 11, "День восстановления независимости Литвы"],
  [5, 1, "День труда"],
  [6, 24, "Йонинес"],
  [7, 6, "День государственности"],
  [8, 15, "Успение Пресвятой Богородицы"],
  [11, 1, "День всех святых"],
  [11, 2, "День поминовения усопших"],
  [12, 24, "Сочельник"],
  [12, 25, "Рождество"],
  [12, 26, "Второй день Рождества"]
]);

export function lithuanianHolidays(year) {
  const holidays = FIXED_HOLIDAYS.map(([month, day, name]) => holiday(year, month, day, name));
  const easter = westernEaster(year);
  holidays.push(
    holidayDate(easter, "Пасха"),
    holidayDate(addDays(easter, 1), "Пасхальный понедельник"),
    holidayDate(firstSunday(year, 5), "День матери"),
    holidayDate(firstSunday(year, 6), "День отца")
  );
  return holidays.sort((left, right) => left.date.localeCompare(right.date));
}

export function lithuanianCalendarDay(value) {
  const date = dateKey(value);
  if (!date) return { date: String(value || ""), isHoliday: false, isPreholiday: false, holidays: [], preholidayFor: [] };
  const year = Number(date.slice(0, 4));
  const holidays = lithuanianHolidays(year).filter(item => item.date === date);
  const nextDate = dateKey(addDays(new Date(`${date}T12:00:00Z`), 1));
  const preholidayFor = lithuanianHolidays(Number(nextDate.slice(0, 4))).filter(item => item.date === nextDate);
  return { date, isHoliday: holidays.length > 0, isPreholiday: preholidayFor.length > 0, holidays, preholidayFor };
}

function holiday(year, month, day, name) { return { date: isoDate(year, month, day), name }; }
function holidayDate(date, name) { return { date: dateKey(date), name }; }
function isoDate(year, month, day) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function dateKey(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
}
function addDays(date, days) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 12)); }
function firstSunday(year, month) {
  const date = new Date(Date.UTC(year, month - 1, 1, 12));
  return addDays(date, (7 - date.getUTCDay()) % 7);
}

// Meeus/Jones/Butcher Gregorian computus. Lithuania uses Western Easter.
function westernEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}
