import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CentralAuthService } from "../server/central-auth.mjs";

function service({ now = () => Date.now() } = {}) {
  const path = join(mkdtempSync(join(tmpdir(), "pfh-auth-")), "accounts.json");
  const value = new CentralAuthService({ accountsPath: path, now, random: () => "session-token" });
  value.initialize({ manager: "manager-123", "senior-mechanic": "senior-123" });
  return value;
}

test("central authentication keeps only password hashes and creates a role session", () => {
  const auth = service();
  const result = auth.login("manager", "manager-123");
  assert.equal(result.account.role, "manager");
  assert.equal(auth.accountForToken(result.token).id, "manager");
  assert.equal(JSON.stringify(auth.accounts).includes("manager-123"), false);
});

test("central authentication rejects a wrong password and expires a session", () => {
  let time = 1_000;
  const auth = service({ now: () => time });
  assert.throws(() => auth.login("manager", "wrong"), /Неверный пароль/);
  const result = auth.login("senior-mechanic", "senior-123");
  time += 13 * 60 * 60 * 1000;
  assert.equal(auth.accountForToken(result.token), null);
});

test("only the manager can change another central account password", () => {
  const auth = service();
  const senior = auth.login("senior-mechanic", "senior-123").account;
  assert.throws(() => auth.changePassword(senior, "manager", "manager-123", "changed-123"), /Недостаточно прав/);
  const manager = auth.login("manager", "manager-123").account;
  auth.changePassword(manager, "senior-mechanic", "senior-123", "changed-123");
  assert.equal(auth.login("senior-mechanic", "changed-123").account.role, "senior");
});
