import test from "node:test";
import assert from "node:assert/strict";
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

test("в центральном режиме смена берётся из общего провайдера, а не из IndexedDB", async () => {
  const calls = [];
  const remote = {
    async current() { calls.push("current"); return { active: true, shiftTeamId: "shift-team-b", shiftDate: "2026-09-25" }; },
    async update(action, payload) { calls.push({ action, payload }); return { active: true, ...payload }; }
  };
  const service = new ShiftService(createStore(), remote);
  assert.equal((await service.current()).shiftTeamId, "shift-team-b");
  await service.updateAttendance(attendance);
  assert.deepEqual(calls, ["current", { action: "update-attendance", payload: { attendance } }]);
});
