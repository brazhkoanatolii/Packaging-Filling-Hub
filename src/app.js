import { APP_CONFIG, JOURNALS, LANGUAGES, MODULES, SCALES } from "./config/app-config.js";
import { ATTENDANCE_CODES, OFFICE_SCHEDULE, ROLE_LABELS, SUBSTITUTE_ONLY_EMPLOYEE_IDS } from "./config/workforce-config.js";
import { calculateResult, formatDate, formatDateTime } from "./domain/scale-check.js";
import { IndexedDbDataProvider } from "./providers/indexed-db-data-provider.js";
import { GoogleSheetsGatewayProvider } from "./providers/google-sheets-gateway-provider.js";
import { JournalRepository } from "./repositories/journal-repository.js";
import { AuthService } from "./services/auth-service.js";
import { JournalService } from "./services/journal-service.js";
import { ShiftService } from "./services/shift-service.js";
import { CentralShiftGatewayProvider } from "./providers/central-shift-gateway-provider.js";
import { WorkforceService, getScheduleMonth } from "./services/workforce-service.js";
import { WorkforceGatewayProvider } from "./providers/workforce-gateway-provider.js";
import { WorkforceRepository } from "./repositories/workforce-repository.js";
import { WORKSPACE_JOURNALS, WORKFORCE_YEARS } from "./config/workspace-journals.js";
import { ProductSpecificationGatewayProvider } from "./providers/product-specification-gateway-provider.js";
import { ProductSpecificationService } from "./services/product-specification-service.js?v=0.8.1";
import { PRODUCT_SPECIFICATION_SOURCE } from "./config/product-specification-config.js";
import { CycloneGatewayProvider } from "./providers/cyclone-gateway-provider.js";
import { CycloneRepository } from "./repositories/cyclone-repository.js";
import { CycloneService, cycloneStatistics, pendingCycloneCleaningDates } from "./services/cyclone-service.js";
import { ProductionGatewayProvider } from "./providers/production-gateway-provider.js";
import { ProductionRepository } from "./repositories/production-repository.js";
import { ProductionService, LINES as PRODUCTION_LINES, productionFinishedMassKg } from "./services/production-service.js";
import { PackagingGatewayProvider } from "./providers/packaging-gateway-provider.js";
import { PackagingRepository } from "./repositories/packaging-repository.js";
import { PackagingService, PACKAGING_FIELDS } from "./services/packaging-service.js";
import { NonconformityGatewayProvider } from "./providers/nonconformity-gateway-provider.js";
import { NonconformityRepository } from "./repositories/nonconformity-repository.js";
import { NonconformityService } from "./services/nonconformity-service.js";
import { PackagingWarehouseGatewayProvider } from "./providers/packaging-warehouse-gateway-provider.js";
import { PackagingWarehouseRepository } from "./repositories/packaging-warehouse-repository.js";
import { PackagingWarehouseService } from "./services/packaging-warehouse-service.js";

const root = document.querySelector("#app");
const journal = JOURNALS[0];
const SHELL_TEXT = Object.freeze({
  ru: { home: "Главная", online: "Сеть доступна", offline: "Нет интернета", refresh: "Обновить данные", logout: "Выйти", account: "Рабочая учётная запись", test: "Безопасный тестовый режим", theme: "Сменить тему", language: "Сменить язык" },
  en: { home: "Home", online: "Online", offline: "Offline", refresh: "Refresh data", logout: "Sign out", account: "Work account", test: "Safe test mode", theme: "Change theme", language: "Change language" },
  lt: { home: "Pagrindinis", online: "Ryšys yra", offline: "Nėra interneto", refresh: "Atnaujinti duomenis", logout: "Atsijungti", account: "Darbo paskyra", test: "Saugus bandomasis režimas", theme: "Keisti temą", language: "Keisti kalbą" }
});
const state = {
  account: null,
  shift: null,
  legacyShift: null,
  records: [],
  journalError: null,
  operations: [],
  page: "dashboard",
  recordMonth: today().slice(0, 7),
  loading: true,
  syncing: false,
  refreshing: false,
  startupSync: { active: false, completed: 0, total: 8, current: "", failed: [], completedAt: null },
  lastRefresh: null,
  attendanceMonth: today().slice(0, 7),
  attendanceView: "start",
  settingsTab: "overview",
  selectedShiftTeamId: null,
  shiftResponsible: null,
  shiftGuests: [],
  specifications: { specifications: [], source: "loading", cachedAt: null },
  cyclones: { records: [], operations: [], lastReadAt: null, error: null },
  maintenance: { service: { records: [], statistics: {} }, repair: { records: [], statistics: {} }, error: null },
  maintenanceDue: { records: [], source: "loading", cachedAt: null, error: null },
  maintenanceView: "repair",
  production: { records: [], source: "loading", cachedAt: null, error: null },
  productionLoading: false,
  packaging: { records: [], operations: [], lastReadAt: null, error: null },
  packagingEntryItem: "",
  packagingWarehouse: { records: [], summary: [], error: null },
  nonconformities: { records: [], dictionary: { types: [] }, source: "loading", cachedAt: null, error: null },
  nonconformityLoading: false,
  incidents: [],
  update: { checked: false, available: false, installing: false, version: null, message: null },
  cycloneYear: Number(today().slice(0, 4)),
  specificationSelection: { line: "", product: "", variant: "" },
  specificationSearch: "",
  workforce: { personnel: [], shiftTeams: [], attendance: [] },
  language: "ru",
  theme: "light"
};

let store;
let authService;
let shiftService;
let legacyShiftService;
let repository;
let journalService;
let productionRefreshPromise = null;
let refreshFromSourcePromise = null;
let startupSyncPromise = null;
let workforceService;
let workforceRepository;
let productSpecificationService;
let cycloneService;
let productionService;
let packagingService;
let packagingWarehouseService;
let nonconformityService;
let nonconformityRefreshPromise = null;
let workforceActor = {};
let refreshTimer;
let clockTimer;

registerServiceWorker();
bootstrap().catch(error => renderFatalError(error));

async function bootstrap() {
  root.textContent = "Открываем локальные данные…";
  store = await new IndexedDbDataProvider().init();
  const cycloneStore = await new IndexedDbDataProvider("packaging-filling-hub-cyclones").init();
  cycloneService = new CycloneService(new CycloneRepository(cycloneStore,
    new CycloneGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl })));
  state.cyclones = await cycloneService.snapshot();
  const packagingStore = await new IndexedDbDataProvider("packaging-filling-hub-packaging").init();
  packagingService = new PackagingService(new PackagingRepository(packagingStore,
    new PackagingGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl })));
  state.packaging = await packagingService.snapshot();
  packagingWarehouseService = new PackagingWarehouseService(new PackagingWarehouseRepository(
    new PackagingWarehouseGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl })
  ));
  state.incidents = await store.preference("incidentLogRecords", []);
  nonconformityService = new NonconformityService(store, new NonconformityRepository(new NonconformityGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl })));
  state.maintenanceDue = await store.preference("maintenanceDueCache", state.maintenanceDue);
  const remoteProvider = createRemoteProvider();
  repository = new JournalRepository(store, remoteProvider);
  authService = new AuthService(store, {
    allowedRole: APP_CONFIG.workstationRole,
    apiBaseUrl: APP_CONFIG.integration.gatewayBaseUrl,
    remote: APP_CONFIG.centralAuth
  });
  legacyShiftService = new ShiftService(store);
  shiftService = APP_CONFIG.centralAuth
    ? new ShiftService(store, new CentralShiftGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl }))
    : legacyShiftService;
  workforceRepository = APP_CONFIG.integration.mode === "gateway" ? new WorkforceRepository(store,
    new WorkforceGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl, writesEnabled: APP_CONFIG.integration.googleWritesEnabled }),
    () => ({ ...workforceActor, workstationId: APP_CONFIG.workstationId, account: state.account?.id })) : null;
  workforceService = new WorkforceService(store, workforceRepository);
  productSpecificationService = new ProductSpecificationService(store, APP_CONFIG.integration.mode === "gateway"
    ? new ProductSpecificationGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl }) : null);
  productionService = new ProductionService(store, new ProductionRepository(
    new ProductionGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl })
  ));
  journalService = new JournalService(repository, journal, {
    workstationId: APP_CONFIG.workstationId,
    workstationLabel: APP_CONFIG.workstationLabel
  });

  await repository.init();
  state.account = await authService.current();
  state.packagingWarehouse = await packagingWarehouseService.refresh();
  state.legacyShift = APP_CONFIG.centralAuth ? await legacyShiftService.current() : null;
  state.shift = state.account ? await shiftService.current() : null;
  // Do not hold the whole interface on a slow Google request.  A fresh
  // attendance snapshot is still required immediately before each save below.
  state.workforce = await workforceService.snapshot();
  state.specifications = await productSpecificationService.snapshot();
  state.production = await productionService.snapshot();
  state.nonconformities = await nonconformityService.snapshot();
  state.shiftResponsible = await store.preference("sessionShiftResponsible", null);
  state.selectedShiftTeamId = state.shift?.shiftTeamId ?? scheduledTeam()?.id ?? state.workforce.shiftTeams[0]?.id ?? null;
  state.language = normalizeLanguage(await store.preference("interfaceLanguage", "ru"));
  state.theme = (await store.preference("interfaceTheme", "light")) === "dark" ? "dark" : "light";
  await reloadLocalState();
  state.loading = false;
  state.lastRefresh = new Date().toISOString();
  render();
  bindGlobalEvents();
  startAutomaticRefresh();
  startClock();
  registerServiceWorker();
  void checkForUpdate();
  if (navigator.onLine && (!APP_CONFIG.centralAuth || state.account)) void startStartupJournalSync().finally(() => syncInBackground());
}

function createRemoteProvider() {
  return new GoogleSheetsGatewayProvider({
    baseUrl: APP_CONFIG.integration.gatewayBaseUrl,
    writesEnabled: APP_CONFIG.integration.googleWritesEnabled
  });
}

function bindGlobalEvents() {
  root.addEventListener("click", handleClick);
  root.addEventListener("input", handleInput);
  root.addEventListener("change", handleChange);
  root.addEventListener("submit", handleSubmit);
  window.addEventListener("keydown", event => {
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "F5") {
      event.preventDefault();
      refreshFromSource();
    }
  });
  window.addEventListener("online", async () => {
    render();
    toast("Интернет появился. Отправляем сохранённые записи…", "success");
    await syncRecords({ silent: true });
  });
  window.addEventListener("offline", () => {
    render();
    toast("Нет интернета. Новые записи сохранятся на этом компьютере.", "warning");
  });
}

function handleInput(event) {
  if (event.target.matches("[data-personnel-filter]")) filterPersonnelCards();
  if (event.target.matches("[data-specification-search]")) {
    const cursor = event.target.selectionStart ?? event.target.value.length;
    state.specificationSearch = event.target.value;
    render();
    const search = root.querySelector("[data-specification-search]");
    if (search) { search.focus(); search.setSelectionRange(cursor, cursor); }
  }
  if (event.target.matches("[data-attendance-status]")) {
    updateAttendanceCounter(event.target.form);
    updateShiftLeadershipOptions(event.target.form);
  }
}

async function handleChange(event) {
  if (event.target.matches("[data-attendance-status]")) {
    updateAttendanceCounter(event.target.form);
    updateShiftLeadershipOptions(event.target.form);
    return;
  }
  if (event.target.matches("[data-specification-select]")) {
    const field = event.target.dataset.specificationSelect;
    const nextSelection = { ...state.specificationSelection, [field]: event.target.value };
    state.specificationSelection = normalizeSpecificationSelection(
      state.specifications?.specifications ?? [],
      nextSelection,
      field
    );
    render();
    return;
  }

  if (event.target.matches("[data-cyclone-year]")) {
    state.cycloneYear = Number(event.target.value);
    render();
    return;
  }
  if (event.target.matches("[data-record-month]")) {
    state.recordMonth = event.target.value;
    render();
    return;
  }
  if (event.target.matches("[data-login-responsible]")) {
    const otherField = event.target.form?.querySelector("[data-login-responsible-other]");
    if (otherField) otherField.hidden = event.target.value !== "other";
    return;
  }
  if (event.target.matches("[data-start-team]")) {
    state.selectedShiftTeamId = event.target.value;
    state.shiftGuests = [];
    render();
    return;
  }
  if (event.target.matches("[data-timesheet-cell]")) {
    const select = event.target;
    try {
      await withWorkforceActor(() => workforceService.saveAttendance({
        date: select.dataset.date,
        shiftTeamId: select.dataset.shiftTeamId,
        employeeId: select.dataset.employeeId,
        value: select.value,
        overtime: select.dataset.overtime === "true"
      }));
      state.workforce = await workforceService.snapshot();
      render();
      toast("Табель сохранён.", "success");
      sendWorkforceInBackground();
    } catch (error) {
      toast(error.message || "Не удалось сохранить табель.", "error");
    }
  }
}

async function handleSubmit(event) {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === "packaging-quick") {
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await packagingService.add({ date: today(), ...data }, state.account);
      state.packaging = await packagingService.snapshot();
      state.packagingEntryItem = String(data.item || "");
      render();
      focusPackagingQuantity();
      toast("Расход сохранён. Итог за сегодня обновлён.", "success");
      // Не только перечитываем журнал: сразу отправляем новую локальную запись.
      // При ошибке сервис сохранит её в очереди для следующей попытки.
      if (navigator.onLine) {
        void packagingService.sync().then((snapshot) => {
          state.packaging = snapshot;
          render();
        });
      }
    } catch (error) {
      showFormError(form, error.message || "Не удалось сохранить расход.");
      submit.disabled = false;
    }
    return;
  }
  if (form.dataset.form === "login") {
    const data = new FormData(form);
    try {
      const accountId = String(data.get("accountId") || "");
      state.account = await authService.login(accountId, String(data.get("password") || ""));
      state.shiftResponsible = null;
      state.shift = await shiftService.current();
      state.page = "dashboard";
      render();
      if (navigator.onLine) void startStartupJournalSync().finally(() => syncInBackground());
    } catch (error) {
      const panel = form.querySelector("[data-login-error]");
      if (panel) { panel.textContent = error.message || "Не удалось выполнить вход"; panel.hidden = false; }
    }
    return;
  }
  if (form.dataset.form === "password-change") {
    if (state.account?.role !== "manager") return;
    const data = new FormData(form);
    const nextPassword = String(data.get("nextPassword") || "");
    if (nextPassword !== String(data.get("repeatPassword") || "")) {
      toast("Новый пароль и повтор не совпадают.", "error");
      return;
    }
    try {
      await authService.changePassword(String(data.get("accountId") || ""), String(data.get("currentPassword") || ""), nextPassword);
      form.reset();
      toast(APP_CONFIG.centralAuth ? "Пароль учётной записи изменён на центральном сервере." : "Пароль учётной записи изменён на этом компьютере.", "success");
    } catch (error) {
      toast(error.message || "Не удалось изменить пароль.", "error");
    }
    return;
  }
  if (form.dataset.form === "shift-settings") {
    try {
      const data = Object.fromEntries(new FormData(form));
      await withWorkforceActor(() => workforceService.saveShiftTeam(data));
      state.workforce = await workforceService.snapshot();
      render();
      toast("Настройки смены сохранены.", "success");
      sendWorkforceInBackground();
    } catch (error) {
      toast(error.message || "Не удалось сохранить настройки смены.", "error");
    }
    return;
  }
  if (form.dataset.form !== "shift-attendance") return;
  const data = new FormData(form);
  const teamId = String(data.get("shiftTeamId") || state.selectedShiftTeamId || "");
  const members = shiftStartMembers(teamId);
  const attendance = members.map(employee => ({
    employeeId: employee.id,
    status: String(data.get(`attendance-${employee.id}`) || ""),
    isSubstitute: employee.isSubstitute === true,
    substitutionReason: employee.substitutionReason || "",
    homeShiftTeamId: employee.homeShiftTeamId || ""
  }));
  if (attendance.some(item => !item.status)) {
    showInlineFormError(form, "Отметьте каждого сотрудника");
    return;
  }
  try {
    const changes = attendanceChanges(teamId, attendance);
    if (changes.length && !window.confirm(attendanceChangeMessage(changes))) return;
    if (isCurrentSharedShift()) {
      state.shift = await shiftService.updateAttendance(attendance);
      await saveShiftAttendanceToTimesheet(teamId, attendance, changes);
      state.shiftGuests = [];
      state.workforce = await workforceService.snapshot();
      render();
      toast("Табель смены обновлён.", "success");
      return;
    }
    const leadership = shiftLeadershipFromForm(form, teamId);
    state.shift = await shiftService.start({
      supervisor: leadership.seniorMechanic,
      seniorMechanic: leadership.seniorMechanic,
      mechanic: leadership.mechanic,
      shiftNumber: 1,
      shiftTeamId: teamId,
      attendance
    });
    await saveShiftAttendanceToTimesheet(teamId, attendance, changes);
    state.shiftGuests = [];
    state.workforce = await workforceService.snapshot();
    state.page = state.shift.requiresScaleControl ? "journals" : "dashboard";
    render();
    if (state.shift.requiresScaleControl) {
      toast("Табель сохранён. Теперь выполните контроль весов.", "success");
      setTimeout(() => openScaleWalkDialog(), 0);
    } else {
      toast("Вторая смена начата. Контроль весов не требуется.", "success");
    }
  } catch (error) {
    showInlineFormError(form, error.message || "Не удалось начать смену");
  }
}

async function handleClick(event) {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const { action, id, page, accountId, item } = actionElement.dataset;

  try {
    if (action === "new-cyclone") { openCycloneDialog(); return; }
    if (action === "add-incident") { openIncidentDialog(); return; }
    if (action === "delete-incident") {
      if (state.account?.role !== "manager") throw new Error("Удалять записи может только начальник участка.");
      const record = state.incidents.find(item => item.id === id);
      if (!record || !window.confirm(`Удалить инцидент от ${formatDate(record.date)}?`)) return;
      state.incidents = state.incidents.filter(item => item.id !== id);
      await store.setPreference("incidentLogRecords", state.incidents);
      render(); toast("Инцидент удалён из локального журнала.", "success"); return;
    }
    if (action === "add-nonconformity") { openNonconformityDialog(); return; }
    if (action === "edit-nonconformity") { const record = state.nonconformities.records.find(item => item.id === id); if (record) openNonconformityDialog(record); return; }
    if (action === "delete-nonconformity") {
      const record = state.nonconformities.records.find(item => item.id === id);
      if (!record || !window.confirm(`Удалить несоответствие «${record.type}» от ${formatDate(record.date)}?`)) return;
      await nonconformityService.remove(record.id); await refreshNonconformities(); render(); toast("Запись удалена из журнала.", "success"); return;
    }
    if (action === "refresh-nonconformities") {
      if (state.nonconformityLoading) return; state.nonconformityLoading = true; render();
      try { await refreshNonconformities(); toast(state.nonconformities.error || "Журнал несоответствий обновлён.", state.nonconformities.error ? "warning" : "success"); }
      finally { state.nonconformityLoading = false; render(); }
      return;
    }
    if (action === "new-packaging") { openPackagingDialog(); return; }
    if (action === "select-packaging-item") {
      state.packagingEntryItem = String(item || "");
      render();
      focusPackagingQuantity();
      return;
    }
    if (action === "edit-packaging") { const record = state.packaging.records.find(item => item.id === id); if (record) openPackagingEditDialog(record); return; }
    if (action === "add-packaging-stock") { openPackagingWarehouseDialog(); return; }
    if (action === "refresh-packaging-warehouse") { await refreshPackagingWarehouse(); render(); toast(state.packagingWarehouse.error || "Склад упаковки обновлён", state.packagingWarehouse.error ? "warning" : "success"); return; }
    if (action === "edit-packaging-stock") { const record = state.packagingWarehouse.records.find(item => item.id === id); if (record) openPackagingWarehouseDialog(record); return; }
    if (action === "delete-packaging-stock") {
      if (state.account?.role !== "manager") throw new Error("Удалять движения склада может только начальник участка.");
      const record = state.packagingWarehouse.records.find(item => item.id === id);
      if (!record || !window.confirm(`Удалить движение «${record.item}» от ${formatDate(record.date)}?`)) return;
      state.packagingWarehouse = await packagingWarehouseService.remove(id);
      render(); toast("Движение удалено из журнала склада.", "success"); return;
    }
    if (action === "delete-packaging") { const record = state.packaging.records.find(item => item.id === id); if (record && window.confirm(`Удалить весь расход упаковки за ${formatDate(record.date)}?`)) { await packagingService.remove(record); state.packaging = await packagingService.snapshot(); render(); if (navigator.onLine) void packagingService.sync().then(snapshot => { state.packaging = snapshot; render(); }); } return; }
    if (action === "sync-packaging") {
      state.packaging = await packagingService.sync(); render();
      toast(state.packaging.error || "Журнал расхода упаковки обновлён", state.packaging.error ? "warning" : "success");
      return;
    }
    if (action === "sync-cyclones") {
      state.cyclones = await cycloneService.sync();
      render();
      toast(state.cyclones.error || "Журнал очистки циклонов обновлён", state.cyclones.error ? "warning" : "success");
      return;
    }
    if (action === "login") {
      state.account = await authService.login(accountId);
      state.page = "dashboard";
      render();
      return;
    }
    if (action === "logout") {
      await authService.logout();
      await store.setPreference("sessionShiftResponsible", null);
      state.account = null;
      state.shift = null;
      state.shiftResponsible = null;
      render();
      return;
    }
    if (action === "navigate") {
      state.page = page;
      render();
      if (page === "maintenance") {
        await refreshMaintenance();
        render();
      }
      if (page === "production") {
        await refreshProduction();
        render();
      }
      if (page === "packaging") {
        await refreshPackaging();
        render();
      }
      if (page === "packaging-warehouse") {
        await refreshPackagingWarehouse();
        render();
      }
      if (page === "nonconformities") {
        await refreshNonconformities();
        render();
      }
      return;
    }
    if (action === "new-record") {
      if (state.account.role === "senior" && !isCurrentSharedShift()) {
        toast("Сначала нажмите «Начать смену».", "warning");
        return;
      }
      openRecordDialog();
      return;
    }
    if (action === "start-scale-walk") {
      if (state.account.role === "senior" && !isCurrentSharedShift()) {
        toast("Сначала нажмите «Начать смену».", "warning");
        return;
      }
      openScaleWalkDialog();
      return;
    }
    if (action === "edit-record") {
      openRecordDialog(id);
      return;
    }
    if (action === "annul-record") {
      openAnnulDialog(id);
      return;
    }
    if (action === "start-shift") {
      state.page = "attendance";
      render();
      return;
    }
    if (action === "end-shift") {
      const shift = state.shift;
      const team = teamLabel(shift?.shiftTeamId);
      if (!window.confirm(`Завершить общую смену ${team}?\n\nЭто закроет только общий статус смены на центральном сервере. Уже сохранённые отметки табеля и записи Google не будут удалены или изменены.`)) return;
      await shiftService.end();
      state.shift = await shiftService.current();
      render();
      toast("Смена завершена.", "success");
      return;
    }
    if (action === "archive-legacy-shift") {
      await archiveLegacyShift();
      render();
      toast("Локальная незавершённая смена сохранена в архиве. Отметки табеля не менялись.", "success");
      return;
    }
    if (action === "refresh-and-reload") {
      if (state.page === "dashboard") {
        await startStartupJournalSync();
      } else {
        await refreshFromSource();
      }
      // Once Google data has been read, reload the interface just as F5 would.
      // This also makes sure that the newest interface files are displayed.
      window.location.reload();
      return;
    }
    if (action === "refresh") {
      await refreshFromSource();
      return;
    }
    if (action === "sync-all-journals") {
      await startStartupJournalSync();
      return;
    }
    if (action === "check-update") {
      await checkForUpdate({ announce: true });
      return;
    }
    if (action === "install-update") {
      if (!state.update.available || state.update.installing) return;
      state.update.installing = true;
      render();
      const response = await fetch(`${APP_CONFIG.integration.gatewayBaseUrl}/api/update`, { method: "POST", headers: { Accept: "application/json" } });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Не удалось запустить обновление");
      toast("Обновление скачивается и проверяется. Ожидаем запуск новой версии…", "success");
      await waitForInstalledUpdate(result.version);
      return;
    }
    if (action === "refresh-maintenance") {
      await refreshMaintenance();
      render();
      return;
    }
    if (action === "refresh-production") {
      if (state.productionLoading) return;
      state.productionLoading = true;
      render();
      try {
        await refreshProduction();
        toast(state.production.error || "Журнал продукции обновлён из Google Sheets.", state.production.error ? "warning" : "success");
      } finally {
        state.productionLoading = false;
        render();
      }
      return;
    }
    if (action === "add-production") { openProductionDialog(); return; }
    if (action === "edit-production") {
      const record = state.production.records.find(item => item.id === id);
      if (record) openProductionDialog(record);
      return;
    }
    if (action === "delete-production") {
      const record = state.production.records.find(item => item.id === id);
      if (!record || !window.confirm(`Удалить запись «${record.product}» (${formatDate(record.date)} ${record.time}) из обоих листов журнала?`)) return;
      try {
        await productionService.remove(record.id);
        await refreshProduction(); render();
        toast("Запись удалена из обоих листов журнала.", "success");
      } catch (error) { toast(error.message, "warning"); }
      return;
    }
    if (action === "refresh-specifications") {
      state.specifications = await productSpecificationService.initialize();
      render();
      toast(state.specifications.error || "Каталог продуктов обновлён из Google Sheets.", state.specifications.error ? "warning" : "success");
      return;
    }
    if (action === "select-specification") {
      const specification = state.specifications.specifications.find(item => item.id === id);
      if (!specification) return;
      state.specificationSelection = { line: specification.line, product: specification.product, variant: String(specification.variant) };
      render();
      return;
    }
    if (action === "add-maintenance-service") { openMaintenanceDialog("service"); return; }
    if (action === "add-maintenance-repair") { openMaintenanceDialog("repair"); return; }
    if (action === "maintenance-view") {
      state.maintenanceView = actionElement.dataset.view || "repair";
      render();
      return;
    }
    if (action === "sync") {
      await syncRecords();
      return;
    }
    if (action === "attendance-month") {
      state.attendanceMonth = shiftMonth(state.attendanceMonth, Number(actionElement.dataset.offset || 0));
      render();
      return;
    }
    if (action === "attendance-view") {
      state.attendanceView = actionElement.dataset.view;
      render();
      return;
    }
    if (action === "settings-tab") {
      state.settingsTab = actionElement.dataset.tab;
      render();
      return;
    }
    if (["add-employee", "edit-employee", "toggle-employee", "add-specification", "edit-specification", "delete-specification"].includes(action) && state.account.role !== "manager") {
      toast("Редактировать справочник персонала может только начальник участка.", "error");
      return;
    }
    if (action === "add-shift-guest") {
      openShiftGuestDialog();
      return;
    }
    if (action === "remove-shift-guest") {
      if (state.shift?.active && state.shift.attendance?.some(item => item.employeeId === id && item.isSubstitute)) {
        toast("Подменный выход уже сохранён. Для исправления обратитесь к начальнику участка.", "warning");
        return;
      }
      state.shiftGuests = state.shiftGuests.filter(item => item.employeeId !== id);
      render();
      return;
    }
    if (action === "add-employee") {
      openEmployeeDialog();
      return;
    }
    if (action === "edit-employee") {
      openEmployeeDialog(id);
      return;
    }
    if (action === "toggle-employee") {
      await withWorkforceActor(() => workforceService.toggleEmployee(id));
      state.workforce = await workforceService.snapshot();
      render();
      toast("Статус сотрудника изменён.", "success");
      sendWorkforceInBackground();
      return;
    }
    if (action === "add-specification") {
      openSpecificationDialog();
      return;
    }
    if (action === "edit-specification") {
      openSpecificationDialog(id);
      return;
    }
    if (action === "delete-specification") {
      await deleteSpecification(id);
      return;
    }
    if (action === "workforce-accept-remote") {
      await workforceRepository?.acceptRemote(id);
      state.workforce = await workforceService.snapshot(); render(); return;
    }
    if (action === "workforce-retry-missing-attendance") {
      await workforceRepository?.retryMissingAttendance(id);
      state.workforce = await workforceService.snapshot();
      render();
      toast("Строка табеля проверена и отправлена в Google.", "success");
      return;
    }
    if (action === "edit-vacation" || action === "add-vacation") {
      if (state.account.role !== "manager") { toast("График отпусков доступен для редактирования только начальнику участка.", "error"); return; }
      openVacationDialog(action === "edit-vacation" ? id : null); return;
    }
    if (action === "cycle-language") {
      const index = LANGUAGES.findIndex(language => language.code === state.language);
      state.language = LANGUAGES[(index + 1) % LANGUAGES.length].code;
      await store.setPreference("interfaceLanguage", state.language);
      render();
      startClock();
      return;
    }
    if (action === "toggle-theme") {
      state.theme = state.theme === "dark" ? "light" : "dark";
      await store.setPreference("interfaceTheme", state.theme);
      render();
      startClock();
      return;
    }
    if (action === "close-dialog") {
      actionElement.closest("dialog")?.close();
      return;
    }

  } catch (error) {
    toast(error.message || "Не удалось выполнить действие", "error");
  }
}

async function reloadLocalState() {
  state.records = await journalService.list();
  state.operations = await repository.pendingOperations();
}

async function syncWorkforce() {
  if (!workforceRepository) return state.workforce;
  state.workforce = await workforceRepository.sync();
  return state.workforce;
}

async function refreshSpecifications() {
  state.specifications = await productSpecificationService.initialize();
  return state.specifications;
}

async function refreshCyclones(sync = false) {
  state.cyclones = sync ? await cycloneService.sync() : await cycloneService.refresh();
  return state.cyclones;
}

async function refreshPackaging(sync = false) {
  state.packaging = sync ? await packagingService.sync() : await packagingService.refresh();
  return state.packaging;
}

async function refreshPackagingWarehouse() {
  state.packagingWarehouse = await packagingWarehouseService.refresh();
  return state.packagingWarehouse;
}

async function refreshNonconformities() {
  if (!nonconformityRefreshPromise) {
    nonconformityRefreshPromise = nonconformityService.refresh()
      .then(snapshot => { state.nonconformities = snapshot; return snapshot; })
      .finally(() => { nonconformityRefreshPromise = null; });
  }
  return nonconformityRefreshPromise;
}

async function refreshMaintenance() {
  try {
    const response = await fetch(`${APP_CONFIG.integration.gatewayBaseUrl}/api/maintenance`, { headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.message || "Не удалось загрузить журналы ремонта и ТО");
    state.maintenance = { service: payload.service ?? state.maintenance.service, repair: payload.repair ?? state.maintenance.repair, error: null };
  } catch (error) { state.maintenance = { ...state.maintenance, error: error.message }; }
  return state.maintenance;
}

async function refreshProduction() {
  if (!productionRefreshPromise) {
    productionRefreshPromise = productionService.refresh()
      .then(snapshot => {
        state.production = snapshot;
        return snapshot;
      })
      .finally(() => { productionRefreshPromise = null; });
  }
  return productionRefreshPromise;
}

async function refreshFromSource({ silent = false } = {}) {
  if (!navigator.onLine) {
    if (!silent) toast("Нет интернета. Показаны последние сохранённые данные.", "warning");
    return;
  }
  if (refreshFromSourcePromise) {
    if (!silent) toast("Обновление уже выполняется. Можно продолжать работу.", "warning");
    return refreshFromSourcePromise;
  }
  state.refreshing = true;
  render();
  refreshFromSourcePromise = refreshCurrentPage()
    .then(() => {
      state.lastRefresh = new Date().toISOString();
      if (!silent) toast("Текущий раздел обновлён.", "success");
    })
    .catch(error => {
      if (!silent) toast(error.message || "Не удалось обновить текущий раздел.", "warning");
    })
    .finally(() => {
      state.refreshing = false;
      refreshFromSourcePromise = null;
      render();
    });
  return refreshFromSourcePromise;
}

async function refreshMaintenanceDue() {
  try {
    const response = await fetch(`${APP_CONFIG.integration.gatewayBaseUrl}/api/maintenance-due`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.records)) throw new Error(payload?.message || "Не удалось загрузить сводку ТО");
    state.maintenanceDue = { records: payload.records, source: "google", cachedAt: new Date().toISOString(), error: null };
    await store.setPreference("maintenanceDueCache", state.maintenanceDue);
  } catch (error) {
    const cached = await store.preference("maintenanceDueCache", state.maintenanceDue);
    state.maintenanceDue = { ...cached, error: error.message || "Не удалось загрузить сводку ТО" };
  }
  return state.maintenanceDue;
}

async function startStartupJournalSync() {
  if (startupSyncPromise) return startupSyncPromise;
  const tasks = [
    ["Табель и персонал", async () => { state.workforce = workforceRepository ? await workforceRepository.refresh() : await workforceService.snapshot(); }],
    ["Контроль весов", async () => { await repository.refresh(); await reloadLocalState(); }],
    ["Спецификации продуктов", async () => { await refreshSpecifications(); if (state.specifications.error) throw new Error(state.specifications.error); }],
    ["Учёт продукции и брака", async () => { await refreshProduction(); if (state.production.error) throw new Error(state.production.error); }],
    ["Расход упаковки", async () => { state.packaging = await packagingService.sync(); if (state.packaging.error) throw new Error(state.packaging.error); }],
    ["Ремонт и ТО", async () => { await refreshMaintenance(); if (state.maintenance.error) throw new Error(state.maintenance.error); }],
    ["Сводка ТО", async () => { await refreshMaintenanceDue(); if (state.maintenanceDue.error) throw new Error(state.maintenanceDue.error); }],
    ["Очистка циклонов", async () => { await refreshCyclones(); if (state.cyclones.error) throw new Error(state.cyclones.error); }]
  ];
  state.startupSync = { active: true, completed: 0, total: tasks.length, current: tasks[0][0], failed: [], completedAt: null };
  render();
  startupSyncPromise = (async () => {
    for (const [label, load] of tasks) {
      state.startupSync.current = label;
      render();
      try { await load(); }
      catch { state.startupSync.failed.push(label); }
      state.startupSync.completed += 1;
    }
    state.startupSync.active = false;
    state.startupSync.current = "";
    state.startupSync.completedAt = new Date().toISOString();
    state.lastRefresh = state.startupSync.completedAt;
    render();
  })().finally(() => { startupSyncPromise = null; });
  return startupSyncPromise;
}

async function refreshCurrentPage() {
  if (state.page === "journals") {
    await repository.refresh();
    state.journalError = null;
    await reloadLocalState();
    return;
  }
  if (state.page === "attendance" || state.page === "personnel" || state.page === "vacations" || state.page === "settings") {
    state.workforce = workforceRepository ? await workforceRepository.refresh() : await workforceService.snapshot();
    return;
  }
  if (state.page === "cyclones") { await refreshCyclones(); return; }
  if (state.page === "packaging") { await refreshPackaging(); return; }
  if (state.page === "packaging-warehouse") { await refreshPackagingWarehouse(); return; }
  if (state.page === "nonconformities") { await refreshNonconformities(); return; }
  if (state.page === "maintenance") { await refreshMaintenance(); return; }
  if (state.page === "production") { await refreshProduction(); return; }
  if (state.page === "specifications") { await refreshSpecifications(); return; }
  await reloadLocalState();
}

async function checkForUpdate({ announce = false } = {}) {
  try {
    const response = await fetch(`${APP_CONFIG.integration.gatewayBaseUrl}/api/update-status`, { headers: { Accept: "application/json" } });
    const result = await response.json();
    state.update.checked = true;
    state.update.available = response.ok && result.available === true;
    state.update.version = state.update.available ? result.version : null;
    state.update.message = state.update.available ? `Доступна версия ${result.version}` : "Новая версия не найдена";
    if (state.update.available && announce) toast(`Доступна версия ${result.version}. Нажмите «Обновить программу» в верхней панели.`, "warning");
    if (!state.update.available && announce) toast(state.update.message, "success");
    render();
  } catch {
    state.update.checked = true;
    state.update.available = false;
    state.update.message = "Не удалось проверить обновление";
    if (announce) toast(state.update.message, "warning");
    render();
  }
}

async function waitForInstalledUpdate(expectedVersion) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 1_000));
    try {
      const response = await fetch(`${APP_CONFIG.integration.gatewayBaseUrl}/api/health`, { cache: "no-store" });
      const health = await response.json();
      if (response.ok && health.ok && health.version === expectedVersion) {
        window.location.reload();
        return;
      }
    } catch {
      // The old gateway is expected to be briefly unavailable while it is replaced.
    }
  }
  state.update.installing = false;
  render();
  toast("Файлы обновления получены, но новая версия не запустилась. Перезапустите программу и сообщите, если версия не изменилась.", "warning");
}

async function syncRecords({ silent = false } = {}) {
  if (state.syncing) return;
  if (!navigator.onLine) {
    if (!silent) toast("Нет интернета. Записи останутся в очереди.", "warning");
    return;
  }
  state.syncing = true;
  render();
  try {
    const checks = await Promise.allSettled([repository.sync(), syncWorkforce(), packagingService?.sync(), cycloneService?.sync()]);
    const result = checks[0].status === "fulfilled" ? checks[0].value : { sent: 0, conflicts: 0 };
    if (checks[2]?.status === "fulfilled" && checks[2].value) state.packaging = checks[2].value;
    if (checks[3]?.status === "fulfilled" && checks[3].value) state.cyclones = checks[3].value;
    const failed = checks.find(item => item.status === "rejected");
    await reloadLocalState();
    state.lastRefresh = new Date().toISOString();
    render();
    if (!silent) {
      if (failed) toast(failed.reason.message, "warning");
      else if (result.conflicts) toast(`Обнаружено конфликтов: ${result.conflicts}.`, "warning");
      else if (result.sent) toast(`Отправлено записей: ${result.sent}.`, "success");
      else toast("Очередь синхронизации пуста.", "success");
    }
  } finally {
    state.syncing = false;
    render();
  }
}

function syncInBackground() {
  if (!navigator.onLine) return;
  // All forms have already committed their data to IndexedDB.  Do not keep a
  // completed form waiting on Google; one running sync is shared by later saves.
  void syncRecords({ silent: true });
}

function startAutomaticRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (!state.account || document.hidden || !navigator.onLine) return;
    syncInBackground();
  }, APP_CONFIG.refreshIntervalMs);
}

function setBusy(value) {
  state.loading = value;
  document.body.classList.toggle("is-busy", value);
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.lang = state.language;
  document.title = state.account
    ? `${pageTitle()} — ${APP_CONFIG.name}`
    : APP_CONFIG.name;
  root.innerHTML = state.account ? renderApplication() : renderLogin();
}

function renderLogin() {
  const accounts = authService.availableAccounts();
  const productionMode = APP_CONFIG.integration.mode === "gateway";
  return `
    <main class="login-shell">
      <section class="login-brand" aria-labelledby="login-title">
        <div class="brand-emblem large" aria-hidden="true">${brandIcon()}</div>
        <p class="eyebrow">Электронные журналы производства</p>
        <h1 id="login-title">Packaging-<br>Filling-Hub</h1>
        <p class="login-lead">Заполняйте журналы быстро, продолжайте работу без интернета и не переносите данные вручную.</p>
        <ul class="feature-list">
          <li><span>✓</span> Google Sheets остаётся главным источником</li>
          <li><span>✓</span> Автоматическая отправка при появлении сети</li>
          <li><span>✓</span> Автор каждой записи сохраняется</li>
        </ul>
      </section>
      <section class="login-panel" aria-label="Выбор учётной записи">
        <div class="panel-heading">
          <span class="mode-pill">${productionMode ? escapeHtml(APP_CONFIG.workstationLabel || "Рабочее место") : "Тестовый режим"}</span>
          <h2>Кто работает?</h2>
          <p>${APP_CONFIG.centralAuth ? "Выберите рабочую учётную запись. Права определяются центральным сервером." : APP_CONFIG.workstationRole ? "Вход разрешён только для роли, назначенной этому компьютеру." : "Выберите рабочую учётную запись."}</p>
        </div>
        <div class="account-list">
          ${accounts.map(account => `
            <form class="account-card" data-form="login">
              <input type="hidden" name="accountId" value="${account.id}">
              <span class="account-icon">${account.role === "manager" ? "НУ" : "СМ"}</span>
              <span class="account-copy">
                <strong>${account.title}</strong>
                <small>${account.description}</small>
                <label class="login-password"><span>Пароль</span><input name="password" type="password" inputmode="numeric" minlength="4" required autocomplete="current-password" placeholder="Введите пароль"></label>
                <small class="login-error" data-login-error hidden></small>
              </span>
              <button class="account-login-button" type="submit">Войти</button>
            </form>
          `).join("")}
        </div>
        <p class="privacy-note">${APP_CONFIG.centralAuth ? "Пароли хранятся только на центральном сервере. Администрация меняет их в «Настройках»." : "Первый пароль для каждой учётной записи: <b>0000</b>. Администрация меняет пароли в «Настройках"} ${APP_CONFIG.integration.mode === "demo" ? "Рабочие данные этого прототипа хранятся только в браузере и не отправляются в Google." : "Данные синхронизируются через защищённый шлюз участка."}</p>
      </section>
    </main>`;
}

function renderApplication() {
  const language = LANGUAGES.find(item => item.code === state.language) ?? LANGUAGES[0];
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-row">
          <div class="brand-emblem">${brandIcon()}</div>
          <div><strong>Packaging-</strong><strong>Filling-Hub</strong><small class="company-name">UAB Kordula</small></div>
        </div>
        <nav class="main-nav" aria-label="Основное меню">
          ${modulesForAccount().map(module => navItem(module.id, moduleLabel(module), moduleIcon(module.icon))).join("")}
        </nav>
        <div class="sidebar-footer">
          <div class="signed-user">
            <span class="avatar">${state.account.role === "manager" ? "НУ" : "СМ"}</span>
            <span><strong>${state.account.title}</strong><small>${escapeHtml(APP_CONFIG.workstationLabel || ui("account"))}</small><small class="app-version">Версия ${escapeHtml(APP_CONFIG.version)}</small></span>
          </div>
          <button class="text-button" data-action="logout">${ui("logout")}</button>
        </div>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <div class="topbar-title"><p class="eyebrow">${APP_CONFIG.name}</p><h1>${pageTitle()}</h1></div>
          <div class="topbar-actions">
            <time class="clock-panel" data-clock datetime=""><span data-clock-date>${headerDate()}</span><strong data-clock-time>${headerTime()}</strong></time>
            <button class="utility-button language-button" data-action="cycle-language" title="${ui("language")}" aria-label="${ui("language")}"><b>${language.label}</b><span>${language.name}</span></button>
            <button class="icon-button theme-button" data-action="toggle-theme" title="${ui("theme")}" aria-label="${ui("theme")}">${state.theme === "dark" ? sunIcon() : moonIcon()}</button>
            ${connectionBadge()}
            <button class="utility-button ${state.update.available ? "update-available" : ""}" data-action="${state.update.available ? "install-update" : "check-update"}" title="${escapeHtml(state.update.message || "Проверить обновление программы")}" ${state.update.installing ? "disabled" : ""}>${state.update.installing ? "Обновляем…" : state.update.available ? `Обновить ${escapeHtml(state.update.version)}` : "Обновить программу"}</button>
            <button class="icon-button" data-action="refresh-and-reload" title="Обновить данные и экран (как F5)" aria-label="Обновить данные и экран" ${(state.refreshing || state.startupSync.active) ? "disabled" : ""}>${(state.refreshing || state.startupSync.active) ? "…" : refreshIcon()}</button>
          </div>
        </header>

        ${renderPreparationReminder()}
        <section class="page-content">
          ${renderWorkforceConnection()}
          ${state.journalError ? `<p class="form-error" role="status">Контроль весов: ${escapeHtml(state.journalError)}. Показаны сохранённые на этом компьютере записи.</p>` : ""}
          ${renderPage()}
        </section>
      </main>
      ${renderMobileNav()}
    </div>
    <div id="toast-region" class="toast-region" aria-live="assertive"></div>`;
}

function renderWorkforceConnection() {
  if (!workforceRepository) return "";
  const pending = state.workforce?.pending ?? [];
  const conflicts = pending.filter(item => item.status === "conflict" || item.status === "error");
  if (!pending.length && !state.workforce?.syncError) return "";
  const message = state.workforce?.syncError
    ? `Журналы персонала: ${state.workforce.syncError}`
    : conflicts.length
      ? `Журналы персонала: ${conflicts.length} измен. требуют внимания.`
      : `Журналы персонала: ожидают отправки ${pending.length} измен.`;
  return `<div class="workforce-connection ${conflicts.length || state.workforce?.syncError ? "warning" : ""}"><span>${conflicts.length || state.workforce?.syncError ? "!" : "↥"}</span><p>${escapeHtml(message)}</p>${conflicts.length ? `<button class="small-button" data-action="navigate" data-page="sync">Открыть синхронизацию</button>` : ""}</div>`;
}

function renderPage() {
  if (state.page === "journals") return renderJournalsPage();
  if (state.page === "attendance") return renderAttendancePage();
  if (state.page === "personnel") return renderPersonnelPage();
  if (state.page === "sync") return renderSyncPage();
  if (state.page === "vacations") return renderVacationsPage();
  if (state.page === "specifications") return renderSpecificationsPage();
  if (state.page === "statistics" && state.account.role === "manager") return renderStatisticsPage();
  if (state.page === "settings" && state.account.role === "manager") return renderSettingsPage();
  if (state.page === "cyclones") return renderCyclonesPage();
  if (state.page === "packaging") return renderPackagingPage();
  if (state.page === "packaging-warehouse") return renderPackagingWarehousePage();
  if (state.page === "nonconformities") return renderNonconformitiesPage();
  if (state.page === "incidents") return renderIncidentsPage();
  if (state.page === "maintenance") return renderMaintenancePage();
  if (state.page === "production") return renderProductionPage();
  if (state.page !== "dashboard" && MODULES.some(module => module.id === state.page)) return renderPlannedModulePage();
  return renderDashboard();
}

function renderMaintenancePage() {
  const service = state.maintenance.service ?? { records: [], statistics: {} };
  const repair = state.maintenance.repair ?? { records: [], statistics: {} };
  const view = state.maintenanceView;
  const tabs = [["repair", "Журнал ремонта"], ["service", "Журнал ТО"], ["statistics", "Статистика"]];
  const content = view === "service"
    ? renderMaintenanceTable("Журнал ТО", service.records, "ТО", false, true)
    : view === "statistics"
      ? renderMaintenanceStatistics(service, repair)
      : renderMaintenanceTable("Журнал ремонта", repair.records, "Ремонт", false, true);
  return `<section class="section-heading"><div><p class="eyebrow">Google Sheets · два независимых журнала</p><h2>Ремонт и ТО станков</h2><p>ТО и ремонт учитываются отдельно. Данные загружаются из рабочих журналов; незаполненные бумажные записи ремонта появятся после их внесения в таблицу.</p></div><button class="secondary-button" data-action="refresh-maintenance">Обновить</button></section>
    ${state.maintenance.error ? `<p class="form-error">${escapeHtml(state.maintenance.error)}</p>` : ""}
    <div class="dashboard-grid"><article class="metric-card"><span>Журнал ремонта</span><strong>${repair.statistics.total || 0}</strong><small>${repair.statistics.machinesWithRecords || 0} станков с записями</small></article><article class="metric-card"><span>Журнал ТО</span><strong>${service.statistics.total || 0}</strong><small>${service.statistics.machinesWithRecords || 0} станков с записями</small></article></div>
    <nav class="settings-tabs card maintenance-tabs" aria-label="Разделы журналов">${tabs.map(([key, label]) => `<button class="${view === key ? "active" : ""}" data-action="maintenance-view" data-view="${key}"><strong>${label}</strong></button>`).join("")}</nav>
    ${content}`;
}

function renderProductionPage() {
  const all = state.production.records ?? [];
  const records = all.filter(record => record.date === today()).sort((left, right) =>
    String(left.line).localeCompare(String(right.line), "ru") || String(left.time).localeCompare(String(right.time)) || String(left.product).localeCompare(String(right.product), "ru"));
  const totalQuantity = records.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalScrap = records.reduce((sum, item) => sum + Number(item.scrapKg || 0), 0);
  const totalCanScrap = records.reduce((sum, item) => sum + Number(item.canScrapKg || 0), 0);
  const canAdd = state.account?.role === "manager" || state.account?.role === "senior";
  return `<section class="section-heading"><div><p class="eyebrow">Google Sheets · два листа одной записи</p><h2>Учёт продукции и брака</h2><p>Каждый упаковщик вносит свой выпуск отдельно. Итоги линии и машины программа складывает без двойного учёта.</p></div><div class="header-actions"><button class="secondary-button" data-action="refresh-production" ${state.productionLoading ? "disabled" : ""}>${state.productionLoading ? "Обновляем…" : "Обновить"}</button>${canAdd ? `<button class="primary-button" data-action="add-production" ${state.productionLoading ? "disabled" : ""}>+ Внести мой выпуск</button>` : ""}</div></section>
    ${state.productionLoading ? '<p class="module-note" role="status">Получаем данные из Google Sheets. Это может занять до 30 секунд.</p>' : ""}
    ${state.production.error ? `<p class="form-error">${escapeHtml(state.production.error)}</p>` : ""}
    <div class="dashboard-grid production-metrics"><article class="metric-card"><span>Готовая продукция</span><strong>${formatNumber(totalQuantity)} <small>шт.</small></strong><small>${formatNumber(totalQuantity / 240)} кор. за сегодня · 240 шт. в коробке</small></article><article class="metric-card"><span>Брак продукции</span><strong>${formatNumber(totalScrap)}</strong><small>кг за сегодня</small></article><article class="metric-card"><span>Брак банок</span><strong>${formatNumber(totalCanScrap)}</strong><small>кг за сегодня</small></article></div>
    <section class="card table-card"><div class="table-toolbar"><strong>Сегодня · ${formatDate(today())}</strong><span>${records.length} ${plural(records.length, "запись", "записи", "записей")} · A → P</span></div><div class="table-scroll"><table><thead><tr><th>Смена</th><th>Начало</th><th>Окончание</th><th>Линейка продукта</th><th>Продукт</th><th>Линия</th><th>mg/g</th><th>Готово, шт</th><th>Брак продукции, кг</th><th>Брак банок, кг</th><th>Упаковщик</th><th>Механик-оператор(ы)</th><th>Старший механик</th><th>Механик</th><th>Примечание</th>${canAdd ? "<th></th>" : ""}</tr></thead><tbody>${records.length ? records.map(record => `<tr><td><strong>${escapeHtml(record.shift || "—")}</strong></td><td>${escapeHtml(record.startTime || "—")}</td><td>${escapeHtml(record.time || "—")}</td><td>${escapeHtml(record.catalogLine || "—")}</td><td>${escapeHtml(record.product)}</td><td><strong>${escapeHtml(record.line)}</strong></td><td>${formatNumber(record.strength)}</td><td>${formatNumber(record.quantity)}</td><td>${formatNumber(record.scrapKg)}</td><td>${formatNumber(record.canScrapKg)}</td><td>${escapeHtml(record.packer)}</td><td>${escapeHtml(record.operator)}</td><td>${escapeHtml(record.seniorMechanic || "—")}</td><td>${escapeHtml(record.mechanic || "—")}</td><td>${escapeHtml(record.note || "—")}</td>${canAdd ? `<td><div class="row-actions"><button class="small-button" data-action="edit-production" data-id="${attribute(record.id)}">Исправить</button><button class="more-button" data-action="delete-production" data-id="${attribute(record.id)}" title="Удалить">×</button></div></td>` : ""}</tr>`).join("") : `<tr><td colspan="${canAdd ? 16 : 15}">За сегодня записей пока нет.</td></tr>`}</tbody></table></div></section>
    ${renderProductionPeopleSummary(records)}`;
}

function renderProductionPeopleSummary(records) {
  const packers = new Map();
  const operators = new Map();
  const add = (bucket, name, record, fraction = 1) => {
    if (!name) return;
    const value = bucket.get(name) ?? { quantity: 0, scrapKg: 0, canScrapKg: 0 };
    value.quantity += Number(record.quantity || 0) * fraction;
    value.scrapKg += Number(record.scrapKg || 0) * fraction;
    value.canScrapKg += Number(record.canScrapKg || 0) * fraction;
    bucket.set(name, value);
  };
  records.forEach(record => {
    add(packers, record.packer, record);
    const assigned = splitProductionParticipants(record.operator);
    assigned.forEach(name => add(operators, name, record, 1 / assigned.length));
  });
  const shiftLeaders = presentShiftPersonnel().filter(person => ["senior-mechanic", "mechanic"].includes(person.role));
  const total = records.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
  const rows = (title, entries, suffix = "") => entries.length ? `<article><h3>${title}</h3><table><thead><tr><th>Сотрудник</th><th>Выпуск, шт</th><th>Коробки</th><th>Брак, кг</th></tr></thead><tbody>${entries.map(([name, values]) => `<tr><td>${escapeHtml(name)}${suffix}</td><td>${formatNumber(values.quantity)}</td><td>${formatNumber(values.quantity / 240)}</td><td>${formatNumber(values.scrapKg + values.canScrapKg)}</td></tr>`).join("")}</tbody></table></article>` : "";
  const leaderEntries = shiftLeaders.map(person => [person.fullName, { quantity: total, scrapKg: 0, canScrapKg: 0 }]);
  if (!packers.size && !operators.size && !leaderEntries.length) return "";
  return `<section class="card table-card production-people-summary"><div class="section-heading"><div><p class="eyebrow">Смена · персональные показатели</p><h2>Кому засчитывается выпуск</h2></div><span class="status-pill neutral">Итог линии не удваивается</span></div><div class="production-people-grid">${rows("Упаковщики", [...packers.entries()].sort((left, right) => left[0].localeCompare(right[0], "ru")))}${rows("Механики-операторы", [...operators.entries()].sort((left, right) => left[0].localeCompare(right[0], "ru")))}${rows("Старший механик и Механик", leaderEntries, " · сменный итог")}</div></section>`;
}

function renderMaintenanceTable(title, records, type, compact, canAdd = false) {
  const visible = compact ? records.slice(0, 10) : records;
  const empty = '<tr><td colspan="6">Записей пока нет.</td></tr>';
  const action = type === "ТО" ? "add-maintenance-service" : "add-maintenance-repair";
  const add = canAdd ? `<button class="primary-button" data-action="${action}">+ Добавить ${type === "ТО" ? "ТО" : "ремонт"}</button>` : "";
  const label = compact ? `Последние ${Math.min(10, records.length)} из ${records.length} записей` : `${records.length} записей`;
  return `<section class="card table-card"><div class="section-heading"><div><p class="eyebrow">${escapeHtml(type)}</p><h2>${title}</h2></div><div class="header-actions">${add}<span class="status-pill neutral">${label}</span></div></div><div class="table-scroll"><table><thead><tr><th>Дата</th><th>Станок</th><th>Категория</th><th>Вид работ</th><th>Исполнитель</th><th>Примечание</th></tr></thead><tbody>${visible.length ? visible.map(item => `<tr><td>${formatDate(item.date)}</td><td>${item.machine}</td><td>${escapeHtml(item.category || type)}</td><td>${escapeHtml(item.work)}</td><td>${escapeHtml(item.performer || "—")}</td><td>${escapeHtml(item.note || "—")}</td></tr>`).join("") : empty}</tbody></table></div></section>`;
}

function renderMaintenanceStatistics(service, repair) {
  const byMachine = new Map();
  const byPerformer = new Map();
  const collect = (records, kind) => records.forEach(record => {
    const machine = String(record.machine || "—");
    const machineItem = byMachine.get(machine) || { service: 0, repair: 0 };
    machineItem[kind] += 1;
    byMachine.set(machine, machineItem);
    if (record.performer) {
      const performerItem = byPerformer.get(record.performer) || { service: 0, repair: 0 };
      performerItem[kind] += 1;
      byPerformer.set(record.performer, performerItem);
    }
  });
  collect(service.records, "service");
  collect(repair.records, "repair");
  const machineRows = [...byMachine.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  const performerRows = [...byPerformer.entries()].sort((a, b) => (b[1].service + b[1].repair) - (a[1].service + a[1].repair));
  const makeRows = (items, label) => items.length ? items.map(([name, item]) => `<tr><td>${escapeHtml(name)}</td><td>${item.service}</td><td>${item.repair}</td><td><strong>${item.service + item.repair}</strong></td></tr>`).join("") : `<tr><td colspan="4">${label}</td></tr>`;
  return `<div class="dashboard-grid maintenance-statistics"><section class="card table-card"><div class="section-heading"><div><p class="eyebrow">По оборудованию</p><h2>Записи по станкам</h2></div></div><div class="table-scroll"><table><thead><tr><th>Станок</th><th>ТО</th><th>Ремонт</th><th>Всего</th></tr></thead><tbody>${makeRows(machineRows, "Записей по станкам пока нет.")}</tbody></table></div></section><section class="card table-card"><div class="section-heading"><div><p class="eyebrow">По персоналу</p><h2>Исполнители</h2></div></div><div class="table-scroll"><table><thead><tr><th>Исполнитель</th><th>ТО</th><th>Ремонт</th><th>Всего</th></tr></thead><tbody>${makeRows(performerRows, "Исполнители пока не указаны.")}</tbody></table></div></section></div>`;
}

function renderPlannedModulePage() {
  const module = MODULES.find(item => item.id === state.page);
  const title = moduleLabel(module);
  return `<section class="card placeholder-hero">
    <span class="placeholder-icon">${moduleIcon(module?.icon)}</span>
    <div><p class="eyebrow">Рабочий раздел</p><h2>${escapeHtml(title)}</h2><p>Раздел уже добавлен в программу. Дальше заполним его журналом, полями и статистикой по вашему рабочему порядку.</p></div>
  </section>`;
}

function renderDashboard() {
  const productionRecords = (state.production.records ?? []).filter(record => record.date === today());
  const totalQuantity = productionRecords.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
  const productScrap = productionRecords.reduce((sum, record) => sum + Number(record.scrapKg || 0), 0);
  const boxes = totalQuantity / 240;
  const finishedMassKg = productionRecords.reduce((sum, record) => sum + productionRecordMassKg(record), 0);
  const scrapPercent = finishedMassKg > 0 ? productScrap / finishedMassKg * 100 : null;
  const shiftPersonnel = presentShiftPersonnel();
  const packers = shiftPersonnel.filter(employee => employee.role === "packer");
  const operators = shiftPersonnel.filter(employee => employee.role === "mechanic-operator");
  const service = state.maintenance.service ?? { records: [], statistics: {} };
  const repair = state.maintenance.repair ?? { records: [], statistics: {} };
  const newest = records => [...records].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const latestRepair = newest(repair.records).slice(0, 10);
  const latestService = newest(service.records).slice(0, 5);
  return `
    ${state.account.role === "manager" ? renderBirthdayReminders() : ""}
    ${renderJournalReadiness()}
    ${state.account.role === "senior" ? renderShiftPanel() : ""}
    ${state.account.role === "senior" ? renderWorkflowPanel() : ""}
    <div class="dashboard-summary-grid">
      <article class="card dashboard-summary-card production-summary">
        <p class="eyebrow">Сегодня · ${formatDate(today())}</p>
        <h2>Готовая продукция</h2>
        <strong>${formatNumber(totalQuantity)} <small>шт.</small> / ${formatNumber(boxes)} <small>кор.</small></strong>
        <p>${productionRecords.length} ${plural(productionRecords.length, "запись", "записи", "записей")} завершено · 240 шт. в коробке</p>
      </article>
      <article class="card dashboard-summary-card scrap-summary">
        <p class="eyebrow">Сегодня · ${formatDate(today())}</p>
        <h2>Брак продукции</h2>
        <strong>${formatNumber(productScrap)} <small>кг</small> / ${scrapPercent === null ? "—" : formatPercent(scrapPercent)} <small>%</small></strong>
        <p>${finishedMassKg ? `Расчёт от ${formatNumber(finishedMassKg)} кг готового продукта` : "Процент появится после записи готовой продукции"}</p>
      </article>
      <article class="card dashboard-summary-card shift-summary">
        <p class="eyebrow">Состав текущей смены</p>
        <h2>Состав смены</h2>
        <strong><small>Упаковщиков</small> ${packers.length} <small>/ Механиков</small> ${operators.length}</strong>
        <p>${shiftPersonnel.length ? "Учтены отмеченные в табеле сотрудники" : "Состав появится после отметки табеля"}</p>
      </article>
    </div>
    <div class="dashboard-maintenance-grid">
      <section class="card dashboard-maintenance-card">
        <div class="section-heading"><div><p class="eyebrow">Журнал ремонта</p><h2>Последние записи ремонта</h2></div><button class="secondary-button" data-action="navigate" data-page="maintenance">Открыть журнал</button></div>
        ${renderDashboardMaintenanceList(latestRepair, "Ремонт", 10)}
      </section>
      <section class="card dashboard-maintenance-card maintenance-overview-card">
        <div class="section-heading"><div><p class="eyebrow">Таблица ТО · выпуск</p><h2>Остаток до ТО</h2></div><button class="secondary-button" data-action="navigate" data-page="maintenance">Журнал ТО</button></div>
        ${renderMaintenanceDueList(state.maintenanceDue)}
      </section>
    </div>
    <section class="card dashboard-maintenance-card dashboard-service-card">
      <div class="section-heading"><div><p class="eyebrow">Журнал ТО</p><h2>Последние записи ТО</h2></div><span class="status-pill neutral">5 последних</span></div>
      ${renderDashboardMaintenanceList(latestService, "ТО", 5)}
    </section>`;
}

function renderDashboardMaintenanceList(records, kind, limit) {
  if (!records.length) return `<p class="dashboard-empty">В журнале ${kind} записей пока нет.</p>`;
  return `<div class="dashboard-maintenance-list">${records.slice(0, limit).map(record => `<article><time>${formatDate(record.date)}</time><div><strong>${escapeHtml(record.machine ? `Станок ${record.machine}` : kind)}${record.work ? ` · ${escapeHtml(record.work)}` : ""}</strong><small>${escapeHtml(record.performer || record.category || "Исполнитель не указан")}</small></div>${record.note ? `<span title="${attribute(record.note)}">${escapeHtml(record.note)}</span>` : ""}</article>`).join("")}</div>`;
}

function productionRecordMassKg(record) {
  return productionFinishedMassKg(record, state.specifications.specifications);
}

function splitProductionParticipants(value) {
  return [...new Set(String(value || "").split(/\s+\+\s+/).map(item => item.trim()).filter(Boolean))].slice(0, 2);
}

function renderMaintenanceDueList(snapshot) {
  const records = snapshot?.records ?? [];
  if (!records.length) return `<p class="dashboard-empty">${snapshot?.error ? "Сводка ТО пока недоступна. Показаны данные журнала после следующей проверки." : "Сводка ТО загружается."}</p>`;
  const needsService = records.filter(record => /^(Просрочено|Требуется ТО)$/i.test(record.status));
  const className = record => /^(Просрочено|Требуется ТО)$/i.test(record.status) ? "danger" : record.status === "Скоро ТО" ? "warning" : "";
  return `${needsService.length ? `<p class="maintenance-due-alert"><strong>Требуется ТО:</strong> ${needsService.map(record => `${escapeHtml(record.line)} (${formatNumber(Math.abs(record.remainingBoxes))} кор. ${record.remainingBoxes < 0 ? "сверх интервала" : "осталось"})`).join(", ")}</p>` : ""}<div class="maintenance-due-list">${records.map(record => `<article class="${className(record)}"><strong>${escapeHtml(record.line)}</strong><span>${formatNumber(record.remainingBoxes)} кор.</span><small>${escapeHtml(record.status || "В пределах интервала")}</small></article>`).join("")}</div>`;
}

function renderJournalReadiness() {
  const sync = state.startupSync;
  if (sync.active) return `<section class="workforce-connection"><span>↻</span><p><strong>Подготавливаем журналы: ${sync.completed} из ${sync.total}</strong><br><small>Сейчас: ${escapeHtml(sync.current)}. Программой уже можно пользоваться.</small></p></section>`;
  if (sync.completedAt && !sync.failed.length) return `<section class="workforce-connection"><span>✓</span><p><strong>Все журналы синхронизированы. Программа готова к работе.</strong><br><small>Проверено: ${formatDateTime(sync.completedAt)}.</small></p><button class="small-button" data-action="sync-all-journals">Проверить снова</button></section>`;
  if (sync.completedAt) return `<section class="workforce-connection warning"><span>!</span><p><strong>Обновлено журналов: ${sync.completed - sync.failed.length} из ${sync.total}</strong><br><small>Не ответили: ${escapeHtml(sync.failed.join(", "))}. Показаны последние сохранённые данные.</small></p><button class="small-button" data-action="sync-all-journals">Повторить</button></section>`;
  return `<section class="workforce-connection"><span>↻</span><p>Журналы будут проверены после подключения к сети.</p><button class="small-button" data-action="sync-all-journals">Проверить</button></section>`;
}

function renderShiftPanel() {
  if (isCurrentSharedShift()) {
    return `
      <section class="shift-strip active">
        <div class="shift-state"><span class="pulse"></span><div><strong>Рабочая смена идёт</strong><small>Старший механик: ${escapeHtml(state.shift.seniorMechanic ?? state.shift.supervisor ?? state.shift.employee)}; механик: ${escapeHtml(state.shift.mechanic || "не выбран")}. ${formatDateTime(state.shift.startedAt)}. Завершение не меняет табель и Google-записи.</small></div></div>
        <button class="danger-outline-button" data-action="end-shift">Завершить смену</button>
      </section>`;
  }
  return `
    <section class="shift-strip">
      <div class="shift-state"><span class="shift-dot"></span><div><strong>Смена не начата</strong><small>Сначала отметьте присутствующих в табеле.</small></div></div>
      <button class="primary-button" data-action="start-shift">Перейти к табелю</button>
    </section>`;
}

function renderWorkflowPanel() {
  const attendanceReady = isCurrentSharedShift();
  const weightsRequired = state.shift?.requiresScaleControl !== false;
  const weightsReady = attendanceReady && (!weightsRequired || Boolean(state.shift?.weightsCompletedAt));
  return `<section class="workflow-card card">
    <div class="workflow-heading"><div><p class="eyebrow">Порядок начала работы</p><h2>Подготовка смены</h2></div><span class="status-pill ${weightsReady ? "success" : "warning"}">${weightsReady ? "Подготовка завершена" : "Есть напоминание"}</span></div>
    <div class="workflow-steps">
      ${workflowStep(1, "Табель", attendanceReady, "Отметить сотрудников", "attendance")}
      ${workflowStep(2, "Контроль весов", weightsReady, weightsRequired ? "Проверить F1–F13" : "Для второй смены не требуется", "journals")}
      ${workflowStep(3, "Рабочие разделы", true, weightsReady ? "Можно продолжать" : "Доступны без блокировки", "dashboard")}
    </div>
  </section>`;
}

function workflowStep(number, title, done, note, page) {
  return `<button class="workflow-step ${done ? "done" : ""}" data-action="navigate" data-page="${page}"><span>${done ? "✓" : number}</span><strong>${title}</strong><small>${note}</small></button>`;
}

function renderJournalsPage() {
  const todayRecords = state.records.filter(record => record.date === today() && record.status !== "Аннулировано");
  const checkedScales = new Set(todayRecords.map(record => record.scaleName));
  const failedToday = todayRecords.filter(record => record.result === "Вне допуска").length;
  const availableMonths = [...new Set([state.recordMonth, ...state.records.map(record => String(record.date || "").slice(0, 7)).filter(Boolean)])].sort().reverse();
  const visibleRecords = state.records.filter(record => String(record.date || "").startsWith(state.recordMonth));
  return `
    <section class="journal-header card">
      <div class="journal-title-block">
        <span class="journal-symbol large-symbol">13</span>
        <div><p class="eyebrow">Google Sheets · ${journal.sheetName}</p><h2>Быстрый контроль весов</h2><p>Введите показание и нажмите Enter — программа сразу перейдёт к следующим весам.</p></div>
      </div>
      <div class="journal-actions">
        <button class="secondary-button" data-action="refresh">${refreshIcon()} Обновить</button>
        <button class="secondary-button" data-action="new-record">Одна запись</button>
        <button class="primary-button" data-action="start-scale-walk">Начать обход 13 весов</button>
      </div>
    </section>
    <div class="metric-grid three scale-overview">
      ${metricCard("Проверено сегодня", `${checkedScales.size} из ${SCALES.length}`, "Уникальных весов", checkedScales.size === SCALES.length ? "success" : "neutral", true)}
      ${metricCard("В пределах допуска", todayRecords.length - failedToday, "Сегодня", "success")}
      ${metricCard("Вне допуска", failedToday, failedToday ? "Нужен комментарий" : "Отклонений нет", failedToday ? "danger" : "success")}
    </div>
    <section class="card table-card">
      <div class="table-toolbar">
        <div><strong>${visibleRecords.length}</strong> ${plural(visibleRecords.length, "запись", "записи", "записей")} за ${monthTitle(state.recordMonth)}</div>
        <label class="table-filter">Период<select data-record-month aria-label="Период журнала весов">${availableMonths.map(month => `<option value="${month}" ${month === state.recordMonth ? "selected" : ""}>${escapeHtml(monthTitle(month))}</option>`).join("")}</select></label>
        <div class="legend"><span class="legend-item"><i class="dot synced"></i>Отправлено</span><span class="legend-item"><i class="dot pending"></i>В очереди</span></div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Дата</th><th>Весы</th><th>Факт</th><th>Отклонение</th><th>Результат</th><th>Исполнитель</th><th>Состояние записи</th><th></th></tr></thead>
          <tbody>${visibleRecords.length ? visibleRecords.map(renderRecordRow).join("") : renderEmptyRow()}</tbody>
        </table>
      </div>
    </section>`;
}

function renderAttendancePage() {
  const teamCounts = state.workforce.shiftTeams.map(team => ({ code: team.code, count: regularAreaPersonnel().filter(employee => employee.shiftTeamId === team.id).length }));
  return `
    <section class="workforce-hero card">
      <div><p class="eyebrow">Рабочее время и смены</p><h2>Табель участка</h2><p>График 2/2, фактические часы, причины отсутствия и начало смены — в одном разделе.</p></div>
      <div class="workforce-hero-stat"><div><strong>${teamCounts.find(team => team.code === "A")?.count ?? 0}</strong><span>в смене A</span></div><div><strong>${teamCounts.find(team => team.code === "B")?.count ?? 0}</strong><span>в смене B</span></div></div>
    </section>
    ${renderAttendanceTabs()}
    ${state.attendanceView === "schedule" ? renderScheduleView() : state.attendanceView === "timesheet" ? renderTimesheetView() : renderShiftStartView()}`;
}

function renderAttendanceTabs() {
  const tabs = [
    ["start", "Начало смены", "Кто сегодня работает"],
    ["schedule", "График смен", "Цикл 2/2 и часы"],
    ["timesheet", "Табель месяца", "Факт и отсутствие"]
  ];
  return `<nav class="workforce-tabs card" aria-label="Разделы табеля">${tabs.map(([view, label, note]) => `<button class="${state.attendanceView === view ? "active" : ""}" data-action="attendance-view" data-view="${view}"><strong>${label}</strong><small>${note}</small></button>`).join("")}</nav>`;
}

function renderShiftStartView() {
  const activeShift = isCurrentSharedShift() ? state.shift : null;
  const team = teamById(activeShift?.shiftTeamId ?? state.selectedShiftTeamId) ?? state.workforce.shiftTeams[0];
  const members = shiftStartMembers(team?.id);
  const savedAttendance = new Map((activeShift?.shiftTeamId === team?.id ? activeShift.attendance : []).map(item => [item.employeeId, item.status]));
  const leadership = shiftLeadershipOptions(members, savedAttendance, activeShift);
  const presentCount = members.filter(employee => attendanceCode(savedAttendance.get(employee.id)) === "11").length;
  const scheduled = team ? getScheduleMonth(team, ...monthParts(today())).some(day => day.date === today() && day.scheduled) : false;
  return `
    ${renderCentralShiftWarning()}
    ${renderLegacyShiftWarning()}
    <section class="shift-day-banner ${scheduled ? "scheduled" : "substitution"}">
      <span>${scheduled ? "Сегодня" : "Вне графика"}</span>
      <div><strong>${escapeHtml(team?.name ?? "Смена")}${scheduled ? " работает по графику" : " может выйти на подмену"}</strong><small>Цикл 2 рабочих / 2 выходных · ${team?.shiftDurationHours ?? 12} ч на производстве · ${team?.accountingHours ?? 11} учётных часов</small></div>
      <b>${escapeHtml(team?.code ?? "—")}</b>
    </section>
    <form class="card shift-attendance-card" data-form="shift-attendance">
      <div class="shift-form-head">
        <div><p class="eyebrow">Шаг 1 · состав смены</p><h2>${activeShift ? "Исправить присутствие" : "Начать рабочую смену"}</h2><p>Выберите смену, отметьте присутствующих, затем назначьте старшего механика и механика.</p></div>
        <div class="attendance-counter"><strong data-attendance-present>${presentCount}</strong><span>из ${members.length}<small>на работе</small></span></div>
      </div>
      <div class="shift-start-controls">
        <label class="field"><span>Рабочая смена</span><select name="shiftTeamId" data-start-team ${activeShift ? "disabled" : ""}>${state.workforce.shiftTeams.map(item => `<option value="${item.id}" ${item.id === team?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Старший механик</span><select name="seniorMechanic" required ${activeShift ? "disabled" : ""}>${leadership.senior}</select></label>
        <label class="field"><span>Механик</span><select name="mechanic" required ${activeShift ? "disabled" : ""}>${leadership.mechanic}</select></label>
      </div>
      <div id="attendance-form-error" class="form-error" hidden></div>
      <div class="shift-attendance-list">
        ${members.map(employee => {
          const status = attendanceCode(savedAttendance.get(employee.id));
          const substitution = employee.isSubstitute ? `<small class="substitute-badge">Подмена · ${escapeHtml(employee.substitutionReason)}</small>` : "";
          const remove = employee.isSubstitute && !state.shift?.active ? `<button type="button" class="remove-shift-guest" data-action="remove-shift-guest" data-id="${attribute(employee.id)}" aria-label="Убрать ${attribute(employee.fullName)}">×</button>` : "";
          return `<label class="shift-person-row ${employee.isSubstitute ? "is-substitute" : ""}"><span class="employee-avatar">${initials(employee.fullName)}</span><span class="shift-person-name"><strong>${escapeHtml(employee.fullName)}</strong><small>${escapeHtml(roleLabel(employee.role))}</small>${substitution}</span><select name="attendance-${employee.id}" data-attendance-status aria-label="Статус: ${attribute(employee.fullName)}">${attendanceStatusOptions(status)}</select>${remove}</label>`;
        }).join("")}
      </div>
      <div class="shift-guest-actions"><button type="button" class="secondary-button" data-action="add-shift-guest">+ Добавить сотрудника другой смены</button><small>Выберите причину: подработка или производственная необходимость.</small></div>
      <div class="shift-form-footer"><p>${activeShift ? "Исправления сохраняются в общей активной смене и не требуют нового запуска." : "После сохранения появится напоминание о весах, но другие разделы останутся доступны."}</p><button class="primary-button" type="submit">${activeShift ? "Сохранить исправления" : "Подтвердить состав и начать"}</button></div>
    </form>`;
}

function renderLegacyShiftWarning() {
  const legacy = state.legacyShift;
  if (!APP_CONFIG.centralAuth || !legacy?.active) return "";
  const legacyDate = String(legacy.startedAt || "").slice(0, 10);
  const currentTeam = scheduledTeam()?.id;
  if (legacyDate === today() && legacy.shiftTeamId === currentTeam) return "";
  return `<section class="workforce-connection warning"><span>!</span><p><strong>Найдена локальная незавершённая смена ${escapeHtml(teamLabel(legacy.shiftTeamId))}</strong><br><small>Она не управляет общей сменой и не блокирует бригаду по графику. Завершите её явно только после проверки; сохранённые отметки табеля не будут изменены.</small></p><button class="small-button" data-action="archive-legacy-shift">Завершить и сохранить ${escapeHtml(teamLabel(legacy.shiftTeamId))}</button></section>`;
}

function renderCentralShiftWarning() {
  const shift = state.shift;
  if (!APP_CONFIG.centralAuth || !shift?.active || isCurrentSharedShift()) return "";
  return `<section class="workforce-connection warning"><span>!</span><p><strong>Общая смена ${escapeHtml(teamLabel(shift.shiftTeamId))} относится к ${escapeHtml(shift.shiftDate || "другой дате")}</strong><br><small>Её нужно проверить и явно завершить. Она не скрывается и не будет заменена автоматически.</small></p><button class="small-button" data-action="end-shift">Завершить общую смену</button></section>`;
}

function renderScheduleView() {
  const days = monthDays(state.attendanceMonth);
  const teams = teamsWithCurrentShiftFirst();
  return `${renderWorkforceMonthToolbar("График смен", "Плановый цикл 2/2")}
    <section class="schedule-summary-grid">
      ${teams.map(team => {
        const schedule = getScheduleMonth(team, ...monthParts(state.attendanceMonth));
        const workDays = schedule.filter(day => day.scheduled).length;
        return `<article class="schedule-summary-card card"><span class="team-orb">${team.code}</span><div><strong>${escapeHtml(team.name)}</strong><small>2 рабочих / 2 выходных</small></div><dl><div><dt>Смен</dt><dd>${workDays}</dd></div><div><dt>Часов</dt><dd>${workDays * team.accountingHours}</dd></div><div><dt>Состав</dt><dd>${activePersonnel().filter(employee => employee.shiftTeamId === team.id).length}</dd></div></dl></article>`;
      }).join("")}
      <article class="schedule-summary-card office card"><span class="team-orb">5/2</span><div><strong>${OFFICE_SCHEDULE.name}</strong><small>Пн–Пт · праздничные дни нерабочие</small></div><dl><div><dt>День</dt><dd>8 ч</dd></div><div><dt>Состав</dt><dd>${activePersonnel().filter(employee => employee.shiftTeamId === "office").length}</dd></div></dl></article>
    </section>
    <div class="schedule-groups">${teams.map(team => renderScheduleTeam(team, days)).join("")}</div>`;
}

function renderScheduleTeam(team, days) {
  const schedule = new Map(getScheduleMonth(team, ...monthParts(state.attendanceMonth)).map(day => [day.date, day]));
  const members = activePersonnel().filter(employee => employee.shiftTeamId === team.id).sort(comparePersonnel);
  const scheduledDays = [...schedule.values()].filter(day => day.scheduled).length;
  return `<section class="card schedule-team-card">
    <header><div><span class="team-orb">${team.code}</span><span><strong>${escapeHtml(team.name)}</strong><small>${team.shiftDurationHours} часов · к учёту ${team.accountingHours}</small></span></div><div><b>${scheduledDays}</b><small>рабочих смен</small></div></header>
    <div class="attendance-scroll"><table class="attendance-table schedule-table"><thead><tr><th class="attendance-person">Сотрудник</th>${days.map(day => dayHeader(day)).join("")}<th class="total-column">Итого</th></tr></thead><tbody>${members.map(employee => `<tr><th class="attendance-person"><strong>${escapeHtml(employee.fullName)}</strong><small>${escapeHtml(roleLabel(employee.role))}</small></th>${days.map(day => `<td class="${day.isToday ? "today" : ""} ${schedule.get(day.date)?.scheduled ? "is-scheduled" : "is-rest"}"><span>${schedule.get(day.date)?.scheduled ? team.code : "·"}</span></td>`).join("")}<td class="total-column"><strong>${scheduledDays * team.accountingHours}</strong></td></tr>`).join("")}</tbody></table></div>
  </section>`;
}

function renderTimesheetView() {
  const days = monthDays(state.attendanceMonth);
  const teams = teamsWithCurrentShiftFirst();
  return `${renderWorkforceMonthToolbar("Табель рабочего времени", "Нажмите на ячейку, чтобы изменить часы или причину отсутствия")}
    <section class="attendance-code-strip">${ATTENDANCE_CODES.map(item => `<span class="tone-${item.tone}"><b>${item.value}</b>${item.label}</span>`).join("")}</section>
    <div class="schedule-groups">${teams.map(team => renderTimesheetTeam(team, days)).join("")}</div>`;
}

function renderTimesheetTeam(team, days) {
  const schedule = new Map(getScheduleMonth(team, ...monthParts(state.attendanceMonth)).map(day => [day.date, day]));
  const records = new Map(state.workforce.attendance.filter(item => item.shiftTeamId === team.id).map(item => [`${item.employeeId}:${item.date}`, item]));
  const regularMembers = regularAreaPersonnel().filter(employee => employee.shiftTeamId === team.id);
  const substituteMembers = activePersonnel().filter(employee => (employee.shiftTeamId !== team.id || isSubstituteOnly(employee)) && [...records.values()].some(record => record.employeeId === employee.id && record.substitutionReason));
  const members = [...regularMembers, ...substituteMembers].sort(comparePersonnel);
  return `<section class="card schedule-team-card timesheet-team-card">
    <header><div><span class="team-orb">${team.code}</span><span><strong>${escapeHtml(team.name)}</strong><small>Фактические часы и причины отсутствия</small></span></div><span class="autosave-note">Сохраняется автоматически</span></header>
    <div class="attendance-scroll"><table class="attendance-table timesheet-table"><thead><tr><th class="attendance-person">Сотрудник</th>${days.map(day => dayHeader(day)).join("")}<th class="total-column">Часы</th></tr></thead><tbody>${members.map(employee => renderTimesheetRow(employee, team, days, schedule, records)).join("")}</tbody></table></div>
  </section>`;
}

function renderTimesheetRow(employee, team, days, schedule, records) {
  let total = 0;
  const substituteReasons = [...records.values()]
    .filter(record => record.employeeId === employee.id && record.substitutionReason)
    .map(record => record.substitutionReason);
  const substituteNote = substituteReasons.length ? `<span class="substitute-badge">Подмена · ${escapeHtml([...new Set(substituteReasons)].join(", "))}</span>` : "";
  const cells = days.map(day => {
    const record = records.get(`${employee.id}:${day.date}`);
    const scheduled = schedule.get(day.date)?.scheduled;
    const future = day.date > today();
    if (!record && (!scheduled || future)) return `<td class="${day.isToday ? "today" : ""} ${future ? "is-future" : "is-rest"}">·</td>`;
    const value = record?.value ?? (workforceRepository ? "" : String(team.accountingHours));
    const hours = Number(value);
    if (Number.isFinite(hours)) total += hours;
    return `<td class="timesheet-cell ${day.isToday ? "today" : ""} tone-${attendanceTone(value, team.accountingHours)}"><select data-timesheet-cell data-date="${day.date}" data-shift-team-id="${team.id}" data-employee-id="${employee.id}" aria-label="${attribute(`${employee.fullName}, ${day.date}`)}">${value === "" ? '<option value="" selected disabled>—</option>' : ""}${timesheetOptions(value, team.accountingHours)}</select></td>`;
  }).join("");
  return `<tr><th class="attendance-person"><strong>${escapeHtml(employee.fullName)}</strong><small>${escapeHtml(roleLabel(employee.role))}</small>${substituteNote}</th>${cells}<td class="total-column"><strong>${total}</strong></td></tr>`;
}

function renderWorkforceMonthToolbar(title, note) {
  return `<section class="card workforce-month-toolbar"><button class="icon-button" data-action="attendance-month" data-offset="-1" aria-label="Предыдущий месяц">←</button><div><p class="eyebrow">${title}</p><h2>${escapeHtml(monthTitle(state.attendanceMonth))}</h2><small>${note}</small></div><button class="icon-button" data-action="attendance-month" data-offset="1" aria-label="Следующий месяц">→</button></section>`;
}

function renderPersonnelPage() {
  const employees = personnel().sort(comparePersonnel);
  const canEdit = state.account.role === "manager";
  return `
    <section class="workforce-hero card personnel-header">
      <div><p class="eyebrow">Команда фасовочного участка</p><h2>Персонал</h2><p>${canEdit ? "Полный справочник: состав смен, статус и личные данные сотрудников." : "Справочник сотрудников: должность, смена и рабочий статус. Редактирование доступно начальнику участка."}</p></div>
      <div class="personnel-actions"><span class="count-badge"><b data-personnel-count>${employees.length}</b> сотрудников</span>${canEdit ? `<button class="primary-button" data-action="add-employee">+ Добавить сотрудника</button>` : `<span class="status-pill muted">Только просмотр</span>`}</div>
    </section>
    <section class="card personnel-filter-card">
      <label class="personnel-search"><span>Поиск</span><input type="search" data-personnel-filter data-personnel-search placeholder="Имя или фамилия…" autocomplete="off"></label>
      <label class="field"><span>Смена</span><select data-personnel-filter data-personnel-team><option value="all">Все смены</option><option value="office">Администрация 5/2</option>${state.workforce.shiftTeams.map(team => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Должность</span><select data-personnel-filter data-personnel-role><option value="all">Все должности</option>${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}">${escapeHtml(label)}</option>`).join("")}</select></label>
    </section>
    <section class="personnel-grid">
      ${employees.map(employee => `<article class="personnel-card ${employee.active === false ? "inactive" : ""}" data-personnel-card data-search="${attribute(employee.fullName.toLocaleLowerCase("ru-RU"))}" data-team="${employee.shiftTeamId}" data-role="${employee.role}">
        <div class="personnel-card-top"><span class="employee-avatar">${initials(employee.fullName)}</span><span class="employee-team-badge">${escapeHtml(teamLabel(employee.shiftTeamId))}</span></div>
        <h3>${escapeHtml(employee.fullName)}</h3>
        <p>${escapeHtml(roleLabel(employee.role))}</p>
        <dl><div><dt>График</dt><dd>${employee.shiftTeamId === "office" ? "5/2 · 8 ч" : "2/2 · 12 ч"}</dd></div><div class="personnel-shift"><dt>Смена</dt><dd>${escapeHtml(teamLabel(employee.shiftTeamId))}</dd></div><div><dt>Статус</dt><dd>${employee.active === false ? "В архиве" : "Активен"}</dd></div>${employee.role === "packer" ? `<div class="personnel-pak"><dt>Номер PAK</dt><dd>${escapeHtml(employee.pakNumber || "—")}</dd></div><div class="personnel-pak personnel-code"><dt>Код</dt><dd>${escapeHtml(employee.pakCode || "—")}</dd></div>` : ""}</dl>
        ${canEdit ? renderPersonnelPrivateDetails(employee) : `<p class="directory-note">Справочник · только просмотр</p>`}
        ${canEdit ? `<div class="personnel-card-actions"><button data-action="edit-employee" data-id="${employee.id}">Карточка</button><button data-action="toggle-employee" data-id="${employee.id}">${employee.active === false ? "Вернуть" : "В архив"}</button></div>` : ""}
      </article>`).join("")}
    </section>`;
}

function renderPersonnelPrivateDetails(employee) {
  return `<details class="personnel-private"><summary>Личные сведения</summary><dl>
    <div><dt>Дата рождения</dt><dd>${escapeHtml(formatPersonnelDate(employee.birthday))}</dd></div>
    <div><dt>Дата приёма</dt><dd>${escapeHtml(formatPersonnelDate(employee.hireDate))}</dd></div>
    <div class="full"><dt>Телефон</dt><dd>${escapeHtml(employee.phone || "Не указан")}</dd></div>
    <div class="full"><dt>Электронная почта</dt><dd>${escapeHtml(employee.email || "Не указана")}</dd></div>
  </dl></details>`;
}

function renderStatisticsPage() {
  return `
    <section class="settings-hero card">
      <div><p class="eyebrow">Сводные показатели участка</p><h2>Статистика</h2><p>Общие данные по персоналу, сменам, табелю и доступным журналам. Личные сведения сотрудников здесь не отображаются.</p></div>
      <span class="status-pill success">Только начальник</span>
    </section>
    <section class="card empty-state"><span>◌</span><h3>Раздел подготовлен</h3><p>Показатели и графики добавим после того, как вы определите нужный состав статистики.</p></section>`;
}

function formatPersonnelDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "Не указана";
}

function renderVacationsPage() {
  const rows = [...(state.workforce.vacations || [])].filter(vacation => isRegularAreaEmployee(personnel().find(employee => employee.id === vacation.employeeId))).sort((a, b) => a.year - b.year || String(a.startDate).localeCompare(String(b.startDate)));
  const canEdit = state.account.role === "manager";
  return `<section class="card module-header"><div><h2>График отпусков</h2><p>${canEdit ? "Одна запись — один период. Итоги считаются в календарных днях." : "Только просмотр. Изменять график отпусков может начальник участка."}</p></div>${canEdit ? `<button class="primary-button" data-action="add-vacation">+ Добавить период</button>${journalLink("vacations")}` : '<span class="status-pill muted">Только просмотр</span>'}</section>
    <section class="card settings-table-wrap"><table class="settings-data-table"><thead><tr><th>Год</th><th>Сотрудник</th><th>Начало</th><th>Окончание</th><th>Дней</th><th>Статус</th>${canEdit ? "<th></th>" : ""}</tr></thead><tbody>${rows.map(v => `<tr><td>${v.year}</td><td>${escapeHtml(personnel().find(p => p.id === v.employeeId)?.fullName || v.employeeId)}</td><td>${escapeHtml(v.startDate || "—")}</td><td>${escapeHtml(v.endDate || "—")}</td><td>${v.days ?? "—"}</td><td>${escapeHtml(v.status)}${v.syncStatus ? " · ожидает отправки" : ""}</td>${canEdit ? `<td><button class="small-button" data-action="edit-vacation" data-id="${attribute(v.id)}">Изменить</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="${canEdit ? 7 : 6}">Периоды пока не загружены.</td></tr>`}</tbody></table></section>`;
}

function renderPackagingPage() {
  const { records, operations, lastReadAt, error } = state.packaging;
  const status = error ? `Google недоступен: ${error}` : lastReadAt ? `Последнее чтение Google: ${formatDateTime(lastReadAt)}` : "Связь с Google ещё не проверена";
  const current = records.find(record => record.date === today());
  const selected = PACKAGING_FIELDS.find(field => field.key === state.packagingEntryItem) ?? null;
  const canSubmit = Boolean(selected);
  return `<section class="packaging-toolbar"><p>${escapeHtml(status)} · В очереди: <strong>${operations.length}</strong>${!APP_CONFIG.integration.googleWritesEnabled ? " · Отправка в Google выключена" : ""}</p><div class="packaging-toolbar-actions"><button class="secondary-button" data-action="sync-packaging">Обновить</button>${current ? `<button class="secondary-button" data-action="edit-packaging" data-id="${attribute(current.id)}">Исправить итог за сегодня</button>` : ""}</div></section>
    <section class="packaging-workspace"><article class="card packaging-catalog"><div class="section-heading"><div><p class="eyebrow">Сегодня</p><h2>Вид упаковки</h2><p>Нажмите на нужную позицию. Рядом показан уже взятый итог за день.</p></div></div><div class="packaging-item-list">${PACKAGING_FIELDS.map(field => { const total = Number(current?.values?.[field.key] || 0); const active = selected?.key === field.key; return `<button type="button" class="packaging-item ${active ? "selected" : ""}" data-action="select-packaging-item" data-item="${attribute(field.key)}"><span><strong>${escapeHtml(shortPackagingLabel(field.label))}</strong><small>Уже взято сегодня</small></span><b>${formatNumber(total)} <small>${escapeHtml(packagingUnit(field))}</small></b></button>`; }).join("")}</div></article>
    <form class="card packaging-entry-panel" data-form="packaging-quick"><p class="eyebrow">Быстрый ввод</p><h2>${selected ? escapeHtml(shortPackagingLabel(selected.label)) : "Выберите упаковку"}</h2><p class="packaging-current-total">${selected ? `Уже взято: <strong>${formatNumber(Number(current?.values?.[selected.key] || 0))} ${escapeHtml(packagingUnit(selected))}</strong>` : "Сначала выберите позицию слева."}</p><input type="hidden" name="item" value="${attribute(selected?.key || "")}">${formField("packaging-quantity", "Количество", `<input id="packaging-quantity" name="quantity" type="number" min="1" step="1" inputmode="numeric" placeholder="0" required ${selected ? "" : "disabled"}>`, "Новое количество будет прибавлено к итогу за сегодня. Только целое положительное число.", "full")}<p id="form-error" class="form-error" hidden></p><div class="dialog-actions"><button type="submit" class="primary-button packaging-submit" ${canSubmit ? "" : "disabled"}>Прибавить к итогу</button></div></form></section>
    `;
}

function renderNonconformitiesPage() {
  const all = state.nonconformities.records ?? [];
  const month = today().slice(0, 7);
  const records = all.filter(record => record.date.startsWith(month)).sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  const open = records.filter(record => !/^выполнено$/i.test(record.status)).length;
  const categories = new Set(records.map(record => record.category).filter(Boolean));
  const canWrite = ["manager", "senior"].includes(state.account?.role);
  return `<section class="section-heading"><div><p class="eyebrow">Google Sheets · журнал и сводка</p><h2>Несоответствия</h2><p>Показан текущий месяц. Дата и смена берутся из табеля; виды несоответствий — из рабочего справочника.</p></div><div class="header-actions"><button class="secondary-button" data-action="refresh-nonconformities" ${state.nonconformityLoading ? "disabled" : ""}>${state.nonconformityLoading ? "Обновляем…" : "Обновить"}</button>${canWrite ? `<button class="primary-button" data-action="add-nonconformity">+ Новое несоответствие</button>` : ""}</div></section>
    ${state.nonconformities.error ? `<p class="form-error">${escapeHtml(state.nonconformities.error)}</p>` : ""}
    <div class="dashboard-grid production-metrics nonconformity-metrics"><article class="metric-card"><span>За текущий месяц</span><strong>${records.length}</strong><small>записей</small></article><article class="metric-card"><span>Требуют завершения</span><strong>${open}</strong><small>статус не «Выполнено»</small></article><article class="metric-card"><span>Категории</span><strong>${categories.size}</strong><small>за текущий месяц</small></article></div>
    <section class="card table-card nonconformity-table-card"><div class="table-toolbar"><div><span class="eyebrow">Текущий период</span><strong>${monthTitle(month)}</strong></div><span class="status-pill neutral">${records.length} ${plural(records.length, "запись", "записи", "записей")}</span></div><div class="table-scroll"><table><thead><tr><th>Дата</th><th>Смена</th><th>Категория</th><th>Вид</th><th>Причина</th><th>Корректирующие действия</th><th>Ответственный</th><th>Статус</th>${canWrite ? "<th></th>" : ""}</tr></thead><tbody>${records.length ? records.map(record => `<tr><td>${formatDate(record.date)}</td><td><strong>${escapeHtml(record.shift)}</strong></td><td>${escapeHtml(record.category)}</td><td>${escapeHtml(record.type)}</td><td>${escapeHtml(record.cause)}</td><td>${escapeHtml(record.correctiveAction)}</td><td>${escapeHtml(record.responsible)}</td><td><span class="status-pill ${/^выполнено$/i.test(record.status) ? "success" : "warning"}">${escapeHtml(record.status)}</span></td>${canWrite ? `<td><div class="row-actions"><button class="small-button" data-action="edit-nonconformity" data-id="${attribute(record.id)}">Исправить</button><button class="more-button" data-action="delete-nonconformity" data-id="${attribute(record.id)}" title="Удалить">×</button></div></td>` : ""}</tr>`).join("") : `<tr><td colspan="${canWrite ? 9 : 8}">За текущий месяц записей нет.</td></tr>`}</tbody></table></div><footer class="nonconformity-table-footer"><span>Дата и смена привязаны к табелю.</span><span>Для подробностей используйте «Исправить».</span></footer></section>`;
}

function shortPackagingLabel(label) {
  return label.replace(", шт", "").replace(", рул", "");
}

function renderPackagingWarehousePage() {
  const { records, summary, error } = state.packagingWarehouse;
  const orderedRecords = [...records].sort((left, right) => `${right.date}-${right.id}`.localeCompare(`${left.date}-${left.id}`));
  const canWrite = ["manager", "senior"].includes(state.account?.role);
  const canEdit = state.account?.role === "manager";
  const actions = canWrite ? `<div class="header-actions"><button class="secondary-button" data-action="refresh-packaging-warehouse">Обновить</button>${journalLink("packagingWarehouse") }<button class="primary-button" data-action="add-packaging-stock">+ Новое движение</button></div>` : journalLink("packagingWarehouse");
  return `<section class="section-heading"><div><p class="eyebrow">Google Sheets · упаковочные материалы</p><h2>Склад упаковки</h2><p>Приход и расход сохраняются в общем журнале. Расчётный остаток считается автоматически, фактический заполняется при инвентаризации.</p>${error ? `<p class="form-error">${escapeHtml(error)}</p>` : ""}</div>${actions}</section>
    <section class="card table-card"><div class="table-toolbar"><strong>Остатки: расчёт и факт</strong><span>Общий склад</span></div><div class="table-scroll"><table><thead><tr><th>Наименование</th><th>Ед.</th><th>Начальный</th><th>Приход</th><th>Расход</th><th>Расчётный</th><th>Фактический</th><th>Разница</th><th>Комментарий</th></tr></thead><tbody>${summary.length ? summary.map(row => `<tr><td><strong>${escapeHtml(row.item)}</strong></td><td>${escapeHtml(row.unit || "—")}</td><td>${formatNumber(row.opening)}</td><td>${formatNumber(row.received)}</td><td>${formatNumber(row.issued)}</td><td><strong>${formatNumber(row.calculated)}</strong></td><td>${row.actual === null ? "—" : formatNumber(row.actual)}</td><td>${row.difference === null ? "—" : formatNumber(row.difference)}</td><td>${escapeHtml(row.note || "—")}</td></tr>`).join("") : '<tr><td colspan="9">Сводка склада ещё загружается.</td></tr>'}</tbody></table></div></section>
    <section class="card table-card"><div class="table-toolbar"><strong>Журнал движений</strong><span>${orderedRecords.length} ${plural(orderedRecords.length, "запись", "записи", "записей")}</span></div><div class="table-scroll"><table><thead><tr><th>Дата</th><th>Операция</th><th>Наименование</th><th>Количество</th><th>Примечание</th><th>Внёс</th>${canEdit ? "<th></th>" : ""}</tr></thead><tbody>${orderedRecords.length ? orderedRecords.map(record => `<tr><td>${formatDate(record.date)}</td><td><span class="status-pill ${record.type === "Приход" ? "success" : "warning"}">${escapeHtml(record.type)}</span></td><td>${escapeHtml(record.item)}</td><td><strong>${record.type === "Приход" ? "+" : "−"}${formatNumber(record.quantity)}</strong></td><td>${escapeHtml(record.note || "—")}</td><td>${escapeHtml(record.author || "—")}</td>${canEdit ? `<td><div class="row-actions"><button class="small-button" data-action="edit-packaging-stock" data-id="${attribute(record.id)}">Исправить</button><button class="more-button" data-action="delete-packaging-stock" data-id="${attribute(record.id)}" title="Удалить">×</button></div></td>` : ""}</tr>`).join("") : `<tr><td colspan="${canEdit ? 7 : 6}">Движений склада пока нет. Внесите первый приход или расход.</td></tr>`}</tbody></table></div></section>`;
}

function renderIncidentsPage() {
  const records = [...state.incidents].sort((left, right) => `${right.date}-${right.time}-${right.createdAt}`.localeCompare(`${left.date}-${left.time}-${left.createdAt}`));
  const open = records.filter(record => record.status !== "Закрыт").length;
  const canDelete = state.account?.role === "manager";
  return `<section class="section-heading"><div><p class="eyebrow">Локальный журнал · безопасность и работа участка</p><h2>Журнал регистрации инцидентов</h2><p>Фиксируйте событие сразу: что произошло, какие меры приняты и кому требуется завершить действие.</p></div><button class="primary-button" data-action="add-incident">+ Зарегистрировать инцидент</button></section>
    <div class="dashboard-grid production-metrics"><article class="metric-card"><span>Всего записей</span><strong>${records.length}</strong><small>в этом компьютере</small></article><article class="metric-card"><span>Требуют завершения</span><strong>${open}</strong><small>статус не «Закрыт»</small></article></div>
    <section class="card table-card"><div class="table-toolbar"><strong>Все инциденты</strong><span>${records.length} ${plural(records.length, "запись", "записи", "записей")}</span></div><div class="table-scroll"><table><thead><tr><th>Дата и время</th><th>Смена</th><th>Категория</th><th>Описание события</th><th>Принятые меры</th><th>Сообщил</th><th>Статус</th>${canDelete ? "<th></th>" : ""}</tr></thead><tbody>${records.length ? records.map(record => `<tr><td>${formatDate(record.date)}<br><small>${escapeHtml(record.time)}</small></td><td><strong>${escapeHtml(record.shift || "—")}</strong></td><td>${escapeHtml(record.category)}</td><td>${escapeHtml(record.description)}</td><td>${escapeHtml(record.action || "—")}</td><td>${escapeHtml(record.author)}</td><td><span class="status-pill ${record.status === "Закрыт" ? "success" : "warning"}">${escapeHtml(record.status)}</span></td>${canDelete ? `<td><button class="more-button" data-action="delete-incident" data-id="${attribute(record.id)}" title="Удалить">×</button></td>` : ""}</tr>`).join("") : `<tr><td colspan="${canDelete ? 8 : 7}">Инцидентов пока не зарегистрировано.</td></tr>`}</tbody></table></div></section>`;
}

function packagingUnit(field) {
  return field.label.includes(", рул") ? "рул." : "шт.";
}

function renderCyclonesPage() {
  const { records, operations, lastReadAt, error } = state.cyclones;
  const stats = cycloneStatistics(records, state.cycloneYear);
  const years = [...new Set([Number(today().slice(0, 4)), state.cycloneYear, ...records.map(r => Number(r.date.slice(0, 4)))])].sort((a, b) => b - a);
  const monthNames = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  const max = Math.max(1, ...stats.months);
  const status = error ? `Google недоступен: ${error}` : lastReadAt ? `Последнее чтение Google: ${formatDateTime(lastReadAt)}` : "Связь с Google ещё не проверена";
  return `<section class="card cyclone-heading"><div><h2>Очистка циклонов</h2><p>${escapeHtml(status)}</p>
    ${!APP_CONFIG.integration.googleWritesEnabled ? '<p class="cyclone-warning">Отправка в Google выключена. Новые записи сохраняются в очередь на этом компьютере.</p>' : ""}
    <p>В очереди: <strong>${operations.length}</strong>. ${operations.length ? "Эти записи ещё не подтверждены Google." : ""}</p></div>
    <div class="dialog-actions"><button class="secondary-button" data-action="sync-cyclones">Обновить и отправить очередь</button><button class="primary-button" data-action="new-cyclone">Записать очистку</button></div></section>
    <section class="card cyclone-statistics"><div><h3>Статистика</h3><label>Год <select data-cyclone-year>${years.map(y => `<option ${y === state.cycloneYear ? "selected" : ""}>${y}</option>`).join("")}</select></label>
    <p>Подтверждено Google: <strong>${stats.total}</strong></p>
    <table class="settings-data-table"><thead><tr><th>Месяц</th><th>Очисток</th></tr></thead><tbody>${stats.months.map((n, i) => `<tr><td>${monthNames[i]}</td><td>${n}</td></tr>`).join("")}</tbody></table>
    <h3>По сотрудникам</h3><table class="settings-data-table"><thead><tr><th>Сотрудник</th><th>Очисток</th></tr></thead><tbody>${stats.people.map(([name, n]) => `<tr><td>${escapeHtml(name)}</td><td>${n}</td></tr>`).join("") || '<tr><td colspan="2">Нет подтверждённых записей за год</td></tr>'}</tbody></table></div>
    <div><h3>Очистки по месяцам — ${state.cycloneYear}</h3><div class="cyclone-chart" role="img" aria-label="${attribute(stats.months.map((n, i) => `${monthNames[i]}: ${n}`).join(", "))}">${stats.months.map((n, i) => `<div class="cyclone-chart-column"><span>${n}</span><div class="cyclone-chart-track"><div style="height:${n / max * 100}%"></div></div><small>${monthNames[i]}</small></div>`).join("")}</div><p>${lastReadAt ? "Статистика рассчитана по последним прочитанным данным Google. Записи в очереди не включены." : "После подключения Google здесь появятся данные рабочего журнала."}</p></div></section>
    <section class="card settings-table-wrap"><h3>Записи журнала</h3><table class="settings-data-table"><thead><tr><th>Дата</th><th>Исполнитель</th><th>Состояние</th></tr></thead><tbody>${records.map(r => `<tr><td>${formatDate(r.date)}</td><td>${escapeHtml(r.performer)}</td><td>${r.syncState === "synced" ? "Подтверждено Google" : "Ожидает отправки"}${operations.find(o => o.record.id === r.id)?.error ? `<br><small>${escapeHtml(operations.find(o => o.record.id === r.id).error)}</small>` : ""}</td></tr>`).join("") || '<tr><td colspan="3">Записи ещё не загружены. Можно сохранить новую очистку в локальную очередь.</td></tr>'}</tbody></table></section>`;
}

function openMaintenanceDialog(journalType) {
  const isRepair = journalType === "repair";
  const journal = isRepair ? state.maintenance.repair : state.maintenance.service;
  const title = isRepair ? "Добавить запись о ремонте" : "Добавить запись о ТО";
  const machines = journal.machines ?? Array.from({ length: 16 }, (_, index) => index + 1);
  const performers = operationalAuthorNames().length ? operationalAuthorNames() : (journal.performers ?? []);
  const categories = journal.categories ?? [];
  const workByCategory = journal.workByCategory ?? {};
  const optionList = (items, placeholder) => `<option value="">${placeholder}</option>${items.map(item => `<option value="${attribute(item)}">${escapeHtml(item)}</option>`).join("")}`;
  const repairFields = isRepair ? `<div class="form-grid">${formField("maintenance-category", "Категория работ", `<select id="maintenance-category" name="category" required>${optionList(categories, "Выберите категорию")}</select>`)}</div>${formField("maintenance-work", "Виды работ", `<div id="maintenance-work-options" class="maintenance-work-options" aria-live="polite"><small>Сначала выберите категорию.</small></div>`, "Отметьте нужные работы маленькими квадратами. Каждая работа показана отдельной строкой; в Google будет одна общая запись.")}` : "";
  const dialog = createDialog(`<form class="dialog-card"><div class="dialog-heading"><div><p class="eyebrow">${isRepair ? "Журнал ремонта" : "Журнал ТО"}</p><h2>${title}</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
    <p>Запись будет сразу внесена в соответствующий лист рабочего журнала Google.</p>
    <div class="form-grid">${formField("maintenance-date", "Дата", `<input id="maintenance-date" name="date" type="date" value="${today()}" max="${today()}" required>`)}${formField("maintenance-machine", "Станок", `<select id="maintenance-machine" name="machine" required>${optionList(machines.map(machine => String(machine).padStart(2, "0")), "Выберите станок")}</select>`)}</div>
    ${repairFields}
    ${formField("maintenance-performer", "Исполнитель", `<select id="maintenance-performer" name="performer" required>${optionList(performers, "Выберите исполнителя")}</select>`)}
    ${formField("maintenance-note", "Примечание", `<textarea id="maintenance-note" name="note" rows="3" maxlength="5000" placeholder="При необходимости укажите детали выполненных работ"></textarea>`, "Для ремонта с пометкой «описать в примечании» поле обязательно.")}
    <p id="form-error" class="form-error" hidden></p><div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">Внести в журнал</button></div></form>`);
  const form = dialog.querySelector("form");
  const categorySelect = form.elements.category;
  const workOptions = form.querySelector("#maintenance-work-options");
  const renderWorkOptions = works => {
    workOptions.innerHTML = works.length ? works.map(work => `<label><input type="checkbox" name="work" value="${attribute(work)}"><span>${escapeHtml(work)}</span></label>`).join("") : "<small>Нет вариантов в справочнике.</small>";
  };
  if (isRepair) categorySelect.addEventListener("change", () => {
    const works = workByCategory[categorySelect.value] ?? [];
    renderWorkOptions(works);
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    if (isRepair) data.work = [...new Set(formData.getAll("work").map(value => String(value).trim()).filter(Boolean))].join("; ");
    if (isRepair && !data.work) { showFormError(form, new Error("Выберите хотя бы один вид работ.")); return; }
    if (isRepair && /описать в примечании/i.test(data.work || "") && !String(data.note || "").trim()) {
      showFormError(form, new Error("Для выбранного вида работ заполните примечание.")); return;
    }
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const response = await fetch(`${APP_CONFIG.integration.gatewayBaseUrl}/api/maintenance`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...data, journal: journalType, requestId: `maintenance-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.message || "Не удалось внести запись в журнал.");
      dialog.close(); await refreshMaintenance(); render();
      toast(isRepair ? "Запись о ремонте внесена в Google журнал." : "Запись ТО внесена в Google журнал.", "success");
    } catch (error) { showFormError(form, error); submit.disabled = false; }
  });
  dialog.showModal();
}

function openProductionDialog(record = null) {
  if (!record && !state.shift?.active) { toast("Сначала заполните табель и начните смену.", "warning"); return; }
  const present = presentShiftPersonnel();
  const packers = present.filter(person => person.role === "packer");
  const operators = present.filter(person => person.role === "mechanic-operator");
  const existingOperators = splitProductionParticipants(record?.operator);
  const packerNames = [...new Set([...packers.map(person => person.fullName), ...(record?.packer ? [record.packer] : [])])];
  const operatorNames = [...new Set([...operators.map(person => person.fullName), ...existingOperators])];
  if (!record && (!packers.length || !operators.length)) { toast("В табеле должны быть отмечены присутствующий упаковщик и механик-оператор.", "warning"); return; }
  const specifications = state.specifications.specifications ?? [];
  const strengths = [...new Set(specifications.map(item => Number(item.variant)).filter(Number.isFinite))].sort((a, b) => b - a);
  const optionList = (items, placeholder) => `<option value="">${placeholder}</option>${items.map(item => `<option value="${attribute(item)}">${escapeHtml(item)}</option>`).join("")}`;
  const dialog = createDialog(`<form class="dialog-card production-dialog"><div class="dialog-heading"><div><p class="eyebrow">Учёт продукции и брака</p><h2>${record ? "Исправить запись" : "Завершить продукт"}</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
    <p>Дата и смена подставляются из начатой смены в табеле. Упаковщик вносит только свой выпуск; общий итог линии программа сложит автоматически.</p>
    <div class="form-grid">${formField("production-date", "Дата", `<input id="production-date" name="date" type="date" value="${attribute(record?.date || today())}" readonly>`)}${formField("production-shift", "Смена", `<input id="production-shift" name="shift" value="${attribute(record?.shift || productionShiftCode())}" readonly>`)}${formField("production-start-time", "Время начала", `<input id="production-start-time" name="startTime" type="time" value="${attribute(record?.startTime || "")}" required>`)}${formField("production-time", "Время окончания", `<input id="production-time" name="time" type="time" value="${attribute(record?.time || "")}" required>`)}${formField("production-strength", "Крепость, mg/g", `<select id="production-strength" name="strength" required>${optionList(strengths, "Выберите крепость")}</select>`)}${formField("production-product-search", "Поиск продукта", `<input id="production-product-search" type="search" placeholder="Введите часть названия" disabled>`)}${formField("production-product", "Продукт", `<select id="production-product" name="product" required disabled><option value="">Сначала выберите крепость</option></select>`)}${formField("production-catalog-line", "Линейка", `<select id="production-catalog-line" name="catalogLine" required disabled><option value="">Сначала выберите продукт</option></select>`)}</div>
    <div class="form-grid">${formField("production-quantity", "Готовая продукция, шт", `<input id="production-quantity" name="quantity" type="number" min="0.001" step="0.001" required>`)}${formField("production-scrap", "Брак продукции, кг", `<input id="production-scrap" name="scrapKg" type="number" min="0" step="0.001" value="0" required>`)}${formField("production-can-scrap", "Брак банок, кг", `<input id="production-can-scrap" name="canScrapKg" type="number" min="0" step="0.001" value="0" required>`)}${formField("production-machine-line", "Линия (машина)", `<select id="production-machine-line" name="machineLine" required>${optionList(PRODUCTION_LINES, "Выберите линию")}</select>`)}</div>
    <div class="form-grid">${formField("production-packer", "Упаковщик (мой выпуск)", `<select id="production-packer" name="packer" required>${optionList(packerNames, "Выберите себя")}</select>`)}${formField("production-operator", "Механик-оператор", `<select id="production-operator" name="operator" required>${optionList(operatorNames, "Выберите механика-оператора")}</select>`)}${formField("production-operator-second", "Второй механик-оператор", `<select id="production-operator-second" name="operatorSecond"><option value="">Нет второго механика</option>${operatorNames.map(item => `<option value="${attribute(item)}">${escapeHtml(item)}</option>`).join("")}</select>`)}</div>
    ${formField("production-note", "Примечание", `<textarea id="production-note" name="note" rows="3" maxlength="5000" placeholder="При необходимости добавьте комментарий">${escapeHtml(record?.note || "")}</textarea>`) }
    <p id="form-error" class="form-error" hidden></p><div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">${record ? "Сохранить исправления" : "Сохранить в оба листа"}</button></div></form>`);
  const form = dialog.querySelector("form");
  const strength = form.elements.strength, product = form.elements.product, catalogLine = form.elements.catalogLine, search = form.querySelector("#production-product-search");
  const matching = () => specifications.filter(item => String(item.variant) === String(strength.value));
  const fillProducts = () => {
    const query = String(search.value || "").trim().toLocaleLowerCase("ru");
    const names = [...new Set(matching().map(item => item.product).filter(name => name.toLocaleLowerCase("ru").includes(query)))].sort((a, b) => a.localeCompare(b, "ru"));
    product.innerHTML = optionList(names, names.length ? "Выберите продукт" : "Нет подходящих продуктов"); product.disabled = !names.length; catalogLine.innerHTML = '<option value="">Сначала выберите продукт</option>'; catalogLine.disabled = true;
  };
  strength.addEventListener("change", () => { search.disabled = !strength.value; search.value = ""; fillProducts(); });
  search.addEventListener("input", fillProducts);
  product.addEventListener("change", () => {
    const lines = [...new Set(matching().filter(item => item.product === product.value).map(item => item.line))].sort((a, b) => a.localeCompare(b, "ru"));
    catalogLine.innerHTML = optionList(lines, lines.length ? "Выберите линейку" : "Нет вариантов"); catalogLine.disabled = !lines.length;
  });
  if (record) {
    strength.value = String(record.strength);
    search.disabled = false;
    fillProducts();
    product.value = record.product;
    product.dispatchEvent(new Event("change"));
    catalogLine.value = record.catalogLine || (catalogLine.options.length > 1 ? catalogLine.options[1].value : "");
    form.elements.quantity.value = record.quantity;
    form.elements.scrapKg.value = record.scrapKg;
    form.elements.canScrapKg.value = record.canScrapKg;
    form.elements.machineLine.value = record.line;
    form.elements.packer.value = record.packer;
    form.elements.operator.value = existingOperators[0] || "";
    form.elements.operatorSecond.value = existingOperators[1] || "";
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!catalogLine.value) { showFormError(form, new Error("Выберите линейку продукта")); return; }
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const people = { packers: packerNames, operators: operatorNames };
      const leadership = activeShiftLeadership();
      if (record) await productionService.update(record.id, { ...data, leadership }, people);
      else await productionService.create({ ...data, leadership, requestId: `production-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }, people);
      dialog.close(); await refreshProduction(); render(); toast(record ? "Исправления сохранены в обоих листах журнала." : "Запись сохранена в оба листа журнала.", "success");
    } catch (error) { showFormError(form, error); submit.disabled = false; }
  });
  dialog.showModal();
}

function openNonconformityDialog(record = null) {
  if (!record && !state.shift?.active) { toast("Сначала заполните табель и начните смену.", "warning"); return; }
  const people = [...new Set([...(operationalAuthorNames() ?? []), ...(record?.responsible ? [record.responsible] : [])])];
  const records = state.nonconformities.records ?? [];
  const categories = [...new Set(["Смесь", "Банка, крышка", "Вода", "Паучи", ...records.map(item => item.category)])].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  const types = state.nonconformities.dictionary?.types ?? [];
  const statuses = ["Выполнено", "В работе", "Ожидает решения"];
  const optionList = (items, placeholder) => `<option value="">${placeholder}</option>${items.map(item => `<option value="${attribute(item)}">${escapeHtml(item)}</option>`).join("")}`;
  const dialog = createDialog(`<form class="dialog-card production-dialog"><div class="dialog-heading"><div><p class="eyebrow">Журнал несоответствий</p><h2>${record ? "Исправить запись" : "Новое несоответствие"}</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
    <p>Дата и смена определяются по текущему табелю. Все поля сохраняются непосредственно в основной лист журнала.</p>
    <div class="form-grid">${formField("nonconf-date", "Дата", `<input id="nonconf-date" name="date" type="date" value="${attribute(record?.date || today())}" readonly>`)}${formField("nonconf-shift", "Смена", `<input id="nonconf-shift" name="shift" value="${attribute(record?.shift || productionShiftCode())}" readonly>`)}${formField("nonconf-category", "Категория", `<select id="nonconf-category" name="category" required>${optionList(categories, "Выберите категорию")}</select>`)}${formField("nonconf-type", "Вид несоответствия", `<select id="nonconf-type" name="type" required>${optionList(types, "Выберите вид")}</select>`)}</div>
    ${formField("nonconf-cause", "Причина появления", `<textarea id="nonconf-cause" name="cause" rows="3" maxlength="5000" required></textarea>`)}
    ${formField("nonconf-action", "Корректирующие действия", `<textarea id="nonconf-action" name="correctiveAction" rows="3" maxlength="5000" required></textarea>`)}
    <div class="form-grid">${formField("nonconf-responsible", "Ответственный", `<select id="nonconf-responsible" name="responsible" required>${optionList(people, "Выберите присутствующего")}</select>`)}${formField("nonconf-status", "Отметка о выполнении", `<select id="nonconf-status" name="status" required>${optionList(statuses, "Выберите статус")}</select>`)}</div>
    <p id="form-error" class="form-error" hidden></p><div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">${record ? "Сохранить исправления" : "Внести в журнал"}</button></div></form>`);
  const form = dialog.querySelector("form");
  if (record) { form.elements.category.value = record.category; form.elements.type.value = record.type; form.elements.cause.value = record.cause; form.elements.correctiveAction.value = record.correctiveAction; form.elements.responsible.value = record.responsible; form.elements.status.value = record.status; }
  form.addEventListener("submit", async event => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(form)); const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try { if (record) await nonconformityService.update(record.id, data, people); else await nonconformityService.create({ ...data, requestId: `nonconformity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }, people); dialog.close(); await refreshNonconformities(); render(); toast(record ? "Исправления сохранены в журнале." : "Несоответствие внесено в журнал.", "success"); }
    catch (error) { showFormError(form, error); submit.disabled = false; }
  });
  dialog.showModal();
}

function openCycloneDialog() {
  const names = operationalAuthorNames();
  const dialog = createDialog(`<form class="dialog-card small-dialog"><div class="dialog-heading"><h2>Записать очистку циклонов</h2><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
    ${formField("cyclone-date", "Дата очистки", `<input id="cyclone-date" name="date" type="date" value="${today()}" max="${today()}" required>`)}
    ${formField("cyclone-performer", "Кто выполнил очистку", `<select id="cyclone-performer" name="performer" required><option value="">Выберите сотрудника</option>${names.map(name => `<option>${escapeHtml(name)}</option>`).join("")}</select>`)}
    <p>Запись сначала сохранится на этом компьютере. Подтверждение Google появится после успешной отправки.</p>
    <p id="form-error" class="form-error" hidden></p><div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">Сохранить очистку</button></div></form>`);
  let saving = false;
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    const form = event.currentTarget;
    form.querySelector('[type="submit"]').disabled = true;
    try {
      await cycloneService.create(Object.fromEntries(new FormData(form)), state.account, names);
      dialog.close();
      state.cyclones = await cycloneService.snapshot();
      render();
      toast("Очистка сохранена на этом компьютере. Ожидает подтверждения Google.", "success");
      if (navigator.onLine) { await refreshCyclones(true); render(); }
    } catch (error) {
      showFormError(form, error);
      saving = false;
      form.querySelector('[type="submit"]').disabled = false;
    }
  });
  dialog.showModal();
}

function filterSpecifications(specifications, selection, ignoredField = "") {
  return specifications.filter(item => ["line", "product", "variant"].every(field => {
    if (field === ignoredField || !selection[field]) return true;
    return String(item[field]) === String(selection[field]);
  }));
}

function uniqueSpecificationValues(specifications, field) {
  const values = [...new Set(specifications.map(item => String(item[field] ?? "")).filter(Boolean))];
  return field === "variant"
    ? values.sort((a, b) => Number(b) - Number(a))
    : values.sort((a, b) => a.localeCompare(b, "ru"));
}

function normalizeSpecificationSelection(specifications, selection, lockedField) {
  const next = { line: selection.line || "", product: selection.product || "", variant: selection.variant || "" };
  for (const field of ["line", "product", "variant"]) {
    if (field === lockedField || !next[field]) continue;
    if (!filterSpecifications(specifications, next).length) next[field] = "";
  }
  return next;
}

function specificationUsageKey(item) {
  return `${String(item.product ?? "").trim().toLocaleLowerCase("ru")}::${String(item.variant ?? item.strength ?? "").trim()}`;
}

function specificationUsageFrequency(records) {
  return records.reduce((frequency, record) => {
    const key = specificationUsageKey(record);
    if (key !== "::") frequency.set(key, (frequency.get(key) || 0) + 1);
    return frequency;
  }, new Map());
}

function renderSpecificationsPage() {
  const all = state.specifications?.specifications ?? [];
  const selection = state.specificationSelection;
  const query = state.specificationSearch.trim().toLocaleLowerCase("ru");
  const optionsFor = field => uniqueSpecificationValues(filterSpecifications(all, selection, field), field);
  const lines = optionsFor("line");
  const products = optionsFor("product");
  const variants = optionsFor("variant");
  const selectedCandidates = filterSpecifications(all, selection);
  const selected = selectedCandidates.length === 1 ? selectedCandidates[0] : null;
  const matching = filterSpecifications(all.filter(item => !query || [item.line, item.product, item.variant, item.processType, item.canType, item.lidColor].some(value => String(value ?? "").toLocaleLowerCase("ru").includes(query))), selection);
  const hasSelection = Object.values(selection).some(Boolean);
  const frequency = specificationUsageFrequency(state.production?.records ?? []);
  const catalog = [...matching].sort((a, b) => (frequency.get(specificationUsageKey(b)) || 0) - (frequency.get(specificationUsageKey(a)) || 0) || String(a.product).localeCompare(String(b.product), "ru") || String(a.line).localeCompare(String(b.line), "ru") || Number(b.variant) - Number(a.variant));
  const sourceLabel = state.specifications?.source === "google" ? "Google Sheets" : state.specifications?.source === "cache" ? "Офлайн-копия" : state.specifications?.source === "demo" ? "Демонстрационные данные" : "Источник недоступен";
  const error = state.specifications?.error ? `<p class="module-note">${escapeHtml(state.specifications.error)}. Можно открыть последнюю сохранённую копию при следующем запуске.</p>` : "";
  const canEdit = state.account?.role === "manager" && APP_CONFIG.integration.googleWritesEnabled;
  return `<section class="module-header card"><div><p class="eyebrow">${escapeHtml(sourceLabel)} · утверждённые нормы</p><h2>Спецификация продуктов</h2><p>${canEdit ? "Добавляйте и исправляйте продукты прямо в программе. Каталог обновляется из Google Sheets без ручного переноса." : "Рабочий каталог продуктов и технологических норм. Только просмотр."}</p></div><div class="header-actions"><button class="secondary-button" data-action="refresh-specifications">↻ Обновить каталог</button>${canEdit ? `<button class="primary-button" data-action="add-specification">+ Добавить продукт</button>` : ""}<a class="quiet-link" href="https://docs.google.com/spreadsheets/d/${PRODUCT_SPECIFICATION_SOURCE.spreadsheetId}/edit" target="_blank" rel="noreferrer">Источник Google ↗</a></div></section>
    ${error}
    <section class="card specification-picker"><div class="catalog-search-row"><label class="personnel-search"><span>Поиск по каталогу</span><input type="search" value="${attribute(state.specificationSearch)}" data-specification-search placeholder="Название продукта, линейка, mg/g, банка или крышка" autocomplete="off"></label><span class="status-pill neutral">${matching.length} из ${all.length} позиций</span></div><div class="form-grid">
      ${formField("spec-line", "Линейка", `<select id="spec-line" data-specification-select="line"><option value="">Все линейки</option>${lines.map(line => `<option value="${attribute(line)}" ${selection.line === line ? "selected" : ""}>${escapeHtml(line)}</option>`).join("")}</select>`)}
      ${formField("spec-product", "Продукт", `<select id="spec-product" data-specification-select="product"><option value="">Все продукты</option>${products.map(product => `<option value="${attribute(product)}" ${selection.product === product ? "selected" : ""}>${escapeHtml(product)}</option>`).join("")}</select>`)}
      ${formField("spec-variant", "mg/g", `<select id="spec-variant" data-specification-select="variant"><option value="">Все варианты</option>${variants.map(variant => `<option value="${attribute(variant)}" ${selection.variant === variant ? "selected" : ""}>${escapeHtml(variant)}</option>`).join("")}</select>`)}
    </div></section>
    <section class="specification-workspace"><section class="card specification-catalog"><div class="section-heading"><div><p class="eyebrow">Каталог</p><h2>${query || hasSelection ? "Результаты выбора" : "Быстрый выбор"}</h2>${query || hasSelection ? "" : "<p>Сначала — позиции, которые чаще всего встречаются в журнале продукции.</p>"}</div><span class="status-pill neutral">${Math.min(catalog.length, 12)} показано</span></div><div class="specification-result-list">${catalog.slice(0, 12).map(item => `<button class="specification-result ${selected?.id === item.id ? "selected" : ""}" data-action="select-specification" data-id="${attribute(item.id)}"><span><strong>${escapeHtml(item.product)}</strong><small>${escapeHtml(item.line)}</small></span><span><b>${escapeHtml(String(item.variant))}</b><small>mg/g · ${escapeHtml(item.processType || "—")}</small></span></button>`).join("") || '<div class="empty-state compact"><span>⌕</span><p>По этому запросу продуктов нет</p></div>'}</div>${catalog.length > 12 ? `<p class="module-note">Уточните поиск или выберите любой фильтр: найдено ещё ${catalog.length - 12} позиций.</p>` : ""}</section>
      <div>${selected ? renderSpecificationCard(selected, canEdit) : `<section class="card empty-state specification-empty"><span>⌁</span><h3>${all.length ? "Выберите позицию" : "Спецификации пока не загружены"}</h3><p>${all.length ? "Найдите продукт или выберите его из каталога — здесь сразу появятся технологические нормы и упаковка." : "Проверьте подключение к Google и обновите каталог."}</p></section>`}</div>
    </section>
    <p class="module-note">Источник — Google Sheets. Новые продукты и изменения появляются после обновления каталога; исходные названия и пустые нормы сухих продуктов сохраняются без изменений.</p>`;
}

function renderSpecificationCard(specification, canEdit = false) {
  const value = number => number === null || number === undefined ? "—" : formatNumber(number);
  return `<section class="specification-detail card"><div class="section-heading"><div><p class="eyebrow">${escapeHtml(specification.line)}</p><h2>${escapeHtml(specification.product)}</h2><p class="specification-variant">${escapeHtml(String(specification.variant))} mg/g</p></div><div class="header-actions"><span class="status-pill success">${escapeHtml(specification.processType || "Тип не указан")}</span>${canEdit ? `<button class="small-button" data-action="edit-specification" data-id="${attribute(specification.id)}">Изменить</button><button class="small-button danger-outline" data-action="delete-specification" data-id="${attribute(specification.id)}">Удалить</button>` : ""}</div></div><dl class="specification-values">
    <div><dt>Вес сухого продукта</dt><dd>${value(specification.dryMass)} г</dd></div><div><dt>Вес мокрого продукта</dt><dd>${value(specification.wetMass)} г</dd></div><div><dt>Жидкость</dt><dd>${value(specification.liquidVolume)} мл</dd></div><div><dt>Подушек в банке</dt><dd>${value(specification.pouchCount)}</dd></div><div><dt>Цвет крышки</dt><dd>${escapeHtml(specification.lidColor || "—")}</dd></div><div><dt>Вид банки</dt><dd>${escapeHtml(specification.canType || "—")}</dd>
  </dl></section>`;
}

function journalLink(key, label = "Открыть в Google Sheets") {
  const journal = WORKSPACE_JOURNALS[key];
  if (!journal) return "";
  return `<a class="secondary-button journal-link" href="https://docs.google.com/spreadsheets/d/${journal.id}/edit" target="_blank" rel="noreferrer">${escapeHtml(label)} ↗</a>`;
}

function renderRecordRow(record) {
  const isAnnulled = record.status === "Аннулировано";
  const resultClass = record.result === "Вне допуска" ? "danger" : "success";
  return `
    <tr class="${isAnnulled ? "annulled-row" : ""}">
      <td><strong>${formatDate(record.date)}</strong><small>${record.source === "demo" ? "Демонстрационная запись" : ""}</small></td>
      <td>${escapeHtml(record.scaleName)}</td>
      <td><strong>${formatNumber(record.actual)} г</strong><small>Номинал ${formatNumber(record.nominal)} г</small></td>
      <td class="mono">${signedNumber(record.deviation)} г</td>
      <td><span class="status-pill ${resultClass}">${escapeHtml(record.result)}</span></td>
      <td>${escapeHtml(record.performer)}</td>
      <td>${recordStatus(record)}</td>
      <td>
        <div class="row-actions">
          ${!isAnnulled ? `<button class="small-button" data-action="edit-record" data-id="${record.id}">Исправить</button><button class="more-button" data-action="annul-record" data-id="${record.id}" title="Аннулировать">×</button>` : ""}
        </div>
      </td>
    </tr>`;
}

function renderCompactRecords(records) {
  if (!records.length) return `<div class="empty-state compact"><span>◎</span><p>Записей пока нет</p></div>`;
  return `<div class="compact-list">${records.map(record => `
    <div class="compact-record">
      <span class="result-mark ${record.result === "Вне допуска" ? "danger" : "success"}">${record.result === "Вне допуска" ? "!" : "✓"}</span>
      <span><strong>${escapeHtml(record.scaleName)} · ${formatNumber(record.actual)} г</strong><small>${formatDate(record.date)} · ${escapeHtml(record.performer)}</small></span>
      ${recordStatus(record)}
    </div>`).join("")}</div>`;
}

function renderSyncPage() {
  const conflicts = state.operations.filter(item => item.state === "conflict");
  const pending = state.operations.filter(item => item.state === "pending");
  const workforcePending = state.workforce?.pending ?? [];
  const workforceConflicts = workforcePending.filter(item => item.status === "conflict" || item.status === "error");
  return `
    <div class="sync-summary card">
      <div class="sync-illustration ${navigator.onLine ? "online" : "offline"}">${syncLargeIcon()}</div>
      <div class="sync-copy">
        <p class="eyebrow">Передача данных</p>
        <h2>${navigator.onLine ? "Подключение есть" : "Работа без интернета"}</h2>
        <p>${!APP_CONFIG.integration.googleWritesEnabled ? "Отправка в Google выключена. Локальная очередь ожидает разрешения на запись." : navigator.onLine ? "Программа готова автоматически отправлять новые записи." : "Можно продолжать работу. Всё сохранится на этом компьютере и отправится позже."}</p>
      </div>
      <button class="primary-button" data-action="sync" ${state.syncing ? "disabled" : ""}>${state.syncing ? "Отправляем…" : "Синхронизировать"}</button>
    </div>
    <div class="metric-grid three">
       ${metricCard("В очереди", pending.length + workforcePending.length, "Ожидает отправки", pending.length + workforcePending.length ? "warning" : "neutral")}
       ${metricCard("Конфликты", conflicts.length + workforceConflicts.length, conflicts.length + workforceConflicts.length ? "Нужно выбрать версию" : "Конфликтов нет", conflicts.length + workforceConflicts.length ? "danger" : "success")}
      ${metricCard("Последнее обновление", state.lastRefresh ? formatDateTime(state.lastRefresh) : "—", "Автоматически каждые 60 секунд", "neutral", true)}
    </div>
    <section class="card queue-card">
      <div class="section-heading"><div><p class="eyebrow">Локальная очередь</p><h2>Неотправленные изменения</h2></div></div>
       ${state.operations.length || workforcePending.length ? `<div class="queue-list">${state.operations.map(renderOperation).join("")}${workforcePending.map(renderWorkforceOperation).join("")}</div>` : `<div class="empty-state"><span>✓</span><h3>Всё отправлено</h3><p>На этом компьютере нет ожидающих изменений.</p></div>`}
    </section>`;
}

function renderOperation(operation) {
  const record = operation.record;
  return `<div class="queue-item">
    <span class="queue-icon ${operation.state}">${operation.state === "conflict" ? "!" : "↥"}</span>
    <span><strong>${escapeHtml(record.scaleName)} · ${formatNumber(record.actual)} г</strong><small>${operationLabel(operation.type)} · ${formatDateTime(operation.createdAt)}</small></span>
    <span class="status-pill ${operation.state === "conflict" ? "danger" : "warning"}">${operation.state === "conflict" ? "Конфликт" : "В очереди"}</span>
  </div>`;
}

function renderSettingsPage() {
  const language = LANGUAGES.find(item => item.code === state.language) ?? LANGUAGES[0];
  return `
    <section class="settings-hero card">
      <div><p class="eyebrow">Центр управления</p><h2>Настройки участка</h2><p>Здесь действительно настраиваются сотрудники, смены и правила табеля. Изменения сохраняются локально и будут подключены к рабочему источнику.</p></div>
      <span class="status-pill success">Только начальник</span>
    </section>
    <nav class="settings-tabs card" aria-label="Разделы настроек">
      ${settingsTabButton("overview", "Общие", settingsIcon())}
      ${settingsTabButton("personnel", "Персонал", personnelIcon(), personnel().length)}
      ${settingsTabButton("shifts", "Смены", attendanceIcon(), state.workforce.shiftTeams.length)}
      ${settingsTabButton("timesheet", "Табель", moduleIcon("documents"))}
    </nav>
    ${state.settingsTab === "personnel" ? renderPersonnelSettings() : state.settingsTab === "shifts" ? renderShiftSettings() : state.settingsTab === "timesheet" ? renderTimesheetSettings() : `
      <div class="settings-grid">
        <section class="card settings-section">
          <div class="section-heading"><div><p class="eyebrow">Интеграция</p><h2>Google Workspace</h2></div><span class="status-pill ${APP_CONFIG.integration.mode === "demo" ? "warning" : "success"}">${APP_CONFIG.integration.mode === "demo" ? "Тестовый режим" : "Рабочий шлюз"}</span></div>
          ${settingRow("Рабочая таблица", journal.sheetName, "Подключение подготовлено")}
          ${settingRow("Автообновление", "Каждую минуту", "Доступная проверенная версия устанавливается автоматически")}
          ${settingRow("Запись в Google", APP_CONFIG.integration.googleWritesEnabled ? "Включена" : "Выключена", APP_CONFIG.integration.googleWritesEnabled ? "Через защищённый шлюз" : "До контролируемой проверки")}
          ${settingRow("Часовой пояс", APP_CONFIG.timeZone, "Дата и время заполняются автоматически")}
        </section>
        <section class="card settings-section">
          <div class="section-heading"><div><p class="eyebrow">Программа</p><h2>Обновление</h2></div><span class="status-pill ${state.update.available ? "warning" : "success"}">${state.update.available ? "Доступно" : "Актуально"}</span></div>
          ${settingRow("Установлено", `Версия ${APP_CONFIG.version}`, state.update.checked ? (state.update.message || "Проверено при запуске") : "Проверяем наличие новой версии")}
          ${state.update.available ? `<p class="settings-copy">Доступна версия <b>${escapeHtml(state.update.version)}</b>. Она будет установлена автоматически не позднее чем через минуту. Настройки Google и локальная очередь сохранятся.</p>` : `<button class="secondary-button" data-action="check-update">Проверить сейчас</button>`}
        </section>
        <section class="card settings-section">
          <div class="section-heading"><div><p class="eyebrow">Интерфейс</p><h2>Язык и оформление</h2></div></div>
          ${settingRow("Язык", language.name, "RU · EN · LT")}
          ${settingRow("Тема", state.theme === "dark" ? "Тёмная" : "Светлая", "Переключается также в верхней панели")}
          ${settingRow("Дата и время", APP_CONFIG.timeZone, "Часы отображаются постоянно")}
        </section>
        <section class="card settings-section">
          <div class="section-heading"><div><p class="eyebrow">Доступ к программе</p><h2>Пароли учётных записей</h2></div><span class="status-pill warning">${APP_CONFIG.centralAuth ? "Центральный сервер" : "Только этот компьютер"}</span></div>
          <p class="settings-copy">${APP_CONFIG.centralAuth ? "Пароли едины для рабочих компьютеров. Чтобы изменить пароль, укажите текущий пароль выбранной учётной записи." : "Первоначальный пароль — <b>0000</b>. Чтобы изменить пароль, укажите текущий пароль выбранной учётной записи."}</p>
          <form class="settings-password-form" data-form="password-change">
            <label class="field"><span>Учётная запись</span><select name="accountId">${authService.availableAccounts().map(account => `<option value="${account.id}">${escapeHtml(account.title)}</option>`).join("")}</select></label>
            <label class="field"><span>Текущий пароль</span><input name="currentPassword" type="password" minlength="4" required autocomplete="current-password"></label>
            <label class="field"><span>Новый пароль</span><input name="nextPassword" type="password" minlength="4" required autocomplete="new-password"></label>
            <label class="field"><span>Повторите новый пароль</span><input name="repeatPassword" type="password" minlength="4" required autocomplete="new-password"></label>
            <button class="primary-button" type="submit">Сменить пароль</button>
          </form>
        </section>
        <section class="card settings-section wide">
          <div class="section-heading"><div><p class="eyebrow">Рабочая модель</p><h2>Персонал и графики перенесены</h2></div></div>
          <div class="settings-links">
            ${settingsLink("personnel", "Персонал", `${personnel().length} сотрудников`, personnelIcon())}
            ${settingsLink("attendance", "Табель", "График 2/2 и фактические часы", attendanceIcon())}
            ${settingsLink("vacations", "График отпусков", "Годовой календарь", moduleIcon("vacation"))}
          </div>
        </section>
      </div>`}`;
}

function settingsTabButton(tab, label, icon, count = "") {
  return `<button class="${state.settingsTab === tab ? "active" : ""}" data-action="settings-tab" data-tab="${tab}"><span>${icon}</span><strong>${label}</strong>${count !== "" ? `<b>${count}</b>` : ""}</button>`;
}

function renderPersonnelSettings() {
  const employees = personnel().sort(comparePersonnel);
  return `<section class="card settings-workforce-panel">
    <header><div><p class="eyebrow">Справочник</p><h2>Сотрудники участка</h2><p>Имя, должность, смена и активность используются во всех формах программы.</p></div><button class="primary-button" data-action="add-employee">+ Добавить сотрудника</button></header>
    <div class="settings-table-wrap"><table class="settings-data-table"><thead><tr><th>Сотрудник</th><th>Должность</th><th>Смена</th><th>Статус</th><th></th></tr></thead><tbody>${employees.map(employee => `<tr class="${employee.active === false ? "inactive" : ""}"><td><strong>${escapeHtml(employee.fullName)}</strong></td><td>${escapeHtml(roleLabel(employee.role))}</td><td><span class="table-team">${escapeHtml(teamLabel(employee.shiftTeamId))}</span></td><td>${employee.active === false ? "В архиве" : "Активен"}</td><td><div class="row-actions"><button class="small-button" data-action="edit-employee" data-id="${employee.id}">Изменить</button><button class="small-button" data-action="toggle-employee" data-id="${employee.id}">${employee.active === false ? "Вернуть" : "В архив"}</button></div></td></tr>`).join("")}</tbody></table></div>
  </section>`;
}

function renderShiftSettings() {
  return `<div class="shift-settings-grid">${state.workforce.shiftTeams.map(team => `<form class="card shift-settings-card" data-form="shift-settings">
    <input type="hidden" name="id" value="${team.id}">
    <header><span class="team-orb">${team.code}</span><div><p class="eyebrow">Рабочая смена</p><h2>${escapeHtml(team.name)}</h2></div></header>
    <div class="form-grid">
      ${formField(`team-name-${team.id}`, "Название", `<input id="team-name-${team.id}" name="name" value="${attribute(team.name)}" required>`, "Отображается в табеле", "full")}
      ${formField(`team-anchor-${team.id}`, "Первый рабочий день цикла", `<input id="team-anchor-${team.id}" name="anchorDate" type="date" value="${team.anchorDate}" required>`)}
      ${formField(`team-duration-${team.id}`, "Длительность смены", `<input id="team-duration-${team.id}" name="shiftDurationHours" type="number" min="1" max="24" value="${team.shiftDurationHours}" required>`, "часов на производстве")}
      ${formField(`team-accounting-${team.id}`, "К учёту", `<input id="team-accounting-${team.id}" name="accountingHours" type="number" min="1" max="24" value="${team.accountingHours}" required>`, "часов в табеле")}
    </div>
    <div class="shift-settings-summary"><span><b>2</b> рабочих дня</span><span><b>2</b> выходных дня</span><span><b>${activePersonnel().filter(employee => employee.shiftTeamId === team.id).length}</b> сотрудников</span></div>
    <footer><button class="primary-button" type="submit">Сохранить смену</button></footer>
  </form>`).join("")}</div>`;
}

function renderTimesheetSettings() {
  return `<div class="settings-grid">
    <section class="card settings-section wide"><div class="section-heading"><div><p class="eyebrow">Коды табеля</p><h2>Причины отсутствия</h2></div><button class="secondary-button" data-action="navigate" data-page="attendance">Открыть табель</button></div><div class="attendance-code-settings">${ATTENDANCE_CODES.map(item => `<div class="tone-${item.tone}"><b>${item.value}</b><span><strong>${item.label}</strong><small>${item.value === "11" ? "Норма для смен A и B" : "Выбирается в ячейке табеля"}</small></span></div>`).join("")}</div></section>
    <section class="card settings-section"><div class="section-heading"><div><p class="eyebrow">Администрация</p><h2>График 5/2</h2></div></div>${settingRow("Рабочий день", "8 часов", "Понедельник — пятница")}${settingRow("Праздники", "Литва", "По производственному календарю")}</section>
    <section class="card settings-section"><div class="section-heading"><div><p class="eyebrow">Производство</p><h2>График 2/2</h2></div></div>${settingRow("Смена", "12 часов", "Фактическая длительность")}${settingRow("К учёту", "11 часов", "Норма табеля")}</section>
  </div>`;
}

function openScaleWalkDialog() {
  const walk = {
    date: today(),
    performer: "",
    index: 0,
    readings: new Map(),
    skipped: new Set()
  };
  const dialog = createDialog(`<section class="dialog-card scale-walk-dialog"><div class="scale-walk-shell"></div></section>`);
  const shell = dialog.querySelector(".scale-walk-shell");

  function renderSetup() {
    shell.innerHTML = `
      <form class="scale-walk-setup">
        <div class="dialog-heading"><div><p class="eyebrow">Быстрый ввод</p><h2>Обход 13 весов</h2></div><button type="button" class="dialog-close" data-action="close-dialog" aria-label="Закрыть">×</button></div>
        <div class="walk-intro"><span>13</span><div><strong>Одно показание — один шаг</strong><p>Имя и дату указываем один раз. После каждого значения нажимайте Enter.</p></div></div>
        <div id="walk-error" class="form-error" hidden></div>
        <div class="form-grid">
          ${formField("walk-date", "Дата проверки", `<input id="walk-date" name="date" type="date" value="${attribute(walk.date)}" required>`)}
          ${formField("walk-performer", "Кто проводит проверку", `<select id="walk-performer" name="performer" required><option value="">Выберите имя и фамилию</option>${operationalAuthorNames().map(employee => `<option>${escapeHtml(employee)}</option>`).join("")}</select>`, "Только ответственный за текущую смену")}
        </div>
        <div class="walk-route">${SCALES.map(scale => `<span>${scale.code}</span>`).join("")}</div>
        <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button class="primary-button" type="submit">Начать с F1</button></div>
      </form>`;
    shell.querySelector("form").addEventListener("submit", event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      if (!data.date || !data.performer) {
        showWalkError("Укажите дату и выберите исполнителя");
        return;
      }
      walk.date = data.date;
      walk.performer = data.performer;
      renderStep();
    });
  }

  function renderStep() {
    const scale = SCALES[walk.index];
    const saved = walk.readings.get(scale.name);
    const percent = Math.round(((walk.index + 1) / SCALES.length) * 100);
    shell.innerHTML = `
      <div class="walk-step">
        <div class="walk-progress-row"><span>Весы ${walk.index + 1} из ${SCALES.length}</span><span><strong>${percent}%</strong><button type="button" class="dialog-close compact" data-action="close-dialog" aria-label="Закрыть обход">×</button></span></div>
        <div class="walk-progress-track"><i style="width:${percent}%"></i></div>
        <div class="walk-scale-heading"><span class="walk-scale-code">${scale.code}</span><div><p>${scale.manufacturer}</p><h2>${scale.model}</h2></div></div>
        <div class="walk-reference"><span>Контрольная гиря</span><strong>${formatNumber(journal.nominal)} г</strong><small>Допуск ±${formatNumber(journal.tolerance)} г</small></div>
        <label class="walk-reading"><span>Показание весов</span><div><input id="walk-reading" type="text" inputmode="decimal" autocomplete="off" value="${attribute(saved?.actual ?? "")}" placeholder="50,00"><b>г</b></div></label>
        <div id="walk-result" class="walk-live-result">Введите показание</div>
        <div id="walk-failure-fields" class="walk-failure-fields" hidden>
          <label class="field"><span>Состояние весов</span><select id="walk-condition"><option value="">Выберите состояние</option><option ${saved?.condition === "Рабочие" ? "selected" : ""}>Рабочие</option><option ${saved?.condition === "Нерабочие" ? "selected" : ""}>Нерабочие</option></select></label>
          <label class="field"><span>Комментарий обязателен</span><textarea id="walk-note" rows="2" placeholder="Что обнаружено и что сделано">${escapeHtml(saved?.note ?? "")}</textarea></label>
        </div>
        <div id="walk-error" class="form-error" hidden></div>
        <div class="walk-step-actions">
          <button type="button" class="secondary-button" data-walk-previous ${walk.index === 0 ? "disabled" : ""}>← Назад</button>
          <button type="button" class="text-button" data-walk-skip>Пропустить</button>
          <button type="button" class="primary-button" data-walk-next>${walk.index === SCALES.length - 1 ? "К проверке" : "Далее →"}</button>
        </div>
      </div>`;
    const input = shell.querySelector("#walk-reading");
    input.addEventListener("input", updatePreview);
    input.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      saveStep();
    });
    shell.querySelector("[data-walk-next]").addEventListener("click", saveStep);
    shell.querySelector("[data-walk-skip]").addEventListener("click", skipStep);
    shell.querySelector("[data-walk-previous]").addEventListener("click", () => {
      captureDraft();
      walk.index -= 1;
      renderStep();
    });
    updatePreview();
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  function currentReading() {
    const raw = shell.querySelector("#walk-reading")?.value.trim().replace(",", ".") ?? "";
    if (!raw) return null;
    const actual = Number(raw);
    if (!Number.isFinite(actual) || actual < 0) return null;
    const result = calculateResult(actual, journal.nominal, journal.tolerance);
    return {
      actual,
      deviation: Number((journal.nominal - actual).toFixed(3)),
      result,
      condition: result === "В пределах допуска" ? "Рабочие" : shell.querySelector("#walk-condition")?.value,
      note: shell.querySelector("#walk-note")?.value.trim() ?? ""
    };
  }

  function updatePreview() {
    const reading = currentReading();
    const result = shell.querySelector("#walk-result");
    const failureFields = shell.querySelector("#walk-failure-fields");
    result.className = "walk-live-result";
    if (!reading) {
      result.textContent = "Введите показание";
      failureFields.hidden = true;
      return;
    }
    const passed = reading.result === "В пределах допуска";
    result.classList.add(passed ? "passed" : "failed");
    result.innerHTML = `<strong>${passed ? "✓ В пределах допуска" : "! Вне допуска"}</strong><span>Отклонение ${signedNumber(reading.deviation)} г</span>`;
    failureFields.hidden = passed;
  }

  function captureDraft() {
    const reading = currentReading();
    if (!reading) return;
    walk.readings.set(SCALES[walk.index].name, reading);
    walk.skipped.delete(SCALES[walk.index].name);
  }

  function saveStep() {
    const reading = currentReading();
    if (!reading) {
      showWalkError("Введите корректное показание весов");
      shell.querySelector("#walk-reading")?.focus();
      return;
    }
    if (reading.result === "Вне допуска" && !reading.condition) {
      showWalkError("Для отклонения выберите состояние весов");
      shell.querySelector("#walk-condition")?.focus();
      return;
    }
    if (reading.result === "Вне допуска" && !reading.note) {
      showWalkError("Для отклонения укажите комментарий");
      shell.querySelector("#walk-note")?.focus();
      return;
    }
    const scale = SCALES[walk.index];
    walk.readings.set(scale.name, reading);
    walk.skipped.delete(scale.name);
    if (walk.index === SCALES.length - 1) renderReview();
    else { walk.index += 1; renderStep(); }
  }

  function skipStep() {
    const scale = SCALES[walk.index];
    walk.readings.delete(scale.name);
    walk.skipped.add(scale.name);
    if (walk.index === SCALES.length - 1) renderReview();
    else { walk.index += 1; renderStep(); }
  }

  function renderReview() {
    const readings = [...walk.readings.entries()];
    const failed = readings.filter(([, reading]) => reading.result === "Вне допуска").length;
    shell.innerHTML = `
      <div class="walk-review">
        <div class="dialog-heading"><div><p class="eyebrow">Проверка перед сохранением</p><h2>Обход завершён</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
        <div class="walk-review-summary"><div><span>Проверено</span><strong>${readings.length}</strong></div><div><span>Пропущено</span><strong>${walk.skipped.size}</strong></div><div class="${failed ? "danger" : "success"}"><span>Вне допуска</span><strong>${failed}</strong></div></div>
        <div class="walk-review-list">${SCALES.map(scale => {
          const reading = walk.readings.get(scale.name);
          if (!reading) return `<button type="button" data-review-scale="${scale.name}" class="skipped"><b>${scale.code}</b><span>Пропущено</span><strong>Изменить</strong></button>`;
          const passed = reading.result === "В пределах допуска";
          return `<button type="button" data-review-scale="${scale.name}" class="${passed ? "passed" : "failed"}"><b>${scale.code}</b><span>${formatNumber(reading.actual)} г · ${passed ? "В допуске" : "Вне допуска"}</span><strong>Изменить</strong></button>`;
        }).join("")}</div>
        <div id="walk-error" class="form-error" hidden></div>
        <div class="dialog-actions"><button type="button" class="secondary-button" data-review-back>← Вернуться</button><button type="button" class="primary-button" data-save-walk ${readings.length ? "" : "disabled"}>Сохранить ${readings.length} ${plural(readings.length, "запись", "записи", "записей")}</button></div>
      </div>`;
    shell.querySelectorAll("[data-review-scale]").forEach(button => button.addEventListener("click", () => {
      walk.index = SCALES.findIndex(scale => scale.name === button.dataset.reviewScale);
      renderStep();
    }));
    shell.querySelector("[data-review-back]").addEventListener("click", () => { walk.index = SCALES.length - 1; renderStep(); });
    shell.querySelector("[data-save-walk]")?.addEventListener("click", saveWalk);
  }

  async function saveWalk() {
    const button = shell.querySelector("[data-save-walk]");
    button.disabled = true;
    try {
      const entries = [...walk.readings.entries()].map(([scaleName, reading]) => ({
        date: walk.date,
        scaleName,
        actual: reading.actual,
        condition: reading.condition,
        performer: walk.performer,
        note: reading.note
      }));
      await journalService.createBatch(entries, state.account);
      if (state.shift?.active && state.shift.requiresScaleControl) {
        state.shift = await shiftService.completeScaleControl(entries.length);
      }
      dialog.close();
      await reloadLocalState();
      render();
      toast(entries.length === SCALES.length
        ? (state.shift?.requiresScaleControl ? "Все 13 весов проверены. Рабочие разделы открыты." : "Все 13 весов проверены и сохранены.")
        : `Сохранено показаний: ${entries.length}. Для завершения контроля нужны все 13 весов.`, entries.length === SCALES.length ? "success" : "warning");
      syncInBackground();
    } catch (error) {
      showWalkError(error.message || "Не удалось сохранить обход");
      button.disabled = false;
    }
  }

  function showWalkError(message) {
    const error = shell.querySelector("#walk-error");
    if (!error) return;
    error.hidden = false;
    error.textContent = message;
  }

  renderSetup();
  dialog.showModal();
}

function openRecordDialog(id = null) {
  const existing = id ? state.records.find(item => item.id === id) : null;
  const values = existing ?? journalService.emptyForm();
  const dialog = createDialog(`
    <form id="record-form" class="dialog-card">
      <div class="dialog-heading">
        <div><p class="eyebrow">${existing ? "Исправление записи" : "Новая запись"}</p><h2>${journal.title}</h2></div>
        <button type="button" class="dialog-close" data-action="close-dialog" aria-label="Закрыть">×</button>
      </div>
      <div class="form-notice"><span>i</span><p>Исполнителя необходимо выбрать перед каждым сохранением. Дата заполняется автоматически, но её можно исправить.</p></div>
      <div id="form-error" class="form-error" hidden></div>
      <div class="form-grid">
        ${formField("date", "Дата проверки", `<input id="date" name="date" type="date" value="${attribute(values.date)}" required />`)}
        ${formField("scaleName", "Весы", `<select id="scaleName" name="scaleName" required>${journal.scaleOptions.map(option => `<option ${option === values.scaleName ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`)}
        ${formField("actual", "Фактический вес, г", `<input id="actual" name="actual" type="number" inputmode="decimal" step="0.001" min="0" value="${attribute(values.actual)}" placeholder="Например, 50,000" required />`, "Номинал: 50 г")}
        ${formField("condition", "Состояние весов", `<select id="condition" name="condition"><option ${values.condition === "Рабочие" ? "selected" : ""}>Рабочие</option><option ${values.condition === "Нерабочие" ? "selected" : ""}>Нерабочие</option></select>`)}
        ${formField("performer", "Кто внёс данные", `<select id="performer" name="performer" required><option value="">Выберите имя и фамилию</option>${operationalAuthorNames().map(employee => `<option ${employee === values.performer && !existing ? "selected" : ""}>${escapeHtml(employee)}</option>`).join("")}</select>`, "Только ответственный за текущую смену", "full")}
        ${formField("note", "Примечание", `<textarea id="note" name="note" rows="3" placeholder="Необязательно">${escapeHtml(values.note)}</textarea>`, "", "full")}
      </div>
      <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">${existing ? "Сохранить исправление" : "Добавить запись"}</button></div>
    </form>`);

  const form = dialog.querySelector("#record-form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submitButton = form.querySelector("[type=submit]");
    submitButton.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    try {
      if (existing) await journalService.update(existing.id, data, state.account);
      else await journalService.create(data, state.account);
      dialog.close();
      await reloadLocalState();
      render();
      toast(existing ? "Исправление сохранено." : "Запись сохранена.", "success");
      syncInBackground();
    } catch (error) {
      showFormError(form, error);
      submitButton.disabled = false;
    }
  });
  dialog.showModal();
}

function openAnnulDialog(id) {
  const record = state.records.find(item => item.id === id);
  if (!record) return;
  const dialog = createDialog(`
    <form id="annul-form" class="dialog-card small-dialog">
      <div class="dialog-heading"><div><p class="eyebrow">Без удаления данных</p><h2>Аннулировать запись?</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
      <p class="dialog-lead">Запись ${formatDate(record.date)} · ${escapeHtml(record.scaleName)} останется в журнале и получит статус «Аннулировано».</p>
      <div id="form-error" class="form-error" hidden></div>
       ${formField("performer", "Кто аннулирует", `<select id="performer" name="performer" required><option value="">Выберите имя и фамилию</option>${operationalAuthorNames().map(employee => `<option>${escapeHtml(employee)}</option>`).join("")}</select>`)}
      ${formField("reason", "Причина", `<textarea id="reason" name="reason" rows="3" placeholder="Причина обязательна" required></textarea>`)}
      <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="danger-button">Аннулировать</button></div>
    </form>`);
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await journalService.annul(id, data.reason, data.performer, state.account);
      dialog.close();
      await reloadLocalState();
      render();
      toast("Запись аннулирована.", "success");
      syncInBackground();
    } catch (error) {
      showFormError(event.currentTarget, error);
    }
  });
  dialog.showModal();
}

function openEmployeeDialog(id = null) {
  if (state.account.role !== "manager") throw new Error("Редактировать справочник персонала может только Администрация.");
  const employee = id ? personnel().find(item => item.id === id) : null;
  const dialog = createDialog(`
    <form class="dialog-card employee-dialog" data-employee-form>
      <div class="dialog-heading"><div><p class="eyebrow">Справочник персонала</p><h2>${employee ? "Изменить сотрудника" : "Новый сотрудник"}</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
      <p class="dialog-lead">Основные данные используются в графике смен, табеле и списке исполнителей. Личные сведения доступны только Администрации.</p>
      <div id="form-error" class="form-error" hidden></div>
      <div class="form-grid">
        ${formField("employee-full-name", "Имя и фамилия", `<input id="employee-full-name" name="fullName" value="${attribute(employee?.fullName ?? "")}" autocomplete="off" required>`, "Как в рабочих документах", "full")}
        ${formField("employee-role", "Должность", `<select id="employee-role" name="role" required>${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}" ${employee?.role === role ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`)}
        ${formField("employee-team", "Смена", `<select id="employee-team" name="shiftTeamId" required><option value="office" ${employee?.shiftTeamId === "office" ? "selected" : ""}>Администрация · 5/2</option>${state.workforce.shiftTeams.map(team => `<option value="${team.id}" ${employee?.shiftTeamId === team.id ? "selected" : ""}>${escapeHtml(team.name)} · 2/2</option>`).join("")}</select>`)}
        <div class="pak-form-fields" data-pak-fields ${employee?.role === "packer" ? "" : "hidden"}>${formField("employee-pak-number", "Номер PAK", `<input id="employee-pak-number" name="pakNumber" value="${attribute(employee?.pakNumber ?? "")}" autocomplete="off">`)}${formField("employee-pak-code", "Код", `<input id="employee-pak-code" name="pakCode" value="${attribute(employee?.pakCode ?? "")}" autocomplete="off">`)}</div>
        ${formField("employee-birthday", "Дата рождения", `<input id="employee-birthday" name="birthday" type="date" value="${attribute(employee?.birthday ?? "")}">`)}
        ${formField("employee-hire-date", "Дата приёма", `<input id="employee-hire-date" name="hireDate" type="date" value="${attribute(employee?.hireDate ?? "")}">`)}
        ${formField("employee-phone", "Телефон", `<input id="employee-phone" name="phone" type="tel" value="${attribute(employee?.phone ?? "")}" autocomplete="tel">`)}
        ${formField("employee-email", "Электронная почта", `<input id="employee-email" name="email" type="email" value="${attribute(employee?.email ?? "")}" autocomplete="email">`)}
      </div>
      <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`);
  const roleControl = dialog.querySelector("[name=role]");
  const pakFields = dialog.querySelector("[data-pak-fields]");
  const syncPakFields = () => {
    const isPacker = roleControl.value === "packer";
    pakFields.hidden = !isPacker;
    pakFields.querySelectorAll("input").forEach(input => { input.disabled = !isPacker; if (!isPacker) input.value = ""; });
  };
  roleControl.addEventListener("change", syncPakFields);
  syncPakFields();
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      await withWorkforceActor(() => workforceService.saveEmployee({ ...data, id: employee?.id, active: employee?.active !== false }));
      state.workforce = await workforceService.snapshot();
      dialog.close();
      render();
      toast("Сотрудник сохранён.", "success");
      sendWorkforceInBackground();
    } catch (error) {
      showFormError(form, error);
      button.disabled = false;
    }
  });
  dialog.showModal();
}

function openSpecificationDialog(id = null) {
  if (state.account?.role !== "manager") throw new Error("Редактировать спецификации может только Администрация.");
  const specification = id ? state.specifications.specifications.find(item => item.id === id) : null;
  const value = (field) => specification?.[field] ?? "";
  const dialog = createDialog(`
    <form class="dialog-card employee-dialog" data-specification-form>
      <div class="dialog-heading"><div><p class="eyebrow">Спецификация продуктов</p><h2>${specification ? "Изменить продукт" : "Новый продукт"}</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
      <p class="dialog-lead">Пустые поля норм сохраняются пустыми. Все изменения сразу попадут в рабочую Google-таблицу.</p>
      <div id="form-error" class="form-error" hidden></div>
      <div class="form-grid">
        ${formField("specification-line", "Линейка", `<input id="specification-line" name="line" value="${attribute(value("line"))}" required>`)}
        ${formField("specification-product", "Продукт", `<input id="specification-product" name="product" value="${attribute(value("product"))}" required>`)}
        ${formField("specification-variant", "mg/g", `<input id="specification-variant" name="variant" type="number" step="0.1" min="0" value="${attribute(value("variant"))}" required>`)}
        ${formField("specification-process", "Сухой / мокрый", `<input id="specification-process" name="processType" value="${attribute(value("processType"))}">`)}
        ${formField("specification-dry", "Вес сухого продукта, г", `<input id="specification-dry" name="dryMass" type="number" step="0.01" min="0" value="${attribute(value("dryMass"))}">`)}
        ${formField("specification-wet", "Вес мокрого продукта, г", `<input id="specification-wet" name="wetMass" type="number" step="0.01" min="0" value="${attribute(value("wetMass"))}">`)}
        ${formField("specification-liquid", "Жидкость, мл", `<input id="specification-liquid" name="liquidVolume" type="number" step="0.01" min="0" value="${attribute(value("liquidVolume"))}">`)}
        ${formField("specification-pouches", "Подушек в банке", `<input id="specification-pouches" name="pouchCount" type="number" step="1" min="0" value="${attribute(value("pouchCount"))}">`)}
        ${formField("specification-lid", "Цвет крышки", `<input id="specification-lid" name="lidColor" value="${attribute(value("lidColor"))}">`)}
        ${formField("specification-can", "Вид банки", `<input id="specification-can" name="canType" value="${attribute(value("canType"))}">`)}
      </div>
      <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`);
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const saved = await productSpecificationService.save({ ...Object.fromEntries(new FormData(form)), id: specification?.id });
      state.specifications = await productSpecificationService.initialize();
      state.specificationSelection = { line: saved.line, product: saved.product, variant: String(saved.variant) };
      dialog.close(); render(); toast("Спецификация сохранена в Google Sheets.", "success");
    } catch (error) { showFormError(form, error); button.disabled = false; }
  });
  dialog.showModal();
}

async function deleteSpecification(id) {
  if (state.account?.role !== "manager") throw new Error("Удалять спецификации может только начальник участка.");
  const item = state.specifications.specifications.find(specification => specification.id === id);
  if (!item || !window.confirm(`Удалить спецификацию «${item.product} · ${item.variant} mg/g»?`)) return;
  try {
    await productSpecificationService.remove(id);
    state.specifications = await productSpecificationService.initialize();
    state.specificationSelection = { line: "", product: "", variant: "" };
    render(); toast("Спецификация удалена из Google Sheets.", "success");
  } catch (error) { toast(error.message || "Не удалось удалить спецификацию.", "error"); }
}

function openShiftGuestDialog() {
  const teamId = state.shift?.shiftTeamId ?? state.selectedShiftTeamId;
  const guests = activePersonnel()
    .filter(employee => (employee.shiftTeamId !== teamId || isSubstituteOnly(employee)) && !state.shiftGuests.some(item => item.employeeId === employee.id))
    .sort(comparePersonnel);
  const dialog = createDialog(`
    <form class="dialog-card small-dialog" data-shift-guest-form>
      <div class="dialog-heading"><div><p class="eyebrow">Подменный выход</p><h2>Добавить сотрудника другой смены или отдела</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
      <p class="dialog-lead">Сотрудник будет учтён в текущей смене. В табеле сохранятся часы и причина выхода.</p>
      <div class="form-grid">
        ${formField("shift-guest", "Сотрудник", `<select id="shift-guest" name="employeeId" required><option value="">Выберите сотрудника</option>${guests.map(employee => `<option value="${attribute(employee.id)}">${escapeHtml(employee.fullName)} · ${escapeHtml(teamById(employee.shiftTeamId)?.name ?? (employee.shiftTeamId === "office" ? "Другой отдел" : "Другая смена"))}</option>`).join("")}</select>`, "Только действующий персонал другой смены или отдела", "full")}
        ${formField("shift-guest-reason", "Причина выхода", `<select id="shift-guest-reason" name="substitutionReason" required><option value="">Выберите причину</option><option>Подработка</option><option>Производственная необходимость</option></select>`, "Будет указана в журнале табеля", "full")}
      </div>
      <div id="shift-guest-error" class="form-error" hidden></div>
      <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button class="primary-button" type="submit">Добавить в смену</button></div>
    </form>`);
  const form = dialog.querySelector("[data-shift-guest-form]");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    const employee = activePersonnel().find(item => item.id === String(data.get("employeeId") || ""));
    const substitutionReason = String(data.get("substitutionReason") || "");
    if (!employee || (employee.shiftTeamId === teamId && !isSubstituteOnly(employee)) || !substitutionReason) {
      showFormError(form, new Error("Выберите сотрудника другой смены или отдела и причину выхода"));
      return;
    }
    state.shiftGuests = [...state.shiftGuests.filter(item => item.employeeId !== employee.id), { employeeId: employee.id, substitutionReason, homeShiftTeamId: employee.shiftTeamId }];
    if (state.shift?.active) {
      submit.disabled = true;
      const guestAttendance = { employeeId: employee.id, status: "11", isSubstitute: true, substitutionReason, homeShiftTeamId: employee.shiftTeamId };
      const attendance = [...state.shift.attendance.filter(item => item.employeeId !== employee.id), guestAttendance];
      try {
        const save = () => workforceService.saveAttendance({ date: today(), shiftTeamId: teamId, employeeId: employee.id, value: "11", substitutionReason, homeShiftTeamId: employee.shiftTeamId });
        if (state.shift.supervisor) {
          workforceActor = { performer: state.shift.supervisor };
          await save();
        } else await withWorkforceActor(save, attendanceAuthorNames(teamId));
        state.shift = await shiftService.updateAttendance(attendance);
        state.shiftGuests = state.shiftGuests.filter(item => item.employeeId !== employee.id);
        sendWorkforceInBackground();
      } catch (error) {
        submit.disabled = false;
        showFormError(form, error);
        return;
      }
    }
    dialog.close();
    render();
    toast(`${employee.fullName} добавлен${state.shift?.active ? " в табель и" : " в состав"} текущей смены.`, "success");
  });
  dialog.showModal();
}

function renderBirthdayReminders() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const notices = personnel().filter(employee => employee.active !== false && employee.birthday).map(employee => {
    const birthday = new Date(employee.birthday);
    if (!Number.isFinite(birthday.getTime())) return null;
    let next = new Date(start.getFullYear(), birthday.getMonth(), birthday.getDate());
    if (next < start) next.setFullYear(next.getFullYear() + 1);
    const days = Math.round((next - start) / 86400000);
    return days === 0 || days === 3 || days === 7 ? { employee, days } : null;
  }).filter(Boolean);
  if (!notices.length) return "";
  return `<section class="card birthday-reminders"><p class="eyebrow">Напоминания начальника</p><h2>Дни рождения</h2>${notices.map(({ employee, days }) => `<div><strong>${escapeHtml(employee.fullName)}</strong><span>${days === 0 ? "Сегодня день рождения" : days === 3 ? "Через 3 дня" : "Через неделю"}</span></div>`).join("")}</section>`;
}

function renderWorkforceOperation(operation) {
  const conflict = operation.status === "conflict" || operation.status === "error";
  const labels = { personnel: "Персонал", shiftTeams: "Смены", attendance: "Табель", vacations: "График отпусков" };
  const retry = operation.kind === "attendance" && conflict
    ? `<button class="small-button" data-action="workforce-retry-missing-attendance" data-id="${attribute(operation.requestId)}">Отправить, если в Google пусто</button>` : "";
  return `<div class="queue-item"><span class="queue-icon ${conflict ? "conflict" : "pending"}">${conflict ? "!" : "↥"}</span><span><strong>${escapeHtml(labels[operation.kind] || "Журнал")}</strong><small>${escapeHtml(operation.actor?.performer || "Автор не указан")} · ${formatDateTime(operation.record?.updatedAt || new Date().toISOString())}</small></span><span class="status-pill ${conflict ? "danger" : "warning"}">${conflict ? "Конфликт" : "В очереди"}</span>${conflict ? `<span class="queue-actions">${retry}<button class="small-button" data-action="workforce-accept-remote" data-id="${attribute(operation.requestId)}">Оставить версию Google</button></span>` : ""}</div>`;
}

function openVacationDialog(id = null) {
  if (state.account.role !== "manager") throw new Error("График отпусков доступен для редактирования только начальнику участка.");
  const vacation = id ? (state.workforce.vacations || []).find(item => item.id === id) : null;
  const dialog = createDialog(`
    <form class="dialog-card employee-dialog" data-vacation-form>
      <div class="dialog-heading"><div><p class="eyebrow">График отпусков</p><h2>${vacation ? "Изменить период" : "Новый период"}</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
      <p class="dialog-lead">Один период — одна строка в рабочем журнале. Дни считаются автоматически.</p>
      <div id="form-error" class="form-error" hidden></div>
      <div class="form-grid">
        ${formField("vacation-year", "Год", `<select id="vacation-year" name="year" required>${WORKFORCE_YEARS.map(year => `<option value="${year}" ${Number(vacation?.year || WORKFORCE_YEARS[0]) === year ? "selected" : ""}>${year}</option>`).join("")}</select>`)}
        ${formField("vacation-person", "Сотрудник", `<select id="vacation-person" name="employeeId" required><option value="">Выберите сотрудника</option>${personnel().filter(isRegularAreaEmployee).sort(comparePersonnel).map(employee => `<option value="${attribute(employee.id)}" ${vacation?.employeeId === employee.id ? "selected" : ""}>${escapeHtml(employee.fullName)}</option>`).join("")}</select>`, "Можно выбрать сотрудника из архива для старой записи", "full")}
        ${formField("vacation-start", "Начало", `<input id="vacation-start" name="startDate" type="date" value="${attribute(vacation?.startDate || "")}" required>`)}
        ${formField("vacation-end", "Окончание", `<input id="vacation-end" name="endDate" type="date" value="${attribute(vacation?.endDate || "")}" required>`)}
        ${formField("vacation-status", "Статус", `<select id="vacation-status" name="status" required>${["Запланирован", "Согласован", "Использован", "Аннулирован"].map(status => `<option ${vacation?.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>`)}
        ${formField("vacation-note", "Примечание / причина", `<textarea id="vacation-note" name="note" rows="2" placeholder="Для аннулирования причина обязательна">${escapeHtml(vacation?.note || "")}</textarea>`, "Необязательно, кроме аннулирования", "full")}
      </div>
      <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`);
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await withWorkforceActor(() => workforceService.saveVacation({ ...Object.fromEntries(new FormData(form)), id: vacation?.id }));
      state.workforce = await workforceService.snapshot();
      dialog.close();
      render();
      toast("Период отпуска сохранён.", "success");
      sendWorkforceInBackground();
    } catch (error) {
      showFormError(form, error);
      button.disabled = false;
    }
  });
  dialog.showModal();
}

function withWorkforceActor(action, allowedNames = employeeNames()) {
  if (!workforceRepository) return action();
  return chooseWorkforceActor(allowedNames).then(async performer => {
    workforceActor = { performer };
    return action();
  });
}

function chooseWorkforceActor(allowedNames = employeeNames()) {
  const names = [...new Set(allowedNames)].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
  if (!names.length) return Promise.reject(new Error("Сначала добавьте сотрудника в журнал «Персонал»"));
  return new Promise((resolve, reject) => {
    const dialog = createDialog(`
      <form class="dialog-card small-dialog" data-performer-form>
        <div class="dialog-heading"><div><p class="eyebrow">Автор записи</p><h2>Кто вносит данные?</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
        <p class="dialog-lead">Имя будет записано в Google Sheets вместе с изменением.</p>
        ${formField("workforce-performer", "Имя и фамилия", `<select id="workforce-performer" name="performer" required><option value="">Выберите себя</option>${names.map(name => `<option ${name === workforceActor.performer ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select>`)}
        <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button class="primary-button" type="submit">Продолжить</button></div>
      </form>`);
    let completed = false;
    dialog.addEventListener("close", () => { if (!completed) reject(new Error("Не выбран автор записи")); });
    dialog.querySelector("form").addEventListener("submit", event => {
      event.preventDefault();
      const performer = String(new FormData(event.currentTarget).get("performer") || "");
      if (!performer) return;
      completed = true;
      dialog.close();
      resolve(performer);
    });
    dialog.showModal();
  });
}

function createDialog(content) {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.innerHTML = content;
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", event => {
    if (event.target.closest('[data-action="close-dialog"]')) {
      dialog.close();
      return;
    }
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

function showFormError(form, error) {
  const panel = form.querySelector("#form-error");
  if (panel) {
    panel.hidden = false;
    panel.textContent = error.message || "Проверьте заполнение формы";
  }
  for (const name of Object.keys(error.fields ?? {})) {
    const field = form.elements[name];
    if (field) field.setAttribute("aria-invalid", "true");
  }
}


function renderPreparationReminder() {
  const reminders = [];
  if (state.account?.role === "senior" && !state.shift?.active) reminders.push(`<button class="preparation-reminder" data-action="navigate" data-page="attendance"><span>1</span><div><strong>Смена ещё не начата</strong><small>Заполните табель. Разделы доступны — это напоминание, а не блокировка.</small></div><b>Перейти →</b></button>`);
  if (state.account?.role === "senior" && state.shift?.active && state.shift.requiresScaleControl && !state.shift.weightsCompletedAt) reminders.push(`<button class="preparation-reminder scales" data-action="navigate" data-page="journals"><span>13</span><div><strong>Не завершён контроль весов F1–F13</strong><small>Продолжить работу можно, но напоминание останется до сохранения полного обхода.</small></div><b>Проверить →</b></button>`);
  const overdueCyclones = pendingCycloneCleaningDates(state.cyclones.records);
  if (overdueCyclones.length) {
    const days = overdueCyclones.map(date => Number(date.slice(-2))).join(" и ");
    reminders.push(`<button class="preparation-reminder cyclone-reminder" data-action="navigate" data-page="cyclones"><span>◌</span><div><strong>Требуется очистка циклонов</strong><small>Нет записи за ${days}-е ${overdueCyclones.length === 1 ? "число" : "числа"} этого месяца. Напоминание исчезнет после внесения записи в журнал.</small></div><b>Открыть →</b></button>`);
  }
  return reminders.join("");
}

function connectionBadge() {
  return `<span class="connection-badge ${navigator.onLine ? "online" : "offline"}" title="${state.operations.length ? `В очереди: ${state.operations.length}` : "Очередь пуста"}"><i></i>${navigator.onLine ? ui("online") : ui("offline")}${state.operations.length ? `<b>${state.operations.length}</b>` : ""}</span>`;
}

function recordStatus(record) {
  if (record.status === "Аннулировано") return `<span class="status-pill muted" title="${attribute(record.annulReason)}">Аннулировано</span>`;
  if (record.syncState === "conflict") return `<span class="status-pill danger">Конфликт</span>`;
  if (record.syncState === "pending") return `<span class="status-pill warning">В очереди</span>`;
  if (record.source === "demo") return `<span class="status-pill demo">Демо</span>`;
  return `<span class="status-pill success">Отправлено</span>`;
}

function navItem(page, label, icon, count = 0) {
  return `<button class="nav-item ${state.page === page ? "active" : ""}" data-action="navigate" data-page="${page}">${icon}<span>${label}</span>${count ? `<b>${count}</b>` : ""}</button>`;
}

function renderMobileNav() {
  return `<nav class="mobile-nav" aria-label="Мобильное меню">
    ${navItem("dashboard", moduleLabelById("dashboard"), dashboardIcon())}
    ${navItem("attendance", moduleLabelById("attendance"), attendanceIcon())}
    ${navItem("journals", moduleLabelById("journals"), journalIcon())}
    ${navItem("cyclones", moduleLabelById("cyclones"), moduleIcon("cyclone"))}
    ${state.account.role === "manager" ? navItem("settings", moduleLabelById("settings"), settingsIcon()) : navItem("personnel", moduleLabelById("personnel"), personnelIcon())}
  </nav>`;
}

function metricCard(label, value, note, tone, compactValue = false) {
  return `<article class="metric-card card ${tone}"><p>${label}</p><strong class="${compactValue ? "compact-value" : ""}">${value}</strong><small>${note}</small></article>`;
}

function settingRow(label, value, note) {
  return `<div class="setting-row"><span><strong>${label}</strong><small>${note}</small></span><b>${value}</b></div>`;
}

function settingsLink(page, title, note, icon) {
  return `<button class="settings-link" data-action="navigate" data-page="${page}"><span>${icon}</span><span><strong>${title}</strong><small>${note}</small></span><b>→</b></button>`;
}

function formField(id, label, control, hint = "", width = "") {
  return `<label class="field ${width}"><span>${label}</span>${control}${hint ? `<small>${hint}</small>` : ""}</label>`;
}

function renderEmptyRow() {
  return `<tr><td colspan="8"><div class="empty-state"><span>◎</span><h3>Записей пока нет</h3><p>Нажмите «Новая запись», чтобы начать.</p></div></td></tr>`;
}

function operationLabel(type) {
  return ({ create: "Новая запись", update: "Исправление", annul: "Аннулирование" })[type] ?? "Изменение";
}

function pageTitle() {
  if (state.page === "sync") return "Синхронизация";
  return moduleLabelById(state.page) || ui("home");
}

function modulesForAccount() {
  return MODULES.filter(module => !module.managerOnly || state.account?.role === "manager");
}

function moduleLabel(module) {
  return module?.labels?.[state.language] ?? module?.labels?.ru ?? "";
}

function moduleLabelById(id) {
  return moduleLabel(MODULES.find(module => module.id === id));
}

function personnel() {
  return [...(state.workforce?.personnel ?? [])];
}

function activePersonnel() {
  return personnel().filter(employee => employee.active !== false);
}

function presentShiftPersonnel() {
  const teamId = state.shift?.shiftTeamId ?? state.selectedShiftTeamId ?? scheduledTeam()?.id;
  if (!teamId) return [];
  const attendance = new Map((isCurrentSharedShift() && state.shift.shiftTeamId === teamId ? state.shift.attendance : [])
    .map(item => [item.employeeId, attendanceCode(item.status)]));
  const unsavedGuests = new Set(state.shiftGuests.map(item => item.employeeId));
  return shiftStartMembers(teamId).filter(employee => attendance.get(employee.id) === "11" || unsavedGuests.has(employee.id));
}

function isSubstituteOnly(employee) {
  return Boolean(employee?.substituteOnly) || SUBSTITUTE_ONLY_EMPLOYEE_IDS.includes(employee?.id);
}

function isRegularAreaEmployee(employee) {
  return Boolean(employee) && employee.shiftTeamId !== "office" && !isSubstituteOnly(employee);
}

function regularAreaPersonnel() {
  return activePersonnel().filter(isRegularAreaEmployee);
}

function employeeNames() {
  return activePersonnel().map(employee => employee.fullName).sort((left, right) => left.localeCompare(right, "ru"));
}

function roleLabel(role) {
  return ROLE_LABELS[role] ?? "Должность не указана";
}

function teamById(id) {
  return state.workforce?.shiftTeams?.find(team => team.id === id) ?? null;
}

function teamLabel(id) {
  if (id === "office") return "5/2";
  return teamById(id)?.code ?? "—";
}

function productionShiftCode() {
  return teamById(state.shift?.shiftTeamId)?.code ?? "";
}

function activeShiftLeadership() {
  const seniorMechanic = String(state.shift?.seniorMechanic || state.shift?.supervisor || "").trim();
  const mechanic = String(state.shift?.mechanic || "").trim();
  if (!seniorMechanic || !mechanic) throw new Error("Сначала в табеле выберите старшего механика и механика.");
  return { seniorMechanic, mechanic };
}

function scheduledTeam(date = today()) {
  const [year, monthIndex] = monthParts(date);
  return state.workforce?.shiftTeams?.find(team => getScheduleMonth(team, year, monthIndex).some(day => day.date === date && day.scheduled)) ?? null;
}

function isCurrentSharedShift(shift = state.shift) {
  if (!shift?.active) return false;
  return !APP_CONFIG.centralAuth || shift.shiftDate === today();
}

function shiftLeadershipOptions(members, attendance = new Map(), activeShift = null, preferred = {}) {
  const present = members.filter(employee => attendanceCode(attendance.get(employee.id)) === "11");
  const seniorCandidates = present.filter(employee => employee.role === "senior-mechanic");
  // When the senior mechanic is absent, a present mechanic is automatically
  // offered as the shift senior. Mechanic-operators remain the mechanic list.
  const seniorPool = seniorCandidates.length ? seniorCandidates : present.filter(employee => employee.role === "mechanic");
  const mechanicPool = present.filter(employee => employee.role === "mechanic-operator");
  const seniorValue = String(preferred.seniorMechanic || activeShift?.seniorMechanic || activeShift?.supervisor || "");
  const mechanicValue = String(preferred.mechanic || activeShift?.mechanic || "");
  const optionMarkup = (items, value, empty, autoSelect) => {
    if (!items.length) return `<option value="" selected>${empty}</option>`;
    const selected = items.some(employee => employee.fullName === value) ? value : (autoSelect ? items[0].fullName : "");
    return `${autoSelect ? "" : '<option value="">Выберите сотрудника</option>'}${items.map(employee => `<option value="${attribute(employee.fullName)}" ${employee.fullName === selected ? "selected" : ""}>${escapeHtml(employee.fullName)}</option>`).join("")}`;
  };
  return {
    senior: optionMarkup(seniorPool, seniorValue, "Сначала отметьте присутствующих", true),
    mechanic: optionMarkup(mechanicPool, mechanicValue, "Сначала отметьте присутствующих", false)
  };
}

function updateShiftLeadershipOptions(form) {
  if (!form?.matches("[data-form=shift-attendance]")) return;
  const teamId = String(form.elements.shiftTeamId?.value || state.selectedShiftTeamId || "");
  const members = shiftStartMembers(teamId);
  const attendance = new Map(members.map(employee => [employee.id, form.elements[`attendance-${employee.id}`]?.value || ""]));
  const senior = form.elements.seniorMechanic;
  const mechanic = form.elements.mechanic;
  if (!senior || !mechanic) return;
  const options = shiftLeadershipOptions(members, attendance, null, { seniorMechanic: senior.value, mechanic: mechanic.value });
  senior.innerHTML = options.senior;
  mechanic.innerHTML = options.mechanic;
}

function shiftLeadershipFromForm(form, teamId) {
  const members = shiftStartMembers(teamId);
  const attendance = new Map(members.map(employee => [employee.id, form.elements[`attendance-${employee.id}`]?.value || ""]));
  const present = members.filter(employee => attendanceCode(attendance.get(employee.id)) === "11");
  const seniorCandidates = present.filter(employee => employee.role === "senior-mechanic");
  const seniorPool = seniorCandidates.length ? seniorCandidates : present.filter(employee => employee.role === "mechanic");
  const mechanicPool = present.filter(employee => employee.role === "mechanic-operator");
  const seniorMechanic = String(form.elements.seniorMechanic?.value || "").trim();
  const mechanic = String(form.elements.mechanic?.value || "").trim();
  if (!seniorPool.some(employee => employee.fullName === seniorMechanic)) throw new Error("Выберите старшего механика из присутствующих в табеле.");
  if (!mechanicPool.some(employee => employee.fullName === mechanic)) throw new Error("Выберите механика из присутствующих механиков-операторов.");
  return { seniorMechanic, mechanic };
}

function responsibilityCandidates(teamId, roles) {
  return activePersonnel()
    .filter(employee => employee.shiftTeamId === teamId && roles.includes(employee.role))
    .sort(comparePersonnel);
}

function shiftGuestEntries(teamId) {
  const saved = isCurrentSharedShift() && state.shift.shiftTeamId === teamId
    ? (state.shift.attendance || []).filter(item => item.isSubstitute)
    : [];
  return [...saved, ...state.shiftGuests]
    .filter(item => {
      const employee = activePersonnel().find(person => person.id === item.employeeId);
      return item.homeShiftTeamId && (item.homeShiftTeamId !== teamId || isSubstituteOnly(employee));
    })
    .filter((item, index, list) => list.findIndex(other => other.employeeId === item.employeeId) === index);
}

function shiftStartMembers(teamId) {
  const regular = regularAreaPersonnel().filter(employee => employee.shiftTeamId === teamId);
  const guests = shiftGuestEntries(teamId)
    .map(item => {
      const employee = activePersonnel().find(person => person.id === item.employeeId);
      return employee ? { ...employee, isSubstitute: true, substitutionReason: item.substitutionReason, homeShiftTeamId: item.homeShiftTeamId } : null;
    })
    .filter(Boolean);
  return [...regular, ...guests].sort(comparePersonnel);
}

function loginShiftResponsibility(data) {
  const teamId = String(data.get("responsibleTeamId") || "");
  const selectedId = String(data.get("shiftResponsible") || "");
  const employeeId = selectedId === "other"
    ? String(data.get("otherShiftResponsible") || "")
    : selectedId;
  const allowedRoles = selectedId === "other"
    ? ["mechanic-operator"]
    : ["senior-mechanic", "mechanic"];
  const employee = responsibilityCandidates(teamId, allowedRoles).find(item => item.id === employeeId);
  return employee ? { employeeId: employee.id, fullName: employee.fullName, teamId } : null;
}

function teamsWithCurrentShiftFirst() {
  const currentTeamId = isCurrentSharedShift() ? state.shift.shiftTeamId : scheduledTeam()?.id;
  return [...(state.workforce?.shiftTeams || [])].sort((left, right) => {
    if (left.id === currentTeamId) return -1;
    if (right.id === currentTeamId) return 1;
    return left.code.localeCompare(right.code, "ru");
  });
}

function comparePersonnel(left, right) {
  const teamOrder = { "shift-team-a": 0, "shift-team-b": 1, office: 2 };
  const roleOrder = { "senior-mechanic": 0, "mechanic-operator": 1, packer: 2, "head-of-area": 3, "production-manager": 4, administrator: 5, "warehouse-manager": 6 };
  return (teamOrder[left.shiftTeamId] ?? 9) - (teamOrder[right.shiftTeamId] ?? 9) || (roleOrder[left.role] ?? 9) - (roleOrder[right.role] ?? 9) || left.fullName.localeCompare(right.fullName, "ru");
}

function monthParts(value) {
  const [year, month] = String(value).split("-").map(Number);
  return [year, month - 1];
}

function dayHeader(day) {
  return `<th class="${day.isToday ? "today" : ""}"><strong>${day.day}</strong><small>${escapeHtml(day.weekday)}</small></th>`;
}

function attendanceTone(value, expectedHours = 11) {
  const configured = ATTENDANCE_CODES.find(item => item.value === String(value));
  if (configured) return configured.tone;
  const hours = Number(value);
  return Number.isFinite(hours) && hours < Number(expectedHours) ? "partial" : "worked";
}

function timesheetOptions(selected, expectedHours = 11) {
  const current = String(selected ?? expectedHours);
  const hours = Array.from({ length: 24 }, (_, index) => index + 1).map(value => `<option value="${value}" ${current === String(value) ? "selected" : ""}>${value}</option>`).join("");
  const reasons = ATTENDANCE_CODES.filter(item => !item.isWork).map(item => `<option value="${item.value}" ${current === item.value ? "selected" : ""}>${item.value}</option>`).join("");
  return `<optgroup label="Часы">${hours}</optgroup><optgroup label="Причины отсутствия">${reasons}</optgroup>`;
}

function filterPersonnelCards() {
  const query = (root.querySelector("[data-personnel-search]")?.value ?? "").trim().toLocaleLowerCase(localeCode());
  const team = root.querySelector("[data-personnel-team]")?.value ?? "all";
  const role = root.querySelector("[data-personnel-role]")?.value ?? "all";
  let visible = 0;
  root.querySelectorAll("[data-personnel-card]").forEach(card => {
    const matches = (!query || card.dataset.search.includes(query)) && (team === "all" || card.dataset.team === team) && (role === "all" || card.dataset.role === role);
    card.hidden = !matches;
    if (matches) visible += 1;
  });
  const counter = root.querySelector("[data-personnel-count]");
  if (counter) counter.textContent = String(visible);
}

function ui(key) {
  return SHELL_TEXT[state.language]?.[key] ?? SHELL_TEXT.ru[key] ?? key;
}

function normalizeLanguage(value) {
  return LANGUAGES.some(language => language.code === value) ? value : "ru";
}

function localeCode() {
  return LANGUAGES.find(language => language.code === state.language)?.locale ?? APP_CONFIG.locale;
}

function startClock() {
  clearInterval(clockTimer);
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const clock = root.querySelector("[data-clock]");
  if (!clock) return;
  const now = new Date();
  const date = clock.querySelector("[data-clock-date]");
  const time = clock.querySelector("[data-clock-time]");
  if (date) date.textContent = headerDate(now);
  if (time) time.textContent = headerTime(now);
  clock.dateTime = now.toISOString();
}

function headerDate(value = new Date()) {
  return new Intl.DateTimeFormat(localeCode(), { timeZone: APP_CONFIG.timeZone, weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(value).replace(",", "");
}

function headerTime(value = new Date()) {
  return new Intl.DateTimeFormat(localeCode(), { timeZone: APP_CONFIG.timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(value);
}

function attendanceStatusOptions(selected) {
  const current = attendanceCode(selected);
  return ATTENDANCE_CODES.filter(item => item.value !== "K").map(item => `<option value="${item.value}" ${current === item.value ? "selected" : ""}>${item.value} · ${escapeHtml(item.label)}</option>`).join("");
}

function updateAttendanceCounter(form) {
  if (!form) return;
  const counter = form.querySelector("[data-attendance-present]");
  if (!counter) return;
  counter.textContent = String([...form.querySelectorAll("[data-attendance-status]")].filter(select => select.value === "11").length);
}

function attendanceCode(value) {
  return ({ present: "11", vacation: "A", sick: "L", absent: "PB", "day-off": "ND" })[String(value || "")] ?? String(value || "11");
}

async function saveShiftAttendanceToTimesheet(teamId, attendance, changes = attendance) {
  const date = today();
  // Starting a shift must stay responsive.  The attendance is first written
  // to the local queue, so that a slow Google Sheets request never blocks the
  // responsible-person dialog or the transition to scale control.
  await withWorkforceActor(async () => {
    for (const item of changes) {
      await workforceService.saveAttendance({
        date,
        shiftTeamId: teamId,
        employeeId: item.employeeId,
        value: attendanceCode(item.status),
        substitutionReason: item.isSubstitute ? item.substitutionReason : "",
        homeShiftTeamId: item.isSubstitute ? item.homeShiftTeamId : ""
      });
    }
  }, attendanceAuthorNames(teamId));
  sendWorkforceInBackground();
}

function attendanceChanges(teamId, attendance) {
  const existing = new Map((state.workforce.attendance || [])
    .filter(item => item.date === today() && item.shiftTeamId === teamId)
    .map(item => [item.employeeId, item]));
  return attendance.filter(item => {
    const prior = existing.get(item.employeeId);
    return !prior
      || attendanceCode(prior.value) !== attendanceCode(item.status)
      || String(prior.substitutionReason || "") !== String(item.substitutionReason || "")
      || String(prior.homeShiftTeamId || "") !== String(item.homeShiftTeamId || "");
  });
}

function attendanceChangeMessage(changes) {
  const existingIds = new Set((state.workforce.attendance || [])
    .filter(item => item.date === today())
    .map(item => item.employeeId));
  const changed = changes.filter(item => existingIds.has(item.employeeId));
  if (!changed.length) return "Подтвердить состав смены и сохранить новые отметки табеля?";
  const names = changed.map(item => activePersonnel().find(person => person.id === item.employeeId)?.fullName || item.employeeId).join(", ");
  return `Будут изменены уже сохранённые отметки: ${names}. Продолжить?`;
}

async function archiveLegacyShift() {
  const legacy = state.legacyShift;
  if (!legacy?.active) return;
  if (!window.confirm("Завершить только старую локальную смену? Табель и общая смена на сервере не изменятся.")) return;
  const history = await store.preference("legacyShiftArchive", []);
  await store.setPreference("legacyShiftArchive", [...history, { ...legacy, archivedAt: new Date().toISOString(), archiveReason: "central-shift-migration" }]);
  await store.setPreference("activeShift", { ...legacy, active: false, endedAt: new Date().toISOString(), endedReason: "migrated-to-central-shift" });
  state.legacyShift = await legacyShiftService.current();
}

function sendWorkforceInBackground() {
  if (!workforceRepository || !navigator.onLine) return;
  void syncWorkforce().catch(error => {
    toast(`Табель сохранён на этом компьютере. Отправка в Google будет повторена автоматически: ${error.message}`, "warning");
  });
}

function attendanceAuthorNames(teamId) {
  if (isCurrentSharedShift() && state.shift?.shiftTeamId === teamId) {
    const selected = [state.shift.seniorMechanic || state.shift.supervisor, state.shift.mechanic].map(value => String(value || "").trim()).filter(Boolean);
    if (selected.length) return [...new Set(selected)];
  }
  const responsible = state.shiftResponsible;
  const responsibleEmployee = responsible?.teamId === teamId
    ? activePersonnel().find(employee => employee.id === responsible.employeeId)
    : null;
  if (responsibleEmployee?.role === "mechanic-operator") return [responsibleEmployee.fullName];
  return activePersonnel()
    .filter(employee => employee.shiftTeamId === teamId && ["senior-mechanic", "mechanic"].includes(employee.role))
    .map(employee => employee.fullName);
}

function operationalAuthorNames() {
  const teamId = state.shift?.shiftTeamId ?? state.selectedShiftTeamId ?? scheduledTeam()?.id;
  return attendanceAuthorNames(teamId);
}

function showInlineFormError(form, message) {
  const panel = form.querySelector("#attendance-form-error");
  if (!panel) return;
  panel.hidden = false;
  panel.textContent = message;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_CONFIG.timeZone }).format(new Date());
}

function shiftMonth(value, offset) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthTitle(value) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function monthDays(value) {
  const [year, month] = value.split("-").map(Number);
  const count = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return {
      day,
      date,
      weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, 12))).replace(".", ""),
      isToday: date === today()
    };
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3, minimumFractionDigits: 0 }).format(Number(value));
}

function openPackagingWarehouseDialog(record = null) {
  const items = state.packagingWarehouse.summary.map(row => row.item).filter(Boolean);
  const optionList = [`<option value="">Выберите наименование</option>`, ...items.map(item => `<option value="${attribute(item)}" ${record?.item === item ? "selected" : ""}>${escapeHtml(item)}</option>`)].join("");
  const dialog = createDialog(`<form class="dialog-card small-dialog"><div class="dialog-heading"><div><p class="eyebrow">Склад упаковки · Google Sheets</p><h2>${record ? "Исправить движение" : "Новое движение"}</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
    <p>Запись сразу попадёт в общий журнал. Расчётный остаток обновится автоматически.</p>
    <div class="form-grid">${formField("warehouse-date", "Дата", `<input id="warehouse-date" name="date" type="date" value="${attribute(record?.date || today())}" max="${today()}" required>`)}${formField("warehouse-type", "Операция", `<select id="warehouse-type" name="type" required><option value="Приход" ${record?.type === "Приход" ? "selected" : ""}>Приход</option><option value="Расход" ${record?.type === "Расход" ? "selected" : ""}>Расход</option></select>`)}</div>
    ${formField("warehouse-item", "Наименование", `<select id="warehouse-item" name="item" required>${optionList}</select>`)}
    ${formField("warehouse-quantity", "Количество", `<input id="warehouse-quantity" name="quantity" type="number" min="1" step="1" inputmode="numeric" value="${attribute(record?.quantity || "")}" required>`)}
    ${formField("warehouse-note", "Примечание", `<textarea id="warehouse-note" name="note" rows="3" maxlength="500" placeholder="Накладная, место хранения или причина расхода">${escapeHtml(record?.note || "")}</textarea>`)}
    <p id="form-error" class="form-error" hidden></p><div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">${record ? "Сохранить изменения" : "Внести в журнал"}</button></div></form>`);
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try { state.packagingWarehouse = await packagingWarehouseService.save({ ...data, ...(record ? { id: record.id } : {}) }, state.account); dialog.close(); render(); toast(record ? "Движение склада исправлено." : "Движение склада внесено в Google журнал.", "success"); }
    catch (error) { showFormError(form, error); submit.disabled = false; }
  });
  dialog.showModal();
}

function openIncidentDialog() {
  const currentTime = new Intl.DateTimeFormat("en-GB", { timeZone: APP_CONFIG.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const shift = isCurrentSharedShift() ? productionShiftCode() : "";
  const dialog = createDialog(`<form class="dialog-card"><div class="dialog-heading"><div><p class="eyebrow">Журнал регистрации инцидентов</p><h2>Новый инцидент</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
    <p>Запись сохраняется на этом компьютере. Её можно вести независимо от сменного журнала.</p>
    <div class="form-grid">${formField("incident-date", "Дата", `<input id="incident-date" name="date" type="date" value="${today()}" max="${today()}" required>`)}${formField("incident-time", "Время", `<input id="incident-time" name="time" type="time" value="${currentTime}" required>`)}${formField("incident-shift", "Смена", `<select id="incident-shift" name="shift"><option value="">Не указана</option><option value="A" ${shift === "A" ? "selected" : ""}>A</option><option value="B" ${shift === "B" ? "selected" : ""}>B</option></select>`)}${formField("incident-category", "Категория", `<select id="incident-category" name="category" required><option value="">Выберите категорию</option><option>Безопасность</option><option>Оборудование</option><option>Качество</option><option>Персонал</option><option>Другое</option></select>`)}</div>
    ${formField("incident-description", "Что произошло", `<textarea id="incident-description" name="description" rows="4" maxlength="2000" required placeholder="Кратко и по существу опишите событие"></textarea>`)}
    ${formField("incident-action", "Принятые меры", `<textarea id="incident-action" name="action" rows="3" maxlength="2000" placeholder="Что сделано сразу после инцидента"></textarea>`)}
    ${formField("incident-status", "Статус", `<select id="incident-status" name="status" required><option>Открыт</option><option>В работе</option><option>Закрыт</option></select>`)}
    <p id="form-error" class="form-error" hidden></p><div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">Зарегистрировать</button></div></form>`);
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (data.date > today() || !data.category || !String(data.description || "").trim()) { showFormError(form, new Error("Заполните дату, категорию и описание инцидента.")); return; }
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    state.incidents = [...state.incidents, { id: `incident-${crypto.randomUUID?.() || Date.now()}`, date: data.date, time: data.time, shift: data.shift, category: data.category, description: String(data.description).trim(), action: String(data.action || "").trim(), status: data.status, author: state.account?.title || "Рабочая учётная запись", createdAt: new Date().toISOString() }];
    await store.setPreference("incidentLogRecords", state.incidents);
    dialog.close(); render(); toast("Инцидент зарегистрирован в локальном журнале.", "success");
  });
  dialog.showModal();
}

function openPackagingDialog() {
  state.packagingEntryItem = state.packagingEntryItem || PACKAGING_FIELDS[0]?.key || "";
  render();
  focusPackagingQuantity();
}

function focusPackagingQuantity() {
  window.setTimeout(() => root.querySelector("#packaging-quantity:not(:disabled)")?.focus(), 0);
}

function openPackagingEditDialog(record) {
  const fields = PACKAGING_FIELDS.map(field => formField(`packaging-edit-${field.key}`, field.label, `<input id="packaging-edit-${field.key}" name="${field.key}" type="number" min="0" step="0.001" value="${attribute(record.values?.[field.key] || 0)}" inputmode="decimal">`)).join("");
  const dialog = createDialog(`<form class="dialog-card packaging-dialog"><div class="dialog-heading"><h2>Изменить итог за день</h2><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>${formField("packaging-edit-date", "Дата", `<input id="packaging-edit-date" name="date" type="date" value="${attribute(record.date)}" readonly required>`)}<div class="form-grid packaging-fields">${fields}</div><p id="form-error" class="form-error" hidden></p><div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">Сохранить итог</button></div></form>`);
  dialog.querySelector("form").addEventListener("submit", async event => { event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; try { await packagingService.update(record, Object.fromEntries(new FormData(form)), state.account); dialog.close(); state.packaging = await packagingService.snapshot(); render(); if (navigator.onLine) void packagingService.sync().then(snapshot => { state.packaging = snapshot; render(); }); } catch (error) { showFormError(form, error); submit.disabled = false; } }); dialog.showModal();
}

function formatPercent(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(Number(value));
}

function signedNumber(value) {
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${formatNumber(number)}`;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function plural(value, one, few, many) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function attribute(value = "") {
  return escapeHtml(value);
}

function toast(message, tone = "neutral") {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const element = document.createElement("div");
  element.className = `toast ${tone}`;
  element.innerHTML = `<span>${tone === "success" ? "✓" : tone === "error" ? "!" : "i"}</span><p>${escapeHtml(message)}</p>`;
  region.append(element);
  setTimeout(() => element.classList.add("visible"), 10);
  setTimeout(() => {
    element.classList.remove("visible");
    setTimeout(() => element.remove(), 250);
  }, 3800);
}

function renderFatalError(error) {
  root.innerHTML = `<main class="fatal-error"><div class="brand-mark large">!</div><h1>Программа не запустилась</h1><p>${escapeHtml(error.message)}</p><button class="primary-button" onclick="location.reload()">Попробовать снова</button></main>`;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" }).then(registration => registration.update()).catch(() => {});
  }
}

function dashboardIcon() { return `<svg viewBox="0 0 24 24"><path d="M4 13h6V4H4zm0 7h6v-4H4zm10 0h6v-9h-6zm0-16v4h6V4z"/></svg>`; }
function journalIcon() { return `<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>`; }
function attendanceIcon() { return `<svg viewBox="0 0 24 24"><path d="M5 3v3M19 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1zM8 12h2M12 12h2M16 12h1M8 16h2M12 16h2"/></svg>`; }
function personnelIcon() { return `<svg viewBox="0 0 24 24"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21v-2a6 6 0 0 1 12 0v2M17 8a3 3 0 0 1 0 6M18 16a5 5 0 0 1 3 5"/></svg>`; }
function syncIcon() { return `<svg viewBox="0 0 24 24"><path d="M20 7h-7V4l-4 4 4 4V9h5a6 6 0 0 1-9 5M4 17h7v3l4-4-4-4v3H6a6 6 0 0 1 9-5"/></svg>`; }
function settingsIcon() { return `<svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 13.5v-3l-2-.6-.5-1.1 1-1.9-2.1-2.1-1.9 1L12.4 5 12 3h-3l-.6 2-1.1.5-1.9-1-2.1 2.1 1 1.9-.5 1.1-2 .6v3l2 .6.5 1.1-1 1.9 2.1 2.1 1.9-1 1.1.5.6 2h3l.6-2 1.1-.5 1.9 1 2.1-2.1-1-1.9.5-1.1z"/></svg>`; }
function refreshIcon() { return `<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>`; }
function syncLargeIcon() { return `<svg viewBox="0 0 64 64"><path d="M51 22H35v-8L23 26l12 12v-8h12a14 14 0 0 1-23 11M13 42h16v8l12-12-12-12v8H17a14 14 0 0 1 23-11"/></svg>`; }

function brandIcon() { return `<svg viewBox="0 0 32 32"><path d="M5 10.5 16 4l11 6.5v11L16 28 5 21.5zM5 10.5 16 17l11-6.5M16 17v11M10.5 7.3 21.5 14v6"/></svg>`; }
function sunIcon() { return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`; }
function moonIcon() { return `<svg viewBox="0 0 24 24"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2z"/></svg>`; }

function moduleIcon(type) {
  if (type === "home") return dashboardIcon();
  if (type === "attendance") return attendanceIcon();
  if (type === "scales") return journalIcon();
  if (type === "personnel") return personnelIcon();
  if (type === "settings") return settingsIcon();
  if (type === "statistics") return statisticsIcon();
  const paths = {
    package: `<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5zM4 7.5l8 4.5 8-4.5M12 12v9"/>`,
    tools: `<path d="m14 6 4-4 4 4-4 4M16 8 7 17M4 14l6 6-3 2-5-5z"/>`,
    alert: `<path d="M12 3 2.5 20h19zM12 9v5M12 17h.01"/>`,
    specification: `<path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h6M9 16h6"/>`,
    production: `<path d="M3 21V9l6 4V9l6 4V5h6v16zM7 17h2M12 17h2M17 17h2"/>`,
    warehouse: `<path d="m3 9 9-6 9 6v12H3zM7 21v-8h10v8M7 16h10"/>`,
    ppe: `<path d="M7 4h10v5l3 3v8H4v-8l3-3zM9 4v5M15 4v5M8 14h8M8 17h8"/>`,
    cyclone: `<path d="M5 4h14l-5 7v7l-4 2v-9zM8 7h8"/>`,
    documents: `<path d="M6 3h9l4 4v14H6zM15 3v5h4M9 12h6M9 16h6"/>`,
    vacation: `<path d="M5 3v3M19 3v3M4 8h16M5 5h14v15H5zM8 12h3M13 12h3M8 16h3"/>`
  };
  return `<svg viewBox="0 0 24 24">${paths[type] ?? paths.documents}</svg>`;
}

function statisticsIcon() { return `<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`; }
