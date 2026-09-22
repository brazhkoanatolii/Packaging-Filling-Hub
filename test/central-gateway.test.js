import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(url, child) {
  for (let index = 0; index < 40; index += 1) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    if (child.exitCode !== null) throw new Error("Центральный сервер завершился до запуска");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Центральный сервер не запустился");
}

test("central gateway authenticates users before protected journals", async () => {
  const port = await freePort();
  const temp = mkdtempSync(join(tmpdir(), "pfh-central-gateway-"));
  const child = spawn(process.execPath, ["server/google-workspace-gateway.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", DEPLOYMENT_MODE: "central",
      CENTRAL_ACCOUNTS_PATH: join(temp, "accounts.json"),
      CENTRAL_MANAGER_PASSWORD: "manager-123", CENTRAL_SENIOR_PASSWORD: "senior-123"
    }, stdio: "ignore"
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/api/health`, child);
    const runtime = await (await fetch(`${base}/runtime-config.js`)).text();
    assert.match(runtime, /"centralAuth":true/);
    assert.match(runtime, /"workstationRole":null/);
    assert.equal((await fetch(`${base}/api/maintenance`)).status, 401);
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "manager", password: "manager-123" })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.deepEqual((await login.json()).account, {
      id: "manager", role: "manager", title: "Начальник участка", description: "Все журналы, настройки, сотрудники и права доступа"
    });
    const session = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await session.json()).account.role, "manager");
    // The request passed central authorization and only then reached missing Google configuration.
    assert.equal((await fetch(`${base}/api/maintenance`, { headers: { Cookie: cookie } })).status, 503);
  } finally {
    child.kill();
  }
});
