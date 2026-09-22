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
