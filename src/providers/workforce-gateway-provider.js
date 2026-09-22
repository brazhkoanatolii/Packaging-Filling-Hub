export class WorkforceGatewayProvider {
  constructor({ baseUrl = "", writesEnabled = false } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.writesEnabled = writesEnabled;
  }
  async snapshot() { return this.request("GET"); }
  async write(operation) {
    if (!this.writesEnabled) throw Object.assign(new Error("Запись в Google выключена. Включите её после настройки подключения."), { status: 403 });
    return this.request("POST", operation);
  }
  async request(method, operation) {
    const response = await fetch(`${this.baseUrl}/api/workforce`, {
      method, cache: "no-store", signal: AbortSignal.timeout(method === "GET" ? 8_000 : 30_000),
      headers: operation ? { "Content-Type": "application/json" } : {},
      ...(operation ? { body: JSON.stringify(operation) } : {})
    });
    const body = await response.json();
    if (!response.ok || body?.ok === false) throw Object.assign(new Error(body.message || "Журналы Google недоступны"), { status: response.status, conflict: body.conflict === true });
    return body;
  }
}
