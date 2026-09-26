import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CentralAuthService, readCookie } from "./central-auth.mjs";

const projectRoot = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
loadEnvironment(join(projectRoot, ".env"));

const appVersion = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;
const port = numberFromEnvironment("PORT", 4173);
const host = process.env.HOST || "127.0.0.1";
const writesEnabled = process.env.GOOGLE_WRITES_ENABLED === "true";
const centralMode = process.env.DEPLOYMENT_MODE === "central";
const workstationRole = normalizeWorkstationRole(process.env.WORKSTATION_ROLE);
const workstationId = normalizeWorkstationId(process.env.WORKSTATION_ID);
const workstationLabel = normalizeWorkstationLabel(process.env.WORKSTATION_LABEL);
const updateManifestUrl = process.env.UPDATE_MANIFEST_URL || "https://raw.githubusercontent.com/brazhkoanatolii/Packaging-Filling-Hub-Updates/main/update-manifest.json";
const updateManifestFallbackUrl = "https://api.github.com/repos/brazhkoanatolii/Packaging-Filling-Hub-Updates/contents/update-manifest.json?ref=main";
const updateRepositoryCommitUrl = "https://api.github.com/repos/brazhkoanatolii/Packaging-Filling-Hub-Updates/commits/main";
const maintenanceDueSpreadsheetId = "1_BTwm21m1edVoNew6m5GJirPdUsxnJYE_Xv9qB32c5c";
const maintenanceDueRange = "'ТО'!A6:H";
const repairsSpreadsheetId = "1pg2Y9Hnc-5BCU3QaF3k9VwOJjqNwdkXbE3qFAnY6Qw8";
const repairsDictionaryRange = "'Справочники'!A1:D1000";
const packagingSpreadsheetId = "1n7OfVi8__XWRJhj5jtlRUbrU6O9wGLmlDDf0e9-UKoI";
const packagingSheetName = "Лист";
const packagingRange = "'Лист'!B2:M";
const packagingReceiptPrefix = "PFH_PACKAGING_V1:";
const packagingKeys = Object.freeze(["garantBox430", "garantBox570", "dochemsPaper", "killaCanClear", "killaCanGreen", "killaLidGreen", "dzCanClear", "dzCanGreen", "dzLidBlack", "dzLidWhite"]);
const packagingPendingPath = process.env.PACKAGING_PENDING_PATH
  ? resolve(process.env.PACKAGING_PENDING_PATH)
  : join(projectRoot, ".runtime", "packaging-pending.json");
const packagingWarehouseSpreadsheetId = "1mv7W6IcetxpSNMlTvQclPMIs15ZWZw7Q3ZE_g_NXVok";
const packagingWarehouseSheetName = "Операции";
const packagingWarehouseRange = "'Операции'!A6:F";
const packagingWarehouseSummaryRange = "'Склад упаковки'!A6:I";
const rawMaterialsSpreadsheetId = "1jXf8oZLrFLGEJo15VoFQBe_FjC0_dz_3p0cVxgV4xGo";
const rawMaterialsSheetName = "Расход сырья";
const rawMaterialsRange = "'Расход сырья'!A3:D500";
const cansSpreadsheetId = "1-rEj8fvmBE4A5GO8o1ZXU1Ke0-ppK-gwKwCZt_kpwV4";
const cansSheetName = "Банки";
const cansRange = "'Банки'!A4:J500";
const productionSpreadsheetId = "1zHYsa1pO7xLuSbBC43J_IPChlVfZaxt4L_rI9MtKwqA";
const productionSecondRange = "'Учет продукции 2'!A2:P";
const productionFirstRange = "'Учет продукции 1'!B4:P";
const productionReportSpreadsheetId = "1_BTwm21m1edVoNew6m5GJirPdUsxnJYE_Xv9qB32c5c";
const productionMachineRange = "'Станки'!A7:M500";
const productionPackerRange = "'Упаковщики'!A7:V500";
const productionScrapRange = "'Брак'!A7:V500";
const productionOperatorRange = "'Механики-операторы'!A7:V500";
const productionLeaderRange = "'Старшие механики и механики'!A7:V500";
const productionMachineColumns = Object.freeze({ A: 2, B: 3, D: 4, F: 5, H: 6, K: 7, L: 8, M: 9 });
const nonconformitySpreadsheetId = "1ovuf2QW5KC4_CI1wAEUcufhZXfLreeJhN2PNVPtjlrk";
const nonconformitySheetName = "Журнал";
const nonconformityRange = "'Журнал'!A2:H";
const nonconformityDictionaryRange = "'Справочник несоответсвий'!B2:B";
const automaticDailyExportHour = hourFromEnvironment("AUTOMATIC_DAILY_EXPORT_HOUR", 7);
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
const centralAccountsPath = process.env.CENTRAL_ACCOUNTS_PATH
  ? resolve(process.env.CENTRAL_ACCOUNTS_PATH)
  : join(projectRoot, ".runtime", "central-accounts.json");
const centralShiftStatePath = process.env.CENTRAL_SHIFT_STATE_PATH
  ? resolve(process.env.CENTRAL_SHIFT_STATE_PATH)
  : join(projectRoot, ".runtime", "central-shift-state.json");
const centralAuth = centralMode
  ? new CentralAuthService({ accountsPath: centralAccountsPath })
  : null;
if (centralAuth) {
  centralAuth.initialize({
    manager: process.env.CENTRAL_MANAGER_PASSWORD,
    "senior-mechanic": process.env.CENTRAL_SENIOR_PASSWORD
  });
}

let tokenCache = null;
let tokenRefreshPromise = null;
let maintenanceDueSnapshotCache = null;
let maintenanceDueSnapshotPromise = null;
const maintenanceDueSnapshotCacheMs = 60_000;
let automaticDailyExportCompletedDate = null;
let automaticDailyExportAttemptAt = 0;
let automaticDailyProductionExportCompletedDate = null;
let automaticDailyProductionExportAttemptAt = 0;
let automaticUpdateAttemptAt = 0;
let automaticUpdateRunning = false;
let cachedFallbackManifest = null;
let fallbackManifestCheckedAt = 0;

// Background work must never terminate the central server.  In particular,
// Google can reject an automatic daily export when a target range has been
// protected after the server was configured.  Log the failure and leave the
// API available so that the responsible person can correct the spreadsheet.
function runBackgroundTask(label, task) {
  void Promise.resolve()
    .then(task)
    .catch(error => console.error(`[gateway] Фоновая задача «${label}» завершилась с ошибкой: ${error?.message || error}`));
}

process.on("unhandledRejection", error => {
  console.error(`[gateway] Необработанная фоновая ошибка: ${error?.message || error}`);
});

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);

    if (url.pathname === "/runtime-config.js") {
      return sendJavaScript(response, `globalThis.__PACKAGING_FILLING_CONFIG__ = Object.freeze(${JSON.stringify({
        mode: "gateway",
        googleWritesEnabled: writesEnabled,
        gatewayBaseUrl: "",
        workstationRole: centralMode ? null : workstationRole,
        workstationId: centralMode ? null : workstationId,
        workstationLabel: centralMode ? "Центральный сервер участка" : workstationLabel,
        version: appVersion,
        centralAuth: centralMode
      })});`);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return sendJson(response, 200, {
        ok: true,
        version: appVersion,
        configured: missingGoogleSettings().length === 0,
        writesEnabled,
        deploymentMode: centralMode ? "central" : "workstation",
        workstationRole: centralMode ? null : workstationRole,
        workstationConfigured: centralMode || workstationRole !== null,
        workstationId,
        workstationLabel,
        missing: missingGoogleSettings()
      });
    }

    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      return sendJson(response, 200, { ok: true, account: centralAuth ? actorFromRequest(request) : null });
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      if (!centralAuth) return sendJson(response, 404, { ok: false, message: "Центральный вход не настроен" });
      const input = await readJsonBody(request);
      const session = centralAuth.login(input.accountId, input.password);
      return sendJson(response, 200, { ok: true, account: session.account }, {
        "Set-Cookie": sessionCookie(session.token, session.expiresAt)
      });
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      if (centralAuth) centralAuth.logout(readCookie(request, "PFH_SESSION"));
      return sendJson(response, 200, { ok: true }, { "Set-Cookie": expiredSessionCookie() });
    }
    if (url.pathname === "/api/auth/password" && request.method === "POST") {
      const actor = requireActor(request);
      if (!centralAuth) return sendJson(response, 404, { ok: false, message: "Центральный вход не настроен" });
      const input = await readJsonBody(request);
      centralAuth.changePassword(actor, input.accountId, input.currentPassword, input.nextPassword);
      return sendJson(response, 200, { ok: true });
    }

    // The active shift is operational state, not a Google Sheets row and not
    // browser data. Every central-mode client therefore reads the same record.
    if (url.pathname === "/api/shift-state" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, { ok: true, shift: readCentralShiftState() });
    }
    if (url.pathname === "/api/shift-state" && request.method === "POST") {
      const actor = requireActor(request, ["manager", "senior"]);
      const input = await readJsonBody(request);
      return sendJson(response, 200, { ok: true, shift: await updateCentralShiftState(input, actor) });
    }

    if (url.pathname === "/api/update-status" && request.method === "GET") {
      return sendJson(response, 200, await getUpdateStatus());
    }
    if (url.pathname === "/api/update" && request.method === "POST") {
      const update = await getUpdateStatus();
      if (!update.available) return sendJson(response, 409, { ok: false, message: "Новой версии нет" });
      if (process.platform !== "win32") return sendJson(response, 501, { ok: false, message: "Автообновление доступно только в Windows" });
      startVerifiedUpdate(update, "ручной запуск");
      return sendJson(response, 202, { ok: true, version: update.version });
    }

    if (url.pathname === "/api/cyclone-records") {
      const actor = requireActor(request, ["manager", "senior"]);
      if (request.method === "GET") return sendJson(response, 200, await runAppsScript("listCycloneRecords"));
      if (request.method === "POST") {
        if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
        const input = await readJsonBody(request);
        const result = await runAppsScript("createCycloneRecord", [{
          requestId: input.requestId, recordId: input.recordId, date: input.date, performer: input.performer,
          role: actor.role, workstationId: workstationId || actor.id
        }]);
        return sendJson(response, result?.ok === false ? 400 : 200, result);
      }
      return sendJson(response, 405, { ok: false, message: "Допускаются только чтение и добавление очисток" });
    }

    if (url.pathname === "/api/scale-records" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      const result = await runAppsScript("listScaleRecords");
      return sendJson(response, 200, result);
    }

    if (url.pathname === "/api/workforce" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await getWorkforceSnapshot());
    }
    if (url.pathname === "/api/workforce" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена" });
      const payload = await readJsonBody(request);
      const actor = requireActor(request, payload.kind === "attendance" ? ["manager", "senior"] : ["manager"]);
      const result = await runAppsScript("writeWorkforceOperation", [{ ...payload, role: actor.role }]);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }

    if (url.pathname === "/api/maintenance" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      const result = await runAppsScript("getMaintenanceSnapshot");
      return sendJson(response, result?.ok === false ? 400 : 200, result);
    }
    if (url.pathname === "/api/maintenance-due" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await getMaintenanceDueSnapshot());
    }
    if (url.pathname === "/api/maintenance" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена Администрацией" });
      const actor = requireActor(request, ["manager", "senior"]);
      const payload = await readJsonBody(request);
      if (payload.journal === "repair") return sendJson(response, 200, await createRepairRecord(payload, actor));
      const functionName = payload.journal === "service" ? "createMaintenanceRecord" : null;
      if (!functionName) return sendJson(response, 400, { ok: false, message: "Укажите журнал: ТО или ремонт" });
      const result = await runAppsScript(functionName, [{ ...payload, role: actor.role, workstationId: workstationId || actor.id }]);
      return sendJson(response, result?.ok === false ? (result.status || 400) : 200, result);
    }

    if (url.pathname === "/api/production-records" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      const result = await getProductionSnapshot();
      return sendJson(response, result?.ok === false ? 400 : 200, result);
    }
    if (url.pathname === "/api/production-records" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена Администрацией" });
      const actor = requireActor(request, ["manager", "senior"]);
      const input = await readJsonBody(request);
      return sendJson(response, 200, { ok: true, record: await createProductionRecord(input, actor) });
    }
    if (url.pathname === "/api/production-records" && request.method === "PUT") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена Администрацией" });
      const actor = requireActor(request, ["manager", "senior"]);
      const input = await readJsonBody(request);
      return sendJson(response, 200, { ok: true, record: await updateProductionRecord(input, actor) });
    }
    if (url.pathname === "/api/production-records" && request.method === "DELETE") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      requireActor(request, ["manager", "senior"]);
      await deleteProductionRecord(await readJsonBody(request));
      return sendJson(response, 200, { ok: true });
    }

    if (url.pathname === "/api/packaging-records" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await getPackagingSnapshot());
    }
    if (url.pathname === "/api/packaging-records" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      const actor = requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await createPackagingRecord({ ...(await readJsonBody(request)), role: actor.role, workstationId: workstationId || actor.id }));
    }
    if (url.pathname === "/api/packaging-records" && request.method === "DELETE") {
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await deletePackagingRecord(await readJsonBody(request)));
    }
    if (url.pathname === "/api/packaging-warehouse-records" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await getPackagingWarehouseSnapshot());
    }
    if (url.pathname === "/api/packaging-warehouse-records" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      const actor = requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await savePackagingWarehouseRecord({ ...(await readJsonBody(request)), author: actor.title || actor.id }));
    }
    if (url.pathname === "/api/packaging-warehouse-records" && request.method === "PUT") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      const actor = requireActor(request, ["manager"]);
      return sendJson(response, 200, await savePackagingWarehouseRecord({ ...(await readJsonBody(request)), author: actor.title || actor.id }));
    }
    if (url.pathname === "/api/packaging-warehouse-records" && request.method === "DELETE") {
      requireActor(request, ["manager"]);
      return sendJson(response, 200, await deletePackagingWarehouseRecord(await readJsonBody(request)));
    }
    if (url.pathname === "/api/nonconformities" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await getNonconformitySnapshot());
    }
    if (url.pathname === "/api/nonconformities" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await createNonconformityRecord(await readJsonBody(request)));
    }
    if (url.pathname === "/api/nonconformities" && request.method === "PUT") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await updateNonconformityRecord(await readJsonBody(request)));
    }
    if (url.pathname === "/api/nonconformities" && request.method === "DELETE") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      requireActor(request, ["manager", "senior"]);
      return sendJson(response, 200, await deleteNonconformityRecord(await readJsonBody(request)));
    }
    if (url.pathname === "/api/specifications" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      const specifications = await runAppsScript("listProductSpecifications");
      return sendJson(response, 200, { ok: true, specifications: Array.isArray(specifications) ? specifications : [] });
    }
    if (url.pathname === "/api/specifications" && request.method === "POST") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      const actor = requireActor(request, ["manager"]);
      const specification = await runAppsScript("saveProductSpecification", [{ ...(await readJsonBody(request)), role: actor.role }]);
      return sendJson(response, 200, { ok: true, specification });
    }
    if (url.pathname === "/api/specifications" && request.method === "DELETE") {
      if (!writesEnabled) return sendJson(response, 403, { ok: false, message: "Запись в Google выключена начальником участка" });
      const actor = requireActor(request, ["manager"]);
      const result = await runAppsScript("deleteProductSpecification", [{ ...(await readJsonBody(request)), role: actor.role }]);
      return sendJson(response, 200, result);
    }

    if (url.pathname === "/api/scale-records" && request.method === "POST") {
      if (!writesEnabled) {
        return sendJson(response, 403, { ok: false, message: "Запись в Google пока выключена начальником участка" });
      }
      requireActor(request, ["manager", "senior"]);
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
      message: status >= 500 ? (error.publicMessage || "Не удалось выполнить запрос к Google") : error.message
    });
  }
}).listen(port, host, () => {
  console.log(`Packaging-Filling-Hub: http://${host}:${port}`);
  console.log(`Рабочее место: ${workstationLabel || workstationId || workstationRole || "не назначено"}`);
  console.log(`Google: ${missingGoogleSettings().length ? "требуется настройка" : "настроен"}; запись: ${writesEnabled ? "включена" : "выключена"}`);
  if (centralMode || workstationRole === "manager") {
    console.log(`Суточный перенос расхода упаковки: ежедневно после ${String(automaticDailyExportHour).padStart(2, "0")}:00 (Europe/Vilnius)`);
    runBackgroundTask("суточный перенос расхода упаковки", runAutomaticDailyPackagingExport);
    setInterval(() => runBackgroundTask("суточный перенос расхода упаковки", runAutomaticDailyPackagingExport), 5 * 60_000).unref();
    console.log(`Суточная сводка продукции: ежедневно после ${String(automaticDailyExportHour).padStart(2, "0")}:00 (Europe/Vilnius)`);
    runBackgroundTask("суточная сводка продукции", runAutomaticDailyProductionExport);
    setInterval(() => runBackgroundTask("суточная сводка продукции", runAutomaticDailyProductionExport), 5 * 60_000).unref();
    runBackgroundTask("заполнение старшего механика и механика в журнале продукции", backfillProductionLeaders);
  }
  if (process.platform === "win32") {
    console.log("Автообновление: проверка каждую минуту; подтверждённая версия устанавливается автоматически.");
    runBackgroundTask("автообновление", runAutomaticUpdate);
    setInterval(() => runBackgroundTask("автообновление", runAutomaticUpdate), 60_000).unref();
  }
});

async function runAutomaticUpdate() {
  if (automaticUpdateRunning || Date.now() - automaticUpdateAttemptAt < 55_000) return;
  automaticUpdateAttemptAt = Date.now();
  const update = await getUpdateStatus();
  if (!update.available) return;
  automaticUpdateRunning = true;
  try {
    startVerifiedUpdate(update, "автоматический запуск");
  } catch (error) {
    automaticUpdateRunning = false;
    console.error(`[update] Не удалось запустить обновление: ${error.message}`);
  }
}

function startVerifiedUpdate(update, source) {
  const updater = join(projectRoot, "scripts", "windows", "update-program.ps1");
  if (!existsSync(updater)) throw new Error("Не найден сценарий обновления");
  console.log(`[update] ${source}: версия ${update.version}.`);
  const windowsPowerShell = process.env.SystemRoot
    ? join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const shell = existsSync(windowsPowerShell) ? windowsPowerShell : "powershell.exe";
  const psLiteral = value => `'${String(value).replace(/'/g, "''")}'`;
  // A directly detached process is silently discarded by Windows on some
  // managed desktops.  Start-Process creates an independent installer, while
  // this tiny launcher can safely exit as soon as Windows accepts the job.
  const command = `Start-Process -FilePath ${psLiteral(shell)} -ArgumentList @(${[
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", updater,
    "-InstallRoot", projectRoot, "-PackageUrl", update.packageUrl,
    "-ExpectedSha256", update.sha256
  ].map(psLiteral).join(", ")}) -WindowStyle Hidden`;
  const child = spawn(shell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    stdio: "ignore",
    windowsHide: true
  });
  child.once("error", error => console.error(`[update] PowerShell не запущен: ${error.message}`));
  child.unref();
}

async function getUpdateStatus() {
  const base = { ok: true, currentVersion: appVersion, available: false, message: "Новая версия не найдена" };
  try {
    const primary = await readUpdateManifest(updateManifestUrl);
    const primaryStatus = updateStatusFromManifest(base, primary);
    if (primaryStatus?.available || process.env.UPDATE_MANIFEST_URL) return primaryStatus || { ...base, message: "Сведения об обновлении не прошли проверку" };

    // Some corporate proxies retain the raw GitHub file after a release. The
    // fallback reads the same manifest through GitHub's API at most once per
    // five minutes and still applies the identical URL and SHA validation.
    const fallback = await readFreshUpdateManifest();
    return updateStatusFromManifest(base, fallback) || primaryStatus || { ...base, message: "Не удалось проверить обновление" };
  } catch {
    return { ...base, message: "Не удалось проверить обновление" };
  }
}

async function readUpdateManifest(url) {
  const target = new URL(url);
  target.searchParams.set("pfh-update", String(Date.now()));
  const response = await fetch(target, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(7_000)
  });
  if (!response.ok) return null;
  return response.json();
}

async function readFreshUpdateManifest() {
  if (Date.now() - fallbackManifestCheckedAt < 60_000) return cachedFallbackManifest;
  fallbackManifestCheckedAt = Date.now();
  try {
    const cacheKey = String(Date.now());
    const response = await fetch(`${updateManifestFallbackUrl}&pfh-update=${cacheKey}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Packaging-Filling-Hub" },
      signal: AbortSignal.timeout(7_000)
    });
    if (!response.ok) return cachedFallbackManifest;
    const payload = await response.json();
    const content = Buffer.from(String(payload.content || "").replace(/\s/g, ""), "base64").toString("utf8");
    const manifest = JSON.parse(content);
    const commitResponse = await fetch(`${updateRepositoryCommitUrl}?pfh-update=${cacheKey}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Packaging-Filling-Hub" },
      signal: AbortSignal.timeout(7_000)
    });
    const commit = commitResponse.ok ? await commitResponse.json() : null;
    cachedFallbackManifest = isSafeUpdateManifest(manifest)
      ? pinUpdatePackageToCommit(manifest, commit?.sha)
      : null;
  } catch {
    // The ordinary raw manifest remains the primary update path.
  }
  return cachedFallbackManifest;
}

function updateStatusFromManifest(base, manifest) {
  if (!isSafeUpdateManifest(manifest)) return null;
  return compareVersions(manifest.version, appVersion) > 0
    ? { ...base, available: true, version: manifest.version, packageUrl: manifest.packageUrl, sha256: manifest.sha256, message: `Доступна версия ${manifest.version}` }
    : base;
}

function pinUpdatePackageToCommit(manifest, commit) {
  if (!/^[a-f0-9]{40}$/i.test(String(commit || ""))) return manifest;
  try {
    const packageUrl = new URL(manifest.packageUrl);
    const prefix = "/brazhkoanatolii/Packaging-Filling-Hub-Updates/main/";
    if (packageUrl.hostname !== "raw.githubusercontent.com" || !packageUrl.pathname.startsWith(prefix)) return manifest;
    packageUrl.pathname = packageUrl.pathname.replace(prefix, `/brazhkoanatolii/Packaging-Filling-Hub-Updates/${commit}/`);
    return { ...manifest, packageUrl: packageUrl.toString() };
  } catch {
    return manifest;
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
  const now = Date.now();
  if (maintenanceDueSnapshotCache && now - maintenanceDueSnapshotCache.cachedAt < maintenanceDueSnapshotCacheMs) {
    return maintenanceDueSnapshotCache.value;
  }
  if (maintenanceDueSnapshotPromise) return maintenanceDueSnapshotPromise;

  maintenanceDueSnapshotPromise = (async () => {
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
  const snapshot = {
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
  maintenanceDueSnapshotCache = { value: snapshot, cachedAt: Date.now() };
  return snapshot;
  })().catch(error => {
    // Do not mark the journal unavailable during a short Google quota limit
    // when this gateway has already received a verified snapshot.
    if (maintenanceDueSnapshotCache?.value) return maintenanceDueSnapshotCache.value;
    throw error;
  }).finally(() => { maintenanceDueSnapshotPromise = null; });

  return maintenanceDueSnapshotPromise;
}

async function createRepairRecord(input) {
  const record = await validateRepairRecord(input);
  const accessToken = await getAccessToken();
  const sheetName = `Ремонт ${String(record.machine).padStart(2, "0")}`;
  const range = `'${sheetName}'!A5:E`;
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(repairsSpreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[displayDate(record.date), record.category, record.work, record.performer, record.note]] }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw repairWriteError(response.status, payload?.error?.message);
  const rowNumber = Number(String(payload.updates?.updatedRange || "").match(/!(?:[A-Z]+)(\d+):/)?.[1]);
  return { ok: true, record: { ...record, id: `repair-${record.machine}-${rowNumber || Date.now()}`, rowNumber } };
}

async function validateRepairRecord(input) {
  const text = (key, label, limit = 5000) => {
    const value = String(input?.[key] || "").trim();
    if (!value) throw requestError(`Заполните поле «${label}»`);
    if (value.length > limit) throw requestError(`Поле «${label}» слишком длинное`);
    return value;
  };
  const date = String(input?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > vilniusDate()) throw requestError("Выберите корректную дату ремонта");
  const machine = Number(input?.machine);
  if (!Number.isInteger(machine) || machine < 1 || machine > 16) throw requestError("Выберите станок от 1 до 16");
  const category = text("category", "Категория работ", 180);
  const selectedWorks = [...new Set(text("work", "Вид работ", 500).split(";").map(value => value.trim()).filter(Boolean))];
  if (!selectedWorks.length) throw requestError("Выберите хотя бы один вид работ");
  const work = selectedWorks.join("; ");
  const performer = text("performer", "Исполнитель", 180);
  const note = String(input?.note || "").trim();
  if (note.length > 5000) throw requestError("Поле «Примечание» слишком длинное");
  if (selectedWorks.some(value => /(описать|какого).*примечани|примечани.*(описать|какого)/i.test(value)) && !note) throw requestError("Для выбранного вида работ заполните примечание");

  const rows = (await getGoogleSheetRanges(repairsSpreadsheetId, [repairsDictionaryRange]))[0] ?? [];
  const dictionary = rows.slice(1);
  const performers = new Set(dictionary.map(row => String(row[0] || "").trim()).filter(Boolean));
  const categories = new Set(dictionary.map(row => String(row[3] || "").trim()).filter(Boolean));
  const workColumn = category === "Настройка" ? 1 : category === "Ремонт" ? 2 : -1;
  if (!categories.has(category) || workColumn < 0) throw requestError("Категория работ отсутствует в справочнике журнала ремонта");
  const works = new Set(dictionary.map(row => String(row[workColumn] || "").trim()).filter(Boolean));
  if (selectedWorks.some(workItem => !works.has(workItem))) throw requestError("Один из выбранных видов работ отсутствует в справочнике журнала ремонта");
  if (!performers.has(performer)) throw requestError("Исполнитель отсутствует в справочнике журнала ремонта");
  return { date, machine, category, work, performer, note };
}

function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function repairWriteError(statusCode, googleMessage) {
  const message = String(googleMessage || "");
  const error = googleError(statusCode, message || "Не удалось внести запись о ремонте");
  if (/protected|защищён/i.test(message)) error.publicMessage = "Google не разрешил запись в защищённый диапазон журнала ремонта. Проверьте права корпоративной учётной записи на нужный лист.";
  else if (/permission|permission denied|недостаточно прав|нет разреш/i.test(message)) error.publicMessage = "У корпоративной учётной записи нет права записи в журнал ремонта.";
  else error.publicMessage = "Google не принял запись о ремонте. Повторите позже или проверьте подключение Google.";
  return error;
}

function googleNumber(value) {
  const source = String(value ?? "").trim();
  const negative = /^\(.+\)$/.test(source);
  const normalized = source.replace(/[()\s]/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? (negative ? -number : number) : NaN;
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
  const [records, pending] = await Promise.all([getPackagingSheetRecords(), Promise.resolve(readPackagingPendingRecords())]);
  const byDate = new Map(records.map(record => [record.date, record]));
  for (const record of pending) byDate.set(record.date, record);
  return { ok: true, records: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)) };
}

async function getPackagingSheetRecords() {
  const values = await getGoogleSheetRanges(packagingSpreadsheetId, [packagingRange]);
  const rows = values[0] ?? [];
  const headers = rows[0] ?? [];
  if (headers.length < 11 || String(headers[0]).trim() !== "Дата") {
    throw new Error("Изменилась структура журнала расхода упаковки");
  }
  const notes = await getPackagingDateNotes();
  return rows.slice(1).map((row, index) => packagingRecordFromRow(row, index + 3, notes[index] || "")).filter(Boolean);
}

async function createPackagingRecord(input) {
  const record = validatePackagingRecord(input);
  if (record.date === vilniusDate()) {
    const pending = readPackagingPendingRecords().filter(item => item.date !== record.date);
    writePackagingPendingRecords([...pending, { ...record, pending: true, updatedAt: new Date().toISOString() }]);
    return { ok: true, record: { id: `packaging-day-${record.date}`, requestId: record.requestId, date: record.date, values: record.values, pending: true } };
  }
  const existing = (await getPackagingSheetRecords()).find(item => item.date === record.date);
  return { ok: true, record: await writePackagingRecordToSheet(record, existing) };
}

async function writePackagingRecordToSheet(record, existing = null) {
  const accessToken = await getAccessToken();
  const sheetId = await getPackagingSheetId(accessToken);
  const serial = Math.round((Date.parse(`${record.date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
  const receipt = `${packagingReceiptPrefix}${JSON.stringify({ id: record.id, requestId: record.requestId, workstationId: record.workstationId, createdAt: new Date().toISOString() })}`;
  const cells = [
    { userEnteredValue: { numberValue: serial }, note: receipt, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd.MM.yyyy" } } },
    ...packagingKeys.map(key => ({ userEnteredValue: { numberValue: record.values[key] } }))
  ];
  const rowNumber = existing?.rowNumber ?? (await getNextPackagingRowNumber());
  const requests = [];
  if (!existing && rowNumber > 3) {
    requests.push({ copyPaste: {
      source: { sheetId, startRowIndex: rowNumber - 2, endRowIndex: rowNumber - 1, startColumnIndex: 1, endColumnIndex: 13 },
      destination: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 1, endColumnIndex: 13 },
      pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL"
    } });
  }
  requests.push({ updateCells: { start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 1 }, rows: [{ values: cells }], fields: "userEnteredValue,note,userEnteredFormat.numberFormat" } });
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(packagingSpreadsheetId)}:batchUpdate`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось записать расход упаковки");
  return { id: `packaging-day-${record.date}`, requestId: record.requestId, rowNumber, date: record.date, values: record.values };
}

async function deletePackagingRecord(input) {
  const id = String(input?.id || ""); if (!/^packaging-day-\d{4}-\d{2}-\d{2}$/.test(id)) throw new Error("Некорректный идентификатор дневной записи");
  const date = id.slice("packaging-day-".length);
  const pending = readPackagingPendingRecords();
  if (pending.some(item => item.date === date)) {
    writePackagingPendingRecords(pending.filter(item => item.date !== date));
    return { ok: true };
  }
  const record = (await getPackagingSheetRecords()).find(item => item.id === id); if (!record) return { ok: true };
  const accessToken = await getAccessToken(); const sheetId = await getPackagingSheetId(accessToken);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(packagingSpreadsheetId)}:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: record.rowNumber - 1, endIndex: record.rowNumber } } }] }), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})); if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось удалить дневной расход упаковки"); return { ok: true };
}

async function getPackagingWarehouseSnapshot() {
  const [rows = [], summaryRows = []] = await getGoogleSheetRanges(packagingWarehouseSpreadsheetId, [packagingWarehouseRange, packagingWarehouseSummaryRange]);
  return {
    ok: true,
    records: rows.map((row, index) => packagingWarehouseRecordFromRow(row, index + 6)).filter(Boolean),
    summary: summaryRows.map(packagingWarehouseSummaryFromRow).filter(Boolean)
  };
}

async function savePackagingWarehouseRecord(input) {
  const record = validatePackagingWarehouseRecord(input);
  const accessToken = await getAccessToken();
  const sheetId = await getSheetId(packagingWarehouseSpreadsheetId, packagingWarehouseSheetName, accessToken);
  const serial = Math.round((Date.parse(`${record.date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
  const cells = [
    { userEnteredValue: { numberValue: serial }, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd.MM.yyyy" } } },
    { userEnteredValue: { stringValue: record.type } }, { userEnteredValue: { stringValue: record.item } },
    { userEnteredValue: { numberValue: record.quantity } }, { userEnteredValue: { stringValue: record.author } },
    { userEnteredValue: { stringValue: record.note } }
  ];
  const request = record.rowNumber
    ? { updateCells: { start: { sheetId, rowIndex: record.rowNumber - 1, columnIndex: 0 }, rows: [{ values: cells }], fields: "userEnteredValue,userEnteredFormat.numberFormat" } }
    : { appendCells: { sheetId, rows: [{ values: cells }], fields: "userEnteredValue,userEnteredFormat.numberFormat" } };
  await batchGoogleSheetRequests(packagingWarehouseSpreadsheetId, accessToken, [request], "Не удалось сохранить движение склада упаковки");
  return { ok: true };
}

async function deletePackagingWarehouseRecord(input) {
  const rowNumber = warehouseRowNumber(input?.id);
  const accessToken = await getAccessToken();
  const sheetId = await getSheetId(packagingWarehouseSpreadsheetId, packagingWarehouseSheetName, accessToken);
  await batchGoogleSheetRequests(packagingWarehouseSpreadsheetId, accessToken, [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber } } }], "Не удалось удалить движение склада упаковки");
  return { ok: true };
}

function validatePackagingWarehouseRecord(input) {
  const date = String(input?.date || ""); const type = String(input?.type || ""); const item = String(input?.item || "");
  const quantity = Number(input?.quantity); const note = String(input?.note || "").trim(); const author = String(input?.author || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > vilniusDate()) throw new Error("Некорректная дата движения склада");
  if (!["Приход", "Расход"].includes(type) || !item || !Number.isInteger(quantity) || quantity <= 0 || note.length > 500 || !author) throw new Error("Проверьте операцию, наименование и количество");
  const id = String(input?.id || ""); return { date, type, item, quantity, note, author, rowNumber: id ? warehouseRowNumber(id) : null };
}

function warehouseRowNumber(id) { const match = String(id || "").match(/^warehouse-(\d{1,4})$/); if (!match || Number(match[1]) < 6) throw new Error("Некорректный идентификатор движения склада"); return Number(match[1]); }
function packagingWarehouseRecordFromRow(row, rowNumber) { const date = googleSheetDate(row?.[0]); const type = String(row?.[1] || ""); const item = String(row?.[2] || ""); const quantity = Number(row?.[3] || 0); if (!date || !["Приход", "Расход"].includes(type) || !item || !Number.isFinite(quantity) || quantity <= 0) return null; return { id: `warehouse-${rowNumber}`, rowNumber, date, type, item, quantity, author: String(row?.[4] || ""), note: String(row?.[5] || "") }; }
function packagingWarehouseSummaryFromRow(row) { const item = String(row?.[0] || "").trim(); if (!item) return null; const number = index => { const value = String(row?.[index] ?? "").trim().replace(",", "."); return value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null); }; return { item, unit: String(row?.[1] || "").trim(), opening: number(2) ?? 0, received: number(3) ?? 0, issued: number(4) ?? 0, calculated: number(5) ?? 0, actual: number(6), difference: number(7), note: String(row?.[8] || "").trim() }; }

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
  // Perform writes in order.  If one target is protected, no subsequent
  // background request is left racing after the error has been handled.
  await updateSheetCells(rawMaterialsSpreadsheetId, accessToken, { sheetId: rawSheetId, rowIndex: rawRow.rowNumber - 1, columnIndex: 1 }, [source.values.garantBox430, source.values.garantBox570, source.values.dochemsPaper]);
  await updateSheetCells(cansSpreadsheetId, accessToken, { sheetId: cansSheetId, rowIndex: cansRow.rowNumber - 1, columnIndex: 1 }, [source.values.killaCanClear, source.values.killaCanGreen]);
  await updateSheetCells(cansSpreadsheetId, accessToken, { sheetId: cansSheetId, rowIndex: cansRow.rowNumber - 1, columnIndex: 5 }, [source.values.killaLidGreen, source.values.dzCanClear, source.values.dzCanGreen, source.values.dzLidBlack, source.values.dzLidWhite]);
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
    await flushPendingPackagingRecord(date);
    await exportPackagingDaily({ date });
    automaticDailyExportCompletedDate = clock.date;
    console.log(`Суточный перенос расхода упаковки выполнен: ${date}`);
  } catch (error) {
    console.warn(`Суточный перенос расхода упаковки не выполнен за ${date}: ${error.message}`);
  }
}

async function getProductionSnapshot() {
  const rows = await getProductionShiftRows();
  const firstBySignature = new Map();
  for (const row of rows.first) {
    const key = productionSignature(row);
    const queue = firstBySignature.get(key) ?? [];
    queue.push(row);
    firstBySignature.set(key, queue);
  }
  return {
    ok: true,
    records: rows.second.map(second => {
      const first = (firstBySignature.get(productionSignature(second)) ?? []).shift() ?? {};
      return { ...second, id: productionRecordId(first.rowNumber, second.rowNumber) };
    })
  };
}

async function createProductionRecord(input) {
  await assertProductionCatalogSchema();
  const record = validateGatewayProductionRecord(input);
  const leaders = await productionShiftLeaders(record.date, record.shift, input.leadership);
  const rows = await getProductionShiftRows();
  const firstRowNumber = nextProductionRowNumber(rows.first, 4);
  const secondRowNumber = nextProductionRowNumber(rows.second, 2);
  const accessToken = await getAccessToken();
  await preserveProductionRowFormatting(accessToken, firstRowNumber, secondRowNumber);
  await writeProductionRecord(accessToken, record, leaders, firstRowNumber, secondRowNumber);
  return { ...record, id: productionRecordId(firstRowNumber, secondRowNumber), line: record.machineLine, ...leaders };
}

async function updateProductionRecord(input) {
  await assertProductionCatalogSchema();
  const { firstRowNumber, secondRowNumber } = parseProductionRecordId(input?.id);
  const record = validateGatewayProductionRecord(input);
  const leaders = await productionShiftLeaders(record.date, record.shift, input.leadership);
  const accessToken = await getAccessToken();
  await writeProductionRecord(accessToken, record, leaders, firstRowNumber, secondRowNumber);
  return { ...record, id: productionRecordId(firstRowNumber, secondRowNumber), line: record.machineLine, ...leaders };
}

async function deleteProductionRecord(input) {
  await assertProductionCatalogSchema();
  const { firstRowNumber, secondRowNumber } = parseProductionRecordId(input?.id);
  const accessToken = await getAccessToken();
  await setGoogleSheetRanges(productionSpreadsheetId, accessToken, [
    { range: `'Учет продукции 1'!B${firstRowNumber}:P${firstRowNumber}`, values: [Array(15).fill("")] },
    { range: `'Учет продукции 2'!A${secondRowNumber}:P${secondRowNumber}`, values: [Array(16).fill("")] }
  ]);
}

async function writeProductionRecord(accessToken, record, leaders, firstRowNumber, secondRowNumber) {
  await setGoogleSheetRanges(productionSpreadsheetId, accessToken, [
    { range: `'Учет продукции 1'!B${firstRowNumber}:P${firstRowNumber}`, values: [productionFirstValues(record, leaders)] },
    { range: `'Учет продукции 2'!A${secondRowNumber}:P${secondRowNumber}`, values: [productionSecondValues(record, leaders)] }
  ]);
}

function productionFirstValues(record, leaders) {
  return [displayDate(record.date), record.startTime, record.time, record.catalogLine, record.product, record.strength, record.quantity, record.scrapKg, "", record.packer, record.operator, record.machineLine, record.shift, leaders.seniorMechanic, leaders.mechanic];
}

function productionSecondValues(record, leaders) {
  return [displayDate(record.date), record.startTime, record.time, record.catalogLine, record.product, record.strength, record.quantity, record.scrapKg, record.packer, record.operator, record.machineLine, record.canScrapKg, record.note, record.shift, leaders.seniorMechanic, leaders.mechanic];
}

function nextProductionRowNumber(rows, firstDataRow) {
  return Math.max(firstDataRow, ...rows.map(row => row.rowNumber + 1));
}

async function assertProductionCatalogSchema() {
  const [secondHeader, firstHeader] = await getGoogleSheetRanges(productionSpreadsheetId, ["'Учет продукции 2'!A1:P1", "'Учет продукции 1'!B2:P2"]);
  const ready = String(secondHeader?.[0]?.[3] || "").toLocaleLowerCase("ru").includes("линейка") && String(firstHeader?.[0]?.[3] || "").toLocaleLowerCase("ru").includes("lin");
  if (!ready) throw new Error("Журнал продукции ещё не подготовлен для графы «Линейка продукта». Обновите таблицу через центральный сервер.");
}

function productionRecordId(firstRowNumber, secondRowNumber) { return `production:${firstRowNumber}:${secondRowNumber}`; }

function parseProductionRecordId(value) {
  const match = String(value || "").match(/^production:(\d+):(\d+)$/);
  if (!match) throw new Error("Эта запись создана старой версией программы. Обновите страницу журнала и повторите действие.");
  return { firstRowNumber: Number(match[1]), secondRowNumber: Number(match[2]) };
}

async function preserveProductionRowFormatting(accessToken, firstRowNumber, secondRowNumber) {
  const [firstSheetId, secondSheetId] = await Promise.all([
    getSheetId(productionSpreadsheetId, "Учет продукции 1", accessToken),
    getSheetId(productionSpreadsheetId, "Учет продукции 2", accessToken)
  ]);
  const requests = [];
  if (firstRowNumber > 4) {
    requests.push({ copyPaste: {
      source: { sheetId: firstSheetId, startRowIndex: firstRowNumber - 2, endRowIndex: firstRowNumber - 1, startColumnIndex: 1, endColumnIndex: 16 },
      destination: { sheetId: firstSheetId, startRowIndex: firstRowNumber - 1, endRowIndex: firstRowNumber, startColumnIndex: 1, endColumnIndex: 16 },
      pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL"
    } });
  }
  if (secondRowNumber > 2) {
    requests.push({ copyPaste: {
      source: { sheetId: secondSheetId, startRowIndex: secondRowNumber - 2, endRowIndex: secondRowNumber - 1, startColumnIndex: 0, endColumnIndex: 16 },
      destination: { sheetId: secondSheetId, startRowIndex: secondRowNumber - 1, endRowIndex: secondRowNumber, startColumnIndex: 0, endColumnIndex: 16 },
      pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL"
    } });
  }
  if (requests.length) await batchGoogleSheetRequests(productionSpreadsheetId, accessToken, requests, "Не удалось оформить новую строку продукции");
}

async function productionShiftLeaders(date, shift, selected = null) {
  const workforce = await getWorkforceSnapshot();
  const fallback = productionShiftLeadersFromWorkforce(workforce, date, shift);
  const seniorMechanic = String(selected?.seniorMechanic || "").trim();
  const mechanic = String(selected?.mechanic || "").trim();
  if (!seniorMechanic || !mechanic) return fallback;
  const teamId = shift === "A" ? "shift-team-a" : "shift-team-b";
  const peopleById = new Map((workforce.personnel ?? []).map(person => [person.id, person]));
  const present = (workforce.attendance ?? []).filter(item => item.date === date && item.shiftTeamId === teamId && isWorkedAttendance(item))
    .map(item => peopleById.get(item.employeeId)).filter(Boolean);
  const seniorPool = present.some(person => person.role === "senior-mechanic")
    ? present.filter(person => person.role === "senior-mechanic")
    : present.filter(person => person.role === "mechanic");
  const mechanicPool = present.filter(person => person.role === "mechanic-operator");
  if (!seniorPool.some(person => person.fullName === seniorMechanic) || !mechanicPool.some(person => person.fullName === mechanic)) {
    throw new Error("Выбранные старший механик и механик должны быть отмечены в табеле этой смены.");
  }
  return { seniorMechanic, mechanic };
}

function productionShiftLeadersFromWorkforce(workforce, date, shift) {
  const teamId = shift === "A" ? "shift-team-a" : "shift-team-b";
  const peopleById = new Map((workforce.personnel ?? []).map(person => [person.id, person]));
  const present = (workforce.attendance ?? [])
    .filter(item => item.date === date && item.shiftTeamId === teamId && isWorkedAttendance(item))
    .map(item => peopleById.get(item.employeeId))
    .filter(Boolean);
  return {
    seniorMechanic: present.filter(person => person.role === "senior-mechanic").map(person => person.fullName).join("; "),
    mechanic: present.filter(person => person.role === "mechanic").map(person => person.fullName).join("; ")
  };
}

function isWorkedAttendance(item) {
  // "11" is the current timesheet code for a complete worked shift.
  // "K" is retained only for records made by an older installation.
  return ["11", "K"].includes(String(item?.value || "").trim());
}

async function backfillProductionLeaders() {
  if (!writesEnabled || missingGoogleSettings().length) return { updated: 0 };
  const [snapshot, rows, workforce, accessToken] = await Promise.all([
    getProductionSnapshot(), getProductionShiftRows(), getWorkforceSnapshot(), getAccessToken()
  ]);
  const firstByRow = new Map(rows.first.map(record => [record.rowNumber, record]));
  const secondByRow = new Map(rows.second.map(record => [record.rowNumber, record]));
  const updates = [];
  for (const record of snapshot.records) {
    const { firstRowNumber, secondRowNumber } = parseProductionRecordId(record.id);
    const first = firstByRow.get(firstRowNumber);
    const second = secondByRow.get(secondRowNumber);
    if (!first || !second) continue;
    const leaders = productionShiftLeadersFromWorkforce(workforce, record.date, record.shift);
    if (!leaders.seniorMechanic && !leaders.mechanic) continue;
    const firstValues = [first.seniorMechanic || leaders.seniorMechanic, first.mechanic || leaders.mechanic];
    const secondValues = [second.seniorMechanic || leaders.seniorMechanic, second.mechanic || leaders.mechanic];
    if (!first.seniorMechanic || !first.mechanic) updates.push({ range: `'Учет продукции 1'!O${firstRowNumber}:P${firstRowNumber}`, values: [firstValues] });
    if (!second.seniorMechanic || !second.mechanic) updates.push({ range: `'Учет продукции 2'!O${secondRowNumber}:P${secondRowNumber}`, values: [secondValues] });
  }
  for (let index = 0; index < updates.length; index += 100) {
    await setGoogleSheetRanges(productionSpreadsheetId, accessToken, updates.slice(index, index + 100));
  }
  if (updates.length) console.log(`Заполнены старший механик и механик: ${updates.length} строк журнала продукции.`);
  return { updated: updates.length };
}

async function getProductionShiftRows() {
  const [secondHeader, firstHeader, secondRows, firstRows] = await getGoogleSheetRanges(productionSpreadsheetId, ["'Учет продукции 2'!A1:P1", "'Учет продукции 1'!B2:P2", productionSecondRange, productionFirstRange]);
  const hasCatalogLine = String(secondHeader?.[0]?.[3] || "").toLocaleLowerCase("ru").includes("линейка") && String(firstHeader?.[0]?.[3] || "").toLocaleLowerCase("ru").includes("lin");
  return {
    second: (secondRows ?? []).map((row, index) => productionRowFromSecond(row, index + 2, hasCatalogLine)).filter(Boolean),
    first: (firstRows ?? []).map((row, index) => productionRowFromFirst(row, index + 4, hasCatalogLine)).filter(Boolean)
  };
}

function productionRowFromSecond(row, rowNumber, hasCatalogLine) {
  const date = googleSheetDate(row?.[0]);
  if (!date || !String(row?.[hasCatalogLine ? 4 : 3] || "").trim()) return null;
  if (!hasCatalogLine) return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), catalogLine: "", product: String(row[3] || "").trim(), strength: Number(row[4] || 0), quantity: Number(row[5] || 0), scrapKg: Number(String(row[6] || "0").replace(",", ".")) || 0, packer: String(row[7] || "").trim(), operator: String(row[8] || "").trim(), line: String(row[9] || "").trim(), canScrapKg: Number(String(row[10] || "0").replace(",", ".")) || 0, note: String(row[11] || "").trim(), shift: String(row[12] || "").trim().toUpperCase(), seniorMechanic: String(row[13] || "").trim(), mechanic: String(row[14] || "").trim() };
  return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), catalogLine: String(row[3] || "").trim(), product: String(row[4] || "").trim(), strength: Number(row[5] || 0), quantity: Number(row[6] || 0), scrapKg: Number(String(row[7] || "0").replace(",", ".")) || 0, packer: String(row[8] || "").trim(), operator: String(row[9] || "").trim(), line: String(row[10] || "").trim(), canScrapKg: Number(String(row[11] || "0").replace(",", ".")) || 0, note: String(row[12] || "").trim(), shift: String(row[13] || "").trim().toUpperCase(), seniorMechanic: String(row[14] || "").trim(), mechanic: String(row[15] || "").trim() };
}

function productionRowFromFirst(row, rowNumber, hasCatalogLine) {
  const date = googleSheetDate(row?.[0]);
  if (!date || !String(row?.[hasCatalogLine ? 4 : 3] || "").trim()) return null;
  if (!hasCatalogLine) return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), catalogLine: "", product: String(row[3] || "").trim(), strength: Number(row[4] || 0), quantity: Number(row[5] || 0), scrapKg: Number(String(row[6] || "0").replace(",", ".")) || 0, packer: String(row[8] || "").trim(), operator: String(row[9] || "").trim(), line: String(row[10] || "").trim(), shift: String(row[11] || "").trim().toUpperCase(), seniorMechanic: String(row[12] || "").trim(), mechanic: String(row[13] || "").trim() };
  return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), catalogLine: String(row[3] || "").trim(), product: String(row[4] || "").trim(), strength: Number(row[5] || 0), quantity: Number(row[6] || 0), scrapKg: Number(String(row[7] || "0").replace(",", ".")) || 0, packer: String(row[9] || "").trim(), operator: String(row[10] || "").trim(), line: String(row[11] || "").trim(), shift: String(row[12] || "").trim().toUpperCase(), seniorMechanic: String(row[13] || "").trim(), mechanic: String(row[14] || "").trim() };
}

function productionSignature(record) {
  return [record.date, record.startTime, record.time, record.product, record.packer, record.operator, record.line || record.machineLine]
    .map(value => String(value || "").trim().toLocaleLowerCase("ru"))
    .join("\u001f");
}

function validateGatewayProductionRecord(input) {
  const text = (key, label, limit = 5000) => {
    const value = String(input?.[key] || "").trim();
    if (!value) throw new Error(`Заполните поле «${label}»`);
    if (value.length > limit) throw new Error(`Поле «${label}» слишком длинное`);
    return value;
  };
  const decimal = (key, label, positive = false) => {
    const value = Number(String(input?.[key] ?? "").replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || (positive && value <= 0)) throw new Error(`Поле «${label}» заполнено некорректно`);
    return value;
  };
  const date = text("date", "Дата", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > vilniusDate()) throw new Error("Дата должна быть сегодняшней или более ранней");
  const startTime = text("startTime", "Время начала", 5);
  const time = text("time", "Время окончания", 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Укажите время в формате ЧЧ:ММ");
  const machineLine = text("machineLine", "Линия (машина)", 4).toUpperCase();
  if (!Object.hasOwn(productionMachineColumns, machineLine)) throw new Error("Выберите линию из рабочего списка");
  const shift = text("shift", "Смена", 2).toUpperCase();
  if (!['A', 'B'].includes(shift)) throw new Error("Смена должна быть определена из табеля");
  return {
    date, startTime, time, catalogLine: text("catalogLine", "Линейка продукта", 180), product: text("product", "Продукт", 180),
    strength: decimal("strength", "Крепость", true), quantity: decimal("quantity", "Количество готовой продукции", true),
    scrapKg: decimal("scrapKg", "Брак продукции"), canScrapKg: decimal("canScrapKg", "Вес бракованных банок"),
    packer: text("packer", "Упаковщик", 180), operator: text("operator", "Механик-оператор", 360), machineLine, shift,
    note: String(input?.note || "").trim().slice(0, 5000)
  };
}

async function exportProductionDaily(input) {
  const date = String(input?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= vilniusDate()) throw new Error("Передавать можно только завершённый день");
  const records = (await getProductionSnapshot()).records.filter(record => record.date === date);
  if (!records.length) return { ok: true, date, empty: true };
  if (records.some(record => !["A", "B"].includes(String(record.shift)))) throw new Error(`В продукции за ${displayDate(date)} есть записи без смены`);
  const accessToken = await getAccessToken();
  await ensureProductionDailyReportRows(date, accessToken);
  const [machineRows, packerRows, scrapRows, operatorRows, leaderRows, packerHeaders, scrapHeaders, operatorHeaders, leaderHeaders, workforce] = await Promise.all([
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionMachineRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionPackerRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionScrapRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionOperatorRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionLeaderRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Упаковщики'!A6:V6"]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Брак'!A6:V6"]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Механики-операторы'!A6:V6"]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Старшие механики и механики'!A6:V6"]),
    getWorkforceSnapshot()
  ]);
  const [machineSheetId, packerSheetId, scrapSheetId, operatorSheetId, leaderSheetId] = await Promise.all([
    getSheetId(productionReportSpreadsheetId, "Станки", accessToken),
    getSheetId(productionReportSpreadsheetId, "Упаковщики", accessToken),
    getSheetId(productionReportSpreadsheetId, "Брак", accessToken),
    getSheetId(productionReportSpreadsheetId, "Механики-операторы", accessToken),
    getSheetId(productionReportSpreadsheetId, "Старшие механики и механики", accessToken)
  ]);
  const machine = machineRows[0] ?? [];
  const packers = packerRows[0] ?? [];
  const scrap = scrapRows[0] ?? [];
  const operators = operatorRows[0] ?? [];
  const leaders = leaderRows[0] ?? [];
  const packerHeader = packerHeaders[0]?.[0] ?? [];
  const scrapHeader = scrapHeaders[0]?.[0] ?? [];
  const operatorHeader = operatorHeaders[0]?.[0] ?? [];
  const leaderHeader = leaderHeaders[0]?.[0] ?? [];
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
  const operatorTarget = getDailyTargetRowFromRows(operators, date, 7, "Механики-операторы");
  const leaderTarget = getDailyTargetRowFromRows(leaders, date, 7, "Старшие механики и механики");
  writes.push(
    updateDailyPeopleValues(productionReportSpreadsheetId, accessToken, packerSheetId, packerTarget.rowNumber, packerHeader, records, record => Number(record.quantity || 0) / 240),
    updateDailyPeopleValues(productionReportSpreadsheetId, accessToken, scrapSheetId, scrapTarget.rowNumber, scrapHeader, records, record => Number(record.scrapKg || 0)),
    updateDailyOperatorValues(productionReportSpreadsheetId, accessToken, operatorSheetId, operatorTarget.rowNumber, operatorHeader, records),
    updateDailyLeaderValues(productionReportSpreadsheetId, accessToken, leaderSheetId, leaderTarget.rowNumber, leaderHeader, records, workforce, date)
  );
  await Promise.all(writes);
  return { ok: true, date, records: records.length };
}

function reportRowHasValues(row) {
  return Array.isArray(row) && row.some(value => String(value ?? "").trim() !== "");
}

function nextAvailableReportRow(rows, startRow, occupied) {
  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = startRow + index;
    if (!occupied.has(rowNumber) && !reportRowHasValues(rows[index])) return rowNumber;
  }
  let rowNumber = startRow + rows.length;
  while (occupied.has(rowNumber)) rowNumber += 1;
  return rowNumber;
}

async function ensureProductionDailyReportRows(date, accessToken) {
  const [machineRows, packerRows, scrapRows, operatorRows, leaderRows] = await Promise.all([
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionMachineRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionPackerRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionScrapRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionOperatorRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionLeaderRange])
  ]);
  const [machineSheetId, packerSheetId, scrapSheetId, operatorSheetId, leaderSheetId] = await Promise.all([
    getSheetId(productionReportSpreadsheetId, "Станки", accessToken),
    getSheetId(productionReportSpreadsheetId, "Упаковщики", accessToken),
    getSheetId(productionReportSpreadsheetId, "Брак", accessToken),
    getSheetId(productionReportSpreadsheetId, "Механики-операторы", accessToken),
    getSheetId(productionReportSpreadsheetId, "Старшие механики и механики", accessToken)
  ]);
  const formatRequests = [];
  const values = [];
  const addRow = (sheetName, sheetId, rows, startRow, occupied, rowValues, width) => {
    const rowNumber = nextAvailableReportRow(rows, startRow, occupied);
    occupied.add(rowNumber);
    if (rowNumber > startRow) {
      formatRequests.push({ copyPaste: {
        source: { sheetId, startRowIndex: rowNumber - 2, endRowIndex: rowNumber - 1, startColumnIndex: 0, endColumnIndex: width },
        destination: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: width },
        pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL"
      } });
    }
    const endColumn = rowValues.length === 2 ? "B" : "A";
    values.push({ range: `'${sheetName}'!A${rowNumber}:${endColumn}${rowNumber}`, values: [rowValues] });
  };
  const machine = machineRows[0] ?? [];
  const machineOccupied = new Set();
  for (const shift of ["A", "B"]) {
    if (!machine.some(row => googleSheetDate(row[0]) === date && String(row[1] || "").trim().toUpperCase() === shift)) {
      addRow("Станки", machineSheetId, machine, 7, machineOccupied, [displayDate(date), shift], 13);
    }
  }
  const peopleSheets = [
    ["Упаковщики", packerSheetId, packerRows[0] ?? []], ["Брак", scrapSheetId, scrapRows[0] ?? []],
    ["Механики-операторы", operatorSheetId, operatorRows[0] ?? []], ["Старшие механики и механики", leaderSheetId, leaderRows[0] ?? []]
  ];
  for (const [sheetName, sheetId, rows] of peopleSheets) {
    if (!rows.some(row => googleSheetDate(row[0]) === date)) addRow(sheetName, sheetId, rows, 7, new Set(), [displayDate(date)], 22);
  }
  if (formatRequests.length) await batchGoogleSheetRequests(productionReportSpreadsheetId, accessToken, formatRequests, "Не удалось оформить новые строки сводки продукции");
  if (values.length) await setGoogleSheetRanges(productionReportSpreadsheetId, accessToken, values);
}

async function updateDailyPeopleValues(spreadsheetId, accessToken, sheetId, rowNumber, headers, records, valueFor) {
  const totals = new Map();
  records.forEach(record => totals.set(record.packer, (totals.get(record.packer) || 0) + valueFor(record)));
  return updateDailyHeaderValues(spreadsheetId, accessToken, sheetId, rowNumber, headers, totals);
}

function updateDailyOperatorValues(spreadsheetId, accessToken, sheetId, rowNumber, headers, records) {
  const totals = new Map();
  records.forEach(record => {
    const operators = splitProductionParticipants(record.operator);
    const share = operators.length ? Number(record.quantity || 0) / 240 / operators.length : 0;
    operators.forEach(name => totals.set(name, (totals.get(name) || 0) + share));
  });
  return updateDailyHeaderValues(spreadsheetId, accessToken, sheetId, rowNumber, headers, totals);
}

function updateDailyLeaderValues(spreadsheetId, accessToken, sheetId, rowNumber, headers, records, workforce, date) {
  const attendance = Array.isArray(workforce?.attendance) ? workforce.attendance : [];
  const personnelById = new Map((workforce?.personnel ?? []).map(person => [person.id, person]));
  const totals = new Map();
  attendance.filter(item => item.date === date && item.value === "K").forEach(item => {
    const person = personnelById.get(item.employeeId);
    if (!["senior-mechanic", "mechanic"].includes(person?.role)) return;
    const shift = item.shiftTeamId === "shift-team-a" ? "A" : item.shiftTeamId === "shift-team-b" ? "B" : "";
    const output = records.filter(record => record.shift === shift).reduce((sum, record) => sum + Number(record.quantity || 0) / 240, 0);
    totals.set(person.fullName, output);
  });
  return updateDailyHeaderValues(spreadsheetId, accessToken, sheetId, rowNumber, headers, totals);
}

function updateDailyHeaderValues(spreadsheetId, accessToken, sheetId, rowNumber, headers, totals) {
  const totalIndex = headers.findIndex(value => String(value).trim().startsWith("Всего,"));
  if (totalIndex < 2) throw new Error("Изменилась структура дневной сводки по сотрудникам");
  const people = headers.slice(1, totalIndex);
  return updateSheetCells(spreadsheetId, accessToken, { sheetId, rowIndex: rowNumber - 1, columnIndex: 1 }, people.map(name => totals.get(String(name).trim()) || 0));
}

function splitProductionParticipants(value) {
  return String(value || "").split(/\s*[;|]\s*/).map(item => item.trim()).filter(Boolean);
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
  await batchGoogleSheetRequests(spreadsheetId, accessToken, [request], "Не удалось передать суточные итоги");
}

async function batchGoogleSheetRequests(spreadsheetId, accessToken, requests, fallbackMessage) {
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests }), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || fallbackMessage);
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
  return { id, requestId, date, values, workstationId: String(input.workstationId || "") };
}

function readPackagingPendingRecords() {
  if (!existsSync(packagingPendingPath)) return [];
  try {
    const value = JSON.parse(readFileSync(packagingPendingPath, "utf8"));
    if (!Array.isArray(value?.records)) return [];
    return value.records.map(item => {
      const date = String(item?.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const values = Object.fromEntries(packagingKeys.map(key => [key, Number(item?.values?.[key] || 0)]));
      if (!Object.values(values).some(number => Number.isFinite(number) && number > 0)) return null;
      return {
        id: `packaging-day-${date}`,
        requestId: String(item?.requestId || ""),
        date,
        values,
        workstationId: String(item?.workstationId || ""),
        pending: true
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function writePackagingPendingRecords(records) {
  const directory = dirname(packagingPendingPath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${packagingPendingPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ records }, null, 2)}\n`, "utf8");
  renameSync(temporary, packagingPendingPath);
}

async function flushPendingPackagingRecord(date) {
  const pending = readPackagingPendingRecords();
  const record = pending.find(item => item.date === date);
  if (!record) return false;
  const existing = (await getPackagingSheetRecords()).find(item => item.date === date);
  await writePackagingRecordToSheet(record, existing);
  writePackagingPendingRecords(pending.filter(item => item.date !== date));
  return true;
}

async function getNextPackagingRowNumber() {
  const records = await getPackagingSheetRecords();
  return Math.max(2, ...records.map(record => record.rowNumber)) + 1;
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
  return ({ "Администрация": "head-of-area", "Начальник участка": "head-of-area", "Начальник производства": "production-manager", "Администратор": "administrator", "Начальник склада": "warehouse-manager", "Старший механик": "senior-mechanic", "Механик": "mechanic", "Механик-оператор": "mechanic-operator", "Упаковщик": "packer" })[String(value || "")] || "";
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

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
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

function actorFromRequest(request) {
  if (centralAuth) return centralAuth.accountForToken(readCookie(request, "PFH_SESSION"));
  if (!workstationRole) return null;
  return {
    id: workstationRole === "manager" ? "manager" : "senior-mechanic",
    role: workstationRole,
    title: workstationRole === "manager" ? "Администрация" : "Старший механик",
    description: workstationLabel || "Рабочее место"
  };
}

function requireActor(request, roles = null) {
  const actor = actorFromRequest(request);
  if (!actor) {
    const error = new Error("Сначала войдите в учётную запись");
    error.statusCode = 401;
    throw error;
  }
  if (roles && !roles.includes(actor.role)) {
    const error = new Error("Недостаточно прав");
    error.statusCode = 403;
    throw error;
  }
  return actor;
}

function readCentralShiftState() {
  if (!centralMode || !existsSync(centralShiftStatePath)) return null;
  try {
    const value = JSON.parse(readFileSync(centralShiftStatePath, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    // A damaged non-secret status file must not stop the gateway.
    return null;
  }
}

function writeCentralShiftState(value) {
  const directory = dirname(centralShiftStatePath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${centralShiftStatePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, centralShiftStatePath);
  return value;
}

async function updateCentralShiftState(input, actor) {
  if (!centralMode) {
    const error = new Error("Общее состояние смены доступно только на центральном сервере");
    error.statusCode = 409;
    throw error;
  }
  const action = String(input?.action || "");
  const current = readCentralShiftState();
  if (action === "end") {
    if (!current?.active) return current;
    return writeCentralShiftState({ ...current, active: false, endedAt: new Date().toISOString(), endedBy: actor.id });
  }
  if (action === "complete-scale-control") {
    if (!current?.active) throw new Error("Общая смена не начата");
    const recordCount = Number(input.recordCount);
    if (!current.requiresScaleControl || current.weightsCompletedAt || recordCount < 13) return current;
    return writeCentralShiftState({ ...current, weightsCompletedAt: new Date().toISOString(), scaleControlRecordCount: recordCount, updatedBy: actor.id });
  }
  if (action === "update-attendance") {
    if (!current?.active) throw new Error("Общая смена не начата");
    if (current.shiftDate !== todayInVilnius()) throw new Error("Активная смена относится к другой дате. Сначала завершите её явно.");
    const attendance = normalizeCentralAttendance(input.attendance);
    const leaders = await resolveCentralShiftLeaders(input, attendance);
    return writeCentralShiftState({
      ...current,
      attendance,
      employee: leaders.seniorMechanic,
      supervisor: leaders.seniorMechanic,
      seniorMechanic: leaders.seniorMechanic,
      mechanic: leaders.mechanic,
      attendanceUpdatedAt: new Date().toISOString(),
      updatedBy: actor.id
    });
  }
  if (action !== "start") throw new Error("Неизвестное действие со сменой");
  if (current?.active) throw new Error("На центральном сервере уже есть активная смена. Сначала завершите или исправьте её.");
  const teamId = String(input.shiftTeamId || "");
  const scheduledTeam = await scheduledCentralTeam(todayInVilnius());
  if (!scheduledTeam || scheduledTeam.id !== teamId) {
    const error = new Error("Можно начать только бригаду, назначенную общим графиком на сегодня");
    error.statusCode = 409;
    throw error;
  }
  // The time-based shift selector was removed from the interface. The first
  // shift remains the safe default because it keeps the daily scale check.
  const shiftNumber = [1, 2].includes(Number(input.shiftNumber)) ? Number(input.shiftNumber) : 1;
  const attendance = normalizeCentralAttendance(input.attendance);
  const leaders = await resolveCentralShiftLeaders(input, attendance);
  const startedAt = new Date().toISOString();
  return writeCentralShiftState({
    schemaVersion: 1, active: true, shiftDate: todayInVilnius(), shiftTeamId: teamId,
    employee: leaders.seniorMechanic, supervisor: leaders.seniorMechanic,
    seniorMechanic: leaders.seniorMechanic, mechanic: leaders.mechanic,
    shiftNumber, attendance,
    startedAt, endedAt: null, startedBy: actor.id,
    requiresScaleControl: shiftNumber === 1,
    weightsCompletedAt: shiftNumber === 1 ? null : startedAt
  });
}

async function resolveCentralShiftLeaders(input, attendance) {
  const workforce = await getWorkforceSnapshot();
  const peopleById = new Map((workforce.personnel ?? []).map(person => [person.id, person]));
  const present = attendance.filter(item => ["11", "K"].includes(String(item.status || "").trim()))
    .map(item => peopleById.get(item.employeeId)).filter(Boolean);
  const seniorMechanics = present.filter(person => person.role === "senior-mechanic");
  const directMechanics = present.filter(person => person.role === "mechanic");
  const seniorPool = seniorMechanics.length ? seniorMechanics : directMechanics;
  const seniorMechanic = String(input.seniorMechanic || input.supervisor || seniorPool[0]?.fullName || "").trim();
  const mechanics = directMechanics.filter(person => person.fullName !== seniorMechanic);
  const mechanicPool = mechanics.length ? mechanics : present.filter(person => person.role === "mechanic-operator");
  const mechanic = String(input.mechanic || mechanicPool[0]?.fullName || "").trim();
  if (!seniorPool.some(person => person.fullName === seniorMechanic)) throw new Error("Старший механик должен быть отмечен присутствующим в табеле.");
  if (!mechanicPool.some(person => person.fullName === mechanic)) throw new Error("Механик должен быть отмечен присутствующим в табеле.");
  return { seniorMechanic, mechanic };
}

async function scheduledCentralTeam(date) {
  const workforce = await getWorkforceSnapshot();
  const [year, month] = String(date).split("-").map(Number);
  return (workforce.shiftTeams || []).find(team => {
    const schedule = workforceScheduleMonth(team, year, month - 1);
    return schedule.some(day => day.date === date && day.scheduled);
  }) || null;
}

function workforceScheduleMonth(team, year, monthIndex) {
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const anchor = String(team.anchorDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!anchor) return { date, scheduled: false };
    const difference = Math.round((Date.UTC(year, monthIndex, day) - Date.UTC(Number(anchor[1]), Number(anchor[2]) - 1, Number(anchor[3]))) / 86_400_000);
    const length = Math.max(1, Number(team.cycleLengthDays) || 4);
    const offset = ((difference % length) + length) % length;
    return { date, scheduled: (team.workDayOffsets || [0, 1]).map(Number).includes(offset) };
  });
}

function normalizeCentralAttendance(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("Отметьте присутствие сотрудников");
  const attendance = value.map(item => ({
    employeeId: String(item?.employeeId || ""), status: String(item?.status || ""),
    ...(item?.isSubstitute ? { isSubstitute: true, substitutionReason: String(item.substitutionReason || ""), homeShiftTeamId: String(item.homeShiftTeamId || "") } : {})
  })).filter(item => item.employeeId && item.status);
  if (!attendance.length) throw new Error("Отметьте присутствие сотрудников");
  return attendance;
}

function todayInVilnius() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius" }).format(new Date());
}

function sessionCookie(token, expiresAt) {
  const maxAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  return `PFH_SESSION=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

function expiredSessionCookie() {
  return "PFH_SESSION=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
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
