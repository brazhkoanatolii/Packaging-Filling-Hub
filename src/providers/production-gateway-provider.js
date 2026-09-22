export class ProductionGatewayProvider {
  constructor({ baseUrl = "", fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetch = fetchImpl.bind(globalThis);
  }

  async list() { return this.#request("GET").then(payload => payload.records ?? []); }
  async create(record) { return this.#request("POST", record).then(payload => payload.record); }
  async update(id, record) { return this.#request("PUT", { ...record, id }).then(payload => payload.record); }
  async remove(id) { return this.#request("DELETE", { id }); }

  async #request(method, body) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/production-records`, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        signal: AbortSignal.timeout(30_000),
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch (cause) {
      const error = new Error(cause?.name === "TimeoutError"
        ? "Google не ответил за 30 секунд. Попробуйте обновить позже — повторно нажимать кнопку не нужно."
        : "Нет связи с журналом учёта продукции в Google");
      error.name = globalThis.navigator?.onLine ? "GatewayUnavailableError" : "OfflineError";
      error.cause = cause;
      throw error;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || "Журнал учёта продукции недоступен");
    return payload;
  }
}
