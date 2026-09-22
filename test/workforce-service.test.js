import test from "node:test";
import assert from "node:assert/strict";
import { SHIFT_TEAMS, WORKFORCE_PERSONNEL } from "../src/config/workforce-config.js";
import { WorkforceService, getScheduleDay, getScheduleMonth } from "../src/services/workforce-service.js";

function createStore(initial = {}) {
  const preferences = new Map(Object.entries(initial));
  return {
    async preference(key, fallback = null) { return preferences.has(key) ? structuredClone(preferences.get(key)) : fallback; },
    async setPreference(key, value) { preferences.set(key, structuredClone(value)); return value; }
  };
}

test("перенесён актуальный состав участка", () => {
  assert.equal(WORKFORCE_PERSONNEL.length, 31);
  assert.equal(WORKFORCE_PERSONNEL.filter(employee => employee.shiftTeamId === "shift-team-a").length, 16);
  assert.equal(WORKFORCE_PERSONNEL.filter(employee => employee.shiftTeamId === "shift-team-b" && employee.active).length, 15);
  assert.equal(WORKFORCE_PERSONNEL.filter(employee => employee.shiftTeamId === "office").length, 0);
  assert.equal(WORKFORCE_PERSONNEL.filter(employee => employee.role === "senior-mechanic" && employee.active).length, 2);
  assert.equal(WORKFORCE_PERSONNEL.find(employee => employee.id === "employee-0001").role, "mechanic");
  assert.deepEqual(WORKFORCE_PERSONNEL.find(employee => employee.id === "employee-0013").pakNumber, "PAK 1");
  assert.deepEqual(WORKFORCE_PERSONNEL.find(employee => employee.id === "employee-0013").pakCode, "1-G");
  assert.equal(WORKFORCE_PERSONNEL.some(employee => employee.id === "employee-0018"), false);
});

test("график смен A и B повторяет цикл 2 через 2", () => {
  assert.equal(getScheduleDay(SHIFT_TEAMS[0], "2026-07-01").scheduled, true);
  assert.equal(getScheduleDay(SHIFT_TEAMS[0], "2026-07-02").scheduled, true);
  assert.equal(getScheduleDay(SHIFT_TEAMS[0], "2026-07-03").scheduled, false);
  assert.equal(getScheduleDay(SHIFT_TEAMS[1], "2026-07-03").scheduled, true);

  const septemberA = getScheduleMonth(SHIFT_TEAMS[0], 2026, 8);
  const septemberB = getScheduleMonth(SHIFT_TEAMS[1], 2026, 8);
  assert.equal(septemberA.filter(day => day.scheduled).length, 14);
  assert.equal(septemberB.filter(day => day.scheduled).length, 16);
});

test("персонал, настройки смен и табель сохраняются", async () => {
  const service = new WorkforceService(createStore());
  const initial = await service.initialize();
  assert.equal(initial.personnel.length, 31);
  assert.equal(initial.shiftTeams.length, 2);

  await service.saveEmployee({ id: "employee-0001", fullName: "Albert Krevski", role: "senior-mechanic", shiftTeamId: "shift-team-b", pakNumber: "PAK 20", pakCode: "1-Z" });
  await service.saveEmployee({ id: "employee-0009", fullName: "Hanna Khalypenko", role: "packer", shiftTeamId: "shift-team-a", pakNumber: "PAK 3", pakCode: "1-A" });
  await service.saveShiftTeam({ id: "shift-team-a", name: "Смена A · день", anchorDate: "2026-07-01", shiftDurationHours: 12, accountingHours: 10 });
  await service.saveAttendance({ date: "2026-09-19", shiftTeamId: "shift-team-a", employeeId: "employee-0002", value: "L" });

  const saved = await service.snapshot();
  assert.equal(saved.personnel.find(employee => employee.id === "employee-0001").shiftTeamId, "shift-team-b");
  assert.equal(saved.personnel.find(employee => employee.id === "employee-0001").pakCode, "");
  assert.equal(saved.personnel.find(employee => employee.id === "employee-0009").pakCode, "1-A");
  assert.equal(saved.shiftTeams.find(team => team.id === "shift-team-a").accountingHours, 10);
  assert.equal(saved.attendance[0].id, "2026-09-19:shift-team-a:employee-0002");
  assert.equal(saved.attendance[0].value, "L");
});

test("старая локальная установка получает актуальный состав из справочника", async () => {
  const stalePersonnel = [
    { id: "employee-0001", fullName: "Albert Krevski", role: "senior-mechanic", shiftTeamId: "shift-team-a", phone: "+37000000000" },
    { id: "employee-0015", fullName: "Danuta Jankovskaja", role: "packer", shiftTeamId: "shift-team-a" },
    { id: "employee-admin-0001", fullName: "Anatolii Brazhko", role: "head-of-area", shiftTeamId: "office" }
  ];
  const service = new WorkforceService(createStore({ workforcePersonnel: stalePersonnel }));
  const snapshot = await service.initialize();
  assert.equal(snapshot.personnel.length, 31);
  assert.equal(snapshot.personnel.some(person => person.id === "employee-0015"), true);
  assert.equal(snapshot.personnel.some(person => person.id === "employee-admin-0001"), false);
  assert.equal(snapshot.personnel.find(person => person.id === "employee-0001").role, "mechanic");
  assert.equal(snapshot.personnel.find(person => person.id === "employee-0001").phone, "+37000000000");
  assert.equal(snapshot.personnel.find(person => person.id === "employee-0015").pakNumber, "PAK 2");
});

test("администрация не попадает в табель и график отпусков участка", async () => {
  const service = new WorkforceService(createStore());
  await service.initialize();

  await assert.rejects(
    service.saveAttendance({ date: "2026-09-19", shiftTeamId: "office", employeeId: "employee-admin-0001", value: "8" }),
    /только сотрудников смен/
  );
  await assert.rejects(
    service.saveVacation({ employeeId: "employee-admin-0001", year: 2026, startDate: "2026-06-01", endDate: "2026-06-14", status: "Запланирован" }),
    /только сотрудника участка/
  );
});

test("литовские коды отсутствия сохраняются в табеле", async () => {
  const service = new WorkforceService(createStore());
  await service.initialize();
  const record = await service.saveAttendance({ date: "2026-09-19", shiftTeamId: "shift-team-a", employeeId: "employee-0002", value: "NS" });
  assert.equal(record.value, "NS");
});

test("подменный выход сохраняется в табеле отдельной записью целевой смены", async () => {
  const service = new WorkforceService(createStore());
  await service.initialize();

  const record = await service.saveAttendance({
    date: "2026-09-19",
    shiftTeamId: "shift-team-b",
    employeeId: "employee-0002",
    value: "11",
    substitutionReason: "Подработка",
    homeShiftTeamId: "shift-team-a"
  });

  assert.equal(record.id, "2026-09-19:shift-team-b:employee-0002");
  assert.equal(record.value, "11");
  assert.equal(record.substitutionReason, "Подработка");
  assert.equal(record.homeShiftTeamId, "shift-team-a");
});

test("сотрудник другого отдела сохраняется как подмена текущей смены", async () => {
  const service = new WorkforceService(createStore({
    workforcePersonnel: [{ id: "employee-office-1", fullName: "Упаковщик другого отдела", role: "packer", shiftTeamId: "office", active: true }],
    workforcePersonnelSourceVersion: 3
  }));
  await service.initialize();

  const record = await service.saveAttendance({
    date: "2026-09-22", shiftTeamId: "shift-team-a", employeeId: "employee-office-1", value: "11",
    substitutionReason: "Производственная необходимость", homeShiftTeamId: "office"
  });

  assert.equal(record.employeeId, "employee-office-1");
  assert.equal(record.homeShiftTeamId, "office");
});
