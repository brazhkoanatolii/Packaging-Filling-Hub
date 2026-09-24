import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { CycloneRepository } from "../src/repositories/cyclone-repository.js";
import { CycloneService, cycloneStatistics, pendingCycloneCleaningDates } from "../src/services/cyclone-service.js";
import { CycloneGatewayProvider } from "../src/providers/cyclone-gateway-provider.js";

class MemoryStore {
  data = { records: new Map(), operations: new Map(), preferences: new Map() };
  fail = false;
  async getAll(store) { return structuredClone([...this.data[store].values()]); }
  async put(store, value) { this.data[store].set(value.id ?? value.key, structuredClone(value)); }
  async preference(key) { return this.data.preferences.get(key)?.value ?? null; }
  async batch(changes) {
    if (this.fail) throw new Error("Disk full");
    for (const c of changes) {
      if (c.deleteKey !== undefined) this.data[c.store].delete(c.deleteKey);
      else await this.put(c.store, c.value);
    }
  }
}

const record = { id: "cyclone-test-1", date: "2026-01-15", performer: "Employee" };
test("очистки: сетевой вызов сохраняет браузерный контекст fetch", async () => {
  const provider = new CycloneGatewayProvider({ fetchImpl: async function () {
    assert.equal(this, globalThis);
    return { ok: true, json: async () => ({ ok: true, records: [] }) };
  } });
  assert.deepEqual(await provider.list(), []);
});
test("очистки: обрыв ответа, перезапуск и повторная отправка сохраняют requestId и не создают дубликат", async () => {
  const store = new MemoryStore();
  const remoteRows = new Map();
  let lostResponse = true;
  const remote = { async write(op) {
    if (!remoteRows.has(op.requestId)) remoteRows.set(op.requestId, { ...op.record, syncState: "synced" });
    if (lostResponse) { lostResponse = false; throw new Error("Connection lost"); }
    return remoteRows.get(op.requestId);
  }, async list() { return [...remoteRows.values()]; } };
  const repo = new CycloneRepository(store, remote);
  await repo.create(record);
  await assert.rejects(repo.sync(), /Connection lost/);
  const pending = await repo.pending();
  assert.equal(pending.length, 1);
  const restarted = new CycloneRepository(store, remote);
  await Promise.all([restarted.sync(), restarted.sync()]);
  assert.equal(remoteRows.size, 1);
  assert.equal((await restarted.pending()).length, 0);
  assert.equal((await restarted.list())[0].syncState, "synced");
});

test("очистки: неуспешная локальная транзакция не оставляет запись без очереди", async () => {
  const local = new MemoryStore(); local.fail = true;
  const repo = new CycloneRepository(local, {});
  await assert.rejects(repo.create(record), /Disk full/);
  assert.deepEqual(await repo.list(), []);
  assert.deepEqual(await repo.pending(), []);
});

test("очистки: обновление Google сохраняет очередь, но удаляет устаревший кэш", async () => {
  const local = new MemoryStore();
  const repo = new CycloneRepository(local, { async list() { return []; } });
  await repo.create(record);
  await local.put("records", { ...record, id: "old-google", syncState: "synced" });
  await repo.refresh();
  assert.deepEqual((await repo.list()).map(r => r.id), [record.id]);
  assert.equal((await repo.pending()).length, 1);
});

test("очистки: роли, действительная дата и выбор исполнителя обязательны", async () => {
  const service = new CycloneService(new CycloneRepository(new MemoryStore(), {}));
  for (const input of [{ date: "2026-02-30", performer: "Employee" }, { date: "2099-01-01", performer: "Employee" }, { date: "2026-01-01", performer: "Unknown" }]) {
    await assert.rejects(service.create(input, { role: "manager" }, ["Employee"]));
  }
  await assert.rejects(service.create(record, null, ["Employee"]));
  for (const role of ["manager", "senior"]) assert.equal((await service.create(record, { role }, ["Employee"])).syncState, "pending");
});

test("очистки: статистика учитывает год и только подтверждённые записи", () => {
  const stats = cycloneStatistics([
    { ...record, syncState: "synced" }, { ...record, date: "2025-01-15", syncState: "synced" },
    { ...record, syncState: "pending" }, { ...record, date: "2026-12-31", syncState: "synced" }
  ], 2026);
  assert.equal(stats.total, 2); assert.equal(stats.months[0], 1); assert.equal(stats.months[11], 1);
  assert.deepEqual(stats.people, [["Employee", 2]]);
});

test("очистки: напоминание закрывается очисткой, выполненной в соответствующей половине месяца", () => {
  assert.deepEqual(pendingCycloneCleaningDates([], "2026-09-01"), ["2026-09-01"]);
  assert.deepEqual(pendingCycloneCleaningDates([{ date: "2026-09-01" }], "2026-09-14"), []);
  assert.deepEqual(pendingCycloneCleaningDates([{ date: "2026-09-01" }], "2026-09-15"), ["2026-09-15"]);
  assert.deepEqual(pendingCycloneCleaningDates([{ date: "2026-09-15" }], "2026-09-23"), ["2026-09-01"]);
  assert.deepEqual(pendingCycloneCleaningDates([{ date: "2026-09-01" }, { date: "2026-09-18" }], "2026-09-23"), []);
});

test("очистки: отказ Google сохраняет ошибку и очередь, без ложного подтверждения", async () => {
  const provider = new CycloneGatewayProvider({ fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false, message: "Запись выключена" }) }) });
  const repo = new CycloneRepository(new MemoryStore(), provider);
  const service = new CycloneService(repo);
  await repo.create(record);
  const result = await service.sync();
  assert.match(result.error, /Запись выключена/);
  assert.equal(result.operations.length, 1);
  assert.equal(result.records[0].syncState, "pending");
});

function scriptFixture(enabled = true) {
  const rows = [[new Date("2025-03-01T12:00:00Z"), "Employee"]];
  const notes = [[""]];
  let writes = 0;
  const sheet = { getSheetId: () => 0, getMaxRows: () => 999, getLastRow: () => rows.length + 3,
    getRange(row, col, count) { return {
      getDisplayValues: () => [["Дата", "Имя, Фамилия"]],
      getValues: () => rows.slice(row - 4, row - 4 + count), getNotes: () => notes.slice(row - 4, row - 4 + count)
    }; }
  };
  const context = vm.createContext({ Date, JSON, PropertiesService: { getScriptProperties: () => ({ getProperty: () => enabled ? "true" : "false" }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
    Utilities: { formatDate: date => date.toISOString().slice(0, 10) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    listPersonnel: () => ({ personnel: [{ fullName: "Employee", active: true }] }),
    Sheets: { Spreadsheets: { batchUpdate(batch, id) {
      assert.equal(id, "1jEpmScclwvmIhhiHnBi0EE5kRBGNLtfmP4zepkAMQDU");
      const update = batch.requests.find(r => r.updateCells).updateCells;
      assert.equal(update.start.columnIndex, 0);
      const values = update.rows[0].values;
      rows.push([new Date((values[0].userEnteredValue.numberValue - 25569) * 86400000), values[1].userEnteredValue.stringValue]);
      notes.push([values[0].note]); writes++;
    } } }
  });
  vm.runInContext(readFileSync(new URL("../apps-script/cyclone-journal-api.gs", import.meta.url), "utf8"), context);
  return { context, rows, get writes() { return writes; } };
}

test("Apps Script: чтение не пишет; атомарный повтор не дублирует строку и сохраняет старые записи", () => {
  const f = scriptFixture();
  const oldRow = structuredClone(f.rows[0]);
  assert.equal(f.context.listCycloneRecords().records.length, 1);
  assert.equal(f.writes, 0);
  const input = { recordId: "cyclone-test-123", requestId: "request-test-123", date: "2026-01-15", performer: "Employee", role: "senior" };
  const first = f.context.createCycloneRecord(input);
  const retry = f.context.createCycloneRecord(input);
  assert.equal(first.record.id, retry.record.id);
  assert.equal(f.writes, 1); assert.equal(f.rows.length, 2);
  assert.deepEqual(f.rows[0], oldRow);
  assert.throws(() => f.context.createCycloneRecord({ ...input, date: "2026-01-16" }), /другой записи/);
});

test("Apps Script: выключенная запись и неизвестный сотрудник не меняют журнал", () => {
  const f = scriptFixture(false);
  assert.throws(() => f.context.createCycloneRecord({}), /выключена/); assert.equal(f.writes, 0);
  const enabled = scriptFixture();
  assert.throws(() => enabled.context.createCycloneRecord({ recordId: "cyclone-test-123", requestId: "request-test-123", date: "2026-01-15", performer: "Unknown", role: "manager" }), /персонале/);
  assert.equal(enabled.writes, 0);
});
