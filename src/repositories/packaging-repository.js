import { makeId } from "../domain/scale-check.js";
export class PackagingRepository {
  constructor(local, remote) { this.local = local; this.remote = remote; this.running = null; }
  async list() { return (await this.local.getAll("records")).sort((a, b) => b.date.localeCompare(a.date)); }
  pending() { return this.local.getAll("operations"); } lastReadAt() { return this.local.preference("lastReadAt"); }
  async save(record) { const pending = { ...record, syncState: "pending", source: "local" }; const existing = await this.local.get("operations", record.id); await this.local.batch([{ store: "records", value: pending }, { store: "operations", value: { id: record.id, requestId: existing?.requestId || makeId("packaging-request"), type: "save", record: pending, error: null } }]); return pending; }
  async remove(record) { await this.local.batch([{ store: "records", deleteKey: record.id }, { store: "operations", value: { id: record.id, requestId: makeId("packaging-request"), type: "delete", record, error: null } }]); }
  async sync() { if (this.running) return this.running; this.running = this.#send().finally(() => { this.running = null; }); return this.running; }
  async #send() { for (const operation of await this.pending()) { try { if (operation.type === "delete") await this.remote.remove(operation.record.id); else await this.local.put("records", await this.remote.write(operation)); await this.local.delete("operations", operation.id); } catch (error) { await this.local.put("operations", { ...operation, error: error.message }); throw error; } } }
  async refresh() { const records = await this.remote.list(); const pending = new Set((await this.pending()).map(item => item.id)); const changes = records.filter(record => !pending.has(record.id)).map(value => ({ store: "records", value })); for (const local of await this.list()) if (local.syncState === "synced" && !pending.has(local.id) && !records.some(remote => remote.id === local.id)) changes.push({ store: "records", deleteKey: local.id }); changes.push({ store: "preferences", value: { key: "lastReadAt", value: new Date().toISOString() } }); await this.local.batch(changes); return this.list(); }
}
