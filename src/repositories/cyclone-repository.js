import { makeId } from "../domain/scale-check.js";

// Uses its own IndexedDB database. Demo scale checks can never enter this queue.
export class CycloneRepository {
  constructor(local, remote) { this.local = local; this.remote = remote; this.running = null; }

  async list() {
    return (await this.local.getAll("records")).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }

  pending() { return this.local.getAll("operations"); }
  lastReadAt() { return this.local.preference("lastReadAt"); }

  async create(record) {
    const pending = { ...record, syncState: "pending", source: "local" };
    await this.local.batch([
      { store: "records", value: pending },
      { store: "operations", value: { id: record.id, requestId: makeId("cyclone-request"), record: pending, error: null } }
    ]);
    return pending;
  }

  async sync() {
    if (this.running) return this.running;
    this.running = this.sendPending().finally(() => { this.running = null; });
    return this.running;
  }

  async sendPending() {
    let sent = 0;
    for (const operation of await this.pending()) {
      try {
        const saved = await this.remote.write(operation);
        await this.local.batch([{ store: "records", value: saved }, { store: "operations", deleteKey: operation.id }]);
        sent++;
      } catch (error) {
        await this.local.put("operations", { ...operation, error: error.message });
        throw error;
      }
    }
    return sent;
  }

  async refresh() {
    // Snapshot before the request so a concurrent new record is never removed.
    const before = await this.list();
    const records = await this.remote.list();
    const pending = new Set((await this.pending()).map(item => item.record.id));
    const remoteIds = new Set(records.map(item => item.id));
    const changes = records.filter(item => !pending.has(item.id)).map(value => ({ store: "records", value }));
    for (const item of before) {
      if (item.syncState === "synced" && !remoteIds.has(item.id) && !pending.has(item.id)) changes.push({ store: "records", deleteKey: item.id });
    }
    changes.push({ store: "preferences", value: { key: "lastReadAt", value: new Date().toISOString() } });
    await this.local.batch(changes);
    return this.list();
  }
}
