import test from "node:test";
import assert from "node:assert/strict";
import { ConflictError } from "../src/domain/scale-check.js";
import { JournalRepository } from "../src/repositories/journal-repository.js";

test("старые демонстрационные данные сохранены локально, но не отображаются и не отправляются", async () => {
  const local = new MemoryProvider();
  const demo = record({ id: "demo-old", source: "demo" });
  const real = record({ id: "real", source: "google" });
  await local.put("records", demo);
  await local.put("records", real);
  await local.put("operations", { id: "demo-op", state: "pending", recordId: demo.id, record: demo });
  let writes = 0;
  const remote = { async write() { writes++; } };
  const repository = new JournalRepository(local, remote);
  assert.deepEqual((await repository.list()).map(item => item.id), ["real"]);
  await repository.sync();
  assert.equal(writes, 0);
  assert.equal((await local.getAll("records")).length, 2);
  assert.equal((await local.getAll("operations")).length, 1);
});

class MemoryProvider {
  constructor() {
    this.stores = new Map();
  }

  bucket(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return this.stores.get(name);
  }

  async get(name, id) { return this.bucket(name).get(id); }
  async getAll(name) { return [...this.bucket(name).values()]; }
  async put(name, value) { this.bucket(name).set(value.id, structuredClone(value)); return value; }
  async delete(name, id) { this.bucket(name).delete(id); }
}

class RemoteProvider {
  constructor({ conflict = false, failure = null } = {}) {
    this.conflict = conflict;
    this.failure = failure;
  }
  async init() {}
  async list() { return []; }
  async write(operation) {
    if (this.conflict) throw new ConflictError("Версия изменилась", { ...operation.record, version: 7 });
    if (this.failure) throw this.failure;
    return { ...operation.record, version: operation.expectedVersion + 1, syncState: "synced" };
  }
}

function record(overrides = {}) {
  return {
    id: "scale-1",
    date: "2026-09-17",
    updatedAt: "2026-09-17T10:00:00.000Z",
    version: 0,
    ...overrides
  };
}

test("локальная запись создаёт операцию и после синхронизации отмечается отправленной", async () => {
  const local = new MemoryProvider();
  const repository = new JournalRepository(local, new RemoteProvider());
  await repository.save(record(), { type: "create", expectedVersion: 0, actor: "Тест" });
  assert.equal((await repository.pendingOperations()).length, 1);
  assert.equal((await repository.get("scale-1")).syncState, "pending");

  const result = await repository.sync();
  assert.equal(result.sent, 1);
  assert.equal((await repository.pendingOperations()).length, 0);
  assert.equal((await repository.get("scale-1")).syncState, "synced");
});

test("конфликт версий не перезаписывается молча", async () => {
  const local = new MemoryProvider();
  const repository = new JournalRepository(local, new RemoteProvider({ conflict: true }));
  await repository.save(record({ version: 2 }), { type: "update", expectedVersion: 2, actor: "Тест" });

  const result = await repository.sync();
  assert.equal(result.conflicts, 1);
  assert.equal((await repository.pendingOperations())[0].state, "conflict");
  assert.equal((await repository.get("scale-1")).syncState, "conflict");
});

test("ошибка сети оставляет операцию в очереди для повторной отправки", async () => {
  const local = new MemoryProvider();
  const offlineError = new Error("Нет подключения к сети");
  offlineError.name = "OfflineError";
  const repository = new JournalRepository(local, new RemoteProvider({ failure: offlineError }));
  await repository.save(record(), { type: "create", expectedVersion: 0, actor: "Тест" });

  const result = await repository.sync();
  assert.equal(result.failed, 1);
  const [operation] = await repository.pendingOperations();
  assert.equal(operation.state, "pending");
  assert.equal(operation.attempts, 1);
});

test("после обновления из Google удаляется только устаревший синхронизированный кэш", async () => {
  const local = new MemoryProvider();
  const remote = new RemoteProvider();
  remote.list = async () => [record({ id: "google-current", source: "google", syncState: "synced" })];
  await local.put("records", record({ id: "google-removed", source: "google", syncState: "synced" }));
  await local.put("records", record({ id: "offline-pending", source: "local", syncState: "pending" }));
  await local.put("operations", { id: "operation-1", recordId: "offline-pending", record: record({ id: "offline-pending" }), state: "pending", createdAt: "2026-09-21T18:00:00.000Z" });
  const repository = new JournalRepository(local, remote);

  await repository.refresh();

  assert.equal(await local.get("records", "google-removed"), undefined);
  assert.ok(await local.get("records", "google-current"));
  assert.ok(await local.get("records", "offline-pending"));
});
