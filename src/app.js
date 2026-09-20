import { APP_CONFIG, JOURNALS, LANGUAGES, MODULES, SCALES } from "./config/app-config.js";
import { ATTENDANCE_CODES, OFFICE_SCHEDULE, ROLE_LABELS } from "./config/workforce-config.js";
import { calculateResult, formatDate, formatDateTime } from "./domain/scale-check.js";
import { createDemoRecords } from "./data/demo-records.js";
import { IndexedDbDataProvider } from "./providers/indexed-db-data-provider.js";
import { DemoGoogleSheetsProvider } from "./providers/demo-google-sheets-provider.js";
import { GoogleSheetsGatewayProvider } from "./providers/google-sheets-gateway-provider.js";
import { JournalRepository } from "./repositories/journal-repository.js";
import { AuthService } from "./services/auth-service.js";
import { JournalService } from "./services/journal-service.js";
import { ShiftService } from "./services/shift-service.js";
import { WorkforceService, getScheduleMonth } from "./services/workforce-service.js";
import { WorkforceGatewayProvider } from "./providers/workforce-gateway-provider.js";
import { WorkforceRepository } from "./repositories/workforce-repository.js";
import { WORKSPACE_JOURNALS, WORKFORCE_YEARS } from "./config/workspace-journals.js";

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
  records: [],
  operations: [],
  page: "dashboard",
  loading: true,
  syncing: false,
  lastRefresh: null,
  demoBannerDismissed: false,
  attendanceMonth: today().slice(0, 7),
  attendanceView: "start",
  settingsTab: "overview",
  selectedShiftTeamId: null,
  workforce: { personnel: [], shiftTeams: [], attendance: [] },
  language: "ru",
  theme: "light"
};

let store;
let authService;
let shiftService;
let repository;
let journalService;
let workforceService;
let workforceRepository;
let workforceActor = {};
let refreshTimer;
let clockTimer;

bootstrap().catch(error => renderFatalError(error));

async function bootstrap() {
  store = await new IndexedDbDataProvider().init();
  const remoteProvider = createRemoteProvider();
  repository = new JournalRepository(store, remoteProvider);
  authService = new AuthService(store, { allowedRole: APP_CONFIG.workstationRole });
  shiftService = new ShiftService(store);
  workforceRepository = APP_CONFIG.integration.mode === "gateway" ? new WorkforceRepository(store,
    new WorkforceGatewayProvider({ baseUrl: APP_CONFIG.integration.gatewayBaseUrl, writesEnabled: APP_CONFIG.integration.googleWritesEnabled }),
    () => ({ ...workforceActor, workstationId: APP_CONFIG.workstationId, account: state.account?.id })) : null;
  workforceService = new WorkforceService(store, workforceRepository);
  journalService = new JournalService(repository, journal, {
    workstationId: APP_CONFIG.workstationId,
    workstationLabel: APP_CONFIG.workstationLabel
  });

  await repository.init(remoteProvider.mode === "demo" ? createDemoRecords() : []);
  if (navigator.onLine) {
    try {
      await repository.refresh();
    } catch (error) {
      console.warn("Источник Google пока недоступен", error);
    }
  }
  state.account = await authService.current();
  state.shift = await shiftService.current();
  state.workforce = await workforceService.initialize();
  state.selectedShiftTeamId = state.shift?.shiftTeamId ?? scheduledTeam()?.id ?? state.workforce.shiftTeams[0]?.id ?? null;
  state.demoBannerDismissed = await store.preference("demoBannerDismissed", false);
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
  if (navigator.onLine) syncRecords({ silent: true });
}

function createRemoteProvider() {
  if (APP_CONFIG.integration.mode === "gateway") {
    return new GoogleSheetsGatewayProvider({
      baseUrl: APP_CONFIG.integration.gatewayBaseUrl,
      writesEnabled: APP_CONFIG.integration.googleWritesEnabled
    });
  }
  return new DemoGoogleSheetsProvider(store);
}

function bindGlobalEvents() {
  root.addEventListener("click", handleClick);
  root.addEventListener("input", handleInput);
  root.addEventListener("change", handleChange);
  root.addEventListener("submit", handleSubmit);
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
  if (event.target.matches("[data-attendance-status]")) updateAttendanceCounter(event.target.form);
}

async function handleChange(event) {
  if (event.target.matches("[data-start-team]")) {
    state.selectedShiftTeamId = event.target.value;
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
    } catch (error) {
      toast(error.message || "Не удалось сохранить табель.", "error");
    }
  }
}

async function handleSubmit(event) {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === "shift-settings") {
    try {
      const data = Object.fromEntries(new FormData(form));
      await withWorkforceActor(() => workforceService.saveShiftTeam(data));
      state.workforce = await workforceService.snapshot();
      render();
      toast("Настройки смены сохранены.", "success");
    } catch (error) {
      toast(error.message || "Не удалось сохранить настройки смены.", "error");
    }
    return;
  }
  if (form.dataset.form !== "shift-attendance") return;
  const data = new FormData(form);
  const teamId = String(data.get("shiftTeamId") || state.selectedShiftTeamId || "");
  const members = activePersonnel().filter(employee => employee.shiftTeamId === teamId);
  const attendance = members.map(employee => ({
    employeeId: employee.id,
    status: String(data.get(`attendance-${employee.id}`) || "")
  }));
  if (attendance.some(item => !item.status)) {
    showInlineFormError(form, "Отметьте каждого сотрудника");
    return;
  }
  try {
    await saveShiftAttendanceToTimesheet(teamId, attendance);
    if (state.shift?.active) {
      state.shift = await shiftService.updateAttendance(attendance);
      state.workforce = await workforceService.snapshot();
      render();
      toast("Табель смены обновлён.", "success");
      return;
    }
    state.shift = await shiftService.start({
      supervisor: String(data.get("supervisor") || ""),
      shiftNumber: Number(data.get("shiftNumber")),
      shiftTeamId: teamId,
      attendance
    });
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
  const { action, id, page, accountId } = actionElement.dataset;

  try {
    if (action === "login") {
      state.account = await authService.login(accountId);
      state.page = "dashboard";
      render();
      return;
    }
    if (action === "logout") {
      await authService.logout();
      state.account = null;
      render();
      return;
    }
    if (action === "navigate") {
      state.page = page;
      render();
      return;
    }
    if (action === "new-record") {
      if (state.account.role === "senior" && !state.shift?.active) {
        toast("Сначала нажмите «Начать смену».", "warning");
        return;
      }
      openRecordDialog();
      return;
    }
    if (action === "start-scale-walk") {
      if (state.account.role === "senior" && !state.shift?.active) {
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
      await shiftService.end();
      state.shift = await shiftService.current();
      render();
      toast("Смена завершена.", "success");
      return;
    }
    if (action === "refresh") {
      await refreshFromSource();
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
    if (["add-employee", "edit-employee", "toggle-employee"].includes(action) && state.account.role !== "manager") {
      toast("Редактировать справочник персонала может только начальник участка.", "error");
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
      return;
    }
    if (action === "workforce-accept-remote") {
      await workforceRepository?.acceptRemote(id);
      state.workforce = await workforceService.snapshot(); render(); return;
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
    if (action === "dismiss-demo") {
      await store.setPreference("demoBannerDismissed", true);
      state.demoBannerDismissed = true;
      render();
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

async function refreshFromSource({ silent = false } = {}) {
  if (!navigator.onLine) {
    if (!silent) toast("Нет интернета. Показаны последние сохранённые данные.", "warning");
    return;
  }
  setBusy(true);
  try {
  const checks = await Promise.allSettled([repository.refresh(), syncWorkforce()]);
  const failed = checks.find(item => item.status === "rejected");
    await reloadLocalState();
    state.lastRefresh = new Date().toISOString();
    render();
    if (!silent) toast(failed ? failed.reason.message : "Данные обновлены.", failed ? "warning" : "success");
  } finally {
    setBusy(false);
  }
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
    const checks = await Promise.allSettled([repository.sync(), syncWorkforce()]);
    const result = checks[0].status === "fulfilled" ? checks[0].value : { sent: 0, conflicts: 0 };
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

function startAutomaticRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(async () => {
    if (!state.account || document.hidden || !navigator.onLine) return;
    await syncRecords({ silent: true });
    await refreshFromSource({ silent: true });
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
          <p>${APP_CONFIG.workstationRole ? "Вход разрешён только для роли, назначенной этому компьютеру." : "Выберите рабочую учётную запись."}</p>
        </div>
        <div class="account-list">
          ${accounts.map(account => `
            <button class="account-card" data-action="login" data-account-id="${account.id}">
              <span class="account-icon">${account.role === "manager" ? "НУ" : "СМ"}</span>
              <span class="account-copy">
                <strong>${account.title}</strong>
                <small>${account.description}</small>
              </span>
              <span class="account-arrow" aria-hidden="true">→</span>
            </button>
          `).join("")}
        </div>
        <p class="privacy-note">${APP_CONFIG.integration.mode === "demo" ? "Рабочие данные этого прототипа хранятся только в браузере и не отправляются в Google." : "Данные синхронизируются через защищённый шлюз участка."}</p>
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
          <div><strong>Packaging-</strong><strong>Filling-Hub</strong></div>
        </div>
        <nav class="main-nav" aria-label="Основное меню">
          ${modulesForAccount().map(module => navItem(module.id, moduleLabel(module), moduleIcon(module.icon))).join("")}
        </nav>
        <div class="sidebar-footer">
          <div class="signed-user">
            <span class="avatar">${state.account.role === "manager" ? "НУ" : "СМ"}</span>
            <span><strong>${state.account.title}</strong><small>${escapeHtml(APP_CONFIG.workstationLabel || ui("account"))}</small></span>
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
            <button class="icon-button" data-action="refresh" title="${ui("refresh")}" aria-label="${ui("refresh")}">${refreshIcon()}</button>
          </div>
        </header>
        ${renderDemoBanner()}
        ${renderPreparationReminder()}
        <section class="page-content">
          ${renderWorkforceConnection()}
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
  if (state.page === "statistics" && state.account.role === "manager") return renderStatisticsPage();
  if (state.page === "settings" && state.account.role === "manager") return renderSettingsPage();
  if (["maintenance", "cyclones"].includes(state.page)) return renderLinkedJournals(state.page);
  if (["packaging", "maintenance", "nonconformities", "specifications", "production", "spare-parts", "ppe-warehouse", "cyclones", "documents"].includes(state.page)) return renderModulePlaceholder(state.page);
  return renderDashboard();
}

function renderDashboard() {
  const active = state.records.filter(record => record.status !== "Аннулировано");
  const within = active.filter(record => record.result === "В пределах допуска").length;
  const outside = active.filter(record => record.result === "Вне допуска").length;
  return `
    ${state.account.role === "manager" ? renderBirthdayReminders() : ""}
    ${state.account.role === "senior" ? renderShiftPanel() : ""}
    ${state.account.role === "senior" ? renderWorkflowPanel() : ""}
    <div class="metric-grid">
      ${metricCard("Записей сегодня", active.filter(record => record.date === today()).length, "В локальном журнале", "neutral")}
      ${metricCard("В пределах допуска", within, "Контроль 50 г", "success")}
      ${metricCard("Вне допуска", outside, outside ? "Требует внимания" : "Отклонений нет", outside ? "danger" : "success")}
      ${metricCard("Ожидает отправки", state.operations.length, navigator.onLine ? "Сеть доступна" : "Отправим позже", state.operations.length ? "warning" : "neutral")}
    </div>
    <div class="dashboard-grid">
      <section class="card recent-card">
        <div class="section-heading">
          <div><p class="eyebrow">Последние действия</p><h2>Недавние записи</h2></div>
          <button class="secondary-button" data-action="navigate" data-page="journals">Открыть контроль</button>
        </div>
        ${renderCompactRecords(state.records.slice(0, 5))}
      </section>
      <section class="card quick-card">
        <div class="section-heading"><div><p class="eyebrow">Быстрый доступ</p><h2>Рабочие разделы</h2></div></div>
        <button class="journal-tile" data-action="navigate" data-page="journals">
          <span class="journal-symbol">13</span>
          <span><strong>Быстрый контроль весов</strong><small>Все весы F1–F13 за один обход</small></span>
          <span aria-hidden="true">→</span>
        </button>
        <button class="journal-tile" data-action="navigate" data-page="attendance"><span class="journal-symbol muted">${attendanceIcon()}</span><span><strong>Табель</strong><small>Начало смены и отметка сотрудников</small></span><span aria-hidden="true">→</span></button>
        <button class="journal-tile" data-action="navigate" data-page="maintenance"><span class="journal-symbol muted">${moduleIcon("tools")}</span><span><strong>Ремонт и ТО</strong><small>Заявки, работы и история станков</small></span><span aria-hidden="true">→</span></button>
      </section>
    </div>`;
}

function renderShiftPanel() {
  if (state.shift?.active) {
    return `
      <section class="shift-strip active">
        <div class="shift-state"><span class="pulse"></span><div><strong>${state.shift.shiftNumber === 2 ? "Вторая" : "Первая"} смена идёт</strong><small>Старший: ${escapeHtml(state.shift.supervisor ?? state.shift.employee)}, ${formatDateTime(state.shift.startedAt)}</small></div></div>
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
  const attendanceReady = Boolean(state.shift?.active);
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
        <div><strong>${state.records.length}</strong> ${plural(state.records.length, "запись", "записи", "записей")}</div>
        <div class="legend"><span class="legend-item"><i class="dot synced"></i>Отправлено</span><span class="legend-item"><i class="dot pending"></i>В очереди</span></div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Дата</th><th>Весы</th><th>Факт</th><th>Отклонение</th><th>Результат</th><th>Исполнитель</th><th>Состояние записи</th><th></th></tr></thead>
          <tbody>${state.records.length ? state.records.map(renderRecordRow).join("") : renderEmptyRow()}</tbody>
        </table>
      </div>
    </section>`;
}

function renderAttendancePage() {
  const teamCounts = state.workforce.shiftTeams.map(team => ({ code: team.code, count: activePersonnel().filter(employee => employee.shiftTeamId === team.id).length }));
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
  const team = teamById(state.shift?.shiftTeamId ?? state.selectedShiftTeamId) ?? state.workforce.shiftTeams[0];
  const members = activePersonnel().filter(employee => employee.shiftTeamId === team?.id).sort(comparePersonnel);
  const supervisors = members.filter(employee => employee.role === "senior-mechanic");
  const savedAttendance = new Map((state.shift?.shiftTeamId === team?.id ? state.shift.attendance : []).map(item => [item.employeeId, item.status]));
  const presentCount = members.filter(employee => attendanceCode(savedAttendance.get(employee.id)) === "11").length;
  const scheduled = team ? getScheduleMonth(team, ...monthParts(today())).some(day => day.date === today() && day.scheduled) : false;
  return `
    <section class="shift-day-banner ${scheduled ? "scheduled" : "substitution"}">
      <span>${scheduled ? "Сегодня" : "Вне графика"}</span>
      <div><strong>${escapeHtml(team?.name ?? "Смена")}${scheduled ? " работает по графику" : " может выйти на подмену"}</strong><small>Цикл 2 рабочих / 2 выходных · ${team?.shiftDurationHours ?? 12} ч на производстве · ${team?.accountingHours ?? 11} учётных часов</small></div>
      <b>${escapeHtml(team?.code ?? "—")}</b>
    </section>
    <form class="card shift-attendance-card" data-form="shift-attendance">
      <div class="shift-form-head">
        <div><p class="eyebrow">Шаг 1 · состав смены</p><h2>${state.shift?.active ? "Исправить присутствие" : "Начать рабочую смену"}</h2><p>Выберите бригаду и отметьте только тех, кто отсутствует.</p></div>
        <div class="attendance-counter"><strong data-attendance-present>${presentCount}</strong><span>из ${members.length}<small>на работе</small></span></div>
      </div>
      <div class="shift-start-controls">
        <label class="field"><span>Рабочая бригада</span><select name="shiftTeamId" data-start-team ${state.shift?.active ? "disabled" : ""}>${state.workforce.shiftTeams.map(item => `<option value="${item.id}" ${item.id === team?.id ? "selected" : ""}>${escapeHtml(item.name)} · ${item.code}</option>`).join("")}</select></label>
        <label class="field"><span>Смена по времени</span><select name="shiftNumber" ${state.shift?.active ? "disabled" : ""}><option value="1" ${state.shift?.shiftNumber !== 2 ? "selected" : ""}>Первая — нужен контроль весов</option><option value="2" ${state.shift?.shiftNumber === 2 ? "selected" : ""}>Вторая — контроль уже выполнен</option></select></label>
        <label class="field"><span>Старший смены</span><select name="supervisor" required ${state.shift?.active ? "disabled" : ""}><option value="">Выберите сотрудника</option>${supervisors.map(employee => `<option ${employee.fullName === (state.shift?.supervisor ?? state.shift?.employee) ? "selected" : ""}>${escapeHtml(employee.fullName)}</option>`).join("")}</select></label>
      </div>
      <div id="attendance-form-error" class="form-error" hidden></div>
      <div class="shift-attendance-list">
        ${members.map(employee => {
          const status = attendanceCode(savedAttendance.get(employee.id));
          return `<label class="shift-person-row"><span class="employee-avatar">${initials(employee.fullName)}</span><span class="shift-person-name"><strong>${escapeHtml(employee.fullName)}</strong><small>${escapeHtml(roleLabel(employee.role))}</small></span><select name="attendance-${employee.id}" data-attendance-status aria-label="Статус: ${attribute(employee.fullName)}">${attendanceStatusOptions(status)}</select></label>`;
        }).join("")}
      </div>
      <div class="shift-form-footer"><p>${state.shift?.active ? "Исправления сохраняются в активной смене и не требуют нового запуска." : "После сохранения появится напоминание о весах, но другие разделы останутся доступны."}</p><button class="primary-button" type="submit">${state.shift?.active ? "Сохранить исправления" : "Подтвердить состав и начать"}</button></div>
    </form>`;
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
  const members = activePersonnel().filter(employee => employee.shiftTeamId === team.id).sort(comparePersonnel);
  return `<section class="card schedule-team-card timesheet-team-card">
    <header><div><span class="team-orb">${team.code}</span><span><strong>${escapeHtml(team.name)}</strong><small>Фактические часы и причины отсутствия</small></span></div><span class="autosave-note">Сохраняется автоматически</span></header>
    <div class="attendance-scroll"><table class="attendance-table timesheet-table"><thead><tr><th class="attendance-person">Сотрудник</th>${days.map(day => dayHeader(day)).join("")}<th class="total-column">Часы</th></tr></thead><tbody>${members.map(employee => renderTimesheetRow(employee, team, days, schedule, records)).join("")}</tbody></table></div>
  </section>`;
}

function renderTimesheetRow(employee, team, days, schedule, records) {
  let total = 0;
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
  return `<tr><th class="attendance-person"><strong>${escapeHtml(employee.fullName)}</strong><small>${escapeHtml(roleLabel(employee.role))}</small></th>${cells}<td class="total-column"><strong>${total}</strong></td></tr>`;
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
        <dl><div><dt>График</dt><dd>${employee.shiftTeamId === "office" ? "5/2 · 8 ч" : "2/2 · 12 ч"}</dd></div><div><dt>Статус</dt><dd>${employee.active === false ? "В архиве" : "Активен"}</dd></div></dl>
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
  const allEmployees = personnel();
  const employees = activePersonnel();
  const todayValue = today();
  const currentMonth = todayValue.slice(0, 7);
  const currentMonthAttendance = (state.workforce.attendance || []).filter(record => String(record.date || "").startsWith(currentMonth) && String(record.value || "") !== "");
  const activeVacations = (state.workforce.vacations || []).filter(record => ["Запланирован", "Согласован", "Использован"].includes(record.status));
  const profileComplete = employees.filter(employee => employee.birthday && employee.hireDate && employee.phone && employee.email).length;
  const teams = [
    { id: "office", name: "Администрация", code: "5/2" },
    ...state.workforce.shiftTeams
  ];
  const roleRows = Object.entries(ROLE_LABELS).map(([role, label]) => ({
    label,
    active: employees.filter(employee => employee.role === role).length,
    archived: allEmployees.filter(employee => employee.role === role && employee.active === false).length
  })).filter(row => row.active || row.archived);

  return `
    <section class="settings-hero card">
      <div><p class="eyebrow">Сводные показатели участка</p><h2>Статистика</h2><p>Общие данные по персоналу, сменам, табелю и доступным журналам. Личные сведения сотрудников здесь не отображаются.</p></div>
      <span class="status-pill success">Только начальник</span>
    </section>
    <section class="metric-grid">
      ${metricCard("Сотрудников", employees.length, `${allEmployees.length - employees.length} в архиве`, "neutral")}
      ${metricCard("Карточки заполнены", profileComplete, `из ${employees.length} активных`, profileComplete === employees.length ? "success" : "warning")}
      ${metricCard("Отметок табеля", currentMonthAttendance.length, `за ${escapeHtml(monthTitle(currentMonth))}`, "neutral")}
      ${metricCard("Периодов отпуска", activeVacations.length, "запланировано или согласовано", activeVacations.length ? "warning" : "success")}
    </section>
    <div class="settings-grid">
      <section class="card settings-section">
        <div class="section-heading"><div><p class="eyebrow">Состав смен</p><h2>Сотрудники по бригадам</h2></div></div>
        ${teams.map(team => {
          const count = employees.filter(employee => employee.shiftTeamId === team.id).length;
          const leaders = employees.filter(employee => employee.shiftTeamId === team.id && ["senior-mechanic", "mechanic"].includes(employee.role)).length;
          return settingRow(escapeHtml(team.name), `${count}`, leaders ? `${leaders} ответственных за техническую часть` : "Сотрудники участка");
        }).join("")}
      </section>
      <section class="card settings-section">
        <div class="section-heading"><div><p class="eyebrow">Качество справочника</p><h2>Заполнение карточек</h2></div></div>
        ${settingRow("Дата рождения", `${employees.filter(employee => employee.birthday).length} из ${employees.length}`, "Нужно для напоминаний")}
        ${settingRow("Дата приёма", `${employees.filter(employee => employee.hireDate).length} из ${employees.length}`, "Для истории стажа")}
        ${settingRow("Телефон", `${employees.filter(employee => employee.phone).length} из ${employees.length}`, "Виден только начальнику")}
        ${settingRow("Электронная почта", `${employees.filter(employee => employee.email).length} из ${employees.length}`, "Видна только начальнику")}
      </section>
      <section class="card settings-section wide">
        <div class="section-heading"><div><p class="eyebrow">Должности</p><h2>Структура персонала</h2></div><span class="status-pill muted">Активные / архив</span></div>
        <div class="settings-table-wrap"><table class="settings-data-table"><thead><tr><th>Должность</th><th>Работают</th><th>В архиве</th></tr></thead><tbody>${roleRows.map(row => `<tr><td><strong>${escapeHtml(row.label)}</strong></td><td>${row.active}</td><td>${row.archived || "—"}</td></tr>`).join("") || "<tr><td colspan=\"3\">Данные пока не загружены.</td></tr>"}</tbody></table></div>
      </section>
    </div>`;
}

function formatPersonnelDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "Не указана";
}

function renderVacationsPage() {
  const rows = [...(state.workforce.vacations || [])].sort((a, b) => a.year - b.year || String(a.startDate).localeCompare(String(b.startDate)));
  const canEdit = state.account.role === "manager";
  return `<section class="card module-header"><div><h2>График отпусков</h2><p>${canEdit ? "Одна запись — один период. Итоги считаются в календарных днях." : "Только просмотр. Изменять график отпусков может начальник участка."}</p></div>${canEdit ? `<button class="primary-button" data-action="add-vacation">+ Добавить период</button>${journalLink("vacations")}` : '<span class="status-pill muted">Только просмотр</span>'}</section>
    <section class="card settings-table-wrap"><table class="settings-data-table"><thead><tr><th>Год</th><th>Сотрудник</th><th>Начало</th><th>Окончание</th><th>Дней</th><th>Статус</th>${canEdit ? "<th></th>" : ""}</tr></thead><tbody>${rows.map(v => `<tr><td>${v.year}</td><td>${escapeHtml(personnel().find(p => p.id === v.employeeId)?.fullName || v.employeeId)}</td><td>${escapeHtml(v.startDate || "—")}</td><td>${escapeHtml(v.endDate || "—")}</td><td>${v.days ?? "—"}</td><td>${escapeHtml(v.status)}${v.syncStatus ? " · ожидает отправки" : ""}</td>${canEdit ? `<td><button class="small-button" data-action="edit-vacation" data-id="${attribute(v.id)}">Изменить</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="${canEdit ? 7 : 6}">Периоды пока не загружены.</td></tr>`}</tbody></table></section>`;
}

function renderLinkedJournals(page) {
  const isRepair = page === "maintenance";
  const primary = isRepair ? WORKSPACE_JOURNALS.repairs : WORKSPACE_JOURNALS.cyclones;
  const secondary = isRepair ? WORKSPACE_JOURNALS.maintenance : null;
  return `<section class="module-placeholder">
    <div class="placeholder-hero card"><span class="placeholder-icon">${moduleIcon(isRepair ? "tools" : "cyclone")}</span><div><p class="eyebrow">Рабочий журнал Google Sheets</p><h2>${escapeHtml(isRepair ? "Ремонт и ТО станков" : "Очистка циклонов")}</h2><p>${isRepair ? "Журнал ремонта и журнал ТО разделены. В каждом есть собственная вкладка «Статистика»." : "Рабочий журнал ведётся в Google Sheets и открывается из программы."}</p></div><span class="status-pill success">Подключено</span></div>
    <div class="linked-journal-grid"><article class="card linked-journal"><h3>${escapeHtml(primary.title)}</h3><p>Отдельный рабочий журнал с вкладкой «Статистика».</p>${journalLink(isRepair ? "repairs" : "cyclones", "Открыть журнал")}</article>${secondary ? `<article class="card linked-journal"><h3>${escapeHtml(secondary.title)}</h3><p>Отдельный рабочий журнал с вкладкой «Статистика».</p>${journalLink("maintenance", "Открыть журнал")}</article>` : ""}</div>
    <p class="module-note">Следующим шагом можно добавить в этот раздел быстрые формы ввода с офлайн-очередью, не меняя устройство самих журналов.</p>
  </section>`;
}

function journalLink(key, label = "Открыть в Google Sheets") {
  const journal = WORKSPACE_JOURNALS[key];
  if (!journal) return "";
  return `<a class="secondary-button journal-link" href="https://docs.google.com/spreadsheets/d/${journal.id}/edit" target="_blank" rel="noreferrer">${escapeHtml(label)} ↗</a>`;
}

function renderModulePlaceholder(page) {
  const module = MODULES.find(item => item.id === page);
  const notes = {
    packaging: "Учёт использованных банок, крышек, этикеток и другой упаковки.",
    maintenance: "Заявки на ремонт, техническое обслуживание и история работ по станкам.",
    nonconformities: "Регистрация отклонений, решений, ответственных и статуса выполнения.",
    specifications: "Просмотр утверждённых параметров продуктов и упаковки.",
    production: "Выпуск готовой продукции, брак и итоги по сменам.",
    "spare-parts": "Остатки, выдача и поступление запасных частей.",
    "ppe-warehouse": "Остатки, выдача и поступление средств индивидуальной защиты.",
    cyclones: "План и журнал очистки циклонов с напоминаниями.",
    documents: "Инструкции, формы и другие документы; подразделы добавим после согласования."
  };
  return `<section class="module-placeholder">
    <div class="placeholder-hero card"><span class="placeholder-icon">${moduleIcon(module?.icon)}</span><div><p class="eyebrow">Раздел программы</p><h2>${escapeHtml(moduleLabel(module))}</h2><p>${escapeHtml(notes[page] ?? "Раздел будет настроен после подключения рабочего источника.")}</p></div><span class="status-pill warning">Следующий этап</span></div>
    <div class="placeholder-grid">
      <article class="card"><span>1</span><h3>Определить источник</h3><p>Выберем нужную таблицу или документ на Общем диске.</p></article>
      <article class="card"><span>2</span><h3>Согласовать поля</h3><p>Зафиксируем, что читаем и в какие существующие строки записываем.</p></article>
      <article class="card"><span>3</span><h3>Подключить форму</h3><p>Сделаем быстрый ввод, офлайн-очередь и контроль конфликтов.</p></article>
    </div>
  </section>`;
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
        <p>${navigator.onLine ? "Программа готова автоматически отправлять новые записи." : "Можно продолжать работу. Всё сохранится на этом компьютере и отправится позже."}</p>
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
          ${settingRow("Автообновление", "Каждые 60 секунд", "Также доступна ручная кнопка")}
          ${settingRow("Запись в Google", APP_CONFIG.integration.googleWritesEnabled ? "Включена" : "Выключена", APP_CONFIG.integration.googleWritesEnabled ? "Через защищённый шлюз" : "До контролируемой проверки")}
          ${settingRow("Часовой пояс", APP_CONFIG.timeZone, "Дата и время заполняются автоматически")}
        </section>
        <section class="card settings-section">
          <div class="section-heading"><div><p class="eyebrow">Интерфейс</p><h2>Язык и оформление</h2></div></div>
          ${settingRow("Язык", language.name, "RU · EN · LT")}
          ${settingRow("Тема", state.theme === "dark" ? "Тёмная" : "Светлая", "Переключается также в верхней панели")}
          ${settingRow("Дата и время", APP_CONFIG.timeZone, "Часы отображаются постоянно")}
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
    <header><span class="team-orb">${team.code}</span><div><p class="eyebrow">Рабочая бригада</p><h2>${escapeHtml(team.name)}</h2></div></header>
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
          ${formField("walk-performer", "Кто проводит проверку", `<select id="walk-performer" name="performer" required><option value="">Выберите имя и фамилию</option>${employeeNames().map(employee => `<option>${escapeHtml(employee)}</option>`).join("")}</select>`, "Выбирается заново перед каждым обходом")}
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
      await syncRecords({ silent: true });
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
        ${formField("performer", "Кто внёс данные", `<select id="performer" name="performer" required><option value="">Выберите имя и фамилию</option>${employeeNames().map(employee => `<option ${employee === values.performer && !existing ? "selected" : ""}>${escapeHtml(employee)}</option>`).join("")}</select>`, "Выбирается заново для каждой записи", "full")}
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
      await syncRecords({ silent: true });
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
      ${formField("performer", "Кто аннулирует", `<select id="performer" name="performer" required><option value="">Выберите имя и фамилию</option>${employeeNames().map(employee => `<option>${escapeHtml(employee)}</option>`).join("")}</select>`)}
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
      await syncRecords({ silent: true });
    } catch (error) {
      showFormError(event.currentTarget, error);
    }
  });
  dialog.showModal();
}

function openEmployeeDialog(id = null) {
  if (state.account.role !== "manager") throw new Error("Редактировать справочник персонала может только начальник участка.");
  const employee = id ? personnel().find(item => item.id === id) : null;
  const dialog = createDialog(`
    <form class="dialog-card employee-dialog" data-employee-form>
      <div class="dialog-heading"><div><p class="eyebrow">Справочник персонала</p><h2>${employee ? "Изменить сотрудника" : "Новый сотрудник"}</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
      <p class="dialog-lead">Основные данные используются в графике смен, табеле и списке исполнителей. Личные сведения доступны только начальнику участка.</p>
      <div id="form-error" class="form-error" hidden></div>
      <div class="form-grid">
        ${formField("employee-full-name", "Имя и фамилия", `<input id="employee-full-name" name="fullName" value="${attribute(employee?.fullName ?? "")}" autocomplete="off" required>`, "Как в рабочих документах", "full")}
        ${formField("employee-role", "Должность", `<select id="employee-role" name="role" required>${Object.entries(ROLE_LABELS).map(([role, label]) => `<option value="${role}" ${employee?.role === role ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`)}
        ${formField("employee-team", "Смена", `<select id="employee-team" name="shiftTeamId" required><option value="office" ${employee?.shiftTeamId === "office" ? "selected" : ""}>Администрация · 5/2</option>${state.workforce.shiftTeams.map(team => `<option value="${team.id}" ${employee?.shiftTeamId === team.id ? "selected" : ""}>${escapeHtml(team.name)} · 2/2</option>`).join("")}</select>`)}
        ${formField("employee-birthday", "Дата рождения", `<input id="employee-birthday" name="birthday" type="date" value="${attribute(employee?.birthday ?? "")}">`)}
        ${formField("employee-hire-date", "Дата приёма", `<input id="employee-hire-date" name="hireDate" type="date" value="${attribute(employee?.hireDate ?? "")}">`)}
        ${formField("employee-phone", "Телефон", `<input id="employee-phone" name="phone" type="tel" value="${attribute(employee?.phone ?? "")}" autocomplete="tel">`)}
        ${formField("employee-email", "Электронная почта", `<input id="employee-email" name="email" type="email" value="${attribute(employee?.email ?? "")}" autocomplete="email">`)}
      </div>
      <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button class="primary-button" type="submit">Сохранить</button></div>
    </form>`);
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
    } catch (error) {
      showFormError(form, error);
      button.disabled = false;
    }
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
  return `<div class="queue-item"><span class="queue-icon ${conflict ? "conflict" : "pending"}">${conflict ? "!" : "↥"}</span><span><strong>${escapeHtml(labels[operation.kind] || "Журнал")}</strong><small>${escapeHtml(operation.actor?.performer || "Автор не указан")} · ${formatDateTime(operation.record?.updatedAt || new Date().toISOString())}</small></span><span class="status-pill ${conflict ? "danger" : "warning"}">${conflict ? "Конфликт" : "В очереди"}</span>${conflict ? `<button class="small-button" data-action="workforce-accept-remote" data-id="${attribute(operation.requestId)}">Оставить версию Google</button>` : ""}</div>`;
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
        ${formField("vacation-person", "Сотрудник", `<select id="vacation-person" name="employeeId" required><option value="">Выберите сотрудника</option>${personnel().filter(employee => employee.shiftTeamId !== "office").sort(comparePersonnel).map(employee => `<option value="${attribute(employee.id)}" ${vacation?.employeeId === employee.id ? "selected" : ""}>${escapeHtml(employee.fullName)}</option>`).join("")}</select>`, "Можно выбрать сотрудника из архива для старой записи", "full")}
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
    } catch (error) {
      showFormError(form, error);
      button.disabled = false;
    }
  });
  dialog.showModal();
}

function withWorkforceActor(action) {
  if (!workforceRepository) return action();
  return chooseWorkforceActor().then(async performer => {
    workforceActor = { performer };
    return action();
  });
}

function chooseWorkforceActor() {
  const names = employeeNames();
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

function renderDemoBanner() {
  if (APP_CONFIG.integration.mode !== "demo") return "";
  if (state.demoBannerDismissed) return "";
  return `<div class="demo-banner"><span class="demo-icon">i</span><p><strong>Безопасный тестовый режим.</strong> Здесь показаны демонстрационные записи. Связь с рабочей таблицей пока выключена.</p><button data-action="dismiss-demo" aria-label="Закрыть">×</button></div>`;
}

function renderPreparationReminder() {
  if (state.account?.role !== "senior") return "";
  if (!state.shift?.active) {
    return `<button class="preparation-reminder" data-action="navigate" data-page="attendance"><span>1</span><div><strong>Смена ещё не начата</strong><small>Заполните табель. Разделы доступны — это напоминание, а не блокировка.</small></div><b>Перейти →</b></button>`;
  }
  if (state.shift.requiresScaleControl && !state.shift.weightsCompletedAt) {
    return `<button class="preparation-reminder scales" data-action="navigate" data-page="journals"><span>13</span><div><strong>Не завершён контроль весов F1–F13</strong><small>Продолжить работу можно, но напоминание останется до сохранения полного обхода.</small></div><b>Проверить →</b></button>`;
  }
  return "";
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
    ${navItem("documents", moduleLabelById("documents"), moduleIcon("documents"))}
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

function scheduledTeam(date = today()) {
  const [year, monthIndex] = monthParts(date);
  return state.workforce?.shiftTeams?.find(team => getScheduleMonth(team, year, monthIndex).some(day => day.date === date && day.scheduled)) ?? null;
}

function teamsWithCurrentShiftFirst() {
  const currentTeamId = state.shift?.active ? state.shift.shiftTeamId : scheduledTeam()?.id;
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

async function saveShiftAttendanceToTimesheet(teamId, attendance) {
  const date = today();
  await withWorkforceActor(async () => {
    for (const item of attendance) {
      await workforceService.saveAttendance({ date, shiftTeamId: teamId, employeeId: item.employeeId, value: attendanceCode(item.status) });
    }
  });
  if (workforceRepository) await syncWorkforce();
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
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
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
