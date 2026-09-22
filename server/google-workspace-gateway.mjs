import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
loadEnvironment(join(projectRoot, ".env"));

const appVersion = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;
const port = numberFromEnvironment("PORT", 4173);
const host = process.env.HOST || "127.0.0.1";
const writesEnabled = process.env.GOOGLE_WRITES_ENABLED === "true";
const workstationRole = normalizeWorkstationRole(process.env.WORKSTATION_ROLE);
const workstationId = normalizeWorkstationId(process.env.WORKSTATION_ID);
const workstationLabel = normalizeWorkstationLabel(process.env.WORKSTATION_LABEL);
const updateManifestUrl = process.env.UPDATE_MANIFEST_URL || "https://raw.githubusercontent.com/brazhkoanatolii/Packaging-Filling-Hub/main/update-manifest.json";
const maintenanceDueSpreadsheetId = "1_BTwm21m1edVoNew6m5GJirPdUsxnJYE_Xv9qB32c5c";
const maintenanceDueRange = "'ТО'!A6:H";
const packagingSpreadsheetId = "1n7OfVi8__XWRJhj5jtlRUbrU6O9wGLmlDDf0e9-UKoI";
const packagingSheetName = "Лист";
const packagingRange = "'Лист'!B2:M";
const packagingReceiptPrefix = "PFH_PACKAGING_V1:";
const packagingKeys = Object.freeze(["garantBox430", "garantBox570", "dochemsPaper", "killaCanClear", "killaCanGreen", "killaLidGreen", "dzCanClear", "dzCanGreen", "dzLidBlack", "dzLidWhite"]);
const workforceSpreadsheetIds = Object.freeze({
  personnel: "1r1opRywv4upVl4oMrUlOqmRsjAuETUu3-JFMUqjRu04",
  attendance: "1eJphWAgaxNb5N--tDrwv4uTzmiAs19NOLSAQlSn3dk0",
  vacations: "1zenc0sBGtD8KHQdrBxULsoA9jSaUcZeW83XIiz5YxSo"
});
const maximumBodyBytes = 1024 * 1024;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};
const publicFiles = new Set(["index.html", "manifest.webmanifest", "service-worker.js"]);
const publicDirectories = ["assets/", "src/"];

let tokenCache = null;
let tokenRefreshPromise = null;

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (url.pathname === "/runtime-config.js") {
      return sendJavaScript(response, `globalThis.__PACKAGING_FILLING_CONFIG__ = Object.freeze(${JSON.stringify({
        mode: "gateway",
        googleWritesEnabled: writesEnabled,
        gatewayBaseUrl: "",
        workstationRole,
        workstationId,
        workstationLabel
      })});`);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return sendJson(response, 200, {
        ok: true,
        version: appVersion,
        configured: missingGoogleSettings().length === 0,
        writesEnabled,
        workstationRole,
        workstationConfigured: workstationRole !== null,
        workstationId,
        workstationLabel,
        missing: missingGoogleSettings()
      });
    }

    if (url.pathname === "/api/update-status" && request.method === "GET") {
      return sendJson(response, 200, await getUpdateStatus());
    }
    if (url.pathname === "/api/update" && request.method === "POST") {
      const update = await getUpdateStatus();
      if (!update.available) return sendJson(response, 409, { ok: false, message: "Новой версии нет" });
      if (process.platform !== "win32") return sendJson(response, 501, { ok: false, message: "Автообновление доступно только в Windows" });
      const updater = join(projectRoot, "scripts", "windows", "update-program.ps1");
      if (!existsSync(updater)) return sendJson(response, 500, { ok: false, message: "Не найден сценарий обновления" });
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", updater, "-InstallRoot", projectRoot, "-PackageUrl", update.packageUrl, "-ExpectedSha256", update.sha256], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();
      return sendJson(response, 202, { ok: true, version: update.version });
    }

    if (url.pathname === "/api/cyclone-records") {
      if (!workstationRole) return sendJson(response, 403, { ok: false, message: "Назначьте роль рабочего компьютера" });
      if (request.method === "GET") return sendJson(response, 200, await runAppsScript("listCycloneRecords"));
      if (request.method === "POST") {
        if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
        const input = await readJsonBody(request);
        const result = await runAppsScript("createCycloneRecord", [{
          requestId: input.requestId, recordId: input.recordId, date: input.date, performer: input.performer,
          role: workstationRole, workstationId
        }]);
        return sendJson(response, result?.ok === false ? 400 : 200, result);
      }
      return sendJson(response, 405, { ok: false, message: "Допускаются только чтение и добавление очисток" });
    }

    if (url.pathname === "/api/scale-records" && request.method === "GET") {
      const result = await runAppsScript("listScaleRecords");
      return sendJson(response, 200, result);
    }

    if (url.pathname === "/api/workforce" && request.method === "GET") {
      if (!workstationRole) return sendJson(response, 403, { ok: false, message: "Назначьте роль рабочего компьютера" });
      return sendJson(response, 200, await getWorkforceSnapshot());
    }
    if (url.pathname === "/api/workforce" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена" });
      const payload = await readJsonBody(request);
      if (!workstationRole || (workstationRole !== "manager" && payload.kind !== "attendance")) return sendJson(response, 403, { ok: false, message: "Недостаточно прав" });
      const result = await runAppsScript("writeWorkforceOperation", [{ ...payload, role: workstationRole }]);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }

    if (url.pathname === "/api/maintenance" && request.method === "GET") {
      if (!workstationRole) return sendJson(response, 403, { ok: false, message: "Назначьте роль рабочего компьютера" });
      const result = await runAppsScript("getMaintenanceSnapshot");
      return sendJson(response, result?.ok === false ? 400 : 200, result);
    }
    if (url.pathname === "/api/maintenance-due" && request.method === "GET") {
      if (!workstationRole) return sendJson(response, 403, { ok: false, message: "Назначьте роль рабочего компьютера" });
      return sendJson(response, 200, await getMaintenanceDueSnapshot());
    }
    if (url.pathname === "/api/maintenance" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Добавлять записи могут только начальник участка и старший механик" });
      const payload = await readJsonBody(request);
      const functionName = payload.journal === "repair" ? "createRepairRecord" : payload.journal === "service" ? "createMaintenanceRecord" : null;
      if (!functionName) return sendJson(response, 400, { ok: false, message: "Укажите журнал: ТО или ремонт" });
      const result = await runAppsScript(functionName, [{ ...payload, role: workstationRole, workstationId }]);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }

    if (url.pathname === "/api/production-records" && request.method === "GET") {
      if (!workstationRole) return sendJson(response, 403, { ok: false, message: "Назначьте роль рабочего компьютера" });
      const result = await runAppsScript("getProductionSnapshot");
      return sendJson(response, result?.ok === false ? 400 : 200, result);
    }
    if (url.pathname === "/api/production-records" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Добавлять записи могут только начальник участка и старший механик" });
      const result = await runAppsScript("createProductionRecord", [{ ...(await readJsonBody(request)), role: workstationRole, workstationId }]);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }
    if (url.pathname === "/api/production-records" && request.method === "PUT") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Исправлять записи могут только начальник участка и старший механик" });
      const result = await runAppsScript("updateProductionRecord", [{ ...(await readJsonBody(request)), role: workstationRole, workstationId }]);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }
    if (url.pathname === "/api/production-records" && request.method === "DELETE") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Удалять записи могут только начальник участка и старший механик" });
      const result = await runAppsScript("deleteProductionRecord", [{ ...(await readJsonBody(request)), role: workstationRole, workstationId }]);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }

    if (url.pathname === "/api/packaging-records" && request.method === "GET") {
      if (!workstationRole) return sendJson(response, 403, { ok: false, message: "Назначьте роль рабочего компьютера" });
      return sendJson(response, 200, await getPackagingSnapshot());
    }
    if (url.pathname === "/api/packaging-records" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Добавлять расход упаковки могут только начальник участка и старший механик" });
      return sendJson(response, 200, await createPackagingRecord({ ...(await readJsonBody(request)), role: workstationRole, workstationId }));
    }

    if (url.pathname === "/api/specifications" && request.method === "GET") {
      const specifications = await runAppsScript("listProductSpecifications");
      return sendJson(response, 200, { ok: true, specifications: Array.isArray(specifications) ? specifications : [] });
    }
    if (url.pathname === "/api/specifications" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager") return sendJson(response, 403, { ok: false, message: "Редактировать спецификации может только начальник участка" });
      const specification = await runAppsScript("saveProductSpecification", [{ ...(await readJsonBody(request)), role: workstationRole }]);
      return sendJson(response, 200, { ok: true, specification });
    }
    if (url.pathname === "/api/specifications" && request.method === "DELETE") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager") return sendJson(response, 403, { ok: false, message: "Редактировать спецификации может только начальник участка" });
      const result = await runAppsScript("deleteProductSpecification", [{ ...(await readJsonBody(request)), role: workstationRole }]);
      return sendJson(response, 200, result);
    }

    if (url.pathname === "/api/scale-records" && request.method === "POST") {
      if (!writesEnabled) {
        return sendJson(response, 403, { ok: false, message: "Запись в Google пока выключена начальником участка" });
      }
      const payload = await readJsonBody(request);
      const result = await runAppsScript("writeScaleRecordV2", [payload]);
      return sendJson(response, result?.conflict ? 409 : 200, result);
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(response, 404, { ok: false, message: "Команда шлюза не найдена" });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error(`[gateway] ${error.name}: ${error.message}`);
    return sendJson(response, status, {
      ok: false,
      message: status >= 500 ? "Не удалось выполнить запрос к Google" : error.message
    });
  }
}).listen(port, host, () => {
  console.log(`Packaging-Filling-Hub: http://${host}:${port}`);
  console.log(`Рабочее место: ${workstationLabel || workstationId || workstationRole || "не назначено"}`);
  console.log(`Google: ${missingGoogleSettings().length ? "требуется настройка" : "настроен"}; запись: ${writesEnabled ? "включена" : "выключена"}`);
});

async function getUpdateStatus() {
  const base = { ok: true, currentVersion: appVersion, available: false, message: "Новая версия не найдена" };
  try {
    const response = await fetch(updateManifestUrl, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(7_000)
    });
    if (!response.ok) return { ...base, message: "Не удалось получить сведения об обновлении" };
    const manifest = await response.json();
    if (!isSafeUpdateManifest(manifest)) return { ...base, message: "Сведения об обновлении не прошли проверку" };
    return compareVersions(manifest.version, appVersion) > 0
      ? { ...base, available: true, version: manifest.version, packageUrl: manifest.packageUrl, sha256: manifest.sha256, message: `Доступна версия ${manifest.version}` }
      : base;
  } catch {
    return { ...base, message: "Не удалось проверить обновление" };
  }
}

function isSafeUpdateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || !/^\d+\.\d+\.\d+$/.test(manifest.version || "") || !/^[A-Fa-f0-9]{64}$/.test(manifest.sha256 || "")) return false;
  try {
    const packageUrl = new URL(manifest.packageUrl);
    return packageUrl.protocol === "https:" && packageUrl.hostname === "raw.githubusercontent.com" && packageUrl.pathname.startsWith("/brazhkoanatolii/Packaging-Filling-Hub/") && packageUrl.pathname.endsWith(".zip");
  } catch {
    return false;
  }
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

async function runAppsScript(functionName, parameters = []) {
  assertGoogleConfigured();
  const accessToken = await getAccessToken();
  const deploymentId = process.env.GOOGLE_SCRIPT_DEPLOYMENT_ID;
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${encodeURIComponent(deploymentId)}:run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ function: functionName, parameters, devMode: false }),
    signal: AbortSignal.timeout(35_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Google Apps Script недоступен");
  if (payload.error) {
    const detail = payload.error.details?.[0]?.errorMessage || payload.error.message;
    throw googleError(502, detail || "Функция Google завершилась с ошибкой");
  }
  return payload.response?.result ?? null;
}

async function getAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.value;
  if (!tokenRefreshPromise) {
    tokenRefreshPromise = (async () => {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
          refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
          grant_type: "refresh_token"
        }),
        signal: AbortSignal.timeout(15_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.access_token) {
        throw googleError(response.status || 502, payload.error_description || "Не удалось обновить доступ к Google");
      }
      tokenCache = {
        value: payload.access_token,
        expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
      };
      return tokenCache.value;
    })().finally(() => { tokenRefreshPromise = null; });
  }
  return tokenRefreshPromise;
}

async function getMaintenanceDueSnapshot() {
  assertGoogleConfigured();
  const accessToken = await getAccessToken();
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(maintenanceDueSpreadsheetId)}/values/${encodeURIComponent(maintenanceDueRange)}?valueRenderOption=FORMATTED_VALUE`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось прочитать сводку ТО");
  const values = Array.isArray(payload.values) ? payload.values : [];
  const rows = values.slice(1);
  return {
    ok: true,
    records: rows.map(row => ({
      line: String(row[0] || "").trim(),
      lastService: String(row[1] || "").trim(),
      intervalBoxes: googleNumber(row[2]),
      producedBoxes: googleNumber(row[3]),
      remainingBoxes: googleNumber(row[4]),
      usedPercent: String(row[5] || "").trim(),
      status: String(row[6] || "").trim()
    })).filter(record => record.line && record.intervalBoxes > 0 && Number.isFinite(record.remainingBoxes))
  };
}

function googleNumber(value) {
  const normalized = String(value ?? "").replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

async function getWorkforceSnapshot() {
  const year = new Date().getFullYear();
  const [masterRanges, attendanceRanges, vacationRanges] = await Promise.all([
    getGoogleSheetRanges(workforceSpreadsheetIds.personnel, ["'Смены'!A6:H", "'Персонал'!A6:P"]),
    getGoogleSheetRanges(workforceSpreadsheetIds.attendance, [`'${year}'!A6:AR`]),
    getGoogleSheetRanges(workforceSpreadsheetIds.vacations, [`'${year}'!A6:L`])
  ]);
  const teams = (masterRanges[0] ?? []).filter(row => row[6]).map(workforceTeam);
  const personnel = (masterRanges[1] ?? []).filter(row => row[7]).map(row => workforcePerson(row, teams));
  const attendance = workforceAttendance(attendanceRanges[0] ?? [], personnel, teams, year);
  const vacations = workforceVacations(vacationRanges[0] ?? [], year);
  return {
    ok: true, ready: true, personnel, shiftTeams: teams.filter(team => team.id !== "office"),
    officeSchedule: teams.find(team => team.id === "office") ?? null, attendance, vacations,
    years: [year], timeZone: "Europe/Vilnius"
  };
}

async function getPackagingSnapshot() {
  const values = await getGoogleSheetRanges(packagingSpreadsheetId, [packagingRange]);
  const rows = values[0] ?? [];
  const headers = rows[0] ?? [];
  if (headers.length < 12 || String(headers[0]).trim() !== "Дата" || String(headers[11]).trim() !== "Внёс данные") {
    throw new Error("Изменилась структура журнала расхода упаковки");
  }
  const notes = await getPackagingDateNotes();
  return { ok: true, records: rows.slice(1).map((row, index) => packagingRecordFromRow(row, index + 3, notes[index] || "")).filter(Boolean) };
}

async function createPackagingRecord(input) {
  const record = validatePackagingRecord(input);
  const before = await getPackagingSnapshot();
  const existing = before.records.find(item => item.id === record.id || item.requestId === record.requestId);
  if (existing) return { ok: true, record: existing };
  const accessToken = await getAccessToken();
  const sheetId = await getPackagingSheetId(accessToken);
  const serial = Math.round((Date.parse(`${record.date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
  const receipt = `${packagingReceiptPrefix}${JSON.stringify({ id: record.id, requestId: record.requestId, workstationId: record.workstationId, createdAt: new Date().toISOString() })}`;
  const cells = [
    { userEnteredValue: { numberValue: serial }, note: receipt, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd.MM.yyyy" } } },
    ...packagingKeys.map(key => ({ userEnteredValue: { numberValue: record.values[key] } })),
    { userEnteredValue: { stringValue: record.author } }
  ];
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(packagingSpreadsheetId)}:batchUpdate`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ appendCells: { sheetId, rows: [{ values: cells }], fields: "userEnteredValue,note,userEnteredFormat.numberFormat" } }] }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось записать расход упаковки");
  return { ok: true, record: { id: record.id, requestId: record.requestId, date: record.date, values: record.values, author: record.author } };
}

function validatePackagingRecord(input) {
  if (!input || !["manager", "senior"].includes(input.role)) throw new Error("Недостаточно прав");
  const id = String(input.recordId || ""); const requestId = String(input.requestId || "");
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id) || !/^[a-zA-Z0-9_-]{8,160}$/.test(requestId)) throw new Error("Некорректный идентификатор записи");
  const date = String(input.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > vilniusDate()) throw new Error("Некорректная дата расхода упаковки");
  const author = String(input.author || "").trim();
  if (!author || author.length > 120 || /^[=+@-]/.test(author)) throw new Error("Некорректный автор записи");
  const values = Object.fromEntries(packagingKeys.map(key => {
    const value = Number(input.values?.[key]);
    if (!Number.isFinite(value) || value < 0) throw new Error("Некорректный расход упаковки");
    return [key, value];
  }));
  if (!Object.values(values).some(value => value > 0)) throw new Error("Не указан расход упаковки");
  return { id, requestId, date, values, author, workstationId: String(input.workstationId || "") };
}

async function getPackagingDateNotes() {
  assertGoogleConfigured();
  const accessToken = await getAccessToken();
  const query = new URLSearchParams({ includeGridData: "true", ranges: `'${packagingSheetName}'!B3:B`, fields: "sheets(data(rowData(values(note))))" });
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(packagingSpreadsheetId)}?${query}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось прочитать журнал расхода упаковки");
  return payload.sheets?.[0]?.data?.[0]?.rowData?.map(row => row.values?.[0]?.note || "") ?? [];
}

async function getPackagingSheetId(accessToken) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(packagingSpreadsheetId)}?fields=sheets(properties(sheetId,title))`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось открыть журнал расхода упаковки");
  const sheet = payload.sheets?.find(item => item.properties?.title === packagingSheetName);
  if (!sheet) throw new Error("Не найден лист расхода упаковки");
  return sheet.properties.sheetId;
}

function packagingRecordFromRow(row, rowNumber, note) {
  if (!row?.some(value => value !== "" && value !== undefined)) return null;
  const date = googleSerialToDate(row[0]); const author = String(row[11] || "").trim();
  if (!date || !author) throw new Error(`Проверьте строку ${rowNumber} журнала расхода упаковки`);
  let receipt = {};
  if (String(note).startsWith(packagingReceiptPrefix)) { try { receipt = JSON.parse(String(note).slice(packagingReceiptPrefix.length)); } catch { throw new Error(`Повреждена служебная отметка в строке ${rowNumber}`); } }
  return { id: receipt.id || `packaging-row-${rowNumber}`, requestId: receipt.requestId || "", date, values: Object.fromEntries(packagingKeys.map((key, index) => [key, Number(row[index + 1] || 0)])), author };
}

function googleSerialToDate(value) {
  const serial = Number(value); if (!Number.isFinite(serial)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function vilniusDate() {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "Europe/Vilnius", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function getGoogleSheetRanges(spreadsheetId, ranges) {
  assertGoogleConfigured();
  const accessToken = await getAccessToken();
  const parameters = new URLSearchParams({ valueRenderOption: "FORMATTED_VALUE" });
  ranges.forEach(range => parameters.append("ranges", range));
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${parameters}`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(12_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось прочитать рабочий журнал");
  return (payload.valueRanges ?? []).map(range => range.values ?? []);
}

function workforceTeam(row) {
  return {
    id: String(row[6] || ""), name: String(row[0] || ""),
    code: row[6] === "shift-team-a" ? "A" : row[6] === "shift-team-b" ? "B" : "5/2",
    anchorDate: googleDate(row[1]), cycleLengthDays: googleNumber(row[2]),
    workDayOffsets: String(row[3] || "").split(",").map(Number).filter(Number.isFinite),
    shiftDurationHours: googleNumber(row[4]), accountingHours: googleNumber(row[5]), active: true,
    revision: workforceRevision(row)
  };
}

function workforcePerson(row, teams) {
  return {
    id: String(row[7] || ""), fullName: String(row[0] || ""), role: workforceRole(row[1]),
    shiftTeamId: teams.find(team => team.name === String(row[2] || ""))?.id || String(row[11] || ""),
    active: String(row[5] || "") === "Работает", note: String(row[6] || ""),
    pakNumber: String(row[3] || ""), pakCode: String(row[4] || ""), birthday: googleDate(row[12]), hireDate: googleDate(row[13]),
    phone: String(row[14] || ""), email: String(row[15] || ""), revision: workforceRevision(row), updatedAt: googleDate(row[9])
  };
}

function workforceAttendance(rows, personnel, teams, year) {
  const personnelById = new Map(personnel.map(person => [person.id, person]));
  return rows.flatMap(row => {
    const employee = personnelById.get(String(row[38] || ""));
    const month = Number(row[0]);
    if (!employee || !month) return [];
    const shiftTeamId = teams.find(team => team.name === String(row[2] || ""))?.id || String(row[43] || "") || employee.shiftTeamId;
    const overtimeDays = new Set(String(row[42] || "").split(",").filter(Boolean));
    return Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => {
      const day = index + 1;
      const value = String(row[day + 2] || "");
      if (!value || value === "—") return null;
      const substitute = workforceSubstitute(row[37], day);
      return {
        id: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}:${shiftTeamId}:${employee.id}`,
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, employeeId: employee.id, shiftTeamId, value,
        overtime: overtimeDays.has(String(day)), substitutionReason: substitute?.reason || "", homeShiftTeamId: substitute?.homeShiftTeamId || "",
        revision: workforceRevision([value, overtimeDays.has(String(day)), substitute?.reason || "", substitute?.homeShiftTeamId || ""]),
        updatedAt: googleDate(row[40]), updatedBy: String(row[41] || "")
      };
    }).filter(Boolean);
  });
}

function workforceVacations(rows, year) {
  return rows.filter(row => row[7]).map(row => ({
    id: String(row[7]), employeeId: String(row[8] || ""), year, startDate: googleDate(row[2]), endDate: googleDate(row[3]),
    days: Number.isFinite(googleNumber(row[4])) ? googleNumber(row[4]) : null, status: String(row[5] || ""), note: String(row[6] || ""),
    revision: workforceRevision(row), updatedAt: googleDate(row[10]), updatedBy: String(row[11] || "")
  }));
}

function workforceRole(value) {
  return ({ "Начальник участка": "head-of-area", "Начальник производства": "production-manager", "Администратор": "administrator", "Начальник склада": "warehouse-manager", "Старший механик": "senior-mechanic", "Механик": "mechanic", "Механик-оператор": "mechanic-operator", "Упаковщик": "packer" })[String(value || "")] || "";
}

function workforceSubstitute(note, day) {
  const match = String(note || "").match(/Подменный выход \(штатная смена ([AB])\):\s*([^\n]+)/);
  const item = match?.[2].split(";").map(value => value.trim()).find(value => value.startsWith(`${day} — `));
  return item ? { homeShiftTeamId: `shift-team-${match[1].toLowerCase()}`, reason: item.slice(`${day} — `.length).trim() } : null;
}

function googleDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : text;
}

function workforceRevision(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}


function serveStatic(pathname, response) {
  const relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  let filePath = resolve(projectRoot, relativePath);
  const rel = relative(projectRoot, filePath);
  const publicPath = rel.split(sep).join("/");
  const outsideProject = rel.startsWith(`..${sep}`) || rel === "..";
  const allowed = publicFiles.has(publicPath) || publicDirectories.some(directory => publicPath.startsWith(directory));
  if (outsideProject || !allowed || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end("Страница не найдена");
    return;
  }
  response.writeHead(200, {
    "Content-Type": types[extname(filePath)] || "application/octet-stream",
    "Cache-Control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin"
  });
  createReadStream(filePath).pipe(response);
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maximumBodyBytes) {
        const error = new Error("Запрос слишком большой");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(body || "{}"));
      } catch {
        const error = new Error("Некорректные данные запроса");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function sendJavaScript(response, body) {
  response.writeHead(200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function assertGoogleConfigured() {
  const missing = missingGoogleSettings();
  if (!missing.length) return;
  const error = new Error(`Не заполнены настройки: ${missing.join(", ")}`);
  error.statusCode = 503;
  throw error;
}

function missingGoogleSettings() {
  return [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REFRESH_TOKEN",
    "GOOGLE_SCRIPT_DEPLOYMENT_ID"
  ].filter(name => !process.env[name]);
}

function googleError(statusCode, message) {
  const error = new Error(message);
  error.name = "GoogleApiError";
  error.statusCode = statusCode === 401 || statusCode === 403 ? statusCode : 502;
  return error;
}

function numberFromEnvironment(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (Number.isInteger(value) && value > 0 && value <= 65535) return value;
  throw new Error(`${name} должен быть корректным номером порта`);
}

function normalizeWorkstationRole(value) {
  if (!value) return null;
  if (["manager", "senior"].includes(value)) return value;
  throw new Error("WORKSTATION_ROLE должен иметь значение manager или senior");
}

function normalizeWorkstationId(value) {
  if (!value) return null;
  const result = String(value).trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(result)) return result;
  throw new Error("WORKSTATION_ID должен содержать латинские буквы, цифры и дефисы");
}

function normalizeWorkstationLabel(value) {
  if (!value) return null;
  const result = String(value).trim();
  if (result.length <= 80) return result;
  throw new Error("WORKSTATION_LABEL не должен превышать 80 символов");
}

function loadEnvironment(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[2].startsWith("#") || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}
