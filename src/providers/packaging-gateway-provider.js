export class PackagingGatewayProvider {
  constructor({ baseUrl = "", fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetch = fetchImpl.bind(globalThis);
  }

  async list() {
    const payload = await this.#request("GET");
    if (!Array.isArray(payload.records)) throw new Error("Google не вернул записи расхода упаковки");
    return payload.records.map(normalizeRecord);
  }

  async write(operation) {
    const payload = await this.#request("POST", {
      requestId: operation.requestId,
      recordId: operation.record.id,
      date: operation.record.date,
      values: operation.record.values,
      author: operation.record.author
    });
    if (!payload.record || payload.record.id !== operation.record.id) throw new Error("Google не подтвердил сохранение расхода упаковки");
    return normalizeRecord(payload.record);
  }
  async remove(id) { await this.#request("DELETE", { id }); }
  async #request(method, body) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/packaging-records`, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        signal: AbortSignal.timeout(30_000),
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch (cause) {
      const error = new Error(cause?.name === "TimeoutError"
        ? "Google не ответил за 30 секунд. Запись остаётся в очереди и будет повторена автоматически."
        : "Нет связи с журналом расхода упаковки в Google");
      error.name = globalThis.navigator?.onLine ? "GatewayUnavailableError" : "OfflineError";
      throw error;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || "Журнал расхода упаковки недоступен");
    return payload;
  }
}

function normalizeRecord(record) {
  if (!record?.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(record.date || "")) || !record.values) {
    throw new Error("Google вернул некорректную запись расхода упаковки");
  }
  return { ...record, id: String(record.id), date: String(record.date), author: String(record.author || ""), values: { ...record.values }, source: "google", syncState: "synced" };
}
