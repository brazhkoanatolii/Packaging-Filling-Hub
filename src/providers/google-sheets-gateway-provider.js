import { ConflictError } from "../domain/scale-check.js";

export class GoogleSheetsGatewayProvider {
  constructor({ baseUrl = "", writesEnabled = false, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Браузер не поддерживает сетевые запросы");
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.writesEnabled = Boolean(writesEnabled);
    this.fetch = fetchImpl;
    this.mode = "gateway";
  }

  async init() {}

  async list() {
    const payload = await this.#request("/api/scale-records", { method: "GET" });
    const records = Array.isArray(payload) ? payload : payload.records;
    if (!Array.isArray(records)) throw new Error("Шлюз вернул некорректный список записей");
    return records.map(normalizeRecord);
  }

  async write(operation) {
    if (!this.writesEnabled) {
      const error = new Error("Запись в Google пока выключена начальником участка");
      error.name = "WritesDisabledError";
      throw error;
    }

    const payload = await this.#request("/api/scale-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: operation.requestId,
        recordId: operation.recordId,
        expectedVersion: operation.expectedVersion,
        operation: operation.type,
        entryDate: operation.record.date,
        scale: operation.record.scaleName,
        fact: operation.record.actual,
        condition: operation.record.condition,
        author: operation.record.performer,
        note: operation.record.note,
        status: operation.record.status,
        annulReason: operation.record.annulReason,
        actor: operation.record.updatedBy
      })
    });

    if (payload?.conflict) {
      throw new ConflictError(payload.message || "Запись уже изменена", payload.current ? normalizeRecord(payload.current) : null);
    }
    if (!payload?.record) throw new Error("Google не вернул сохранённую запись");
    return normalizeRecord(payload.record);
  }

  async #request(path, options) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { Accept: "application/json", ...(options.headers ?? {}) }
      });
    } catch (cause) {
      const error = new Error("Не удалось связаться со шлюзом Google");
      error.name = globalThis.navigator && !navigator.onLine ? "OfflineError" : "GatewayUnavailableError";
      error.cause = cause;
      throw error;
    }

    const payload = await response.json().catch(() => null);
    if (payload?.conflict) return payload;
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.message || `Шлюз Google вернул ошибку ${response.status}`);
      error.name = response.status === 503 ? "GatewayUnavailableError" : "GoogleGatewayError";
      throw error;
    }
    return payload;
  }
}

function normalizeRecord(record) {
  const result = record.result === "В допуске" ? "В пределах допуска" : record.result;
  return {
    id: record.recordId ?? record.id,
    journalId: "scale-check-50g",
    date: record.entryDate ?? record.date,
    scaleName: record.scale ?? record.scaleName,
    nominal: Number(record.nominal ?? 50),
    actual: Number(record.fact ?? record.actual),
    deviation: Number(record.deviation ?? 0),
    condition: record.condition || "Рабочие",
    result: result || "—",
    performer: record.author ?? record.performer,
    note: record.note ?? "",
    status: record.status || "Действует",
    annulReason: record.annulReason || null,
    version: Number(record.version || 0),
    createdAt: normalizeTimestamp(record.createdAt),
    createdBy: record.createdBy || record.author || record.performer,
    updatedAt: normalizeTimestamp(record.updatedAt),
    updatedBy: record.updatedBy || record.author || record.performer,
    syncState: "synced",
    source: "google"
  };
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return value.replace(" ", "T");
  return value;
}
