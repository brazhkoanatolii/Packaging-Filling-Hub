import { CycloneGatewayProvider } from "./cyclone-gateway-provider.js";

export class MaintenanceGatewayProvider extends CycloneGatewayProvider {
  constructor(options = {}) { super({ ...options, endpoint: "/api/maintenance-records" }); }
  async list() {
    const data = await this.request("GET");
    if (!Array.isArray(data.records) || !Array.isArray(data.machines)) throw new Error("Google вернул неполный журнал ТО");
    const records = data.records.map(normalize);
    if (!data.machines.every(m => typeof m.id === "string" && typeof m.title === "string")) throw new Error("Некорректный список станков");
    this.machines = data.machines;
    this.performers = Array.isArray(data.performers) ? data.performers : [];
    return records;
  }
  async write(operation) {
    const data = await this.request("POST", { ...operation.record, recordId: operation.record.id, requestId: operation.requestId });
    if (data.record?.id !== operation.record.id) throw new Error("Google не подтвердил запись ТО");
    return normalize(data.record);
  }
}
function normalize(record) {
  if (!record?.id || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !record.performer || !/^\d{2}$/.test(record.machine)) throw new Error("Некорректная запись ТО");
  return { ...record, note: String(record.note || ""), source: "google", syncState: "synced" };
}
