export class CycloneGatewayProvider {
  constructor({ baseUrl = "", fetchImpl = globalThis.fetch, endpoint = "/api/cyclone-records" } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.endpoint = endpoint;
    this.fetch = fetchImpl.bind(globalThis);
  }

  async request(method, body) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${this.endpoint}`, {
        method, headers: { Accept: "application/json", "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45000),
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw new Error("Нет связи с локальным шлюзом Google. Записи остаются на этом компьютере.");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || "Журнал очистки циклонов недоступен");
    return payload;
  }

  async list() {
    const payload = await this.request("GET");
    if (!Array.isArray(payload.records)) throw new Error("Google не вернул записи очистки циклонов");
    return payload.records.map(normalize);
  }

  async write(operation) {
    const payload = await this.request("POST", {
      requestId: operation.requestId, recordId: operation.record.id,
      date: operation.record.date, performer: operation.record.performer
    });
    if (!payload.record || payload.record.id !== operation.record.id) throw new Error("Google не подтвердил сохранённую запись");
    return normalize(payload.record);
  }
}

function normalize(record) {
  if (!record?.id || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !record.performer) throw new Error("Некорректная запись очистки циклонов");
  return { ...record, source: "google", syncState: "synced" };
}
