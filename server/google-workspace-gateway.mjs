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
const updateManifestUrl = process.env.UPDATE_MANIFEST_URL || "https://raw.githubusercontent.com/brazhkoanatolii/Packaging-Filling-Hub-Updates/main/update-manifest.json";
const maintenanceDueSpreadsheetId = "1_BTwm21m1edVoNew6m5GJirPdUsxnJYE_Xv9qB32c5c";
const maintenanceDueRange = "'ТО'!A6:H";
const packagingSpreadsheetId = "1n7OfVi8__XWRJhj5jtlRUbrU6O9wGLmlDDf0e9-UKoI";
const packagingSheetName = "Лист";
const packagingRange = "'Лист'!B2:M";
const packagingReceiptPrefix = "PFH_PACKAGING_V1:";
const packagingKeys = Object.freeze(["garantBox430", "garantBox570", "dochemsPaper", "killaCanClear", "killaCanGreen", "killaLidGreen", "dzCanClear", "dzCanGreen", "dzLidBlack", "dzLidWhite"]);
const rawMaterialsSpreadsheetId = "1jXf8oZLrFLGEJo15VoFQBe_FjC0_dz_3p0cVxgV4xGo";
const rawMaterialsSheetName = "Расход сырья";
const rawMaterialsRange = "'Расход сырья'!A3:D500";
const cansSpreadsheetId = "1-rEj8fvmBE4A5GO8o1ZXU1Ke0-ppK-gwKwCZt_kpwV4";
const cansSheetName = "Банки";
const cansRange = "'Банки'!A4:J500";
const productionSpreadsheetId = "1zHYsa1pO7xLuSbBC43J_IPChlVfZaxt4L_rI9MtKwqA";
const productionSecondRange = "'Учет продукции 2'!A2:M";
const productionFirstRange = "'Учет продукции 1'!B4:M";
const productionReportSpreadsheetId = "1_BTwm21m1edVoNew6m5GJirPdUsxnJYE_Xv9qB32c5c";
const productionMachineRange = "'Станки'!A7:M500";
const productionPackerRange = "'Упаковщики'!A7:V500";
const productionScrapRange = "'Брак'!A7:V500";
const productionMachineColumns = Object.freeze({ A: 2, B: 3, D: 4, F: 5, H: 6, K: 7, L: 8, M: 9 });
const nonconformitySpreadsheetId = "1ovuf2QW5KC4_CI1wAEUcufhZXfLreeJhN2PNVPtjlrk";
const nonconformitySheetName = "Журнал";
const nonconformityRange = "'Журнал'!A2:H";
const nonconformityDictionaryRange = "'Справочник несоответсвий'!B2:B";
const automaticDailyExportHour = hourFromEnvironment("AUTOMATIC_DAILY_EXPORT_HOUR", 6);
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
let automaticDailyExportCompletedDate = null;
let automaticDailyExportAttemptAt = 0;
let automaticDailyProductionExportCompletedDate = null;
let automaticDailyProductionExportAttemptAt = 0;

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
      const result = await getProductionSnapshot();
      return sendJson(response, result?.ok === false ? 400 : 200, result);
    }
    if (url.pathname === "/api/production-records" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Добавлять записи могут только начальник участка и старший механик" });
      const input = await readJsonBody(request);
      const result = await runAppsScript("createProductionRecord", [{ ...input, role: workstationRole, workstationId }]);
      if (result?.ok) result.record = await persistProductionShift(result.record, input.shift);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }
    if (url.pathname === "/api/production-records" && request.method === "PUT") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Исправлять записи могут только начальник участка и старший механик" });
      const input = await readJsonBody(request);
      const result = await runAppsScript("updateProductionRecord", [{ ...input, role: workstationRole, workstationId }]);
      if (result?.ok) result.record = await persistProductionShift(result.record, input.shift);
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
    if (url.pathname === "/api/packaging-records" && request.method === "DELETE") {
      if (!writesEnabled || (workstationRole !== "manager" && workstationRole !== "senior")) return sendJson(response, 403, { ok: false, message: "Удаление расхода упаковки недоступно" });
      return sendJson(response, 200, await deletePackagingRecord(await readJsonBody(request)));
    }
    if (url.pathname === "/api/nonconformities" && request.method === "GET") {
      if (!workstationRole) return sendJson(response, 403, { ok: false, message: "Назначьте роль рабочего компьютера" });
      return sendJson(response, 200, await getNonconformitySnapshot());
    }
    if (url.pathname === "/api/nonconformities" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Вносить несоответствия могут только начальник участка и старший механик" });
      return sendJson(response, 200, await createNonconformityRecord(await readJsonBody(request)));
    }
    if (url.pathname === "/api/nonconformities" && request.method === "PUT") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Исправлять несоответствия могут только начальник участка и старший механик" });
      return sendJson(response, 200, await updateNonconformityRecord(await readJsonBody(request)));
    }
    if (url.pathname === "/api/nonconformities" && request.method === "DELETE") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      if (workstationRole !== "manager" && workstationRole !== "senior") return sendJson(response, 403, { ok: false, message: "Удалять несоответствия могут только начальник участка и старший механик" });
      return sendJson(response, 200, await deleteNonconformityRecord(await readJsonBody(request)));
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
  if (workstationRole === "manager") {
    console.log(`Суточный перенос расхода упаковки: ежедневно после ${String(automaticDailyExportHour).padStart(2, "0")}:00 (Europe/Vilnius)`);
    void runAutomaticDailyPackagingExport();
    setInterval(() => void runAutomaticDailyPackagingExport(), 5 * 60_000).unref();
    console.log(`Суточная сводка продукции: ежедневно после ${String(automaticDailyExportHour).padStart(2, "0")}:00 (Europe/Vilnius)`);
    void runAutomaticDailyProductionExport();
    setInterval(() => void runAutomaticDailyProductionExport(), 5 * 60_000).unref();
  }
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
    return packageUrl.protocol === "https:"
      && packageUrl.hostname === "raw.githubusercontent.com"
      && /^\/brazhkoanatolii\/(Packaging-Filling-Hub|Packaging-Filling-Hub-Updates)\/.+\.zip$/.test(packageUrl.pathname);
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
  if (headers.length < 11 || String(headers[0]).trim() !== "Дата") {
    throw new Error("Изменилась структура журнала расхода упаковки");
  }
  const notes = await getPackagingDateNotes();
  return { ok: true, records: rows.slice(1).map((row, index) => packagingRecordFromRow(row, index + 3, notes[index] || "")).filter(Boolean) };
}

async function createPackagingRecord(input) {
  const record = validatePackagingRecord(input);
  const before = await getPackagingSnapshot();
  const existing = before.records.find(item => item.date === record.date);
  const accessToken = await getAccessToken();
  const sheetId = await getPackagingSheetId(accessToken);
  const serial = Math.round((Date.parse(`${record.date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
  const receipt = `${packagingReceiptPrefix}${JSON.stringify({ id: record.id, requestId: record.requestId, workstationId: record.workstationId, createdAt: new Date().toISOString() })}`;
  const cells = [
    { userEnteredValue: { numberValue: serial }, note: receipt, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd.MM.yyyy" } } },
    ...packagingKeys.map(key => ({ userEnteredValue: { numberValue: record.values[key] } }))
  ];
  const request = existing ? { updateCells: { start: { sheetId, rowIndex: existing.rowNumber - 1, columnIndex: 1 }, rows: [{ values: cells }], fields: "userEnteredValue,note,userEnteredFormat.numberFormat" } } : { appendCells: { sheetId, rows: [{ values: cells }], fields: "userEnteredValue,note,userEnteredFormat.numberFormat" } };
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(packagingSpreadsheetId)}:batchUpdate`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [request] }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось записать расход упаковки");
  return { ok: true, record: { id: `packaging-day-${record.date}`, requestId: record.requestId, date: record.date, values: record.values } };
}

async function deletePackagingRecord(input) {
  const id = String(input?.id || ""); if (!/^packaging-day-\d{4}-\d{2}-\d{2}$/.test(id)) throw new Error("Некорректный идентификатор дневной записи");
  const record = (await getPackagingSnapshot()).records.find(item => item.id === id); if (!record) return { ok: true };
  const accessToken = await getAccessToken(); const sheetId = await getPackagingSheetId(accessToken);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(packagingSpreadsheetId)}:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: record.rowNumber - 1, endIndex: record.rowNumber } } }] }), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})); if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось удалить дневной расход упаковки"); return { ok: true };
}

async function getNonconformitySnapshot() {
  const [journalRows, dictionaryRows] = await getGoogleSheetRanges(nonconformitySpreadsheetId, [nonconformityRange, nonconformityDictionaryRange]);
  const rows = journalRows ?? [];
  const headers = rows[0] ?? [];
  if (headers.length < 8 || String(headers[0]).trim() !== "Дата") throw new Error("Изменилась структура журнала несоответствий");
  return { ok: true, records: rows.slice(1).map((row, index) => nonconformityRecordFromRow(row, index + 3)).filter(Boolean), dictionary: { types: (dictionaryRows ?? []).slice(1).map(row => String(row[0] || "").trim()).filter(value => value && value !== "Вид несоответствия") } };
}

function nonconformityRecordFromRow(row, rowNumber) {
  if (!row?.some(value => String(value || "").trim())) return null;
  const date = googleSheetDate(row[0]);
  if (!date) throw new Error("Проверьте дату в строке " + rowNumber + " журнала несоответствий");
  return { id: "nonconformity-" + rowNumber, rowNumber, date, shift: String(row[1] || "").trim(), category: String(row[2] || "").trim(), type: String(row[3] || "").trim(), cause: String(row[4] || "").trim(), correctiveAction: String(row[5] || "").trim(), responsible: String(row[6] || "").trim(), status: String(row[7] || "").trim() };
}

function validateNonconformityRecord(input) {
  const text = (key, label, limit = 5000) => { const value = String(input?.[key] || "").trim(); if (!value) throw new Error("Заполните поле «" + label + "»"); if (value.length > limit) throw new Error("Поле «" + label + "» слишком длинное"); return value; };
  const date = String(input?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > vilniusDate()) throw new Error("Некорректная дата несоответствия");
  const shift = text("shift", "Смена", 2).toUpperCase();
  if (!["A", "B"].includes(shift)) throw new Error("Смена должна быть A или B");
  return { date, shift, category: text("category", "Категория", 180), type: text("type", "Вид несоответствия", 500), cause: text("cause", "Причина появления"), correctiveAction: text("correctiveAction", "Корректирующие действия"), responsible: text("responsible", "Ответственный", 180), status: text("status", "Отметка о выполнении", 100) };
}

async function createNonconformityRecord(input) {
  const record = validateNonconformityRecord(input);
  const accessToken = await getAccessToken();
  const endpoint = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(nonconformitySpreadsheetId) + "/values/" + encodeURIComponent("'Журнал'!A:H") + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, body: JSON.stringify({ values: [[displayDate(record.date), record.shift, record.category, record.type, record.cause, record.correctiveAction, record.responsible, record.status]] }), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось внести несоответствие");
  const rowNumber = Number(String(payload.updates?.updatedRange || "").match(/!(?:[A-Z]+)(\d+):/)?.[1]);
  return { ok: true, record: { ...record, id: "nonconformity-" + rowNumber, rowNumber } };
}

async function updateNonconformityRecord(input) {
  const record = validateNonconformityRecord(input);
  const id = String(input?.id || "");
  const rowNumber = Number(id.match(/^nonconformity-(\d+)$/)?.[1]);
  if (!Number.isInteger(rowNumber) || rowNumber < 3) throw new Error("Некорректный идентификатор записи");
  const accessToken = await getAccessToken();
  await setGoogleSheetRanges(nonconformitySpreadsheetId, accessToken, [{ range: "'Журнал'!A" + rowNumber + ":H" + rowNumber, values: [[displayDate(record.date), record.shift, record.category, record.type, record.cause, record.correctiveAction, record.responsible, record.status]] }]);
  return { ok: true, record: { ...record, id, rowNumber } };
}

async function deleteNonconformityRecord(input) {
  const rowNumber = Number(String(input?.id || "").match(/^nonconformity-(\d+)$/)?.[1]);
  if (!Number.isInteger(rowNumber) || rowNumber < 3) throw new Error("Некорректный идентификатор записи");
  const accessToken = await getAccessToken();
  const sheetId = await getSheetId(nonconformitySpreadsheetId, nonconformitySheetName, accessToken);
  const response = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(nonconformitySpreadsheetId) + ":batchUpdate", { method: "POST", headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber } } }] }), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось удалить несоответствие");
  return { ok: true };
}

async function exportPackagingDaily(input) {
  const date = String(input?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= vilniusDate()) throw new Error("Передавать можно только завершённый день");
  const source = (await getPackagingSnapshot()).records.find(record => record.date === date);
  if (!source) throw new Error(`В журнале упаковки нет итогов за ${displayDate(date)}`);
  const [rawRow, cansRow] = await Promise.all([
    getDailyTargetRow(rawMaterialsSpreadsheetId, rawMaterialsRange, date, 3, "Расход сырья"),
    getDailyTargetRow(cansSpreadsheetId, cansRange, date, 4, "Банки")
  ]);
  const accessToken = await getAccessToken();
  const [rawSheetId, cansSheetId] = await Promise.all([
    getSheetId(rawMaterialsSpreadsheetId, rawMaterialsSheetName, accessToken),
    getSheetId(cansSpreadsheetId, cansSheetName, accessToken)
  ]);
  await Promise.all([
    updateSheetCells(rawMaterialsSpreadsheetId, accessToken, { sheetId: rawSheetId, rowIndex: rawRow.rowNumber - 1, columnIndex: 1 }, [source.values.garantBox430, source.values.garantBox570, source.values.dochemsPaper]),
    Promise.all([
      updateSheetCells(cansSpreadsheetId, accessToken, { sheetId: cansSheetId, rowIndex: cansRow.rowNumber - 1, columnIndex: 1 }, [source.values.killaCanClear, source.values.killaCanGreen]),
      updateSheetCells(cansSpreadsheetId, accessToken, { sheetId: cansSheetId, rowIndex: cansRow.rowNumber - 1, columnIndex: 5 }, [source.values.killaLidGreen, source.values.dzCanClear, source.values.dzCanGreen, source.values.dzLidBlack, source.values.dzLidWhite])
    ])
  ]);
  return { ok: true, date, rawMaterials: { rowNumber: rawRow.rowNumber }, cans: { rowNumber: cansRow.rowNumber } };
}

async function runAutomaticDailyPackagingExport() {
  if (!writesEnabled || missingGoogleSettings().length) return;
  const clock = vilniusClock();
  if (clock.hour < automaticDailyExportHour || automaticDailyExportCompletedDate === clock.date) return;
  if (Date.now() - automaticDailyExportAttemptAt < 60 * 60_000) return;
  automaticDailyExportAttemptAt = Date.now();
  const date = previousCalendarDate(clock.date);
  try {
    await exportPackagingDaily({ date });
    automaticDailyExportCompletedDate = clock.date;
    console.log(`Суточный перенос расхода упаковки выполнен: ${date}`);
  } catch (error) {
    console.warn(`Суточный перенос расхода упаковки не выполнен за ${date}: ${error.message}`);
  }
}

async function getProductionSnapshot() {
  const result = await runAppsScript("getProductionSnapshot");
  if (!result?.ok || !Array.isArray(result.records)) return result;
  const shifts = await getProductionShiftRows();
  const bySignature = new Map();
  for (const row of shifts.second) {
    const key = productionSignature(row);
    const queue = bySignature.get(key) ?? [];
    queue.push(row.shift);
    bySignature.set(key, queue);
  }
  return {
    ...result,
    records: result.records.map(record => ({ ...record, shift: (bySignature.get(productionSignature(record)) ?? []).shift() ?? "" }))
  };
}

async function persistProductionShift(record, inputShift) {
  const shift = String(inputShift || "").trim().toUpperCase();
  if (!record || !["A", "B"].includes(shift)) throw new Error("Не удалось определить смену из табеля");
  const rows = await getProductionShiftRows();
  const signature = productionSignature(record);
  const second = [...rows.second].reverse().find(row => productionSignature(row) === signature);
  const first = [...rows.first].reverse().find(row => productionSignature(row) === signature);
  if (!second || !first) throw new Error("Не удалось найти новую запись в обоих листах продукции");
  const accessToken = await getAccessToken();
  await setGoogleSheetRanges(productionSpreadsheetId, accessToken, [
    { range: "'Учет продукции 1'!M2", values: [["Смена"]] },
    { range: "'Учет продукции 2'!M1", values: [["Смена"]] },
    { range: `'Учет продукции 1'!M${first.rowNumber}`, values: [[shift]] },
    { range: `'Учет продукции 2'!M${second.rowNumber}`, values: [[shift]] }
  ]);
  return { ...record, shift };
}

async function getProductionShiftRows() {
  const [secondRows, firstRows] = await getGoogleSheetRanges(productionSpreadsheetId, [productionSecondRange, productionFirstRange]);
  return {
    second: (secondRows ?? []).map((row, index) => productionRowFromSecond(row, index + 2)).filter(Boolean),
    first: (firstRows ?? []).map((row, index) => productionRowFromFirst(row, index + 4)).filter(Boolean)
  };
}

function productionRowFromSecond(row, rowNumber) {
  const date = googleSheetDate(row?.[0]);
  if (!date || !String(row?.[3] || "").trim()) return null;
  return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), product: String(row[3] || "").trim(), packer: String(row[7] || "").trim(), operator: String(row[8] || "").trim(), line: String(row[9] || "").trim(), shift: String(row[12] || "").trim().toUpperCase() };
}

function productionRowFromFirst(row, rowNumber) {
  const date = googleSheetDate(row?.[0]);
  if (!date || !String(row?.[3] || "").trim()) return null;
  return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), product: String(row[3] || "").trim(), packer: String(row[8] || "").trim(), operator: String(row[9] || "").trim(), line: String(row[10] || "").trim(), shift: String(row[11] || "").trim().toUpperCase() };
}

function productionSignature(record) {
  return [record.date, record.startTime, record.time, record.product, record.packer, record.operator, record.line || record.machineLine]
    .map(value => String(value || "").trim().toLocaleLowerCase("ru"))
    .join("\u001f");
}

async function exportProductionDaily(input) {
  const date = String(input?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= vilniusDate()) throw new Error("Передавать можно только завершённый день");
  const records = (await getProductionSnapshot()).records.filter(record => record.date === date);
  if (!records.length) return { ok: true, date, empty: true };
  if (records.some(record => !["A", "B"].includes(String(record.shift)))) throw new Error(`В продукции за ${displayDate(date)} есть записи без смены`);
  const [machineRows, packerRows, scrapRows, packerHeaders, scrapHeaders] = await Promise.all([
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionMachineRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionPackerRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionScrapRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Упаковщики'!A6:V6"]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Брак'!A6:V6"])
  ]);
  const accessToken = await getAccessToken();
  const [machineSheetId, packerSheetId, scrapSheetId] = await Promise.all([
    getSheetId(productionReportSpreadsheetId, "Станки", accessToken),
    getSheetId(productionReportSpreadsheetId, "Упаковщики", accessToken),
    getSheetId(productionReportSpreadsheetId, "Брак", accessToken)
  ]);
  const machine = machineRows[0] ?? [];
  const packers = packerRows[0] ?? [];
  const scrap = scrapRows[0] ?? [];
  const packerHeader = packerHeaders[0]?.[0] ?? [];
  const scrapHeader = scrapHeaders[0]?.[0] ?? [];
  const writes = [];
  for (const shift of ["A", "B"]) {
    const target = findDailyShiftRow(machine, date, shift, 7, "Станки");
    const values = Array(8).fill(0);
    records.filter(record => record.shift === shift).forEach(record => {
      const column = productionMachineColumns[String(record.line || "").toUpperCase()];
      if (column !== undefined) values[column - 2] += Number(record.quantity || 0) / 240;
    });
    writes.push(updateSheetCells(productionReportSpreadsheetId, accessToken, { sheetId: machineSheetId, rowIndex: target.rowNumber - 1, columnIndex: 2 }, values));
  }
  const packerTarget = getDailyTargetRowFromRows(packers, date, 7, "Упаковщики");
  const scrapTarget = getDailyTargetRowFromRows(scrap, date, 7, "Брак");
  writes.push(
    updateDailyPeopleValues(productionReportSpreadsheetId, accessToken, packerSheetId, packerTarget.rowNumber, packerHeader, records, record => Number(record.quantity || 0) / 240),
    updateDailyPeopleValues(productionReportSpreadsheetId, accessToken, scrapSheetId, scrapTarget.rowNumber, scrapHeader, records, record => Number(record.scrapKg || 0))
  );
  await Promise.all(writes);
  return { ok: true, date, records: records.length };
}

async function updateDailyPeopleValues(spreadsheetId, accessToken, sheetId, rowNumber, headers, records, valueFor) {
  const totalIndex = headers.findIndex(value => String(value).trim().startsWith("Всего,"));
  if (totalIndex < 2) throw new Error("Изменилась структура дневной сводки по сотрудникам");
  const people = headers.slice(1, totalIndex);
  const totals = new Map();
  records.forEach(record => totals.set(record.packer, (totals.get(record.packer) || 0) + valueFor(record)));
  return updateSheetCells(spreadsheetId, accessToken, { sheetId, rowIndex: rowNumber - 1, columnIndex: 1 }, people.map(name => totals.get(String(name).trim()) || 0));
}

function findDailyShiftRow(rows, date, shift, startRow, label) {
  const index = rows.findIndex(row => googleSheetDate(row[0]) === date && String(row[1] || "").trim().toUpperCase() === shift);
  if (index < 0) throw new Error(`В листе «${label}» не найдена строка ${displayDate(date)} · смена ${shift}`);
  return { rowNumber: startRow + index };
}

function getDailyTargetRowFromRows(rows, date, startRow, label) {
  const index = rows.findIndex(row => googleSheetDate(row[0]) === date);
  if (index < 0) throw new Error(`В листе «${label}» не найдена строка даты ${displayDate(date)}`);
  return { rowNumber: startRow + index };
}

async function runAutomaticDailyProductionExport() {
  if (!writesEnabled || missingGoogleSettings().length) return;
  const clock = vilniusClock();
  if (clock.hour < automaticDailyExportHour || automaticDailyProductionExportCompletedDate === clock.date) return;
  if (Date.now() - automaticDailyProductionExportAttemptAt < 60 * 60_000) return;
  automaticDailyProductionExportAttemptAt = Date.now();
  const date = previousCalendarDate(clock.date);
  try {
    const result = await exportProductionDaily({ date });
    automaticDailyProductionExportCompletedDate = clock.date;
    console.log(result.empty ? `Сводка продукции: записей за ${date} нет` : `Суточная сводка продукции выполнена: ${date}`);
  } catch (error) {
    console.warn(`Суточная сводка продукции не выполнена за ${date}: ${error.message}`);
  }
}

async function getDailyTargetRow(spreadsheetId, range, date, startRow, label) {
  const rows = (await getGoogleSheetRanges(spreadsheetId, [range]))[0] ?? [];
  const index = rows.findIndex(row => googleSheetDate(row[0]) === date);
  if (index < 0) throw new Error(`В листе «${label}» не найдена строка даты ${displayDate(date)}`);
  return { rowNumber: startRow + index };
}

async function updateSheetCells(spreadsheetId, accessToken, start, values) {
  const request = { updateCells: { start, rows: [{ values: values.map(value => ({ userEnteredValue: { numberValue: Number(value || 0) } })) }], fields: "userEnteredValue" } };
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [request] }), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось передать суточные итоги");
}

function validatePackagingRecord(input) {
  if (!input || !["manager", "senior"].includes(input.role)) throw new Error("Недостаточно прав");
  const id = String(input.recordId || ""); const requestId = String(input.requestId || "");
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id) || !/^[a-zA-Z0-9_-]{8,160}$/.test(requestId)) throw new Error("Некорректный идентификатор записи");
  const date = String(input.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > vilniusDate()) throw new Error("Некорректная дата расхода упаковки");
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

async function getPackagingSheetId(accessToken) { return getSheetId(packagingSpreadsheetId, packagingSheetName, accessToken); }

async function getSheetId(spreadsheetId, sheetName, accessToken) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось открыть рабочий журнал");
  const sheet = payload.sheets?.find(item => item.properties?.title === sheetName);
  if (!sheet) throw new Error(`Не найден лист «${sheetName}»`);
  return sheet.properties.sheetId;
}

function packagingRecordFromRow(row, rowNumber, note) {
  if (!row?.some(value => value !== "" && value !== undefined)) return null;
  const date = googleSheetDate(row[0]);
  if (!date) throw new Error(`Проверьте строку ${rowNumber} журнала расхода упаковки`);
  let receipt = {};
  if (String(note).startsWith(packagingReceiptPrefix)) { try { receipt = JSON.parse(String(note).slice(packagingReceiptPrefix.length)); } catch { throw new Error(`Повреждена служебная отметка в строке ${rowNumber}`); } }
  return { id: `packaging-day-${date}`, requestId: receipt.requestId || "", rowNumber, date, values: Object.fromEntries(packagingKeys.map((key, index) => [key, Number(row[index + 1] || 0)])) };
}

function googleSerialToDate(value) {
  const serial = Number(value); if (!Number.isFinite(serial)) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function googleSheetDate(value) {
  const serialDate = googleSerialToDate(value); if (serialDate) return serialDate;
  const match = String(value || "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
}

function displayDate(value) { const [year, month, day] = String(value).split("-"); return `${day}.${month}.${year}`; }

function vilniusDate() {
  return vilniusClock().date;
}

function vilniusClock() {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "Europe/Vilnius", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) };
}

function previousCalendarDate(date) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10); }

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

async function setGoogleSheetRanges(spreadsheetId, accessToken, data) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось сохранить смену в журнале продукции");
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

function hourFromEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (Number.isInteger(value) && value >= 0 && value <= 23) return value;
  throw new Error(`${name} должен быть целым числом от 0 до 23`);
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
