import test from "node:test";
import assert from "node:assert/strict";
import { getVilniusDate } from "../src/domain/scale-check.js";
import { ShiftService } from "../src/services/shift-service.js";

function createStore() {
  const preferences = new Map();
  return {
    async preference(key) { return preferences.get(key) ?? null; },
    async setPreference(key, value) { preferences.set(key, value); return value; }
  };
}

const attendance = [
  { employeeId: "employee-01", status: "present" },
  { employeeId: "employee-02", status: "absent" }
];

test("первая смена требует контроль всех 13 весов", async () => {
  const service = new ShiftService(createStore());
  const shift = await service.start({ supervisor: "Старший", shiftNumber: 1, shiftTeamId: "shift-team-a", attendance });
  assert.equal(shift.requiresScaleControl, true);
  assert.equal(shift.shiftTeamId, "shift-team-a");
  assert.equal(shift.weightsCompletedAt, null);

  assert.equal((await service.completeScaleControl(12)).weightsCompletedAt, null);
  const completed = await service.completeScaleControl(13);
  assert.ok(completed.weightsCompletedAt);
  assert.equal(completed.scaleControlRecordCount, 13);
});

test("вторая смена не блокируется контролем весов", async () => {
  const service = new ShiftService(createStore());
  const shift = await service.start({ supervisor: "Старший", shiftNumber: 2, attendance });
  assert.equal(shift.requiresScaleControl, false);
  assert.ok(shift.weightsCompletedAt);
});

test("вчерашняя активная смена не блокирует начало сегодняшней", async () => {
  const store = createStore();
  await store.setPreference("activeShift", { active: true, shiftDate: "2000-01-01", shiftTeamId: "shift-team-b" });
  const shift = await new ShiftService(store).start({ supervisor: "Старший", shiftTeamId: "shift-team-a", shiftDate: getVilniusDate(), attendance });
  assert.equal(shift.shiftTeamId, "shift-team-a");
  assert.equal(shift.shiftDate, getVilniusDate());
});

test("отметки табеля можно исправить в активной смене", async () => {
  const service = new ShiftService(createStore());
  await service.start({ supervisor: "Старший", shiftNumber: 1, attendance });
  const updated = await service.updateAttendance([
    { employeeId: "employee-01", status: "sick" },
    { employeeId: "employee-02", status: "present" }
  ]);
  assert.deepEqual(updated.attendance, [
    { employeeId: "employee-01", status: "sick" },
    { employeeId: "employee-02", status: "present" }
  ]);
  assert.ok(updated.attendanceUpdatedAt);
});

test("исправление табеля сохраняет выбранных старшего механика и механика", async () => {
  const service = new ShiftService(createStore());
  await service.start({ supervisor: "Старший", mechanic: "Первый механик", shiftNumber: 1, attendance });
  const updated = await service.updateAttendance(attendance, { seniorMechanic: "Новый старший", mechanic: "Механик-оператор" });
  assert.equal(updated.seniorMechanic, "Новый старший");
  assert.equal(updated.supervisor, "Новый старший");
  assert.equal(updated.mechanic, "Механик-оператор");
});

test("механика можно снять с назначения, не отменяя старшего механика", async () => {
  const service = new ShiftService(createStore());
  await service.start({ supervisor: "Старший", mechanic: "Механик", shiftNumber: 1, attendance });
  const updated = await service.updateAttendance(attendance, { seniorMechanic: "Старший", mechanic: "" });
  assert.equal(updated.seniorMechanic, "Старший");
  assert.equal(updated.mechanic, "");
});

test("в центральном режиме смена берётся из общего провайдера, а не из IndexedDB", async () => {
  const calls = [];
  const remote = {
    async current() { calls.push("current"); return { active: true, shiftTeamId: "shift-team-b", shiftDate: "2026-09-25" }; },
    async update(action, payload) { calls.push({ action, payload }); return { active: true, ...payload }; }
  };
  const service = new ShiftService(createStore(), remote);
  assert.equal((await service.current()).shiftTeamId, "shift-team-b");
  await service.updateAttendance(attendance, { seniorMechanic: "Старший", mechanic: "Механик-оператор" });
  assert.deepEqual(calls, ["current", { action: "update-attendance", payload: { attendance, seniorMechanic: "Старший", mechanic: "Механик-оператор" } }]);
});
