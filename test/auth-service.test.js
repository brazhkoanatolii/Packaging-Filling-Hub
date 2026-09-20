import test from "node:test";
import assert from "node:assert/strict";

import { AuthService } from "../src/services/auth-service.js";

class PreferenceStore {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  async preference(key, fallback = null) {
    return this.values.has(key) ? this.values.get(key) : fallback;
  }

  async setPreference(key, value) {
    this.values.set(key, value);
  }
}

test("рабочее место начальника показывает только учётную запись начальника", () => {
  const service = new AuthService(new PreferenceStore(), { allowedRole: "manager" });
  assert.deepEqual(service.availableAccounts().map(account => account.id), ["manager"]);
});

test("рабочее место старшего механика запрещает вход начальника", async () => {
  const service = new AuthService(new PreferenceStore(), { allowedRole: "senior" });
  await assert.rejects(() => service.login("manager", "0000"), /недоступна/);
  assert.equal(await service.login("senior-mechanic", "0000").then(account => account.role), "senior");
});

test("сохранённая чужая сессия сбрасывается после назначения роли компьютера", async () => {
  const store = new PreferenceStore({ sessionAccount: "manager", sessionAuthorized: true });
  const service = new AuthService(store, { allowedRole: "senior" });
  assert.equal(await service.current(), null);
  assert.equal(await store.preference("sessionAccount"), null);
});

test("по умолчанию для каждой учётной записи действует пароль 0000", async () => {
  const service = new AuthService(new PreferenceStore());
  await assert.rejects(() => service.login("manager", "1111"), /Неверный пароль/);
  assert.equal((await service.login("manager", "0000")).id, "manager");
});

test("изменённый пароль заменяет первоначальный только для выбранной учётной записи", async () => {
  const service = new AuthService(new PreferenceStore());
  await service.changePassword("senior-mechanic", "0000", "2468");
  await assert.rejects(() => service.login("senior-mechanic", "0000"), /Неверный пароль/);
  assert.equal((await service.login("senior-mechanic", "2468")).role, "senior");
  assert.equal((await service.login("manager", "0000")).role, "manager");
});
