export class PackagingWarehouseGatewayProvider {
  constructor({ baseUrl = "", fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetch = fetchImpl.bind(globalThis);
  }

  async list() {
    const payload = await this.#request("GET");
    if (!Array.isArray(payload.records) || !Array.isArray(payload.summary)) throw new Error("Google не вернул данные склада упаковки");
    return { records: payload.records.map(normalizeRecord), summary: payload.summary.map(normalizeSummary) };
  }

  async save(record) { await this.#request(record.id ? "PUT" : "POST", record); }
  async remove(id) { await this.#request("DELETE", { id }); }

  async #request(method, body) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/packaging-warehouse-records`, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000)
      });
    } catch (cause) {
      throw new Error(cause?.name === "TimeoutError" ? "Google не ответил за 30 секунд" : "Нет связи с журналом склада упаковки в Google");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || "Журнал склада упаковки недоступен");
    return payload;
  }
}

function normalizeRecord(record) {
  if (!record?.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(record.date || "")) || !["Приход", "Расход"].includes(record.type)) throw new Error("Google вернул некорректное движение склада");
  return { ...record, id: String(record.id), date: String(record.date), item: String(record.item), quantity: Number(record.quantity), author: String(record.author || ""), note: String(record.note || "") };
}

function normalizeSummary(row) {
  return { ...row, item: String(row.item), unit: String(row.unit || "шт."), opening: Number(row.opening || 0), received: Number(row.received || 0), issued: Number(row.issued || 0), calculated: Number(row.calculated || 0), actual: row.actual === null ? null : Number(row.actual), difference: row.difference === null ? null : Number(row.difference), note: String(row.note || "") };
}
