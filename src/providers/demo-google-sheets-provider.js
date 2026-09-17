import { ConflictError } from "../domain/scale-check.js";

export class DemoGoogleSheetsProvider {
  constructor(store) {
    this.store = store;
    this.mode = "demo";
  }

  async init(seedRecords) {
    const current = await this.store.getAll("remoteRecords");
    if (current.length === 0) {
      for (const record of seedRecords) await this.store.put("remoteRecords", record);
    }
  }

  async list() {
    this.#assertOnline();
    await delay(120);
    return this.store.getAll("remoteRecords");
  }

  async write(operation) {
    this.#assertOnline();
    await delay(160);
    const current = await this.store.get("remoteRecords", operation.record.id);

    if (operation.type !== "create") {
      if (!current) throw new ConflictError("Запись отсутствует в источнике", null);
      if (current.version !== operation.expectedVersion) {
        throw new ConflictError("Запись уже была изменена", current);
      }
    }

    const timestamp = new Date().toISOString();
    const saved = {
      ...operation.record,
      version: operation.type === "create" ? 1 : current.version + 1,
      updatedAt: timestamp,
      syncState: "synced",
      source: "demo"
    };
    await this.store.put("remoteRecords", saved);
    return saved;
  }

  #assertOnline() {
    if (globalThis.navigator && !navigator.onLine) {
      const error = new Error("Нет подключения к сети");
      error.name = "OfflineError";
      throw error;
    }
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

