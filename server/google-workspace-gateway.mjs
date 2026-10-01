import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CentralAuthService, readCookie } from "./central-auth.mjs";
import { PACKAGING_TARGET_RANGES, packagingTargetValues } from "./packaging-targets.mjs";

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
// The packaging journal contains exactly the date and eleven packaging totals (A:L).
// The former contributor column was deliberately removed from the workbook.
const packagingRange = "'Лист'!A2:L";
const packagingReceiptPrefix = "PFH_PACKAGING_V1:";
const packagingKeys = Object.freeze(["garantBox430", "garantBox570", "dochemsPaper", "killaCanClear", "killaCanGreen", "killaLidGreen", "dzCanClear", "dzCanGreen", "dzLidBlack", "dzLidWhite", "dzLidGreen"]);
const packagingPendingPath = process.env.PACKAGING_PENDING_PATH
  ? resolve(process.env.PACKAGING_PENDING_PATH)
  : join(projectRoot, ".runtime", "packaging-pending.json");
const packagingWarehouseSpreadsheetId = "1mv7W6IcetxpSNMlTvQclPMIs15ZWZw7Q3ZE_g_NXVok";
const packagingWarehouseSheetName = "Операции";
const packagingWarehouseRange = "'Операции'!A6:F";
const packagingWarehouseSummaryRange = "'Склад упаковки'!A6:I";
const rawMaterialsSpreadsheetId = "1jXf8oZLrFLGEJo15VoFQBe_FjC0_dz_3p0cVxgV4xGo";
const rawMaterialsSheetName = "Расход сырья";
const rawMaterialsRange = PACKAGING_TARGET_RANGES.rawMaterials;
const cansSpreadsheetId = "1-rEj8fvmBE4A5GO8o1ZXU1Ke0-ppK-gwKwCZt_kpwV4";
const cansSheetName = "Банки";
const cansRange = PACKAGING_TARGET_RANGES.cans;
const productionSpreadsheetId = "1zHYsa1pO7xLuSbBC43J_IPChlVfZaxt4L_rI9MtKwqA";
const productionSecondRange = "'Учет продукции 2'!A2:R";
const productionFirstRange = "'Учет продукции 1'!B4:R";
let productionCanScrapMigrationPromise = null;
const productionCreateLocks = new Map();
const productionCreateReceiptPath = process.env.PRODUCTION_CREATE_RECEIPT_PATH
  ? resolve(process.env.PRODUCTION_CREATE_RECEIPT_PATH)
  : join(projectRoot, ".runtime", "production-create-receipts.json");
let productionWriteTail = Promise.resolve();
const productionReportSpreadsheetId = "1_BTwm21m1edVoNew6m5GJirPdUsxnJYE_Xv9qB32c5c";
const productionMachineRange = "'Станки'!A7:M500";
const productionPackerRange = "'Упаковщики'!A7:V500";
const productionScrapRange = "'Брак'!A7:V500";
const productionMassRange = "'Масса'!A7:M500";
const productionMechanicsSheetName = "Механики";
const productionMechanicsLegacySheetName = "Механики-операторы";
const productionMechanicsRange = "'Механики'!A7:BN500";
const productionReportedMasses = Object.freeze([11.8, 13.5, 15.4, 11, 14, 10]);
const productionMachineColumns = Object.freeze({ A: 2, B: 3, D: 4, F: 5, H: 6, K: 7, L: 8, M: 9 });
const nonconformitySpreadsheetId = "1ovuf2QW5KC4_CI1wAEUcufhZXfLreeJhN2PNVPtjlrk";
const nonconformitySheetName = "Журнал";
const nonconformityRange = "'Журнал'!A2:H";
const nonconformityDictionaryRange = "'Справочник несоответсвий'!B2:B";
const automaticDailyExportHour = hourFromEnvironment("AUTOMATIC_DAILY_EXPORT_HOUR", 7);
const automaticDailyExportsEnabled = String(process.env.AUTOMATIC_DAILY_EXPORT_ENABLED || "false").trim().toLowerCase() === "true";
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
const centralMachineStatusesPath = process.env.CENTRAL_MACHINE_STATUSES_PATH
  ? resolve(process.env.CENTRAL_MACHINE_STATUSES_PATH)
  : join(projectRoot, ".runtime", "central-machine-statuses.json");
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
const updateActivitySessions = new Map();
const updateActivityTtlMs = 5 * 60_000;
const automaticUpdateNotBefore = Date.now() + 3 * 60_000;
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
      return sendJson(response, 200, { ok: true, shift: await currentCentralShiftState() });
    }
    if (url.pathname === "/api/shift-state" && request.method === "POST") {
      const actor = requireActor(request, ["manager", "senior"]);
      const input = await readJsonBody(request);
      return sendJson(response, 200, { ok: true, shift: await updateCentralShiftState(input, actor) });
    }

    // Machine status is shared operational state. It is intentionally kept on
    // the central server rather than in a browser or Google Sheets.
    if (url.pathname === "/api/machine-statuses" && request.method === "GET") {
      requireActor(request, ["manager", "senior"]);
      const statuses = readCentralMachineStatuses();
      return sendJson(response, 200, { ok: true, configured: statuses !== null, statuses: statuses ?? defaultMachineStatuses() });
    }
    if (url.pathname === "/api/machine-statuses" && request.method === "PUT") {
      const actor = requireActor(request, ["manager", "senior"]);
      const statuses = writeCentralMachineStatuses((await readJsonBody(request)).statuses, actor);
      return sendJson(response, 200, { ok: true, configured: true, statuses });
    }

    if (url.pathname === "/api/update-status" && request.method === "GET") {
      return sendJson(response, 200, await getUpdateStatus());
    }
    if (url.pathname === "/api/update-activity" && request.method === "POST") {
      recordUpdateActivity(await readJsonBody(request));
      return sendJson(response, 200, { ok: true, ...updateInstallationSafety() });
    }
    if (url.pathname === "/api/update-safety" && request.method === "GET") {
      return sendJson(response, 200, { ok: true, ...updateInstallationSafety() });
    }
    if (url.pathname === "/api/update" && request.method === "POST") {
      const safety = updateInstallationSafety();
      if (!safety.safe) return sendJson(response, 409, { ok: false, message: safety.message });
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
      const result = payload.kind === "attendance"
        ? await saveWorkforceAttendance(payload, actor)
        : await runAppsScript("writeWorkforceOperation", [{ ...payload, role: actor.role }]);
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
    if (writesEnabled && !missingGoogleSettings().length) {
      runBackgroundTask("сверка журналов расхода упаковки", migrateAndReconcilePackagingRecords);
    }
    if (automaticDailyExportsEnabled) {
      console.log(`Суточный перенос расхода упаковки: ежедневно после ${String(automaticDailyExportHour).padStart(2, "0")}:00 (Europe/Vilnius)`);
      runBackgroundTask("суточный перенос расхода упаковки", runAutomaticDailyPackagingExport);
      setInterval(() => runBackgroundTask("суточный перенос расхода упаковки", runAutomaticDailyPackagingExport), 5 * 60_000).unref();
      console.log(`Суточная сводка продукции: ежедневно после ${String(automaticDailyExportHour).padStart(2, "0")}:00 (Europe/Vilnius)`);
      runBackgroundTask("суточная сводка продукции", runAutomaticDailyProductionExport);
      setInterval(() => runBackgroundTask("суточная сводка продукции", runAutomaticDailyProductionExport), 5 * 60_000).unref();
    } else {
      console.log("Суточный перенос итогов отключён: фактические записи остаются в рабочих журналах.");
    }
    runBackgroundTask("подготовка журнала продукции", async () => {
      await ensureProductionCanScrapColumn();
      await backfillProductionLeaders();
      await rebuildProductionShiftSummaries();
    });
    runBackgroundTask("приведение табеля и графика отпусков", repairWorkforceGoogleLayouts);
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
  const safety = updateInstallationSafety();
  if (!safety.safe) return;
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

function recordUpdateActivity(input) {
  const sessionId = String(input?.sessionId || "").trim();
  if (!/^[a-zA-Z0-9-]{16,128}$/.test(sessionId)) return;
  updateActivitySessions.set(sessionId, {
    dirty: input?.dirty === true,
    submitting: input?.submitting === true,
    pending: Math.max(0, Math.min(10_000, Number(input?.pending) || 0)),
    lastInteractionAt: Math.min(Date.now(), Math.max(0, Number(input?.lastInteractionAt) || Date.now())),
    seenAt: Date.now()
  });
}

function updateInstallationSafety() {
  const now = Date.now();
  for (const [sessionId, session] of updateActivitySessions) {
    if (now - session.seenAt > updateActivityTtlMs) updateActivitySessions.delete(sessionId);
  }
  if (now < automaticUpdateNotBefore) {
    return { safe: false, message: "Ожидание подключения программы перед проверкой обновления" };
  }
  // Merely viewing the program must not block an update. Only an actual
  // draft, an in-flight save, or a queued operation can put data at risk.
  const blockers = [...updateActivitySessions.values()].filter(session => session.dirty
    || session.submitting
    || session.pending > 0);
  if (!blockers.length) return { safe: true, message: "Можно устанавливать обновление" };
  const hasDraft = blockers.some(session => session.dirty || session.submitting);
  const hasQueue = blockers.some(session => session.pending > 0);
  return {
    safe: false,
    message: hasDraft
      ? "Обновление отложено: в программе есть несохранённый ввод"
      : hasQueue
        ? "Обновление отложено: есть записи в очереди отправки"
        : "Обновление отложено: пользователь работает в программе"
  };
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

  const [rows, workforce] = await Promise.all([
    getGoogleSheetRanges(repairsSpreadsheetId, [repairsDictionaryRange]).then(result => result[0] ?? []),
    getWorkforceSnapshot()
  ]);
  const dictionary = rows.slice(1);
  const performers = new Set(dictionary.map(row => String(row[0] || "").trim()).filter(Boolean));
  const eligiblePerformers = new Set((workforce.personnel ?? [])
    .filter(person => person.active !== false && (
      person.fullName === "Anatolii Brazhko"
      || ["senior-mechanic", "mechanic"].includes(person.role)
    ))
    .map(person => String(person.fullName || "").trim())
    .filter(Boolean));
  const categories = new Set(dictionary.map(row => String(row[3] || "").trim()).filter(Boolean));
  const workColumn = category === "Настройка" ? 1 : category === "Ремонт" ? 2 : -1;
  if (!categories.has(category) || workColumn < 0) throw requestError("Категория работ отсутствует в справочнике журнала ремонта");
  const works = new Set(dictionary.map(row => String(row[workColumn] || "").trim()).filter(Boolean));
  if (selectedWorks.some(workItem => !works.has(workItem))) throw requestError("Один из выбранных видов работ отсутствует в справочнике журнала ремонта");
  if (!performers.has(performer)) throw requestError("Исполнитель отсутствует в справочнике журнала ремонта");
  if (!eligiblePerformers.has(performer)) throw requestError("В журнале ремонта можно выбрать только Anatolii Brazhko, старшего механика или механика");
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
    getGoogleSheetRanges(workforceSpreadsheetIds.vacations, [`'${year}'!A6:M`])
  ]);
  const teams = (masterRanges[0] ?? []).filter(row => row[6]).map(workforceTeam);
  const personnel = (masterRanges[1] ?? []).filter(row => row[7]).map(row => workforcePerson(row, teams));
  const attendance = workforceAttendance(attendanceRanges[0] ?? [], personnel, teams, year);
  const vacations = workforceVacations(vacationRanges[0] ?? [], year, personnel);
  return {
    ok: true, ready: true, personnel, shiftTeams: teams.filter(team => team.id !== "office"),
    officeSchedule: teams.find(team => team.id === "office") ?? null, attendance, vacations,
    years: [year], timeZone: "Europe/Vilnius"
  };
}

async function repairWorkforceGoogleLayouts() {
  if (!writesEnabled || missingGoogleSettings().length) return { migratedVacations: 0, removedGroups: 0 };
  const accessToken = await getAccessToken();
  const [personnelRows, vacationMetadata] = await Promise.all([
    getGoogleSheetRanges(workforceSpreadsheetIds.personnel, ["'Персонал'!A6:P"]).then(rows => rows[0] ?? []),
    getGoogleSheetStructure(workforceSpreadsheetIds.vacations, accessToken)
  ]);
  const personnelByName = new Map(personnelRows.map(row => [String(row[0] || "").trim().toLocaleLowerCase(), { id: String(row[7] || ""), role: String(row[1] || "") }]));
  let migratedVacations = 0;
  for (const year of [2025, 2026, 2027, 2028, 2029]) {
    const rows = (await getGoogleSheetRanges(workforceSpreadsheetIds.vacations, [`'${year}'!A6:H`]))[0] ?? [];
    const writes = [];
    rows.forEach((row, index) => {
      // Older rows did not have the role column: B was shift and H stored the operation ID.
      // Keep that eight-column Google Table intact and only move visible values into its current schema.
      if (!String(row[7] || "").startsWith("vacation:") || !/^\s*Смена\s+[AB]\s*$/i.test(String(row[1] || ""))) return;
      const employee = personnelByName.get(String(row[0] || "").trim().toLocaleLowerCase());
      writes.push({ range: `'${year}'!A${index + 6}:H${index + 6}`, values: [[
        row[0] || "", employee?.role || "", row[1] || "", row[2] || "", row[3] || "", row[4] || "", row[5] || "", row[7] || ""
      ]] });
    });
    if (writes.length) { await setGoogleSheetRanges(workforceSpreadsheetIds.vacations, accessToken, writes); migratedVacations += writes.length; }
  }
  let groupRequests = [];
  try {
    const attendanceMetadata = await getGoogleSheetStructure(workforceSpreadsheetIds.attendance, accessToken);
    const attendanceGroups = attendanceMetadata.filter(sheet => /^20\d\d$/.test(sheet.title)).flatMap(sheet => sheet.rowGroups || []);
    groupRequests = attendanceGroups.map(group => ({ deleteDimensionGroup: { range: group.range } }));
    for (let index = 0; index < groupRequests.length; index += 50) {
      if (groupRequests.slice(index, index + 50).length) await batchGoogleSheetRequests(workforceSpreadsheetIds.attendance, accessToken, groupRequests.slice(index, index + 50), "Не удалось убрать сворачивание месяцев в табеле");
    }
  } catch (error) {
    console.warn("[gateway] Не удалось убрать сворачивание месяцев в табеле:", error.message);
  }
  const attendanceValues = [...Array.from({ length: 48 }, (_, index) => String((index + 1) / 2)), "A", "L", "NS", "N", "MA", "NA", "PA", "G", "AV", "PV", "M", "TN", "D", "K", "SK", "VV", "PB", "ND", "NP", "NN"];
  const attendanceValidation = { condition: { type: "ONE_OF_LIST", values: attendanceValues.map(userEnteredValue => ({ userEnteredValue })) }, strict: false, showCustomUi: true };
  const attendanceValidationRequests = [];
  try {
    const attendanceMetadata = await getGoogleSheetStructure(workforceSpreadsheetIds.attendance, accessToken);
    attendanceMetadata.filter(sheet => /^20\d\d$/.test(sheet.title)).forEach(sheet => attendanceValidationRequests.push({ setDataValidation: { range: { sheetId: sheet.sheetId, startRowIndex: 5, endRowIndex: 1500, startColumnIndex: 3, endColumnIndex: 34 }, rule: attendanceValidation } }));
    if (attendanceValidationRequests.length) await batchGoogleSheetRequests(workforceSpreadsheetIds.attendance, accessToken, attendanceValidationRequests, "Не удалось обновить список часов в табеле");
  } catch (error) {
    console.warn("[gateway] Не удалось обновить список часов в табеле:", error.message);
  }
  const vacationRequests = vacationMetadata.filter(sheet => /^20\d\d$/.test(sheet.title)).flatMap(sheet => [
    { repeatCell: { range: { sheetId: sheet.sheetId, startRowIndex: 5, startColumnIndex: 3, endColumnIndex: 5 }, cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd.MM.yyyy" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: { sheetId: sheet.sheetId, startRowIndex: 5, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } }, fields: "userEnteredFormat.numberFormat" } }
  ]);
  if (vacationRequests.length) await batchGoogleSheetRequests(workforceSpreadsheetIds.vacations, accessToken, vacationRequests, "Не удалось оформить график отпусков");
  return { migratedVacations, removedGroups: groupRequests.length };
}

async function getGoogleSheetStructure(spreadsheetId, accessToken) {
  const fields = "sheets(properties(sheetId,title),rowGroups(range))";
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось прочитать структуру рабочего журнала");
  return (payload.sheets || []).map(sheet => ({ sheetId: sheet.properties?.sheetId, title: sheet.properties?.title || "", rowGroups: sheet.rowGroups || [] }));
}

// Attendance is read from Sheets by this gateway, so it must also be written
// here.  Sending the write to a separately deployed Apps Script made the
// optimistic revision depend on two different readers and produced false
// conflicts for any employee, not only the employee currently displayed.
async function saveWorkforceAttendance(payload, actor) {
  const record = payload?.record || {};
  const date = String(record.date || "");
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10));
  const value = normalizeWorkforceAttendanceValue(record.value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(month) || !Number.isInteger(day) || !value) {
    return workforceWriteFailure("Проверьте дату и значение табеля");
  }
  if (actor.role === "senior" && date !== todayInVilnius()) return workforceWriteFailure("Старший механик может исправлять табель только за текущий день смены.");
  if (String(record.id || "") !== `${date}:${record.shiftTeamId}:${record.employeeId}`) return workforceWriteFailure("Некорректный ID табеля");

  const workforce = await getWorkforceSnapshot();
  const employee = workforce.personnel.find(person => person.id === String(record.employeeId || ""));
  const team = workforce.shiftTeams.find(item => item.id === String(record.shiftTeamId || ""));
  if (!employee || employee.shiftTeamId === "office" || !team) return workforceWriteFailure("Проверьте сотрудника и смену");

  const desired = {
    id: String(record.id), date, employeeId: employee.id, shiftTeamId: team.id, value,
    overtime: record.overtime === true, substitutionReason: String(record.substitutionReason || ""),
    homeShiftTeamId: String(record.homeShiftTeamId || "")
  };
  const current = workforce.attendance.find(item => item.id === desired.id);
  if (sameWorkforceAttendance(current, desired)) return { ok: true, record: current };
  if ((current?.revision || "empty") !== String(payload.expectedRevision || "empty")) {
    return { ok: false, status: 409, conflict: true, message: "Эта строка табеля уже изменилась в Google. Обновите данные и повторите только нужное исправление." };
  }

  const rows = (await getGoogleSheetRanges(workforceSpreadsheetIds.attendance, [`'${year}'!A6:AR`]))[0] ?? [];
  const rowIndex = rows.findIndex(row => Number(row[0]) === month && String(row[38] || "") === employee.id
    && (String(row[43] || "") === team.id || String(row[2] || "") === team.name));
  const rowNumber = rowIndex < 0 ? Math.max(6, rows.length + 6) : rowIndex + 6;
  const row = rowIndex < 0 ? Array(44).fill("") : [...rows[rowIndex], ...Array(Math.max(0, 44 - rows[rowIndex].length)).fill("")];
  if (rowIndex < 0) {
    row[0] = month; row[1] = employee.fullName; row[2] = team.name; row[38] = employee.id; row[43] = team.id;
    for (let index = new Date(year, month, 0).getDate() + 1; index <= 31; index += 1) row[index + 2] = "—";
  }
  row[day + 2] = numericWorkforceAttendance(value);
  row[37] = mergeWorkforceSubstituteNote(row[37], day, desired.substitutionReason, desired.homeShiftTeamId);
  const overtime = new Set(String(row[42] || "").split(",").filter(Boolean));
  if (desired.overtime) overtime.add(String(day)); else overtime.delete(String(day));
  row[39] = Number(row[39] || 0) + 1; row[40] = new Date().toISOString(); row[41] = actor.performer || actor.title || actor.id; row[42] = [...overtime].sort((left, right) => Number(left) - Number(right)).join(","); row[43] = team.id;
  const accessToken = await getAccessToken();
  if (rowIndex < 0) {
    await setGoogleSheetRanges(workforceSpreadsheetIds.attendance, accessToken, [{ range: `'${year}'!A${rowNumber}:AR${rowNumber}`, values: [row] }]);
  } else {
    await setGoogleSheetRanges(workforceSpreadsheetIds.attendance, accessToken, [
      { range: `'${year}'!${columnLetter(day + 2)}${rowNumber}:${columnLetter(day + 2)}${rowNumber}`, values: [[row[day + 2]]] },
      { range: `'${year}'!AL${rowNumber}:AR${rowNumber}`, values: [[row[37], row[38], row[39], row[40], row[41], row[42], row[43]]] }
    ]);
  }
  return { ok: true, record: { ...desired, revision: workforceRevision([value, desired.overtime, desired.substitutionReason, desired.homeShiftTeamId]), updatedAt: new Date().toISOString(), updatedBy: row[41] } };
}

function workforceWriteFailure(message) { return { ok: false, status: 400, message }; }
function normalizeWorkforceAttendanceValue(value) {
  const source = String(value ?? "").trim();
  if (["A", "L", "NS", "N", "MA", "NA", "PA", "G", "AV", "PV", "M", "TN", "D", "K", "SK", "VV", "PB", "ND", "NP", "NN"].includes(source)) return source;
  const hours = Number(source.replace(",", "."));
  return Number.isFinite(hours) && hours >= 0.5 && hours <= 24 && Math.round(hours * 2) === hours * 2 ? String(hours) : "";
}
function numericWorkforceAttendance(value) { return /^\d+(?:\.5)?$/.test(value) ? Number(value) : value; }
function sameWorkforceAttendance(left, right) {
  return Boolean(left) && normalizeWorkforceAttendanceValue(left.value) === normalizeWorkforceAttendanceValue(right.value)
    && Boolean(left.overtime) === Boolean(right.overtime)
    && String(left.substitutionReason || "") === String(right.substitutionReason || "")
    && String(left.homeShiftTeamId || "") === String(right.homeShiftTeamId || "");
}
function mergeWorkforceSubstituteNote(note, day, reason, homeShiftTeamId) {
  const current = String(note || "");
  if (!reason) return current;
  const team = String(homeShiftTeamId || "").endsWith("-b") ? "B" : "A";
  const matcher = /Подменный выход \(штатная смена ([AB])\):\s*([^\n]+)/;
  const match = current.match(matcher);
  const entries = match ? match[2].split(";").map(item => item.trim()).filter(Boolean) : [];
  const withoutDay = entries.filter(item => !item.startsWith(`${day} — `));
  withoutDay.push(`${day} — ${reason}`);
  withoutDay.sort((left, right) => Number(left.split(" ")[0]) - Number(right.split(" ")[0]));
  const replacement = `Подменный выход (штатная смена ${team}): ${withoutDay.join("; ")}`;
  return match ? current.replace(match[0], replacement) : `${current}${current ? "\n" : ""}${replacement}`;
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
  if (headers.length < 12 || String(headers[0]).trim() !== "Дата") {
    throw new Error("Изменилась структура журнала расхода упаковки");
  }
  const notes = await getPackagingDateNotes();
  return rows.slice(1).map((row, index) => packagingRecordFromRow(row, index + 3, notes[index] || "")).filter(Boolean);
}

async function createPackagingRecord(input) {
  const record = validatePackagingRecord(input);
  const existing = (await getPackagingSheetRecords()).find(item => item.date === record.date);
  const saved = await writePackagingRecordToSheet(record, existing);
  await syncPackagingTargets(saved);
  return { ok: true, record: saved };
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
  let rowNumber = existing?.rowNumber ?? (await getNextPackagingRowNumber());
  const requests = [];
  if (!existing && rowNumber > 3) {
    requests.push({ insertDimension: {
      range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, inheritFromBefore: true
    } });
    rowNumber += 1;
  }
  if (!existing && rowNumber > 3) {
    requests.push({ copyPaste: {
      source: { sheetId, startRowIndex: rowNumber - 2, endRowIndex: rowNumber - 1, startColumnIndex: 0, endColumnIndex: 12 },
      destination: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 12 },
      pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL"
    } });
  }
  requests.push({ updateCells: { start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 0 }, rows: [{ values: cells }], fields: "userEnteredValue,note,userEnteredFormat.numberFormat" } });
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
  const emptyRecord = { date, values: Object.fromEntries(packagingKeys.map(key => [key, 0])) };
  const pending = readPackagingPendingRecords();
  if (pending.some(item => item.date === date)) {
    writePackagingPendingRecords(pending.filter(item => item.date !== date));
    await syncPackagingTargets(emptyRecord);
    return { ok: true };
  }
  const record = (await getPackagingSheetRecords()).find(item => item.id === id);
  if (record) {
    const accessToken = await getAccessToken(); const sheetId = await getPackagingSheetId(accessToken);
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(packagingSpreadsheetId)}:batchUpdate`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: record.rowNumber - 1, endIndex: record.rowNumber } } }] }), signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({})); if (!response.ok) throw googleError(response.status, payload?.error?.message || "Не удалось удалить дневной расход упаковки");
  }
  await syncPackagingTargets(emptyRecord);
  return { ok: true };
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
  return syncPackagingTargets(source);
}

async function syncPackagingTargets(source) {
  const date = String(source?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Некорректная дата переноса расхода упаковки");
  const targetValues = packagingTargetValues(source.values);
  const [rawRow, cansRow] = await Promise.all([
    getDailyTargetRow(rawMaterialsSpreadsheetId, rawMaterialsRange, date, 3, "Расход сырья"),
    getDailyTargetRow(cansSpreadsheetId, cansRange, date, 4, "Банки")
  ]);
  const accessToken = await getAccessToken();
  const [rawSheetId, cansSheetId] = await Promise.all([
    getSheetId(rawMaterialsSpreadsheetId, rawMaterialsSheetName, accessToken),
    getSheetId(cansSpreadsheetId, cansSheetName, accessToken)
  ]);
  // Write exact daily totals rather than deltas. Retries are therefore safe,
  // and any correction in the source journal is mirrored without duplication.
  await updateSheetCells(rawMaterialsSpreadsheetId, accessToken, { sheetId: rawSheetId, rowIndex: rawRow.rowNumber - 1, columnIndex: 1 }, targetValues.rawMaterials);
  await updateSheetCells(cansSpreadsheetId, accessToken, { sheetId: cansSheetId, rowIndex: cansRow.rowNumber - 1, columnIndex: 1 }, targetValues.cansPrimary);
  await updateSheetCells(cansSpreadsheetId, accessToken, { sheetId: cansSheetId, rowIndex: cansRow.rowNumber - 1, columnIndex: 5 }, targetValues.cansSecondary);
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

async function withProductionWriteLock(task) {
  const previous = productionWriteTail;
  let release;
  productionWriteTail = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function readProductionCreateReceipt(requestId) {
  if (!requestId || !existsSync(productionCreateReceiptPath)) return null;
  try {
    const receipts = JSON.parse(readFileSync(productionCreateReceiptPath, "utf8"));
    const receipt = receipts?.[requestId];
    return receipt?.record && typeof receipt.record === "object" ? receipt.record : null;
  } catch {
    // A local non-secret receipt cache must never block production records.
    return null;
  }
}

function writeProductionCreateReceipt(requestId, record) {
  if (!requestId || !record?.id) return;
  let receipts = {};
  try {
    const value = existsSync(productionCreateReceiptPath)
      ? JSON.parse(readFileSync(productionCreateReceiptPath, "utf8"))
      : {};
    if (value && typeof value === "object" && !Array.isArray(value)) receipts = value;
  } catch {
    // Replace a damaged receipt cache with the current successful receipt.
  }
  receipts[requestId] = { savedAt: new Date().toISOString(), record };
  const retained = Object.entries(receipts)
    .sort((left, right) => String(right[1]?.savedAt || "").localeCompare(String(left[1]?.savedAt || "")))
    .slice(0, 500);
  const directory = dirname(productionCreateReceiptPath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${productionCreateReceiptPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(Object.fromEntries(retained), null, 2)}\n`, "utf8");
  renameSync(temporary, productionCreateReceiptPath);
}

async function createProductionRecord(input) {
  const candidate = validateGatewayProductionRecord(input);
  const completed = readProductionCreateReceipt(candidate.requestId);
  if (completed) return completed;
  // Coalesce both an identical production record and a retry of the same
  // browser request while this gateway is still processing it. The receipt
  // above also covers a retry after the original Google write succeeded but
  // its HTTP response did not reach the workstation.
  const keys = [productionDuplicateKey(candidate), `request:${candidate.requestId}`];
  const active = keys.map(key => productionCreateLocks.get(key)).find(Boolean);
  if (active) return active;
  const task = withProductionWriteLock(async () => {
    const receipt = readProductionCreateReceipt(candidate.requestId);
    if (receipt) return receipt;
    return createProductionRecordOnce(input, candidate);
  });
  keys.forEach(key => productionCreateLocks.set(key, task));
  try {
    return await task;
  } finally {
    keys.forEach(key => { if (productionCreateLocks.get(key) === task) productionCreateLocks.delete(key); });
  }
}

async function createProductionRecordOnce(input, record) {
  await assertProductionCatalogSchema();
  const leaders = await productionShiftLeaders(record.date, record.shift, input.leadership);
  const rows = await getProductionShiftRows();
  const existing = findExistingProductionRecord(rows, record);
  if (existing) {
    const saved = { ...record, id: productionRecordId(existing.firstRowNumber, existing.secondRowNumber), line: record.machineLine, seniorMechanic: existing.seniorMechanic || leaders.seniorMechanic, mechanic: existing.mechanic || leaders.mechanic };
    writeProductionCreateReceipt(record.requestId, saved);
    return saved;
  }
  let firstRowNumber = nextProductionRowNumber(rows.first, 4, rows.firstSummaries);
  let secondRowNumber = nextProductionRowNumber(rows.second, 2, rows.secondSummaries);
  const accessToken = await getAccessToken();
  if (needsDateSeparator(rows.first, record.date) || needsDateSeparator(rows.second, record.date)) {
    await insertProductionDateSeparators(accessToken, firstRowNumber, secondRowNumber);
    firstRowNumber += 1;
    secondRowNumber += 1;
  }
  await preserveProductionRowFormatting(accessToken, firstRowNumber, secondRowNumber);
  await writeProductionRecord(accessToken, record, leaders, firstRowNumber, secondRowNumber);
  writeProductionCreateReceipt(record.requestId, { ...record, id: productionRecordId(firstRowNumber, secondRowNumber), line: record.machineLine, ...leaders });
  let sorted = await sortProductionDayByLine(accessToken, record.date);
  if (await removeDuplicateProductionRecords(accessToken, sorted)) sorted = await sortProductionDayByLine(accessToken, record.date);
  const stored = await productionStoredRecord(sorted, record);
  scheduleProductionReportSync([record.date]);
  const saved = { ...record, id: productionRecordId(stored.firstRowNumber, stored.secondRowNumber), line: record.machineLine, ...leaders };
  writeProductionCreateReceipt(record.requestId, saved);
  return saved;
}

async function updateProductionRecord(input) {
  await assertProductionCatalogSchema();
  const { firstRowNumber, secondRowNumber } = parseProductionRecordId(input?.id);
  const record = validateGatewayProductionRecord(input);
  const leaders = await productionShiftLeaders(record.date, record.shift, input.leadership);
  const before = await getProductionShiftRows();
  const previousDate = before.first.find(row => row.rowNumber === firstRowNumber)?.date ?? before.second.find(row => row.rowNumber === secondRowNumber)?.date;
  const accessToken = await getAccessToken();
  await writeProductionRecord(accessToken, record, leaders, firstRowNumber, secondRowNumber);
  let sorted = await sortProductionDaysByLine(accessToken, [previousDate, record.date]);
  if (await removeDuplicateProductionRecords(accessToken, sorted)) sorted = await sortProductionDaysByLine(accessToken, [previousDate, record.date]);
  const stored = await productionStoredRecord(sorted, record);
  scheduleProductionReportSync([previousDate, record.date]);
  return { ...record, id: productionRecordId(stored.firstRowNumber, stored.secondRowNumber), line: record.machineLine, ...leaders };
}

async function deleteProductionRecord(input) {
  await assertProductionCatalogSchema();
  const { firstRowNumber, secondRowNumber } = parseProductionRecordId(input?.id);
  const before = await getProductionShiftRows();
  const previousDate = before.first.find(row => row.rowNumber === firstRowNumber)?.date ?? before.second.find(row => row.rowNumber === secondRowNumber)?.date;
  const accessToken = await getAccessToken();
  await clearProductionRecordPairs(accessToken, [{ firstRowNumber, secondRowNumber }]);
  scheduleProductionReportSync([previousDate]);
}

async function removeDuplicateProductionRecords(accessToken, rows = null) {
  const snapshot = rows ?? await getProductionShiftRows();
  const duplicates = duplicateProductionPairs(snapshot);
  if (!duplicates.length) return 0;
  await clearProductionRecordPairs(accessToken, duplicates);
  console.warn(`Удалены дублирующие записи продукции: ${duplicates.length}.`);
  return duplicates.length;
}

function duplicateProductionPairs(rows) {
  const firstByPair = new Map();
  for (const first of rows.first) {
    const key = productionPairKey(first);
    const entries = firstByPair.get(key) ?? [];
    entries.push(first);
    firstByPair.set(key, entries);
  }
  const seen = new Set();
  const duplicates = [];
  for (const second of rows.second) {
    const first = firstByPair.get(productionPairKey(second))?.shift();
    if (!first) continue;
    const key = productionDuplicateKey(second);
    if (seen.has(key)) duplicates.push({ firstRowNumber: first.rowNumber, secondRowNumber: second.rowNumber });
    else seen.add(key);
  }
  return duplicates;
}

async function clearProductionRecordPairs(accessToken, pairs) {
  const ranges = pairs.flatMap(({ firstRowNumber, secondRowNumber }) => [
    { range: `'Учет продукции 1'!B${firstRowNumber}:H${firstRowNumber}`, values: [Array(7).fill("")] },
    { range: `'Учет продукции 1'!J${firstRowNumber}:J${firstRowNumber}`, values: [[""]] },
    { range: `'Учет продукции 1'!L${firstRowNumber}:L${firstRowNumber}`, values: [[""]] },
    { range: `'Учет продукции 1'!M${firstRowNumber}:R${firstRowNumber}`, values: [Array(6).fill("")] },
    { range: `'Учет продукции 2'!A${secondRowNumber}:G${secondRowNumber}`, values: [Array(7).fill("")] },
    { range: `'Учет продукции 2'!I${secondRowNumber}:I${secondRowNumber}`, values: [[""]] },
    { range: `'Учет продукции 2'!K${secondRowNumber}:R${secondRowNumber}`, values: [Array(8).fill("")] }
  ]);
  for (let index = 0; index < ranges.length; index += 100) {
    await setGoogleSheetRanges(productionSpreadsheetId, accessToken, ranges.slice(index, index + 100));
  }
}

async function writeProductionRecord(accessToken, record, leaders, firstRowNumber, secondRowNumber) {
  const first = productionFirstValues(record, leaders);
  const second = productionSecondValues(record, leaders);
  await setGoogleSheetRanges(productionSpreadsheetId, accessToken, [
    { range: `'Учет продукции 1'!B${firstRowNumber}:H${firstRowNumber}`, values: [first.beforeBoxes] },
    { range: `'Учет продукции 1'!J${firstRowNumber}:J${firstRowNumber}`, values: [[first.scrapKg]] },
    { range: `'Учет продукции 1'!L${firstRowNumber}:L${firstRowNumber}`, values: [[first.canScrapKg]] },
    { range: `'Учет продукции 1'!M${firstRowNumber}:R${firstRowNumber}`, values: [first.afterBoxes] },
    { range: `'Учет продукции 2'!A${secondRowNumber}:G${secondRowNumber}`, values: [second.beforeBoxes] },
    { range: `'Учет продукции 2'!I${secondRowNumber}:I${secondRowNumber}`, values: [[second.scrapKg]] },
    { range: `'Учет продукции 2'!K${secondRowNumber}:R${secondRowNumber}`, values: [second.afterBoxes] }
  ]);
}

function productionFirstValues(record, leaders) {
  return {
    beforeBoxes: [displayDate(record.date), record.startTime, record.time, record.catalogLine, record.product, record.strength, record.quantity],
    scrapKg: record.scrapKg,
    canScrapKg: record.canScrapKg,
    afterBoxes: [record.packer, record.operator, record.machineLine, record.shift, leaders.seniorMechanic, leaders.mechanic]
  };
}

function productionSecondValues(record, leaders) {
  return {
    beforeBoxes: [displayDate(record.date), record.startTime, record.time, record.catalogLine, record.product, record.strength, record.quantity],
    scrapKg: record.scrapKg,
    afterBoxes: [record.packer, record.operator, record.machineLine, record.canScrapKg, record.note, record.shift, leaders.seniorMechanic, leaders.mechanic]
  };
}

function productionSortValue(record) {
  return String(record.line || record.machineLine || "").trim().toLocaleUpperCase("en");
}

async function productionStoredRecord(rows, record) {
  const signature = productionSignature({ ...record, line: record.machineLine });
  // Google Sheets can return the preceding snapshot immediately after a batch
  // update. The write has already completed, so retry only the read instead of
  // asking the operator to submit the production record again.
  let snapshot = rows;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const first = snapshot.first.find(row => productionSignature(row) === signature);
    const second = snapshot.second.find(row => productionSignature(row) === signature);
    if (first && second) return { firstRowNumber: first.rowNumber, secondRowNumber: second.rowNumber };
    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 300));
      snapshot = await getProductionShiftRows();
    }
  }
  throw new Error("Запись продукции сохранена, но не удалось сразу обновить её положение после сортировки. Обновите журнал, не создавая запись повторно.");
}

async function sortProductionDayByLine(accessToken, date) {
  return sortProductionDaysByLine(accessToken, [date]);
}

async function rebuildProductionShiftSummaries() {
  if (!writesEnabled || missingGoogleSettings().length) return { updated: 0 };
  const accessToken = await getAccessToken();
  let rows = await getProductionShiftRows();
  if (await removeDuplicateProductionRecords(accessToken, rows)) rows = await getProductionShiftRows();
  const dates = [...new Set([...rows.first, ...rows.second].map(row => row.date).filter(Boolean))];
  const [firstSheetId, secondSheetId] = await Promise.all([
    getSheetId(productionSpreadsheetId, "\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1", accessToken),
    getSheetId(productionSpreadsheetId, "\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2", accessToken)
  ]);
  const missing = dates.filter(date => !rows.firstSummaries.some(summary => summary.date === date) || !rows.secondSummaries.some(summary => summary.date === date));
  for (const date of missing.sort((left, right) => right.localeCompare(left))) {
    rows = await getProductionShiftRows();
    const first = rows.first.filter(row => row.date === date);
    const second = rows.second.filter(row => row.date === date);
    const requests = [];
    if (first.length && !rows.firstSummaries.some(summary => summary.date === date)) {
      requests.push({ insertDimension: { range: { sheetId: firstSheetId, dimension: "ROWS", startIndex: Math.max(...first.map(row => row.rowNumber)), endIndex: Math.max(...first.map(row => row.rowNumber)) + 1 }, inheritFromBefore: true } });
    }
    if (second.length && !rows.secondSummaries.some(summary => summary.date === date)) {
      requests.push({ insertDimension: { range: { sheetId: secondSheetId, dimension: "ROWS", startIndex: Math.max(...second.map(row => row.rowNumber)), endIndex: Math.max(...second.map(row => row.rowNumber)) + 1 }, inheritFromBefore: true } });
    }
    if (requests.length) await batchGoogleSheetRequests(productionSpreadsheetId, accessToken, requests, "Could not add production summary row");
  }
  const snapshot = await sortProductionDaysByLine(accessToken, dates);
  return { updated: dates.length, records: snapshot.first.length + snapshot.second.length };
}

async function sortProductionDaysByLine(accessToken, dates) {
  const targetDates = [...new Set(dates.filter(Boolean))];
  if (!targetDates.length) return getProductionShiftRows();
  let rows = await getProductionShiftRows();
  const summaries = [
    ...rows.firstSummaries.filter(summary => targetDates.includes(summary.date)).map(summary => ({ sheet: "first", rowNumber: summary.rowNumber })),
    ...rows.secondSummaries.filter(summary => targetDates.includes(summary.date)).map(summary => ({ sheet: "second", rowNumber: summary.rowNumber }))
  ];
  if (summaries.length) {
    const clears = summaries.flatMap(summary => summary.sheet === "first" ? [
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!B${summary.rowNumber}`, values: [[""]] },
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!H${summary.rowNumber}`, values: [[""]] },
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!J${summary.rowNumber}`, values: [[""]] },
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!L${summary.rowNumber}:M${summary.rowNumber}`, values: [["", ""]] }
    ] : [
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!A${summary.rowNumber}`, values: [[""]] },
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!G${summary.rowNumber}`, values: [[""]] },
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!I${summary.rowNumber}`, values: [[""]] },
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!K${summary.rowNumber}`, values: [[""]] },
      { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!M${summary.rowNumber}:N${summary.rowNumber}`, values: [["", ""]] }
    ]);
    await setGoogleSheetRanges(productionSpreadsheetId, accessToken, clears);
    rows = await getProductionShiftRows();
  }
  const ranges = [];
  for (const date of targetDates) {
    const first = rows.first.filter(row => row.date === date).sort((a, b) => productionSortValue(a).localeCompare(productionSortValue(b), "en"));
    const second = rows.second.filter(row => row.date === date).sort((a, b) => productionSortValue(a).localeCompare(productionSortValue(b), "en"));
    if (first.length) {
      const start = Math.min(...first.map(row => row.rowNumber));
      const end = start + first.length - 1;
      ranges.push(
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!B${start}:H${end}`, values: first.map(row => productionFirstValues({ ...row, machineLine: row.line }, row).beforeBoxes) },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!J${start}:J${end}`, values: first.map(row => [row.scrapKg]) },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!L${start}:L${end}`, values: first.map(row => [row.canScrapKg]) },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!M${start}:R${end}`, values: first.map(row => productionFirstValues({ ...row, machineLine: row.line }, row).afterBoxes) }
      );
    }
    if (second.length) {
      const start = Math.min(...second.map(row => row.rowNumber));
      const end = start + second.length - 1;
      ranges.push(
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!A${start}:G${end}`, values: second.map(row => productionSecondValues({ ...row, machineLine: row.line }, row).beforeBoxes) },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!I${start}:I${end}`, values: second.map(row => [row.scrapKg]) },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!K${start}:R${end}`, values: second.map(row => productionSecondValues({ ...row, machineLine: row.line }, row).afterBoxes) }
      );
    }
  }
  if (ranges.length) await setGoogleSheetRanges(productionSpreadsheetId, accessToken, ranges);
  rows = await getProductionShiftRows();
  const summaryWrites = productionShiftSummaryWrites(rows, targetDates);
  if (summaryWrites.length) await setGoogleSheetRanges(productionSpreadsheetId, accessToken, summaryWrites);
  return getProductionShiftRows();
}

function productionShiftSummaryWrites(rows, dates) {
  const writes = [];
  for (const date of dates) {
    const first = rows.first.filter(row => row.date === date);
    const second = rows.second.filter(row => row.date === date);
    const source = second.length ? second : first;
    if (!source.length) continue;
    const summary = productionShiftSummary(source);
    const label = productionSummaryLabel(date);
    const percent = productionSummaryPercentLabel(summary.percent);
    const cans = Number(summary.canScrapKg || 0);
    if (first.length) {
      const rowNumber = Math.max(...first.map(row => row.rowNumber)) + 1;
      writes.push(
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!B${rowNumber}`, values: [[label]] },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!H${rowNumber}`, values: [[summary.quantity]] },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!J${rowNumber}`, values: [[summary.scrapKg]] },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!L${rowNumber}`, values: [[cans]] },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!M${rowNumber}`, values: [[percent]] }
      );
    }
    if (second.length) {
      const rowNumber = Math.max(...second.map(row => row.rowNumber)) + 1;
      writes.push(
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!A${rowNumber}`, values: [[label]] },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!G${rowNumber}`, values: [[summary.quantity]] },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!I${rowNumber}`, values: [[summary.scrapKg]] },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!K${rowNumber}`, values: [[percent]] },
        { range: `'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!M${rowNumber}:N${rowNumber}`, values: [["\u0411\u0440\u0430\u043a \u0431\u0430\u043d\u043e\u043a, \u043a\u0433", cans]] }
      );
    }
  }
  return writes;
}

function productionShiftSummary(records) {
  const quantity = records.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
  const scrapKg = records.reduce((sum, record) => sum + Number(record.scrapKg || 0), 0);
  const canScrapKg = records.reduce((sum, record) => sum + Number(record.canScrapKg || 0), 0);
  const equivalent = records.reduce((sum, record) => {
    const percent = Number(record.scrapPercent);
    const quantity = Number(record.quantity || 0);
    return Number.isFinite(percent) && percent >= 0 && percent < 1 ? sum + quantity * percent / (1 - percent) : sum;
  }, 0);
  return { quantity, scrapKg, canScrapKg, percent: quantity + equivalent > 0 ? equivalent / (quantity + equivalent) : null };
}

function productionSummaryLabel(date) { return "\u0418\u0422\u041e\u0413\u041e \u0421\u041c\u0415\u041d\u042b \u00b7 " + date; }
function productionSummaryPercentLabel(value) { return Number.isFinite(value) ? "\u041f\u0440\u043e\u0446\u0435\u043d\u0442 \u0431\u0440\u0430\u043a\u0430: " + (value * 100).toFixed(1).replace(".", ",") + "%" : "\u041f\u0440\u043e\u0446\u0435\u043d\u0442 \u0431\u0440\u0430\u043a\u0430: -"; }

function nextProductionRowNumber(rows, firstDataRow, summaries = []) {
  return Math.max(firstDataRow, ...rows.map(row => row.rowNumber + 1), ...summaries.map(row => row.rowNumber + 1));
}

function needsDateSeparator(rows, date) {
  const latest = rows.reduce((result, row) => !result || row.rowNumber > result.rowNumber ? row : result, null);
  return Boolean(latest && latest.date !== date);
}

async function insertProductionDateSeparators(accessToken, firstRowNumber, secondRowNumber) {
  const [firstSheetId, secondSheetId] = await Promise.all([
    getSheetId(productionSpreadsheetId, "Учет продукции 1", accessToken),
    getSheetId(productionSpreadsheetId, "Учет продукции 2", accessToken)
  ]);
  await batchGoogleSheetRequests(productionSpreadsheetId, accessToken, [
    { insertDimension: { range: { sheetId: firstSheetId, dimension: "ROWS", startIndex: firstRowNumber - 1, endIndex: firstRowNumber }, inheritFromBefore: true } },
    { insertDimension: { range: { sheetId: secondSheetId, dimension: "ROWS", startIndex: secondRowNumber - 1, endIndex: secondRowNumber }, inheritFromBefore: true } }
  ], "Не удалось добавить разделитель между днями продукции");
}

async function ensureProductionCanScrapColumn() {
  if (!productionCanScrapMigrationPromise) {
    productionCanScrapMigrationPromise = migrateProductionCanScrapColumn().catch(error => {
      productionCanScrapMigrationPromise = null;
      throw error;
    });
  }
  return productionCanScrapMigrationPromise;
}

async function migrateProductionCanScrapColumn() {
  if (!writesEnabled || missingGoogleSettings().length) return { migrated: false, updated: 0 };
  const firstSheetName = "Учет продукции 1";
  const accessToken = await getAccessToken();
  const sheetId = await getSheetId(productionSpreadsheetId, firstSheetName, accessToken);
  let [header] = await getGoogleSheetRanges(productionSpreadsheetId, [`'${firstSheetName}'!B2:R2`]);
  const hasCanScrap = String(header?.[0]?.[10] || "").toLocaleLowerCase("ru").includes("банок");
  let migrated = false;
  if (!hasCanScrap) {
    await batchGoogleSheetRequests(productionSpreadsheetId, accessToken, [{
      insertDimension: { range: { sheetId, dimension: "COLUMNS", startIndex: 11, endIndex: 12 }, inheritFromBefore: true }
    }], "Не удалось добавить графу «Брак банок» в журнал продукции");
    await setGoogleSheetRanges(productionSpreadsheetId, accessToken, [{
      range: `'${firstSheetName}'!L2`, values: [["Брак банок, кг"]]
    }]);
    migrated = true;
  }
  await batchGoogleSheetRequests(productionSpreadsheetId, accessToken, [{
    repeatCell: {
      range: { sheetId, startRowIndex: 3, startColumnIndex: 11, endColumnIndex: 12 },
      cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.###" } } },
      fields: "userEnteredFormat.numberFormat"
    }
  }], "Не удалось установить числовой формат графы «Брак банок»");
  const rows = await getProductionShiftRows();
  const firstByParallelRow = new Map(rows.first.map(row => [row.rowNumber - 2, row]));
  const secondBySignature = new Map();
  for (const row of rows.second) {
    const key = productionSignature(row);
    const list = secondBySignature.get(key) ?? [];
    list.push(row);
    secondBySignature.set(key, list);
  }
  const updates = [];
  for (const second of rows.second) {
    const parallel = firstByParallelRow.get(second.rowNumber);
    const match = parallel && productionPairKey(parallel) === productionPairKey(second)
      ? parallel
      : (secondBySignature.get(productionSignature(second)) ?? []).shift();
    if (match) updates.push({ range: `'${firstSheetName}'!L${match.rowNumber}`, values: [[Number(second.canScrapKg || 0)]] });
  }
  for (let index = 0; index < updates.length; index += 100) {
    await setGoogleSheetRanges(productionSpreadsheetId, accessToken, updates.slice(index, index + 100));
  }
  if (migrated || updates.length) console.log(`Графа брака банок подготовлена: ${updates.length} записей сверено.`);
  return { migrated, updated: updates.length };
}

async function assertProductionCatalogSchema() {
  await ensureProductionCanScrapColumn();
  const [secondHeader, firstHeader] = await getGoogleSheetRanges(productionSpreadsheetId, ["'Учет продукции 2'!A1:R1", "'Учет продукции 1'!B2:R2"]);
  const ready = String(secondHeader?.[0]?.[3] || "").toLocaleLowerCase("ru").includes("линейка") && String(firstHeader?.[0]?.[3] || "").toLocaleLowerCase("ru").includes("lin") && String(secondHeader?.[0]?.[7] || "").toLocaleLowerCase("ru").includes("короб") && String(firstHeader?.[0]?.[7] || "").toLocaleLowerCase("ru").includes("короб") && String(secondHeader?.[0]?.[9] || "").toLocaleLowerCase("ru").includes("процент") && String(firstHeader?.[0]?.[9] || "").toLocaleLowerCase("ru").includes("процент") && String(firstHeader?.[0]?.[10] || "").toLocaleLowerCase("ru").includes("банок");
  if (!ready) throw new Error("Журнал продукции ещё не подготовлен для граф «Линейка продукта», «Коробки», «Процент брака» и «Брак банок». Обновите таблицу через центральный сервер.");
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
      source: { sheetId: firstSheetId, startRowIndex: firstRowNumber - 2, endRowIndex: firstRowNumber - 1, startColumnIndex: 1, endColumnIndex: 18 },
      destination: { sheetId: firstSheetId, startRowIndex: firstRowNumber - 1, endRowIndex: firstRowNumber, startColumnIndex: 1, endColumnIndex: 18 },
      pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL"
    } });
  }
  if (secondRowNumber > 2) {
    requests.push({ copyPaste: {
      source: { sheetId: secondSheetId, startRowIndex: secondRowNumber - 2, endRowIndex: secondRowNumber - 1, startColumnIndex: 0, endColumnIndex: 18 },
      destination: { sheetId: secondSheetId, startRowIndex: secondRowNumber - 1, endRowIndex: secondRowNumber, startColumnIndex: 0, endColumnIndex: 18 },
      pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL"
    } });
  }
  if (requests.length) await batchGoogleSheetRequests(productionSpreadsheetId, accessToken, requests, "Не удалось оформить новую строку продукции");
}

async function productionShiftLeaders(date, shift, selected = null) {
  const workforce = await getWorkforceSnapshot();
  const fallback = productionShiftLeadersFromWorkforce(workforce, date, shift);
  const teamId = shift === "A" ? "shift-team-a" : "shift-team-b";
  // The shared shift is the authoritative source for a current production
  // entry. A production dialog may have been opened before the senior
  // mechanic was chosen; in that case its browser state is stale and must not
  // erase the mechanic saved in the central shift.
  const sharedShift = readCentralShiftState();
  const sharedLeadership = sharedShift?.active
    && sharedShift.shiftDate === date
    && sharedShift.shiftTeamId === teamId
    ? { seniorMechanic: sharedShift.seniorMechanic, mechanic: sharedShift.mechanic }
    : null;
  const source = String(sharedLeadership?.seniorMechanic || "").trim() ? sharedLeadership : selected;
  const seniorMechanic = String(source?.seniorMechanic || "").trim();
  const mechanic = String(source?.mechanic || "").trim();
  if (!seniorMechanic) return fallback;
  const peopleById = new Map((workforce.personnel ?? []).map(person => [person.id, person]));
  const present = (workforce.attendance ?? []).filter(item => item.date === date && item.shiftTeamId === teamId && isWorkedAttendance(item))
    .map(item => peopleById.get(item.employeeId)).filter(Boolean);
  const seniorPool = present.some(person => person.role === "senior-mechanic")
    ? present.filter(person => person.role === "senior-mechanic")
    : present.filter(person => person.role === "mechanic");
  const directMechanics = present.filter(person => person.role === "mechanic" && person.fullName !== seniorMechanic);
  const mechanicPool = directMechanics.length ? directMechanics : present.filter(person => person.role === "mechanic-operator");
  if (!seniorPool.some(person => person.fullName === seniorMechanic)) throw new Error("Старший механик должен быть отмечен в табеле этой смены.");
  if (mechanic && !mechanicPool.some(person => person.fullName === mechanic)) throw new Error("Механик должен быть отмечен в табеле этой смены.");
  return { seniorMechanic, mechanic };
}

function productionShiftLeadersFromWorkforce(workforce, date, shift) {
  const teamId = shift === "A" ? "shift-team-a" : "shift-team-b";
  const peopleById = new Map((workforce.personnel ?? []).map(person => [person.id, person]));
  const present = (workforce.attendance ?? [])
    .filter(item => item.date === date && item.shiftTeamId === teamId && isWorkedAttendance(item))
    .map(item => peopleById.get(item.employeeId))
    .filter(Boolean);
  const seniorMechanics = present.filter(person => person.role === "senior-mechanic");
  const directMechanics = present.filter(person => person.role === "mechanic");
  const seniorPool = seniorMechanics.length ? seniorMechanics : directMechanics;
  const seniorNames = seniorPool.map(person => person.fullName);
  return {
    seniorMechanic: seniorNames.join("; "),
    mechanic: directMechanics.filter(person => !seniorNames.includes(person.fullName)).map(person => person.fullName).join("; ")
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
    if (!first.seniorMechanic || !first.mechanic) updates.push({ range: `'Учет продукции 1'!Q${firstRowNumber}:R${firstRowNumber}`, values: [firstValues] });
    if (!second.seniorMechanic || !second.mechanic) updates.push({ range: `'Учет продукции 2'!Q${secondRowNumber}:R${secondRowNumber}`, values: [secondValues] });
  }
  for (let index = 0; index < updates.length; index += 100) {
    await setGoogleSheetRanges(productionSpreadsheetId, accessToken, updates.slice(index, index + 100));
  }
  if (updates.length) console.log(`Заполнены старший механик и механик: ${updates.length} строк журнала продукции.`);
  return { updated: updates.length };
}

async function getProductionShiftRows() {
  const [secondHeader, firstHeader, secondRows, firstRows] = await getGoogleSheetRanges(productionSpreadsheetId, ["'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 2'!A1:R1", "'\u0423\u0447\u0435\u0442 \u043f\u0440\u043e\u0434\u0443\u043a\u0446\u0438\u0438 1'!B2:R2", productionSecondRange, productionFirstRange]);
  const hasCatalogLine = String(secondHeader?.[0]?.[3] || "").toLocaleLowerCase("ru").includes("\u043b\u0438\u043d\u0435\u0439\u043a\u0430") && String(firstHeader?.[0]?.[3] || "").toLocaleLowerCase("ru").includes("lin");
  return {
    second: (secondRows ?? []).map((row, index) => productionRowFromSecond(row, index + 2, hasCatalogLine)).filter(Boolean),
    first: (firstRows ?? []).map((row, index) => productionRowFromFirst(row, index + 4, hasCatalogLine)).filter(Boolean),
    secondSummaries: productionSummaryRows(secondRows, 2),
    firstSummaries: productionSummaryRows(firstRows, 4)
  };
}

function productionSummaryRows(rows, startRow) {
  const prefix = "\u0418\u0422\u041e\u0413\u041e \u0421\u041c\u0415\u041d\u042b";
  return (rows ?? []).map((row, index) => {
    const label = String(row?.[0] || "").trim();
    const match = label.match(/(\d{4}-\d{2}-\d{2})/);
    return label.startsWith(prefix) && match ? { rowNumber: startRow + index, date: match[1] } : null;
  }).filter(Boolean);
}

function productionRowFromSecond(row, rowNumber, hasCatalogLine) {
  const date = googleSheetDate(row?.[0]);
  if (!date || !String(row?.[hasCatalogLine ? 4 : 3] || "").trim()) return null;
  if (!hasCatalogLine) return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), catalogLine: "", product: String(row[3] || "").trim(), strength: googleNumber(row[4]) || 0, quantity: googleNumber(row[5]) || 0, scrapKg: googleNumber(row[6]) || 0, scrapPercent: productionScrapPercent(row[7]), packer: String(row[8] || "").trim(), operator: String(row[9] || "").trim(), line: String(row[10] || "").trim(), canScrapKg: googleNumber(row[11]) || 0, note: String(row[12] || "").trim(), shift: String(row[13] || "").trim().toUpperCase(), seniorMechanic: String(row[14] || "").trim(), mechanic: String(row[15] || "").trim() };
  return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), catalogLine: String(row[3] || "").trim(), product: String(row[4] || "").trim(), strength: googleNumber(row[5]) || 0, quantity: googleNumber(row[6]) || 0, scrapKg: googleNumber(row[8]) || 0, scrapPercent: productionScrapPercent(row[9]), packer: String(row[10] || "").trim(), operator: String(row[11] || "").trim(), line: String(row[12] || "").trim(), canScrapKg: googleNumber(row[13]) || 0, note: String(row[14] || "").trim(), shift: String(row[15] || "").trim().toUpperCase(), seniorMechanic: String(row[16] || "").trim(), mechanic: String(row[17] || "").trim() };
}

function productionScrapPercent(value) {
  const source = String(value ?? "").trim();
  if (!source) return null;
  const formattedAsPercent = source.endsWith("%");
  const percent = googleNumber(source.replace("%", ""));
  return Number.isFinite(percent) ? (formattedAsPercent ? percent / 100 : percent) : null;
}

function productionRowFromFirst(row, rowNumber, hasCatalogLine) {
  const date = googleSheetDate(row?.[0]);
  if (!date || !String(row?.[hasCatalogLine ? 4 : 3] || "").trim()) return null;
  if (!hasCatalogLine) return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), catalogLine: "", product: String(row[3] || "").trim(), strength: googleNumber(row[4]) || 0, quantity: googleNumber(row[5]) || 0, scrapKg: googleNumber(row[6]) || 0, packer: String(row[8] || "").trim(), operator: String(row[9] || "").trim(), line: String(row[10] || "").trim(), shift: String(row[11] || "").trim().toUpperCase(), seniorMechanic: String(row[12] || "").trim(), mechanic: String(row[13] || "").trim() };
  return { rowNumber, date, startTime: String(row[1] || "").trim(), time: String(row[2] || "").trim(), catalogLine: String(row[3] || "").trim(), product: String(row[4] || "").trim(), strength: googleNumber(row[5]) || 0, quantity: googleNumber(row[6]) || 0, scrapKg: googleNumber(row[8]) || 0, scrapPercent: productionScrapPercent(row[9]), canScrapKg: googleNumber(row[10]) || 0, packer: String(row[11] || "").trim(), operator: String(row[12] || "").trim(), line: String(row[13] || "").trim(), shift: String(row[14] || "").trim().toUpperCase(), seniorMechanic: String(row[15] || "").trim(), mechanic: String(row[16] || "").trim() };
}

function productionTimeSignature(value) {
  const source = String(value || "").trim();
  const match = source.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match) return match[1].padStart(2, "0") + ":" + match[2];
  const serial = Number(source.replace(",", "."));
  if (Number.isFinite(serial) && serial >= 0 && serial < 1) {
    const minutes = Math.round(serial * 24 * 60) % (24 * 60);
    return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
  }
  return source;
}

function productionSignature(record) {
  return [record.date, productionTimeSignature(record.startTime), productionTimeSignature(record.time), record.product, record.packer, record.operator, record.line || record.machineLine]
    .map(value => String(value || "").trim().toLocaleLowerCase("ru"))
    .join("\u001f");
}

function productionDuplicateKey(record) {
  return [record.date, productionTimeSignature(record.startTime), productionTimeSignature(record.time), record.catalogLine, record.product, record.strength, record.quantity, record.scrapKg, record.canScrapKg, record.packer, record.operator, record.line || record.machineLine, record.shift, record.note]
    .map(value => typeof value === "number" ? String(value) : String(value || "").trim().toLocaleLowerCase("ru"))
    .join("\u001f");
}

function productionPairKey(record) {
  return [record.date, productionTimeSignature(record.startTime), productionTimeSignature(record.time), record.catalogLine, record.product, record.strength, record.quantity, record.scrapKg, record.packer, record.operator, record.line || record.machineLine, record.shift]
    .map(value => typeof value === "number" ? String(value) : String(value || "").trim().toLocaleLowerCase("ru"))
    .join("\u001f");
}

function findExistingProductionRecord(rows, record) {
  const duplicateKey = productionDuplicateKey(record);
  const pairKey = productionPairKey(record);
  const second = rows.second.find(item => productionDuplicateKey(item) === duplicateKey || productionPairKey(item) === pairKey);
  if (!second) return null;
  const first = rows.first.find(item => productionPairKey(item) === productionPairKey(second));
  return first ? { firstRowNumber: first.rowNumber, secondRowNumber: second.rowNumber, seniorMechanic: second.seniorMechanic, mechanic: second.mechanic } : null;
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
  const requestId = text("requestId", "Идентификатор запроса", 160);
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(requestId)) throw new Error("Некорректный идентификатор запроса");
  return {
    requestId,
    date, startTime, time, catalogLine: text("catalogLine", "Линейка продукта", 180), product: text("product", "Продукт", 180),
    strength: decimal("strength", "Крепость", true), quantity: decimal("quantity", "Количество готовой продукции", true),
    scrapKg: decimal("scrapKg", "Брак продукции"), canScrapKg: decimal("canScrapKg", "Вес бракованных банок"),
    packer: text("packer", "Упаковщик", 180), operator: text("operator", "Механик-оператор", 360), machineLine, shift,
    note: String(input?.note || "").trim().slice(0, 5000)
  };
}

async function exportProductionDaily(input) {
  const date = String(input?.date || "");
  const today = vilniusDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || (date === today && !input?.allowCurrentDay)) throw new Error("Передавать можно только завершённый день");
  const records = (await getProductionSnapshot()).records.filter(record => record.date === date);
  const accessToken = await getAccessToken();
  const mechanics = await ensureProductionMechanicsReportLayout(accessToken, records);
  const [machineRows, packerRows, scrapRows, massRows, mechanicsRows, packerHeaders, scrapHeaders, specifications] = await Promise.all([
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionMachineRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionPackerRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionScrapRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionMassRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, [productionMechanicsRange]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Упаковщики'!A6:V6"]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Брак'!A6:V6"]),
    records.length ? runAppsScript("listProductSpecifications") : Promise.resolve([])
  ]);
  const machine = machineRows[0] ?? [];
  const packers = packerRows[0] ?? [];
  const scrap = scrapRows[0] ?? [];
  const mass = massRows[0] ?? [];
  const mechanicRows = mechanicsRows[0] ?? [];
  const packerHeader = packerHeaders[0]?.[0] ?? [];
  const scrapHeader = scrapHeaders[0]?.[0] ?? [];
  const mechanicsHeader = mechanicRows.length ? await getGoogleSheetRanges(productionReportSpreadsheetId, ["'Механики'!A6:BN6"]).then(rows => rows[0]?.[0] ?? []) : [];
  const machineTarget = getDailyTargetRowFromRows(machine, date, 7, "Станки");
  const packerTarget = getDailyTargetRowFromRows(packers, date, 7, "Упаковщики");
  const scrapTarget = getDailyTargetRowFromRows(scrap, date, 7, "Брак");
  const massTarget = getDailyTargetRowFromRows(mass, date, 7, "Масса");
  const mechanicsTarget = getDailyTargetRowFromRows(mechanicRows, date, 7, "Механики");
  const machineValues = Array(8).fill(0);
  records.forEach(record => {
    const column = productionMachineColumns[String(record.line || "").toUpperCase()];
    if (column !== undefined) machineValues[column - 2] += Number(record.quantity || 0) / 240;
  });
  const writes = [
    setGoogleSheetRanges(productionReportSpreadsheetId, accessToken, [{ range: `'Станки'!C${machineTarget.rowNumber}:J${machineTarget.rowNumber}`, values: [records.length ? machineValues : Array(8).fill("")] }]),
    updateDailyPeopleValues(productionReportSpreadsheetId, accessToken, "Упаковщики", packerTarget.rowNumber, packerHeader, records, record => Number(record.quantity || 0) / 240),
    updateDailyPeopleValues(productionReportSpreadsheetId, accessToken, "Брак", scrapTarget.rowNumber, scrapHeader, records, record => Number(record.scrapKg || 0)),
    setGoogleSheetRanges(productionReportSpreadsheetId, accessToken, [{ range: `'Масса'!B${massTarget.rowNumber}:G${massTarget.rowNumber}`, values: [productionMassValues(records, specifications)] }]),
    updateDailyMechanicsValues(accessToken, mechanicsTarget.rowNumber, mechanicsHeader, records, specifications)
  ];
  await Promise.all(writes);
  return { ok: true, date, records: records.length };
}

async function syncProductionReportDates(dates) {
  const uniqueDates = [...new Set(dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date))))];
  for (const date of uniqueDates) await exportProductionDaily({ date, allowCurrentDay: true });
}

function scheduleProductionReportSync(dates) {
  const uniqueDates = [...new Set(dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date))))];
  if (uniqueDates.length) runBackgroundTask(`сводка продукции: ${uniqueDates.join(", ")}`, () => syncProductionReportDates(uniqueDates));
}

async function synchronizeAllProductionReports() {
  const dates = [...new Set((await getProductionSnapshot()).records.map(record => record.date).filter(Boolean))].sort();
  await syncProductionReportDates(dates);
  console.log(`Синхронизированы дневные итоги продукции: ${dates.length} дн.`);
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

async function updateDailyPeopleValues(spreadsheetId, accessToken, sheetName, rowNumber, headers, records, valueFor) {
  const totals = new Map();
  records.forEach(record => totals.set(record.packer, (totals.get(record.packer) || 0) + valueFor(record)));
  return updateDailyHeaderValues(spreadsheetId, accessToken, sheetName, rowNumber, headers, totals);
}

function updateDailyHeaderValues(spreadsheetId, accessToken, sheetName, rowNumber, headers, totals) {
  const totalIndex = headers.findIndex(value => String(value).trim().startsWith("Всего,"));
  if (totalIndex < 2) throw new Error("Изменилась структура дневной сводки по сотрудникам");
  const people = headers.slice(1, totalIndex);
  return setGoogleSheetRanges(spreadsheetId, accessToken, [{
    range: `'${sheetName}'!B${rowNumber}:${columnLetter(totalIndex - 1)}${rowNumber}`,
    values: [people.map(name => totals.get(String(name).trim()) ?? "")]
  }]);
}

async function ensureProductionMechanicsReportLayout(accessToken, records) {
  let sheetId;
  let sourceName = productionMechanicsSheetName;
  try {
    sheetId = await getSheetId(productionReportSpreadsheetId, productionMechanicsSheetName, accessToken);
  } catch {
    sourceName = productionMechanicsLegacySheetName;
    sheetId = await getSheetId(productionReportSpreadsheetId, productionMechanicsLegacySheetName, accessToken);
  }
  const [mechanicsHeaderRows, leadersHeaderRows] = await Promise.all([
    getGoogleSheetRanges(productionReportSpreadsheetId, [`'${sourceName}'!A6:V6`]),
    getGoogleSheetRanges(productionReportSpreadsheetId, ["'Старшие механики и механики'!A6:V6"])
  ]);
  const namesFromHeader = header => {
    const totalIndex = header.findIndex(value => String(value).trim().startsWith("Всего,"));
    return header.slice(1, totalIndex < 0 ? header.length : totalIndex).map(value => String(value || "").trim()).filter(name => name && !/^Резерв\s*\d*$/i.test(name));
  };
  const namesFromRecords = records.flatMap(record => [
    ...splitProductionParticipants(record.operator), String(record.seniorMechanic || "").trim(), String(record.mechanic || "").trim()
  ]).filter(Boolean);
  const people = [...new Set([...namesFromHeader(mechanicsHeaderRows[0]?.[0] ?? []), ...namesFromHeader(leadersHeaderRows[0]?.[0] ?? []), ...namesFromRecords])];
  if (people.length > 18) throw new Error("В листе «Механики» предусмотрено максимум 18 сотрудников; добавьте место в структуре отчёта");
  const columns = [...people, ...Array.from({ length: 18 - people.length }, (_, index) => `Резерв ${index + 1}`)];
  const header = [
    "Дата", ...columns, "Всего, кор.", "Состояние записи", "Примечание",
    "Сотрудник", ...columns, "Всего брака, кг", "Состояние записи", "Примечание",
    "Сотрудник", ...columns, "Средний процент брака", "Состояние записи", "Примечание"
  ];
  if (header.length !== 66) throw new Error("Некорректная структура листа «Механики»");
  const requests = [{ updateSheetProperties: { properties: { sheetId, gridProperties: { columnCount: 66 } }, fields: "gridProperties.columnCount" } }];
  if (sourceName !== productionMechanicsSheetName) requests.push({ updateSheetProperties: { properties: { sheetId, title: productionMechanicsSheetName }, fields: "title" } });
  if (sourceName !== productionMechanicsSheetName) requests.push(
    { copyPaste: { source: { sheetId, startRowIndex: 4, endRowIndex: 1515, startColumnIndex: 0, endColumnIndex: 22 }, destination: { sheetId, startRowIndex: 4, endRowIndex: 1515, startColumnIndex: 22, endColumnIndex: 44 }, pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL" } },
    { copyPaste: { source: { sheetId, startRowIndex: 4, endRowIndex: 1515, startColumnIndex: 0, endColumnIndex: 22 }, destination: { sheetId, startRowIndex: 4, endRowIndex: 1515, startColumnIndex: 44, endColumnIndex: 66 }, pasteType: "PASTE_FORMAT", pasteOrientation: "NORMAL" } }
  );
  requests.push(
    { repeatCell: { range: { sheetId, startRowIndex: 6, endRowIndex: 1515, startColumnIndex: 23, endColumnIndex: 42 }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.000" } } }, fields: "userEnteredFormat.numberFormat" } },
    { repeatCell: { range: { sheetId, startRowIndex: 6, endRowIndex: 1515, startColumnIndex: 45, endColumnIndex: 64 }, cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.0%" } } }, fields: "userEnteredFormat.numberFormat" } }
  );
  if (requests.length) await batchGoogleSheetRequests(productionReportSpreadsheetId, accessToken, requests, "Не удалось подготовить лист «Механики»");
  await setGoogleSheetRanges(productionReportSpreadsheetId, accessToken, [
    { range: "'Механики'!A5:A5", values: [["Выпуск, кор."]] },
    { range: "'Механики'!W5:W5", values: [["Брак, кг"]] },
    { range: "'Механики'!AS5:AS5", values: [["Процент брака, %"]] },
    { range: "'Механики'!A6:BN6", values: [header] }
  ]);
  return { sheetId, people: columns };
}

function productionMassValues(records, specifications) {
  const totals = new Map(productionReportedMasses.map(value => [String(value), 0]));
  records.forEach(record => {
    const mass = productionRecordMass(record, specifications);
    if (!mass) return;
    const key = String(mass.grams);
    if (totals.has(key)) totals.set(key, totals.get(key) + mass.kg);
  });
  return productionReportedMasses.map(value => totals.get(String(value)) || "");
}

function productionRecordMass(record, specifications) {
  const specification = (Array.isArray(specifications) ? specifications : []).find(item =>
    String(item?.line || "").trim() === String(record.catalogLine || "").trim()
    && String(item?.product || "").trim() === String(record.product || "").trim()
    && Number(item?.variant) === Number(record.strength)
  );
  const wetMass = Number(specification?.wetMass);
  const dryMass = Number(specification?.dryMass);
  const grams = wetMass > 0 ? wetMass : dryMass > 0 ? dryMass : 0;
  if (!grams && Number(record.quantity || 0) > 0) throw new Error(`Не найден вес банки для «${record.product}», ${record.strength}`);
  return grams ? { grams, kg: Number(record.quantity || 0) * grams / 1000 } : null;
}

async function updateDailyMechanicsValues(accessToken, rowNumber, headers, records, specifications) {
  const people = headers.slice(1, 19).map(value => String(value || "").trim());
  if (headers.length !== 66 || people.length !== 18 || headers[0] !== "Дата") throw new Error("Изменилась структура листа «Механики»");
  const totals = new Map();
  const add = (name, share) => {
    if (!name || !people.includes(name)) return;
    const current = totals.get(name) ?? { boxes: 0, scrapKg: 0, finishedKg: 0 };
    current.boxes += share.boxes;
    current.scrapKg += share.scrapKg;
    current.finishedKg += share.finishedKg;
    totals.set(name, current);
  };
  let totalBoxes = 0;
  let totalScrapKg = 0;
  let totalFinishedKg = 0;
  records.forEach(record => {
    const finishedKg = productionRecordMass(record, specifications)?.kg || 0;
    const boxes = Number(record.quantity || 0) / 240;
    const scrapKg = Number(record.scrapKg || 0);
    const operators = splitProductionParticipants(record.operator);
    const operatorShare = operators.length ? { boxes: boxes / operators.length, scrapKg: scrapKg / operators.length, finishedKg: finishedKg / operators.length } : null;
    operators.forEach(name => add(name, operatorShare));
    const creditedPeople = new Set(operators);
    [record.seniorMechanic, record.mechanic].map(value => String(value || "").trim()).filter(Boolean).forEach(name => {
      if (creditedPeople.has(name)) return;
      creditedPeople.add(name);
      add(name, { boxes, scrapKg, finishedKg });
    });
    totalBoxes += boxes;
    totalScrapKg += scrapKg;
    totalFinishedKg += finishedKg;
  });
  const values = name => totals.get(name);
  const display = (name, key) => values(name) ? values(name)[key] : "";
  const percent = name => {
    const value = values(name);
    return value && value.finishedKg + value.scrapKg > 0 ? value.scrapKg / (value.finishedKg + value.scrapKg) : "";
  };
  const status = records.length ? "Учтено" : "Нет записи";
  const totalPercent = totalFinishedKg + totalScrapKg > 0 ? totalScrapKg / (totalFinishedKg + totalScrapKg) : "";
  await setGoogleSheetRanges(productionReportSpreadsheetId, accessToken, [
    { range: `'Механики'!B${rowNumber}:S${rowNumber}`, values: [people.map(name => display(name, "boxes"))] },
    { range: `'Механики'!T${rowNumber}:V${rowNumber}`, values: [[records.length ? totalBoxes : "", status, ""]] },
    { range: `'Механики'!X${rowNumber}:AO${rowNumber}`, values: [people.map(name => display(name, "scrapKg"))] },
    { range: `'Механики'!AP${rowNumber}:AR${rowNumber}`, values: [[records.length ? totalScrapKg : "", status, ""]] },
    { range: `'Механики'!AT${rowNumber}:BK${rowNumber}`, values: [people.map(percent)] },
    { range: `'Механики'!BL${rowNumber}:BN${rowNumber}`, values: [[totalPercent, status, ""]] }
  ]);
}

function columnLetter(index) {
  let value = index + 1;
  let text = "";
  while (value) { const remainder = (value - 1) % 26; text = String.fromCharCode(65 + remainder) + text; value = Math.floor((value - 1) / 26); }
  return text;
}

function splitProductionParticipants(value) {
  return String(value || "").split(/\s*(?:;|\||\+)\s*/).map(item => item.trim()).filter(Boolean);
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

async function migratePendingPackagingRecords() {
  const pending = readPackagingPendingRecords();
  if (!pending.length) return false;
  const existingByDate = new Map((await getPackagingSheetRecords()).map(record => [record.date, record]));
  for (const record of pending) {
    const saved = await writePackagingRecordToSheet(record, existingByDate.get(record.date) || null);
    existingByDate.set(record.date, saved);
  }
  writePackagingPendingRecords([]);
  console.log(`Перенесено ранее не отправленных записей расхода упаковки: ${pending.length}`);
  return true;
}

async function migrateAndReconcilePackagingRecords() {
  await migratePendingPackagingRecords();
  const records = await getPackagingSheetRecords();
  for (const record of records) await syncPackagingTargets(record);
  if (records.length) console.log(`Сверены целевые журналы расхода упаковки: ${records.length}`);
}

async function getNextPackagingRowNumber() {
  const records = await getPackagingSheetRecords();
  return Math.max(2, ...records.map(record => record.rowNumber)) + 1;
}

async function getPackagingDateNotes() {
  assertGoogleConfigured();
  const accessToken = await getAccessToken();
  const query = new URLSearchParams({ includeGridData: "true", ranges: `'${packagingSheetName}'!A3:A`, fields: "sheets(data(rowData(values(note))))" });
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
  if (!date && /^(Год|Месяц):/.test(String(row[0] || "").trim())) return null;
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
      const rawValue = String(row[day + 2] || "");
      // Google returns formatted decimals with a comma in the Lithuanian locale.
      // Keep the internal value canonical so 9,5 selects 9.5 rather than the
      // first option in the browser control after a refresh.
      const value = normalizeWorkforceAttendanceValue(rawValue) || rawValue;
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

function workforceVacations(rows, year, personnel = []) {
  const employeeByName = new Map(personnel.map(employee => [String(employee.fullName || "").trim().toLocaleLowerCase(), employee.id]));
  return rows.map(row => {
    const legacy = String(row[7] || "").startsWith("vacation:") && !String(row[8] || "").startsWith("vacation:");
    const offset = legacy ? -1 : 0;
    return {
      id: String(row[8 + offset] || ""), employeeId: String(row[9 + offset] || employeeByName.get(String(row[0] || "").trim().toLocaleLowerCase()) || ""), year, startDate: googleDate(row[3 + offset]), endDate: googleDate(row[4 + offset]),
      days: Number.isFinite(googleNumber(row[5 + offset])) ? googleNumber(row[5 + offset]) : null, status: String(row[6 + offset] || ""), note: String(row[7 + offset] || ""),
      revision: workforceVacationRevision(row, offset), updatedAt: googleDate(row[11 + offset]), updatedBy: String(row[12 + offset] || "")
    };
  }).filter(row => row.id && row.startDate && row.endDate);
}

function workforceVacationRevision(row, offset = 0) {
  return workforceRevision([row[0], row[1 + offset], row[2 + offset], googleDate(row[3 + offset]), googleDate(row[4 + offset]), row[6 + offset], row[7 + offset], row[8 + offset], row[9 + offset], row[10 + offset]]);
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
  // Must use the exact token generated by workforce-api.gs (wfToken_()).
  // The former base64-encoded payload was only an opaque representation, so
  // Apps Script treated every edit of an existing attendance cell as stale.
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("base64url");
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

async function currentCentralShiftState() {
  const shift = readCentralShiftState();
  if (!shift?.active || shift.shiftDate !== todayInVilnius()) return shift;
  try {
    const workforce = await getWorkforceSnapshot();
    const actual = new Map((workforce.attendance || [])
      .filter(item => item.date === shift.shiftDate && item.shiftTeamId === shift.shiftTeamId)
      .map(item => [item.employeeId, item]));
    if (!actual.size) return shift;
    // Google Sheets is the authoritative personnel timesheet. The central
    // record coordinates the active shift, but must never show an older status
    // after an attendance entry was saved from another workstation.
    const attendance = (shift.attendance || []).map(item => {
      const record = actual.get(item.employeeId);
      return record ? {
        ...item,
        status: String(record.value || item.status),
        ...(record.substitutionReason ? {
          isSubstitute: true,
          substitutionReason: record.substitutionReason,
          homeShiftTeamId: record.homeShiftTeamId || item.homeShiftTeamId || ""
        } : {})
      } : item;
    });
    return { ...shift, attendance };
  } catch (error) {
    // A temporary Google failure must not make the shared active shift vanish.
    console.warn(`[shift] Не удалось сверить табель с Google: ${error.message}`);
    return shift;
  }
}

function defaultMachineStatuses() {
  return Object.fromEntries(Array.from({ length: 16 }, (_, index) => [index + 1, "work"]));
}

function normalizeMachineStatuses(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Array.from({ length: 16 }, (_, index) => {
    const machine = index + 1;
    const status = source[machine];
    return [machine, ["work", "attention", "maintenance", "repair", "inactive"].includes(status) ? status : "work"];
  }));
}

function readCentralMachineStatuses() {
  if (!centralMode || !existsSync(centralMachineStatusesPath)) return null;
  try {
    const value = JSON.parse(readFileSync(centralMachineStatusesPath, "utf8"));
    return normalizeMachineStatuses(value?.statuses ?? value);
  } catch {
    return null;
  }
}

function writeCentralMachineStatuses(input, actor) {
  if (!centralMode) {
    const error = new Error("Общее состояние станков доступно только на центральном сервере");
    error.statusCode = 409;
    throw error;
  }
  const statuses = normalizeMachineStatuses(input);
  const directory = dirname(centralMachineStatusesPath);
  mkdirSync(directory, { recursive: true });
  const temporary = `${centralMachineStatusesPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, statuses, updatedAt: new Date().toISOString(), updatedBy: actor.id }, null, 2)}\n`, "utf8");
  renameSync(temporary, centralMachineStatusesPath);
  return statuses;
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
  const mechanic = Object.hasOwn(input, "mechanic")
    ? String(input.mechanic || "").trim()
    : String(mechanicPool[0]?.fullName || "").trim();
  if (!seniorPool.some(person => person.fullName === seniorMechanic)) throw new Error("Старший механик должен быть отмечен присутствующим в табеле.");
  if (mechanic && !mechanicPool.some(person => person.fullName === mechanic)) throw new Error("Механик должен быть отмечен присутствующим в табеле.");
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
