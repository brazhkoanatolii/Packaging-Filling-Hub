import test from "node:test";
import assert from "node:assert/strict";
import { GoogleSheetsGatewayProvider } from "../src/providers/google-sheets-gateway-provider.js";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function operation(overrides = {}) {
  return {
    requestId: "request-1",
    recordId: "record-1",
    expectedVersion: 1,
    type: "update",
    record: {
      date: "2026-09-18",
      scaleName: "WTC 600 (F10)",
      actual: 49.98,
      condition: "Рабочие",
      performer: "Anatolii Brazhko",
      note: "Проверка",
      status: "Действует",
      annulReason: null,
      updatedBy: "Anatolii Brazhko (Начальник участка)"
    },
    ...overrides
  };
}

test("записи Google преобразуются в формат программы", async () => {
  const provider = new GoogleSheetsGatewayProvider({
    fetchImpl: async () => response(200, { records: [{
      recordId: "record-1",
      entryDate: "2026-09-18",
      scale: "WTC 600 (F10)",
      nominal: 50,
      fact: 49.98,
      deviation: 0.02,
      result: "В допуске",
      author: "Anatolii Brazhko",
      version: 3
    }] })
  });

  const [record] = await provider.list();
  assert.equal(record.id, "record-1");
  assert.equal(record.actual, 49.98);
  assert.equal(record.deviation, 0.02);
  assert.equal(record.result, "В пределах допуска");
  assert.equal(record.source, "google");
});

test("запись нельзя отправить до отдельного включения", async () => {
  let called = false;
  const provider = new GoogleSheetsGatewayProvider({
    writesEnabled: false,
    fetchImpl: async () => { called = true; return response(200, {}); }
  });
  await assert.rejects(provider.write(operation()), { name: "WritesDisabledError" });
  assert.equal(called, false);
});

test("конфликт версии передаётся в программу", async () => {
  const provider = new GoogleSheetsGatewayProvider({
    writesEnabled: true,
    fetchImpl: async () => response(409, {
      ok: false,
      conflict: true,
      message: "Запись уже изменена",
      current: { recordId: "record-1", version: 5 }
    })
  });
  await assert.rejects(provider.write(operation()), error => {
    assert.equal(error.name, "ConflictError");
    assert.equal(error.currentRecord.version, 5);
    return true;
  });
});

test("успешная запись возвращается синхронизированной", async () => {
  let sentBody;
  const provider = new GoogleSheetsGatewayProvider({
    writesEnabled: true,
    fetchImpl: async (_url, options) => {
      sentBody = JSON.parse(options.body);
      return response(200, { ok: true, record: {
        recordId: "record-1",
        entryDate: "2026-09-18",
        scale: "WTC 600 (F10)",
        nominal: 50,
        fact: 49.98,
        deviation: 0.02,
        condition: "Рабочие",
        result: "В допуске",
        author: "Anatolii Brazhko",
        version: 2
      } });
    }
  });
  const saved = await provider.write(operation());
  assert.equal(sentBody.operation, "update");
  assert.equal(sentBody.expectedVersion, 1);
  assert.equal(saved.version, 2);
  assert.equal(saved.syncState, "synced");
});
