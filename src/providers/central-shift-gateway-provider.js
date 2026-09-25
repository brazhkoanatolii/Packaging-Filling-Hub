export class CentralShiftGatewayProvider {
  constructor({ baseUrl = "", fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetch = fetchImpl.bind(globalThis);
  }

  async current() { return this.request("GET"); }
  async update(action, payload = {}) { return this.request("POST", { action, ...payload }); }

  async request(method, payload) {
    const response = await this.fetch(`${this.baseUrl}/api/shift-state`, {
      method, cache: "no-store", credentials: "same-origin",
      headers: payload ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok === false) {
      throw Object.assign(new Error(body?.message || "Не удалось получить общую смену"), { status: response.status });
    }
    return body?.shift ?? null;
  }
}
