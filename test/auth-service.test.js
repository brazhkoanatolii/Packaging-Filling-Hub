import test from "node:test";
import assert from "node:assert/strict";

import { AuthService } from "../src/services/auth-service.js";

class PreferenceStore {
  constructor(value = null) {
    this.value = value;
  }

  async preference() {
    return this.value;
  }

  async setPreference(_key, value) {
    this.value = value;
  }
}

test("рабочее место начальника показывает только учётную запись начальника", () => {
  const service = new AuthService(new PreferenceStore(), { allowedRole: "manager" });
  assert.deepEqual(service.availableAccounts().map(account => account.id), ["manager"]);
});

test("рабочее место старшего механика запрещает вход начальника", async () => {
  const service = new AuthService(new PreferenceStore(), { allowedRole: "senior" });
  await assert.rejects(() => service.login("manager"), /недоступна/);
  assert.equal(await service.login("senior-mechanic").then(account => account.role), "senior");
});

test("сохранённая чужая сессия сбрасывается после назначения роли компьютера", async () => {
  const store = new PreferenceStore("manager");
  const service = new AuthService(store, { allowedRole: "senior" });
  assert.equal(await service.current(), null);
  assert.equal(store.value, null);
});
