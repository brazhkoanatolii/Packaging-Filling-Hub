export class ProductSpecificationGatewayProvider {
  constructor({ baseUrl = "", fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.fetch = fetchImpl;
  }

  async list() {
    try {
      const response = await this.fetch(`${this.baseUrl}/api/specifications`, { headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.specifications)) throw new Error(payload?.message || "Google не вернул спецификации");
      return payload.specifications.map(normalizeSpecification);
    } catch (cause) {
      const error = new Error("Не удалось загрузить спецификации из Google");
      error.name = globalThis.navigator?.onLine ? "GatewayUnavailableError" : "OfflineError";
      error.cause = cause;
      throw error;
    }
  }

  async save(specification) {
    return this.#write("POST", specification, "Не удалось сохранить спецификацию в Google").then(payload => normalizeSpecification(payload.specification));
  }

  async remove(id) {
    await this.#write("DELETE", { id }, "Не удалось удалить спецификацию из Google");
  }

  async #write(method, payload, fallbackMessage) {
    try {
      const response = await this.fetch(`${this.baseUrl}/api/specifications`, {
        method,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.message || fallbackMessage);
      return result;
    } catch (cause) {
      const error = new Error(cause?.message || fallbackMessage);
      error.name = globalThis.navigator?.onLine ? "GatewayUnavailableError" : "OfflineError";
      error.cause = cause;
      throw error;
    }
  }
}

function normalizeSpecification(value) {
  return {
    id: String(value.id), line: String(value.line || ""), product: String(value.product || ""),
    variant: Number(value.variant), dryMass: numericOrNull(value.dryMass), wetMass: numericOrNull(value.wetMass), liquidVolume: numericOrNull(value.liquidVolume),
    processType: String(value.processType || ""), pouchCount: numericOrNull(value.pouchCount), lidColor: String(value.lidColor || ""), canType: String(value.canType || "")
  };
}

function numericOrNull(value) { return value === "" || value === null || value === undefined ? null : Number(value); }
