const runtimeConfig = globalThis.__PACKAGING_FILLING_CONFIG__ ?? {};

export const APP_CONFIG = Object.freeze({
  name: "Фасовочный участок",
  version: "0.2.0",
  locale: "ru-RU",
  timeZone: "Europe/Vilnius",
  refreshIntervalMs: 60_000,
  integration: {
    mode: runtimeConfig.mode === "gateway" ? "gateway" : "demo",
    googleWritesEnabled: runtimeConfig.googleWritesEnabled === true,
    gatewayBaseUrl: runtimeConfig.gatewayBaseUrl ?? "",
    spreadsheetId: "1An019JRwrya4wl9EtqY4zNELfRNzaq26sidhQce3Tc8",
    sheetId: 1257425673,
    sheetName: "Контроль 50г"
  }
});

export const ACCOUNTS = Object.freeze([
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

export const EMPLOYEES = Object.freeze([
  "Albert Krevski",
  "Vladislav Balašov",
  "Viktor Minin",
  "Vitalii Paliienko",
  "Anatolii Brazhko"
]);

export const JOURNALS = Object.freeze([
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
