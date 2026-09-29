import test from "node:test";
import assert from "node:assert/strict";
import { WorkforceRepository } from "../src/repositories/workforce-repository.js";

function createStore(initial) {
  let value = structuredClone(initial);
  return {
    async preference() { return structuredClone(value); },
    async setPreference(_key, next) { value = structuredClone(next); }
  };
}

test("новая запись попадает в очередь, пока Google отправляет предыдущую", async () => {
  let releaseWrite;
  let signalWrite;
  const writeStarted = new Promise(resolve => { signalWrite = resolve; });
  const first = attendance("first");
  const second = attendance("second");
  const provider = {
    writesEnabled: true,
    async write(operation) {
      if (operation.record.id === first.id) {
        signalWrite();
        await new Promise(resolve => { releaseWrite = resolve; });
      }
      return { record: { ...operation.record, revision: "1" } };
    },
    async snapshot() { return { personnel: [], shiftTeams: [], attendance: [], vacations: [], years: [2026] }; }
  };
  const repository = new WorkforceRepository(createStore({
    confirmed: { personnel: [], shiftTeams: [], attendance: [], vacations: [], years: [2026], ready: true },
    pending: [operation(first)], lastSync: null
  }), provider, () => ({ performer: "Viktor Mini" }));

  const syncing = repository.sync();
  await writeStarted;
  await repository.save("attendance", second);
  assert.equal((await repository.snapshot()).pending.length, 2);
  releaseWrite();
  await syncing;
});

function attendance(id) {
  return { id, date: "2026-09-22", shiftTeamId: "shift-team-a", employeeId: `employee-${id}`, value: "11", updatedAt: "2026-09-22T10:00:00.000Z" };
}

function operation(record) {
  return { requestId: `request-${record.id}`, kind: "attendance", record, expectedRevision: "empty", actor: { performer: "Viktor Mini" }, status: "pending", attempted: false };
}

test("конфликт отпуска отправляет локальную версию только после явного выбора", async () => {
  const remoteRecord = { id: "vacation-1", employeeId: "employee-0002", revision: "google-revision" };
  const localRecord = { ...remoteRecord, startDate: "2026-09-19", endDate: "2026-10-02", status: "Запланирован" };
  const provider = {
    writesEnabled: true,
    async snapshot() { return { personnel: [], shiftTeams: [], attendance: [], vacations: [remoteRecord], years: [2026] }; },
    async write(operation) {
      assert.equal(operation.expectedRevision, "google-revision");
      assert.equal(operation.status, "pending");
      return { record: { ...operation.record, revision: "saved-revision" } };
    }
  };
  const repository = new WorkforceRepository(createStore({
    confirmed: { personnel: [], shiftTeams: [], attendance: [], vacations: [remoteRecord], years: [2026], ready: true },
    pending: [{ requestId: "request-vacation-1", kind: "vacations", record: localRecord, expectedRevision: "stale", actor: { performer: "Anatolii Brazhko" }, status: "conflict", attempted: true }],
    lastSync: null
  }), provider, () => ({ performer: "Anatolii Brazhko" }));

  await repository.overwriteVacationConflict("request-vacation-1");
  const snapshot = await repository.snapshot();
  assert.equal(snapshot.pending.length, 0);
  assert.equal(snapshot.vacations[0].startDate, "2026-09-19");
});
