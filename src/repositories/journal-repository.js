import { ConflictError, makeId } from "../domain/scale-check.js";

export class JournalRepository {
  constructor(localProvider, remoteProvider) {
    this.local = localProvider;
    this.remote = remoteProvider;
  }

  async init(seedRecords = []) {
    await this.remote.init(seedRecords);
    if ((await this.local.getAll("records")).length === 0) {
      for (const record of seedRecords) await this.local.put("records", record);
    }
  }

  async list() {
    const records = await this.local.getAll("records");
    return records.sort((a, b) => `${b.date}${b.updatedAt}`.localeCompare(`${a.date}${a.updatedAt}`));
  }

  async get(id) {
    return this.local.get("records", id);
  }

  async save(record, { type, expectedVersion, actor }) {
    const now = new Date().toISOString();
    const localRecord = {
      ...record,
      updatedAt: now,
      updatedBy: actor,
      syncState: "pending"
    };
    await this.local.put("records", localRecord);
    await this.local.put("operations", {
      id: makeId("op"),
      requestId: makeId("request"),
      record: localRecord,
      recordId: localRecord.id,
      type,
      expectedVersion,
      createdAt: now,
      attempts: 0,
      state: "pending",
      error: null
    });
    return localRecord;
  }

  async pendingOperations() {
    return (await this.local.getAll("operations"))
      .filter(item => item.state !== "done")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async sync() {
    const operations = await this.pendingOperations();
    const result = { sent: 0, conflicts: 0, failed: 0 };

    for (const operation of operations) {
      if (operation.state === "conflict") continue;
      try {
        const saved = await this.remote.write(operation);
        await this.local.put("records", saved);
        await this.local.put("operations", { ...operation, state: "done", error: null });
        result.sent += 1;
      } catch (error) {
        if (error instanceof ConflictError || error.name === "ConflictError") {
          await this.local.put("operations", {
            ...operation,
            state: "conflict",
            attempts: operation.attempts + 1,
            error: error.message,
            remoteRecord: error.currentRecord
          });
          const record = await this.get(operation.recordId);
          if (record) await this.local.put("records", { ...record, syncState: "conflict" });
          result.conflicts += 1;
          continue;
        }
        await this.local.put("operations", {
          ...operation,
          state: "pending",
          attempts: operation.attempts + 1,
          error: error.message
        });
        result.failed += 1;
        if (error.name === "OfflineError") break;
      }
    }
    return result;
  }

  async refresh() {
    const remoteRecords = await this.remote.list();
    const pendingIds = new Set((await this.pendingOperations()).map(item => item.recordId));
    for (const record of remoteRecords) {
      if (!pendingIds.has(record.id)) await this.local.put("records", record);
    }
    return this.list();
  }
}

