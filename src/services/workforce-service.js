import { ATTENDANCE_CODES, SHIFT_TEAMS, WORKFORCE_PERSONNEL } from "../config/workforce-config.js";

const PERSONNEL_KEY = "workforcePersonnel";
const TEAMS_KEY = "workforceShiftTeams";
const ATTENDANCE_KEY = "workforceAttendance";

export class WorkforceService {
  constructor(store, repository = null) {
    this.store = store;
    this.repository = repository;
  }

  async initialize() {
    if (this.repository) return this.repository.initialize();
    if (!await this.store.preference(PERSONNEL_KEY)) await this.store.setPreference(PERSONNEL_KEY, clone(WORKFORCE_PERSONNEL));
    if (!await this.store.preference(TEAMS_KEY)) await this.store.setPreference(TEAMS_KEY, clone(SHIFT_TEAMS));
    if (!await this.store.preference(ATTENDANCE_KEY)) await this.store.setPreference(ATTENDANCE_KEY, []);
    return this.snapshot();
  }

  async snapshot() {
    if (this.repository) return this.repository.snapshot();
    return {
      personnel: await this.store.preference(PERSONNEL_KEY, clone(WORKFORCE_PERSONNEL)),
      shiftTeams: await this.store.preference(TEAMS_KEY, clone(SHIFT_TEAMS)),
      attendance: await this.store.preference(ATTENDANCE_KEY, []),
      vacations: await this.store.preference("workforceVacations", []),
      years: [2027, 2028, 2029]
    };
  }

  async saveEmployee(input) {
    const personnel = (await this.snapshot()).personnel;
    const fullName = String(input?.fullName ?? "").trim();
    if (fullName.length < 2) throw new Error("Укажите имя и фамилию");
    if (!Object.hasOwn(input, "role") || !String(input.role)) throw new Error("Выберите должность");
    const now = new Date().toISOString();
    const currentIndex = personnel.findIndex(item => item.id === input.id);
    const employee = {
      id: currentIndex >= 0 ? personnel[currentIndex].id : `employee-${crypto.randomUUID()}`,
      fullName,
      role: String(input.role),
      shiftTeamId: String(input.shiftTeamId || "office"),
      active: input.active !== false,
      updatedAt: now
    };
    if (currentIndex >= 0) personnel[currentIndex] = { ...personnel[currentIndex], ...employee };
    else personnel.push({ ...employee, createdAt: now });
    if (this.repository) await this.repository.save("personnel", employee);
    else await this.store.setPreference(PERSONNEL_KEY, personnel);
    return employee;
  }

  async toggleEmployee(id) {
    const personnel = (await this.snapshot()).personnel;
    const index = personnel.findIndex(item => item.id === id);
    if (index < 0) throw new Error("Сотрудник не найден");
    personnel[index] = { ...personnel[index], active: personnel[index].active === false, updatedAt: new Date().toISOString() };
    if (this.repository) await this.repository.save("personnel", personnel[index]);
    else await this.store.setPreference(PERSONNEL_KEY, personnel);
    return personnel[index];
  }

  async saveShiftTeam(input) {
    const teams = (await this.snapshot()).shiftTeams;
    const index = teams.findIndex(item => item.id === input.id);
    if (index < 0) throw new Error("Смена не найдена");
    const accountingHours = numberBetween(input.accountingHours, 1, 24, "Укажите учётные часы");
    const shiftDurationHours = numberBetween(input.shiftDurationHours, accountingHours, 24, "Проверьте длительность смены");
    teams[index] = {
      ...teams[index],
      name: String(input.name || teams[index].name).trim(),
      anchorDate: String(input.anchorDate || teams[index].anchorDate),
      shiftDurationHours,
      accountingHours,
      updatedAt: new Date().toISOString()
    };
    if (this.repository) await this.repository.save("shiftTeams", teams[index]);
    else await this.store.setPreference(TEAMS_KEY, teams);
    return teams[index];
  }

  async saveAttendance(input) {
    const value = String(input?.value ?? "").trim();
    const fullHours = Array.from({ length: 24 }, (_, index) => String(index + 1));
    if (![...ATTENDANCE_CODES.map(item => item.value), ...fullHours].includes(value)) throw new Error("Недопустимое значение табеля");
    const snapshot = await this.snapshot();
    if (this.repository && !snapshot.years.includes(Number(String(input.date).slice(0, 4)))) throw new Error("Этот год ещё не подключён. Табель создан на 2027–2029 годы.");
    const attendance = snapshot.attendance;
    const id = `${input.date}:${input.shiftTeamId}:${input.employeeId}`;
    const record = { id, date: input.date, shiftTeamId: input.shiftTeamId, employeeId: input.employeeId, value, overtime: input.overtime === true, updatedAt: new Date().toISOString() };
    const index = attendance.findIndex(item => item.id === id);
    if (index >= 0) attendance[index] = record;
    else attendance.push(record);
    if (this.repository) await this.repository.save("attendance", record);
    else await this.store.setPreference(ATTENDANCE_KEY, attendance);
    return record;
  }

  async saveVacation(input) {
    const snapshot = await this.snapshot();
    const year = Number(input.year);
    if (!snapshot.years.includes(year)) throw new Error("Выберите год 2027–2029");
    if (!snapshot.personnel.some(p => p.id === input.employeeId)) throw new Error("Выберите сотрудника");
    const startDate = String(input.startDate || ""), endDate = String(input.endDate || "");
    if (!startDate || !endDate || startDate > endDate || Number(startDate.slice(0, 4)) !== year || Number(endDate.slice(0, 4)) !== year) throw new Error("Укажите начало и окончание в пределах выбранного года");
    if (!["Запланирован", "Согласован", "Использован", "Аннулирован"].includes(input.status)) throw new Error("Выберите статус отпуска");
    if (input.status === "Аннулирован" && !String(input.note || "").trim()) throw new Error("Укажите причину аннулирования");
    const record = { id: input.id || `vacation:${crypto.randomUUID()}`, employeeId: input.employeeId, year, startDate, endDate, status: input.status, note: String(input.note || ""), days: Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1 };
    if (!Number.isFinite(record.days)) throw new Error("Проверьте даты");
    if (this.repository) await this.repository.save("vacations", record);
    else {
      const rows = snapshot.vacations.filter(v => v.id !== record.id);
      await this.store.setPreference("workforceVacations", [...rows, record]);
    }
    return record;
  }
}

export function getScheduleDay(team, value) {
  const date = parseDate(value);
  const anchor = parseDate(team.anchorDate);
  if (!date || !anchor) return { date: String(value), scheduled: false, accountingHours: 0, shiftDurationHours: 0 };
  const difference = Math.round((utcDay(date) - utcDay(anchor)) / 86_400_000);
  const cycleLength = Math.max(1, Number(team.cycleLengthDays) || 4);
  const offset = ((difference % cycleLength) + cycleLength) % cycleLength;
  const scheduled = (team.workDayOffsets ?? [0, 1]).map(Number).includes(offset);
  return {
    date: dateKey(date),
    scheduled,
    accountingHours: scheduled ? Number(team.accountingHours) : 0,
    shiftDurationHours: scheduled ? Number(team.shiftDurationHours) : 0
  };
}

export function getScheduleMonth(team, year, monthIndex) {
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: dayCount }, (_, index) => getScheduleDay(team, new Date(year, monthIndex, index + 1)));
}

function parseDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function utcDay(value) { return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()); }
function dateKey(value) { return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-"); }
function clone(value) { return structuredClone(value); }
function numberBetween(value, minimum, maximum, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(message);
  return number;
}
