// Автоматически собранная браузерная версия. Исходные модули находятся в локальном Git-коммите.

// ---- src/config/app-config.js ----
const APP_CONFIG = Object.freeze({
  name: "Фасовочный участок",
  version: "0.1.0",
  locale: "ru-RU",
  timeZone: "Europe/Vilnius",
  refreshIntervalMs: 60_000,
  integration: {
    mode: "demo",
    googleWritesEnabled: false,
    spreadsheetId: "1An019JRwrya4wl9EtqY4zNELfRNzaq26sidhQce3Tc8",
    sheetId: 1257425673,
    sheetName: "Контроль 50г"
  }
});

const ACCOUNTS = Object.freeze([
  {
    id: "manager",
    role: "manager",
    title: "Начальник участка",
    description: "Все журналы, настройки, сотрудники и права доступа"
  },
  {
    id: "senior-mechanic",
    role: "senior",
    title: "Старший механик",
    description: "Работа со сменой и разрешёнными журналами"
  }
]);

const EMPLOYEES = Object.freeze([
  "Albert Krevski",
  "Vladislav Balašov",
  "Viktor Minin",
  "Vitalii Paliienko",
  "Anatolii Brazhko"
]);

const JOURNALS = Object.freeze([
  {
    id: "scale-check-50g",
    title: "Контроль весов 50 г",
    description: "Ежедневная проверка контрольной гирей 50 г",
    source: "Google Sheets",
    sheetName: "Контроль 50г",
    refreshSeconds: 60,
    permissions: ["manager", "senior"],
    scaleOptions: ["WTC 600 (F10)"],
    nominal: 50,
    tolerance: 0.05
  }
]);

// ---- src/domain/scale-check.js ----
const ALLOWED_STATES = new Set(["Рабочие", "Нерабочие"]);

class ValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

class ConflictError extends Error {
  constructor(message, currentRecord) {
    super(message);
    this.name = "ConflictError";
    this.currentRecord = currentRecord;
  }
}

function makeId(prefix = "record") {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function validateScaleCheck(input, journal) {
  const fields = {};
  const actual = Number(input.actual);

  if (!input.date) fields.date = "Укажите дату проверки";
  if (!input.scaleName) fields.scaleName = "Выберите весы";
  if (input.actual === "" || input.actual === null || input.actual === undefined) {
    fields.actual = "Введите фактический вес";
  } else if (!Number.isFinite(actual) || actual < 0) {
    fields.actual = "Введите корректное положительное число";
  }
  if (!ALLOWED_STATES.has(input.condition)) fields.condition = "Выберите состояние весов";
  if (!input.performer) fields.performer = "Выберите исполнителя";

  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Проверьте заполнение формы", fields);
  }

  return {
    date: input.date,
    scaleName: input.scaleName.trim(),
    nominal: journal.nominal,
    actual,
    deviation: round(actual - journal.nominal, 3),
    condition: input.condition,
    result: calculateResult(actual, journal.nominal, journal.tolerance),
    performer: input.performer,
    note: String(input.note ?? "").trim()
  };
}

function calculateResult(actual, nominal, tolerance) {
  return Math.abs(Number(actual) - Number(nominal)) <= Number(tolerance) + Number.EPSILON
    ? "В пределах допуска"
    : "Вне допуска";
}

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
}

function getVilniusDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Vilnius",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Vilnius",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

// ---- src/providers/indexed-db-data-provider.js ----
const DATABASE_NAME = "packaging-filling-hub";
const DATABASE_VERSION = 1;
const STORES = ["records", "remoteRecords", "operations", "preferences", "audit"];

class IndexedDbDataProvider {
  #database;

  async init() {
    if (!globalThis.indexedDB) throw new Error("Браузер не поддерживает локальное хранилище IndexedDB");
    this.#database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name, { keyPath: name === "preferences" ? "key" : "id" });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this;
  }

  async get(storeName, key) {
    return this.#request(storeName, "readonly", store => store.get(key));
  }

  async getAll(storeName) {
    return this.#request(storeName, "readonly", store => store.getAll());
  }

  async put(storeName, value) {
    await this.#request(storeName, "readwrite", store => store.put(value));
    return value;
  }

  async delete(storeName, key) {
    await this.#request(storeName, "readwrite", store => store.delete(key));
  }

  async preference(key, fallback = null) {
    return (await this.get("preferences", key))?.value ?? fallback;
  }

  async setPreference(key, value) {
    return this.put("preferences", { key, value });
  }

  #request(storeName, mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = this.#database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}

// ---- src/providers/demo-google-sheets-provider.js ----
class DemoGoogleSheetsProvider {
  constructor(store) {
    this.store = store;
    this.mode = "demo";
  }

  async init(seedRecords) {
    const current = await this.store.getAll("remoteRecords");
    if (current.length === 0) {
      for (const record of seedRecords) await this.store.put("remoteRecords", record);
    }
  }

  async list() {
    this.#assertOnline();
    await delay(120);
    return this.store.getAll("remoteRecords");
  }

  async write(operation) {
    this.#assertOnline();
    await delay(160);
    const current = await this.store.get("remoteRecords", operation.record.id);

    if (operation.type !== "create") {
      if (!current) throw new ConflictError("Запись отсутствует в источнике", null);
      if (current.version !== operation.expectedVersion) {
        throw new ConflictError("Запись уже была изменена", current);
      }
    }

    const timestamp = new Date().toISOString();
    const saved = {
      ...operation.record,
      version: operation.type === "create" ? 1 : current.version + 1,
      updatedAt: timestamp,
      syncState: "synced",
      source: "demo"
    };
    await this.store.put("remoteRecords", saved);
    return saved;
  }

  #assertOnline() {
    if (globalThis.navigator && !navigator.onLine) {
      const error = new Error("Нет подключения к сети");
      error.name = "OfflineError";
      throw error;
    }
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// ---- src/repositories/journal-repository.js ----
class JournalRepository {
  constructor(localProvider, remoteProvider) {
    this.local = localProvider;
    this.remote = remoteProvider;
  }

  async init(seedRecords = []) {
    await this.remote.init(seedRecords);
    if ((await this.local.getAll("records")).length === 0) {
      for (const record of seedRecords) await this.local.put("records", record);
    }
  }

  async list() {
    const records = await this.local.getAll("records");
    return records.sort((a, b) => `${b.date}${b.updatedAt}`.localeCompare(`${a.date}${a.updatedAt}`));
  }

  async get(id) {
    return this.local.get("records", id);
  }

  async save(record, { type, expectedVersion, actor }) {
    const now = new Date().toISOString();
    const localRecord = {
      ...record,
      updatedAt: now,
      updatedBy: actor,
      syncState: "pending"
    };
    await this.local.put("records", localRecord);
    await this.local.put("operations", {
      id: makeId("op"),
      requestId: makeId("request"),
      record: localRecord,
      recordId: localRecord.id,
      type,
      expectedVersion,
      createdAt: now,
      attempts: 0,
      state: "pending",
      error: null
    });
    return localRecord;
  }

  async pendingOperations() {
    return (await this.local.getAll("operations"))
      .filter(item => item.state !== "done")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async sync() {
    const operations = await this.pendingOperations();
    const result = { sent: 0, conflicts: 0, failed: 0 };

    for (const operation of operations) {
      if (operation.state === "conflict") continue;
      try {
        const saved = await this.remote.write(operation);
        await this.local.put("records", saved);
        await this.local.put("operations", { ...operation, state: "done", error: null });
        result.sent += 1;
      } catch (error) {
        if (error instanceof ConflictError || error.name === "ConflictError") {
          await this.local.put("operations", {
            ...operation,
            state: "conflict",
            attempts: operation.attempts + 1,
            error: error.message,
            remoteRecord: error.currentRecord
          });
          const record = await this.get(operation.recordId);
          if (record) await this.local.put("records", { ...record, syncState: "conflict" });
          result.conflicts += 1;
          continue;
        }
        await this.local.put("operations", {
          ...operation,
          state: "pending",
          attempts: operation.attempts + 1,
          error: error.message
        });
        result.failed += 1;
        if (error.name === "OfflineError") break;
      }
    }
    return result;
  }

  async refresh() {
    const remoteRecords = await this.remote.list();
    const pendingIds = new Set((await this.pendingOperations()).map(item => item.recordId));
    for (const record of remoteRecords) {
      if (!pendingIds.has(record.id)) await this.local.put("records", record);
    }
    return this.list();
  }
}

// ---- src/services/auth-service.js ----
class AuthService {
  constructor(store) {
    this.store = store;
  }

  async current() {
    const accountId = await this.store.preference("sessionAccount");
    return ACCOUNTS.find(account => account.id === accountId) ?? null;
  }

  async login(accountId) {
    const account = ACCOUNTS.find(item => item.id === accountId);
    if (!account) throw new Error("Учётная запись не найдена");
    await this.store.setPreference("sessionAccount", account.id);
    return account;
  }

  async logout() {
    await this.store.setPreference("sessionAccount", null);
  }
}

// ---- src/services/shift-service.js ----
class ShiftService {
  constructor(store) {
    this.store = store;
  }

  async current() {
    return this.store.preference("activeShift");
  }

  async start(employee) {
    const current = await this.current();
    if (current?.active) return current;
    const shift = {
      active: true,
      employee,
      startedAt: new Date().toISOString(),
      endedAt: null
    };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }

  async end() {
    const current = await this.current();
    if (!current?.active) return current;
    const shift = { ...current, active: false, endedAt: new Date().toISOString() };
    await this.store.setPreference("activeShift", shift);
    return shift;
  }
}

// ---- src/services/journal-service.js ----
class JournalService {
  constructor(repository, journal) {
    this.repository = repository;
    this.journal = journal;
  }

  list() {
    return this.repository.list();
  }

  async create(input, account) {
    const values = validateScaleCheck(input, this.journal);
    const now = new Date().toISOString();
    const record = {
      id: makeId("scale"),
      journalId: this.journal.id,
      ...values,
      status: "Действует",
      annulReason: null,
      version: 0,
      createdAt: now,
      createdBy: values.performer,
      updatedAt: now,
      updatedBy: values.performer,
      source: "local"
    };
    return this.repository.save(record, {
      type: "create",
      expectedVersion: 0,
      actor: `${values.performer} (${account.title})`
    });
  }

  async update(id, input, account) {
    const current = await this.repository.get(id);
    if (!current) throw new Error("Запись не найдена");
    if (current.status === "Аннулировано") throw new Error("Аннулированную запись нельзя изменять");
    const values = validateScaleCheck(input, this.journal);
    return this.repository.save({ ...current, ...values }, {
      type: "update",
      expectedVersion: current.version,
      actor: `${values.performer} (${account.title})`
    });
  }

  async annul(id, reason, performer, account) {
    const current = await this.repository.get(id);
    if (!current) throw new Error("Запись не найдена");
    if (!reason?.trim()) throw new Error("Укажите причину аннулирования");
    return this.repository.save({
      ...current,
      status: "Аннулировано",
      annulReason: reason.trim(),
      performer
    }, {
      type: "annul",
      expectedVersion: current.version,
      actor: `${performer} (${account.title})`
    });
  }

  emptyForm() {
    return {
      date: getVilniusDate(),
      scaleName: this.journal.scaleOptions[0] ?? "",
      actual: "",
      condition: "Рабочие",
      performer: "",
      note: ""
    };
  }
}

// ---- src/data/demo-records.js ----
function createDemoRecords() {
  const today = getVilniusDate();
  return [
    demo("demo-1", today, 50, "Albert Krevski", "Проверка перед началом смены"),
    demo("demo-2", today, 49.98, "Vladislav Balašov", "Повторная проверка")
  ];
}

function demo(id, date, actual, performer, note) {
  const timestamp = new Date().toISOString();
  return {
    id,
    journalId: "scale-check-50g",
    date,
    scaleName: "WTC 600 (F10)",
    nominal: 50,
    actual,
    deviation: Number((actual - 50).toFixed(3)),
    condition: "Рабочие",
    result: Math.abs(actual - 50) <= 0.05 ? "В пределах допуска" : "Вне допуска",
    performer,
    note,
    status: "Действует",
    annulReason: null,
    version: 1,
    createdAt: timestamp,
    createdBy: performer,
    updatedAt: timestamp,
    updatedBy: performer,
    syncState: "synced",
    source: "demo"
  };
}

// ---- src/app.js ----
const root = document.querySelector("#app");
const journal = JOURNALS[0];
const state = {
  account: null,
  shift: null,
  records: [],
  operations: [],
  page: "dashboard",
  loading: true,
  syncing: false,
  lastRefresh: null,
  demoBannerDismissed: false
};

let store;
let authService;
let shiftService;
let repository;
let journalService;
let refreshTimer;

bootstrap().catch(error => renderFatalError(error));

async function bootstrap() {
  store = await new IndexedDbDataProvider().init();
  const remoteProvider = new DemoGoogleSheetsProvider(store);
  repository = new JournalRepository(store, remoteProvider);
  authService = new AuthService(store);
  shiftService = new ShiftService(store);
  journalService = new JournalService(repository, journal);

  await repository.init(createDemoRecords());
  state.account = await authService.current();
  state.shift = await shiftService.current();
  state.demoBannerDismissed = await store.preference("demoBannerDismissed", false);
  await reloadLocalState();
  state.loading = false;
  state.lastRefresh = new Date().toISOString();
  render();
  bindGlobalEvents();
  startAutomaticRefresh();
  registerServiceWorker();
  if (navigator.onLine) syncRecords({ silent: true });
}

function bindGlobalEvents() {
  root.addEventListener("click", handleClick);
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
    if (action === "edit-record") {
      openRecordDialog(id);
      return;
    }
    if (action === "annul-record") {
      openAnnulDialog(id);
      return;
    }
    if (action === "start-shift") {
      openShiftDialog();
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

async function refreshFromSource({ silent = false } = {}) {
  if (!navigator.onLine) {
    if (!silent) toast("Нет интернета. Показаны последние сохранённые данные.", "warning");
    return;
  }
  setBusy(true);
  try {
    await repository.refresh();
    await reloadLocalState();
    state.lastRefresh = new Date().toISOString();
    render();
    if (!silent) toast("Данные обновлены.", "success");
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
    const result = await repository.sync();
    await reloadLocalState();
    state.lastRefresh = new Date().toISOString();
    render();
    if (!silent) {
      if (result.conflicts) toast(`Обнаружено конфликтов: ${result.conflicts}.`, "warning");
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
  document.title = state.account
    ? `${pageTitle()} — ${APP_CONFIG.name}`
    : APP_CONFIG.name;
  root.innerHTML = state.account ? renderApplication() : renderLogin();
}

function renderLogin() {
  return `
    <main class="login-shell">
      <section class="login-brand" aria-labelledby="login-title">
        <div class="brand-mark large" aria-hidden="true">ФУ</div>
        <p class="eyebrow">Электронные журналы производства</p>
        <h1 id="login-title">Фасовочный участок</h1>
        <p class="login-lead">Заполняйте журналы быстро, продолжайте работу без интернета и не переносите данные вручную.</p>
        <ul class="feature-list">
          <li><span>✓</span> Google Sheets остаётся главным источником</li>
          <li><span>✓</span> Автоматическая отправка при появлении сети</li>
          <li><span>✓</span> Автор каждой записи сохраняется</li>
        </ul>
      </section>
      <section class="login-panel" aria-label="Выбор учётной записи">
        <div class="panel-heading">
          <span class="mode-pill">Тестовый режим</span>
          <h2>Кто работает?</h2>
          <p>Выберите рабочую учётную запись. Пароли будут включены перед установкой.</p>
        </div>
        <div class="account-list">
          ${ACCOUNTS.map(account => `
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
        <p class="privacy-note">Рабочие данные этого прототипа хранятся только в браузере и не отправляются в Google.</p>
      </section>
    </main>`;
}

function renderApplication() {
  return `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand-row">
          <div class="brand-mark">ФУ</div>
          <div><strong>Фасовочный</strong><small>участок</small></div>
        </div>
        <nav class="main-nav" aria-label="Основное меню">
          ${navItem("dashboard", "Обзор", dashboardIcon())}
          ${navItem("journals", "Журналы", journalIcon())}
          ${navItem("sync", "Синхронизация", syncIcon(), state.operations.length)}
          ${state.account.role === "manager" ? navItem("settings", "Настройки", settingsIcon()) : ""}
        </nav>
        <div class="sidebar-footer">
          <div class="signed-user">
            <span class="avatar">${state.account.role === "manager" ? "НУ" : "СМ"}</span>
            <span><strong>${state.account.title}</strong><small>Рабочая учётная запись</small></span>
          </div>
          <button class="text-button" data-action="logout">Выйти</button>
        </div>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <div><p class="eyebrow">${APP_CONFIG.name}</p><h1>${pageTitle()}</h1></div>
          <div class="topbar-actions">
            ${connectionBadge()}
            <button class="icon-button" data-action="refresh" title="Обновить данные" aria-label="Обновить данные">${refreshIcon()}</button>
          </div>
        </header>
        ${renderDemoBanner()}
        <section class="page-content">
          ${renderPage()}
        </section>
      </main>
      ${renderMobileNav()}
    </div>
    <div id="toast-region" class="toast-region" aria-live="assertive"></div>`;
}

function renderPage() {
  if (state.page === "journals") return renderJournalsPage();
  if (state.page === "sync") return renderSyncPage();
  if (state.page === "settings" && state.account.role === "manager") return renderSettingsPage();
  return renderDashboard();
}

function renderDashboard() {
  const active = state.records.filter(record => record.status !== "Аннулировано");
  const within = active.filter(record => record.result === "В пределах допуска").length;
  const outside = active.filter(record => record.result === "Вне допуска").length;
  return `
    ${state.account.role === "senior" ? renderShiftPanel() : ""}
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
          <button class="secondary-button" data-action="navigate" data-page="journals">Открыть журнал</button>
        </div>
        ${renderCompactRecords(state.records.slice(0, 5))}
      </section>
      <section class="card quick-card">
        <div class="section-heading"><div><p class="eyebrow">Быстрый доступ</p><h2>Рабочие журналы</h2></div></div>
        <button class="journal-tile" data-action="navigate" data-page="journals">
          <span class="journal-symbol">50</span>
          <span><strong>${journal.title}</strong><small>${journal.description}</small></span>
          <span aria-hidden="true">→</span>
        </button>
        <div class="coming-soon"><span>+</span><p><strong>Следующие журналы</strong><small>Начальник сможет подключать их по мере готовности.</small></p></div>
      </section>
    </div>`;
}

function renderShiftPanel() {
  if (state.shift?.active) {
    return `
      <section class="shift-strip active">
        <div class="shift-state"><span class="pulse"></span><div><strong>Смена идёт</strong><small>Начал: ${escapeHtml(state.shift.employee)}, ${formatDateTime(state.shift.startedAt)}</small></div></div>
        <button class="danger-outline-button" data-action="end-shift">Завершить смену</button>
      </section>`;
  }
  return `
    <section class="shift-strip">
      <div class="shift-state"><span class="shift-dot"></span><div><strong>Смена не начата</strong><small>Для добавления записей отметьте начало смены.</small></div></div>
      <button class="primary-button" data-action="start-shift">Начать смену</button>
    </section>`;
}

function renderJournalsPage() {
  return `
    <section class="journal-header card">
      <div class="journal-title-block">
        <span class="journal-symbol large-symbol">50</span>
        <div><p class="eyebrow">Google Sheets · ${journal.sheetName}</p><h2>${journal.title}</h2><p>${journal.description}</p></div>
      </div>
      <div class="journal-actions">
        <button class="secondary-button" data-action="refresh">${refreshIcon()} Обновить</button>
        <button class="primary-button" data-action="new-record">+ Новая запись</button>
      </div>
    </section>
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
      ${metricCard("В очереди", pending.length, "Ожидает отправки", pending.length ? "warning" : "neutral")}
      ${metricCard("Конфликты", conflicts.length, conflicts.length ? "Нужно выбрать версию" : "Конфликтов нет", conflicts.length ? "danger" : "success")}
      ${metricCard("Последнее обновление", state.lastRefresh ? formatDateTime(state.lastRefresh) : "—", "Автоматически каждые 60 секунд", "neutral", true)}
    </div>
    <section class="card queue-card">
      <div class="section-heading"><div><p class="eyebrow">Локальная очередь</p><h2>Неотправленные изменения</h2></div></div>
      ${state.operations.length ? `<div class="queue-list">${state.operations.map(renderOperation).join("")}</div>` : `<div class="empty-state"><span>✓</span><h3>Всё отправлено</h3><p>На этом компьютере нет ожидающих изменений.</p></div>`}
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
  return `
    <div class="settings-grid">
      <section class="card settings-section">
        <div class="section-heading"><div><p class="eyebrow">Интеграция</p><h2>Google Workspace</h2></div><span class="status-pill warning">Тестовый режим</span></div>
        ${settingRow("Рабочая таблица", journal.sheetName, "Подключение подготовлено")}
        ${settingRow("Автообновление", "Каждые 60 секунд", "Также доступна ручная кнопка")}
        ${settingRow("Запись в Google", "Выключена", "До контролируемой проверки")}
        ${settingRow("Часовой пояс", APP_CONFIG.timeZone, "Дата и время заполняются автоматически")}
      </section>
      <section class="card settings-section">
        <div class="section-heading"><div><p class="eyebrow">Доступ</p><h2>Сотрудники</h2></div><span class="count-badge">${EMPLOYEES.length}</span></div>
        <div class="employee-list">${EMPLOYEES.map((employee, index) => `<div><span class="avatar small">${initials(employee)}</span><strong>${escapeHtml(employee)}</strong><small>${index === 0 ? "Доступен для выбора" : "Доступен для выбора"}</small></div>`).join("")}</div>
      </section>
      <section class="card settings-section wide">
        <div class="section-heading"><div><p class="eyebrow">Журналы</p><h2>Настроенные источники</h2></div><button class="secondary-button" disabled>+ Подключить журнал</button></div>
        <div class="configured-journal"><span class="journal-symbol">50</span><span><strong>${journal.title}</strong><small>Лист «${journal.sheetName}» · чтение и запись · обе роли</small></span><span class="status-pill success">Готов к тесту</span></div>
      </section>
    </div>`;
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
        ${formField("performer", "Кто внёс данные", `<select id="performer" name="performer" required><option value="">Выберите имя и фамилию</option>${EMPLOYEES.map(employee => `<option ${employee === values.performer && !existing ? "selected" : ""}>${escapeHtml(employee)}</option>`).join("")}</select>`, "Выбирается заново для каждой записи", "full")}
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

function openShiftDialog() {
  const dialog = createDialog(`
    <form id="shift-form" class="dialog-card small-dialog">
      <div class="dialog-heading"><div><p class="eyebrow">Рабочая смена</p><h2>Начать смену</h2></div><button type="button" class="dialog-close" data-action="close-dialog">×</button></div>
      <p class="dialog-lead">Укажите старшего смены. В каждой журнальной записи исполнитель всё равно выбирается отдельно.</p>
      ${formField("shiftEmployee", "Старший смены", `<select id="shiftEmployee" name="shiftEmployee" required><option value="">Выберите имя и фамилию</option>${EMPLOYEES.map(employee => `<option>${escapeHtml(employee)}</option>`).join("")}</select>`)}
      <div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Отмена</button><button type="submit" class="primary-button">Начать смену</button></div>
    </form>`);
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const employee = new FormData(event.currentTarget).get("shiftEmployee");
    if (!employee) return;
    state.shift = await shiftService.start(employee);
    dialog.close();
    render();
    toast("Смена начата.", "success");
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
      ${formField("performer", "Кто аннулирует", `<select id="performer" name="performer" required><option value="">Выберите имя и фамилию</option>${EMPLOYEES.map(employee => `<option>${escapeHtml(employee)}</option>`).join("")}</select>`)}
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

function createDialog(content) {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.innerHTML = content;
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", event => {
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
  if (state.demoBannerDismissed) return "";
  return `<div class="demo-banner"><span class="demo-icon">i</span><p><strong>Безопасный тестовый режим.</strong> Здесь показаны демонстрационные записи. Связь с рабочей таблицей пока выключена.</p><button data-action="dismiss-demo" aria-label="Закрыть">×</button></div>`;
}

function connectionBadge() {
  return `<span class="connection-badge ${navigator.onLine ? "online" : "offline"}"><i></i>${navigator.onLine ? "Сеть доступна" : "Нет интернета"}</span>`;
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
    ${navItem("dashboard", "Обзор", dashboardIcon())}
    ${navItem("journals", "Журналы", journalIcon())}
    ${navItem("sync", "Синхронизация", syncIcon(), state.operations.length)}
    ${state.account.role === "manager" ? navItem("settings", "Настройки", settingsIcon()) : ""}
  </nav>`;
}

function metricCard(label, value, note, tone, compactValue = false) {
  return `<article class="metric-card card ${tone}"><p>${label}</p><strong class="${compactValue ? "compact-value" : ""}">${value}</strong><small>${note}</small></article>`;
}

function settingRow(label, value, note) {
  return `<div class="setting-row"><span><strong>${label}</strong><small>${note}</small></span><b>${value}</b></div>`;
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
  return ({ dashboard: "Обзор", journals: "Журналы", sync: "Синхронизация", settings: "Настройки" })[state.page] ?? "Обзор";
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_CONFIG.timeZone }).format(new Date());
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
function syncIcon() { return `<svg viewBox="0 0 24 24"><path d="M20 7h-7V4l-4 4 4 4V9h5a6 6 0 0 1-9 5M4 17h7v3l4-4-4-4v3H6a6 6 0 0 1 9-5"/></svg>`; }
function settingsIcon() { return `<svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 13.5v-3l-2-.6-.5-1.1 1-1.9-2.1-2.1-1.9 1L12.4 5 12 3h-3l-.6 2-1.1.5-1.9-1-2.1 2.1 1 1.9-.5 1.1-2 .6v3l2 .6.5 1.1-1 1.9 2.1 2.1 1.9-1 1.1.5.6 2h3l.6-2 1.1-.5 1.9 1 2.1-2.1-1-1.9.5-1.1z"/></svg>`; }
function refreshIcon() { return `<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>`; }
function syncLargeIcon() { return `<svg viewBox="0 0 64 64"><path d="M51 22H35v-8L23 26l12 12v-8h12a14 14 0 0 1-23 11M13 42h16v8l12-12-12-12v8H17a14 14 0 0 1 23-11"/></svg>`; }
