export class NonconformityGatewayProvider {
  constructor({ baseUrl = "", fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetch = fetchImpl.bind(globalThis);
  }

  async list() { return this.#request("GET"); }
  async create(record) { return this.#request("POST", record).then(payload => payload.record); }
  async update(id, record) { return this.#request("PUT", { ...record, id }).then(payload => payload.record); }
  async remove(id) { return this.#request("DELETE", { id }); }

  async #request(method, body) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api/nonconformities`, {
        method,
        headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        signal: AbortSignal.timeout(30_000), ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch (cause) {
      const error = new Error(cause?.name === "TimeoutError" ? "Google не ответил за 30 секунд. Повторите позже." : "Нет связи с журналом несоответствий в Google");
      error.name = globalThis.navigator?.onLine ? "GatewayUnavailableError" : "OfflineError";
      throw error;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || "Журнал несоответствий недоступен");
    return payload;
  }
}
